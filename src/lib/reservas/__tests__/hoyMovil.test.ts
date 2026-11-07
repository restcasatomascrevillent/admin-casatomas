import { describe, expect, it } from "vitest";
import {
  listaHoyEscritorio,
  tieneAlergia,
  agruparHoyMovil,
  estadoMesasHoy,
  lleganAhora,
  mesasQueCaben,
  reservasConMesaEnSala,
  textoMesas,
  type ReservaHoyMovil,
} from "../hoyMovil";

const r = (id: string, hora: string, estado: string, espacio: string | null, pax = 2, nombre = id): ReservaHoyMovil => ({
  id,
  nombre,
  hora,
  numero_comensales: pax,
  estado,
  espacio_id: espacio,
});

const SALAS = [
  { id: "c", nombre: "Comedor" },
  { id: "s", nombre: "Salón" },
  { id: "t", nombre: "Terraza" },
];

describe("agruparHoyMovil", () => {
  const reservas = [
    r("a", "14:30:00", "confirmada", "c", 4),
    r("b", "13:30:00", "completada", "c", 2),
    r("c", "14:00:00", "confirmada", "c", 3),
    r("d", "13:00:00", "confirmada", "s", 6),
    r("e", "21:00:00", "confirmada", "t", 2),
    r("f", "14:15:00", "pendiente", "c", 5),
    r("g", "14:00:00", "cancelada", "c", 9),
    r("h", "13:45:00", "no_show", "s", 4),
  ];
  const mesas: Record<string, string[]> = { a: ["3"], b: ["4"], c: ["5"], d: ["2", "1"], e: ["7"], h: ["9"] };
  const mesasDe = (id: string) => mesas[id] ?? [];

  it("«Sin mesa» arriba y luego cada sala en su orden, con totales", () => {
    const grupos = agruparHoyMovil(reservas, SALAS, mesasDe, { busqueda: "", filtroTurno: "todo" });
    expect(grupos.map((g) => g.titulo)).toEqual(["Sin mesa", "Comedor", "Salón", "Terraza"]);
    expect(grupos[0].filas.map((f) => f.reserva.id)).toEqual(["f"]);
    expect(grupos[1]).toMatchObject({ totalReservas: 3, totalPersonas: 9 });
    // «No vino» no cuenta en los totales.
    expect(grupos[2]).toMatchObject({ totalReservas: 1, totalPersonas: 6 });
  });

  it("por hora, y las que ya llegaron o no vinieron al final", () => {
    const grupos = agruparHoyMovil(reservas, SALAS, mesasDe, { busqueda: "", filtroTurno: "todo" });
    expect(grupos[1].filas.map((f) => f.reserva.id)).toEqual(["c", "a", "b"]);
    expect(grupos[1].filas[2].terminada).toBe(true);
    expect(grupos[2].filas.map((f) => f.reserva.id)).toEqual(["d", "h"]);
  });

  it("respeta el turno y la búsqueda; las canceladas no salen", () => {
    const cena = agruparHoyMovil(reservas, SALAS, mesasDe, { busqueda: "", filtroTurno: "cena" });
    expect(cena.map((g) => g.titulo)).toEqual(["Terraza"]);
    const busca = agruparHoyMovil(reservas, SALAS, mesasDe, { busqueda: "D", filtroTurno: "todo" });
    expect(busca.flatMap((g) => g.filas.map((f) => f.reserva.id))).toEqual(["d"]);
    const todas = agruparHoyMovil(reservas, SALAS, mesasDe, { busqueda: "", filtroTurno: "todo" });
    expect(todas.flatMap((g) => g.filas.map((f) => f.reserva.id))).not.toContain("g");
  });

  it("una que llegó sin mesa va a su sala, no a «Sin mesa»", () => {
    const grupos = agruparHoyMovil([r("x", "14:00", "completada", "s")], SALAS, () => [], {
      busqueda: "",
      filtroTurno: "todo",
    });
    expect(grupos.map((g) => g.titulo)).toEqual(["Salón"]);
  });
});

describe("mesasQueCaben", () => {
  const mesas = [
    { id: "1", nombre: "10", espacioId: "c", salaNombre: "Comedor", plazas: 4 },
    { id: "2", nombre: "3", espacioId: "c", salaNombre: "Comedor", plazas: 7 },
    { id: "3", nombre: "2", espacioId: "c", salaNombre: "Comedor", plazas: 4 },
    { id: "4", nombre: "1", espacioId: "s", salaNombre: "Salón", plazas: 4 },
    { id: "5", nombre: "6", espacioId: "c", salaNombre: "Comedor", plazas: 2 },
    { id: "6", nombre: "4", espacioId: "c", salaNombre: "Comedor", plazas: 4 },
  ];

  it("libres y donde caben; su sala primero, la más justa y por número", () => {
    const libres = new Set(["1", "2", "3", "4", "5"]);
    expect(mesasQueCaben(mesas, 4, "c", (id) => libres.has(id)).map((m) => m.nombre)).toEqual(["2", "10", "3", "1"]);
  });

  it("textoMesas", () => {
    expect(textoMesas([])).toBe("Sin mesa");
    expect(textoMesas(["3"])).toBe("Mesa 3");
    expect(textoMesas(["4", "5"])).toBe("Mesas 4 + 5");
  });
});

describe("lleganAhora", () => {
  const reservas = [
    r("tarde", "20:35:00", "confirmada", "c"),
    r("muyTarde", "20:20:00", "confirmada", "c"),
    r("ya", "21:00:00", "confirmada", "c"),
    r("pronto", "21:10:00", "verificada", "s"),
    r("luego", "21:30:00", "confirmada", "s"),
    r("llego", "21:00:00", "completada", "s"),
  ];
  it("próximos 15 min y hasta 30 tarde, sin las que ya llegaron", () => {
    const filas = lleganAhora(reservas, () => [], 21 * 60, { busqueda: "", filtroTurno: "todo" });
    expect(filas.map((f) => [f.reserva.id, f.tarde])).toEqual([
      ["tarde", true],
      ["ya", false],
      ["pronto", false],
    ]);
  });
});

