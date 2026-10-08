import { describe, expect, it } from "vitest";
import {
  aplicarCambios,
  cambiarPico,
  candidatasParaJuntar,
  estadoServicio,
  geometriaServicio,
  juntar,
  mesaPiezasDesde,
  mesasDeLaUnion,
  piezasNecesarias,
  plazasDe,
  proponerParaSentar,
  proponerPiezaEnFila,
  separar,
  type MesaPiezas,
  type ReservaEnMesas,
} from "../piezasMesa";

// Comedor de Casa Tomás según el croquis del 08/10/2026 (centros aproximados en m).
const m = (
  nombre: string,
  piezas: number,
  picos: number,
  grupo: string | null,
  x: number,
  y: number,
  extra: Partial<MesaPiezas> = {},
): MesaPiezas => ({ id: `m${nombre}`, nombre, piezas, picos, picosMax: 1, piezasMax: 3, grupo, redonda: false, x, y, ...extra });

const COMEDOR: MesaPiezas[] = [
  m("2", 2, 0, null, 4.5, 1.1, { piezasMax: 2 }),
  m("3", 2, 0, "c-3-4", 6.85, 0.9),
  m("4", 3, 1, "c-3-4", 7.1, 2.5),
  m("5", 3, 1, null, 7.1, 4.0),
  m("6", 1, 0, null, 3.2, 3.8, { piezasMax: 1 }),
  m("10", 2, 0, "c-7-12", 6.25, 11.7),
  m("7", 2, 0, "c-7-12", 7.75, 11.7),
  m("11", 2, 0, "c-7-12", 6.25, 13.3),
  m("8", 2, 0, "c-7-12", 7.75, 13.3),
  m("12", 1, 0, "c-7-12", 6.5, 14.8),
  m("9", 2, 0, "c-7-12", 7.75, 14.8),
];

const base = () => estadoServicio(COMEDOR, []);

describe("plazas", () => {
  it("pieza de 2, pico +1", () => {
    expect(plazasDe({ piezas: 2, picos: 0 })).toBe(4);
    expect(plazasDe({ piezas: 2, picos: 1 })).toBe(5);
    expect(plazasDe({ piezas: 3, picos: 0 })).toBe(6);
    expect(plazasDe({ piezas: 3, picos: 1 })).toBe(7);
    expect(plazasDe({ piezas: 0, picos: 1 })).toBe(0);
  });

  it("lo mínimo para sentar a un grupo", () => {
    expect(piezasNecesarias(7, 1)).toEqual({ piezas: 3, picos: 1 });
    expect(piezasNecesarias(6, 1)).toEqual({ piezas: 3, picos: 0 });
    expect(piezasNecesarias(5, 1)).toEqual({ piezas: 2, picos: 1 });
    expect(piezasNecesarias(2, 1)).toEqual({ piezas: 1, picos: 0 });
    expect(piezasNecesarias(7, 0)).toEqual({ piezas: 4, picos: 0 });
  });
});

