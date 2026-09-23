// ============================================================================
// MAPEO DE EVENTOS DE RESEND -> DECISIONES (qué estado guardar, si avisar al
// personal, si suprimir la dirección) -- funciones puras, sin I/O. index.ts
// hace el I/O (leer/escribir envios_email_reserva, direcciones_email_suprimidas,
// notificaciones_dashboard) -- mismo criterio de separación que
// emails-reserva/reintentos.ts.
//
// PROBLEMA QUE RESUELVE (contexto del encargo): Resend acepta el envío de
// forma SÍNCRONA (la fila de envios_email_reserva queda "enviado" con su
// resend_id) pero el resultado REAL (¿llegó, rebotó, se marcó como spam, ni
// se intentó?) llega ~0.4s después por estos eventos asíncronos. Antes de
// este cambio, resend-webhook/index.ts archivaba el evento en
// `email_eventos` y ahí se quedaba -- nada volvía a mirar la fila de
// envios_email_reserva. Verificado en vivo (QA de ayer) con
// bounced@resend.dev, complained@resend.dev y suppressed@resend.dev: los
// tres seguían resultado="enviado" para siempre.
//
// Tipos de evento de Resend (resend.com/docs/dashboard/webhooks/event-types,
// consultado 2026-09-23): sent, delivered, delivery_delayed, bounced,
// complained, opened, clicked, failed, scheduled, received, suppressed.
// Solo 4 interesan aquí -- el resto se sigue archivando en `email_eventos`
// sin acción adicional, exactamente igual que hoy.
// ============================================================================

export type EstadoEntrega = "entregado" | "rebotado" | "quejado" | "suprimido";

const MAPA_TIPO_EVENTO_A_ESTADO: Record<string, EstadoEntrega> = {
  delivered: "entregado",
  bounced: "rebotado",
  complained: "quejado",
  suppressed: "suprimido",
};

/** `tipoEvento` ya sin el prefijo "email." (ver index.ts). `null` si este
 * tipo de evento no representa un estado de entrega que haya que guardar
 * (sent/opened/clicked/delivery_delayed/failed/scheduled/received...): esos
 * se archivan en `email_eventos` igual que hoy, sin tocar
 * envios_email_reserva. */
export function mapearEventoAEstadoEntrega(tipoEvento: string): EstadoEntrega | null {
  return MAPA_TIPO_EVENTO_A_ESTADO[tipoEvento] ?? null;
}

/** Solo bounced/complained/suppressed merecen un aviso al personal --
 * "delivered" es una confirmación silenciosa, no una alarma (encargo, punto
 * 1: "delivered -> confirma la entrega en la fila", sin más). */
export function debeAvisarPersonal(estado: EstadoEntrega): boolean {
  return estado !== "entregado";
}

/** bounced/complained/suppressed son las tres razones del encargo para no
 * seguir escribiendo a una dirección: un rebote duro no se arregla
 * reintentando (la dirección no existe), un complaint daña la reputación
 * del dominio si se insiste, y un suppressed es Resend rechazando el
 * intento de antemano (normalmente por un bounce/complaint previo). */
export function debeSuprimirDireccion(estado: EstadoEntrega): boolean {
  return estado !== "entregado";
}

// ----------------------------------------------------------------------------
// Prioridad del aviso + margen anti-aluvión -- MISMA LÓGICA que
// emails-reserva/reintentos.ts (prioridadEmailFallido/debeCrearAvisoLote),
// reimplementada aquí a propósito: este proyecto no comparte módulos entre
// Edge Functions (ver emails-reserva/tokens.ts, cabecera, mismo criterio;
// _shared/ queda fuera del territorio de esta sesión). resend-webhook usa su
// PROPIO origen ("resend_webhook") en notificaciones_dashboard para tener su
// propio carril de cooldown, independiente de reservas_web/emails_reserva --
// compartir carril con emails_reserva reintroduciría el mismo bug de aluvión
// cruzado que 20260923120000_origen_prioridad_notificaciones.sql corrigió
// para esas dos (ver la migración de esta entrega).
// ----------------------------------------------------------------------------

export const ORIGEN_RESEND_WEBHOOK = "resend_webhook";
export const AVISO_COOLDOWN_MINUTOS = 30;

