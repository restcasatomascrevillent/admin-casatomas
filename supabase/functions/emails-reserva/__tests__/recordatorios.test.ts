/**
 * Tests para supabase/functions/emails-reserva/recordatorios.ts
 *
 * Capa pura: quién recibe el recordatorio a T-2 días. Lo crítico:
 * - Solo reservas 'confirmada', con email, en la fecha objetivo exacta.
 * - Nunca se repite un envío ya marcado 'enviado' (idempotencia).
 * - El cálculo de fecha objetivo no se desvía por husos horarios cuando se
 *   le da ya la fecha de "hoy" resuelta.
 */
import { describe, it, expect } from "vitest";
import {
  fechaObjetivoRecordatorio,
  seleccionarReservasParaRecordatorio,
  esReservaDePrueba,
  enLotes,
  type ReservaParaRecordatorio,
} from "../recordatorios.ts";

describe("fechaObjetivoRecordatorio", () => {
  it("suma 2 días por defecto", () => {
    expect(fechaObjetivoRecordatorio("2026-03-14")).toBe("2026-03-16");
  });

  it("cruza correctamente el fin de mes", () => {
    expect(fechaObjetivoRecordatorio("2026-02-27")).toBe("2026-03-01"); // 2026 no es bisiesto
  });

  it("cruza correctamente el fin de año", () => {
    expect(fechaObjetivoRecordatorio("2026-12-30")).toBe("2027-01-01");
  });

  it("admite una antelación distinta de 2 días", () => {
    expect(fechaObjetivoRecordatorio("2026-03-14", 1)).toBe("2026-03-15");
  });
});

function reserva(overrides: Partial<ReservaParaRecordatorio>): ReservaParaRecordatorio {
  // Email de un dominio real a propósito: @example.com es dato de prueba y
  // el recordatorio lo excluye (ver esReservaDePrueba).
  return {
    id: "r1",
    estado: "confirmada",
    fecha: "2026-03-16",
    email: "cliente@correo.es",
    nombre: "Ana López",
    notas_cliente: null,
    ...overrides,
  };
}

describe("seleccionarReservasParaRecordatorio", () => {
  const fechaObjetivo = "2026-03-16";

  it("incluye una reserva confirmada, con email, en la fecha objetivo y sin envío previo", () => {
    const seleccionadas = seleccionarReservasParaRecordatorio([reserva({ id: "a" })], fechaObjetivo, new Set());
    expect(seleccionadas.map((r) => r.id)).toEqual(["a"]);
  });

  it("excluye reservas que no están confirmadas", () => {
    const candidatas = [reserva({ id: "a", estado: "pendiente" }), reserva({ id: "b", estado: "verificada" })];
    expect(seleccionarReservasParaRecordatorio(candidatas, fechaObjetivo, new Set())).toHaveLength(0);
  });

  it("excluye reservas sin email", () => {
    const candidatas = [reserva({ id: "a", email: null })];
    expect(seleccionarReservasParaRecordatorio(candidatas, fechaObjetivo, new Set())).toHaveLength(0);
  });

  it("excluye reservas fuera de la fecha objetivo exacta", () => {
    const candidatas = [reserva({ id: "a", fecha: "2026-03-17" }), reserva({ id: "b", fecha: "2026-03-15" })];
    expect(seleccionarReservasParaRecordatorio(candidatas, fechaObjetivo, new Set())).toHaveLength(0);
  });

  it("excluye los datos de prueba: [DEMO-SEED] en notas o nombre, email @example.com (sin distinguir mayúsculas)", () => {
    const candidatas = [
      reserva({ id: "demo-notas", notas_cliente: "[DEMO-SEED] Alergia a frutos secos" }),
      reserva({ id: "demo-nombre", nombre: "[DEMO-SEED] Guillermo" }),
      reserva({ id: "example", email: "guillermo.santos99@EXAMPLE.com" }),
      reserva({ id: "real" }),
    ];
    expect(seleccionarReservasParaRecordatorio(candidatas, fechaObjetivo, new Set()).map((r) => r.id)).toEqual(["real"]);
  });

  it("una reserva normal con notas y un dominio que solo contiene «example» SÍ recibe el recordatorio", () => {
    const candidatas = [
      reserva({ id: "a", notas_cliente: "Cumpleaños, trae tarta" }),
      reserva({ id: "b", email: "ana@example.com.es" }),
      reserva({ id: "c", email: "ana@myexample.com" }),
    ];
    expect(seleccionarReservasParaRecordatorio(candidatas, fechaObjetivo, new Set()).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("NUNCA repite un envío ya marcado como enviado (idempotencia)", () => {
    const candidatas = [reserva({ id: "a" }), reserva({ id: "b" })];
    const seleccionadas = seleccionarReservasParaRecordatorio(candidatas, fechaObjetivo, new Set(["a"]));
    expect(seleccionadas.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("esReservaDePrueba", () => {
  it("detecta el marcador del seed y los emails @example.com", () => {
    expect(esReservaDePrueba({ nombre: null, notas_cliente: "[DEMO-SEED]", email: null })).toBe(true);
    expect(esReservaDePrueba({ nombre: "x [DEMO-SEED]", notas_cliente: null, email: null })).toBe(true);
    expect(esReservaDePrueba({ nombre: null, notas_cliente: null, email: "  A@Example.COM " })).toBe(true);
  });
  it("no marca como prueba una reserva real ni campos ausentes", () => {
    expect(esReservaDePrueba({ nombre: "Ana", notas_cliente: "demo-seed sin corchetes", email: "ana@gmail.com" })).toBe(false);
    expect(esReservaDePrueba({})).toBe(false);
  });
});

describe("enLotes", () => {
  it("divide en lotes del tamaño pedido, con el último más pequeño si sobra", () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("un solo lote si el tamaño es mayor que el total de elementos", () => {
    expect(enLotes([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("array vacío si no hay elementos", () => {
    expect(enLotes([], 3)).toEqual([]);
  });

  it("lanza si el tamaño de lote no es positivo", () => {
    expect(() => enLotes([1, 2], 0)).toThrow();
  });
});
