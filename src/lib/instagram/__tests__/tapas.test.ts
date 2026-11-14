import { describe, expect, it } from "vitest";
import { TAPAS_EJEMPLO, validarPieza } from "..";
import {
  decidirAccion,
  huellaTapas,
  instanteProgramacion,
  limpiarTapas,
  madridAInstante,
  nombreDia,
  piezaStoryTapas,
  problemasTapas,
  semanaDe,
  textoFecha,
  textoTurnos,
  type FilaStoryTapas,
} from "../tapas";

const fila = (p: Partial<FilaStoryTapas> = {}): FilaStoryTapas => ({
  semana: "2026-11-09",
  estado: "programada",
  huella: huellaTapas("2026-11-12", TAPAS_EJEMPLO),
  pieza_id: "p1",
  programacion_id: "g1",
  bloqueo_hasta: null,
  ...p,
});

describe("story del jueves de tapas: fechas", () => {
  it("semana = su lunes; día y fecha en castellano", () => {
    expect(semanaDe("2026-11-12")).toBe("2026-11-09");
    expect(semanaDe("2026-11-09")).toBe("2026-11-09");
    expect(semanaDe("2026-11-15")).toBe("2026-11-09");
    expect(semanaDe("2027-01-01")).toBe("2026-12-28");
    expect(nombreDia("2026-11-12")).toBe("Jueves");
    expect(nombreDia("2026-11-11")).toBe("Miércoles");
    expect(textoFecha("2026-11-12")).toBe("12 de noviembre");
  });

  it("hora de Madrid con el cambio de hora", () => {
    expect(madridAInstante("2026-11-12", "12:00").toISOString()).toBe("2026-11-12T11:00:00.000Z");
    expect(madridAInstante("2026-07-02", "12:00").toISOString()).toBe("2026-07-02T10:00:00.000Z");
  });

  it("por defecto a las 12:00 del día de las tapas", () => {
    const ahora = new Date("2026-11-10T09:00:00Z");
    const r = instanteProgramacion("2026-11-12", "12:00", ahora);
    expect(r).toEqual({ instante: new Date("2026-11-12T11:00:00Z"), yaPaso: false });
    // Hora de Postgres («12:30:00») y hora rara (se queda la de por defecto).
    expect(instanteProgramacion("2026-11-12", "12:30:00", ahora).instante.toISOString()).toBe("2026-11-12T11:30:00.000Z");
    expect(instanteProgramacion("2026-11-12", "nada", ahora).instante.toISOString()).toBe("2026-11-12T11:00:00.000Z");
  });

  it("si la hora ya ha pasado (o quedan menos de 15 min), dentro de 15 minutos", () => {
    const ahora = new Date("2026-11-12T13:00:00Z"); // 14:00 en Madrid
    expect(instanteProgramacion("2026-11-12", "12:00", ahora)).toEqual({ instante: new Date("2026-11-12T13:15:00Z"), yaPaso: true });
    const casi = new Date("2026-11-12T10:50:00Z"); // 11:50: faltan 10 min
    expect(instanteProgramacion("2026-11-12", "12:00", casi).instante.toISOString()).toBe("2026-11-12T11:05:00.000Z");
  });

  it("turnos de configuracion_turnos.horas_fijas", () => {
    expect(textoTurnos(["22:00:00", "20:30:00"])).toBe("20:30 y 22:00");
    expect(textoTurnos(["20:30:00"])).toBe("20:30");
    expect(textoTurnos(null)).toBeNull();
    expect(textoTurnos([])).toBeNull();
  });
});

