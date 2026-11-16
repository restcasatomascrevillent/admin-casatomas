/**
 * «Quién canceló» (16/11/2026): textos de la Lista y de la ficha, la sección de canceladas del día y la lectura
 * que aguanta un proyecto sin la migración 20261205100000.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetColumnasCancelacionParaTests,
  canceladasDelDia,
  esErrorColumnaCancelacionFaltante,
  leerConCancelacion,
  quienCancelo,
  textoCanceladaCorto,
  textoCanceladaLargo,
} from "@/lib/reservas/cancelacion";

// Sin zona: la hora local del test. Así el texto no depende de dónde se ejecute.
const CUANDO = "2026-11-14T18:20:00";

describe("quienCancelo", () => {
  it("solo en las canceladas y solo con los dos valores", () => {
    expect(quienCancelo({ estado: "cancelada", cancelada_por: "cliente" })).toBe("cliente");
    expect(quienCancelo({ estado: "cancelada", cancelada_por: "restaurante" })).toBe("restaurante");
    expect(quienCancelo({ estado: "cancelada", cancelada_por: null })).toBeNull();
    expect(quienCancelo({ estado: "cancelada" })).toBeNull();
    expect(quienCancelo({ estado: "cancelada", cancelada_por: "otro" })).toBeNull();
    expect(quienCancelo({ estado: "confirmada", cancelada_por: "cliente" })).toBeNull();
  });
});

describe("textos", () => {
  it("fila de la Lista: quién y cuándo", () => {
    expect(textoCanceladaCorto({ estado: "cancelada", cancelada_por: "cliente", cancelada_at: CUANDO })).toBe("Cancelada por el cliente · 14/11 18:20");
    expect(textoCanceladaCorto({ estado: "cancelada", cancelada_por: "restaurante", cancelada_at: CUANDO })).toBe("Cancelada por el restaurante · 14/11 18:20");
  });

  it("canceladas de antes (sin autor ni hora): «Cancelada», sin inventar nada", () => {
    expect(textoCanceladaCorto({ estado: "cancelada" })).toBe("Cancelada");
    expect(textoCanceladaCorto({ estado: "cancelada", cancelada_at: CUANDO })).toBe("Cancelada · 14/11 18:20");
    expect(textoCanceladaLargo({ estado: "cancelada" })).toBe("No consta quién la canceló");
    expect(textoCanceladaLargo({ estado: "cancelada", cancelada_at: CUANDO })).toBe("Cancelada el sábado 14 nov 2026 a las 18:20 · no consta quién la canceló");
  });

  it("ficha: frase entera", () => {
    expect(textoCanceladaLargo({ estado: "cancelada", cancelada_por: "restaurante", cancelada_at: CUANDO })).toBe(
      "Cancelada por el restaurante el sábado 14 nov 2026 a las 18:20",
    );
    expect(textoCanceladaLargo({ estado: "cancelada", cancelada_por: "cliente", cancelada_at: "no es una fecha" })).toBe("Cancelada por el cliente");
  });

  it("una reserva que no está cancelada no dice nada", () => {
    expect(textoCanceladaCorto({ estado: "confirmada", cancelada_por: "cliente", cancelada_at: CUANDO })).toBeNull();
    expect(textoCanceladaLargo({ estado: "no_show" })).toBeNull();
  });
});

describe("canceladasDelDia", () => {
  it("solo las canceladas, por hora y nombre; no toca la lista que recibe", () => {
    const reservas = [
      { id: "a", estado: "cancelada", hora: "21:00:00", nombre: "Zoe" },
      { id: "b", estado: "confirmada", hora: "14:00:00", nombre: "Ana" },
      { id: "c", estado: "cancelada", hora: "14:30:00", nombre: "Luis" },
      { id: "d", estado: "cancelada", hora: "21:00", nombre: "Berta" },
      { id: "e", estado: "no_show", hora: "13:00:00", nombre: "Paco" },
    ];
    expect(canceladasDelDia(reservas).map((r) => r.id)).toEqual(["c", "d", "a"]);
    expect(reservas.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(canceladasDelDia(null)).toEqual([]);
  });
});

describe("leerConCancelacion · proyecto sin la migración", () => {
  beforeEach(() => __resetColumnasCancelacionParaTests());

  const FALTA = { code: "42703", message: "column reservas.cancelada_por does not exist" };

  it("reconoce el error de columna ausente y no otros", () => {
    expect(esErrorColumnaCancelacionFaltante(FALTA)).toBe(true);
    expect(esErrorColumnaCancelacionFaltante({ code: "PGRST204", message: "Could not find the 'cancelada_at' column" })).toBe(true);
    expect(esErrorColumnaCancelacionFaltante({ code: "42703", message: "column reservas.otra does not exist" })).toBe(false);
    expect(esErrorColumnaCancelacionFaltante({ code: "42501", message: "permission denied" })).toBe(false);
    expect(esErrorColumnaCancelacionFaltante(null)).toBe(false);
  });

  it("con la migración: una sola lectura, pidiendo las columnas", async () => {
    const consulta = vi.fn(async (_extra: string) => ({ data: [1], error: null }));
    expect(await leerConCancelacion(consulta)).toEqual({ data: [1], error: null });
    expect(consulta.mock.calls.map((c) => c[0])).toEqual([", cancelada_por, cancelada_at"]);
  });

  it("sin la migración: repite sin las columnas y ya no las vuelve a pedir", async () => {
    const consulta = vi.fn(async (extra: string) => (extra ? { data: null, error: FALTA } : { data: [1], error: null }));
    expect(await leerConCancelacion(consulta)).toEqual({ data: [1], error: null });
    expect(consulta.mock.calls.map((c) => c[0])).toEqual([", cancelada_por, cancelada_at", ""]);
    await leerConCancelacion(consulta);
    expect(consulta.mock.calls.map((c) => c[0])).toEqual([", cancelada_por, cancelada_at", "", ""]);
  });

  it("cualquier otro error se devuelve tal cual, sin repetir", async () => {
    const otro = { code: "42501", message: "permission denied" };
    const consulta = vi.fn(async (_extra: string) => ({ data: null, error: otro }));
    expect(await leerConCancelacion(consulta)).toEqual({ data: null, error: otro });
    expect(consulta).toHaveBeenCalledTimes(1);
  });
});
