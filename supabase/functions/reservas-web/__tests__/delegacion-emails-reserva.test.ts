/**
 * Tests de la delegación del correo de "solicitud recibida" en
 * `emails-reserva` (supabase/functions/reservas-web/index.ts::handleCrear).
 *
 * QUÉ FALLO CUBREN. Una reserva real creada desde la web el 27/09/2026 no
 * dejó NI UNA FILA en `envios_email_reserva`: `reservas-web` mandaba ese
 * primer correo por su cuenta (Resend directo), fuera de la única tubería
 * que registra el envío, lo reintenta con espera creciente y sigue su
 * entrega. A partir de ahora lo manda `emails-reserva/notificar`.
 *
 * QUÉ SE PRUEBA AQUÍ. La pieza que decide si hay que molestar al personal
 * con un aviso en `notificaciones_dashboard` — `debeAvisarDeEmailsReserva`,
 * pura y sin I/O, igual que el resto de la lógica de decisión de este
 * módulo. La regla, en una línea: se avisa SI Y SOLO SI `emails-reserva` NO
 * se ha hecho cargo del correo.
 *
 * Los dos errores que esta prueba existe para impedir:
 *   1. SILENCIO. Que un fallo al delegar (red, 401, 404, timeout...) no
 *      genere aviso: sería exactamente el agujero de origen, porque en ese
 *      caso NO hay fila en `envios_email_reserva` y no lo reintenta nadie.
 *   2. RUIDO. Que un `fallido_reintentable` (o un duplicado legítimo) genere
 *      aviso: ahí sí hay fila, el cron lo reintentará (10/20/40/80 min) y
 *      `emails-reserva` ya avisa por su cuenta si se agotan los 5 intentos.
 */
import { describe, it, expect } from "vitest";
import {
  MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA,
  debeAvisarDeEmailsReserva,
  construirAvisoEmailFallido,
  ORIGEN_RESERVAS_WEB,
  NEGOCIOS,
  type ResultadoNotificarEmailsReserva,
} from "../plantillas.ts";

/** Azúcar para leer los casos de un vistazo. */
function resultado(
  parcial: Partial<ResultadoNotificarEmailsReserva>,
): ResultadoNotificarEmailsReserva {
  return { contactado: true, ok: false, motivo: null, ...parcial };
}

describe("debeAvisarDeEmailsReserva — no se pudo contactar con emails-reserva", () => {
  // Estos son los motivos que produce `notificarViaEmailsReserva` cuando la
  // petición ni siquiera llega a dejar fila: son LOS MÁS GRAVES, porque el
  // correo se pierde sin rastro en ninguna tabla.
  const sinCustodia = ["timeout", "error_de_red", "http_401", "http_404", "http_500", "respuesta_ilegible"];

  it.each(sinCustodia)("avisa cuando el transporte falla (%s)", (motivo) => {
    expect(debeAvisarDeEmailsReserva(resultado({ contactado: false, motivo }))).toBe(true);
  });

  it("avisa aunque no haya ni motivo: sin contacto no hay fila que reintentar", () => {
    expect(debeAvisarDeEmailsReserva(resultado({ contactado: false, motivo: null }))).toBe(true);
  });

  it("un `ok:true` imposible en una respuesta no contactada no silencia el aviso", () => {
    // Defensa en profundidad: `contactado:false` manda siempre, pase lo que
    // pase con el resto del objeto.
    expect(debeAvisarDeEmailsReserva(resultado({ contactado: false, ok: true, motivo: null }))).toBe(true);
  });
});

describe("debeAvisarDeEmailsReserva — emails-reserva respondió", () => {
  it("no avisa cuando el correo salió", () => {
    expect(debeAvisarDeEmailsReserva(resultado({ ok: true }))).toBe(false);
  });

  it.each([...MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA])(
    "no avisa con '%s': emails-reserva ya se hizo cargo (fila y/o aviso propio)",
    (motivo) => {
      expect(debeAvisarDeEmailsReserva(resultado({ ok: false, motivo }))).toBe(false);
    },
  );

  // Motivos reales de `enviarCorreoParaReserva` que devuelven SIN reclamar
  // fila y SIN avisar: si aquí tampoco avisásemos, nadie se enteraría.
  it.each([
    "reserva_no_encontrada",
    "reserva_sin_email",
    "sin_plantilla_para_estado_pendiente",
    "plantilla_no_configurada_solicitud_recibida",
  ])("avisa con '%s': no hay fila ni aviso de nadie más", (motivo) => {
    expect(debeAvisarDeEmailsReserva(resultado({ ok: false, motivo }))).toBe(true);
  });

  it("avisa ante un motivo desconocido: por defecto se avisa, nunca se calla", () => {
    expect(debeAvisarDeEmailsReserva(resultado({ ok: false, motivo: "motivo_que_aun_no_existe" }))).toBe(true);
    expect(debeAvisarDeEmailsReserva(resultado({ ok: false, motivo: null }))).toBe(true);
  });
});

describe("MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA — guardas de la lista", () => {
  it("incluye los dos casos en los que emails-reserva SÍ deja fila", () => {
    // 'fallido_reintentable' -> fila en 'fallido' con proximo_reintento_en.
    // 'ya_enviado_o_en_curso' -> el índice único rechazó un duplicado porque
    // ya hay fila 'pendiente' o 'enviado'.
    expect(MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA).toContain("fallido_reintentable");
    expect(MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA).toContain("ya_enviado_o_en_curso");
  });

  it("incluye los tres casos en los que emails-reserva ya avisa por su cuenta", () => {
    // `enviarCorreoParaReserva` llama a `avisarEnviosDefinitivamentePerdidos`
    // antes de devolver estos tres. Duplicarlos sería doble campana.
    expect(MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA).toContain("fallido_definitivo");
    expect(MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA).toContain("resend_no_configurado");
    expect(MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA).toContain("destinatario_suprimido");
  });

  it("NO incluye ningún motivo de transporte: esos nunca dejan fila", () => {
    for (const motivo of ["timeout", "error_de_red", "respuesta_ilegible", "http_401"]) {
      expect(MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA).not.toContain(motivo);
    }
  });
});

describe("el aviso que se acaba insertando cuando la delegación falla", () => {
  it("apunta a la reserva y dice el motivo, con el origen de esta tubería", () => {
    const fila = construirAvisoEmailFallido({
      contexto: "solicitud recibida",
      negocio: NEGOCIOS.casa_tomas,
      nombre: "Miguel Benito",
      fecha: "2026-10-21",
      hora: "15:00",
      reservaId: "56f75082-bccf-4cea-bb04-aa81fd49526f",
      error: "timeout",
    });

    expect(fila.tipo).toBe("email_fallido");
    expect(fila.origen).toBe(ORIGEN_RESERVAS_WEB);
    // 'solicitud recibida' no lleva acción pendiente del cliente -> 'normal'.
    expect(fila.prioridad).toBe("normal");
    expect(fila.titulo).toContain("solicitud recibida");
    expect(fila.mensaje).toContain("timeout");
    // Ahora SÍ hay reserva a la que apuntar (a diferencia de la rama de
    // rechazo, donde `reservaId` es null porque aún no existe la fila).
    expect(fila.referencia_tipo).toBe("reserva");
    expect(fila.referencia_id).toBe("56f75082-bccf-4cea-bb04-aa81fd49526f");
  });
});
