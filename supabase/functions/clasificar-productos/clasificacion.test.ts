import { describe, expect, it, vi } from "vitest";
import {
  agruparPendientes,
  type Categoria,
  clasificarPendientes,
  construirMensajes,
  type LineaPendiente,
  type ProductoCatalogo,
  validarAsignaciones,
} from "./clasificacion.ts";

const categorias: Categoria[] = [
  { id: 1, nombre: "Bebidas", padre_id: null, descripcion: null, activa: true },
  { id: 2, nombre: "Vinos", padre_id: 1, descripcion: "Vino y cava", activa: true },
  { id: 3, nombre: "Lácteos y huevos", padre_id: null, descripcion: null, activa: true },
  { id: 4, nombre: "Vieja", padre_id: null, descripcion: null, activa: false },
];
const catalogo: ProductoCatalogo[] = [{ id: 10, nombre: "Nata Natop Debic 2 L", categoria_id: 3 }];

const linea = (id: number, nombre: string, norm: string | null, extra: Partial<LineaPendiente> = {}): LineaPendiente => ({
  id, nombre, nombre_normalizado: norm, unidad: "ud", precio_unitario: "4.14", proveedor: "LUGA", ...extra,
});

describe("agruparPendientes", () => {
  it("junta las líneas con el mismo texto normalizado y descarta los vacíos", () => {
    const g = agruparPendientes([
      linea(1, "NATOP 2L", "natop 2l"),
      linea(2, "Natop 2L", "natop 2l"),
      linea(3, "  ", ""),
      linea(4, "Vino X", "vino x", { precio_unitario: null }),
    ]);
    expect(g).toEqual([
      { texto: "natop 2l", ejemplo: "NATOP 2L", proveedor: "LUGA", unidad: "ud", precio: 4.14, lineas: 2 },
      { texto: "vino x", ejemplo: "Vino X", proveedor: "LUGA", unidad: "ud", precio: null, lineas: 1 },
    ]);
  });

  it("no pasa del máximo de textos distintos", () => {
    const g = agruparPendientes([linea(1, "a", "a"), linea(2, "b", "b"), linea(3, "c", "c")], 2);
    expect(g.map((t) => t.texto)).toEqual(["a", "b"]);
  });
});

describe("construirMensajes", () => {
  it("lista categorías activas con su ruta, el catálogo y los textos exactos", () => {
    const [sistema, usuario] = construirMensajes(agruparPendientes([linea(1, "NATOP", "natop")]), catalogo, categorias);
    expect(sistema.content).toContain("2: Bebidas › Vinos — Vino y cava");
    expect(sistema.content).not.toContain("Vieja");
    expect(usuario.content).toContain("10|Nata Natop Debic 2 L|3");
    expect(usuario.content).toContain('"t":"natop"');
  });
});

describe("validarAsignaciones", () => {
  const textos = agruparPendientes([
    linea(1, "NATOP", "natop"),
    linea(2, "PINGUS 23", "pingus 23"),
    linea(3, "PINGUS 2023", "pingus 2023", { unidad: "botella" }),
    linea(4, "RARO", "raro"),
  ]);

  it("acepta producto existente, junta los nuevos con el mismo nombre y descarta basura", () => {
    const items = validarAsignaciones(
      {
        asignaciones: [
          { texto: "natop", producto_id: 10, nombre_nuevo: null, categoria_id: null },
          { texto: "pingus 23", producto_id: null, nombre_nuevo: "Flor de  Pingus", categoria_id: 2 },
          { texto: "pingus 2023", producto_id: null, nombre_nuevo: "flor de pingus", categoria_id: null },
          { texto: "inventado", producto_id: 10, nombre_nuevo: null, categoria_id: null },
          { texto: "raro", producto_id: 999, nombre_nuevo: "  ", categoria_id: 2 },
          { texto: "natop", producto_id: null, nombre_nuevo: "Duplicado", categoria_id: 3 },
        ],
      },
      textos,
      catalogo,
      categorias,
    );
    expect(items).toEqual([
      { textos: ["natop"], producto_id: 10, nombre: null, categoria_id: null, unidad: null },
      { textos: ["pingus 23", "pingus 2023"], producto_id: null, nombre: "Flor de Pingus", categoria_id: 2, unidad: "ud" },
    ]);
  });

  it("un id de producto que no existe cae a producto nuevo; una categoría desactivada se ignora", () => {
    const items = validarAsignaciones(
      { asignaciones: [{ texto: "raro", producto_id: 999, nombre_nuevo: "Cosa rara", categoria_id: 4 }] },
      textos,
      catalogo,
      categorias,
    );
    expect(items).toEqual([{ textos: ["raro"], producto_id: null, nombre: "Cosa rara", categoria_id: null, unidad: "ud" }]);
  });

  it("una respuesta sin forma no propone nada", () => {
    expect(validarAsignaciones(null, textos, catalogo, categorias)).toEqual([]);
    expect(validarAsignaciones({ asignaciones: "no" }, textos, catalogo, categorias)).toEqual([]);
  });
});

/** Doble mínimo del cliente de Supabase: from(tabla) encadenable + rpc. */
function dobleSupabase(datos: Record<string, unknown[]>) {
  const rpc = vi.fn(async () => ({ data: { productos_creados: 1, alias_creados: 1, lineas_asignadas: 2 }, error: null }));
  const from = (tabla: string) => {
    const cadena: Record<string, unknown> = {};
    for (const m of ["select", "is", "order", "limit"]) cadena[m] = () => cadena;
    cadena.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: datos[tabla] ?? [], error: null }).then(ok);
    return cadena;
  };
  return { supabase: { from, rpc }, rpc };
}

describe("clasificarPendientes", () => {
  it("sin líneas pendientes no llama al modelo", async () => {
    const { supabase, rpc } = dobleSupabase({ productos_factura: [] });
    const llamarModelo = vi.fn();
    const r = await clasificarPendientes({ supabase, llamarModelo });
    expect(r).toEqual({ pendientes: 0, textos: 0, propuestas: 0, aplicado: null });
    expect(llamarModelo).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("manda a la RPC solo lo validado", async () => {
    const { supabase, rpc } = dobleSupabase({
      productos_factura: [
        { id: 1, nombre: "NATOP", nombre_normalizado: "natop", unidad: "kg", precio_unitario: 4.14, facturas: { proveedor: "LUGA" } },
        { id: 2, nombre: "Natop", nombre_normalizado: "natop", unidad: "kg", precio_unitario: 4.14, facturas: { proveedor: "LUGA" } },
      ],
      productos_catalogo: catalogo,
      categorias_producto: categorias,
    });
    const llamarModelo = vi.fn(async () => ({
      asignaciones: [{ texto: "natop", producto_id: 10, nombre_nuevo: null, categoria_id: null }],
    }));
    const r = await clasificarPendientes({ supabase, llamarModelo });
    expect(llamarModelo).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("productos_aplicar_clasificacion_ia", {
      p_items: [{ textos: ["natop"], producto_id: 10, nombre: null, categoria_id: null, unidad: null }],
    });
    expect(r).toMatchObject({ pendientes: 2, textos: 1, propuestas: 1, aplicado: { lineas_asignadas: 2 } });
  });
});
