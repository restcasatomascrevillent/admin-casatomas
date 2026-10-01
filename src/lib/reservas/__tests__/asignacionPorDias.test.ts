/**
 * Tests de `src/lib/reservas/asignacionPorDias.ts`: la lógica pura de la pantalla «Asignación»
 * organizada en PESTAÑAS POR DÍA (qué días hay, qué cuenta cada insignia, qué día se abre por
 * defecto y qué lleva cada día).
 *
 * Las horas de las reservas son hora de Madrid. `ahora` se pasa siempre como instante UTC fijo, así
 * los tests no dependen de la zona del equipo. El jueves 2026-10-01 Madrid está en verano (UTC+2).
 */
import { describe, it, expect } from "vitest";
import {
  agruparPorFecha,
  construirDia,
  diaEnVentana,
  diaPorDefecto,
  diasDelRango,
  etiquetasDia,
  resolverDiaActivo,
  reservasPorVenir,
  resumirPestanas,
} from "@/lib/reservas/asignacionPorDias";
import { ordenarVentanaPrimero, type ReservaVentana } from "@/lib/reservas/ventanaAsignacion";

/** Jueves 2026-10-01 10:00 en Madrid (08:00 UTC). */
const AHORA = Date.UTC(2026, 9, 1, 8, 0);
const HOY = "2026-10-01";

const reserva = (id: string, over: Partial<ReservaVentana> = {}): ReservaVentana => ({
  reserva_id: id,
  fecha: HOY,
  hora: "13:00:00",
  estado: "confirmada",
  grado: "sin_sala",
  numero_comensales: 2,
  ...over,
});

