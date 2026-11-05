// ============================================================================
// CARGA ESCALONADA DE DOCUMENTOS (05/11/2026)
// ----------------------------------------------------------------------------
// PostgREST corta cada petición a 1.000 filas (`max-rows`) y no avisa. Con el
// histórico importado hay ~1.900 facturas: una sola consulta enseñaba solo las
// 1.000 más recientes. Además, traerlas todas con sus líneas antes de pintar
// nada hacía esperar.
//
// Esta función lee por TANDAS (`.range`), de la más reciente a la más antigua:
//   · CARGA INICIAL (no hay nada en caché): tras cada tanda escribe en la caché
//     de React Query lo que lleva, así la lista sale con la primera tanda
//     (pequeña) y las anteriores van apareciendo solas.
//   · REFRESCO (ya había datos, p. ej. tras editar una factura): NO toca la
//     caché hasta el final; la lista sigue mostrando lo de antes y se sustituye
//     de una vez. Así no «encoge» a la primera tanda en cada refresco.
// Una tanda más corta que lo pedido es la última. Las filas repetidas (por un
// documento nuevo que desplaza el orden entre tandas) se descartan por `id`.
// Quien llama pone el orden, que tiene que ser total (desempate por `id`).
// ============================================================================

export interface CacheEscalonada<T> {
  getQueryData: (clave: readonly unknown[]) => T[] | undefined;
  setQueryData: (clave: readonly unknown[], datos: T[]) => unknown;
}

export interface OpcionesCargaEscalonada {
  /** Tamaño de la primera tanda (la que se ve enseguida). */
  primeraTanda?: number;
  /** Tamaño de las siguientes. No más de 1.000 (`max-rows` de Supabase). */
  tanda?: number;
  /** Freno de seguridad: filas máximas. */
  limite?: number;
  signal?: AbortSignal;
}

export const PRIMERA_TANDA = 150;
export const TANDA = 1000;
export const LIMITE_DOCUMENTOS = 50_000;

export async function cargarEscalonado<T extends { id: number }>(
  cache: CacheEscalonada<T>,
  clave: readonly unknown[],
  leer: (primera: number, ultima: number) => Promise<T[]>,
  { primeraTanda = PRIMERA_TANDA, tanda = TANDA, limite = LIMITE_DOCUMENTOS, signal }: OpcionesCargaEscalonada = {},
): Promise<T[]> {
  const esRefresco = cache.getQueryData(clave) !== undefined;
  const acumulado: T[] = [];
  const vistos = new Set<number>();
  let desde = 0;
  let tam = primeraTanda;

  while (desde < limite) {
    if (signal?.aborted) break;
    const filas = await leer(desde, desde + tam - 1);
    for (const f of filas) {
      if (vistos.has(f.id)) continue;
      vistos.add(f.id);
      acumulado.push(f);
    }
    if (filas.length < tam) break;
    desde += filas.length;
    tam = tanda;
    if (!esRefresco && !signal?.aborted) cache.setQueryData(clave, [...acumulado]);
  }
  return acumulado;
}
