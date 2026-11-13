import { describe, expect, it } from "vitest";
import {
  clasificarMesasParaSentar,
  decidirSentarPrevista,
  estadoParaConfirmar,
  reemplazarMesasEnLista,
  textoDesplazamiento,
  type AsignacionConfirmar,
  type FilaAsignacionLocal,
} from "../confirmarMesa";
import { listaHoyMovil, textoMesaConfirmada, type MesaOpcion, type ReservaHoyMovil } from "../hoyMovil";

const asig = (mesa: string, reserva: string, hora: string, estado = "confirmada", nombre = reserva, salida: string | null = null): AsignacionConfirmar => ({
  mesa_id: mesa,
  reserva_id: reserva,
  reservas: { nombre, hora, estado, salida_at: salida, numero_comensales: 2 },
});

const mesa = (id: string, nombre: string, espacioId: string, plazas: number, salaNombre = espacioId === "c" ? "Comedor" : "Terraza"): MesaOpcion => ({
  id,
  nombre,
  espacioId,
  salaNombre,
  plazas,
});

describe("estadoParaConfirmar", () => {
  const ana = { id: "ana", hora: "21:00:00" };

  it("libre si nadie la usa en la franja de la reserva", () => {
    expect(estadoParaConfirmar([], "m7", ana)).toEqual({ tipo: "libre" });
    // Comida de las 13:30 (105 min): no pisa una cena de las 21:00.
    expect(estadoParaConfirmar([asig("m7", "x", "13:30:00", "completada")], "m7", ana)).toEqual({ tipo: "libre" });
    // Sus propias asignaciones no cuentan.
    expect(estadoParaConfirmar([asig("m7", "ana", "21:00:00")], "m7", ana)).toEqual({ tipo: "libre" });
  });

  it("ocupada si la pisa alguien sentado que no se ha ido", () => {
    expect(estadoParaConfirmar([asig("m7", "p", "20:30:00", "completada", "Pérez")], "m7", ana)).toEqual({
      tipo: "ocupada",
      nombre: "Pérez",
      hora: "20:30:00",
    });
  });

  it("libre si quien estaba sentado ya se fue, no vino o se canceló", () => {
    expect(estadoParaConfirmar([asig("m7", "p", "20:30:00", "completada", "Pérez", "2026-11-07T20:50:00Z")], "m7", ana).tipo).toBe("libre");
    expect(estadoParaConfirmar([asig("m7", "p", "20:30:00", "no_show")], "m7", ana).tipo).toBe("libre");
    expect(estadoParaConfirmar([asig("m7", "p", "20:30:00", "cancelada")], "m7", ana).tipo).toBe("libre");
  });

  it("prevista para otra reserva por llegar: a quién se le quita y con qué mesas se queda", () => {
    const lista = [asig("m7", "g", "21:30:00", "confirmada", "García"), asig("m8", "g", "21:30:00", "confirmada", "García")];
    expect(estadoParaConfirmar(lista, "m7", ana)).toEqual({
      tipo: "prevista",
      desplazadas: [{ reservaId: "g", nombre: "García", hora: "21:30:00", mesaIdsAntes: ["m7", "m8"], mesaIdsQuedan: ["m8"] }],
    });
  });

  it("sentado manda sobre previsto: si hay los dos, ocupada", () => {
    const lista = [asig("m7", "g", "21:30:00", "confirmada", "García"), asig("m7", "p", "20:00:00", "completada", "Pérez")];
    expect(estadoParaConfirmar(lista, "m7", ana).tipo).toBe("ocupada");
  });

  it("sin reserva (id vacío) a la hora de ahora", () => {
    expect(estadoParaConfirmar([asig("m7", "g", "21:30:00")], "m7", { id: "", hora: "20:10:00" }).tipo).toBe("prevista");
    expect(estadoParaConfirmar([asig("m7", "g", "23:30:00")], "m7", { id: "", hora: "20:10:00" }).tipo).toBe("libre");
  });
});

describe("clasificarMesasParaSentar", () => {
  const opciones = [
    mesa("m1", "1", "c", 2),
    mesa("m2", "2", "c", 6),
    mesa("m3", "3", "c", 4),
    mesa("m4", "4", "c", 4),
    mesa("m9", "9", "c", 4),
    mesa("t1", "T1", "t", 4),
    mesa("t2", "T2", "t", 2),
  ];
  const asignaciones = [
    asig("m3", "ana", "21:00:00", "confirmada", "Ana"),
    asig("m4", "g", "21:30:00", "confirmada", "García"),
    asig("m9", "p", "20:30:00", "completada", "Pérez"),
  ];

  const sel = clasificarMesasParaSentar({
    opciones,
    asignaciones,
    reserva: { id: "ana", hora: "21:00:00", comensales: 3, espacioId: "t" },
    propias: ["m3"],
    excluidas: new Set(["t2"]),
  });

  it("la prevista arriba, aparte", () => {
    expect(sel.propias.map((m) => [m.nombre, m.propia, m.estado.tipo])).toEqual([["3", true, "libre"]]);
  });

  it("por sala (la de la reserva primero), solo donde caben, libres → previstas → ocupadas y la más justa antes", () => {
    expect(sel.salas.map((s) => s.salaNombre)).toEqual(["Terraza", "Comedor"]);
    expect(sel.salas[0].mesas.map((m) => m.nombre)).toEqual(["T1"]);
    expect(sel.salas[1].mesas.map((m) => [m.nombre, m.estado.tipo])).toEqual([
      ["2", "libre"],
      ["4", "prevista"],
      ["9", "ocupada"],
    ]);
  });

  it("no ofrece mesas pequeñas ni excluidas", () => {
    const todas = sel.salas.flatMap((s) => s.mesas.map((m) => m.id));
    expect(todas).not.toContain("m1");
    expect(todas).not.toContain("t2");
  });
});