describe("estadoMesasHoy", () => {
  const turnoDe = (h: string) => (h < "17:00" ? "comida" : "cena") as "comida" | "cena";
  const reservas = [
    { id: "a", nombre: "Ana", hora: "21:00:00", numero_comensales: 4, estado: "completada", salida_at: null },
    { id: "b", nombre: "Bea", hora: "22:00:00", numero_comensales: 2, estado: "confirmada" },
    { id: "c", nombre: "Ciro", hora: "21:30:00", numero_comensales: 2, estado: "confirmada" },
    { id: "d", nombre: "Dani", hora: "20:00:00", numero_comensales: 2, estado: "completada", salida_at: "2026-10-09T19:00:00Z" },
    { id: "e", nombre: "Eva", hora: "14:00:00", numero_comensales: 2, estado: "confirmada" },
    { id: "f", nombre: "Fran", hora: "21:00:00", numero_comensales: 2, estado: "no_show" },
  ];
  const asig = [
    { mesa_id: "1", reserva_id: "a" },
    { mesa_id: "1", reserva_id: "b" },
    { mesa_id: "2", reserva_id: "b" },
    { mesa_id: "2", reserva_id: "c" },
    { mesa_id: "3", reserva_id: "d" },
    { mesa_id: "4", reserva_id: "e" },
    { mesa_id: "5", reserva_id: "f" },
  ];
  it("sentada manda; si no, la próxima; liberadas, de otro turno y «No vino» = libre", () => {
    const e = estadoMesasHoy(asig, reservas, "cena", turnoDe);
    expect(e.get("1")).toMatchObject({ tipo: "sentada", nombre: "Ana" });
    expect(e.get("2")).toMatchObject({ tipo: "reservada", nombre: "Ciro", hora: "21:30:00" });
    expect(e.get("3")).toBeUndefined();
    expect(e.get("4")).toBeUndefined();
    expect(e.get("5")).toBeUndefined();
  });
});

describe("reservasConMesaEnSala (panel del Plano de Hoy)", () => {
  it("solo las de la sala con mesa, por hora; sentadas, liberadas y «No vino» al final", () => {
    const lista = [
      { ...r("b", "21:00:00", "confirmada", "c"), salida_at: null },
      { ...r("a", "20:30:00", "completada", "c"), salida_at: null },
      { ...r("c", "20:00:00", "confirmada", "c"), salida_at: null },
      { ...r("d", "19:00:00", "no_show", "c"), salida_at: null },
      { ...r("e", "19:30:00", "confirmada", "c"), salida_at: "2026-10-10T18:00:00Z" },
      { ...r("f", "20:00:00", "confirmada", "c"), salida_at: null },
      { ...r("g", "20:00:00", "confirmada", "s"), salida_at: null },
      { ...r("h", "20:00:00", "cancelada", "c"), salida_at: null },
    ];
    const conMesa = new Set(["a", "b", "c", "d", "e", "g", "h"]);
    expect(reservasConMesaEnSala(lista, "c", (id) => conMesa.has(id)).map((x) => x.id)).toEqual(["c", "b", "d", "e", "a"]);
  });
});

// «Hoy» de escritorio (07/11/2026): la lista completa del turno, por estados.
describe("listaHoyEscritorio", () => {
  const r = (id: string, hora: string, estado: string, extra: Record<string, unknown> = {}) => ({
    id,
    nombre: id,
    hora,
    numero_comensales: 2,
    estado,
    espacio_id: "s1",
    ...extra,
  });
  const sinMesas = () => [] as string[];

  it("agrupa en por llegar, sentadas y terminadas (liberadas, no vino y canceladas), cada grupo por hora", () => {
    const l = listaHoyEscritorio(
      [
        r("conf-14", "14:00", "confirmada"),
        r("pend-13", "13:00", "pendiente"),
        r("sent", "13:30", "completada"),
        r("ida", "13:15", "completada", { salida_at: "2026-11-07T14:00:00Z" }),
        r("noshow", "13:45", "no_show"),
        r("canc", "14:15", "cancelada"),
      ],
      sinMesas,
      13 * 60 + 30,
      { busqueda: "", filtroTurno: "todo" },
    );
    expect(l.porLlegar.map((f) => f.reserva.id)).toEqual(["pend-13", "conf-14"]);
    expect(l.porLlegar.map((f) => f.tarde)).toEqual([true, false]);
    expect(l.sentadas.map((f) => f.reserva.id)).toEqual(["sent"]);
    expect(l.terminadas.map((f) => f.reserva.id)).toEqual(["ida", "noshow", "canc"]);
  });

  it("respeta el turno y el buscador", () => {
    const l = listaHoyEscritorio(
      [r("Ana", "14:00", "confirmada"), r("Bea", "21:00", "confirmada"), r("Ana cena", "21:30", "completada")],
      sinMesas,
      0,
      { busqueda: "ana", filtroTurno: "cena" },
    );
    expect(l.porLlegar).toEqual([]);
    expect(l.sentadas.map((f) => f.reserva.id)).toEqual(["Ana cena"]);
  });

  it("tieneAlergia reconoce la nota de una alergia", () => {
    expect(tieneAlergia("Alérgico al marisco")).toBe(true);
    expect(tieneAlergia("celíaca")).toBe(true);
    expect(tieneAlergia("trona para el niño")).toBe(false);
  });
});
