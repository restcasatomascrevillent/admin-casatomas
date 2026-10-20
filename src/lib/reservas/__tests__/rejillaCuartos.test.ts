import { describe, expect, it } from "vitest";
import {
  construirRejillaCuartos,
  periodosDelDia,
  type ReservaCuarto,
} from "@/lib/reservas/rejillaCuartos";

// Decisión del dueño 2026-09-29 (reservas-sin-salas): vista interna en cuartos
// de hora con TODAS las horas del turno, sin escalera. Regla R1: las franjas
// van de hora_inicio (incluida) a hora_fin (excluida), como el motor.

// 2026-10-05 es lunes (dia 1).
const FECHA = "2026-10-05";

const TURNOS_GENERALES = [
  { hora_inicio: "13:00:00", hora_fin: "16:00:00", activo: true, espacio_id: null, dias_semana: [] },
  { hora_inicio: "20:00:00", hora_fin: "23:00:00", activo: true, espacio_id: null, dias_semana: [] },
];

const ESTANCIA = { comida: 105, cena: 120 };

const reserva = (hora: string, pax: number, extra: Partial<ReservaCuarto> = {}): ReservaCuarto => ({
  id: `${hora}-${pax}-${extra.estado ?? "confirmada"}`,
  hora,
  numero_comensales: pax,
  estado: "confirmada",
  ...extra,
});

function rejilla(reservas: ReservaCuarto[], extra: Partial<Parameters<typeof construirRejillaCuartos>[0]> = {}) {
  return construirRejillaCuartos({
    periodos: periodosDelDia(FECHA, TURNOS_GENERALES),
    reservas,
    capacidadTurno: 170,
    estancia: ESTANCIA,
    ...extra,
  });
}

const franja = (r: ReturnType<typeof rejilla>, hora: string) => r.franjas.find((f) => f.hora === hora);

describe("periodosDelDia", () => {
  it("Casa Tomás usa los turnos generales", () => {
    const periodos = periodosDelDia(FECHA, TURNOS_GENERALES);
    expect(periodos).toEqual([
      { inicio: 13 * 60, fin: 16 * 60 },
      { inicio: 20 * 60, fin: 23 * 60 },
    ]);
  });

  it("respeta dias_semana: un turno que no abre ese día no sale", () => {
    const soloMartes = [{ ...TURNOS_GENERALES[0], dias_semana: [2] }];
    expect(periodosDelDia(FECHA, soloMartes)).toEqual([]);
  });

  // Touza no admite reservas (decisión del dueño 2026-10-01): ya no hay periodos por negocio (la unión de los
  // turnos propios de las salas de Touza). Un turno propio de una sala no cambia los periodos del día.
  it("un turno propio de una sala (espacio_id) no entra: solo cuentan los generales", () => {
    const configs = [
      ...TURNOS_GENERALES,
      { hora_inicio: "19:00", hora_fin: "21:00", activo: true, espacio_id: "reservado", dias_semana: [] },
    ];
    expect(periodosDelDia(FECHA, configs)).toEqual(periodosDelDia(FECHA, TURNOS_GENERALES));
  });
});

