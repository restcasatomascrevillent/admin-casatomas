// Doble de `supabase` para Facturas › Productos: `rpc(nombre, args)` contesta
// lo que diga `rpcs[nombre]`, `from(tabla)` es una cadena que acepta cualquier
// filtro y al hacer `await` contesta `tablas[tabla]` (o el error fijado), y
// `functions.invoke` es un vi.fn.
import { vi } from "vitest";

export interface Resp {
  data: unknown;
  error: { code?: string; message: string } | null;
}

export function crearDobleProductos() {
  let rpcs: Record<string, (args: Record<string, unknown>) => Resp> = {};
  let tablas: Record<string, Resp> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) =>
    rpcs[fn] ? rpcs[fn](args) : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } },
  );
  const filtros: { tabla: string; metodo: string; args: unknown[] }[] = [];
  const from = vi.fn((tabla: string) => {
    const cadena: Record<string, unknown> = new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            const r = tablas[tabla] ?? { data: [], error: null };
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko);
          }
          if (prop === "single" || prop === "maybeSingle") {
            return async () => tablas[tabla] ?? { data: null, error: null };
          }
          return (...args: unknown[]) => {
            filtros.push({ tabla, metodo: prop, args });
            return cadena;
          };
        },
      },
    );
    return cadena;
  });
  const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
  return {
    supabase: { rpc, from, functions: { invoke } },
    rpc,
    from,
    invoke,
    filtros,
    fijarRpc(nombre: string, f: (args: Record<string, unknown>) => Resp) {
      rpcs[nombre] = f;
    },
    fijarTabla(tabla: string, r: Resp) {
      tablas[tabla] = r;
    },
    reiniciar() {
      rpcs = {};
      tablas = {};
      filtros.length = 0;
      rpc.mockClear();
      from.mockClear();
      invoke.mockClear();
    },
  };
}

export const doble = crearDobleProductos();

// ─── Datos de ejemplo (sacados de la carga inicial del 07/10/2026) ──────────
export const CATEGORIAS = [
  { id: 1, clave: "bebidas", nombre: "Bebidas", descripcion: null, padre_id: null, orden: 10, activa: true },
  { id: 2, clave: "bebidas.vinos", nombre: "Vinos", descripcion: null, padre_id: 1, orden: 10, activa: true },
  { id: 3, clave: "bebidas.licores", nombre: "Licores y destilados", descripcion: null, padre_id: 1, orden: 30, activa: true },
  { id: 4, clave: "pescado_marisco", nombre: "Pescado y marisco", descripcion: null, padre_id: null, orden: 20, activa: true },
  { id: 5, clave: "pescado_marisco.marisco", nombre: "Marisco", descripcion: null, padre_id: 4, orden: 20, activa: true },
  { id: 6, clave: "servicios", nombre: "Servicios", descripcion: null, padre_id: null, orden: 110, activa: true },
];

const fila = (id: number, nombre: string, categoria_id: number | null, gasto: string, extra: Record<string, unknown> = {}) => ({
  producto_id: id, nombre, categoria_id, origen: "ia", unidad_habitual: "ud", compras: 1, documentos: 1,
  cantidades: { ud: "1.000" }, gasto, lineas_sin_importe: 0, ultimo_precio: gasto, ultima_fecha: "2026-09-28",
  proveedores: ["GRUPO INSULA ROMA S.L."], ...extra,
});

export const RESUMEN = [
  fila(10, "Flor de Pingus", 2, "3022.20", { compras: 1, cantidades: { ud: "36.000" }, ultimo_precio: "83.95" }),
  fila(11, "Flor de Pingus Magnum", 2, "187.40"),
  fila(12, "Tanqueray 70 cl", 3, "273.60", { compras: 2, proveedores: ["BODEGA CAMPOLUZ, S.L."] }),
  fila(13, "Centolla hembra 1-1,5 kg", 5, "279.30", { cantidades: { kg: "5.700" }, proveedores: ["ANGELMAR"] }),
  fila(14, "Portes", 6, "82.45", { compras: 2, proveedores: ["ANGELMAR", "ENCHENTA SLU"] }),
];

export const GASTO = [
  { categoria_id: 2, categoria: "Vinos", padre_id: 1, padre: "Bebidas", sin_clasificar: false, gasto: "3209.60", lineas: 2, productos: 2, lineas_sin_importe: 0 },
  { categoria_id: 3, categoria: "Licores y destilados", padre_id: 1, padre: "Bebidas", sin_clasificar: false, gasto: "273.60", lineas: 2, productos: 1, lineas_sin_importe: 0 },
  { categoria_id: 5, categoria: "Marisco", padre_id: 4, padre: "Pescado y marisco", sin_clasificar: false, gasto: "279.30", lineas: 1, productos: 1, lineas_sin_importe: 0 },
  { categoria_id: 6, categoria: "Servicios", padre_id: null, padre: null, sin_clasificar: false, gasto: "82.45", lineas: 2, productos: 1, lineas_sin_importe: 0 },
  { categoria_id: null, categoria: "Sin clasificar", padre_id: null, padre: null, sin_clasificar: true, gasto: "12.00", lineas: 1, productos: 0, lineas_sin_importe: 0 },
];

export function cargarDatos() {
  doble.fijarTabla("categorias_producto", { data: CATEGORIAS, error: null });
  doble.fijarRpc("productos_resumen", () => ({ data: RESUMEN, error: null }));
  doble.fijarRpc("productos_gasto_por_categoria", () => ({ data: GASTO, error: null }));
  doble.fijarTabla("productos_factura", {
    data: [
      {
        id: 2001, nombre: "Gambas rojas extra", cantidad: "1.000", unidad: "kg", precio_unitario: "12.00", total: "12.00",
        producto_id: null, factura_id: 70, facturas: { fecha: "2026-10-06", proveedor: "ENCHENTA SLU", numero_documento: "A-1", tipo: "albaran" },
      },
    ],
    error: null,
  });
}
