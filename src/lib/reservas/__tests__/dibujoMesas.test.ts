import { describe, expect, it } from "vitest";
import { aplicarPosicionesUnion, dibujarUniones, divisoresPiezas, type CajaMesa } from "../dibujoMesas";
import { aplicarCambios, estadoServicio, juntar, mesaPiezasDesde, separar, type FilaMesaPiezas } from "../piezasMesa";

// Mesas de 2 piezas (160 × 80 cm, en horizontal), en fila con 1 m de pasillo entre ellas.
const fila = (id: string, x: number, y: number, extra: Partial<FilaMesaPiezas> = {}): FilaMesaPiezas & CajaMesa => ({
  id,
  nombre: id,
  forma: "rectangular",
  ancho: 160,
  alto: 80,
  pos_x: x,
  pos_y: y,
  piezas: 2,
  picos_base: 0,
  picos_max: 1,
  piezas_max: 3,
  grupo_piezas: "salon",
  capacidad: 4,
  ...extra,
});

const m3 = fila("3", 1, 2);
const m4 = fila("4", 3.6, 2.2);
const m5 = fila("5", 6.2, 2);
const m8 = fila("8", 1, 5);
const filas = [m3, m4, m5, m8];
const piezas = filas.map(mesaPiezasDesde).filter((m) => m !== null);
const p = (id: string) => piezas.find((m) => m.id === id)!;

describe("divisoresPiezas", () => {
  it("2 piezas: una ranura en el centro; 3 piezas: dos en los tercios", () => {
    expect(divisoresPiezas(2)).toEqual([0.5]);
    expect(divisoresPiezas(3)).toEqual([1 / 3, 2 / 3]);
  });
  it("1 pieza, 0 o valores raros: ninguna ranura", () => {
    expect(divisoresPiezas(1)).toEqual([]);
    expect(divisoresPiezas(0)).toEqual([]);
    expect(divisoresPiezas(Number.NaN)).toEqual([]);
  });
});

// Plano de 12 × 8 m con sus cuatro paredes (px de escena a 50 px/m).
const pared = (x1: number, y1: number, x2: number, y2: number) => ({
  tipo: "wall",
  props: { x1: x1 * 50, y1: y1 * 50, x2: x2 * 50, y2: y2 * 50 },
});
const plano = {
  pixels_per_meter: 50,
  ancho_metros: 12,
  alto_metros: 8,
  configuracion: { elementos: [pared(0, 0, 12, 0), pared(12, 0, 12, 8), pared(12, 8, 0, 8), pared(0, 8, 0, 0)] },
};

const piezasDe = (ms: FilaMesaPiezas[]) => ms.map(mesaPiezasDesde).filter((m) => m !== null);
const unir = (pares: Array<[string, string]>, ps = piezas) => {
  let estado = estadoServicio(ps, []);
  for (const [a, b] of pares) {
    const pa = ps.find((m) => m.id === a)!;
    const pb = ps.find((m) => m.id === b)!;
    estado = aplicarCambios(estado, juntar(pa, pb, estado));
  }
  return estado;
};

type R = { x: number; y: number; w: number; h: number };
const caja = (c: { pos_x: number; pos_y: number; ancho: number; alto: number }): R => ({
  x: c.pos_x,
  y: c.pos_y,
  w: c.ancho / 100,
  h: c.alto / 100,
});
const pisan = (a: R, b: R) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
const dentro = (r: R, l: { izq: number; der: number; arr: number; aba: number }, h = 0.6) =>
  r.x - h >= l.izq - 1e-9 && r.x + r.w + h <= l.der + 1e-9 && r.y - h >= l.arr - 1e-9 && r.y + r.h + h <= l.aba + 1e-9;