describe("textoDesplazamiento", () => {
  it("dice a quién se le quita y cómo se queda", () => {
    expect(
      textoDesplazamiento("7", [{ reservaId: "g", nombre: "García", hora: "21:30:00", mesaIdsAntes: ["m7"], mesaIdsQuedan: [] }]),
    ).toBe("La mesa 7 estaba prevista para García (21:30). García se quedará sin mesa prevista.");
    expect(
      textoDesplazamiento(
        "7",
        [{ reservaId: "g", nombre: "García", hora: "21:30:00", mesaIdsAntes: ["m7", "m8"], mesaIdsQuedan: ["m8"] }],
        (id) => id.slice(1),
      ),
    ).toBe("La mesa 7 estaba prevista para García (21:30). García sigue con la mesa 8.");
  });
});

describe("reemplazarMesasEnLista (cambio optimista)", () => {
  const fila = (reserva: string, mesaId: string): FilaAsignacionLocal => ({
    id: `${reserva}-${mesaId}`,
    reserva_id: reserva,
    mesa_id: mesaId,
    created_at: "x",
    reservas: { id: reserva, nombre: reserva, hora: "21:00:00", numero_comensales: 2, estado: "confirmada" },
    mesas: { id: mesaId, nombre: mesaId, capacidad: 4 },
  });
  const mesas = new Map([
    ["m7", { id: "m7", nombre: "7", capacidad: 4, espacio_id: "c" }],
    ["m9", { id: "m9", nombre: "9", capacidad: 4, espacio_id: "c" }],
  ]);

  it("la prevista queda libre al sentar en otra mesa", () => {
    const lista = [fila("ana", "m7"), fila("g", "m8")];
    const nueva = reemplazarMesasEnLista(lista, "ana", ["m9"], { mesas, ahora: "t" });
    expect(nueva.map((a) => `${a.reserva_id}:${a.mesa_id}`)).toEqual(["g:m8", "ana:m9"]);
    expect(nueva[1].mesas.nombre).toBe("9");
    expect(nueva[1].reservas.nombre).toBe("ana");
  });

  it("quitarle la mesa a otra (array vacío) y no inventar filas sin datos", () => {
    expect(reemplazarMesasEnLista([fila("g", "m7")], "g", [], { mesas })).toEqual([]);
    expect(reemplazarMesasEnLista([], "nueva", ["m7"], { mesas })).toEqual([]);
  });
});

describe("listaHoyMovil", () => {
  const r = (id: string, hora: string, estado: string): ReservaHoyMovil => ({
    id,
    nombre: id,
    hora,
    numero_comensales: 2,
    estado,
    espacio_id: "c",
  });
  const reservas = [
    r("tarde", "20:00:00", "confirmada"),
    r("ya", "21:05:00", "confirmada"),
    r("luego", "22:30:00", "pendiente"),
    r("antes", "21:45:00", "verificada"),
    r("sentada2", "21:00:00", "completada"),
    r("sentada1", "20:30:00", "completada"),
    r("novino", "20:00:00", "no_show"),
    r("cancel", "21:00:00", "cancelada"),
    r("comida", "14:00:00", "confirmada"),
  ];
  const l = listaHoyMovil(reservas, () => [], 21 * 60, { busqueda: "", filtroTurno: "cena" });

  it("llegan ahora arriba, el resto por llegar por hora (con «Tarde»), sentadas aparte; sin no-show; las anuladas, a su hora", () => {
    expect(l.llegan.map((f) => f.reserva.id)).toEqual(["ya"]);
    // 13/11/2026: la anulada («cancel», 21:00) sigue en «Por llegar», a su hora y sin «Tarde».
    expect(l.porLlegar.map((f) => [f.reserva.id, f.tarde])).toEqual([
      ["tarde", true],
      ["cancel", false],
      ["antes", false],
      ["luego", false],
    ]);
    expect(l.sentadas.map((f) => f.reserva.id)).toEqual(["sentada1", "sentada2"]);
  });
});

describe("decidirSentarPrevista (botón «Sentar · Mesa 7» de la fila)", () => {
  const ana = { id: "ana", hora: "21:00:00" };
  it("libre: sentar; sin mesa u ocupada por alguien sentado: elegir; pisada por otra por llegar: confirmar", () => {
    expect(decidirSentarPrevista([asig("m7", "ana", "21:00:00")], ana)).toEqual({ tipo: "sentar" });
    expect(decidirSentarPrevista([], ana)).toEqual({ tipo: "elegir" });
    expect(decidirSentarPrevista([asig("m7", "ana", "21:00:00"), asig("m7", "p", "20:30:00", "completada", "Pérez")], ana)).toEqual({ tipo: "elegir" });
    const d = decidirSentarPrevista([asig("m7", "ana", "21:00:00"), asig("m7", "g", "21:30:00", "confirmada", "García")], ana);
    expect(d.tipo).toBe("confirmar");
    expect(d.tipo === "confirmar" && d.desplazadas.map((x) => [x.reservaId, x.mesaIdsQuedan])).toEqual([["g", []]]);
  });
});

describe("textoMesaConfirmada", () => {
  it("prevista mientras no llega, confirmada al sentar", () => {
    expect(textoMesaConfirmada(["7"], false)).toBe("Prevista: Mesa 7");
    expect(textoMesaConfirmada(["9"], true)).toBe("En mesa 9");
    expect(textoMesaConfirmada(["4", "5"], true)).toBe("En mesas 4 + 5");
    expect(textoMesaConfirmada([], false)).toBe("Sin mesa");
  });
});