describe("auto-propuesta al sentar", () => {
  it("7 en la 3: pasa una pieza de la 4 a la 3 y pon pico", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 7 });
    expect(r.motivo).toBeNull();
    expect(r.propuestas[0].texto).toBe("Para sentar 7 en la 3: pasa una pieza de la 4 a la 3 y pon pico");
    const final = aplicarCambios(base(), r.propuestas[0].cambios);
    expect(plazasDe(final.get("m3")!)).toBe(7);
    expect(plazasDe(final.get("m4")!)).toBe(5);
  });

  it("si cabe, no propone nada", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 4 });
    expect(r).toEqual({ propuestas: [], motivo: null });
  });

  it("5 en la 3: basta con poner pico", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 5 });
    expect(r.propuestas[0].texto).toBe("Para sentar 5 en la 3: pon pico");
    expect(r.propuestas[0].pasos).toEqual([{ tipo: "pico", mesa: "m3", n: 1 }]);
  });

  it("no quita piezas a una mesa con reserva del servicio que las necesita", () => {
    const reservas: ReservaEnMesas[] = [{ reservaId: "r1", mesaIds: ["m4"], comensales: 7 }];
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas, mesaId: "m3", comensales: 7 });
    expect(r.propuestas).toEqual([]);
    expect(r.motivo).toMatch(/No hay piezas libres/);
  });

  it("sí coge la sobrante de una mesa con reserva pequeña", () => {
    const reservas: ReservaEnMesas[] = [{ reservaId: "r1", mesaIds: ["m4"], comensales: 4 }];
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas, mesaId: "m3", comensales: 6 });
    expect(r.propuestas[0].texto).toBe("Para sentar 6 en la 3: pasa una pieza de la 4 a la 3");
  });

  it("nunca entre zonas distintas (la 5 no da piezas a la 3)", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 7 });
    for (const p of r.propuestas) for (const paso of p.pasos) if (paso.tipo === "mover") expect(paso.desde).toBe("m4");
  });

  it("bloque 7-12: primero la adyacente, y ofrece otras opciones", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m7", comensales: 6 });
    expect(r.propuestas[0].texto).toBe("Para sentar 6 en la 7: pasa una pieza de la 10 a la 7");
    expect(r.propuestas.length).toBeGreaterThan(1);
    expect(r.propuestas.map((p) => p.pasos[0])).toContainEqual({ tipo: "mover", desde: "m8", hacia: "m7", n: 1 });
  });

  it("prefiere la libre a la ocupada si están a la misma distancia", () => {
    const mesas = [m("A", 2, 0, "g", 0, 0), m("B", 2, 0, "g", -1, 0), m("C", 2, 0, "g", 1, 0)];
    const reservas: ReservaEnMesas[] = [{ reservaId: "r", mesaIds: ["mB"], comensales: 2 }];
    const r = proponerParaSentar({ mesas, estado: estadoServicio(mesas, []), reservas, mesaId: "mA", comensales: 6 });
    expect(r.propuestas[0].pasos[0]).toEqual({ tipo: "mover", desde: "mC", hacia: "mA", n: 1 });
  });

  it("no pasa del hueco del plano", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 9 });
    expect(r.propuestas).toEqual([]);
    expect(r.motivo).toMatch(/caben como mucho 3 piezas/);
  });

  it("redondas: ni piezas ni pico", () => {
    const mesas = [m("R", 1, 0, "g", 0, 0, { redonda: true }), m("S", 2, 0, "g", 1, 0)];
    const r = proponerParaSentar({ mesas, estado: estadoServicio(mesas, []), reservas: [], mesaId: "mR", comensales: 4 });
    expect(r.propuestas).toEqual([]);
    expect(r.motivo).toMatch(/redonda/);
  });

  it("puede necesitar piezas de dos mesas", () => {
    const mesas = [m("A", 1, 0, "g", 0, 0, { piezasMax: 3, picosMax: 0 }), m("B", 1, 0, "g", 1, 0), m("C", 1, 0, "g", 2, 0)];
    const r = proponerParaSentar({ mesas, estado: estadoServicio(mesas, []), reservas: [], mesaId: "mA", comensales: 6 });
    expect(r.propuestas[0].texto).toBe("Para sentar 6 en la A: pasa una pieza de la B y una pieza de la C a la A");
    const final = aplicarCambios(estadoServicio(mesas, []), r.propuestas[0].cambios);
    expect(final.get("mB")!.piezas).toBe(0);
  });
});

