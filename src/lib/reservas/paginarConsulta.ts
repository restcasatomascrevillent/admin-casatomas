// ============================================================================
// LEER TODAS LAS FILAS DE UNA CONSULTA — por lotes (sin React, sin cliente)
// ----------------------------------------------------------------------------
// PostgREST corta CADA petición a 1000 filas (`max-rows`, el tope por defecto de
// Supabase) y no avisa: una consulta que debería traer 1.241 filas trae 1.000 y
// las demás «no existen». Las pantallas que necesitan TODO un conjunto (la
// pestaña Asignación, la Lista de reservas) lo leen entonces por LOTES con
// `.range(primera, ultima)` hasta tenerlo entero. Este módulo es ese bucle; la
// consulta (tabla, filtros, orden) la pone quien llama.
//
// CÓMO LEE
//   1. El primer lote pide también el RECUENTO EXACTO (`count: "exact"`).
//   2. CON recuento sabe cuántas filas hay y, por tanto, cuántos lotes faltan:
//      los pide A LA VEZ, con un máximo de `LOTES_SIMULTANEOS` peticiones en
//      vuelo. Esos lotes ya no piden recuento: contar cuesta lo mismo que leer y
//      con una vez basta. Si el servidor devuelve menos filas por petición de las
//      pedidas (un `max-rows` más bajo que el lote), el paso pasa a ser lo que de
//      verdad ha devuelto el primer lote.
//   3. SIN recuento (el servidor no lo da, o llega como `NaN`, que es lo que saca
//      `postgrest-js` de un `Content-Range: 0-999/*`) lee en SERIE, pidiendo a
//      partir de las filas que ya han llegado, hasta que un lote llega VACÍO. Un
//      lote corto NO es el final: un `max-rows` más bajo que el lote también los
//      da cortos. SIEMPRE cuesta una petición más (la vacía) y no se puede
//      comprobar la coherencia, que necesita el recuento. Caso patológico
//      aceptado: con un servidor que ignorase el rango (y devolviese siempre las
//      mismas 1.000 filas) la lectura acabaría en el tope, con esas 1.000 filas
//      (con `clave`, que descarta las repetidas) y `truncado: true`.
//
// QUÉ GARANTIZA
//   · TODO O NADA: si un lote falla se lanza ESE error (el original, sin
//     envolver) y no se devuelve nada. Nunca salen filas a medias en silencio.
//   · COHERENCIA (solo con recuento): al terminar, y tras descartar las
//     repetidas si hay `clave`, tienen que haber llegado exactamente
//     `min(recuento, LIMITE_FILAS)` filas. Si no, los datos han cambiado mientras
//     se leían los lotes (una fila sale de la vista, o entra otra y todo se
//     desplaza) o un lote ha llegado corto: se lanza `ErrorLecturaInconsistente`
//     en vez de devolver un conjunto con huecos. Con TanStack Query se reintenta
//     solo (3 veces por defecto); en un refresco los datos de antes siguen en
//     pantalla y, si persiste, acaba en `isError`.
//   · TOPE DE SEGURIDAD (`LIMITE_FILAS`): no se leen más filas que esas. Si hay
//     más, se devuelven las primeras (en el orden de la consulta) y `truncado`
//     es `true`: quien llama tiene que decirlo en pantalla. Con recuento es
//     exacto (10.000 justas no son truncado); sin él, llegar al tope sin haber
//     visto un lote vacío se da por truncado, que es lo prudente.
//   · CANCELACIÓN (`signal`): si se aborta, no se lanza ningún lote más. Los que
//     ya están en vuelo terminan, salvo que la propia consulta los aborte (se le
//     pasa el mismo `signal` con `.abortSignal(signal)`). Lo que se lanza depende
//     de CUÁNDO se aborte: ENTRE lotes, `signal.reason` (normalmente un
//     `AbortError`); con un lote en vuelo abortado por `.abortSignal`, el error
//     del `fetch` abortado (con supabase-js, un objeto de postgrest-js
//     `{ message: "AbortError: …", code: "20" }`, SIN `name`). Para saber que fue
//     una cancelación hay que mirar `signal.aborted`, no el tipo del error.
//
// LO QUE LE TOCA A QUIEN LLAMA
//   · ORDEN TOTAL. Con un orden que tenga empates (varias reservas el mismo día
//     a la misma hora), Postgres puede devolver los empatados en otro orden en
//     cada petición y entre dos lotes se REPITEN y se SALTAN filas. El último
//     `.order()` ha de ser una columna única (`id`): es lo que hacen las dos
//     consultas que usan este módulo y sus tests lo comprueban.
//   · `clave`, siempre que haya una columna única. Es lo que convierte un
//     desplazamiento en error: la fila que llega dos veces se descarta, el
//     recuento ya no cuadra y la lectura se rechaza. SIN `clave` una fila repetida
//     y otra saltada se compensan en el recuento y no se detecta.
//   · La LECTURA NO ES ATÓMICA: son varias peticiones. La comprobación de
//     coherencia detecta lo que cambia el total mientras se lee; no detecta un
//     cambio que se compense (entra una fila y sale otra) ni una fila que cambie
//     de valor entre lotes. Eso lo arregla el siguiente refresco, que no siempre
//     es inmediato: la Asignación se refresca con cada evento realtime y, si ya
//     había datos en caché, TanStack Query cancela la lectura en curso y lanza
//     otra. En la CARGA INICIAL (sin datos) no: devuelve la lectura en vuelo y,
//     al terminar, da la consulta por al día, así que un cambio no detectado se
//     queda hasta el siguiente evento o foco de la ventana.
// ============================================================================

