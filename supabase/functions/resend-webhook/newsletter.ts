// ============================================================================
// BAJA AUTOMÁTICA DEL NEWSLETTER DESDE LOS EVENTOS DE RESEND — lógica pura
// ----------------------------------------------------------------------------
// index.ts hace el I/O; aquí solo se decide QUÉ suscriptor dar de baja y con
// qué `origen_baja` (mismo criterio de separación que eventos.ts).
//
// Qué eventos dan de baja (newsletter_suscriptores.activo = false) y por qué:
//   · email.complained  -> 'queja_spam'. Marcó como spam UN correo nuestro
//     (newsletter o de reserva): quien hace eso no quiere marketing, y seguir
//     escribiéndole hunde la reputación del dominio (Resend exige < 0,08 % de
//     quejas: resend.com/docs/knowledge-base/account-quotas-and-limits).
//   · email.bounced     -> 'rebote_permanente'. Resend solo emite este evento
//     cuando el servidor del destinatario rechaza el correo de forma
//     PERMANENTE (resend.com/docs/webhooks/emails/bounced); los temporales son
//     email.delivery_delayed. Aun así, si viniera bounce.type = "Transient" se
//     ignora por prudencia.
//   · email.suppressed  -> 'suprimido_resend'. Resend ni lo intenta: la
//     dirección está en su lista de supresión.
//   · contact.updated con unsubscribed = true -> 'resend_baja_nativa'. Es la
//     baja desde la página de preferencias de Resend ({{{RESEND_UNSUBSCRIBE_URL}}}
//     o su cabecera List-Unsubscribe automática) cuando el newsletter salga
//     como Broadcast (fase 2, NEWSLETTER_CANAL=broadcast). Red de seguridad si
//     se pierde: la reconciliación de newsletter-sync-resend (diaria y antes
//     de cada Broadcast) hace lo mismo leyendo los contactos de Resend.
//   · contact.deleted -> NO es una baja (lo borramos nosotros al dar de baja, o
//     alguien en el dashboard): solo se desvincula resend_contact_id
//     (`decidirDesvinculoContacto`). Si la persona sigue activa en la tabla, la
//     siguiente sincronización la vuelve a crear: la tabla manda.
//
// NUNCA reactiva: ningún evento de Resend pone activo = true (contact.updated
// con unsubscribed = false se ignora). La única vía de alta/reactivación es el
// consentimiento nuevo de una reserva con el email verificado por el cliente
// (doble opt-in: triggers newsletter_alta_reserva_verificada_*, migración
// 20261003184500) y las migraciones 20261003171500/184500 lo imponen en la
// base de datos.
// ============================================================================

export type OrigenBajaWebhook = "queja_spam" | "rebote_permanente" | "suprimido_resend" | "resend_baja_nativa";

export interface DecisionBajaNewsletter {
  email: string;
  origen: OrigenBajaWebhook;
  /** id de newsletter_suscriptores si el correo lo llevaba en la etiqueta `suscriptor` (enviar-newsletter la pone). */
  suscriptorId: string | null;
}

export interface EventoResendMinimo {
  type?: unknown;
  data?: Record<string, unknown> | null;
}

