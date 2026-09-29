/**
 * Tests de `src/lib/reservas/ventanaAsignacion.ts`: la lógica pura del panel
 * "Asignación" (Fase B de reservas-sin-salas).
 *
 * Las horas de las reservas son hora de Madrid. `ahora` se pasa siempre como
 * instante UTC fijo, así los tests no dependen de la zona del equipo que los
 * ejecuta. El 2026-10-01 Madrid está en verano (UTC+2).
 */
import { describe, it, expect } from "vitest";
import {
  VENTANA_HORAS_MAX,
  VENTANA_HORAS_MIN,
  VENTANA_HORAS_POR_DEFECTO,
  agruparPorTurnoYGrado,
  configAsignacionDesde,
  enVentana,
  excluirSala,
  fechaMadrid,
  incluirSala,
  instanteReserva,
  mesasIncoherentes,
  ordenarVentanaPrimero,
  sumarDias,
  ventanaHorasValida,
  type ReservaVentana,
} from "@/lib/reservas/ventanaAsignacion";

/** 2026-10-01 10:00 en Madrid (08:00 UTC). */
const AHORA = Date.UTC(2026, 9, 1, 8, 0);

const reserva = (over: Partial<ReservaVentana> & { reserva_id: string }): ReservaVentana => ({
  fecha: "2026-10-01",
  hora: "13:00:00",
  turno: "comida",
  estado: "confirmada",
  grado: "sin_sala",
  numero_comensales: 2,
  ...over,
});

describe("instanteReserva", () => {
  it("interpreta fecha y hora como hora de Madrid (verano, UTC+2)", () => {
    expect(instanteReserva("2026-10-01", "13:00:00")).toBe(Date.UTC(2026, 9, 1, 11, 0));
  });

  it("interpreta fecha y hora como hora de Madrid (invierno, UTC+1)", () => {
    expect(instanteReserva("2026-12-15", "21:30")).toBe(Date.UTC(2026, 11, 15, 20, 30));
  });

  it("devuelve null con datos que no se pueden leer", () => {
    expect(instanteReserva("", "13:00")).toBeNull();
    expect(instanteReserva("2026-10-01", "")).toBeNull();
    expect(instanteReserva("no-fecha", "13:00")).toBeNull();
  });
});

describe("enVentana", () => {
  it("una reserva a 3 h vista entra en la ventana de 48 h", () => {
    const r = reserva({ reserva_id: "a", fecha: "2026-10-01", hora: "13:00:00" });
    expect(enVentana(r, 48, AHORA)).toBe(true);
  });

  it("una reserva a 5 días queda fuera de la ventana de 48 h", () => {
    const r = reserva({ reserva_id: "b", fecha: "2026-10-06", hora: "13:00:00" });
    expect(enVentana(r, 48, AHORA)).toBe(false);
  });

  it("el borde de la ventana cuenta como dentro", () => {
    // 10:00 + 48 h = 2026-10-03 10:00 Madrid.
    expect(enVentana(reserva({ reserva_id: "c", fecha: "2026-10-03", hora: "10:00" }), 48, AHORA)).toBe(true);
    expect(enVentana(reserva({ reserva_id: "d", fecha: "2026-10-03", hora: "10:15" }), 48, AHORA)).toBe(false);
  });

  it("una reserva ya pasada no está en la ventana", () => {
    expect(enVentana(reserva({ reserva_id: "e", fecha: "2026-10-01", hora: "09:00" }), 48, AHORA)).toBe(false);
  });

  it("una reserva cancelada nunca está en la ventana", () => {
    const r = reserva({ reserva_id: "f", estado: "cancelada" });
    expect(enVentana(r, 48, AHORA)).toBe(false);
  });

  it("la ventana es configurable (N = 2 h)", () => {
    const r = reserva({ reserva_id: "g", fecha: "2026-10-01", hora: "13:00" });
    expect(enVentana(r, 2, AHORA)).toBe(false);
    expect(enVentana(r, 3, AHORA)).toBe(true);
  });
});

describe("ordenarVentanaPrimero", () => {
  it("separa la ventana del resto, cada parte por fecha y hora", () => {
    const reservas = [
      reserva({ reserva_id: "lejos", fecha: "2026-10-06", hora: "21:00" }),
      reserva({ reserva_id: "manana", fecha: "2026-10-02", hora: "21:00", turno: "cena" }),
      reserva({ reserva_id: "hoy", fecha: "2026-10-01", hora: "13:00" }),
      reserva({ reserva_id: "medio", fecha: "2026-10-04", hora: "13:00" }),
    ];
    const { enVentana: dentro, despues } = ordenarVentanaPrimero(reservas, 48, AHORA);
    expect(dentro.map((r) => r.reserva_id)).toEqual(["hoy", "manana"]);
    expect(despues.map((r) => r.reserva_id)).toEqual(["medio", "lejos"]);
  });

  it("deja fuera las canceladas y las que ya han pasado", () => {
    const reservas = [
      reserva({ reserva_id: "cancelada", estado: "cancelada" }),
      reserva({ reserva_id: "pasada", hora: "09:00" }),
      reserva({ reserva_id: "completada", estado: "completada" }),
      reserva({ reserva_id: "ok" }),
    ];
    const { enVentana: dentro, despues } = ordenarVentanaPrimero(reservas, 48, AHORA);
    expect(dentro.map((r) => r.reserva_id)).toEqual(["ok"]);
    expect(despues).toEqual([]);
  });

  it("una reserva creada con menos de N horas aparece directamente en la ventana", () => {
    const tardia = reserva({ reserva_id: "tardia", fecha: "2026-10-01", hora: "13:00", grado: "sin_sala" });
    expect(ordenarVentanaPrimero([tardia], 48, AHORA).enVentana).toHaveLength(1);
  });
});