describe("botones de la mesa", () => {
  it("+ Mesa en fila coge la pieza libre adyacente", () => {
    const r = proponerPiezaEnFila({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m11" });
    expect(r.propuestas[0].texto).toBe("pasa una pieza de la 8 a la 11");
  });

  it("+ Pico y − Pico respetan las cabeceras", () => {
    const tres = COMEDOR.find((x) => x.id === "m3")!;
    const conPico = cambiarPico(tres, base(), 1)!;
    expect(conPico.picos).toBe(1);
    const e = aplicarCambios(base(), [conPico]);
    expect(cambiarPico(tres, e, 1)).toBeNull();
    expect(cambiarPico(tres, e, -1)!.picos).toBe(0);
  });

  it("Juntar y Separar", () => {
    const diez = COMEDOR.find((x) => x.id === "m10")!;
    const siete = COMEDOR.find((x) => x.id === "m7")!;
    expect(candidatasParaJuntar(diez, COMEDOR, base())[0].id).toBe("m7");
    const e = aplicarCambios(base(), juntar(diez, siete, base()));
    expect(mesasDeLaUnion(e, "m7").sort()).toEqual(["m10", "m7"]);
    expect(candidatasParaJuntar(diez, COMEDOR, e)).toEqual([]);
    const s = aplicarCambios(e, separar(siete, COMEDOR, e));
    expect(mesasDeLaUnion(s, "m7")).toEqual(["m7"]);
    expect(mesasDeLaUnion(s, "m10")).toEqual(["m10"]);
  });

  it("Separar devuelve las piezas prestadas", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 7 });
    const e = aplicarCambios(base(), r.propuestas[0].cambios);
    const tres = COMEDOR.find((x) => x.id === "m3")!;
    const s = aplicarCambios(e, separar(tres, COMEDOR, e));
    expect(s.get("m3")).toEqual({ piezas: 2, picos: 0, unidaA: null });
    expect(s.get("m4")!.piezas).toBe(3);
  });
});

describe("geometría del servicio", () => {
  const fila = {
    id: "m10", nombre: "10", forma: "rectangular", ancho: 110, alto: 70, pos_x: 5.7, pos_y: 11.36,
    piezas: 2, picos_base: 0, picos_max: 1, piezas_max: 3, grupo_piezas: "c-7-12", crece_hacia: "izquierda",
  };

  it("crece hacia su lado y recalcula plazas", () => {
    const g = geometriaServicio(fila, { piezas: 3, picos: 1, unidaA: null })!;
    expect(g.ancho).toBeCloseTo(165);
    expect(g.pos_x).toBeCloseTo(5.15);
    expect(g.capacidad).toBe(7);
    expect(g.ladoPico).toBe("derecha");
  });

  it("sin piezas en el plano no se gestiona por piezas", () => {
    expect(mesaPiezasDesde({ ...fila, piezas: null })).toBeNull();
    expect(mesaPiezasDesde({ ...fila, forma: "circular" })!.redonda).toBe(true);
  });
});

describe("filas verticales (Salón)", () => {
  const fila = {
    id: "s4", nombre: "4", forma: "rectangular", ancho: 70, alto: 110, pos_x: 2.26, pos_y: 6.0,
    piezas: 2, picos_base: 0, picos_max: 1, piezas_max: 3, grupo_piezas: "salon-abajo", crece_hacia: "abajo",
  };

  it("crece hacia abajo: alto, no ancho", () => {
    const g = geometriaServicio(fila, { piezas: 3, picos: 1, unidaA: null })!;
    expect(g.vertical).toBe(true);
    expect(g.ancho).toBe(70);
    expect(g.alto).toBeCloseTo(165);
    expect(g.pos_y).toBeCloseTo(6.0);
    expect(g.ladoPico).toBe("arriba");
    expect(g.capacidad).toBe(7);
  });

  it("crece hacia arriba: se desplaza pos_y", () => {
    const g = geometriaServicio({ ...fila, crece_hacia: "arriba" }, { piezas: 3, picos: 0, unidaA: null })!;
    expect(g.pos_y).toBeCloseTo(5.45);
    expect(g.ladoPico).toBe("abajo");
  });
});
