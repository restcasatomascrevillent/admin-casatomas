import { describe, expect, it } from "vitest";
import { deLaSala, organizarServicio, type EntradaOrg, type ReservaOrg, type SalaOrg } from "../organizarServicio";
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

  it("terraza cerrada: no asigna nada ahí y recoloca lo que tenía", () => {
    const mesas = [sitio("1", 0, 0), sitio("2", 1.8, 0), pieza("C", "3", 2)];
    const r = organizarServicio(entrada(mesas, [res("Luis", 4, "21:00:00", ["T1"])], { terrazaCerrada: true }));
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0].texto).toBe("Luis (4 p., 21:00) pasa de la 1 de la Terraza a la 3 del Comedor");
    const abierta = organizarServicio(entrada(mesas, [res("Luis", 4, "21:00:00", ["T1"])]));
    expect(abierta.yaOrganizado).toBe(true);
    expect(abierta.resumen).toBe("Ya está bien organizado");
  });

  it("terraza flexible: un grupo de 9 junta dos sitios", () => {
    const mesas = [sitio("1", 0, 0), sitio("2", 1.8, 0), sitio("3", 0, 1.8), pieza("C", "3", 2)];
    const r = organizarServicio(entrada(mesas, [res("Boda", 9, "14:00:00")]));
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