describe("story del jueves de tapas: pieza", () => {
  it("la mejorada valida con fecha y turnos; la clásica, sin ellos", () => {
    const m = piezaStoryTapas({ dia: "2026-11-12", tapas: TAPAS_EJEMPLO, turnos: "20:30 y 22:00" });
    expect(m).toMatchObject({ plantilla: "ct-tapas", formato: "story", titular: "Jueves", cita: "12 de noviembre", antetitulo: "De tapas", pie: "Turnos 20:30 y 22:00", foto: "ct-salon-5" });
    expect(validarPieza(m).problemas ?? []).toEqual([]);
    const c = piezaStoryTapas({ dia: "2026-11-12", tapas: TAPAS_EJEMPLO, plantilla: "ct-tapas-clasica", turnos: "20:30 y 22:00", foto: "ct-lampara" });
    expect(c).not.toHaveProperty("cita");
    expect(c).not.toHaveProperty("pie");
    expect(c.foto).toBe("ct-lampara");
    expect(validarPieza(c).problemas ?? []).toEqual([]);
  });

  it("sin precios ni vacías ni repetidas; de 1 a 10 y que quepan", () => {
    expect(limpiarTapas(["  Gambón  rebozado ", "", "gambón rebozado", "Bravas"])).toEqual(["Gambón rebozado", "Bravas"]);
    expect(problemasTapas([])).toEqual(["No hay tapas."]);
    expect(problemasTapas(Array.from({ length: 11 }, (_, i) => `Tapa ${i}`))[0]).toMatch(/caben 10/);
    expect(problemasTapas(["x".repeat(71)])[0]).toMatch(/demasiado larga/);
    expect(problemasTapas(TAPAS_EJEMPLO, "ct-tapas", true)).toEqual([]);
    expect(problemasTapas(Array.from({ length: 10 }, (_, i) => `Tapa ${i} ${"con salsa de la casa ".repeat(3)}`.slice(0, 70)), "ct-tapas", true)[0]).toMatch(/demasiado texto/);
  });
});

describe("story del jueves de tapas: una por semana y regenerar", () => {
  const h = huellaTapas("2026-11-12", TAPAS_EJEMPLO);
  it("sin fila, se crea", () => expect(decidirAccion(null, h)).toBe("crear"));
  it("mismas tapas y programada → nada; otras tapas → regenerar", () => {
    expect(decidirAccion(fila(), h)).toBe("nada");
    expect(decidirAccion(fila(), huellaTapas("2026-11-12", [...TAPAS_EJEMPLO, "Patatas bravas"]))).toBe("regenerar");
    // Los espacios de más no cuentan como cambio; cambiar el día, sí.
    expect(huellaTapas("2026-11-12", ["  Gambón rebozado"])).toBe(huellaTapas("2026-11-12", ["Gambón rebozado"]));
    expect(huellaTapas("2026-11-12", ["A"])).not.toBe(huellaTapas("2026-11-11", ["A"]));
  });
  it("publicada → nada nunca (tampoco a mano)", () => {
    expect(decidirAccion(fila({ estado: "publicada" }), "otra")).toBe("nada");
    expect(decidirAccion(fila({ estado: "publicada" }), "otra", { manual: true })).toBe("nada");
  });
  it("cancelada → nada en automático; a mano, se rehace", () => {
    expect(decidirAccion(fila({ estado: "cancelada" }), "otra")).toBe("nada");
    expect(decidirAccion(fila({ estado: "cancelada" }), "otra", { manual: true })).toBe("regenerar");
  });
  it("otra pasada trabajando (cerrojo vigente) → nada", () => {
    const ahora = new Date("2026-11-12T10:00:00Z");
    expect(decidirAccion(fila({ bloqueo_hasta: "2026-11-12T10:02:00Z" }), "otra", { ahora })).toBe("nada");
    expect(decidirAccion(fila({ bloqueo_hasta: "2026-11-12T09:58:00Z" }), "otra", { ahora })).toBe("regenerar");
  });
  it("error con pieza → regenerar; error sin pieza → crear", () => {
    expect(decidirAccion(fila({ estado: "error" }), h)).toBe("regenerar");
    expect(decidirAccion(fila({ estado: "error", pieza_id: null }), h)).toBe("crear");
  });
  it("un «Publicar ahora» a medias (preparando con pieza) no lo toca el automático", () => {
    expect(decidirAccion(fila({ estado: "preparando" }), "otra")).toBe("nada");
    expect(decidirAccion(fila({ estado: "preparando" }), "otra", { manual: true })).toBe("regenerar");
  });
});