describe("agruparPorTurnoYGrado", () => {
  it("agrupa por día y turno, y dentro por grado en orden sin_sala → sin_mesa → con_mesa", () => {
    const grupos = agruparPorTurnoYGrado([
      reserva({ reserva_id: "1", hora: "13:00", grado: "con_mesa", numero_comensales: 4 }),
      reserva({ reserva_id: "2", hora: "14:00", grado: "sin_sala", numero_comensales: 2 }),
      reserva({ reserva_id: "3", hora: "21:00", turno: "cena", grado: "sin_mesa", numero_comensales: 6 }),
      reserva({ reserva_id: "4", hora: "13:30", grado: "sin_sala", numero_comensales: 3 }),
    ]);

    expect(grupos.map((g) => `${g.fecha}|${g.turno}`)).toEqual(["2026-10-01|comida", "2026-10-01|cena"]);
    expect(grupos[0].grados.map((g) => g.grado)).toEqual(["sin_sala", "con_mesa"]);
    expect(grupos[0].grados[0].reservas.map((r) => r.reserva_id)).toEqual(["4", "2"]);
    expect(grupos[0].comensales).toBe(9);
    expect(grupos[0].pendientes).toBe(2);
    expect(grupos[1].grados.map((g) => g.grado)).toEqual(["sin_mesa"]);
  });

  it("deduce el turno de la hora si la fila no lo trae (corte a las 17:00)", () => {
    const grupos = agruparPorTurnoYGrado([
      reserva({ reserva_id: "x", hora: "16:45", turno: undefined }),
      reserva({ reserva_id: "y", hora: "17:00", turno: undefined }),
    ]);
    expect(grupos.map((g) => g.turno)).toEqual(["comida", "cena"]);
  });
});

describe("configAsignacionDesde", () => {
  it("aplica los valores por defecto si faltan las columnas", () => {
    expect(configAsignacionDesde(null)).toEqual({
      ventanaHoras: VENTANA_HORAS_POR_DEFECTO,
      avisoActivo: true,
      espaciosExcluidos: [],
      mesasExcluidas: [],
    });
    expect(configAsignacionDesde({ asignacion_ventana_horas: null })).toMatchObject({ ventanaHoras: 48 });
  });

  it("respeta los valores guardados", () => {
    expect(
      configAsignacionDesde({
        asignacion_ventana_horas: 24,
        asignacion_aviso_activo: false,
        asignacion_espacios_excluidos: ["s1"],
        asignacion_mesas_excluidas: ["m1"],
      }),
    ).toEqual({ ventanaHoras: 24, avisoActivo: false, espaciosExcluidos: ["s1"], mesasExcluidas: ["m1"] });
  });
});

describe("ventanaHorasValida", () => {
  it("acepta de 1 a 168 horas enteras", () => {
    expect(VENTANA_HORAS_MIN).toBe(1);
    expect(VENTANA_HORAS_MAX).toBe(168);
    expect(ventanaHorasValida(1)).toBe(true);
    expect(ventanaHorasValida(48)).toBe(true);
    expect(ventanaHorasValida(168)).toBe(true);
  });

  it("rechaza 0, 169, vacío y decimales", () => {
    expect(ventanaHorasValida(0)).toBe(false);
    expect(ventanaHorasValida(169)).toBe(false);
    expect(ventanaHorasValida(200)).toBe(false);
    expect(ventanaHorasValida(Number.NaN)).toBe(false);
    expect(ventanaHorasValida(12.5)).toBe(false);
  });
});

describe("salas y mesas usables", () => {
  const MESAS = [
    { id: "m1", espacio_id: "terraza" },
    { id: "m2", espacio_id: "terraza" },
    { id: "m3", espacio_id: "comedor" },
  ];

  it("una mesa usable de una sala no usable es incoherente", () => {
    expect(mesasIncoherentes({ espaciosExcluidos: ["terraza"], mesasExcluidas: ["m1"] }, MESAS)).toEqual(["m2"]);
    expect(mesasIncoherentes({ espaciosExcluidos: ["terraza"], mesasExcluidas: ["m1", "m2"] }, MESAS)).toEqual([]);
    expect(mesasIncoherentes({ espaciosExcluidos: [], mesasExcluidas: ["m3"] }, MESAS)).toEqual([]);
  });

  it("excluir una sala excluye también sus mesas", () => {
    expect(excluirSala({ espaciosExcluidos: [], mesasExcluidas: ["m3"] }, "terraza", MESAS)).toEqual({
      espaciosExcluidos: ["terraza"],
      mesasExcluidas: ["m3", "m1", "m2"],
    });
  });

  it("volver a usar una sala vuelve a usar sus mesas", () => {
    expect(
      incluirSala({ espaciosExcluidos: ["terraza"], mesasExcluidas: ["m1", "m2", "m3"] }, "terraza", MESAS),
    ).toEqual({ espaciosExcluidos: [], mesasExcluidas: ["m3"] });
  });
});

describe("fechas de Madrid", () => {
  it("fechaMadrid da el día de Madrid, no el UTC", () => {
    // 23:30 UTC del 1 de octubre = 01:30 del 2 en Madrid.
    expect(fechaMadrid(Date.UTC(2026, 9, 1, 23, 30))).toBe("2026-10-02");
    expect(fechaMadrid(AHORA)).toBe("2026-10-01");
  });

  it("sumarDias cruza meses", () => {
    expect(sumarDias("2026-10-30", 3)).toBe("2026-11-02");
  });
});
