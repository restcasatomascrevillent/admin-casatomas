import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  CADUCIDAD_COPIA_HOY_MS,
  CLAVE_COPIA_HOY,
  ESPERA_GUARDADO_MS,
  activarCopiaHoy,
  borrarCopiaHoy,
  esConsultaDeHoy,
  fechaLocal,
  guardarCopiaHoy,
  hidratarCopiaHoy,
  leerCopiaHoy,
} from "../cacheOffline";

// 7 de noviembre de 2026, 21:30 hora local.
const AHORA = new Date(2026, 10, 7, 21, 30).getTime();
const HOY = "2026-11-07";
const RESERVAS = [{ id: "r1", nombre: "Ana", hora: "21:00:00", estado: "confirmada" }];

const nuevoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("esConsultaDeHoy", () => {
  it.each([
    [["reservas-hoy", "pendientes-mesa", HOY], true],
    [["reservas-hoy", "pendientes-mesa", "2026-11-06"], false],
    [["reservas-kanban", HOY], true],
    [["asignaciones_mesa", HOY, null], true],
    [["asignaciones_mesa", HOY, "sala-1", "cena"], true],
    [["asignaciones_mesa", "2026-11-08", null], false],
    [["ajustes_mesa_servicio", "dia", HOY], true],
    // 09/11/2026: también los de una sala y turno de hoy (el plano de escritorio), no los de otro día.
    [["ajustes_mesa_servicio", "sala-1", HOY, "cena"], true],
    [["ajustes_mesa_servicio", "sala-1", "2026-11-06", "cena"], false],
    [["reservas-hoy", "canceladas", HOY], true],
    [["reservas-hoy", "canceladas", "2026-11-06"], false],
    [["planos_espacio", "sala-1"], true],
    [["planos_espacio", undefined], false],
    [["salas_cerradas_servicio", "eventos", HOY, HOY], true],
    [["salas_cerradas_servicio", "eventos", HOY, "2026-11-30"], false],
    [["salas_cerradas_servicio", "sala-1", HOY, "comida"], true],
    [["salas_cerradas_servicio", "evento-reserva", "r-1"], false],
    [["mesas"], true],
    [["mesas", "sala-1"], true],
    [["mesas", "todos", "con-inactivas"], false],
    [["espacios_reserva"], true],
    [["configuracion-reservas"], true],
    [["reservas-lista", HOY], false],
    [["facturas"], false],
  ])("%j → %s", (clave, esperado) => {
    expect(esConsultaDeHoy(clave, HOY)).toBe(esperado);
  });

  it("fechaLocal usa la fecha local, no la UTC", () => {
    expect(fechaLocal(new Date(2026, 10, 7, 0, 5))).toBe(HOY);
  });
});

