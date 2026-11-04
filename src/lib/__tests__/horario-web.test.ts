import { describe, expect, it } from "vitest";
import { errorHorario, HORARIO_POR_DEFECTO, leerHorario, mismoHorario, resumenHorario } from "@/lib/horario-web";

describe("horario de Menú del día y Tapas (panel)", () => {
  it("sin guardar (NULL) o con otra forma: lo de siempre", () => {
    expect(leerHorario(null, "menu")).toEqual(HORARIO_POR_DEFECTO.menu);
    expect(leerHorario(undefined, "tapas")).toEqual({ dias: [4], desde: null, hasta: null });
    expect(leerHorario({ dias: [] }, "menu")).toEqual(HORARIO_POR_DEFECTO.menu);
    expect(leerHorario("martes", "menu")).toEqual(HORARIO_POR_DEFECTO.menu);
  });
  it("lee lo guardado, ordena los días y descarta horas sueltas o iguales", () => {
    expect(leerHorario({ dias: [5, 2, 2], desde: "13:00", hasta: "16:00" }, "menu")).toEqual({ dias: [2, 5], desde: "13:00", hasta: "16:00" });
    expect(leerHorario({ dias: [1], desde: "13:00", hasta: null }, "menu")).toEqual({ dias: [1], desde: null, hasta: null });
    expect(leerHorario({ dias: [1], desde: "13:00", hasta: "13:00" }, "menu")).toEqual({ dias: [1], desde: null, hasta: null });
  });
  it("mismas reglas que el CHECK de la base de datos", () => {
    expect(errorHorario({ dias: [], desde: null, hasta: null })).toMatch(/al menos un día/);
    expect(errorHorario({ dias: [2], desde: "13:00", hasta: null })).toMatch(/o ninguna/);
    expect(errorHorario({ dias: [2], desde: "13:00", hasta: "13:00" })).toMatch(/misma/);
    expect(errorHorario({ dias: [2], desde: "9:00", hasta: "13:00" })).toMatch(/HH:MM/);
    expect(errorHorario({ dias: [2], desde: "20:00", hasta: "01:00" })).toBeNull();
  });
  it("resume el horario en castellano", () => {
    expect(resumenHorario(HORARIO_POR_DEFECTO.menu)).toBe("Martes a jueves · todo el día");
    expect(resumenHorario(HORARIO_POR_DEFECTO.tapas)).toBe("Jueves · todo el día");
    expect(resumenHorario({ dias: [1, 3, 5], desde: "13:00", hasta: "16:00" })).toBe("Lunes, miércoles y viernes · 13:00–16:00");
    expect(resumenHorario({ dias: [1, 2, 3, 4, 5, 6, 7], desde: "20:00", hasta: "01:00" })).toBe("Todos los días · 20:00–01:00 (del día siguiente)");
  });
  it("compara horarios", () => {
    expect(mismoHorario({ dias: [2, 3, 4], desde: null, hasta: null }, HORARIO_POR_DEFECTO.menu)).toBe(true);
    expect(mismoHorario({ dias: [2, 3], desde: null, hasta: null }, HORARIO_POR_DEFECTO.menu)).toBe(false);
  });
});
