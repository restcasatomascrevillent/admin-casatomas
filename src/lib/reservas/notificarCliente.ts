// ============================================================================
// AVISAR AL CLIENTE — la única forma de llamar a `notify-reservation-change`.
// ----------------------------------------------------------------------------
// `notify-reservation-change` pide a `emails-reserva` que escriba al cliente según el
// ESTADO ACTUAL de la reserva en la BD (lee `reserva_id ?? id` y se queda solo con
// eso; el resto del cuerpo se ignora). Por eso hay que llamarla DESPUÉS de guardar, y
// por eso da igual qué más se mande: aquí va `{ id, ...cambios }`, lo que se acaba de
// escribir, que además deja el cuerpo legible en los logs.
//
// Hasta el paso 2 había TRES formas de llamarla —`{ id, ...cambios }`, la fila entera
// de la reserva y `{ reserva_id }`— y NINGUNA miraba la respuesta. Y `functions.invoke`
// no lanza ante un 4xx/5xx ni ante un `{ success: false }`: devuelve `{ data, error }`.
// Un correo que no salía (sin permiso, sin secreto, dirección bloqueada, Resend caído)
// no lo sabía nadie: la pantalla decía «Se le manda el correo» y el cliente esperaba.
//
// Aquí:
//   · `notificarAlCliente` hace la llamada, lee la respuesta con la misma función que
//     el editor de reservas (`interpretarRespuestaNotificacion`) y NUNCA lanza.
//   · `textoProblemaEnvio` dice si hay algo que contarle al personal.
//   · `notificarYAvisarSiFalla` junta las dos: si el correo no sale, sale un aviso
//     honesto («la reserva ya está guardada, pero…, avísale por teléfono») y lo
//     guardado NO se toca: un fallo del correo nunca deshace el cambio de estado.
// ============================================================================

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { interpretarRespuestaNotificacion, type EnvioCorreoEdicion } from "./edicionReserva";

/** Cuánto se queda en pantalla un aviso que el personal TIENE que leer (los normales duran 4 s). */
const DURACION_AVISO_LARGO_MS = 10_000;

/**
 * Pide a `notify-reservation-change` que escriba al cliente de `reservaId` y ESPERA la
 * respuesta. Nunca lanza: una llamada caída es un `fallo`. Quien llama decide si
 * espera (`await`) o la deja correr.
 */
export async function notificarAlCliente(reservaId: string, cambios: object = {}): Promise<EnvioCorreoEdicion> {
  try {
    // CONTRATO DEL SERVIDOR (`notify-reservation-change/index.ts`): solo lee `reserva_id ?? id`; del resto
    // del cuerpo no mira nada, y `emails-reserva` RELEE el estado de la reserva en la BD para elegir la
    // plantilla. Se manda lo escrito (`cambios`) solo para que el cuerpo sea legible en los logs.
    const respuesta = await supabase.functions.invoke("notify-reservation-change", {
      body: { ...cambios, id: reservaId },
    });
    const envio = interpretarRespuestaNotificacion(respuesta);
    if (envio.resultado === "fallo") {
      // `functions.invoke` no lanza: el error viene en la respuesta (o es un `success:false`).
      console.error("Error notificando cambio de reserva:", (respuesta as { error?: unknown } | null)?.error ?? respuesta);
    }
    return envio;
  } catch (err) {
    console.error("Error notificando cambio de reserva:", err);
    return { resultado: "fallo" };
  }
}

/**
 * Motivos con los que `emails-reserva` NO manda correo y que NO son un problema: el
 * aviso de éxito ya le dijo al personal que este cliente no tiene correo, la solicitud
 * web pendiente se silencia a propósito y algunos estados no tienen plantilla.
 */
const MOTIVOS_SIN_AVISO = /^(reserva_sin_email|solicitud_recibida_silenciada_canal_.*|sin_plantilla_para_estado_.*)$/;

/**
 * Lo que hay que decirle al personal cuando el correo no ha salido (sin el «Avísale por
 * teléfono» del final), o `null` si no hay nada que decir: enviado, ya enviado antes,
 * «se pidió pero no consta» (no se afirma nada) y los motivos que no son un problema.
 */
export function textoProblemaEnvio(envio: EnvioCorreoEdicion): string | null {
  switch (envio.resultado) {
    case "fallo":
      return "no se ha podido pedir el envío del correo.";
    case "suprimido":
      return "ese email está bloqueado porque antes rebotó o se quejó.";
    case "no_enviado":
      return envio.motivo && !MOTIVOS_SIN_AVISO.test(envio.motivo) ? `el correo no ha salido (${envio.motivo}).` : null;
    default:
      return null;
  }
}

/**
 * ¿El envío falló pero `emails-reserva` lo REINTENTA SOLO? Es el motivo `fallido_reintentable`: un
 * fallo transitorio de Resend (429, 5xx, sin respuesta). El cron `reintentar-fallidos` (cada 15
 * minutos, con espera creciente de 10 a 80 minutos, hasta 5 intentos) lo vuelve a enviar, y si se
 * agota avisa en la campana del panel. Llamar al cliente en ese momento sería adelantarse: el
 * correo saldrá solo.
 */
export function seReintentaSolo(envio: EnvioCorreoEdicion): boolean {
  return envio.resultado === "no_enviado" && envio.motivo === "fallido_reintentable";
}

/** Muestra el aviso al personal si `envio` es un problema. Devuelve si lo mostró. */
export function avisarSiElCorreoFalla(envio: EnvioCorreoEdicion, opciones: { nombre?: string | null } = {}): boolean {
  const problema = textoProblemaEnvio(envio);
  if (!problema) return false;
  const nombre = (opciones.nombre ?? "").trim();
  if (seReintentaSolo(envio)) {
    // Nada que hacer por ahora: informa, pero no manda llamar al cliente ni pinta un error.
    toast.info("El correo al cliente no ha salido todavía", {
      description: nombre
        ? `${nombre}: la reserva ya está guardada y el correo se reintentará automáticamente en unos minutos; si no consigue salir, el panel te avisará.`
        : "La reserva ya está guardada y el correo se reintentará automáticamente en unos minutos; si no consigue salir, el panel te avisará.",
      duration: DURACION_AVISO_LARGO_MS,
    });
    return true;
  }
  toast.error("El correo al cliente no ha salido", {
    description: nombre
      ? `${nombre}: la reserva ya está guardada, pero ${problema} Avísale por teléfono.`
      : `La reserva ya está guardada, pero ${problema} Avísale por teléfono.`,
    duration: DURACION_AVISO_LARGO_MS,
  });
  return true;
}

/**
 * `notificarAlCliente` + el aviso honesto si falla. Es lo que usan las acciones sueltas
 * (una reserva) sin esperar el resultado; las acciones en bloque usan `notificarAlCliente`
 * y cuentan los problemas en un solo aviso.
 */
export async function notificarYAvisarSiFalla(
  reservaId: string,
  cambios: object = {},
  opciones: { nombre?: string | null } = {},
): Promise<EnvioCorreoEdicion> {
  const envio = await notificarAlCliente(reservaId, cambios);
  avisarSiElCorreoFalla(envio, opciones);
  return envio;
}
