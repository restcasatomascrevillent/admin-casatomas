import { describe, expect, it } from "vitest";
import {
  agruparPorDia,
  conflictosCercanos,
  construirEventos,
  diasMes,
  diasSemana,
  inicioSemana,
  limitesFecha,
  madridAUtc,
  moverVista,
  rangoVista,
  textoInstante,
  tituloVista,
  utcAMadrid,
  validarProgramacion,
  valorInicial,
  type ProgramacionConPieza,
} from "../logica";

describe("hora de Madrid", () => {
  it("convierte en invierno (UTC+1) y en verano (UTC+2)", () => {
    expect(madridAUtc("2026-11-10", "13:30")?.toISOString()).toBe("2026-11-10T12:30:00.000Z");
    expect(madridAUtc("2026-07-10", "13:30")?.toISOString()).toBe("2026-07-10T11:30:00.000Z");
    expect(utcAMadrid("2026-11-10T23:30:00Z")).toEqual({ fecha: "2026-11-11", hora: "00:30" });
    expect(utcAMadrid("2026-07-10T22:15:00Z")).toEqual({ fecha: "2026-07-11", hora: "00:15" });
  });

  it("la hora que no existe (29/03/2026 02:30) da null y la repetida (25/10/2026 02:30) toma la primera", () => {
    expect(madridAUtc("2026-03-29", "02:30")).toBeNull();
    expect(madridAUtc("2026-03-29", "03:00")?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(madridAUtc("2026-10-25", "02:30")?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("rechaza formatos malos", () => {
    expect(madridAUtc("2026-13-01", "10:00")).toBeNull();
    expect(madridAUtc("2026-02-30", "10:00")).toBeNull();
    expect(madridAUtc("10/11/2026", "10:00")).toBeNull();
    expect(madridAUtc("2026-11-10", "25:00")).toBeNull();
  });

  it("textoInstante en castellano y en hora de Madrid", () => {
    expect(textoInstante("2026-11-10T12:30:00Z")).toBe("mar 10 nov, 13:30");
  });
});

describe("validarProgramacion", () => {
  const ahora = new Date("2026-11-10T10:00:00Z"); // 11:00 en Madrid
  it("exige al menos 10 minutos de margen y no más de 75 días", () => {
    expect(validarProgramacion("2026-11-10", "10:30", ahora)).toEqual({ ok: false, error: "Esa fecha ya ha pasado" });
    expect(validarProgramacion("2026-11-10", "11:05", ahora)).toMatchObject({ ok: false, error: expect.stringContaining("10 minutos") });
    expect(validarProgramacion("2026-11-10", "11:10", ahora)).toMatchObject({ ok: true });
    expect(validarProgramacion("2027-01-24", "10:00", ahora)).toMatchObject({ ok: true }); // 75 días menos 1 h
    expect(validarProgramacion("2027-01-25", "12:00", ahora)).toMatchObject({ ok: false, error: expect.stringContaining("75 días") });
  });
  it("explica la hora inexistente y los campos vacíos", () => {
    expect(validarProgramacion("2027-03-28", "02:15", new Date("2027-03-01T00:00:00Z"))).toMatchObject({ ok: false, error: expect.stringContaining("cambio de hora") });
    expect(validarProgramacion("", "10:00", ahora)).toMatchObject({ ok: false, error: "Elige la fecha y la hora" });
  });
  it("devuelve el instante UTC", () => {
    const r = validarProgramacion("2026-11-11", "09:00", ahora);
    expect(r.ok && r.instante.toISOString()).toBe("2026-11-11T08:00:00.000Z");
  });
});

describe("conflictosCercanos", () => {
  const lista = [
    { id: "a", pieza_id: "p1", marca: "casa-tomas", programada_para: "2026-11-10T12:00:00Z", estado: "programada" },
    { id: "b", pieza_id: "p2", marca: "casa-tomas", programada_para: "2026-11-10T12:31:00Z", estado: "programada" },
    { id: "c", pieza_id: "p3", marca: "touza", programada_para: "2026-11-10T12:10:00Z", estado: "programada" },
    { id: "d", pieza_id: "p4", marca: "casa-tomas", programada_para: "2026-11-10T11:45:00Z", estado: "cancelada" },
    { id: "e", pieza_id: "p5", marca: "casa-tomas", programada_para: "2026-11-10T11:30:00Z", estado: "publicando" },
  ];
  it("solo la misma marca, activas, a ±30 min y sin contar la propia pieza", () => {
    const t = new Date("2026-11-10T12:00:00Z");
    expect(conflictosCercanos(lista, "casa-tomas", t, null).map((x) => x.id)).toEqual(["a", "e"]);
    expect(conflictosCercanos(lista, "casa-tomas", t, "p1").map((x) => x.id)).toEqual(["e"]);
    expect(conflictosCercanos(lista, "touza", t, null).map((x) => x.id)).toEqual(["c"]);
  });
});

describe("rejilla del calendario", () => {
  it("semana de lunes a domingo, también cruzando de mes y de año", () => {
    expect(inicioSemana("2026-11-10")).toBe("2026-11-09");
    expect(diasSemana("2026-11-15")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(diasSemana("2027-01-01")[0]).toBe("2026-12-28");
    expect(tituloVista("semana", "2026-11-10")).toBe("9–15 nov 2026");
    expect(tituloVista("semana", "2026-12-01")).toBe("30 nov – 6 dic 2026");
    expect(tituloVista("semana", "2027-01-01")).toBe("28 dic 2026 – 3 ene 2027");
  });

  it("mes: 42 días desde el lunes de la semana del día 1", () => {
    const dias = diasMes("2026-11-20");
    expect(dias).toHaveLength(42);
    expect(dias[0]).toBe("2026-10-26");
    expect(dias[6]).toBe("2026-11-01");
    expect(dias[41]).toBe("2026-12-06");
    expect(tituloVista("mes", "2026-11-20")).toBe("noviembre de 2026");
  });

  it("mover la vista", () => {
    expect(moverVista("semana", "2026-11-10", 1)).toBe("2026-11-17");
    expect(moverVista("semana", "2026-11-10", -1)).toBe("2026-11-03");
    expect(moverVista("mes", "2026-12-15", 1)).toBe("2027-01-01");
    expect(moverVista("mes", "2026-01-15", -1)).toBe("2025-12-01");
  });

  it("el rango va de medianoche a medianoche de Madrid (con cambio de hora en medio)", () => {
    const r = rangoVista("semana", "2026-10-25");
    expect(r.desde.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(r.hasta.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("eventos", () => {
  const prog = (o: Partial<ProgramacionConPieza>): ProgramacionConPieza => ({
    id: "x", pieza_id: "p", marca: "casa-tomas", programada_para: "2026-11-10T12:00:00Z", estado: "programada", intentos: 0, ultimo_error: null, ...o,
  });
  it("programadas (sin canceladas ni publicadas) + piezas publicadas, por día de Madrid y en orden", () => {
    const eventos = construirEventos(
      [
        prog({ id: "1", programada_para: "2026-11-10T23:30:00Z" }), // 00:30 del 11 en Madrid
        prog({ id: "2", estado: "error", ultimo_error: "Meta caída", intentos: 3 }),
        prog({ id: "3", estado: "cancelada" }),
        prog({ id: "4", estado: "publicada" }),
      ],
      [
        { id: "pz", marca: "touza", formato: "story", plantilla: "tz-tipografica", imagen_ruta: null, publicada_at: "2026-11-10T08:00:00Z", permalink: "https://www.instagram.com/p/Z/" },
        { id: "sin", marca: "touza", formato: "post", plantilla: "tz-tipografica", imagen_ruta: null, publicada_at: null },
      ],
    );
    expect(eventos.map((e) => e.clave)).toEqual(["i:pz", "p:2", "p:1"]);
    expect(eventos[0]).toMatchObject({ tipo: "publicada", estado: "publicada", dia: "2026-11-10", hora: "09:00", permalink: "https://www.instagram.com/p/Z/" });
    expect(eventos[1]).toMatchObject({ estado: "error", error: "Meta caída", intentos: 3, programacionId: "2" });
    const porDia = agruparPorDia(eventos);
    expect(porDia.get("2026-11-11")?.map((e) => e.programacionId)).toEqual(["1"]);
    expect(porDia.get("2026-11-10")).toHaveLength(2);
  });
});

describe("valores del diálogo", () => {
  const ahora = new Date("2026-11-10T10:00:00Z");
  it("valor inicial: la hora dada si es válida; si no, mañana a las 13:00", () => {
    expect(valorInicial("2026-11-12T17:00:00Z", ahora)).toEqual({ fecha: "2026-11-12", hora: "18:00" });
    expect(valorInicial("2026-11-10T10:05:00Z", ahora)).toEqual({ fecha: "2026-11-11", hora: "13:00" });
    expect(valorInicial(null, ahora)).toEqual({ fecha: "2026-11-11", hora: "13:00" });
  });
  it("límites del selector: hoy y hoy + 75 días", () => {
    expect(limitesFecha(ahora)).toEqual({ min: "2026-11-10", max: "2027-01-24" });
  });
});
