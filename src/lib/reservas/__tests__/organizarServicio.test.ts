import { describe, expect, it } from "vitest";
import {
  ajustesPropuestos,
  deLaSala,
  disposicionPropuesta,
  mesasQueCambian,
  organizarServicio,
  type EntradaOrg,
  type ReservaOrg,
  type SalaOrg,
} from "../organizarServicio";
import type { FilaMesaSala } from "../sentarAhora";

const SALAS: SalaOrg[] = [
  { id: "C", nombre: "Comedor", terraza: false },
  { id: "S", nombre: "Salón", terraza: false },
  { id: "T", nombre: "Terraza", terraza: true },
];

const pieza = (sala: string, nombre: string, piezas: number, extra: Partial<FilaMesaSala> = {}): FilaMesaSala => ({
  id: `${sala}${nombre}`,
  nombre,
  espacio_id: sala,
  capacidad: piezas * 2 + (extra.picos_base ?? 0),
  forma: "rectangular",
  ancho: piezas * 55,
  alto: 70,
  pos_x: 0,
  pos_y: 0,
  piezas,
  picos_base: 0,
  picos_max: 1,
  piezas_max: piezas,
  grupo_piezas: null,
  ...extra,
});
const redonda = (sala: string, nombre: string, plazas: number): FilaMesaSala => ({
  id: `${sala}${nombre}`, nombre, espacio_id: sala, capacidad: plazas, forma: "circular", ancho: 150, alto: 150, pos_x: 5, pos_y: 5, piezas: null,
});
const sitio = (nombre: string, x: number, y: number): FilaMesaSala => ({
  id: `T${nombre}`, nombre, espacio_id: "T", capacidad: 4, forma: "rectangular", ancho: 65, alto: 65,
  pos_x: x, pos_y: y, piezas: null, plazas_min: 2, plazas_max: 6, grupo_piezas: "terraza",
});
const res = (id: string, comensales: number, hora: string, mesaIds: string[] = [], extra: Partial<ReservaOrg> = {}): ReservaOrg => ({
  id, nombre: id, hora, comensales, estado: "confirmada", importante: false,
  espacioId: mesaIds[0]?.[0] ?? null, mesaIds, ...extra,
});
const entrada = (mesas: FilaMesaSala[], reservas: ReservaOrg[], extra: Partial<EntradaOrg> = {}): EntradaOrg => ({
  salas: SALAS, mesas, ajustes: [], reservas, ...extra,
});

