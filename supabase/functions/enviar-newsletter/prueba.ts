// ============================================================================
// Envío de PRUEBA por Resend Marketing — no llega a ningún cliente
// ----------------------------------------------------------------------------
// enviar-newsletter con {"prueba": true, "newsletter": {...}} (ver
// payloadDePrueba): manda el newsletter como Broadcast a
// un Segment de pruebas que contiene SOLO la dirección de prueba
// (NEWSLETTER_EMAIL_PRUEBA, por defecto delivered@resend.dev, la dirección de
// pruebas de Resend que simula una entrega correcta). Sirve para comprobar
// clave, remitente/dominio, plantilla y {{{RESEND_UNSUBSCRIBE_URL}}} ANTES de
// poner NEWSLETTER_CANAL=broadcast. Funciona con cualquier NEWSLETTER_CANAL.
//
// Salvaguardas (no puede llegar a clientes):
//   · el Segment de pruebas NO puede ser el del newsletter;
//   · si el Segment de pruebas tiene cualquier otro contacto, no se envía;
//   · no se sincroniza la tabla ni se escribe en newsletter_envios.
// El contacto de prueba cuenta 1 en la cuota de contactos (se ve como "ajeno"
// en la sincronización, y no está en el Segment del newsletter).
// ============================================================================

import { renderNewsletter, asuntoNewsletter, tieneEnlaceBaja, type DatosNewsletter } from "./plantillas.ts";
import { MARCADOR_BAJA_RESEND, normalizarEmail } from "../_shared/resend-marketing/config.ts";
import { resolverSegmento, type ClienteSync } from "../_shared/resend-marketing/sync.ts";
import type { ClienteBroadcast } from "./broadcast.ts";

/**
 * Forma de la petición de prueba: `{"prueba": true, "newsletter": {tipo, titulo, mensaje, imagen_url}}`,
 * SIN tipo/titulo/mensaje en la raíz. A propósito: una versión ANTERIOR de
 * enviar-newsletter (sin modo prueba) ignora `prueba` y, si encontrara
 * tipo/titulo/mensaje en la raíz, mandaría el newsletter A TODOS los
 * suscriptores. Con los datos anidados responde 400 («Campos requeridos») y no
 * sale nada: el botón «Enviar prueba» del panel es seguro aunque el panel se
 * despliegue antes que la función.
 * Devuelve el payload del newsletter si es una prueba, o `null` si no lo es.
 * Una prueba sin `newsletter` devuelve `{}` (no valida -> 400), nunca cae al envío real.
 */
export function payloadDePrueba(cuerpo: unknown): unknown | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const c = cuerpo as { prueba?: unknown; newsletter?: unknown };
  if (c.prueba !== true) return null;
  return c.newsletter && typeof c.newsletter === "object" ? c.newsletter : {};
}

export const EMAIL_PRUEBA_POR_DEFECTO = "delivered@resend.dev";
export const NOMBRE_SEGMENTO_PRUEBAS = "Newsletter Casa Tomás (pruebas)";

export type ClientePrueba = ClienteBroadcast &
  Pick<ClienteSync, "listarSegmentos" | "crearSegmento" | "listarContactosSegmento" | "obtenerContacto" | "crearContacto" | "anadirASegmento">;

export type ResultadoPrueba =
  | { ok: true; broadcastId: string; destinatario: string; segmentId: string }
  | { ok: false; status: number; error: string };

export async function enviarPrueba(op: {
  cliente: ClientePrueba;
  datos: DatosNewsletter;
  from: string;
  emailPrueba?: string | null;
  segmentPruebaConfigurado?: string | null;
  segmentNewsletterConfigurado?: string | null;
}): Promise<ResultadoPrueba> {
  const email = normalizarEmail(op.emailPrueba) || EMAIL_PRUEBA_POR_DEFECTO;

  const seg = await resolverSegmento(op.cliente, op.segmentPruebaConfigurado, NOMBRE_SEGMENTO_PRUEBAS);
  if (!seg.ok) return { ok: false, status: 502, error: seg.mensaje };
  if (op.segmentNewsletterConfigurado && seg.id === op.segmentNewsletterConfigurado.trim()) {
    return { ok: false, status: 409, error: "El Segment de pruebas no puede ser el del newsletter (llegaría a todos los suscriptores)." };
  }

  const miembros = await op.cliente.listarContactosSegmento(seg.id);
  if (!miembros.ok) return { ok: false, status: 502, error: `No se pudo leer el Segment de pruebas: ${miembros.mensaje}` };
  const otros = miembros.data.filter((c) => normalizarEmail(c.email) !== email);
  if (otros.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `El Segment de pruebas tiene ${otros.length} contacto(s) además de ${email}: no se envía para no escribir a nadie más. Déjalo solo con la dirección de prueba.`,
    };
  }

  if (!miembros.data.some((c) => normalizarEmail(c.email) === email)) {
    const existente = await op.cliente.obtenerContacto(email);
    if (existente.ok) {
      if (existente.data.unsubscribed) return { ok: false, status: 409, error: `${email} está dado de baja en Resend: usa otra dirección de prueba.` };
      const add = await op.cliente.anadirASegmento(existente.data.id, seg.id);
      if (!add.ok) return { ok: false, status: 502, error: `No se pudo meter ${email} en el Segment de pruebas: ${add.mensaje}` };
    } else {
      const creado = await op.cliente.crearContacto(email, "Prueba", seg.id);
      if (!creado.ok) return { ok: false, status: 502, error: `No se pudo crear el contacto de prueba: ${creado.mensaje}` };
    }
  }

  const html = renderNewsletter(op.datos, MARCADOR_BAJA_RESEND);
  if (!tieneEnlaceBaja(html, MARCADOR_BAJA_RESEND)) return { ok: false, status: 500, error: "pie_baja_ausente" };

  const creado = await op.cliente.crearBroadcast({
    segmentId: seg.id,
    from: op.from,
    subject: `[PRUEBA] ${asuntoNewsletter(op.datos.tipo, op.datos.titulo)}`,
    html,
    name: `PRUEBA newsletter ${op.datos.tipo}`,
  });
  if (!creado.ok || !creado.data?.id) {
    return { ok: false, status: 502, error: creado.ok ? "Resend no devolvió el id del Broadcast" : `Resend respondió ${creado.status} (${creado.tipo}): ${creado.mensaje}` };
  }
  const enviado = await op.cliente.enviarBroadcast(creado.data.id);
  if (!enviado.ok) return { ok: false, status: 502, error: `Resend respondió ${enviado.status} (${enviado.tipo}): ${enviado.mensaje}` };

  return { ok: true, broadcastId: creado.data.id, destinatario: email, segmentId: seg.id };
}
