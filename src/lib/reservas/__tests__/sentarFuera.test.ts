import { describe, expect, it } from "vitest";
import {
  cambiosQuitarFuera,
  cambiosSentarFuera,
  esErrorColumnasFueraInexistentes,
  estaSentadaFuera,
  etiquetaFuera,
  problemaDatosFuera,
  puedeSentarseFuera,
  textoMesaFuera,
} from "../sentarFuera";
import { agruparHoyMovil, listaHoyEscritorio, listaHoyMovil } from "../hoyMovil";

const AHORA = new Date("2026-11-10T21:05:00Z");

describe("sentarFuera: reglas", () => {
  it("solo está fuera con «Llegó» y un sitio", () => {
    expect(estaSentadaFuera({ estado: "completada", fuera_lugar: "Touza" })).toBe(true);
    expect(estaSentadaFuera({ estado: "confirmada", fuera_lugar: "Touza" })).toBe(false);
    expect(estaSentadaFuera({ estado: "completada", fuera_lugar: "  " })).toBe(false);
    expect(estaSentadaFuera({ estado: "completada" })).toBe(false);
  });

  it("etiqueta «Fuera · Touza · Mesa 4» (número → «Mesa N»; nota tal cual)", () => {
    expect(etiquetaFuera({ estado: "completada", fuera_lugar: " Terraza  Touza ", fuera_mesa: "4" })).toBe("Fuera · Terraza Touza · Mesa 4");
    expect(etiquetaFuera({ estado: "completada", fuera_lugar: "Touza", fuera_mesa: "junto a la puerta" })).toBe(
      "Fuera · Touza · junto a la puerta",
    );
    expect(etiquetaFuera({ estado: "completada", fuera_lugar: "Touza", fuera_mesa: "4" }, { conMesa: false })).toBe("Fuera · Touza");
    expect(etiquetaFuera({ estado: "confirmada", fuera_lugar: "Touza" })).toBe("");
    expect(textoMesaFuera("12b")).toBe("Mesa 12b");
  });

  it("se puede desde las vivas y las sentadas sin irse; no desde canceladas, «No vino» ni liberadas", () => {
    expect(puedeSentarseFuera({ estado: "confirmada" })).toBe(true);
    expect(puedeSentarseFuera({ estado: "pendiente" })).toBe(true);
    expect(puedeSentarseFuera({ estado: "completada" })).toBe(true);
    expect(puedeSentarseFuera({ estado: "completada", salida_at: "2026-11-10T22:00:00Z" })).toBe(false);
    expect(puedeSentarseFuera({ estado: "cancelada" })).toBe(false);
    expect(puedeSentarseFuera({ estado: "no_show" })).toBe(false);
  });

  it("hace falta elegir dónde", () => {
    expect(problemaDatosFuera({ lugar: "  " })).toMatch(/Elige/);
    expect(problemaDatosFuera({ lugar: "Touza" })).toBeNull();
  });

  it("sentar fuera: «Llegó» con hora, sin sala, y la sala de antes para volver", () => {
    expect(cambiosSentarFuera({ estado: "confirmada", espacio_id: "comedor" }, { lugar: " Touza ", mesa: " " }, AHORA)).toEqual({
      estado: "completada",
      llegada_at: AHORA.toISOString(),
      espacio_id: null,
      fuera_lugar: "Touza",
      fuera_mesa: null,
      fuera_espacio_previo_id: "comedor",
    });
  });

  it("si ya estaba sentada no cambia la hora de llegada; cambiar el sitio no pisa la sala de antes", () => {
    const dentro = cambiosSentarFuera(
      { estado: "completada", espacio_id: "terraza", llegada_at: "2026-11-10T20:30:00Z" },
      { lugar: "Terraza Touza", mesa: "3" },
      AHORA,
    );
    expect(dentro).not.toHaveProperty("llegada_at");
    expect(dentro).toMatchObject({ fuera_mesa: "3", fuera_espacio_previo_id: "terraza" });
    const cambio = cambiosSentarFuera(
      { estado: "completada", espacio_id: null, llegada_at: "2026-11-10T20:30:00Z", fuera_lugar: "Touza" },
      { lugar: "Otro" },
      AHORA,
    );
    expect(cambio).not.toHaveProperty("fuera_espacio_previo_id");
  });

  it("volver dentro devuelve la sala de antes", () => {
    expect(cambiosQuitarFuera({ fuera_espacio_previo_id: "comedor" })).toEqual({
      fuera_lugar: null,
      fuera_mesa: null,
      fuera_espacio_previo_id: null,
      espacio_id: "comedor",
    });
    expect(cambiosQuitarFuera({})).not.toHaveProperty("espacio_id");
  });

  it("reconoce el error de columnas de fuera inexistentes (migración sin aplicar)", () => {
    expect(esErrorColumnasFueraInexistentes({ code: "42703", message: "column reservas.fuera_lugar does not exist" })).toBe(true);
    expect(esErrorColumnasFueraInexistentes({ code: "PGRST204", message: "Could not find the 'fuera_mesa' column of 'reservas'" })).toBe(true);
    expect(esErrorColumnasFueraInexistentes({ code: "42703", message: "column reservas.llegada_at does not exist" })).toBe(false);
    expect(esErrorColumnasFueraInexistentes(null)).toBe(false);
  });
});

describe("sentarFuera en las listas de Hoy", () => {
  const r = (id: string, estado: string, extra: Record<string, unknown> = {}) => ({
    id,
    nombre: id,
    hora: "21:00:00",
    numero_comensales: 2,
    estado,
    espacio_id: null as string | null,
    ...extra,
  });
  const reservas = [
    r("fuera", "completada", { fuera_lugar: "Touza" }),
    r("dentro", "completada", { espacio_id: "comedor" }),
    r("sinMesa", "confirmada", { espacio_id: "comedor" }),
  ];
  const filtros = { busqueda: "", filtroTurno: "todo" as const };

  it("agrupado: va a «Fuera», no a «Sin mesa» ni a una sala", () => {
    const grupos = agruparHoyMovil(reservas, [{ id: "comedor", nombre: "Comedor" }], () => [], filtros);
    expect(grupos.map((g) => [g.clave, g.filas.map((f) => f.reserva.id)])).toEqual([
      ["sin-mesa", ["sinMesa"]],
      ["comedor", ["dentro"]],
      ["fuera", ["fuera"]],
    ]);
  });

  it("móvil: las sentadas fuera salen aparte (no están en ninguna mesa)", () => {
    const l = listaHoyMovil(reservas, () => [], 21 * 60, filtros);
    expect(l.fuera.map((f) => f.reserva.id)).toEqual(["fuera"]);
    expect(l.porLlegar.concat(l.llegan).map((f) => f.reserva.id)).toEqual(["sinMesa"]);
  });

  it("escritorio: sentadas, con las de dentro", () => {
    const l = listaHoyEscritorio(reservas, () => [], 21 * 60, filtros);
    expect(l.sentadas.map((f) => f.reserva.id).sort()).toEqual(["dentro", "fuera"]);
  });
});
