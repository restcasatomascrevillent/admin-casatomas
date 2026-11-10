// Jueves de tapas por la noche en el panel: dos turnos fijos, 20:30 y 22:00
// (`configuracion_turnos.horas_fijas`, migración 20261122200100).
// Alta (rejilla que alimenta el selector de hora), Hoy (turno en curso, estancia
// de la mesa) y reparto de mesas (la mesa del 1.er turno queda libre a las 22:00).
import { describe, expect, it } from "vitest";
import type { ConfiguracionTurnoInput } from "../../../../supabase/functions/_shared/disponibilidad";
import { construirRejillaCuartos, periodosDelDia, type ReservaCuarto } from "../rejillaCuartos";
import { conflictoDeMesa, franjaDeHora, minutosOcupacionMesa } from "../ocupacionMesa";
import { configServicioSalaDesde, estadoMesaServicio, estanciaMinutosDeReserva } from "../servicioSala";
import { textoTurnoFijo, turnoFijoEnCurso } from "../vistaHoy";
import { leerHorasFijasTexto, textoHorasFijas } from "../horasFijas";
import { horasBaseDelDia } from "../ocupacionSalas";

const ESCALERA = [
  { minutos: 60, umbral: 0 },
  { minutos: 30, umbral: 70 },
];
const TURNOS: ConfiguracionTurnoInput[] = [
  { nombre_periodo: "Comida", hora_inicio: "13:00:00", hora_fin: "16:00:00", dias_semana: [0, 1, 2, 3, 4, 5, 6], activo: true, espacio_id: null },
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
const ESTANCIA = { comida: 105, cena: 120 };
const reserva = (hora: string, pax: number): ReservaCuarto => ({ id: `${hora}-${pax}`, hora, numero_comensales: pax, estado: "confirmada" });

const horasDeTurno = (fecha: string, reservas: ReservaCuarto[] = []) =>
  construirRejillaCuartos({ periodos: periodosDelDia(fecha, TURNOS), reservas, capacidadTurno: 100, estancia: ESTANCIA })
    .franjas.filter((f) => f.origen === "turno")
    .map((f) => f.hora);

describe("alta: las horas del selector (rejilla de cuartos)", () => {
  it("el jueves por la noche solo 20:30 y 22:00; la comida, sus cuartos de siempre", () => {
    const horas = horasDeTurno(JUEVES);
    expect(horas.filter((h) => h >= "17:00")).toEqual(["20:30", "22:00"]);
    expect(horas.filter((h) => h < "17:00")).toHaveLength(12); // 13:00…15:45
  });

  it("el miércoles por la noche, los cuartos de siempre (20:00…22:45)", () => {
    const cena = horasDeTurno(MIERCOLES).filter((h) => h >= "17:00");
    expect(cena[0]).toBe("20:00");
    expect(cena).toHaveLength(12);
    expect(cena).toContain("21:15");
  });

  it("una reserva a otra hora el jueves sale aparte (no como hora del turno)", () => {
    const r = construirRejillaCuartos({ periodos: periodosDelDia(JUEVES, TURNOS), reservas: [reserva("21:00", 2)], capacidadTurno: 100, estancia: ESTANCIA });
    expect(r.franjas.find((f) => f.hora === "21:00")?.origen).toBe("reserva");
  });

  it("en sala: los del 1.er turno ya no cuentan a las 22:00", () => {
    const r = construirRejillaCuartos({
      periodos: periodosDelDia(JUEVES, TURNOS),
      reservas: [reserva("20:30", 4), reserva("22:00", 6)],
      capacidadTurno: 100,
      estancia: ESTANCIA,
    });
    expect(r.franjas.find((f) => f.hora === "20:30")?.enSala).toBe(4);
    expect(r.franjas.find((f) => f.hora === "22:00")?.enSala).toBe(6);
  });

  it("horas base del día (Ocupación por salas): el jueves noche 20:30 y 22:00", () => {
    const { horasBase } = horasBaseDelDia(JUEVES, { espacios: [], reservas: [] }, TURNOS);
    expect(horasBase.filter((h) => h >= "17:00")).toEqual(["20:30", "22:00"]);
  });
});

describe("reparto de mesas: la mesa del 1.er turno queda libre a las 22:00", () => {
  const jueves = configServicioSalaDesde({ estancia_cena_minutos: 120 }, ["20:30", "22:00"]);
  const normal = configServicioSalaDesde({ estancia_cena_minutos: 120 });

  it("la franja de las 20:30 acaba a las 22:00 el jueves (120 min otro día)", () => {
    expect(minutosOcupacionMesa("20:30", jueves)).toBe(90);
    expect(franjaDeHora("20:30", jueves)).toEqual({ inicio: 1230, fin: 1320 });
    expect(minutosOcupacionMesa("22:00", jueves)).toBe(120);
    expect(minutosOcupacionMesa("20:30", normal)).toBe(120);
    expect(minutosOcupacionMesa("14:00", jueves)).toBe(105);
  });

  it("la misma mesa se puede dar a las 20:30 y a las 22:00 el jueves; otro día choca", () => {
    const asignaciones = [{ mesa_id: "m3", reserva_id: "r1", reservas: { nombre: "Oscar", hora: "20:30" } }];
    expect(conflictoDeMesa(asignaciones, "m3", { id: "r2", hora: "22:00" }, jueves)).toBeNull();
    expect(conflictoDeMesa(asignaciones, "m3", { id: "r2", hora: "22:00" }, normal)).not.toBeNull();
  });

  it("modo servicio: los de las 20:30 pasan a «por liberar» a las 22:00", () => {
    expect(estanciaMinutosDeReserva("20:30", "cena", jueves)).toBe(90);
    const reservas = [{ id: "r1", hora: "20:30", estado: "completada", llegada_at: "2026-11-19T20:30:00", salida_at: null }];
    const asign = [{ mesa_id: "m3", reserva_id: "r1" }];
    const a2205 = new Date("2026-11-19T22:05:00");
    expect(estadoMesaServicio("m3", asign, reservas as never, "cena", a2205, jueves).estado).toBe("por_liberar");
    expect(estadoMesaServicio("m3", asign, reservas as never, "cena", a2205, normal).estado).toBe("ocupada");
  });
});

describe("Hoy: turno en curso", () => {
  const fijas = ["20:30", "22:00"];
  it("antes de las 22:00, 1.er turno; desde las 22:00, 2.º", () => {
    expect(turnoFijoEnCurso(fijas, "cena", new Date("2026-11-19T19:00:00"))).toEqual({ numero: 1, hora: "20:30", total: 2 });
    expect(turnoFijoEnCurso(fijas, "cena", new Date("2026-11-19T21:59:00"))?.numero).toBe(1);
    expect(turnoFijoEnCurso(fijas, "cena", new Date("2026-11-19T22:00:00"))).toEqual({ numero: 2, hora: "22:00", total: 2 });
    expect(textoTurnoFijo({ numero: 1, hora: "20:30" })).toBe("1.er turno (20:30)");
    expect(textoTurnoFijo({ numero: 2, hora: "22:00" })).toBe("2.º turno (22:00)");
  });
  it("sin turnos fijos (otro día) o en la comida, nada", () => {
    expect(turnoFijoEnCurso([], "cena", new Date("2026-11-18T21:00:00"))).toBeNull();
    expect(turnoFijoEnCurso(fijas, "comida", new Date("2026-11-19T14:00:00"))).toBeNull();
  });
});

describe("Configuración › Turnos: el campo «Turnos de hora fija»", () => {
  it("lee «20:30, 22:00» y lo enseña igual", () => {
    expect(leerHorasFijasTexto("22:00, 20:30")).toEqual({ horas: ["20:30", "22:00"] });
    expect(leerHorasFijasTexto("20.30 22h00")).toEqual({ horas: ["20:30", "22:00"] });
    expect(leerHorasFijasTexto("  ")).toEqual({ horas: null });
    expect(leerHorasFijasTexto("tapas")).toHaveProperty("error");
    expect(leerHorasFijasTexto("25:00")).toHaveProperty("error");
    expect(textoHorasFijas(["20:30:00", "22:00:00"])).toBe("20:30, 22:00");
    expect(textoHorasFijas(null)).toBe("");
  });
});