describe("organizarServicio", () => {
  it("grupo de 7 sin redonda: a la mesa larga con pico, no a la redonda de 6", () => {
    const mesas = [
      pieza("C", "3", 2),
      pieza("C", "4", 3, { picos_base: 1 }),
      redonda("S", "5", 6),
    ];
    const r = organizarServicio(entrada(mesas, [res("Grupo", 7, "21:00:00"), res("Pareja", 2, "21:30:00")]));
    const grupo = r.movimientos.find((m) => m.reservaId === "Grupo")!;
    expect(grupo.hacia.mesaNombres).toEqual(["4"]);
    const pareja = r.movimientos.find((m) => m.reservaId === "Pareja")!;
    // La pareja no va a la redonda de 6 teniendo la 3.
    expect(pareja.hacia.mesaNombres).toEqual(["3"]);
    expect(r.sinSitio).toEqual([]);
  });

  it("si hace falta, pasa una pieza y pone pico (y lo dice)", () => {
    const mesas = [
      pieza("C", "3", 2, { piezas_max: 3, grupo_piezas: "g" }),
      pieza("C", "4", 3, { picos_base: 1, grupo_piezas: "g", pos_y: 1.5 }),
    ];
    const r = organizarServicio(entrada(mesas, [res("Ana", 4, "14:00:00", ["C4"]), res("Grupo", 7, "14:30:00")]));
    const grupo = r.movimientos.find((m) => m.reservaId === "Grupo");
    // La 4 (7 plazas) se la queda el grupo; Ana (ya asignada a la 4) no debería moverse si hay otra
    // forma: la 3 crece con una pieza de la 4 cuando Ana sigue en la 4… pero Ana necesita 2 piezas.
    expect(grupo).toBeDefined();
    expect(r.sinSitio).toEqual([]);
    expect(grupo!.texto).toMatch(/Grupo \(7 p\., 14:30\) → la (3|4) del Comedor/);
  });

  it("reasignación de Pepito con frase clara", () => {
    const mesas = [pieza("C", "4", 3, { picos_base: 1 }), pieza("S", "5", 2)];
    const r = organizarServicio(entrada(mesas, [res("Pepito", 4, "21:00:00", ["C4"]), res("Grupo", 7, "21:00:00")]));
    expect(r.plan).toBe("completo");
    const pepito = r.movimientos.find((m) => m.reservaId === "Pepito")!;
    expect(pepito.texto).toBe("Pepito (4 p., 21:00) pasa de la 4 del Comedor a la 5 del Salón");
    expect(r.movimientos.find((m) => m.reservaId === "Grupo")!.hacia.mesaNombres).toEqual(["4"]);
    expect(r.resumen).toBe("2 cambios");
  });

  it("mesa fijada (07/11/2026): Pepito no se mueve aunque convenga y su mesa no se da al grupo", () => {
    const mesas = [pieza("C", "4", 3, { picos_base: 1 }), pieza("S", "5", 2)];
    const r = organizarServicio(
      entrada(mesas, [res("Pepito", 4, "21:00:00", ["C4"], { fijada: true }), res("Grupo", 7, "21:00:00")]),
    );
    expect(r.movimientos.find((m) => m.reservaId === "Pepito")).toBeUndefined();
    expect(r.movimientos.flatMap((m) => m.hacia.mesaIds)).not.toContain("C4");
  });

  it("mesa fijada en la terraza cerrada: se queda", () => {
    const mesas = [sitio("1", 0, 0), pieza("C", "3", 2)];
    const r = organizarServicio(entrada(mesas, [res("Luis", 4, "21:00:00", ["T1"], { fijada: true })], { terrazaCerrada: true }));
    expect(r.movimientos).toHaveLength(0);
  });

  it("terraza cerrada: no asigna nada ahí y recoloca lo que tenía", () => {
    const mesas = [sitio("1", 0, 0), sitio("2", 1.8, 0), pieza("C", "3", 2)];
    const r = organizarServicio(entrada(mesas, [res("Luis", 4, "21:00:00", ["T1"])], { terrazaCerrada: true }));
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0].texto).toBe("Luis (4 p., 21:00) pasa de la 1 de la Terraza a la 3 del Comedor");
    const abierta = organizarServicio(entrada(mesas, [res("Luis", 4, "21:00:00", ["T1"])]));
    expect(abierta.yaOrganizado).toBe(true);
    expect(abierta.resumen).toBe("Ya está bien organizado");
  });

  it("terraza flexible: un grupo de 7 junta dos sitios", () => {
    const mesas = [sitio("1", 0, 0), sitio("2", 1.8, 0), sitio("3", 0, 1.8), pieza("C", "3", 2)];
    const r = organizarServicio(entrada(mesas, [res("Boda", 7, "14:00:00")]));
    expect(r.movimientos[0].hacia.salaNombre).toBe("Terraza");
    expect(r.movimientos[0].hacia.mesaIds).toHaveLength(2);
    expect(r.movimientos[0].detalle).toMatch(/^junta la/);
  });

  it("no dobla mesas: una reserva por mesa aunque las horas no se pisen", () => {
    const mesas = [pieza("C", "1", 1)];
    const r = organizarServicio(entrada(mesas, [res("A", 2, "13:00:00"), res("B", 2, "16:30:00")]));
    expect(r.movimientos).toHaveLength(1);
    expect(r.sinSitio).toHaveLength(1);
    expect(r.sinSitio[0].motivo).toBe("No queda mesa libre para 2");
  });

  it("sentadas y «No vino» no se tocan; con el servicio empezado, tampoco las inminentes", () => {
    const mesas = [pieza("C", "4", 3, { picos_base: 1 }), pieza("C", "2", 1), pieza("S", "5", 2)];
    const reservas = [
      res("Sentada", 2, "14:00:00", ["C4"], { estado: "completada" }),
      res("Llega", 2, "14:20:00", ["S5"]),
      res("Grupo", 6, "15:30:00"),
    ];
    // Antes del servicio, «Llega» se puede mover; con el servicio empezado (14:00) no.
    const empezado = organizarServicio(entrada(mesas, reservas, { minutoAhora: 14 * 60 }));
    expect(empezado.movimientos.map((m) => m.reservaId)).not.toContain("Sentada");
    expect(empezado.movimientos.map((m) => m.reservaId)).not.toContain("Llega");
    expect(empezado.sinSitio.map((s) => s.reservaId)).toEqual(["Grupo"]);
  });

  it("importantes primero a igual tamaño", () => {
    const mesas = [pieza("C", "1", 2), redonda("S", "9", 6)];
    const r = organizarServicio(
      entrada(mesas, [res("Normal", 4, "21:00:00"), res("Vip", 4, "21:00:00", [], { importante: true })]),
    );
    expect(r.movimientos.find((m) => m.reservaId === "Vip")!.hacia.mesaNombres).toEqual(["1"]);
  });

  it("menos de 1 s con 60 reservas y 45 mesas", () => {
    const mesas: FilaMesaSala[] = [];
    for (let i = 0; i < 15; i++) mesas.push(pieza("C", String(i + 1), 2, { grupo_piezas: "g", piezas_max: 3, pos_x: (i % 4) * 2, pos_y: Math.floor(i / 4) * 2 }));
    for (let i = 0; i < 14; i++) mesas.push(i % 5 === 0 ? redonda("S", String(i + 1), 6) : pieza("S", String(i + 1), 2, { pos_x: i }));
    for (let i = 0; i < 16; i++) mesas.push(sitio(String(i + 1), (i % 4) * 1.8, Math.floor(i / 4) * 1.8));
    const reservas: ReservaOrg[] = [];
    for (let i = 0; i < 60; i++) reservas.push(res(`r${i}`, 2 + (i % 6), `${13 + (i % 3)}:${i % 2 ? "30" : "00"}:00`));
    const t0 = performance.now();
    const r = organizarServicio(entrada(mesas, reservas));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.movimientos.length + r.sinSitio.length).toBe(60);
  });

  it("deLaSala", () => {
    expect(deLaSala("Comedor")).toBe("del Comedor");
    expect(deLaSala("Terraza")).toBe("de la Terraza");
    expect(deLaSala("Salón")).toBe("del Salón");
  });
});