describe("dibujarUniones", () => {
  it("sin uniones no mueve nada ni dibuja contornos", () => {
    const d = dibujarUniones(filas, estadoServicio(piezas, []));
    expect(d.uniones).toEqual([]);
    expect(d.posiciones.size).toBe(0);
    expect(aplicarPosicionesUnion(filas, d)).toBe(filas);
  });

  it("3 junta con 4: una fila horizontal de 4 piezas, la 3 en su sitio y la 4 a continuación", () => {
    const d = dibujarUniones(filas, unir([["3", "4"]]), { plano });
    // La 3 (principal) no se mueve; la 4 pasa de x=3.6 a x=1+1.6=2.6 y de y=2.2 a y=2.
    expect(d.posiciones.get("3")).toEqual({ pos_x: 1, pos_y: 2, ancho: 160, alto: 80 });
    expect(d.posiciones.get("4")).toEqual({ pos_x: 2.6, pos_y: 2, ancho: 160, alto: 80 });
    expect(d.giros.get("3")).toMatchObject({ vertical: false });
    expect(d.giros.get("4")).toMatchObject({ vertical: false });
    expect(d.uniones).toHaveLength(1);
    expect(d.uniones[0]).toMatchObject({
      ids: ["3", "4"],
      texto: "3+4 · 8 plazas",
      plazas: 8,
      horizontal: true,
      pos_x: 1,
      pos_y: 2,
      ancho: 320,
      alto: 80,
    });
    const vista = aplicarPosicionesUnion(filas, d);
    expect(vista.find((m) => m.id === "4")).toMatchObject({ pos_x: 2.6, pos_y: 2 });
    expect(vista.find((m) => m.id === "5")).toBe(m5);
  });

  it("Salón: dos mesas VERTICALES (70 × 110, piezas apiladas) juntas se giran y quedan en HORIZONTAL, cabeza con cabeza", () => {
    // Como en el Salón: la 3 y la 4 de 2 piezas en vertical, una al lado de la otra.
    const s3 = fila("3", 4.51, 5, { ancho: 70, alto: 110, crece_hacia: "abajo" });
    const s4 = fila("4", 2.26, 5, { ancho: 70, alto: 110, crece_hacia: "abajo" });
    const d = dibujarUniones(
      [s3, s4].map((m) => ({ ...m, vertical: true })),
      unir([["3", "4"]], piezasDe([s3, s4])),
      { plano },
    );
    const u = d.uniones[0];
    // Una sola mesa larga: 4 piezas de 55 cm en fila = 2,20 m × 0,70 m, horizontal.
    expect(u).toMatchObject({ texto: "3+4 · 8 plazas", horizontal: true, ancho: 220, alto: 70 });
    expect(d.giros.get("3")).toMatchObject({ vertical: false });
    expect(d.giros.get("4")).toMatchObject({ vertical: false });
    const r3 = caja(d.posiciones.get("3")!);
    const r4 = caja(d.posiciones.get("4")!);
    expect(r3).toMatchObject({ w: 1.1, h: 0.7 });
    expect(r4).toMatchObject({ w: 1.1, h: 0.7 });
    // La 4 estaba a la izquierda: queda pegada a la izquierda de la 3, a la misma altura.
    expect(r4.x + r4.w).toBeCloseTo(r3.x, 6);
    expect(r4.y).toBeCloseTo(r3.y, 6);
    // La 3 sigue centrada donde estaba (centro 4.86, 5.55).
    expect(r3.x + r3.w / 2).toBeCloseTo(4.86, 6);
    expect(r3.y + r3.h / 2).toBeCloseTo(5.55, 6);
  });

  it("si la unida está a la izquierda, la fila crece hacia la izquierda", () => {
    const d = dibujarUniones(filas, unir([["4", "3"]]), { plano });
    // Principal la 4 (x 3.6, y 2.2): la 3 queda pegada a su izquierda (3.6-1.6=2) y a su altura.
    expect(d.posiciones.get("4")).toMatchObject({ pos_x: 3.6, pos_y: 2.2 });
    expect(d.posiciones.get("3")).toMatchObject({ pos_x: 2, pos_y: 2.2 });
    expect(d.uniones[0].texto).toBe("3+4 · 8 plazas");
  });

  it("aunque la unida esté debajo, la fila es horizontal si cabe", () => {
    const d = dibujarUniones(filas, unir([["3", "8"]]), { plano });
    expect(d.uniones[0]).toMatchObject({ horizontal: true, alto: 80, ancho: 320 });
    for (const id of ["3", "8"]) expect(d.giros.get(id)!.vertical).toBe(false);
  });

  it("fila de tres 3+4+5: 6 piezas seguidas, sin pisarse, dentro de las paredes", () => {
    const d = dibujarUniones(filas, unir([["3", "4"], ["3", "5"]]), { plano });
    const u = d.uniones[0];
    expect(u).toMatchObject({ texto: "3+4+5 · 12 plazas", horizontal: true, ancho: 480, alto: 80 });
    const rs = ["3", "4", "5"].map((id) => caja(d.posiciones.get(id)!));
    expect(pisan(rs[0], rs[1]) || pisan(rs[1], rs[2]) || pisan(rs[0], rs[2])).toBe(false);
    expect(dentro(caja(u), { izq: 0, der: 12, arr: 0, aba: 8 })).toBe(true);
  });

  it("no se sale de las paredes: si hacia la unida no cabe, crece hacia el otro lado", () => {
    // La unida está a la derecha, pegada a la pared de la derecha: hacia allí no cabe.
    const a = fila("a", 9, 3);
    const b = fila("b", 10.2, 5);
    const d = dibujarUniones([a, b], unir([["a", "b"]], piezasDe([a, b])), { plano });
    const u = d.uniones[0];
    expect(u.horizontal).toBe(true);
    expect(dentro(caja(u), { izq: 0, der: 12, arr: 0, aba: 8 })).toBe(true);
    // La principal no se mueve; la b va a su izquierda.
    expect(d.posiciones.get("a")).toMatchObject({ pos_x: 9, pos_y: 3 });
    expect(d.posiciones.get("b")).toMatchObject({ pos_x: 7.4, pos_y: 3 });
  });

  it("si no cabe por ningún lado, se desplaza lo mínimo y deja 0,6 m a la pared para las sillas", () => {
    // Sala de 4,4 m de ancho: la fila (3,2 m) + 2 × 0,6 m solo cabe pegada a 0,6 m de la pared izquierda.
    const justa = {
      pixels_per_meter: 50,
      configuracion: { elementos: [pared(0, 0, 4.4, 0), pared(4.4, 0, 4.4, 10), pared(4.4, 10, 0, 10), pared(0, 10, 0, 0)] },
    };
    const a = fila("a", 1.5, 3);
    const b = fila("b", 2, 5);
    const u = dibujarUniones([a, b], unir([["a", "b"]], piezasDe([a, b])), { plano: justa }).uniones[0];
    expect(u.horizontal).toBe(true);
    expect(u.pos_x).toBeCloseTo(0.6, 6);
    expect(u.pos_y).toBeCloseTo(3, 6);
    expect(dentro(caja(u), { izq: 0, der: 4.4, arr: 0, aba: 10 })).toBe(true);
  });

  it("no pisa otras mesas: si a la derecha estorba una mesa, crece hacia el otro lado", () => {
    const a = fila("a", 3, 3);
    const b = fila("b", 4.8, 4.5); // la unida, a la derecha
    const otra = fila("otra", 5.2, 2.6); // estorba a la derecha de la principal
    const d = dibujarUniones([a, b, otra], unir([["a", "b"]], piezasDe([a, b, otra])), { plano });
    const u = caja(d.uniones[0]);
    expect(pisan(u, caja({ pos_x: 5.2, pos_y: 2.6, ancho: 160, alto: 80 }))).toBe(false);
    expect(d.uniones[0].horizontal).toBe(true);
    // La principal queda en su sitio, en la punta derecha, y la b a su izquierda.
    expect(d.posiciones.get("a")).toMatchObject({ pos_x: 3, pos_y: 3 });
    expect(d.posiciones.get("b")).toMatchObject({ pos_x: 1.4, pos_y: 3 });
    expect(d.giros.get("b")!.ladoPico).toBe("izquierda");
    expect(d.giros.get("a")!.ladoPico).toBe("derecha");
  });

  it("si en horizontal no cabe en la sala, va en vertical", () => {
    // Sala estrecha de 4 × 10 m: 2 mesas de 1,6 m = 3,2 m + 2 × 0,6 m de sillas > 4 m.
    const estrecha = {
      pixels_per_meter: 50,
      configuracion: { elementos: [pared(0, 0, 4, 0), pared(4, 0, 4, 10), pared(4, 10, 0, 10), pared(0, 10, 0, 0)] },
    };
    const a = fila("a", 1, 3);
    const b = fila("b", 1.5, 4.5);
    const d = dibujarUniones([a, b], unir([["a", "b"]], piezasDe([a, b])), { plano: estrecha });
    const u = d.uniones[0];
    expect(u).toMatchObject({ horizontal: false, ancho: 80, alto: 320 });
    expect(d.giros.get("a")!.vertical).toBe(true);
    expect(d.posiciones.get("a")).toMatchObject({ ancho: 80, alto: 160 });
    expect(dentro(caja(u), { izq: 0, der: 4, arr: 0, aba: 10 })).toBe(true);
  });

  it("sin paredes dibujadas usa el rectángulo del plano", () => {
    const sinParedes = { pixels_per_meter: 50, ancho_metros: 6, alto_metros: 6, configuracion: { elementos: [] } };
    const a = fila("a", 4, 1);
    const b = fila("b", 4.2, 3);
    const u = dibujarUniones([a, b], unir([["a", "b"]], piezasDe([a, b])), { plano: sinParedes }).uniones[0];
    expect(dentro(caja(u), { izq: 0, der: 6, arr: 0, aba: 6 })).toBe(true);
  });

  it("sala en L: la fila no cruza una pared interior", () => {
    // Pared interior vertical en x=6, de y=0 a y=4.
    const enL = { ...plano, configuracion: { elementos: [...plano.configuracion.elementos, pared(6, 0, 6, 4)] } };
    const a = fila("a", 4, 2);
    const b = fila("b", 5, 3);
    const u = caja(dibujarUniones([a, b], unir([["a", "b"]], piezasDe([a, b])), { plano: enL }).uniones[0]);
    const cruza = u.x - 0.6 < 6 && 6 < u.x + u.w + 0.6 && u.y - 0.6 < 4;
    expect(cruza).toBe(false);
  });

  it("separar devuelve cada mesa a su sitio del plano", () => {
    const junta = unir([["3", "4"]]);
    const separada = aplicarCambios(junta, separar(p("3"), piezas, junta));
    const d = dibujarUniones(filas, separada, { plano });
    expect(d.uniones).toEqual([]);
    expect(aplicarPosicionesUnion(filas, d).find((m) => m.id === "4")).toMatchObject({ pos_x: 3.6, pos_y: 2.2 });
  });

  it("ignora uniones con mesas que no se pintan (sin piezas en el servicio)", () => {
    const d = dibujarUniones([m3, m5], unir([["3", "4"]]), { plano });
    expect(d.uniones).toEqual([]);
  });
});
