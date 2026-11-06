// «Personalizar» el tablero de Facturas › Análisis (06/11/2026): catálogo,
// cambios (activar, quitar, mover, tamaño, restablecer), rejilla «bento» y
// lectura/escritura de la fila de `dashboard_config`.
import { describe, expect, it } from "vitest";
import {
  activarCifra,
  activarModulo,
  aFilaBd,
  cambiarTamano,
  CIFRAS,
  colocarBento,
  columnasDe,
  CONFIG_TABLERO_POR_DEFECTO,
  deFilaBd,
  elegirProducto,
  MAX_CIFRAS,
  MODULOS,
  moverCifra,
  moverEnLista,
  moverModulo,
  normalizarConfigTablero,
  tramosModulos,
  type ConfigTablero,
} from "../widgetsTablero";

const D = CONFIG_TABLERO_POR_DEFECTO;
const ids = (c: ConfigTablero) => c.modulos.map((m) => m.id);

describe("catálogo y configuración por defecto", () => {
  it("por defecto: las 4 cifras de siempre, Explorar y las 6 tarjetas pequeñas", () => {
    expect(D.cifras).toEqual(["gasto", "abonos", "regalado", "por_revisar"]);
    expect(ids(D)).toEqual(["explorar", "proveedores", "subidas", "familias", "fijos", "abonos", "locales"]);
    expect(D.modulos.filter((m) => m.id !== "explorar").every((m) => m.tamano === "s")).toBe(true);
  });

  it("el catálogo trae más de lo que sale por defecto (cifras y módulos nuevos)", () => {
    expect(CIFRAS.map((c) => c.id)).toEqual(expect.arrayContaining(["gasto_este_mes", "media_mes", "documentos", "proveedores", "fijos_mes", "retencion"]));
    expect(MODULOS.map((m) => m.id)).toEqual(expect.arrayContaining(["gasto_mes", "productos", "por_revisar", "regalado"]));
    // Sin ids repetidos.
    expect(new Set(CIFRAS.map((c) => c.id)).size).toBe(CIFRAS.length);
    expect(new Set(MODULOS.map((m) => m.id)).size).toBe(MODULOS.length);
  });
});

describe("normalizarConfigTablero (lo guardado no se fía)", () => {
  it("basura o vacío → la de por defecto", () => {
    for (const x of [null, undefined, 3, "hola", [], {}, { cifras: "no" }]) expect(normalizarConfigTablero(x)).toEqual(D);
  });

  it("quita lo desconocido y lo repetido; los tamaños raros vuelven al del módulo", () => {
    const c = normalizarConfigTablero({
      cifras: ["abonos", "abonos", "inventada", "gasto"],
      modulos: [{ id: "familias", tamano: "xl" }, "proveedores", { id: "familias", tamano: "l" }, { id: "nope" }, { id: "explorar", tamano: "s" }],
    });
    expect(c.cifras).toEqual(["abonos", "gasto"]);
    expect(c.modulos).toEqual([
      { id: "familias", tamano: "s" },
      { id: "proveedores", tamano: "s" },
      { id: "explorar", tamano: "l" },
    ]);
  });

  it("Explorar siempre está (si falta, al principio) y siempre es grande", () => {
    const c = normalizarConfigTablero({ cifras: [], modulos: [{ id: "abonos", tamano: "m" }] });
    expect(c.modulos).toEqual([
      { id: "explorar", tamano: "l" },
      { id: "abonos", tamano: "m" },
    ]);
    expect(cambiarTamano(c, "explorar", "s").modulos[0].tamano).toBe("l");
  });

  it("todo quitado es una configuración válida (solo Explorar)", () => {
    expect(normalizarConfigTablero({ cifras: [], modulos: [] })).toEqual({ cifras: [], modulos: [{ id: "explorar", tamano: "l" }] });
  });
});