describe("diasDelRango", () => {
  it("devuelve todos los días, desde y hasta incluidos", () => {
    expect(diasDelRango("2026-10-01", "2026-10-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("cruza el cambio de mes", () => {
    expect(diasDelRango("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("un solo día cuando desde y hasta coinciden", () => {
    expect(diasDelRango("2026-10-01", "2026-10-01")).toEqual(["2026-10-01"]);
  });

  it("vacío si el rango está al revés o no se puede leer", () => {
    expect(diasDelRango("2026-10-05", "2026-10-01")).toEqual([]);
    expect(diasDelRango("", "2026-10-01")).toEqual([]);
    expect(diasDelRango("2026-10-01", "")).toEqual([]);
  });

  it("14 días elegidos en «Mostrar» = hoy más 14 (los mismos que pide la consulta)", () => {
    const dias = diasDelRango("2026-10-01", "2026-10-15");
    expect(dias).toHaveLength(15);
    expect(dias[0]).toBe("2026-10-01");
    expect(dias[14]).toBe("2026-10-15");
  });
});

describe("etiquetasDia", () => {
  it("hoy y mañana llevan su nombre", () => {
    expect(etiquetasDia("2026-10-01", HOY)).toMatchObject({ corta: "Hoy", titulo: "Hoy · jueves 1 de octubre" });
    expect(etiquetasDia("2026-10-02", HOY)).toMatchObject({ corta: "Mañana", titulo: "Mañana · viernes 2 de octubre" });
  });

  it("el resto: día de la semana abreviado y número, con mayúscula inicial", () => {
    expect(etiquetasDia("2026-10-03", HOY)).toMatchObject({ corta: "Sáb 3", titulo: "Sábado 3 de octubre" });
    expect(etiquetasDia("2026-10-07", HOY)).toMatchObject({ corta: "Mié 7", titulo: "Miércoles 7 de octubre" });
  });

  it("el día 1 de un mes lleva el mes, para no confundir «Dom 1» con el de este mes", () => {
    expect(etiquetasDia("2026-11-01", HOY).corta).toBe("Dom 1 nov");
  });

  it("marca hoy y mañana", () => {
    expect(etiquetasDia("2026-10-01", HOY)).toMatchObject({ esHoy: true, esManana: false });
    expect(etiquetasDia("2026-10-02", HOY)).toMatchObject({ esHoy: false, esManana: true });
    expect(etiquetasDia("2026-10-03", HOY)).toMatchObject({ esHoy: false, esManana: false });
  });
});

describe("diaEnVentana", () => {
  it("con 48 h desde el jueves por la mañana: jueves, viernes y sábado entran; el domingo no", () => {
    expect(diaEnVentana("2026-10-01", 48, AHORA)).toBe(true);
    expect(diaEnVentana("2026-10-02", 48, AHORA)).toBe(true);
    expect(diaEnVentana("2026-10-03", 48, AHORA)).toBe(true);
    expect(diaEnVentana("2026-10-04", 48, AHORA)).toBe(false);
  });

  it("con 24 h solo entran hoy y mañana", () => {
    expect(diaEnVentana("2026-10-02", 24, AHORA)).toBe(true);
    expect(diaEnVentana("2026-10-03", 24, AHORA)).toBe(false);
  });

  it("un día anterior a hoy no está en la ventana", () => {
    expect(diaEnVentana("2026-09-30", 48, AHORA)).toBe(false);
  });

  it("respeta el cambio de hora de Madrid (el 25-oct-2026 dura 25 h)", () => {
    // Sábado 24-oct 23:00 Madrid (CEST) = 21:00 UTC. 48 h después ya es lunes 26 a las 22:00 (CET).
    const sabadoNoche = Date.UTC(2026, 9, 24, 21, 0);
    expect(diaEnVentana("2026-10-26", 48, sabadoNoche)).toBe(true);
    expect(diaEnVentana("2026-10-27", 48, sabadoNoche)).toBe(false);
  });
});

describe("reservasPorVenir", () => {
  it("deja fuera las que no ocupan sitio (canceladas, no vino, llegó...)", () => {
    const filas = [
      reserva("viva"),
      reserva("cancelada", { estado: "cancelada" }),
      reserva("no_show", { estado: "no_show" }),
      reserva("completada", { estado: "completada" }),
    ];
    expect(reservasPorVenir(filas, AHORA).map((r) => r.reserva_id)).toEqual(["viva"]);
  });

  it("las pendientes y las verificadas también cuentan", () => {
    const filas = [reserva("p", { estado: "pendiente" }), reserva("v", { estado: "verificada" })];
    expect(reservasPorVenir(filas, AHORA)).toHaveLength(2);
  });

  it("deja fuera lo de hoy que ya ha empezado y conserva lo que empieza justo ahora", () => {
    const filas = [
      reserva("pasada", { hora: "09:59:00" }),
      reserva("ahora_mismo", { hora: "10:00:00" }),
      reserva("luego", { hora: "10:01:00" }),
    ];
    expect(reservasPorVenir(filas, AHORA).map((r) => r.reserva_id)).toEqual(["ahora_mismo", "luego"]);
  });

  it("conserva los días siguientes y descarta los anteriores a hoy", () => {
    const filas = [
      reserva("ayer", { fecha: "2026-09-30" }),
      reserva("manana", { fecha: "2026-10-02", hora: "08:00:00" }),
      reserva("lejos", { fecha: "2026-10-20" }),
    ];
    expect(reservasPorVenir(filas, AHORA).map((r) => r.reserva_id)).toEqual(["manana", "lejos"]);
  });

  it("deja fuera lo que no se puede leer (fecha u hora rotas)", () => {
    const filas = [
      reserva("sin_hora", { fecha: "2026-10-05", hora: "" }),
      reserva("sin_fecha", { fecha: "" }),
      reserva("buena", { fecha: "2026-10-05" }),
    ];
    expect(reservasPorVenir(filas, AHORA).map((r) => r.reserva_id)).toEqual(["buena"]);
  });

  it("coincide con lo que dejaba la pantalla anterior (ventana + más adelante)", () => {
    const filas: ReservaVentana[] = [];
    const horas = ["09:00:00", "10:00:00", "13:00:00", "21:30:00"];
    const estados = ["confirmada", "pendiente", "cancelada", "verificada", "no_show"];
    let n = 0;
    for (let d = -2; d < 20; d++) {
      const fecha = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10);
      for (const hora of horas) filas.push(reserva(`r${n}`, { fecha, hora, estado: estados[n++ % estados.length] }));
    }
    const antes = ordenarVentanaPrimero(filas, 48, AHORA);
    const esperado = [...antes.enVentana, ...antes.despues].map((r) => r.reserva_id).sort();
    expect(reservasPorVenir(filas, AHORA).map((r) => r.reserva_id).sort()).toEqual(esperado);
  });
});

describe("agruparPorFecha", () => {
  it("reparte las reservas por día conservando el orden de entrada", () => {
    const filas = [
      reserva("a", { fecha: "2026-10-02" }),
      reserva("b", { fecha: "2026-10-01" }),
      reserva("c", { fecha: "2026-10-02" }),
    ];
    const mapa = agruparPorFecha(filas);
    expect([...mapa.keys()].sort()).toEqual(["2026-10-01", "2026-10-02"]);
    expect(mapa.get("2026-10-02")!.map((r) => r.reserva_id)).toEqual(["a", "c"]);
    expect(mapa.get("2026-10-01")!.map((r) => r.reserva_id)).toEqual(["b"]);
  });
});

describe("resumirPestanas", () => {
  const dias = diasDelRango("2026-10-01", "2026-10-06");
  const opciones = { dias, ventanaHoras: 48, ahora: AHORA };

  it("devuelve una pestaña por día, en orden, también los días sin reservas", () => {
    const res = resumirPestanas([], opciones);
    expect(res.map((d) => d.fecha)).toEqual(dias);
    expect(res.every((d) => d.reservas === 0 && d.sinMesa === 0)).toBe(true);
  });

  it("la insignia cuenta las reservas SIN mesa: sin sala + con sala sin mesa; las con mesa no", () => {
    const filas = [
      reserva("a", { fecha: "2026-10-02", grado: "sin_sala" }),
      reserva("b", { fecha: "2026-10-02", grado: "sin_mesa" }),
      reserva("c", { fecha: "2026-10-02", grado: "con_mesa" }),
      reserva("d", { fecha: "2026-10-03", grado: "con_mesa" }),
    ];
    const res = resumirPestanas(filas, opciones);
    expect(res.find((d) => d.fecha === "2026-10-02")).toMatchObject({ reservas: 3, sinMesa: 2 });
    // Todo con mesa: hay reservas y ninguna pendiente («todo asignado»).
    expect(res.find((d) => d.fecha === "2026-10-03")).toMatchObject({ reservas: 1, sinMesa: 0 });
    // Sin reservas no es lo mismo que «todo asignado».
    expect(res.find((d) => d.fecha === "2026-10-05")).toMatchObject({ reservas: 0, sinMesa: 0 });
  });

  it("marca los días de la ventana de 48 h frente a los posteriores", () => {
    const res = resumirPestanas([], opciones);
    expect(res.map((d) => d.enVentana)).toEqual([true, true, true, false, false, false]);
  });

  it("ignora las reservas de fuera del rango", () => {
    const filas = [reserva("lejos", { fecha: "2026-12-24" })];
    expect(resumirPestanas(filas, opciones).reduce((s, d) => s + d.reservas, 0)).toBe(0);
  });
});

describe("diaPorDefecto", () => {
  const dias = diasDelRango("2026-10-01", "2026-10-06");
  const resumen = (filas: ReservaVentana[]) => resumirPestanas(filas, { dias, ventanaHoras: 48, ahora: AHORA });

  it("es el primer día que tiene reservas sin mesa", () => {
    const filas = [
      reserva("a", { fecha: "2026-10-01", grado: "con_mesa" }),
      reserva("b", { fecha: "2026-10-03", grado: "sin_mesa" }),
      reserva("c", { fecha: "2026-10-05", grado: "sin_sala" }),
    ];
    expect(diaPorDefecto(resumen(filas), HOY)).toBe("2026-10-03");
  });

  it("si hoy ya tiene pendientes, es hoy", () => {
    const filas = [reserva("a", { fecha: "2026-10-01", hora: "21:00:00" }), reserva("b", { fecha: "2026-10-02" })];
    expect(diaPorDefecto(resumen(filas), HOY)).toBe("2026-10-01");
  });

  it("sin ninguna pendiente (o sin reservas), es hoy", () => {
    expect(diaPorDefecto(resumen([]), HOY)).toBe(HOY);
    expect(diaPorDefecto(resumen([reserva("a", { fecha: "2026-10-04", grado: "con_mesa" })]), HOY)).toBe(HOY);
  });
});

describe("resolverDiaActivo", () => {
  const dias = ["2026-10-01", "2026-10-02", "2026-10-03"];

  it("respeta el día elegido si sigue existiendo", () => {
    expect(resolverDiaActivo({ dias, elegido: "2026-10-03", porDefecto: "2026-10-01" })).toBe("2026-10-03");
  });

  it("si el día elegido ya no está en el rango, vuelve al de por defecto", () => {
    expect(resolverDiaActivo({ dias, elegido: "2026-10-12", porDefecto: "2026-10-02" })).toBe("2026-10-02");
  });

  it("sin elección, el de por defecto", () => {
    expect(resolverDiaActivo({ dias, elegido: null, porDefecto: "2026-10-02" })).toBe("2026-10-02");
    expect(resolverDiaActivo({ dias, elegido: undefined, porDefecto: "2026-10-02" })).toBe("2026-10-02");
  });
});

describe("construirDia", () => {
  const filas = [
    reserva("c1", { hora: "13:00:00", grado: "con_mesa", numero_comensales: 4 }),
    reserva("c2", { hora: "14:00:00", grado: "sin_mesa", numero_comensales: 2 }),
    reserva("n1", { hora: "21:00:00", grado: "sin_sala", numero_comensales: 6 }),
    reserva("n2", { hora: "21:30:00", grado: "con_mesa", numero_comensales: 3 }),
    reserva("n3", { hora: "22:00:00", grado: "sin_sala", numero_comensales: 5 }),
  ];

  it("resume el día entero y cada turno: reservas, comensales y sin mesa", () => {
    const dia = construirDia(filas, { fecha: HOY, soloPendientes: false });
    expect(dia).toMatchObject({ fecha: HOY, reservas: 5, comensales: 20, sinMesa: 3, ocultas: 0, hayReservas: true });
    expect(dia.porTurno.comida).toEqual({ reservas: 2, comensales: 6, sinMesa: 1, ocultas: 0 });
    expect(dia.porTurno.cena).toEqual({ reservas: 3, comensales: 14, sinMesa: 2, ocultas: 0 });
  });

  it("lleva los turnos en orden (comida, cena) con sus subgrupos por grado", () => {
    const dia = construirDia(filas, { fecha: HOY, soloPendientes: false });
    expect(dia.turnos.map((t) => t.turno)).toEqual(["comida", "cena"]);
    expect(dia.turnos[1].grados.map((g) => [g.grado, g.reservas.length])).toEqual([
      ["sin_sala", 2],
      ["con_mesa", 1],
    ]);
  });

  it("no inventa un turno si el día no tiene reservas en él", () => {
    const dia = construirDia([filas[2]], { fecha: HOY, soloPendientes: false });
    expect(dia.turnos.map((t) => t.turno)).toEqual(["cena"]);
    expect(dia.porTurno.comida).toEqual({ reservas: 0, comensales: 0, sinMesa: 0, ocultas: 0 });
  });

  it("«Ocultar las que ya tienen mesa» quita las con mesa de las listas Y de los totales, y dice cuántas oculta", () => {
    const dia = construirDia(filas, { fecha: HOY, soloPendientes: true });
    expect(dia).toMatchObject({ reservas: 3, comensales: 13, sinMesa: 3, ocultas: 2, hayReservas: true });
    expect(dia.porTurno.comida).toEqual({ reservas: 1, comensales: 2, sinMesa: 1, ocultas: 1 });
    expect(dia.porTurno.cena).toEqual({ reservas: 2, comensales: 11, sinMesa: 2, ocultas: 1 });
    expect(dia.turnos.flatMap((t) => t.grados.map((g) => g.grado))).not.toContain("con_mesa");
  });

  it("lo que cuenta la insignia (sin mesa) no cambia con el interruptor", () => {
    const sin = construirDia(filas, { fecha: HOY, soloPendientes: false });
    const con = construirDia(filas, { fecha: HOY, soloPendientes: true });
    expect(con.sinMesa).toBe(sin.sinMesa);
  });

  it("todo con mesa + interruptor: no hay nada que listar pero el día NO está vacío", () => {
    const todas = [reserva("a", { grado: "con_mesa" }), reserva("b", { grado: "con_mesa", hora: "21:00:00" })];
    const dia = construirDia(todas, { fecha: HOY, soloPendientes: true });
    expect(dia).toMatchObject({ reservas: 0, comensales: 0, sinMesa: 0, ocultas: 2, hayReservas: true });
    expect(dia.turnos).toEqual([]);
  });

  it("un día sin reservas está vacío", () => {
    const dia = construirDia([], { fecha: "2026-10-05", soloPendientes: false });
    expect(dia).toMatchObject({ reservas: 0, comensales: 0, sinMesa: 0, ocultas: 0, hayReservas: false, turnos: [] });
  });

  it("usa el turno que trae la fila y, si falta, lo deduce de la hora (corte a las 17:00)", () => {
    const dia = construirDia(
      [
        reserva("a", { hora: "16:59:00" }),
        reserva("b", { hora: "17:00:00" }),
        reserva("c", { hora: "13:00:00", turno: "cena" }),
      ],
      { fecha: HOY, soloPendientes: false },
    );
    expect(dia.porTurno.comida.reservas).toBe(1);
    expect(dia.porTurno.cena.reservas).toBe(2);
  });
});