/** Filas por petición: el tope por defecto de PostgREST en Supabase. */
export const FILAS_POR_LOTE = 1000;
/** Peticiones en vuelo a la vez (sin contar la primera, que va sola). */
export const LOTES_SIMULTANEOS = 4;
/**
 * Freno de seguridad: filas máximas que se leen. 10.000 reservas son muy por
 * encima del volumen de hoy (1.241 en total); si algún día se llega, es una
 * pantalla que hay que pensar de nuevo (filtrar en servidor), no una consulta
 * que cargar entera en memoria.
 */
export const LIMITE_FILAS = 10_000;

/** Lo que el helper lee de la respuesta de un lote (la forma de `PostgrestResponse`). */
export interface RespuestaLote<T> {
  data: T[] | null;
  error: unknown;
  count: number | null;
}

/**
 * Pide UN lote: las filas `primera`..`ultima`, las dos incluidas y contando desde 0, igual que
 * `.range(primera, ultima)`. `contar` es `true` solo en el primer lote: ahí hay que pedir
 * `{ count: "exact" }`. El resultado es lo que devuelve el constructor de consultas de Supabase
 * al esperarlo (`await`), sin más.
 */
export type LeerLote<T> = (primera: number, ultima: number, contar: boolean) => PromiseLike<RespuestaLote<T>>;

export interface OpcionesPaginacion<T> {
  /** Filas por lote. Por defecto `FILAS_POR_LOTE`. */
  filasPorLote?: number;
  /** Lotes en vuelo a la vez. Por defecto `LOTES_SIMULTANEOS`. */
  lotesSimultaneos?: number;
  /** Tope de seguridad. Por defecto `LIMITE_FILAS`. */
  limiteFilas?: number;
  /**
   * Identifica una fila (su `id`). Si se da, las repetidas por un desplazamiento se descartan y la
   * comprobación de coherencia las convierte en error. Ver la cabecera del fichero.
   */
  clave?: (fila: T) => string;
  /**
   * Cancelación. Antes de lanzar cada lote se mira si se ha abortado y, si es así, no se lanza y se
   * lanza el motivo del aborto (`signal.reason`): eso es lo que llega si se aborta ENTRE lotes. Los
   * lotes ya en vuelo terminan, salvo que la consulta lleve el mismo `signal` (`.abortSignal(signal)`):
   * entonces el `fetch` se aborta y lo que se lanza es su error (con supabase-js, un objeto de
   * postgrest-js `{ message: "AbortError: …", code: "20" }`, sin `name`). Para saber que fue una
   * cancelación, mirar `signal.aborted`.
   */
  signal?: AbortSignal;
}

