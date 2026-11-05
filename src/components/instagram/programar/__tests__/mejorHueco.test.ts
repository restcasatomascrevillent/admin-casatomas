/**
 * «Mejor hueco» al programar: el próximo mejor día y la mejor franja de «Qué
 * funciona»; sin datos claros, mañana a las 13:00 (Madrid); y «Nueva pieza
 * este día» fuerza el día.
 */
import { describe, expect, it } from "vitest";
import { horaDeFranja, mejorHueco } from "../mejorHueco";
import type { QueFunciona } from "@/components/instagram/metricas/tipos";

// Jueves 5 nov 2026, 11:00 en Madrid.
const AHORA = new Date("2026-11-05T10:00:00Z");

const qf = (conclusiones: QueFunciona["conclusiones"], suficiente = true): QueFunciona => ({
  periodo_dias: 90,
  minimo: 3,
  publicaciones: 30,
  tasa_media: 4,
  suficiente,
  aviso: null,
  por: {},
  conclusiones,
  mejores: [],
  peores: [],
});

describe("mejorHueco", () => {
  it("sin datos: mañana a las 13:00, sin motivo", () => {
    const h = mejorHueco(null, AHORA);
    expect(h).toMatchObject({ fecha: "2026-11-06", hora: "13:00", motivo: null, texto: "vie 6 nov · 13:00" });
    expect(h.instante.toISOString()).toBe("2026-11-06T12:00:00.000Z");
  });

  it("con «Qué funciona»: el próximo mejor día y la hora de la mejor franja", () => {
    const h = mejorHueco(
      qf([
        { eje: "dia", estado: "mejor", clave: "martes", texto: "" },
        { eje: "franja", estado: "mejor", clave: "20-22", texto: "" },
      ]),
      AHORA,
    );
    expect(h).toMatchObject({ fecha: "2026-11-10", hora: "21:00" });
    expect(h.motivo).toBe("Según «Qué funciona»: los martes funcionan mejor y la franja de 20 a 22 h funciona mejor.");
  });

  it("el mismo día si aún se llega a la hora; si no, la semana siguiente", () => {
    expect(mejorHueco(qf([{ eje: "dia", estado: "mejor", clave: "jueves", texto: "" }]), AHORA).fecha).toBe("2026-11-05");
    expect(mejorHueco(qf([{ eje: "dia", estado: "mejor", clave: "jueves", texto: "" }, { eje: "franja", estado: "mejor", clave: "10-12", texto: "" }]), AHORA).fecha).toBe("2026-11-12");
  });

  it("con pocos datos o sin conclusión clara, no se fía", () => {
    expect(mejorHueco(qf([{ eje: "dia", estado: "mejor", clave: "martes", texto: "" }], false), AHORA).fecha).toBe("2026-11-06");
    expect(mejorHueco(qf([{ eje: "dia", estado: "parecido", texto: "" }]), AHORA).motivo).toBeNull();
  });

  it("«Nueva pieza este día» fuerza el día, a la mejor hora", () => {
    const h = mejorHueco(qf([{ eje: "franja", estado: "mejor", clave: "12-14", texto: "" }]), AHORA, "2026-11-20");
    expect(h).toMatchObject({ fecha: "2026-11-20", hora: "13:00" });
  });

  it("horaDeFranja", () => {
    expect(horaDeFranja("12-14")).toBe("13:00");
    expect(horaDeFranja("8-9")).toBe("08:00");
    expect(horaDeFranja("x")).toBeNull();
    expect(horaDeFranja("14-12")).toBeNull();
  });
});