describe("organizarServicio · mesas liberadas", () => {
  it("una sentada que ya se fue no ocupa su mesa", () => {
    const mesas = [pieza("C", "1", 2)];
    const r = organizarServicio(
      entrada(mesas, [
        res("Ida", 4, "13:00:00", ["C1"], { estado: "completada", salidaAt: "2026-10-09T12:30:00Z" }),
        res("Nueva", 4, "15:00:00"),
      ]),
    );
    expect(r.movimientos.map((m) => m.reservaId)).toEqual(["Nueva"]);
    expect(r.sinSitio).toEqual([]);
  });
});

describe("vista previa de la propuesta", () => {
  it("disposición final, ajustes y mesas que cambian", () => {
    const mesas = [pieza("C", "4", 3, { picos_base: 1 }), pieza("S", "5", 2)];
    const r = organizarServicio(entrada(mesas, [res("Pepito", 4, "21:00:00", ["C4"]), res("Grupo", 7, "21:00:00")]));
    const actual = new Map([["Pepito", ["C4"]]]);
    const disp = disposicionPropuesta(actual, r.movimientos);
    expect(disp.get("C4")).toBe("Grupo");
    expect(disp.get("S5")).toBe("Pepito");
    expect([...mesasQueCambian(r.movimientos).keys()].sort()).toEqual(["C4", "S5"]);
    const ajustes = ajustesPropuestos([{ mesaId: "C4", piezas: 3, picos: 1, unidaA: null, espacioId: "C" }], [
      { ...r.movimientos[0], ajustes: [{ salaId: "S", cambios: [{ mesaId: "S5", piezas: 2, picos: 1, unidaA: null }] }] },
    ]);
    expect(ajustes.find((a) => a.mesaId === "S5")).toMatchObject({ picos: 1, espacioId: "S" });
  });
});