export type PrioridadAviso = "alta" | "normal";

/** "alta" si el correo afectado era una propuesta o una confirmación (el
 * cliente se queda sin la acción pendiente, o sin saber que está
 * confirmado, sin que nadie se entere) -- mismo criterio que
 * prioridadEmailFallido en emails-reserva/reintentos.ts. Cualquier otro
 * tipo (incluido uno que este módulo no reconozca) es "normal": no hay
 * motivo documentado para tratar lo desconocido como urgente por defecto. */
export function prioridadAvisoWebhook(tipoEmail: string): PrioridadAviso {
  return tipoEmail === "propuesta" || tipoEmail === "confirmada" ? "alta" : "normal";
}

/** Igual que debeCrearAvisoLote (emails-reserva/reintentos.ts): como mucho
 * un aviso nuevo cada `cooldownMinutos` por carril (origen "resend_webhook"
 * + prioridad), para que varios eventos seguidos del mismo cliente (p. ej.
 * bounced de una propuesta y luego de su recordatorio) no generen un aviso
 * por evento. */
export function debeCrearAvisoWebhook(
  ultimoAvisoCreadoAt: string | null,
  ahoraIso: string,
  cooldownMinutos = AVISO_COOLDOWN_MINUTOS,
): boolean {
  if (!ultimoAvisoCreadoAt) return true;
  const transcurridoMs = new Date(ahoraIso).getTime() - new Date(ultimoAvisoCreadoAt).getTime();
  return transcurridoMs >= cooldownMinutos * 60 * 1000;
}

// ----------------------------------------------------------------------------
// Texto del aviso
// ----------------------------------------------------------------------------

const ETIQUETA_TIPO_EMAIL: Record<string, string> = {
  solicitud_recibida: "solicitud recibida",
  propuesta: "propuesta de reserva",
  confirmada: "confirmación de reserva",
  rechazada: "aviso de cancelación",
  recordatorio: "recordatorio",
};

function etiquetaTipoEmail(tipo: string): string {
  return ETIQUETA_TIPO_EMAIL[tipo] ?? tipo;
}

export interface DatosAvisoWebhook {
  estado: EstadoEntrega;
  tipoEmail: string;
  nombreCliente: string | null;
  telefono: string | null;
  email: string | null;
  fecha: string | null;
  hora: string | null;
}

function contacto(d: DatosAvisoWebhook): string {
  return d.telefono || d.email || "sin contacto";
}

function cuando(d: DatosAvisoWebhook): string {
  if (!d.fecha) return "";
  return d.hora ? ` (${d.fecha} ${d.hora.slice(0, 5)})` : ` (${d.fecha})`;
}

/** `null` si `estado` no merece aviso (ver debeAvisarPersonal) -- el
 * llamador decide si invocarla; se deja fail-safe por si acaso. */
export function construirMensajeAvisoWebhook(d: DatosAvisoWebhook): { titulo: string; mensaje: string } | null {
  if (!debeAvisarPersonal(d.estado)) return null;
  const nombre = d.nombreCliente || "Cliente";
  const etiqueta = etiquetaTipoEmail(d.tipoEmail);

  if (d.estado === "rebotado") {
    return {
      titulo: `Un correo de reserva rebotó (${etiqueta})`,
      mensaje: `${nombre} · ${contacto(d)}${cuando(d)}. El correo NO llegó (dirección inexistente o buzón lleno) y no se reintentará solo. Llama para confirmarlo a mano.`,
    };
  }
  if (d.estado === "quejado") {
    return {
      titulo: `Un cliente marcó como spam un correo de reserva (${etiqueta})`,
      mensaje: `${nombre} · ${contacto(d)}${cuando(d)}. El correo SÍ llegó, pero lo marcó como spam. No se le volverá a escribir por email automáticamente (protege la reputación del dominio para el resto de clientes) -- llama para confirmarlo a mano si hace falta.`,
    };
  }
  // suprimido
  return {
    titulo: `Resend no intentó entregar un correo de reserva (${etiqueta})`,
    mensaje: `${nombre} · ${contacto(d)}${cuando(d)}. Resend tiene esta dirección en su lista de supresión (por un rebote o queja anterior) y ni lo intentó. Llama para confirmarlo a mano.`,
  };
}
