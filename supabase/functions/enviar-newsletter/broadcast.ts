// ============================================================================
// enviar-newsletter en modo BROADCAST (Resend Marketing) — lógica sin Deno
// ----------------------------------------------------------------------------
// Se activa con el secret NEWSLETTER_CANAL=broadcast (por defecto sigue el
// envío transaccional de siempre). index.ts sincroniza la tabla con Resend
// DENTRO del cerrojo de newsletter_sincronizaciones_resend y, si la pasada lo
// permite (`puedeEnviarBroadcast`), llama a `enviarBroadcast`.
//
// Mismo HTML que el envío transaccional y que la vista previa del panel
// (plantillas.ts); lo único que cambia es el enlace del pie, que es el
// marcador {{{RESEND_UNSUBSCRIBE_URL}}}: Resend lo sustituye por un enlace
// único por destinatario a su página de baja, y además pone él mismo las
// cabeceras List-Unsubscribe / List-Unsubscribe-Post (un Broadcast no admite
// cabeceras propias). La baja que se haga allí vuelve a la tabla por el
// webhook contact.updated (resend-webhook) y por la reconciliación diaria.
//
// Orden pensado para no enviar dos veces ni perder el rastro:
//   1. crear el Broadcast como BORRADOR (send:false),
//   2. apuntarlo en newsletter_envios (canal 'broadcast', resend_broadcast_id,
//      estado 'pendiente'),
//   3. enviarlo,
//   4. estado 'completado' (Resend lo ha aceptado y lo reparte él) o 'fallido'.
//   Si el paso 3 no contesta claro (red/5xx), se pregunta a Resend por el
//   estado del Broadcast antes de decir nada: reintentarlo a ciegas podría
//   mandarlo dos veces.
// ============================================================================

import { renderNewsletter, asuntoNewsletter, tieneEnlaceBaja, type DatosNewsletter } from "./plantillas.ts";
import { MARCADOR_BAJA_RESEND } from "../_shared/resend-marketing/config.ts";
import type { ResultadoResend } from "../_shared/resend-marketing/cliente.ts";
import type { ResumenSync } from "../_shared/resend-marketing/sync.ts";

export interface ClienteBroadcast {
  crearBroadcast(b: { segmentId: string; from: string; subject: string; html: string; name: string; replyTo?: string | null }): Promise<ResultadoResend<{ id: string }>>;
  enviarBroadcast(id: string): Promise<ResultadoResend<{ id: string }>>;
  obtenerBroadcast(id: string): Promise<ResultadoResend<{ id: string; status?: string }>>;
}

export interface FilaEnvio {
  asunto: string;
  mensaje: string;
  total_destinatarios: number;
  enviado_por: string;
  tipo_newsletter: string;
  estado: "pendiente" | "completado" | "parcial" | "fallido";
  canal: "transaccional" | "broadcast";
  resend_broadcast_id?: string | null;
}

export interface RegistroEnvios {
  /** Inserta en newsletter_envios; devuelve el id o null si no se pudo (no tumba el envío). */
  insertar(fila: FilaEnvio): Promise<string | null>;
  actualizarEstado(id: string, estado: FilaEnvio["estado"]): Promise<void>;
}

export type Veredicto = { ok: true } | { ok: false; status: number; error: string };

/** ¿Se puede enviar el Broadcast después de esta pasada de sincronización? */
export function puedeEnviarBroadcast(r: ResumenSync, limiteContactos: number): Veredicto {
  if (r.estado === "error") {
    return { ok: false, status: 502, error: `No se pudo sincronizar con Resend antes de enviar: ${r.mensajeError ?? "error desconocido"}. No se ha enviado nada.` };
  }
  if (r.bloqueaEnvio) {
    const motivo = r.pendientes > 0
      ? `quedan ${r.pendientes} cambios por pasar a Resend`
      : "no se pudo quitar de Resend a algún dado de baja";
    return {
      ok: false,
      status: 409,
      error: `No se ha enviado: ${motivo} y el newsletter podría llegar a quien se ha dado de baja. Pulsa «Sincronizar con Resend» en Suscriptores y vuelve a enviarlo.`,
    };
  }
  if (r.contactosResend !== null && r.contactosResend > limiteContactos) {
    return {
      ok: false,
      status: 409,
      error: `Hay ${r.contactosResend} contactos en Resend y el plan admite ${limiteContactos}: Resend no deja enviar Broadcasts por encima del límite. Borra contactos que no sean del newsletter en Resend o sube de plan (y NEWSLETTER_LIMITE_CONTACTOS).`,
    };
  }
  if (!r.destinatarios) {
    return { ok: false, status: 400, error: "No hay suscriptores activos en Resend a los que enviar" };
  }
  return { ok: true };
}