describe("organizarServicio · automático sencillo (13/10/2026)", () => {
  it("grupos de 8 o más: no se colocan solos, salen para revisar a mano con la sugerencia", () => {
    const mesas = [pieza("C", "1", 3, { picos_base: 1 }), redonda("S", "5", 10), pieza("S", "2", 2)];
    const r = organizarServicio(
      entrada(mesas, [res("Boda", 18, "14:00:00"), res("Cena", 8, "14:30:00"), res("Pareja", 2, "14:00:00")], {
        sugerirGrupo: (x) => (x.comensales > 14 ? "mesa larga en el Salón" : "al Reservado"),
      }),
    );
    expect(r.movimientos.map((m) => m.reservaId)).toEqual(["Pareja"]);
    expect(r.sinSitio).toEqual([]);
    expect(r.revisarAMano.map((x) => [x.reservaId, x.sugerencia])).toEqual([
      ["Boda", "mesa larga en el Salón"],
      ["Cena", "al Reservado"],
    ]);
    expect(r.yaOrganizado).toBe(false);
  });

  it("un grupo grande que ya tiene mesa no se mueve y su mesa no se da a otro", () => {
    const mesas = [redonda("S", "5", 10), pieza("S", "2", 2)];
    const r = organizarServicio(entrada(mesas, [res("Cena", 9, "21:00:00", ["S5"]), res("Seis", 6, "21:00:00")]));
    expect(r.movimientos.map((m) => m.reservaId)).not.toContain("Cena");
    expect(r.revisarAMano).toEqual([]);
    expect(r.sinSitio.map((s) => s.reservaId)).toEqual(["Seis"]);
  });

  it("nunca junta piezas de TRES mesas: destino + una donante como mucho", () => {
    const g = { grupo_piezas: "g" };
    const mesas = [
      pieza("C", "D", 1, { ...g, piezas_max: 3, pos_y: 0 }),
      pieza("C", "A", 2, { ...g, piezas_max: 2, pos_y: 1.5 }),
      pieza("C", "B", 2, { ...g, piezas_max: 2, pos_y: 3 }),
    ];
    const sentadas = [
      res("Ana", 2, "14:00:00", ["CA"], { estado: "completada" }),
      res("Luis", 2, "14:00:00", ["CB"], { estado: "completada" }),
    ];
    // A y B solo pueden soltar UNA pieza cada una: para 6 en la D harían falta las dos.
    const r = organizarServicio(entrada(mesas, [...sentadas, res("Seis", 6, "14:30:00")]));
    expect(r.movimientos).toEqual([]);
    expect(r.sinSitio.map((s) => s.reservaId)).toEqual(["Seis"]);
    // Con una sola donante sí: para 5 basta una pieza de la A (o la B) y pico.
    const cinco = organizarServicio(entrada(mesas, [...sentadas, res("Cinco", 5, "14:30:00")]));
    const m = cinco.movimientos.find((x) => x.reservaId === "Cinco")!;
    expect(m.hacia.mesaNombres).toEqual(["D"]);
    expect(m.detalle).toMatch(/pasa una pieza de la (A|B) a la D y pon pico/);
  });
});

describe("organizarServicio · menú del día o carta (martes a jueves comida)", () => {
  it("las de menú del día solo van al Comedor o la Terraza, aunque el Salón ajuste mejor", () => {
    const mesas = [redonda("S", "5", 2), pieza("C", "3", 3)];
    const r = organizarServicio(entrada(mesas, [res("Menu", 2, "14:00:00", [], { servicioComida: "menu_del_dia" })]));
    const m = r.movimientos.find((x) => x.reservaId === "Menu")!;
    expect(m.hacia.salaNombre).toBe("Comedor");
  });

  it("una de menú del día ya puesta en el Salón se recoloca en el Comedor", () => {
    const mesas = [redonda("S", "5", 2), pieza("C", "3", 1)];
    const r = organizarServicio(entrada(mesas, [res("Menu", 2, "14:00:00", ["S5"], { servicioComida: "menu_del_dia" })]));
    expect(r.movimientos.find((x) => x.reservaId === "Menu")?.hacia.salaNombre).toBe("Comedor");
  });

  it("sin sitio en Comedor/Terraza, la de menú del día se queda sin sitio (no al Salón)", () => {
    const r = organizarServicio(entrada([redonda("S", "5", 4)], [res("Menu", 2, "14:00:00", [], { servicioComida: "menu_del_dia" })]));
    expect(r.sinSitio.map((x) => x.reservaId)).toEqual(["Menu"]);
  });

  it("las de carta pueden ir al Salón; sin servicio, cualquier sala", () => {
    const r = organizarServicio(
      entrada([redonda("S", "5", 2)], [res("Carta", 2, "14:00:00", [], { servicioComida: "carta" })]),
    );
    expect(r.movimientos.find((x) => x.reservaId === "Carta")?.hacia.salaNombre).toBe("Salón");
  });

  it("las de carta no van a una sala que no sea Salón, Comedor o Terraza", () => {
    const salas: SalaOrg[] = [...SALAS, { id: "R", nombre: "Reservado", terraza: false }];
    const r = organizarServicio({
      ...entrada([redonda("R", "1", 2)], [res("Carta", 2, "14:00:00", [], { servicioComida: "carta" })]),
      salas,
    });
    expect(r.sinSitio.map((x) => x.reservaId)).toEqual(["Carta"]);
  });
});
