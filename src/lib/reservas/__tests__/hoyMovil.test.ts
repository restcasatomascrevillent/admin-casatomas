import { describe, expect, it } from "vitest";
import { agruparHoyMovil, mesasQueCaben, textoMesas, type ReservaHoyMovil } from "../hoyMovil";

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
