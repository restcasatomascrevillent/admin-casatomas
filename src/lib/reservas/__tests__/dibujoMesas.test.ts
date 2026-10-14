import { describe, expect, it } from "vitest";
import { aplicarPosicionesUnion, dibujarUniones, divisoresPiezas, type CajaMesa } from "../dibujoMesas";
import { aplicarCambios, estadoServicio, juntar, mesaPiezasDesde, separar, type FilaMesaPiezas } from "../piezasMesa";

// Salón: la 3 y la 4 son de 2 piezas (160 × 80 cm), en fila con 1 m de pasillo entre ellas.
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

describe("dibujarUniones", () => {
  it("sin uniones no mueve nada ni dibuja contornos", () => {
    const d = dibujarUniones(filas, estadoServicio(piezas, []));
    expect(d.uniones).toEqual([]);
    expect(d.posiciones.size).toBe(0);
    expect(aplicarPosicionesUnion(filas, d)).toBe(filas);
  });

  it("3 junta con 4: la 4 se arrima a la derecha de la 3, centrada con ella; contorno y rótulo comunes", () => {
    const estado = aplicarCambios(estadoServicio(piezas, []), juntar(p("3"), p("4"), estadoServicio(piezas, [])));
    const d = dibujarUniones(filas, estado);
    // La 3 (principal) se queda; la 4 pasa de x=3.6 a x=1+1.6=2.6 y de y=2.2 a y=2.
    expect(d.posiciones.has("3")).toBe(false);
    expect(d.posiciones.get("4")).toEqual({ pos_x: 2.6, pos_y: 2 });
    expect(d.uniones).toHaveLength(1);
    expect(d.uniones[0]).toMatchObject({ ids: ["3", "4"], texto: "3+4 · 8 plazas", plazas: 8, pos_x: 1, pos_y: 2, ancho: 320, alto: 80 });
    const vista = aplicarPosicionesUnion(filas, d);
    expect(vista.find((m) => m.id === "4")).toMatchObject({ pos_x: 2.6, pos_y: 2 });
    expect(vista.find((m) => m.id === "5")).toBe(m5);
  });

  it("si la unida está a la izquierda, se arrima por la izquierda", () => {
    const base = estadoServicio(piezas, []);
    const estado = aplicarCambios(base, juntar(p("4"), p("3"), base));
    const d = dibujarUniones(filas, estado);
    // Principal la 4 (x 3.6, y 2.2): la 3 queda pegada a su izquierda (3.6-1.6=2) y a su altura.
    expect(d.posiciones.get("3")).toEqual({ pos_x: 2, pos_y: 2.2 });
    expect(d.uniones[0].texto).toBe("3+4 · 8 plazas");
  });

  it("unión vertical: la 8 (debajo) se arrima por abajo, centrada en x", () => {
    const base = estadoServicio(piezas, []);
    const estado = aplicarCambios(base, juntar(p("3"), p("8"), base));
    const d = dibujarUniones(filas, estado);
    expect(d.posiciones.get("8")).toEqual({ pos_x: 1, pos_y: 2.8 });
    expect(d.uniones[0]).toMatchObject({ pos_x: 1, pos_y: 2, ancho: 160, alto: 160 });
  });

  it("fila de tres 3+4+5: cada una a continuación de la anterior, sin pisarse", () => {
    let estado = estadoServicio(piezas, []);
    estado = aplicarCambios(estado, juntar(p("3"), p("4"), estado));
    estado = aplicarCambios(estado, juntar(p("3"), p("5"), estado));
    const d = dibujarUniones(filas, estado);
    expect(d.posiciones.get("4")).toEqual({ pos_x: 2.6, pos_y: 2 });
    expect(d.posiciones.get("5")).toEqual({ pos_x: 4.2, pos_y: 2 });
    expect(d.uniones[0]).toMatchObject({ texto: "3+4+5 · 12 plazas", ancho: 480 });
  });

  it("separar devuelve cada mesa a su sitio del plano", () => {
    const base = estadoServicio(piezas, []);
    const junta = aplicarCambios(base, juntar(p("3"), p("4"), base));
    const separada = aplicarCambios(junta, separar(p("3"), piezas, junta));
    const d = dibujarUniones(filas, separada);
    expect(d.uniones).toEqual([]);
    expect(aplicarPosicionesUnion(filas, d).find((m) => m.id === "4")).toMatchObject({ pos_x: 3.6, pos_y: 2.2 });
  });

  it("ignora uniones con mesas que no se pintan (sin piezas en el servicio)", () => {
    const base = estadoServicio(piezas, []);
    const estado = aplicarCambios(base, juntar(p("3"), p("4"), base));
    const d = dibujarUniones([m3, m5], estado);
    expect(d.uniones).toEqual([]);
  });
});
