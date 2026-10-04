// ============================================================================
// RESEND MARKETING — configuración y reglas puras (sin Deno, sin red)
// ----------------------------------------------------------------------------
// Lo importan las funciones (enviar-newsletter, newsletter-sync-resend,
// newsletter-baja) y TAMBIÉN el panel (src/lib/newsletter/resend.ts): por eso
// este fichero no puede importar nada de https:// ni tocar Deno.*.
//
// Diseño (docs/funcionalidades/newsletter-resend-marketing.md):
//   · newsletter_suscriptores es la fuente de verdad; Resend es el cartero.
//   · Contacts API global + UN Segment ("Newsletter Casa Tomás"), sin Topics.
//     La Audiences API está deprecada desde nov-2025.
//   · El plan Marketing gratuito cuenta CONTACTOS GUARDADOS (también los dados
//     de baja) y, pasado el límite, Resend no deja enviar Broadcasts (403).
//     Por eso a los dados de baja se les borra de Resend.
// ============================================================================

export type CanalNewsletter = "transaccional" | "broadcast";

/** Nombre del Segment que usa (o crea, si no se configura su id) newsletter-sync-resend. */
export const NOMBRE_SEGMENTO_NEWSLETTER = "Newsletter Casa Tomás";

/** Marcador de Resend: enlace de baja único por destinatario y envío (solo Broadcasts). */
export const MARCADOR_BAJA_RESEND = "{{{RESEND_UNSUBSCRIBE_URL}}}";

/** Contactos del plan Marketing gratuito. Se puede subir con NEWSLETTER_LIMITE_CONTACTOS si se cambia de plan. */
export const LIMITE_CONTACTOS_POR_DEFECTO = 1000;

/** Rate limit de Resend: 10 peticiones/s por equipo (todas las claves juntas). Se deja margen para reservas. */
export const PETICIONES_POR_SEGUNDO = 8;

/**
 * Canal del newsletter según el secret NEWSLETTER_CANAL. Por defecto
 * 'transaccional': desplegar no cambia nada hasta que el dueño lo active.
 * Cualquier valor que no sea exactamente 'broadcast' (sin mayúsculas/espacios) cuenta como transaccional.
 */
export function canalNewsletter(env: string | null | undefined): CanalNewsletter {
  return (env ?? "").trim().toLowerCase() === "broadcast" ? "broadcast" : "transaccional";
}

/** Límite de contactos del plan (NEWSLETTER_LIMITE_CONTACTOS); valores raros -> 1.000. */
export function limiteContactos(env: string | null | undefined): number {
  const n = Number((env ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : LIMITE_CONTACTOS_POR_DEFECTO;
}

/**
 * Remitente del newsletter: NEWSLETTER_FROM_EMAIL si existe, si no
 * RESEND_FROM_EMAIL (dominio verificado send.miguelbenito.space, DECISIÓN DEL
 * DUEÑO), y como último recurso el sandbox de Resend (solo entrega al dueño de
 * la cuenta: un envío real fallará y se verá).
 */
export function remitenteNewsletter(newsletterFrom: string | null | undefined, resendFrom: string | null | undefined): string {
  return (newsletterFrom ?? "").trim() || (resendFrom ?? "").trim() || "Casa Tomás <onboarding@resend.dev>";
}

export type NivelCuota = "ok" | "aviso" | "lleno";

/** Aviso al 80 % del límite de contactos; "lleno" al 100 % (Resend ya no deja enviar Broadcasts). */
export function nivelCuota(usados: number | null | undefined, limite: number): NivelCuota {
  if (!usados || usados < 0 || !limite) return "ok";
  if (usados >= limite) return "lleno";
  if (usados >= limite * 0.8) return "aviso";
  return "ok";
}

/** Normaliza un email para comparar entre la tabla y Resend. */
export function normalizarEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Nombre de pila para Resend (first_name): recortado, sin saltos de línea; vacío -> null. */
export function nombreParaResend(nombre: string | null | undefined): string | null {
  const v = (nombre ?? "").replace(/[\r\n]+/g, " ").trim();
  return v ? v.slice(0, 100) : null;
}