/** Etiquetas que enviar-newsletter pone en cada correo (Resend las devuelve en `data.tags`). */
export const ETIQUETA_CATEGORIA = "categoria";
export const VALOR_CATEGORIA_NEWSLETTER = "newsletter";
export const ETIQUETA_SUSCRIPTOR = "suscriptor";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resend manda `tags` como objeto {nombre: valor} en los webhooks; se acepta también el formato array del envío. */
export function leerEtiquetas(tags: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string") {
        const valor = (t as { value?: unknown }).value;
        if (typeof valor === "string") out[(t as { name: string }).name] = valor;
      }
    }
  } else if (tags && typeof tags === "object") {
    for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

export function normalizarEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const v = email.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

/**
 * Patrón de ILIKE que solo casa con ESE email, sin distinguir mayúsculas:
 * escapa los comodines de LIKE (`%`, `_`) y la barra de escape. Lo usa el
 * fallback de resend-webhook cuando no existe la RPC newsletter_registrar_baja
 * (antes de 20261003184500 la tabla puede tener «Ana@x.es» y el evento trae
 * «ana@x.es»; un `.eq("email", …)` no lo encontraba).
 * Devuelve null si el email lleva `*`: PostgREST convierte `*` en `%` dentro de
 * like/ilike y no hay forma de escaparlo, así que podría dar de baja a otros.
 */
export function patronIlikeExacto(email: string): string | null {
  if (email.includes("*")) return null;
  return email.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Saca la dirección de "Nombre <a@b.c>" o "a@b.c". */
function direccionDe(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = valor.match(/<([^>]+)>/);
  return normalizarEmail(m ? m[1] : valor);
}

function primerDestinatario(to: unknown): string | null {
  if (Array.isArray(to)) return direccionDe(to[0]);
  return direccionDe(to);
}

/** `null` si el evento no implica dar de baja a nadie del newsletter. */
export function decidirBajaNewsletter(evento: EventoResendMinimo): DecisionBajaNewsletter | null {
  const tipo = typeof evento?.type === "string" ? evento.type : "";
  const data = (evento?.data ?? {}) as Record<string, unknown>;

  if (tipo === "contact.updated") {
    if (data.unsubscribed !== true) return null;
    const email = normalizarEmail(data.email);
    return email ? { email, origen: "resend_baja_nativa", suscriptorId: null } : null;
  }

  let origen: OrigenBajaWebhook | null = null;
  if (tipo === "email.complained") origen = "queja_spam";
  else if (tipo === "email.suppressed") origen = "suprimido_resend";
  else if (tipo === "email.bounced") {
    const bounce = data.bounce as { type?: unknown } | undefined;
    const tipoRebote = typeof bounce?.type === "string" ? bounce.type.toLowerCase() : "";
    if (tipoRebote === "transient") return null;
    origen = "rebote_permanente";
  }
  if (!origen) return null;

  const email = primerDestinatario(data.to);
  if (!email) return null;

  const etiquetas = leerEtiquetas(data.tags);
  const candidato = etiquetas[ETIQUETA_SUSCRIPTOR];
  const suscriptorId =
    etiquetas[ETIQUETA_CATEGORIA] === VALOR_CATEGORIA_NEWSLETTER && candidato && UUID_RE.test(candidato) ? candidato : null;

  return { email, origen, suscriptorId };
}

/**
 * `email_eventos.email_id` es NOT NULL y los eventos contact.* / suppression.*
 * no traen email_id (tumbaban el INSERT con 500 y Resend reintentaba sin fin).
 * Se archivan con un id sintético "<tipo>:<id>".
 */
export function idArchivoEvento(evento: EventoResendMinimo): string {
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  if (typeof data.email_id === "string" && data.email_id) return data.email_id;
  const tipo = typeof evento?.type === "string" ? evento.type : "desconocido";
  const id = typeof data.id === "string" && data.id ? data.id : "sin-id";
  return `${tipo}:${id}`;
}

/** Destinatario para archivar: `to[0]` en eventos de correo, `email` en los de contacto/supresión. */
export function destinatarioArchivo(evento: EventoResendMinimo): string | null {
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  if (Array.isArray(data.to) && typeof data.to[0] === "string") return data.to[0];
  if (typeof data.email === "string") return data.email;
  return null;
}

/**
 * contact.deleted -> id del contacto a desvincular de newsletter_suscriptores
 * (resend_contact_id = NULL). No da de baja a nadie. `null` para el resto.
 */
export function decidirDesvinculoContacto(evento: EventoResendMinimo): string | null {
  if (evento?.type !== "contact.deleted") return null;
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  return typeof data.id === "string" && data.id.trim() ? data.id.trim() : null;
}

/** Los eventos de correo de un Broadcast traen `broadcast_id`: se archiva para las estadísticas por envío. */
export function broadcastIdDe(evento: EventoResendMinimo): string | null {
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  return typeof data.broadcast_id === "string" && data.broadcast_id ? data.broadcast_id : null;
}
