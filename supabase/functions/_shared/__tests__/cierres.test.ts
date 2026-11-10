// Cierres de reservas (2026-10-13): regla por defecto, agrupado, qué fila
// escribir al cerrar/abrir y su efecto en el motor de disponibilidad.
import { describe, it, expect } from "vitest";
import {
  cambioCierre,
  cierreSemanalDesde,
  cierresPorDia,
  diasAbiertosSinReservaOnlineDesde,
  esSoloSinReservaOnline,
  normalizarServiciosCerrados,
  separarCierres,
  serviciosCerradosPorSemana,
  textoTurnosCerrados,
  turnosCerradosEn,
} from "../cierres";
import { calcularDisponibilidad, validarHoraOfrecida } from "../disponibilidad";

// Octubre 2026: lunes 12, jueves 15, sábado 17, domingo 18.
describe("regla semanal por defecto", () => {
  it("lunes y jueves todo el día, domingo la cena", () => {
    const c = serviciosCerradosPorSemana("2026-10-12", "2026-10-18");
    expect(turnosCerradosEn(c, "2026-10-12")).toEqual(["comida", "cena"]);
    expect(turnosCerradosEn(c, "2026-10-13")).toEqual([]);
    expect(turnosCerradosEn(c, "2026-10-15")).toEqual(["comida", "cena"]);
    expect(turnosCerradosEn(c, "2026-10-17")).toEqual([]);
    expect(turnosCerradosEn(c, "2026-10-18")).toEqual(["cena"]);
    expect(Object.keys(cierresPorDia(c))).toEqual(["2026-10-12", "2026-10-15", "2026-10-18"]);
  });
  it("lee la configuración y descarta basura", () => {
    expect(cierreSemanalDesde({ dias_cerrados_comida: [2, 9], dias_cerrados_cena: null })).toEqual({
      comida: [2],
      cena: [0, 1, 4],
    });
  });
  it("normaliza filas de la RPC", () => {
    expect(
      normalizarServiciosCerrados([{ fecha: "2026-10-17", turno: "cena", origen: "manual", motivo: "Evento" }, { x: 1 }]),
    ).toEqual([{ fecha: "2026-10-17", turno: "cena", origen: "manual", motivo: "Evento" }]);
  });
  it("textos", () => {
    expect(textoTurnosCerrados(["comida", "cena"])).toBe("en todo el día");
    expect(textoTurnosCerrados(["cena"])).toBe("por la noche");
  });
});

describe("cambioCierre", () => {
  it("abrir un jueves guarda una excepción abierta; volver a cerrarlo la borra", () => {
    expect(cambioCierre("2026-10-15", "comida", false)).toEqual({ tipo: "guardar", abierto: true });
    expect(cambioCierre("2026-10-15", "comida", true)).toEqual({ tipo: "borrar" });
  });
  it("cerrar un sábado guarda una excepción cerrada; reabrirlo la borra", () => {
    expect(cambioCierre("2026-10-17", "cena", true)).toEqual({ tipo: "guardar", abierto: false });
    expect(cambioCierre("2026-10-17", "cena", false)).toEqual({ tipo: "borrar" });
  });
});

describe("motor con serviciosCerrados", () => {
  const COMIDA = { id: "c", hora_inicio: "13:00", hora_fin: "16:00", intervalo_base_minutos: 60, activo: true };
  const CENA = { id: "n", hora_inicio: "20:00", hora_fin: "23:00", intervalo_base_minutos: 60, activo: true };
  const base = { fecha: "2026-10-18", comensales: 2, configuraciones: [COMIDA, CENA], reservas: [], capacidadTotal: 100, ahora: null };

  it("domingo sin cena: solo horas de comida y la cena no se valida", () => {
    const r = calcularDisponibilidad({ ...base, serviciosCerrados: ["cena"] });
    expect(r.cerrado).toBe(false);
    expect(r.huecos.every((h) => h.hora < "17:00")).toBe(true);
    expect(validarHoraOfrecida(r, "21:00").ok).toBe(false);
    expect(validarHoraOfrecida(r, "14:00").ok).toBe(true);
  });
  it("día entero cerrado: cerrado con motivo cierre_reservas", () => {
    const r = calcularDisponibilidad({ ...base, serviciosCerrados: ["comida", "cena"] });
    expect(r.cerrado).toBe(true);
    expect(r.motivoCierre).toBe("cierre_reservas");
    expect(validarHoraOfrecida(r, "14:00").codigo).toBe("dia_cerrado");
  });
  it("sin cierres, como siempre", () => {
    const r = calcularDisponibilidad(base);
    expect(r.huecos.some((h) => h.hora >= "20:00")).toBe(true);
  });
});

// Jueves de tapas (dueño, 2026-11-10: «Abierto, sin reservas web»). La regla de los canales NO
// cambia (el jueves sigue sin reservas web/teléfono); el panel lo separa para pintarlo abierto.
describe("jueves de tapas: abierto, sin reservas web", () => {
  it("la regla de la web y el bot sigue cerrando el jueves entero", () => {
    expect(turnosCerradosEn(serviciosCerradosPorSemana("2026-10-15", "2026-10-15"), "2026-10-15")).toEqual(["comida", "cena"]);
  });
  it("lee la columna; sin ella (migración sin aplicar), el jueves", () => {
    expect(diasAbiertosSinReservaOnlineDesde(undefined)).toEqual([4]);
    expect(diasAbiertosSinReservaOnlineDesde({ dias_cerrados_comida: [1, 4] })).toEqual([4]);
    expect(diasAbiertosSinReservaOnlineDesde({ dias_abiertos_sin_reserva_online: [] })).toEqual([]);
    expect(diasAbiertosSinReservaOnlineDesde({ dias_abiertos_sin_reserva_online: [4, 9, "6"] })).toEqual([4, 6]);
  });
  it("separa: jueves semanal = solo sin reservas web; lunes, domingo noche y lo manual = cerrado", () => {
    const semana = serviciosCerradosPorSemana("2026-10-12", "2026-10-18");
    const manual = { fecha: "2026-10-22", turno: "cena" as const, origen: "manual" as const, motivo: "Evento" };
    const { cerrados, sinReservaOnline } = separarCierres([...semana, manual], [4]);
    expect(sinReservaOnline.map((c) => `${c.fecha} ${c.turno}`)).toEqual(["2026-10-15 comida", "2026-10-15 cena"]);
    expect(cerrados.map((c) => `${c.fecha} ${c.turno}`)).toEqual([
      "2026-10-12 comida",
      "2026-10-12 cena",
      "2026-10-18 cena",
      "2026-10-22 cena",
    ]);
    expect(esSoloSinReservaOnline(manual, [4])).toBe(false);
  });
  it("sin días en la lista, todo es cierre (como antes)", () => {
    const semana = serviciosCerradosPorSemana("2026-10-12", "2026-10-18");
    expect(separarCierres(semana, []).sinReservaOnline).toEqual([]);
  });
  it("ningún jueves del año queda como «cerrado» para el panel", () => {
    const anio = serviciosCerradosPorSemana("2026-11-01", "2027-10-31");
    const { cerrados } = separarCierres(anio, [4]);
    expect(cerrados.filter((c) => new Date(`${c.fecha}T12:00:00Z`).getUTCDay() === 4)).toEqual([]);
  });
});
