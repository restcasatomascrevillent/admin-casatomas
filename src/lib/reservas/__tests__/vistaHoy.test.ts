/**
 * Reglas puras de las DOS VISTAS de «Hoy» (Kanban | Plano), 06/10/2026: qué vista se abre y
 * se recuerda, el filtro común del bloque de arriba y el turno que pinta el plano.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CLAVE_SALA_PLANO_HOY,
  CLAVE_VISTA_HOY,
  coincideFiltroHoy,
  guardarSalaPlanoHoy,
  guardarVistaHoy,
  leerSalaPlanoHoy,
  leerVistaHoy,
  nombreCartelMesa,
  tiempoCortoMesa,
  turnoDelPlano,
} from "@/lib/reservas/vistaHoy";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("la vista elegida se recuerda en este navegador", () => {
  it("sin nada guardado se abre el kanban (la de siempre)", () => {
    expect(leerVistaHoy()).toBe("kanban");
  });

  it("lo que se guarda es lo que se lee la próxima vez", () => {
    guardarVistaHoy("plano");
    expect(window.localStorage.getItem(CLAVE_VISTA_HOY)).toBe("plano");
    expect(leerVistaHoy()).toBe("plano");
    guardarVistaHoy("kanban");
    expect(leerVistaHoy()).toBe("kanban");
  });

  it("un valor raro guardado (otra versión, a mano) cae al kanban", () => {
    window.localStorage.setItem(CLAVE_VISTA_HOY, "mapa");
    expect(leerVistaHoy()).toBe("kanban");
  });

  it("sin almacenamiento (modo privado, bloqueado) ni leer ni guardar rompen nada", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(leerVistaHoy()).toBe("kanban");
    expect(() => guardarVistaHoy("plano")).not.toThrow();
    expect(leerSalaPlanoHoy()).toBeNull();
    expect(() => guardarSalaPlanoHoy("salon")).not.toThrow();
  });

  it("también la sala del plano", () => {
    expect(leerSalaPlanoHoy()).toBeNull();
    guardarSalaPlanoHoy("salon");
    expect(window.localStorage.getItem(CLAVE_SALA_PLANO_HOY)).toBe("salon");
    expect(leerSalaPlanoHoy()).toBe("salon");
  });
});

describe("el filtro del bloque de arriba es el mismo para el kanban y el plano", () => {
  const ana = { nombre: "Ana Pérez", email: "ana@ejemplo.test", telefono: "600111222", hora: "14:00:00" };
  const luis = { nombre: "Luis", email: null, telefono: null, hora: "21:30:00" };

  it("turno por la hora con el corte de las 17:00", () => {
    expect(coincideFiltroHoy(ana, { busqueda: "", filtroTurno: "comida" })).toBe(true);
    expect(coincideFiltroHoy(ana, { busqueda: "", filtroTurno: "cena" })).toBe(false);
    expect(coincideFiltroHoy(luis, { busqueda: "", filtroTurno: "cena" })).toBe(true);
    expect(coincideFiltroHoy({ ...luis, hora: "17:00" }, { busqueda: "", filtroTurno: "cena" })).toBe(true);
    expect(coincideFiltroHoy(luis, { busqueda: "", filtroTurno: "todo" })).toBe(true);
  });

  it("texto en nombre o email sin mayúsculas, y en el teléfono tal cual", () => {
    expect(coincideFiltroHoy(ana, { busqueda: "  PÉREZ ", filtroTurno: "todo" })).toBe(true);
    expect(coincideFiltroHoy(ana, { busqueda: "ejemplo.test", filtroTurno: "todo" })).toBe(true);
    expect(coincideFiltroHoy(ana, { busqueda: "111", filtroTurno: "todo" })).toBe(true);
    expect(coincideFiltroHoy(luis, { busqueda: "ana", filtroTurno: "todo" })).toBe(false);
    // Turno Y texto a la vez.
    expect(coincideFiltroHoy(ana, { busqueda: "ana", filtroTurno: "cena" })).toBe(false);
  });
});

describe("el turno que pinta el plano", () => {
  const a = (hh: number, mm = 0) => new Date(2026, 9, 6, hh, mm);

  it("con «Todo el día», el turno EN CURSO (antes de las 17:00, la comida)", () => {
    expect(turnoDelPlano("todo", a(13, 30))).toBe("comida");
    expect(turnoDelPlano("todo", a(16, 59))).toBe("comida");
    expect(turnoDelPlano("todo", a(17, 0))).toBe("cena");
    expect(turnoDelPlano("todo", a(22, 15))).toBe("cena");
  });

  it("con «Comida» o «Cena», ese, sea la hora que sea", () => {
    expect(turnoDelPlano("cena", a(12))).toBe("cena");
    expect(turnoDelPlano("comida", a(22))).toBe("comida");
  });
});

describe("lo que cabe dentro de una mesa del plano", () => {
  it("hora si está por llegar, retraso, o el rato que lleva sentada", () => {
    expect(tiempoCortoMesa("libre", null, null)).toBeNull();
    expect(tiempoCortoMesa("reservada", -20, "14:00:00")).toBe("14:00");
    expect(tiempoCortoMesa("retrasada", 12, "14:00:00")).toBe("+12 min");
    expect(tiempoCortoMesa("ocupada", 45, "14:00:00")).toBe("45 min");
    expect(tiempoCortoMesa("por_liberar", 110, "14:00:00")).toBe("1 h 50");
    expect(tiempoCortoMesa("por_liberar", 120, "14:00:00")).toBe("2 h");
    expect(tiempoCortoMesa("ocupada", null, "14:00:00")).toBeNull();
  });

  it("el cartel: nombre e inicial del apellido", () => {
    expect(nombreCartelMesa("Lucía Ortega Marín")).toBe("Lucía O.");
    expect(nombreCartelMesa("  Oscar  ")).toBe("Oscar");
    expect(nombreCartelMesa(null)).toBe("Sin nombre");
  });
});
