// Jueves de tapas por la noche: dos turnos fijos, 20:30 y 22:00
// (`configuracion_turnos.horas_fijas`, migración 20261122200000).
// Motor común de la web, el bot y el panel: módulo puro, sin red.
import { describe, expect, it } from "vitest";
import {
  calcularDisponibilidad,
  horasFijasDeConfig,
  horasFijasDelDia,
  horasOfrecidas,
  minutosHastaSiguienteTurnoFijo,
  validarHoraOfrecida,
  type ConfiguracionTurnoInput,
} from "../disponibilidad";

const ESCALERA = [
  { minutos: 60, umbral: 0 },
  { minutos: 30, umbral: 70 },
  { minutos: 15, umbral: 85 },
];

// Como la demo tras la migración.
const TURNOS_CON_JUEVES_DE_TAPAS: ConfiguracionTurnoInput[] = [
  { nombre_periodo: "Comida", hora_inicio: "13:00:00", hora_fin: "16:00:00", dias_semana: [0, 1, 2, 3, 4, 5, 6], activo: true, espacio_id: null, niveles_escalera: ESCALERA },
  { nombre_periodo: "Cena", hora_inicio: "20:00:00", hora_fin: "23:00:00", dias_semana: [0, 1, 2, 3, 5, 6], activo: true, espacio_id: null, niveles_escalera: ESCALERA },
  {
    nombre_periodo: "Cena · Jueves de tapas",
    hora_inicio: "20:30:00",
    hora_fin: "23:00:00",
    dias_semana: [4],
    activo: true,
    espacio_id: null,
    niveles_escalera: ESCALERA,
    horas_fijas: ["20:30:00", "22:00:00"],
  },
];

const JUEVES = "2026-11-19";
const MIERCOLES = "2026-11-18";

const disponibilidad = (fecha: string, reservas: { hora: string; numero_comensales: number }[] = []) =>
  calcularDisponibilidad({ fecha, configuraciones: TURNOS_CON_JUEVES_DE_TAPAS, reservas, capacidadTotal: 150, ahora: null });

describe("horas fijas: lectura", () => {
  it("lee el array de PostgREST y el texto de Postgres; vacío o basura = escalera", () => {
    expect(horasFijasDeConfig({ horas_fijas: ["22:00:00", "20:30:00", "20:30"] })).toEqual([1230, 1320]);
    expect(horasFijasDeConfig({ horas_fijas: "{20:30:00,22:00:00}" })).toEqual([1230, 1320]);
    expect(horasFijasDeConfig({ horas_fijas: null })).toBeNull();
    expect(horasFijasDeConfig({ horas_fijas: [] })).toBeNull();
    expect(horasFijasDeConfig({ horas_fijas: ["tapas"] })).toBeNull();
    expect(horasFijasDeConfig({})).toBeNull();
  });

  it("horas fijas del día: el jueves 20:30 y 22:00; otro día ninguna", () => {
    expect(horasFijasDelDia(JUEVES, TURNOS_CON_JUEVES_DE_TAPAS)).toEqual(["20:30", "22:00"]);
    expect(horasFijasDelDia(MIERCOLES, TURNOS_CON_JUEVES_DE_TAPAS)).toEqual([]);
    expect(horasFijasDelDia(null, TURNOS_CON_JUEVES_DE_TAPAS)).toEqual([]);
  });

  it("minutos hasta el turno siguiente: 20:30 → 90, 21:00 → 60, 22:00 y antes del primero → null", () => {
    const fijas = ["20:30", "22:00"];
    expect(minutosHastaSiguienteTurnoFijo("20:30", fijas)).toBe(90);
    expect(minutosHastaSiguienteTurnoFijo("21:00:00", fijas)).toBe(60);
    expect(minutosHastaSiguienteTurnoFijo("22:00", fijas)).toBeNull();
    expect(minutosHastaSiguienteTurnoFijo("14:00", fijas)).toBeNull();
    expect(minutosHastaSiguienteTurnoFijo("20:30", [])).toBeNull();
    expect(minutosHastaSiguienteTurnoFijo("20:30", undefined)).toBeNull();
  });
});

describe("motor: jueves por la noche solo 20:30 y 22:00", () => {
  it("el jueves: la comida normal y la cena SOLO en dos turnos", () => {
    const r = disponibilidad(JUEVES);
    const cena = horasOfrecidas(r).filter((h) => h >= "17:00");
    const comida = horasOfrecidas(r).filter((h) => h < "17:00");
    expect(cena).toEqual(["20:30", "22:00"]);
    expect(comida).toEqual(["13:00", "14:00", "15:00"]);
    const tapas = r.periodos.find((p) => p.nombre_periodo === "Cena · Jueves de tapas");
    expect(tapas?.horas_fijas).toEqual(["20:30", "22:00"]);
  });

  it("aunque el turno se llene, no se abren medias ni cuartos el jueves", () => {
    const r = disponibilidad(JUEVES, [{ hora: "20:30", numero_comensales: 70 }]);
    expect(r.huecos.filter((h) => h.turno === "cena").map((h) => h.hora)).toEqual(["20:30", "22:00"]);
  });

  it("los demás días, igual que siempre (la escalera de la Cena)", () => {
    const r = disponibilidad(MIERCOLES);
    expect(horasOfrecidas(r).filter((h) => h >= "17:00")).toEqual(["20:00", "21:00", "22:00"]);
    expect(r.periodos.every((p) => (p.horas_fijas ?? null) === null)).toBe(true);
  });

  it("validar la hora: el jueves las 21:00 no vale, las 22:00 sí", () => {
    const r = disponibilidad(JUEVES);
    expect(validarHoraOfrecida(r, "22:00").ok).toBe(true);
    expect(validarHoraOfrecida(r, "20:30").ok).toBe(true);
    expect(validarHoraOfrecida(r, "21:00").ok).toBe(false);
  });

  it("una hora fija fuera del horario del periodo no se ofrece", () => {
    const r = calcularDisponibilidad({
      fecha: JUEVES,
      configuraciones: [{ hora_inicio: "20:30", hora_fin: "23:00", dias_semana: [4], horas_fijas: ["19:00", "20:30", "23:30"] }],
      reservas: [],
      capacidadTotal: 100,
      ahora: null,
    });
    expect(horasOfrecidas(r)).toEqual(["20:30"]);
  });
});