export interface ResultadoPaginado<T> {
  /** Todas las filas, en el orden de la consulta (o las primeras `limiteFilas` si `truncado`). */
  filas: T[];
  /** El recuento exacto del servidor; `null` si no lo dio. Puede ser mayor que `filas.length` si `truncado`. */
  total: number | null;
  /** Hay más filas de las que se leen por el tope de seguridad: hay que avisarlo en pantalla. */
  truncado: boolean;
}

/**
 * Los datos cambiaron mientras se leían los lotes (o un lote llegó corto): lo que ha llegado no es
 * el conjunto que el servidor contó. Es un error transitorio: volver a leer lo arregla. TanStack
 * Query ya reintenta solo las consultas que fallan.
 */
export class ErrorLecturaInconsistente extends Error {
  constructor(detalle: string) {
    super(`Lectura por lotes inconsistente: ${detalle}`);
    this.name = "ErrorLecturaInconsistente";
  }
}

const enteroPositivo = (valor: number | undefined, porDefecto: number): number =>
  typeof valor === "number" && Number.isFinite(valor) && valor >= 1 ? Math.floor(valor) : porDefecto;

/** Si la lectura se ha cancelado, lanza el motivo del aborto (o un `AbortError` si el entorno no lo trae). */
function lanzarSiCancelada(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const motivo = (signal as { reason?: unknown }).reason;
  throw motivo ?? new DOMException("La lectura por lotes se ha cancelado", "AbortError");
}

/**
 * Ejecuta `cantidad` tareas con como mucho `maximo` en vuelo y devuelve sus resultados EN ORDEN
 * (no en el de llegada). A la primera que falle deja de lanzar tareas nuevas, espera a las que ya
 * están en vuelo (para que ninguna termine sin que nadie la escuche) y lanza ese primer error.
 */
async function enParalelo<R>(cantidad: number, maximo: number, tarea: (indice: number) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(cantidad);
  const estado: { siguiente: number; fallo: { error: unknown } | null } = { siguiente: 0, fallo: null };

  const trabajador = async () => {
    while (estado.fallo === null) {
      const indice = estado.siguiente++;
      if (indice >= cantidad) return;
      try {
        resultados[indice] = await tarea(indice);
      } catch (error) {
        if (estado.fallo === null) estado.fallo = { error };
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(maximo, cantidad) }, trabajador));
  if (estado.fallo !== null) throw estado.fallo.error;
  return resultados;
}

/**
 * Lee TODAS las filas de una consulta por lotes. Ver la cabecera del fichero para cómo lee, qué
 * garantiza y qué le toca a quien llama (sobre todo: un orden con desempate por una columna única
 * y la `clave` de cada fila).
 *
 * @example
 *   const { filas, truncado } = await paginarConsulta(
 *     (primera, ultima, contar) =>
 *       supabase
 *         .from("reservas")
 *         .select("*", contar ? { count: "exact" } : undefined)
 *         .gte("fecha", desde)
 *         .order("fecha")
 *         .order("id") // desempate: sin él, los lotes repiten y se saltan filas
 *         .range(primera, ultima)
 *         .abortSignal(signal),
 *     { clave: (r) => r.id, signal },
 *   );
 *
 * @throws el error del primer lote que falle (también el del `fetch` abortado, si se cancela con un
 *   lote en vuelo que lleve `.abortSignal`), `ErrorLecturaInconsistente` si los datos cambian
 *   mientras se leen, o `signal.reason` si se cancela entre lotes.
 */
