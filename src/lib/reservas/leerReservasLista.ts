// ============================================================================
// LECTURA DE LA LISTA DE RESERVAS — todas las filas de `reservas`, por lotes
// ----------------------------------------------------------------------------
// Es la consulta de la pestaña «Lista» (`ListaReservasAvanzada`, clave de caché
// `reservas-lista`): TODAS las reservas de todos los negocios, sin filtro de
// estado ni de fecha (los filtros de la pantalla se aplican en el cliente), de la
// más reciente a la más antigua y, dentro de un día, por hora.
//
// Por qué por lotes: PostgREST corta cada petición a 1000 filas sin avisar y hoy
// hay más de 1.200 reservas, así que la consulta de una sola vez dejaba sin ver
// el histórico más antiguo (siguen en la base de datos, pero desaparecían de la
// lista). `paginarConsulta` lee todo (recuento exacto, lotes en paralelo), y esta
// función solo pone la consulta: mismo `select("*")`, mismo orden y, nuevo, `id`
// como desempate. Sin él, las reservas de un mismo día y hora empatan y dos
// lotes pueden repetir o saltarse alguna (ver la cabecera de `paginarConsulta`).
//
// Recibe el cliente en vez de importarlo, así se prueba sin mockear módulos. En la
// pantalla: `leerReservasLista(supabase, { signal })`, con el `signal` que TanStack
// Query pasa a la `queryFn` (`queryFn: async ({ signal }) => …`): si la lectura se
// cancela, aborta sus peticiones en vuelo y no lanza más lotes. Se cancela con el
// `cancelQueries(["reservas-lista"])` de cada acción optimista, con un refresco
// que invalida la consulta cuando ya hay datos en caché (en la carga inicial no
// cancela) y al desmontar la Lista. Sin `signal` también funciona.
//
// CUIDADO AL ENGANCHARLA:
//   · la caché `reservas-lista` es un ARRAY de reservas (otros hooks la modifican a
//     mano con `setQueryData(["reservas-lista"], …)`: Aceptar, «Llegó», cancelar…).
//     La `queryFn` tiene que devolver `filas`, no el resultado entero. `truncado`
//     (más de `LIMITE_FILAS` = 10.000 reservas) solo se puede decir con un aviso
//     aparte, no dentro de esa caché.
//   · el `catch` actual de la `queryFn` de la Lista saca un toast «Error al cargar
//     reservas» (y un `console.error`) en CADA fallo, y a ese `catch` llegan cosas
//     que no son errores de verdad:
//       - los ABORTOS (las cancelaciones de arriba). Si se aborta con un lote en
//         vuelo, `paginarConsulta` lanza el error del `fetch` abortado (con
//         supabase-js `{ message: "AbortError: …" }`, sin `name`); si se aborta
//         entre lotes, `signal.reason`.
//       - `ErrorLecturaInconsistente` (los datos cambiaron mientras se leían los
//         lotes; ver `paginarConsulta`): es transitorio y TanStack Query reintenta.
//     Ese `catch` NO debe avisar ni registrar si `signal.aborted` o si el error es
//     `ErrorLecturaInconsistente` (los reintentos de TanStack Query lo gestionan);
//     solo con errores reales. Y siempre relanza (`throw error`):
//         catch (error) {
//           if (!signal.aborted && !(error instanceof ErrorLecturaInconsistente)) {
//             toast.error("Error al cargar reservas");
//             console.error(error);
//           }
//           throw error;
//         }
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { paginarConsulta, type ResultadoPaginado } from "@/lib/reservas/paginarConsulta";

/** Una fila de `reservas` tal como la generan los tipos (la pantalla la trata como `ReservaParaVerificar`). */
export type FilaReservaLista = Database["public"]["Tables"]["reservas"]["Row"];

export interface OpcionesLecturaLista {
  /** Cancelación de TanStack Query (`queryFn: ({ signal }) => …`): aborta los lotes en vuelo y no lanza más. */
  signal?: AbortSignal;
}

/** Todas las reservas, de la más reciente a la más antigua. `truncado` si hay más de `LIMITE_FILAS`. */
export function leerReservasLista(
  cliente: Pick<SupabaseClient<Database>, "from">,
  { signal }: OpcionesLecturaLista = {},
): Promise<ResultadoPaginado<FilaReservaLista>> {
  return paginarConsulta<FilaReservaLista>(
    (primera, ultima, contar) => {
      const consulta = cliente
        .from("reservas")
        .select("*", contar ? { count: "exact" } : undefined)
        .order("fecha", { ascending: false })
        .order("hora", { ascending: true })
        // Desempate: `id` es único. Sin él, los lotes pueden repetir o saltarse reservas del mismo día y hora.
        .order("id", { ascending: true })
        .range(primera, ultima);
      return signal ? consulta.abortSignal(signal) : consulta;
    },
    // `clave`: una fila que llega dos veces por un desplazamiento se descarta y el recuento deja de cuadrar.
    { clave: (fila) => String(fila.id), signal },
  );
}