describe("guardar, leer e hidratar", () => {
  it("guarda solo las consultas de hoy y las vuelve a cargar con su hora original", () => {
    const qc = nuevoCliente();
    qc.setQueryData(["reservas-hoy", "pendientes-mesa", HOY], RESERVAS, { updatedAt: AHORA - 60_000 });
    qc.setQueryData(["mesas"], [{ id: "m1" }], { updatedAt: AHORA - 120_000 });
    qc.setQueryData(["facturas"], [{ id: "f1" }]);
    qc.setQueryData(["reservas-hoy", "pendientes-mesa", "2026-11-06"], [{ id: "ayer" }]);
    guardarCopiaHoy(qc, "u1", AHORA);

    const copia = leerCopiaHoy("u1", AHORA)!;
    expect(copia.consultas.map((c) => c.clave)).toEqual(
      expect.arrayContaining([["reservas-hoy", "pendientes-mesa", HOY], ["mesas"]]),
    );
    expect(copia.consultas).toHaveLength(2);

    const otro = nuevoCliente();
    expect(hidratarCopiaHoy(otro, "u1", AHORA + 5_000)).toBe(2);
    expect(otro.getQueryData(["reservas-hoy", "pendientes-mesa", HOY])).toEqual(RESERVAS);
    // Con su hora de entonces: se pinta ya, pero está vieja y se volverá a pedir.
    expect(otro.getQueryState(["reservas-hoy", "pendientes-mesa", HOY])!.dataUpdatedAt).toBe(AHORA - 60_000);
    expect(otro.getQueryData(["facturas"])).toBeUndefined();
  });

  it("la clave con `undefined` (asignaciones sin sala) casa con la guardada (null en JSON)", () => {
    const qc = nuevoCliente();
    qc.setQueryData(["asignaciones_mesa", HOY, undefined], [{ id: "a1" }]);
    guardarCopiaHoy(qc, "u1", AHORA);
    const otro = nuevoCliente();
    hidratarCopiaHoy(otro, "u1", AHORA);
    expect(otro.getQueryData(["asignaciones_mesa", HOY, undefined])).toEqual([{ id: "a1" }]);
  });

  it("no pisa lo que ya está en la caché", () => {
    const qc = nuevoCliente();
    qc.setQueryData(["mesas"], [{ id: "vieja" }]);
    guardarCopiaHoy(qc, "u1", AHORA);
    const otro = nuevoCliente();
    otro.setQueryData(["mesas"], [{ id: "nueva" }]);
    expect(hidratarCopiaHoy(otro, "u1", AHORA)).toBe(0);
    expect(otro.getQueryData(["mesas"])).toEqual([{ id: "nueva" }]);
  });

  it("otro usuario no ve la copia", () => {
    const qc = nuevoCliente();
    qc.setQueryData(["mesas"], [{ id: "m1" }]);
    guardarCopiaHoy(qc, "u1", AHORA);
    expect(leerCopiaHoy("u2", AHORA)).toBeNull();
    expect(hidratarCopiaHoy(nuevoCliente(), "u2", AHORA)).toBe(0);
  });

  it("caduca a las 18 h y al cambiar de día (y se borra)", () => {
    const qc = nuevoCliente();
    qc.setQueryData(["mesas"], [{ id: "m1" }]);
    // Guardada a las 03:00: a las 21:30 del mismo día aún vale (18 h 30 min > 18 h → no).
    guardarCopiaHoy(qc, "u1", new Date(2026, 10, 7, 3, 0).getTime());
    expect(leerCopiaHoy("u1", new Date(2026, 10, 7, 3, 0).getTime() + CADUCIDAD_COPIA_HOY_MS)).not.toBeNull();
    expect(leerCopiaHoy("u1", AHORA)).toBeNull();
    expect(localStorage.getItem(CLAVE_COPIA_HOY)).toBeNull();

    guardarCopiaHoy(qc, "u1", AHORA);
    expect(leerCopiaHoy("u1", new Date(2026, 10, 8, 0, 30).getTime())).toBeNull();
  });

  it("JSON roto o de otra versión: sin copia y sin romper", () => {
    localStorage.setItem(CLAVE_COPIA_HOY, "{roto");
    expect(leerCopiaHoy("u1", AHORA)).toBeNull();
    localStorage.setItem(CLAVE_COPIA_HOY, JSON.stringify({ v: 99, usuario: "u1", fecha: HOY, guardado: AHORA, consultas: [] }));
    expect(leerCopiaHoy("u1", AHORA)).toBeNull();
  });

  it("sin cuota: no lanza y no deja copia a medias", () => {
    const qc = nuevoCliente();
    qc.setQueryData(["mesas"], [{ id: "m1" }]);
    const espia = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("lleno", "QuotaExceededError");
    });
    expect(() => guardarCopiaHoy(qc, "u1", AHORA)).not.toThrow();
    espia.mockRestore();
    expect(localStorage.getItem(CLAVE_COPIA_HOY)).toBeNull();
  });

  it("borrarCopiaHoy la quita", () => {
    const qc = nuevoCliente();
    qc.setQueryData(["mesas"], [{ id: "m1" }]);
    guardarCopiaHoy(qc, "u1", AHORA);
    borrarCopiaHoy();
    expect(localStorage.getItem(CLAVE_COPIA_HOY)).toBeNull();
  });
});

describe("activarCopiaHoy", () => {
  it("carga la copia al activarse y reescribe tras una respuesta buena; al pararla deja de escribir", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
    const previo = nuevoCliente();
    previo.setQueryData(["mesas"], [{ id: "m1" }]);
    guardarCopiaHoy(previo, "u1", AHORA);

    const qc = nuevoCliente();
    const parar = activarCopiaHoy(qc, "u1");
    expect(qc.getQueryData(["mesas"])).toEqual([{ id: "m1" }]);

    qc.setQueryData(["reservas-hoy", "pendientes-mesa", fechaLocal()], RESERVAS);
    vi.advanceTimersByTime(ESPERA_GUARDADO_MS);
    expect(leerCopiaHoy("u1")!.consultas).toHaveLength(2);

    parar();
    qc.setQueryData(["espacios_reserva"], [{ id: "e1" }]);
    vi.advanceTimersByTime(ESPERA_GUARDADO_MS);
    expect(leerCopiaHoy("u1")!.consultas).toHaveLength(2);
  });
});