export type ResultadoBroadcast =
  | { ok: true; broadcastId: string; envioId: string | null }
  | { ok: false; status: number; error: string; broadcastId?: string; envioId?: string | null };

function textoError(r: { status: number; tipo: string; mensaje: string }): string {
  if (r.status === 403 && /contacts quota/i.test(r.mensaje)) {
    return "Resend no deja enviar: se ha superado el límite de contactos del plan de marketing.";
  }
  if (r.status === 401 || (r.status === 403 && /api key|restricted/i.test(r.mensaje))) {
    return `La API key de Resend Marketing no sirve para Broadcasts (necesita "Full access"): ${r.mensaje}`;
  }
  if (r.status === 403 && /domain/i.test(r.mensaje)) {
    return `El remitente no es de un dominio verificado en Resend: ${r.mensaje}`;
  }
  return `Resend respondió ${r.status} (${r.tipo}): ${r.mensaje}`;
}

export async function enviarBroadcast(op: {
  cliente: ClienteBroadcast;
  registro: RegistroEnvios;
  datos: DatosNewsletter;
  from: string;
  replyTo?: string | null;
  segmentId: string;
  destinatarios: number;
  usuarioId: string;
  ahora?: () => Date;
}): Promise<ResultadoBroadcast> {
  const html = renderNewsletter(op.datos, MARCADOR_BAJA_RESEND);
  // Defensa en profundidad, como en el envío transaccional: sin pie de baja no sale.
  if (!tieneEnlaceBaja(html, MARCADOR_BAJA_RESEND)) return { ok: false, status: 500, error: "pie_baja_ausente" };

  const subject = asuntoNewsletter(op.datos.tipo, op.datos.titulo);
  const fecha = (op.ahora ?? (() => new Date()))().toISOString().slice(0, 16).replace("T", " ");

  const creado = await op.cliente.crearBroadcast({
    segmentId: op.segmentId,
    from: op.from,
    subject,
    html,
    name: `Newsletter ${op.datos.tipo} ${fecha} UTC`,
    replyTo: op.replyTo ?? null,
  });
  if (!creado.ok || !creado.data?.id) {
    return { ok: false, status: 502, error: creado.ok ? "Resend no devolvió el id del Broadcast" : textoError(creado) };
  }
  const broadcastId = creado.data.id;

  const envioId = await op.registro.insertar({
    asunto: subject,
    mensaje: op.datos.mensaje,
    total_destinatarios: op.destinatarios,
    enviado_por: op.usuarioId,
    tipo_newsletter: op.datos.tipo,
    estado: "pendiente",
    canal: "broadcast",
    resend_broadcast_id: broadcastId,
  });

  const marcar = async (estado: FilaEnvio["estado"]) => {
    if (envioId) await op.registro.actualizarEstado(envioId, estado);
  };

  const enviado = await op.cliente.enviarBroadcast(broadcastId);
  if (enviado.ok) {
    await marcar("completado");
    return { ok: true, broadcastId, envioId };
  }

  // Respuesta dudosa (red caída, 5xx): ¿salió o no?
  if (enviado.status === 0 || enviado.status >= 500) {
    const estado = await op.cliente.obtenerBroadcast(broadcastId);
    if (estado.ok && estado.data?.status && estado.data.status !== "draft") {
      await marcar("completado");
      return { ok: true, broadcastId, envioId };
    }
    if (estado.ok && estado.data?.status === "draft") {
      await marcar("fallido");
      return { ok: false, status: 502, error: `${textoError(enviado)}. El Broadcast no ha salido (sigue como borrador).`, broadcastId, envioId };
    }
    return {
      ok: false,
      status: 502,
      error: `No se sabe si el newsletter ha salido (${textoError(enviado)}). Míralo en Resend → Broadcasts antes de volver a enviarlo.`,
      broadcastId,
      envioId,
    };
  }

  await marcar("fallido");
  return { ok: false, status: 502, error: textoError(enviado), broadcastId, envioId };
}
