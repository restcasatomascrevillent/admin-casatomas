// Cierres de reservas (2026-10-13): regla por defecto, agrupado, qué fila
// escribir al cerrar/abrir y su efecto en el motor de disponibilidad.
import { describe, it, expect } from "vitest";
import {
  cambioCierre,
  cierreSemanalDesde,
  cierresPorDia,
  normalizarServiciosCerrados,
  serviciosCerradosPorSemana,
  textoTurnosCerrados,
  turnosCerradosEn,
} from "../cierres";
import { calcularDisponibilidad, validarHoraOfrecida } from "../disponibilidad";

// Octubre 2026: lunes 12, jueves 15, sábado 17, domingo 18.
describe("regla semanal por defecto", () => {
  it("lunes todo el día y domingo la cena; los jueves abren (2026-11-10)", () => {
    const c = serviciosCerradosPorSemana("2026-10-12", "2026-10-18");
    expect(turnosCerradosEn(c, "2026-10-12")).toEqual(["comida", "cena"]);
    expect(turnosCerradosEn(c, "2026-10-13")).toEqual([]);
    expect(turnosCerradosEn(c, "2026-10-15")).toEqual([]);
    expect(turnosCerradosEn(c, "2026-10-17")).toEqual([]);
    expect(turnosCerradosEn(c, "2026-10-18")).toEqual(["cena"]);
    expect(Object.keys(cierresPorDia(c))).toEqual(["2026-10-12", "2026-10-18"]);
  });
  it("ningún jueves sale cerrado en un año entero (ni con cambio de hora)", () => {
    const c = serviciosCerradosPorSemana("2026-11-01", "2027-10-31");
    const jueves = c.filter((s) => new Date(`${s.fecha}T12:00:00Z`).getUTCDay() === 4);
    expect(jueves).toEqual([]);
    // Y los lunes siguen cerrados enteros: 52 semanas × 2 servicios.
    expect(c.filter((s) => new Date(`${s.fecha}T12:00:00Z`).getUTCDay() === 1)).toHaveLength(104);
  });
  it("lee la configuración y descarta basura", () => {
    expect(cierreSemanalDesde({ dias_cerrados_comida: [2, 9], dias_cerrados_cena: null })).toEqual({
      comida: [2],
      cena: [0, 1],
    });
  });
  it("si la configuración aún cierra los jueves (migración sin aplicar), se respeta", () => {
    const semanal = cierreSemanalDesde({ dias_cerrados_comida: [1, 4], dias_cerrados_cena: [0, 1, 4] });
    expect(turnosCerradosEn(serviciosCerradosPorSemana("2026-10-15", "2026-10-15", semanal), "2026-10-15")).toEqual([
      "comida",
      "cena",
    ]);
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
  it("abrir un lunes guarda una excepción abierta; volver a cerrarlo la borra", () => {
    expect(cambioCierre("2026-10-12", "comida", false)).toEqual({ tipo: "guardar", abierto: true });
    expect(cambioCierre("2026-10-12", "comida", true)).toEqual({ tipo: "borrar" });
  });
  it("un jueves abre por defecto: cerrarlo guarda una excepción cerrada", () => {
    expect(cambioCierre("2026-10-15", "cena", true)).toEqual({ tipo: "guardar", abierto: false });
    expect(cambioCierre("2026-10-15", "cena", false)).toEqual({ tipo: "borrar" });
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
