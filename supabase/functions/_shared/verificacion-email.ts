// ============================================================================
// VERIFICACIÓN DEL EMAIL DE UNA RESERVA (doble opt-in del newsletter)
// ============================================================================
// Módulo PURO (cero imports): lo usan emails-reserva y reservas-web, y se
// prueba con vitest sin arrastrar los imports `https://...`.
//
// `reservas.email_verificado_at` (migración 20261003184500) es la prueba de
// que el cliente controla el buzón: se marca SOLO cuando pulsa un enlace
// firmado del correo que ACEPTA la reserva:
//   · «Confirmo» de la propuesta (emails-reserva POST /enlace/ejecutar,
//     contraoferta 'verificada' -> 'confirmada'; enlaces antiguos:
//     reservas-web GET /confirmar);
//   · aceptar la propuesta de una solicitud (emails-reserva ->
//     fn_aceptar_propuesta_solicitud con p_via = 'email').
// «Rechazar» NO cuenta: puede ser precisamente el dueño del buzón diciendo
// «esta reserva no es mía». Confirmar desde el panel tampoco (no prueba nada
// del email; además la BD no deja que el personal escriba esta columna).
//
// Si la reserva trae la casilla del newsletter, el trigger
// newsletter_alta_reserva_verificada_upd da de alta (o reactiva) el email.
//
// Va DESPUÉS del cambio de estado y por separado, a propósito:
//   · si la migración aún no está aplicada (PGRST204, columna inexistente) o
//     falla cualquier cosa, la reserva ya está confirmada y el cliente ve su
//     página de «confirmada»: lo único que se pierde es el alta en el
//     newsletter (el lado seguro);
//   · `.is(email_verificado_at, null)`: la primera verificación es la que
//     vale; repetir el clic no la mueve.
// Hay que llamarla ANTES de mandar el correo de 'confirmada': el UPDATE toca
// `updated_at`, que forma parte de la huella de los enlaces antiguos de
// reservas-web.
// ============================================================================

/** Lo mínimo de supabase-js que hace falta (así se puede probar con un doble). */
export interface ClienteVerificacion {
  from(tabla: string): {
    update(valores: Record<string, unknown>): {
      eq(columna: string, valor: unknown): {
        is(columna: string, valor: null): {
          select(columnas: string): PromiseLike<{
            data: unknown[] | null;
            error: { code?: string | null; message?: string | null } | null;
          }>;
        };
      };
    };
  };
}

export type ResultadoVerificacion = "registrada" | "ya_estaba" | "sin_columna" | "error";

/** ¿Es el «esa columna no existe» de PostgREST (migración sin aplicar)? */
export function faltaColumnaVerificacion(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const mensaje = error.message ?? "";
  if (error.code === "42703") return true; // undefined_column, por si llega de Postgres
  return mensaje.includes("email_verificado_at") && (error.code === "PGRST204" || /could not find|does not exist/i.test(mensaje));
}

/**
 * Marca `reservas.email_verificado_at` (si aún no lo estaba). Nunca lanza:
 * devuelve qué ha pasado y deja rastro en los logs.
 */
export async function registrarEmailVerificado(
  supabase: ClienteVerificacion,
  reservaId: string,
  ahoraIso: string = new Date().toISOString(),
  etiqueta = "verificacion-email",
): Promise<ResultadoVerificacion> {
  try {
    const { data, error } = await supabase
      .from("reservas")
      .update({ email_verificado_at: ahoraIso })
      .eq("id", reservaId)
      .is("email_verificado_at", null)
      .select("id");
    if (error) {
      if (faltaColumnaVerificacion(error)) {
        console.error(`[${etiqueta}] Falta reservas.email_verificado_at (¿migración 20261003184500 sin aplicar?): la reserva ${reservaId} queda sin verificar y no habrá alta en el newsletter.`);
        return "sin_columna";
      }
      console.error(`[${etiqueta}] No se pudo marcar el email verificado de la reserva ${reservaId}:`, error.code, error.message);
      return "error";
    }
    return (data?.length ?? 0) > 0 ? "registrada" : "ya_estaba";
  } catch (err) {
    console.error(`[${etiqueta}] Error inesperado marcando el email verificado de ${reservaId}:`, (err as Error)?.message || err);
    return "error";
  }
}
