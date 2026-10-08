import { describe, expect, it } from "vitest";
import {
  afectadasAlVolverABase,
  aplicarCambios,
  cambiarPlazas,
  cambiarPico,
  candidatasParaJuntar,
  estadoServicio,
  geometriaServicio,
  juntar,
  mesaPiezasDesde,
  mesasDeLaUnion,
  piezasNecesarias,
  plazasDe,
  plazasMesa,
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
    // La fila unida puede seguir creciendo con una de al lado (la 11 o la 8), nunca en diagonal.
    expect(candidatasParaJuntar(diez, COMEDOR, e).map((m) => m.id).sort()).toEqual(["m11", "m8"]);
    const s = aplicarCambios(e, separar(siete, COMEDOR, e));
    expect(mesasDeLaUnion(s, "m7")).toEqual(["m7"]);
    expect(mesasDeLaUnion(s, "m10")).toEqual(["m10"]);
  });

  it("Separar devuelve las piezas prestadas", () => {
    const r = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 7 });
    const e = aplicarCambios(base(), r.propuestas[0].cambios);
    const tres = COMEDOR.find((x) => x.id === "m3")!;
    const s = aplicarCambios(e, separar(tres, COMEDOR, e));
    expect(s.get("m3")).toMatchObject({ piezas: 2, picos: 0, unidaA: null });
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

describe("sitios de la Terraza (sin piezas, plazas 2-6)", () => {
  // Cuadrícula 4 × 4 a 1,6 m.
  const sitio = (n: number): MesaPiezas =>
    mesaPiezasDesde({
      id: `t${n}`, nombre: String(n), forma: "rectangular", ancho: 80, alto: 80,
      pos_x: ((n - 1) % 4) * 1.6, pos_y: Math.floor((n - 1) / 4) * 1.6,
      piezas: null, capacidad: 4, plazas_min: 2, plazas_max: 6, grupo_piezas: "terraza",
    })!;
  const TERRAZA = Array.from({ length: 16 }, (_, i) => sitio(i + 1));
  const e0 = () => estadoServicio(TERRAZA, []);

  it("es un sitio con 4 plazas por defecto", () => {
    expect(TERRAZA[0].sitio).toEqual({ plazas: 4, min: 2, max: 6 });
    expect(plazasMesa(TERRAZA[0], e0().get("t1")!)).toBe(4);
  });

  it("± plazas dentro de 2-6", () => {
    let e = e0();
    for (let i = 0; i < 2; i++) e = aplicarCambios(e, [cambiarPlazas(TERRAZA[0], e, 1)!]);
    expect(plazasMesa(TERRAZA[0], e.get("t1")!)).toBe(6);
    expect(cambiarPlazas(TERRAZA[0], e, 1)).toBeNull();
  });

  it("nunca da ni recibe piezas ni pico", () => {
    const r = proponerPiezaEnFila({ mesas: TERRAZA, estado: e0(), reservas: [], mesaId: "t6" });
    expect(r.propuestas).toEqual([]);
    expect(cambiarPico(TERRAZA[5], e0(), 1)).toBeNull();
  });

  it("al sentar 6 propone ponerla para 6; con 8 pide juntar", () => {
    const seis = proponerParaSentar({ mesas: TERRAZA, estado: e0(), reservas: [], mesaId: "t6", comensales: 6 });
    expect(seis.propuestas[0].texto).toBe("Para sentar 6 en la 6: ponla para 6");
    const ocho = proponerParaSentar({ mesas: TERRAZA, estado: e0(), reservas: [], mesaId: "t6", comensales: 8 });
    expect(ocho.propuestas).toEqual([]);
    expect(ocho.motivo).toMatch(/júntala con una de al lado/);
  });

  it("juntar solo con las de los lados, y la fila puede crecer", () => {
    expect(candidatasParaJuntar(TERRAZA[5], TERRAZA, e0()).map((m) => m.nombre).sort()).toEqual(["10", "2", "5", "7"]);
    const e = aplicarCambios(e0(), juntar(TERRAZA[5], TERRAZA[6], e0()));
    expect(mesasDeLaUnion(e, "t7").sort()).toEqual(["t6", "t7"]);
    const mas = candidatasParaJuntar(TERRAZA[6], TERRAZA, e).map((m) => m.nombre).sort();
    expect(mas).toEqual(["10", "11", "2", "3", "5", "8"]);
    const tres = aplicarCambios(e, juntar(TERRAZA[6], TERRAZA[7], e));
    expect(mesasDeLaUnion(tres, "t8").sort()).toEqual(["t6", "t7", "t8"]);
  });
});

describe("volver al plano base", () => {
  it("avisa de quien se queda sin sitio y de quien dependía de una unión", () => {
    const r7 = proponerParaSentar({ mesas: COMEDOR, estado: base(), reservas: [], mesaId: "m3", comensales: 7 });
    let e = aplicarCambios(base(), r7.propuestas[0].cambios);
    const diez = COMEDOR.find((x) => x.id === "m10")!;
    const siete = COMEDOR.find((x) => x.id === "m7")!;
    e = aplicarCambios(e, juntar(diez, siete, e));
    const porId = new Map(COMEDOR.map((m) => [m.id, m]));
    const capacidad = (id: string) => plazasMesa(porId.get(id)!, e.get(id)!);

    const afectadas = afectadasAlVolverABase(
      COMEDOR,
      e,
      [
        { reservaId: "a", nombre: "Ana", hora: "14:00", comensales: 7, mesaIds: ["m3"] },
        { reservaId: "b", nombre: "Bea", hora: "13:30", comensales: 8, mesaIds: ["m10", "m7"] },
        { reservaId: "c", nombre: "Carlos", hora: "15:00", comensales: 4, mesaIds: ["m4"] },
        { reservaId: "d", nombre: "Dani", hora: "14:30", comensales: 2, mesaIds: [] },
      ],
      capacidad,
    );
    expect(afectadas.map((a) => a.nombre)).toEqual(["Bea", "Ana"]);
    expect(afectadas[0]).toMatchObject({ porUnion: true, sinSitio: false, plazasDespues: 8 });
    expect(afectadas[1]).toMatchObject({ porUnion: false, sinSitio: true, plazasAntes: 7, plazasDespues: 4 });
  });
});