describe("cambios", () => {
  it("activar y quitar cifras (máximo 8) y módulos (Explorar no se quita)", () => {
    let c = activarCifra(D, "media_mes", true);
    expect(c.cifras).toEqual(["gasto", "abonos", "regalado", "por_revisar", "media_mes"]);
    expect(activarCifra(c, "media_mes", true)).toBe(c);
    c = activarCifra(c, "abonos", false);
    expect(c.cifras).not.toContain("abonos");
    let lleno: ConfigTablero = { ...D, cifras: CIFRAS.slice(0, MAX_CIFRAS).map((x) => x.id) };
    lleno = activarCifra(lleno, CIFRAS[MAX_CIFRAS].id, true);
    expect(lleno.cifras).toHaveLength(MAX_CIFRAS);

    c = activarModulo(D, "productos", true);
    expect(c.modulos.at(-1)).toEqual({ id: "productos", tamano: "s" });
    expect(activarModulo(D, "gasto_mes", true).modulos.at(-1)).toEqual({ id: "gasto_mes", tamano: "m" });
    expect(ids(activarModulo(c, "proveedores", false))).not.toContain("proveedores");
    expect(activarModulo(D, "explorar", false)).toBe(D);
  });

  it("mover con subir/bajar (sin salirse) y arrastrando", () => {
    expect(moverCifra(D, "abonos", -1).cifras).toEqual(["abonos", "gasto", "regalado", "por_revisar"]);
    expect(moverCifra(D, "gasto", -1).cifras).toEqual(D.cifras);
    expect(moverCifra(D, "por_revisar", 1).cifras).toEqual(D.cifras);
    expect(ids(moverModulo(D, "explorar", 1)).slice(0, 2)).toEqual(["proveedores", "explorar"]);
    expect(moverEnLista(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moverEnLista(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moverEnLista(["a", "b"], 0, 9)).toEqual(["a", "b"]);
  });

  it("tamaño de un módulo", () => {
    const c = cambiarTamano(D, "familias", "l");
    expect(c.modulos.find((m) => m.id === "familias")?.tamano).toBe("l");
    expect(D.modulos.find((m) => m.id === "familias")?.tamano).toBe("s");
  });

  it("Explorar parte la rejilla en «antes» y «después»", () => {
    expect(tramosModulos(D).antes).toEqual([]);
    expect(tramosModulos(D).despues).toHaveLength(6);
    const c = moverModulo(moverModulo(D, "explorar", 1), "explorar", 1);
    expect(tramosModulos(c).antes.map((m) => m.id)).toEqual(["proveedores", "subidas"]);
    expect(tramosModulos(c).despues.map((m) => m.id)).toEqual(["familias", "fijos", "abonos", "locales"]);
  });
});

describe("«Evolución de un producto»", () => {
  it("guarda el producto elegido (solo en ese módulo) y se puede volver a elegir", () => {
    let c = activarModulo(D, "precio_producto", true);
    expect(c.modulos.at(-1)).toEqual({ id: "precio_producto", tamano: "m" });
    c = elegirProducto(c, "  MERLUZA DE PINCHO  ");
    expect(c.modulos.at(-1)).toEqual({ id: "precio_producto", tamano: "m", producto: "MERLUZA DE PINCHO" });
    expect(deFilaBd(aFilaBd(c))).toEqual(c);
    expect(normalizarConfigTablero(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(elegirProducto(c, null).modulos.at(-1)).toEqual({ id: "precio_producto", tamano: "m" });
    // Un producto en otro módulo no se guarda.
    expect(normalizarConfigTablero({ cifras: [], modulos: [{ id: "abonos", producto: "x" }] }).modulos[1]).toEqual({ id: "abonos", tamano: "s" });
  });
});

describe("rejilla «bento»", () => {
  it("pequeño 1 columna, mediano 2, grande 3; nunca más de las que hay", () => {
    expect([columnasDe("s", 3), columnasDe("m", 3), columnasDe("l", 3)]).toEqual([1, 2, 3]);
    expect([columnasDe("s", 2), columnasDe("m", 2), columnasDe("l", 2)]).toEqual([1, 2, 2]);
    expect([columnasDe("s", 1), columnasDe("m", 1), columnasDe("l", 1)]).toEqual([1, 1, 1]);
  });

  it("los pequeños rellenan los huecos (como `grid-auto-flow: dense`)", () => {
    // [ M M ][ S ]   ← el pequeño que va DESPUÉS del grande sube al hueco
    // [ L L L ]
    const sitio = colocarBento(
      [
        { id: "gasto_mes", tamano: "m" },
        { id: "familias", tamano: "l" },
        { id: "abonos", tamano: "s" },
      ],
      3,
    );
    expect(sitio).toEqual([
      { id: "gasto_mes", fila: 0, columna: 0, ancho: 2 },
      { id: "familias", fila: 1, columna: 0, ancho: 3 },
      { id: "abonos", fila: 0, columna: 2, ancho: 1 },
    ]);
    // Seis pequeños en 3 columnas: dos filas completas; en 2 columnas, tres.
    const seis = D.modulos.filter((m) => m.id !== "explorar");
    expect(Math.max(...colocarBento(seis, 3).map((x) => x.fila))).toBe(1);
    expect(Math.max(...colocarBento(seis, 2).map((x) => x.fila))).toBe(2);
  });
});

describe("dashboard_config", () => {
  it("ida y vuelta: widgets_activos lleva lo que se ve en orden; orden_widgets, los ids", () => {
    const c = cambiarTamano(activarCifra(activarModulo(D, "productos", true), "retencion", true), "productos", "m");
    const fila = aFilaBd(c);
    expect(fila.orden_widgets.slice(0, 5)).toEqual(["cifra:gasto", "cifra:abonos", "cifra:regalado", "cifra:por_revisar", "cifra:retencion"]);
    expect(fila.widgets_activos).toContainEqual({ tipo: "modulo", id: "productos", tamano: "m" });
    expect(deFilaBd(JSON.parse(JSON.stringify(fila)))).toEqual(c);
  });

  it("una fila vacía o rara no es configuración (se queda la que hay)", () => {
    expect(deFilaBd(null)).toBeNull();
    expect(deFilaBd({ widgets_activos: [] })).toBeNull();
    expect(deFilaBd({ widgets_activos: "x" })).toBeNull();
  });
});