describe("construirRejillaCuartos", () => {
  it("día vacío: 13:00-16:00 da 12 cuartos (16:00 excluida), todos a 0 y con 170 libres", () => {
    const r = rejilla([]);
    const comida = r.franjas.filter((f) => f.turno === "comida");
    expect(comida.map((f) => f.hora)).toEqual([
      "13:00", "13:15", "13:30", "13:45",
      "14:00", "14:15", "14:30", "14:45",
      "15:00", "15:15", "15:30", "15:45",
    ]);
    for (const f of comida) {
      expect(f).toMatchObject({ llegan: 0, enSala: 0, restanteTurno: 170, origen: "turno", nivel: "libre" });
    }
    expect(r.franjas.filter((f) => f.turno === "cena")).toHaveLength(12);
    expect(r.franjas.at(-1)?.hora).toBe("22:45");
  });

  it("ignora la escalera: 13:15 sale aunque el motor solo ofreciera horas en punto", () => {
    expect(franja(rejilla([]), "13:15")).toBeDefined();
  });

  it("una reserva a las 13:10 llega en el cuarto de las 13:00", () => {
    const r = rejilla([reserva("13:10:00", 6)]);
    expect(franja(r, "13:00")).toMatchObject({ llegan: 6, reservasQueLlegan: 1, enSala: 6 });
    expect(franja(r, "13:15")).toMatchObject({ llegan: 0, enSala: 6 });
    expect(r.franjas.some((f) => f.hora === "13:10")).toBe(false);
  });

  it("solapes: 4 a las 13:00 con estancia 105 están sentados hasta las 14:30 y a las 14:45 ya no", () => {
    const r = rejilla([reserva("13:00", 4), reserva("14:00", 2)]);
    expect(franja(r, "13:00")).toMatchObject({ llegan: 4, enSala: 4 });
    expect(franja(r, "14:00")).toMatchObject({ llegan: 2, enSala: 6 });
    expect(franja(r, "14:30")).toMatchObject({ enSala: 6 });
    expect(franja(r, "14:45")).toMatchObject({ enSala: 2 });
    // El aforo del turno cuenta a todos, se levanten o no.
    expect(franja(r, "15:45")?.restanteTurno).toBe(164);
    expect(r.aforo.comida).toMatchObject({ ocupados: 6, capacidad: 170, cabe: true });
  });

  it("frontera de turno: una reserva a las 16:45 cuenta en comida (corte 17:00) con franja extra", () => {
    const r = rejilla([reserva("16:45", 5)]);
    const extra = franja(r, "16:45");
    expect(extra).toMatchObject({ turno: "comida", origen: "reserva", llegan: 5 });
    expect(r.aforo.comida.ocupados).toBe(5);
    expect(r.aforo.cena.ocupados).toBe(0);
    // Orden: la franja extra va entre la comida y la cena.
    const horas = r.franjas.map((f) => f.hora);
    expect(horas.indexOf("16:45")).toBe(horas.indexOf("15:45") + 1);
  });

  it("las canceladas y los no presentados no cuentan en nada", () => {
    const r = rejilla([
      reserva("13:00", 8, { estado: "cancelada" }),
      reserva("13:00", 3, { estado: "no_show" }),
      reserva("21:00", 10, { estado: "cancelada" }),
    ]);
    expect(franja(r, "13:00")).toMatchObject({ llegan: 0, enSala: 0, restanteTurno: 170 });
    expect(r.aforo.comida.ocupados).toBe(0);
    expect(r.franjas.every((f) => f.origen === "turno")).toBe(true);
  });

  it("'completada' está sentada pero ya no cuenta en el aforo (mismo criterio que el trigger)", () => {
    const r = rejilla([reserva("13:00", 4, { estado: "completada" })]);
    expect(franja(r, "13:00")).toMatchObject({ llegan: 4, enSala: 4, restanteTurno: 170 });
    expect(r.aforo.comida.ocupados).toBe(0);
  });

  it("excluirReservaId: la reserva que se edita no cuenta contra sí misma", () => {
    const r = rejilla([reserva("13:00", 4, { id: "yo" }), reserva("13:00", 2)], { excluirReservaId: "yo" });
    expect(franja(r, "13:00")).toMatchObject({ llegan: 2 });
    expect(r.aforo.comida.ocupados).toBe(2);
  });

  it("propuesta: una hora fuera de los turnos aparece como franja 'propuesta' y el grupo se prueba en su turno", () => {
    const r = rejilla([reserva("13:00", 160)], { propuesta: { hora: "17:30", comensales: 12 } });
    expect(franja(r, "17:30")).toMatchObject({ turno: "cena", origen: "propuesta", llegan: 0 });
    expect(r.aforo.cena).toMatchObject({ tras: 12, cabe: true });
    // En comida no se prueba porque la propuesta es de cena.
    expect(r.aforo.comida).toMatchObject({ ocupados: 160, tras: 160, cabe: true });
  });

  it("propuesta en un turno lleno: tras supera la capacidad y no cabe", () => {
    const r = rejilla([reserva("13:00", 160)], { propuesta: { hora: "14:00", comensales: 12 } });
    expect(r.aforo.comida).toMatchObject({ ocupados: 160, tras: 172, cabe: false });
    // 14:00 ya estaba en la rejilla: sigue siendo "turno".
    expect(franja(r, "14:00")?.origen).toBe("turno");
  });

  it("nivel por cuarto según los sentados frente al aforo del turno", () => {
    const r = rejilla([reserva("13:00", 130), reserva("13:30", 40)]);
    expect(franja(r, "13:00")?.nivel).toBe("justo");
    expect(franja(r, "13:30")?.nivel).toBe("lleno");
  });

  // Touza no admite reservas (decisión del dueño 2026-10-01): se retira el caso «Touza: su propia franja por
  // espacio y su propio aforo». La rejilla es siempre la de Casa Tomás (turnos generales, aforo 170).
});
