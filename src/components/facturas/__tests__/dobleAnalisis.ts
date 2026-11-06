// Doble de `supabase` para los tests de Facturas › Análisis de «Al instante» y
// del copiloto a pantalla completa (06/11/2026): RPC por nombre (sin respuesta =
// la función no existe aún) y las dos tablas del chat en memoria.
//
// Uso: `vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./dobleAnalisis")).doble.supabase }))`
// y en el test `import { doble } from "./dobleAnalisis"` (misma instancia).
import { vi } from "vitest";

type Fila = Record<string, unknown>;

function crear() {
  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (!rpcs[fn]) return { data: null, error: { code: "PGRST202", message: `no function ${fn}` } };
    try {
      return { data: await rpcs[fn](args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  });
  const invoke = vi.fn();
  const bd = { conversaciones: [] as Fila[], mensajes: [] as Fila[] };
  const lecturas: { tabla: string; llamadas: { metodo: string; args: unknown[] }[] }[] = [];

  const responder = (tabla: string, llamadas: { metodo: string; args: unknown[] }[]) => {
    const metodos = llamadas.map((l) => l.metodo);
    const eq = (col: string) => llamadas.find((l) => l.metodo === "eq" && l.args[0] === col)?.args[1];
    if (tabla === "chat_facturas_conversaciones") {
      if (metodos.includes("insert")) {
        const fila = { id: `c${bd.conversaciones.length + 1}`, session_id: "s1", titulo: "Nueva conversación", created_at: "2026-11-06T10:00:00Z", updated_at: "2026-11-06T10:00:00Z" };
        bd.conversaciones.unshift(fila);
        return fila;
      }
      if (metodos.includes("update") || metodos.includes("delete")) return null;
      if (metodos.includes("maybeSingle")) return bd.conversaciones.find((c) => c.id === eq("id")) ?? null;
      return bd.conversaciones;
    }
    if (tabla === "chat_facturas_mensajes") {
      if (metodos.includes("insert")) {
        const fila = llamadas.find((l) => l.metodo === "insert")?.args[0] as Fila;
        return { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...fila };
      }
      if (metodos.includes("delete")) return null;
      return bd.mensajes.filter((m) => !eq("conversacion_id") || m.conversacion_id === eq("conversacion_id"));
    }
    return [];
  };

  const cadena = (tabla: string, llamadas: { metodo: string; args: unknown[] }[] = []): unknown =>
    new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            lecturas.push({ tabla, llamadas });
            const res = { data: responder(tabla, llamadas), error: null };
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko);
          }
          return (...args: unknown[]) => cadena(tabla, [...llamadas, { metodo: prop, args }]);
        },
      },
    );

  const supabase = {
    from: (t: string) => cadena(t),
    rpc: (...a: unknown[]) => rpc(...(a as [string, Record<string, unknown>])),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => undefined,
    auth: { getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  };

  return {
    supabase,
    rpc,
    rpcs,
    invoke,
    bd,
    lecturas,
    llamadas: (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1]),
    reiniciar() {
      for (const k of Object.keys(rpcs)) delete rpcs[k];
      rpc.mockClear();
      invoke.mockReset();
      bd.conversaciones = [];
      bd.mensajes = [];
      lecturas.length = 0;
    },
  };
}

export const doble = crear();

// ─── Datos de Análisis (los mismos que analisisTablero.test.tsx, recortados) ─

export const TABLERO = {
  periodo: { desde: "2026-01-01", hasta: "2026-12-31", hasta_efectivo: "2026-11-05", local: null, anterior: { desde: "2025-01-01", hasta: "2025-11-05" } },
  sin_datos: false,
  indicadores: {
    gasto: 1362491.57, gasto_anterior: 1200000, documentos_anterior: 1700, variacion_pct: 13.5, documentos: 1884, facturas: 1844,
    albaranes_sin_factura: 40, albaranes_sin_factura_importe: 14915.34, sin_total: 3, abonos: -14376.94, abonos_n: 43,
    regalado: 28204.41, regalado_valia: 107581.24, regalado_lineas: 861, regalado_estimadas: 69, regalado_estimado_importe: 6231.06, proveedores: 245,
  },
  meses: [
    { mes: "2026-06", casa_tomas: 140517.85, touza: 2882.85, total: 143400.7, documentos: 194 },
    { mes: "2026-07", casa_tomas: 160999.23, touza: 4408.77, total: 165408, documentos: 237 },
  ],
  proveedores: Array.from({ length: 7 }, (_, i) => ({ id: 300 + i, nombre: `PROVEEDOR ${i + 1}, S.L.`, gasto: 9000 - i * 1000, pct: 9 - i, documentos: 3 })),
  subidas: { tramo_inicio: { desde: "2026-01-12", hasta: "2026-04-11" }, tramo_fin: { desde: "2026-07-09", hasta: "2026-10-06" }, comparados: 0, productos: [] },
  familias: { importe_total: 1000, lineas: 10, sin_clasificar: { lineas: 0, importe: 0 }, familias: [{ id: 2, familia: "Pescado y marisco", importe: 1000, lineas: 10 }] },
  fijos: { ventana: { desde: "2026-01-01", hasta: "2026-11-05", meses_con_datos: 9 }, total_medio_mes: 0, proveedores: [] },
  abonos: [],
  locales: { casa_tomas: { gasto: 1333190.24, documentos: 1857 }, touza: { gasto: 29301.33, documentos: 27 }, meses: [] },
};

/** explorar_compras de prueba: los meses del tablero (o 3 proveedores). */
export const explorar = (a: Record<string, unknown>) => {
  const tiempo = ["dia", "semana", "mes", "trimestre"].includes(String(a.p_agrupar));
  return {
    parametros: { desde: a.p_desde, hasta: a.p_hasta, hasta_efectivo: "2026-11-05", medida: a.p_medida, agrupar: a.p_agrupar, desglose: a.p_desglose, por_lineas: false, solo_productos: false, unidad: null },
    sin_datos: false,
    total: { valor: 308808.7, documentos: 431, lineas: null, variacion_pct: null },
    anterior: null,
    unidades: null,
    series: a.p_desglose === "local" ? [{ clave: "casa_tomas", etiqueta: "Casa Tomás", id: null, valor: 301517.08 }, { clave: "touza", etiqueta: "Touza", id: null, valor: 7291.62 }] : [],
    puntos: tiempo
      ? TABLERO.meses.map((m) => ({ clave: m.mes, etiqueta: m.mes, id: null, valor: m.total, documentos: m.documentos, desglose: a.p_desglose === "local" ? { casa_tomas: m.casa_tomas, touza: m.touza } : null }))
      : [300, 301, 302].map((id, i) => ({ clave: String(id), etiqueta: `PROVEEDOR ${i + 1}, S.L.`, id, valor: 9000 - i * 1000, documentos: 3, desglose: null })),
    resto: null,
  };
};

export const SERIE = {
  producto: "Merluza",
  unidad: "kg",
  proveedores: ["Flope", "Pescados Paco"],
  puntos: [
    ["2026-08-01", 10.5, 0],
    ["2026-10-02", 12.9, 1],
  ],
  n: 2,
  min: 10.5,
  max: 12.9,
  ultimo: 12.9,
  variacion_pct: 22.9,
};
