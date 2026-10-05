// Doble mínimo de `supabase` para los tests de la subida de facturas: cada
// `from(tabla)` devuelve una cadena que acepta cualquier filtro, los apunta y
// al hacer `await` contesta lo que diga `responder(tabla, filtros)`.
import { vi } from "vitest";

export interface Llamada {
  metodo: string;
  args: unknown[];
}

export function crearDobleSupabase() {
  const inserts: { tabla: string; fila: unknown }[] = [];
  let responder: (tabla: string, llamadas: Llamada[]) => unknown = () => [];
  const invoke = vi.fn();

  const cadena = (tabla: string, llamadas: Llamada[] = []): unknown =>
    new Proxy(
      {},
      {
        get(_obj, prop: string) {
          if (prop === "then") {
            const res = { data: responder(tabla, llamadas), error: null };
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko);
          }
          if (prop === "insert") {
            return (fila: unknown) => {
              inserts.push({ tabla, fila });
              return cadena(tabla, [...llamadas, { metodo: "insert", args: [fila] }]);
            };
          }
          return (...args: unknown[]) => cadena(tabla, [...llamadas, { metodo: prop, args }]);
        },
      },
    );

  const subidas: { bucket: string; path: string }[] = [];
  const supabase = {
    from: (tabla: string) => cadena(tabla),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          subidas.push({ bucket, path });
          return { data: { path }, error: null };
        },
      }),
    },
  };

  return {
    supabase,
    invoke,
    inserts,
    /** Ficheros subidos a Storage (documentos en segundo plano). */
    subidas,
    /** Qué contesta cada consulta. */
    fijarRespuestas(f: (tabla: string, llamadas: Llamada[]) => unknown) {
      responder = f;
    },
    reiniciar() {
      inserts.length = 0;
      subidas.length = 0;
      responder = () => [];
      invoke.mockReset();
    },
  };
}

/** ¿La consulta filtra `columna = valor`? */
export const filtra = (llamadas: Llamada[], columna: string, valor: unknown) =>
  llamadas.some((l) => l.metodo === "eq" && l.args[0] === columna && l.args[1] === valor);

/**
 * Instancia compartida: el `vi.mock` del cliente la importa con
 * `await import("./dobleSupabaseFacturas")` y el test, con un import normal
 * (misma instancia por la caché de módulos).
 */
export const doble = crearDobleSupabase();

/** Respuesta de una procesar-factura desplegada ANTES de los trabajos de una
 *  pieza a {modo:"iniciar"} con una sola pieza: el panel cae al síncrono. */
export const RESPUESTA_SERVIDOR_ANTIGUO = {
  data: { success: false, error: "Un documento de una sola pieza va por el camino normal" },
  error: null,
};