export async function paginarConsulta<T>(
  leerLote: LeerLote<T>,
  opciones: OpcionesPaginacion<T> = {},
): Promise<ResultadoPaginado<T>> {
  const filasPorLote = enteroPositivo(opciones.filasPorLote, FILAS_POR_LOTE);
  const simultaneos = enteroPositivo(opciones.lotesSimultaneos, LOTES_SIMULTANEOS);
  const limite = enteroPositivo(opciones.limiteFilas, LIMITE_FILAS);
  const { clave, signal } = opciones;

  const pedir = async (primera: number, ultima: number, contar: boolean) => {
    lanzarSiCancelada(signal);
    const { data, error, count } = await leerLote(primera, ultima, contar);
    if (error) throw error;
    // `postgrest-js` saca el recuento de `Content-Range` con `parseInt`: sin recuento (`0-999/*`) sale NaN,
    // que es un número pero no un recuento. Solo vale un entero sin signo.
    const total = typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
    return { filas: data ?? [], total };
  };

  // 1) El primer lote, con el recuento exacto.
  const pedidas = Math.min(filasPorLote, limite);
  const primero = await pedir(0, pedidas - 1, true);
  const total = primero.total;
  const lotes: T[][] = [primero.filas];
  let truncado = false;

  if (total !== null) {
    // 2) Con recuento: se sabe cuántas filas hay y, por tanto, cuántos lotes faltan.
    const objetivo = Math.min(total, limite);
    truncado = total > limite;
    // Normalmente `pedidas`; menos si el servidor tiene un tope por petición más bajo que el lote.
    const paso = primero.filas.length;
    if (paso > 0 && paso < objetivo) {
      const faltan = Math.ceil((objetivo - paso) / paso);
      const resto = await enParalelo(faltan, simultaneos, async (indice) => {
        const primera = (indice + 1) * paso;
        const ultima = Math.min(primera + paso, objetivo) - 1;
        return (await pedir(primera, ultima, false)).filas;
      });
      lotes.push(...resto);
    }
  } else {
    // 3) Sin recuento: en serie, a partir de las filas que ya han llegado, hasta un lote VACÍO.
    //    Un lote corto no es el final (un `max-rows` bajo también los da cortos).
    let cargadas = primero.filas.length;
    let fin = cargadas === 0;
    while (!fin && cargadas < limite) {
      const pedidasAhora = Math.min(filasPorLote, limite - cargadas);
      const lote = await pedir(cargadas, cargadas + pedidasAhora - 1, false);
      if (lote.filas.length === 0) {
        fin = true;
      } else {
        lotes.push(lote.filas);
        cargadas += lote.filas.length;
      }
    }
    // Se sale sin `fin` solo por el tope: puede haber más.
    truncado = !fin;
  }

  const recibidas = lotes.reduce((suma, lote) => suma + lote.length, 0);
  let filas = lotes.flat();
  if (clave) {
    const vistas = new Set<string>();
    filas = filas.filter((fila) => {
      const id = clave(fila);
      if (vistas.has(id)) return false;
      vistas.add(id);
      return true;
    });
  }

  // Coherencia: con recuento tienen que haber llegado justo las que el servidor contó (hasta el tope).
  if (total !== null) {
    const esperadas = Math.min(total, limite);
    if (filas.length !== esperadas) {
      const repetidas = recibidas - filas.length;
      throw new ErrorLecturaInconsistente(
        `se esperaban ${esperadas} filas y han llegado ${filas.length}` +
          (repetidas > 0 ? ` (tras descartar ${repetidas} repetida${repetidas === 1 ? "" : "s"})` : "") +
          `: los datos cambiaron mientras se leían los lotes o un lote llegó incompleto.`,
      );
    }
  }
  return { filas, total, truncado };
}
