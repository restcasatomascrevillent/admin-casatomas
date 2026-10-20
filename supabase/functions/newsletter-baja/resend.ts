// ============================================================================
// Baja por NUESTRA vía (enlace HMAC del pie / one-click) -> fuera de Resend
// ----------------------------------------------------------------------------
// Fase 2 (Resend Marketing): cuando alguien se da de baja con nuestro enlace,
// se BORRA su contacto en Resend. Así no recibe el siguiente Broadcast y deja
// de contar para el límite de 1.000 contactos (Resend cuenta también a los
// dados de baja). La constancia de la baja queda en newsletter_suscriptores.
//
// La baja local es lo que manda: esto se hace DESPUÉS de guardarla y nunca
// la deshace ni cambia la respuesta al usuario. Si Resend falla (o no hay
// RESEND_MARKETING_API_KEY), se registra en el log y la siguiente
// sincronización (newsletter-sync-resend: diaria y antes de cada Broadcast)
// borra el contacto; un Broadcast no sale mientras quede alguno sin borrar.
// ============================================================================

import { ClienteResendMarketing, type FetchLike } from "../_shared/resend-marketing/cliente.ts";

export type ResultadoQuitar = "sin_clave" | "borrado" | "no_estaba" | "error";

export async function quitarDeResendTrasBaja(op: {
  apiKey: string | null | undefined;
  email: string;
  suscriptorId: string;
  fetch?: FetchLike;
  dormir?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}): Promise<ResultadoQuitar> {
  const log = op.log ?? ((m: string) => console.log(m));
  if (!op.apiKey) {
    log(`newsletter-baja: sin RESEND_MARKETING_API_KEY; el contacto de ${op.suscriptorId} lo quitará la próxima sincronización`);
    return "sin_clave";
  }
  try {
    const cliente = new ClienteResendMarketing({
      apiKey: op.apiKey,
      fetch: op.fetch,
      dormir: op.dormir,
      maxReintentos: 1,
      timeoutMs: 4000,
      log,
    });
    const r = await cliente.borrarContacto(op.email.trim().toLowerCase());
    if (r.ok) {
      log(`newsletter-baja: contacto de ${op.suscriptorId} borrado de Resend`);
      return "borrado";
    }
    if (r.status === 404) return "no_estaba";
    log(`newsletter-baja: no se pudo borrar de Resend el contacto de ${op.suscriptorId} (${r.status} ${r.tipo}: ${r.mensaje}); lo hará la próxima sincronización`);
    return "error";
  } catch (e) {
    log(`newsletter-baja: error borrando de Resend el contacto de ${op.suscriptorId}: ${e instanceof Error ? e.message : String(e)}`);
    return "error";
  }
}
