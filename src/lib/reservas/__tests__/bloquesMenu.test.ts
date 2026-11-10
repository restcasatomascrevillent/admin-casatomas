import { describe, it, expect } from "vitest";
import { agruparPorMenu, esDiaDeMenu } from "../bloquesMenu";

const f = (id: string, hora: string, pax: number, menu_del_dia?: boolean | null) => ({
  reserva: { id, hora, numero_comensales: pax, menu_del_dia },
});

// 2026-11-09 lunes, 10 martes, 12 jueves, 13 viernes.
const MARTES = "2026-11-10";

describe("esDiaDeMenu", () => {
  it("solo de martes a jueves", () => {
    expect(esDiaDeMenu("2026-11-09")).toBe(false);
    expect(esDiaDeMenu("2026-11-10")).toBe(true);
    expect(esDiaDeMenu("2026-11-12")).toBe(true);
    expect(esDiaDeMenu("2026-11-13")).toBe(false);
    expect(esDiaDeMenu("no-fecha")).toBe(false);
  });
});

describe("agruparPorMenu", () => {
  const comida = [f("a", "14:00:00", 2, true), f("b", "13:00:00", 4, false), f("c", "13:30:00", 3, null), f("d", "13:00:00", 5, true), f("e", "14:30:00", 2)];

  it("comida de martes a jueves: «Menú del día», «Carta» y «Resto», cada uno por hora y con sus pax", () => {
    const b = agruparPorMenu(comida, { fecha: MARTES, filtroTurno: "comida" })!;
    expect(b.map((x) => [x.titulo, x.filas.map((y) => y.reserva.id), x.pax])).toEqual([
      ["Menú del día", ["d", "a"], 7],
      ["Carta", ["b"], 4],
      ["Resto", ["c", "e"], 5],
    ]);
  });

  it("los bloques vacíos no salen", () => {
    const b = agruparPorMenu([f("a", "13:00:00", 2, true)], { fecha: MARTES, filtroTurno: "comida" })!;
    expect(b.map((x) => x.clave)).toEqual(["menu"]);
  });

  it("«Todo el día»: la cena va detrás, en su bloque y sin partir", () => {
    const b = agruparPorMenu([...comida, f("z", "21:00:00", 6, true), f("y", "20:30:00", 2, false)], { fecha: MARTES, filtroTurno: "todo" })!;
    expect(b.map((x) => x.clave)).toEqual(["menu", "carta", "resto", "cena"]);
    expect(b[3].filas.map((y) => y.reserva.id)).toEqual(["y", "z"]);
    expect(b[3].pax).toBe(8);
  });

  it("como siempre (null): la cena, los otros días, o sin reservas de comida", () => {
    expect(agruparPorMenu(comida, { fecha: MARTES, filtroTurno: "cena" })).toBeNull();
    expect(agruparPorMenu(comida, { fecha: "2026-11-09", filtroTurno: "comida" })).toBeNull();
    expect(agruparPorMenu(comida, { fecha: "2026-11-13", filtroTurno: "todo" })).toBeNull();
    expect(agruparPorMenu([f("z", "21:00:00", 6, true)], { fecha: MARTES, filtroTurno: "todo" })).toBeNull();
    expect(agruparPorMenu([], { fecha: MARTES, filtroTurno: "comida" })).toBeNull();
  });
});
