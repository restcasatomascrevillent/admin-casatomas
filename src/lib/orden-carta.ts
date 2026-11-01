// Orden de los elementos de la carta dentro de su categoría
// ---------------------------------------------------------------------------
// Contrato con las webs públicas: en `orden` se guardan enteros consecutivos
// empezando en 1 DENTRO de cada categoría (1, 2, 3…). Antes de poder ordenar,
// toda la carta tenía 0 (y 6 vinos, null): una categoría sin ordenar se sigue
// viendo como siempre, un alta nueva va detrás (mayor + 1) y los null, al
// final (NULLS LAST, como Postgres).
//
// En Platos y Vinos la columna era TEXTO y la base de datos ordena texto
// alfabéticamente ("10" antes que "2"). La migración
// 20261101090000_carta_orden_entero.sql la pasa a entero; mientras no esté
// aplicada, el panel ordena igualmente por número aquí (en cliente) y escribe
// números, que PostgREST guarda como "1", "2"… en una columna de texto.
// ---------------------------------------------------------------------------
import { supabase } from "@/integrations/supabase/client";
import type { TablaCarta } from "@/lib/storage-carta";

/** `orden` tal y como llega de la base de datos (texto en Platos/Vinos hasta la migración). */
export type ValorOrden = string | number | null | undefined;

export interface CambioOrden {
  id: string;
  orden: number;
}

/** "3" → 3, 3 → 3; null, "", "abc" o 2,5 → null (sin orden válido). */
export function valorOrden(orden: ValorOrden): number | null {
  if (orden === null || orden === undefined) return null;
  if (typeof orden === "number") return Number.isInteger(orden) ? orden : null;
  const texto = String(orden).trim();
  if (!/^-?\d+$/.test(texto)) return null;
  return Number(texto);
}

/** Comparador numérico: los que no tienen orden válido, al final (como NULLS LAST de Postgres). */
export function compararOrden(a: ValorOrden, b: ValorOrden): number {
  const va = valorOrden(a);
  const vb = valorOrden(b);
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return va - vb;
}

/**
 * Copia ordenada por `orden` numérico. Es estable: a igual orden se respeta el
 * orden en que llegaron (el de la consulta), así una categoría sin ordenar
 * (todo a 0) no se baraja al refrescar.
 */
export function ordenarPorOrden<T extends { orden?: ValorOrden }>(items: readonly T[]): T[] {
  return items
    .map((item, indice) => ({ item, indice }))
    .sort((a, b) => compararOrden(a.item.orden, b.item.orden) || a.indice - b.indice)
    .map(({ item }) => item);
}

/** Categorías distintas, sin vacías, en orden alfabético (no dependen del orden de los elementos). */
export function categoriasOrdenadas(items: readonly { categoria?: string | null }[] | undefined): string[] {
  if (!items) return [];
  const unicas = Array.from(new Set(items.map((i) => i.categoria).filter((c): c is string => Boolean(c))));
  return unicas.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

/** Siguiente posición libre al final de una categoría: el mayor orden + 1 (1 si no hay ninguno). */
export function siguienteOrden(ordenes: readonly ValorOrden[]): number {
  let mayor = 0;
  for (const o of ordenes) {
    const v = valorOrden(o);
    if (v !== null && v > mayor) mayor = v;
  }
  return mayor + 1;
}

/**
 * Lo que hay que escribir para dejar `idsEnOrden` como 1, 2, 3…: solo los que
 * cambian (un elemento que ya tiene su número no se vuelve a guardar).
 */
export function cambiosDeOrden(
  items: readonly { id: string; orden?: ValorOrden }[],
  idsEnOrden: readonly string[],
): CambioOrden[] {
  const actual = new Map(items.map((i) => [i.id, valorOrden(i.orden)]));
  const cambios: CambioOrden[] = [];
  idsEnOrden.forEach((id, indice) => {
    const orden = indice + 1;
    if (actual.get(id) !== orden) cambios.push({ id, orden });
  });
  return cambios;
}

/**
 * Siguiente orden de `categoria` para un alta (o un cambio de categoría):
 * se pregunta a la base de datos (la caché puede estar vieja) y, si la consulta
 * falla, se calcula con lo que haya en caché. Nunca lanza.
 */
export async function consultarSiguienteOrden(
  tabla: TablaCarta,
  categoria: string,
  enCache: readonly { categoria?: string | null; orden?: ValorOrden; id?: string }[] | undefined,
  excluirId?: string,
): Promise<number> {
  const desdeCache = () =>
    siguienteOrden((enCache ?? []).filter((i) => i.categoria === categoria && i.id !== excluirId).map((i) => i.orden));
  try {
    const { data, error } = await supabase.from(tabla).select("id, orden").eq("categoria", categoria);
    if (error || !Array.isArray(data)) return desdeCache();
    return siguienteOrden(
      (data as { id: string; orden: ValorOrden }[]).filter((f) => f.id !== excluirId).map((f) => f.orden),
    );
  } catch {
    return desdeCache();
  }
}

/** Peticiones simultáneas como mucho (el móvil con poca cobertura agradece no abrir 40 a la vez). */
const LOTE = 6;

/**
 * Escribe el orden nuevo fila a fila (un UPDATE por elemento que cambia; no
 * hay RPC para hacerlo de golpe). Lanza si alguna no se guarda, diciendo
 * cuántas: el resto sí quedan guardadas y basta con volver a guardar.
 */
export async function guardarOrdenEnTabla(tabla: TablaCarta, cambios: readonly CambioOrden[]): Promise<void> {
  let fallidas = 0;
  let primerError: unknown = null;
  for (let i = 0; i < cambios.length; i += LOTE) {
    const lote = cambios.slice(i, i + LOTE);
    const resultados = await Promise.all(
      lote.map(async ({ id, orden }) => {
        try {
          // `as never`: los tipos generados aún dicen texto en Platos/Vinos.
          return await supabase.from(tabla).update({ orden } as never).eq("id", id).select("id");
        } catch (error) {
          return { data: null, error };
        }
      }),
    );
    for (const r of resultados) {
      // Con RLS, un UPDATE sin permiso no da error: afecta a 0 filas.
      if (r.error || !(r.data as unknown[] | null)?.length) {
        fallidas++;
        primerError ??= r.error;
      }
    }
  }
  if (fallidas > 0) {
    if (primerError) console.error(`Orden de ${tabla} no guardado del todo:`, primerError);
    throw new Error(
      `No se ha podido guardar la posición de ${fallidas} de ${cambios.length}. Vuelve a pulsar «Guardar orden».`,
    );
  }
}
