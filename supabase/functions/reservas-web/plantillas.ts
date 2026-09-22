// ============================================================================
// PLANTILLAS DE CORREO DE reservas-web — datos de negocio + esqueleto HTML
// ============================================================================
// Módulo PURO (sin `serve`/`createClient`/Resend ni ningún import remoto de
// Deno): igual que `emails-reserva/plantillas.ts` y `_shared/disponibilidad.ts`,
// se separa a propósito para poder testear con vitest sin arrastrar imports
// `https://...` que Node no puede resolver. `index.ts` es el único que hace
// I/O (Supabase, Resend); este fichero solo decide QUÉ texto sale.
//
// CONTEXTO (encargo: "El Reservado pasa a mandar por la misma función que el
// restaurante, pero las 4 plantillas de correo llevaban la marca Casa Tomás
// escrita a fuego — nombre, dirección y teléfono"):
//
//   `reservas` no tenía, hasta esta sesión, ningún concepto de a qué negocio
//   del grupo (Casa Tomás / Touza) pertenece una reserva. Se añade la
//   columna `marca` (migración `20260922180000_marca_negocio_en_reservas.sql`,
//   NO aplicada — ver ese fichero) con DEFAULT 'casa_tomas' a nivel de BASE
//   DE DATOS, no solo de código: hay más de un camino que inserta en
//   `reservas` sin pasar por `handleCrear` (restaurante-phone/api/
//   vapi-webhook.js:1126 inserta directo con service role;
//   adminpanelct/src/components/reservas/FormularioReserva.tsx inserta
//   directo, autenticado) y ninguno de ellos sabe nada de `marca` — todos
//   deben caer en 'casa_tomas' aunque esta función nunca intervenga.
//
// CÓMO SE DECIDE LA MARCA DE UNA RESERVA NUEVA (ver `resolverMarca` más
// abajo, y su uso en `handleCrear` de index.ts) — por prioridad:
//   1. `marca` explícita en el body de `/crear` (NINGÚN frontend la manda
//      hoy — ni Reservado.tsx ni ReservationForm.tsx — pero es el camino
//      limpio para cuando touza-restaurant-website se actualice; entonces
//      esto deja de depender de los puntos 2 y 3).
//   2. La `marca` etiquetada en `espacios_reserva.caracteristicas` del
//      espacio pedido (si se manda `espacio_id`/`sala`). La migración
//      `20260922150000_espacio_el_reservado_touza.sql` (NO aplicada, de
//      otra sesión) ya da de alta 'El Reservado' con
//      `caracteristicas: {"marca": "touza"}` — en cuanto esa fila exista Y
//      el frontend de Touza empiece a mandar el espacio, este punto basta
//      por sí solo. HOY no se usa: ni Reservado.tsx ni ReservationForm.tsx
//      mandan `espacio_id`/`sala` (verificado leyendo ambos formularios).
//   3. Texto de `notas_cliente`. Reservado.tsx (touza-restaurant-website)
//      compone SIEMPRE la nota con la frase fija `MARCADOR_TOUZA_EN_NOTAS`
//      como primera línea (no es texto libre del cliente: lo escribe el
//      propio código del formulario, ver Reservado.tsx líneas 106-111) — es
//      el ÚNICO dato que hoy distingue una solicitud de El Reservado de una
//      del restaurante, y por eso es el puente real mientras 1 y 2 no
//      apliquen. Es intencionadamente el ÚLTIMO recurso: si esa cadena
//      cambia en touza-restaurant-website (repo fuera de este territorio)
//      la detección deja de funcionar EN SILENCIO — no lanza error, cae al
//      punto 4 — que es exactamente la red de seguridad que pide el encargo
//      (nunca un correo sin marca), aunque significa que ese cambio no se
//      notaría solo. Ver informe de la tarea.
//   4. Por defecto, 'casa_tomas' — el caso mayoritario y el seguro.
//
// Una vez creada la reserva, `marca` queda GUARDADA en la fila (columna
// nueva) y el resto de acciones (`notificar-estado`, `confirmar`,
// `cancelar`) la leen tal cual de `fetchReserva` — NO se vuelve a derivar de
// notas_cliente en esos pasos, así que un cambio posterior en el texto de
// Reservado.tsx no puede desincronizar los correos de una reserva ya creada.
// ============================================================================

// ----------------------------------------------------------------------------
// Datos de negocio
// ----------------------------------------------------------------------------

/**
 * Identificador interno de cada negocio del grupo. Valores en snake_case,
 * iguales a los que guarda la columna `marca` de `reservas` y a
 * `espacios_reserva.caracteristicas->>'marca'` (mismo vocabulario en toda la
 * base, ver migración `20260922150000_espacio_el_reservado_touza.sql`, que
 * ya usa "touza" con ese mismo sentido).
 *
 * Por qué NO se reutiliza el patrón `restaurante`/`touza` (dos booleanos)
 * que ya existe en `platos`/`bebidas`/`vinos`/`cocteles` (ver
 * `src/hooks/usePlatos.ts` y compañía): ahí un mismo plato puede visibilizarse
 * en las dos cartas a la vez, así que dos flags independientes tiene sentido.
 * Una reserva, en cambio, es de UN negocio o del otro, nunca de los dos —
 * modelarlo con dos booleanos permitiría estados imposibles (`{restaurante:
 * true, touza: true}` o `{false, false}`) que aquí no pueden existir. Un
 * único valor con un default seguro es el modelo correcto para "exactamente
 * uno, y si no se sabe cuál, el mayoritario".
 *
 * Tampoco se usa el valor `"restaurante"` (que sí usan esas tablas para
 * decir "Casa Tomás") para el propio valor de marca: en un grupo que puede
 * crecer a un tercer negocio, `"restaurante"` deja de identificar a nadie en
 * concreto. `"casa_tomas"` no tiene ese problema.
 */
export type Marca = "casa_tomas" | "touza";

/** Todos los valores válidos de `Marca`. Añadir un negocio nuevo es añadir
 * una entrada aquí y en `NEGOCIOS` — ninguna plantilla cambia. */
export const MARCAS_VALIDAS: readonly Marca[] = ["casa_tomas", "touza"];

/** Type guard: valida un valor desconocido (body de la petición, columna
 * leída de BD, jsonb de `caracteristicas`...) como `Marca`. */
export function esMarcaValida(value: unknown): value is Marca {
  return typeof value === "string" && (MARCAS_VALIDAS as readonly string[]).includes(value);
}

/** Datos de un negocio del grupo, tal y como los necesitan las plantillas de
 * correo. `telefonoDigits` son solo dígitos (para construir `tel:` hrefs,
 * con o sin prefijo `+34` según el sitio); `telefonoTexto` es la forma
 * legible que se enseña al cliente. */
export interface DatosNegocio {
  /** Nombre de marca tal cual se muestra ("Casa Tomás", "Touza"). */
  nombre: string;
  /** Localidad, mostrada bajo el logo y en el pie. */
  localidad: string;
  /** Calle y número. Sin código postal ni localidad — la localidad ya se
   * muestra aparte, igual que en las plantillas originales. */
  direccion: string;
  /** Teléfono legible, p.ej. "966 10 78 87". */
  telefonoTexto: string;
  /** Solo dígitos, sin espacios ni prefijo, p.ej. "966107887". */
  telefonoDigits: string;
}

/**
 * Configuración de contacto por negocio. ÚNICA fuente de estos datos: antes
 * vivían repetidos y escritos a fuego en las 4 plantillas de este fichero.
 *
 * Datos de Casa Tomás: los que ya estaban en las plantillas originales (sin
 * cambios). Datos de Touza: sacados de touza-restaurant-website —
 * `src/pages/Contacto.tsx` (dirección) y, coincidiendo en los tres sitios
 * (`Contacto.tsx`, `src/pages/Reservado.tsx`, `src/components/
 * MobileReserveCTA.tsx`), el teléfono "966 782 000" / "+34966782000". No se
 * ha inventado ningún dato: todo verificado por lectura directa del repo.
 */
export const NEGOCIOS: Record<Marca, DatosNegocio> = {
  casa_tomas: {
    nombre: "Casa Tomás",
    localidad: "Crevillente",
    direccion: "C/ Santa María de la Cabeza, 2",
    telefonoTexto: "966 10 78 87",
    telefonoDigits: "966107887",
  },
  touza: {
    nombre: "Touza",
    localidad: "Crevillente",
    direccion: "C/ San Vicente, 14",
    telefonoTexto: "966 782 000",
    telefonoDigits: "966782000",
  },
};

/** Config por defecto cuando no se puede determinar el negocio. Requisito
 * explícito del encargo: nunca un correo sin marca, siempre Casa Tomás. */
export const NEGOCIO_POR_DEFECTO: Marca = "casa_tomas";

// ----------------------------------------------------------------------------
// Resolución de la marca de una reserva nueva
// ----------------------------------------------------------------------------

/** Primera línea EXACTA que compone Reservado.tsx (touza-restaurant-website)
 * en `notas_cliente` para toda solicitud de El Reservado — no es texto del
 * cliente, lo escribe el propio formulario (ver cabecera del fichero para el
 * porqué de usar esto como señal). Se compara con `startsWith` sobre el
 * texto ya recortado, no con igualdad exacta, para no depender del resto de
 * la nota (que sí incluye texto libre del cliente a continuación). */
const MARCADOR_TOUZA_EN_NOTAS = "Solicitud de El Reservado";

/** Sniff de `notas_cliente`: `"touza"` si empieza por el marcador de
 * Reservado.tsx, `null` si no hay señal (nunca lanza, nunca "adivina" sobre
 * texto de cliente que no sea ese marcador exacto). */
export function resolverMarcaPorNotas(notas: string | null | undefined): Marca | null {
  if (!notas) return null;
  return notas.trim().startsWith(MARCADOR_TOUZA_EN_NOTAS) ? "touza" : null;
}

/** Señales disponibles para decidir la marca de una reserva NUEVA, en el
 * mismo orden de prioridad que la función aplica. Todas opcionales: quien
 * llama manda lo que tenga en cada momento (ver los dos puntos de llamada en
 * `handleCrear`, comentados en la cabecera de este fichero). */
export interface ResolverMarcaInput {
  /** `body.marca` de la petición a `/crear`, sin validar todavía. */
  marcaExplicita?: unknown;
  /** `espacios_reserva.caracteristicas` del espacio pedido (jsonb), sin
   * validar todavía. `undefined`/`null` si no hay espacio resuelto aún. */
  marcaEspacio?: unknown;
  /** `notas_cliente` tal cual se va a guardar. */
  notasCliente?: string | null;
}

/**
 * Decide la `Marca` de una reserva nueva. Pura, sin I/O — cualquier lectura
 * a BD (el espacio, si lo hay) la hace `index.ts` antes de llamar. Nunca
 * devuelve algo que no sea un valor de `Marca`: el caso "no se sabe" es
 * `NEGOCIO_POR_DEFECTO`, no `null` ni una excepción (requisito del encargo).
 */
export function resolverMarca(input: ResolverMarcaInput): Marca {
  if (esMarcaValida(input.marcaExplicita)) return input.marcaExplicita;
  if (esMarcaValida(input.marcaEspacio)) return input.marcaEspacio;
  return resolverMarcaPorNotas(input.notasCliente ?? null) ?? NEGOCIO_POR_DEFECTO;
}

// ----------------------------------------------------------------------------
// Escapado HTML (movido aquí desde index.ts: lo usan las plantillas de este
// fichero y también las páginas HTML de index.ts, que lo importan de vuelta)
// ----------------------------------------------------------------------------

/** Ver comentario original en index.ts: toda interpolación de datos que
 * vienen de fuera (cliente, BD) pasa por aquí. Nunca se escapan los campos
 * de `DatosNegocio` (nombre/localidad/direccion/teléfono): son config propia
 * y confiable, igual que los literales "Casa Tomás"/"Crevillente" que había
 * antes tampoco se escapaban. */
export function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ----------------------------------------------------------------------------
// Aviso interno cuando un email de reserva falla al enviarse
// ----------------------------------------------------------------------------
// `sendEmail` (index.ts) puede fallar (Resend sin configurar, error de
// Resend, excepción de red) y, hasta este cambio, eso solo dejaba un
// `console.error` — el cliente no recibía nada y nadie en el panel se
// enteraba. Se avisa en `notificaciones_dashboard` (la campana que ya lee
// CentroNotificaciones.tsx), con el mismo `tipo` ('email_fallido') que ya
// adopta `emails-reserva` para el mismo concepto (ver
// `20260922160000_reintentos_emails_reserva.sql`, que documenta ese valor
// aunque ese sistema, con cola de reintentos, es otro dominio — no se toca
// aquí). Solo se construye el CONTENIDO aquí (puro, testable); quien hace el
// INSERT de verdad es `avisarEmailFallido` en index.ts, el único con acceso
// al cliente de Supabase.

/** Qué se sabe en el momento de un fallo de envío. `reservaId` es `null`
 * cuando el fallo ocurre en un rechazo (`avisar()` en `handleCrear`): en ese
 * punto todavía no existe fila en `reservas` a la que apuntar. */
export interface AvisoEmailFallidoInput {
  /** Qué correo falló, en texto libre para el título ("solicitud recibida",
   * "solicitud no procesada"...). */
  contexto: string;
  negocio: DatosNegocio;
  nombre: string;
  fecha: string;
  hora: string;
  reservaId: string | null;
  /** `resultadoEmail.error` de `sendEmail`, si lo hay. */
  error?: string;
}

/** Fila lista para insertar en `notificaciones_dashboard`
 * (`20260313000000_solicitudes_y_notificaciones.sql`: `tipo`/`titulo`
 * NOT NULL, `mensaje`/`referencia_id`/`referencia_tipo` nullable). */
export interface FilaNotificacionDashboard {
  tipo: "email_fallido";
  titulo: string;
  mensaje: string;
  referencia_id: string | null;
  referencia_tipo: "reserva" | null;
}

/** Pura: arma la fila de aviso, sin tocar la base de datos. */
export function construirAvisoEmailFallido(input: AvisoEmailFallidoInput): FilaNotificacionDashboard {
  return {
    tipo: "email_fallido",
    titulo: `Correo de ${input.contexto} no enviado (${input.negocio.nombre})`,
    mensaje: `${input.nombre} — ${input.fecha} ${input.hora}.${input.error ? ` Motivo: ${input.error}` : ""}`,
    referencia_id: input.reservaId,
    referencia_tipo: input.reservaId ? "reserva" : null,
  };
}

// ----------------------------------------------------------------------------
// Las 4 plantillas de correo — mismo HTML/CSS que antes, con el nombre,
// localidad, dirección y teléfono ahora parametrizados por `negocio` en vez
// de escritos a fuego. Ningún cambio de estructura ni de estilo (regla del
// encargo): solo se sustituyen los datos.
// ----------------------------------------------------------------------------

// ------------------------------------------------------------
// PLANTILLA: Solicitud recibida (email positivo tras crear con éxito)
// ------------------------------------------------------------
export function tplSolicitudRecibida(negocio: DatosNegocio, nombre: string, fecha: string, hora: string, comensales: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solicitud Recibida - ${negocio.nombre}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3EE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EE;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-top:3px solid #B8936A;">
          <tr>
            <td style="padding:40px 48px 32px;text-align:center;border-bottom:1px solid #E8E0D5;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:4px;color:#1C1F22;text-transform:uppercase;font-weight:normal;">${negocio.nombre}</div>
              <div style="width:40px;height:1px;background:#B8936A;margin:14px auto 10px;"></div>
              <div style="font-size:10px;letter-spacing:3px;color:#B8936A;text-transform:uppercase;">${negocio.localidad}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 48px 0;text-align:center;">
              <span style="display:inline-block;background:#F7F3EE;border:1px solid #E8E0D5;color:#6B6560;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:6px 16px;">Solicitud recibida</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 48px 0;">
              <p style="margin:0 0 20px;font-size:22px;color:#1C1F22;font-family:Georgia,'Times New Roman',serif;font-weight:normal;">Hola, ${escapeHtml(nombre)}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#6B6560;line-height:1.7;">Hemos recibido tu solicitud de reserva en <strong style="color:#1C1F22;">${negocio.nombre}</strong>. Nuestro equipo la revisará y te confirmaremos la disponibilidad a la mayor brevedad posible.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D5;border-top:2px solid #B8936A;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Fecha</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(fecha)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Hora</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(hora)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Comensales</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${comensales} personas</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 40px;">
              <p style="margin:0;font-size:13px;color:#6B6560;line-height:1.6;border-left:2px solid #B8936A;padding-left:16px;">No es necesario que hagas nada más. Recibirás un correo de confirmación en cuanto esté todo listo.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 48px;background:#1C1F22;text-align:center;">
              <div style="font-family:Georgia,serif;font-size:13px;color:#B8936A;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">${negocio.nombre} · ${negocio.localidad}</div>
              <div style="font-size:12px;color:#6B6560;">${negocio.direccion} &nbsp;·&nbsp; <a href="tel:${negocio.telefonoDigits}" style="color:#6B6560;text-decoration:none;">${negocio.telefonoTexto}</a></div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ------------------------------------------------------------
// PLANTILLA: Solicitud no procesada (rechazo genérico, no revela motivo)
// ------------------------------------------------------------
export function tplSolicitudNoProcesada(negocio: DatosNegocio, nombre: string, fecha: string, hora: string, comensales: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solicitud no procesada - ${negocio.nombre}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3EE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EE;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-top:3px solid #1C1F22;">
          <tr>
            <td style="padding:40px 48px 32px;text-align:center;border-bottom:1px solid #E8E0D5;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:4px;color:#1C1F22;text-transform:uppercase;font-weight:normal;">${negocio.nombre}</div>
              <div style="width:40px;height:1px;background:#B8936A;margin:14px auto 10px;"></div>
              <div style="font-size:10px;letter-spacing:3px;color:#B8936A;text-transform:uppercase;">${negocio.localidad}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 48px 0;text-align:center;">
              <span style="display:inline-block;background:#F0EDEA;border:1px solid #DDD5CC;color:#6B6560;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:6px 16px;">Solicitud no procesada</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 48px 0;">
              <p style="margin:0 0 20px;font-size:22px;color:#1C1F22;font-family:Georgia,'Times New Roman',serif;font-weight:normal;">Estimado/a ${escapeHtml(nombre)}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#6B6560;line-height:1.7;">Gracias por su interés en visitarnos. Lamentamos informarle que no nos ha sido posible formalizar su solicitud de reserva de acuerdo con nuestras políticas internas de organización.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D5;">
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #E8E0D5;background:#FAFAF8;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#9B948E;">Fecha solicitada</span>
                    <span style="display:block;font-size:15px;color:#1C1F22;font-weight:600;margin-top:3px;">${escapeHtml(fecha)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #E8E0D5;background:#FAFAF8;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#9B948E;">Hora</span>
                    <span style="display:block;font-size:15px;color:#1C1F22;font-weight:600;margin-top:3px;">${escapeHtml(hora)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;background:#FAFAF8;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#9B948E;">Comensales</span>
                    <span style="display:block;font-size:15px;color:#1C1F22;font-weight:600;margin-top:3px;">${comensales} personas</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 40px;">
              <p style="margin:0;font-size:14px;color:#6B6560;line-height:1.7;">Agradecemos su comprensión y esperamos poder recibirle en otra ocasión.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 48px;background:#1C1F22;text-align:center;">
              <div style="font-family:Georgia,serif;font-size:13px;color:#B8936A;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">${negocio.nombre} · ${negocio.localidad}</div>
              <div style="font-size:12px;color:#6B6560;">${negocio.direccion} &nbsp;·&nbsp; <a href="tel:${negocio.telefonoDigits}" style="color:#6B6560;text-decoration:none;">${negocio.telefonoTexto}</a></div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ------------------------------------------------------------
// PLANTILLA: Confirma tu asistencia (lleva los 2 enlaces con token)
// ------------------------------------------------------------
export function tplConfirmaAsistencia(negocio: DatosNegocio, nombre: string, fecha: string, hora: string, comensales: number, confirmUrl: string, cancelUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmación requerida - ${negocio.nombre}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3EE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EE;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-top:3px solid #B8936A;">
          <tr>
            <td style="padding:40px 48px 32px;text-align:center;border-bottom:1px solid #E8E0D5;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:4px;color:#1C1F22;text-transform:uppercase;font-weight:normal;">${negocio.nombre}</div>
              <div style="width:40px;height:1px;background:#B8936A;margin:14px auto 10px;"></div>
              <div style="font-size:10px;letter-spacing:3px;color:#B8936A;text-transform:uppercase;">${negocio.localidad}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 48px 0;text-align:center;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#1C1F22;font-weight:normal;margin-bottom:12px;">Confirma tu asistencia</div>
              <p style="margin:0;font-size:15px;color:#6B6560;line-height:1.7;">Hola, <strong style="color:#1C1F22;">${escapeHtml(nombre)}</strong>. Tu mesa está casi lista. Solo necesitamos que confirmes tu asistencia para garantizar tu reserva.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 48px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D5;border-top:2px solid #B8936A;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Fecha</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(fecha)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Hora</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(hora)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Comensales</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${comensales} personas</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 16px;">
              <a href="${confirmUrl}" style="display:block;text-align:center;background:#B8936A;color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:18px 0;margin-bottom:12px;">
                Sí, confirmo mi asistencia
              </a>
              <a href="${cancelUrl}" style="display:block;text-align:center;background:transparent;color:#6B6560;text-decoration:none;font-size:12px;letter-spacing:1px;text-transform:uppercase;padding:14px 0;border:1px solid #E8E0D5;">
                Cancelar reserva
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 40px;">
              <p style="margin:0;font-size:12px;color:#9B948E;text-align:center;line-height:1.6;">Si no confirmas, la mesa puede quedar disponible para otros clientes.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 48px;background:#1C1F22;text-align:center;">
              <div style="font-family:Georgia,serif;font-size:13px;color:#B8936A;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">${negocio.nombre} · ${negocio.localidad}</div>
              <div style="font-size:12px;color:#6B6560;">${negocio.direccion} &nbsp;·&nbsp; <a href="tel:${negocio.telefonoDigits}" style="color:#6B6560;text-decoration:none;">${negocio.telefonoTexto}</a></div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ------------------------------------------------------------
// PLANTILLA: Sin disponibilidad (revisión manual del restaurante)
// ------------------------------------------------------------
export function tplSinDisponibilidad(negocio: DatosNegocio, nombre: string, fecha: string, hora: string, comensales: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sin disponibilidad - ${negocio.nombre}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3EE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EE;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-top:3px solid #B8936A;">
          <tr>
            <td style="padding:40px 48px 32px;text-align:center;border-bottom:1px solid #E8E0D5;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:4px;color:#1C1F22;text-transform:uppercase;font-weight:normal;">${negocio.nombre}</div>
              <div style="width:40px;height:1px;background:#B8936A;margin:14px auto 10px;"></div>
              <div style="font-size:10px;letter-spacing:3px;color:#B8936A;text-transform:uppercase;">${negocio.localidad}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 48px 0;text-align:center;">
              <span style="display:inline-block;background:#F0EDEA;border:1px solid #DDD5CC;color:#6B6560;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:6px 16px;">Sin disponibilidad</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 48px 0;">
              <p style="margin:0 0 20px;font-size:22px;color:#1C1F22;font-family:Georgia,'Times New Roman',serif;font-weight:normal;">Estimado/a ${escapeHtml(nombre)}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#6B6560;line-height:1.7;">Lamentamos informarle que el restaurante se encuentra completo para la fecha y hora solicitadas. No podremos confirmar su reserva para los siguientes datos:</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D5;border-top:2px solid #B8936A;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Fecha</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(fecha)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Hora</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(hora)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">Comensales</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${comensales} personas</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 16px;">
              <a href="tel:+34${negocio.telefonoDigits}" style="display:block;text-align:center;background:#1C1F22;color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:18px 0;">
                Llamar a ${negocio.nombre}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 40px;">
              <p style="margin:0;font-size:13px;color:#9B948E;text-align:center;line-height:1.6;">Puedes contactarnos por teléfono para encontrar una alternativa. Disculpe las molestias.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 48px;background:#1C1F22;text-align:center;">
              <div style="font-family:Georgia,serif;font-size:13px;color:#B8936A;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">${negocio.nombre} · ${negocio.localidad}</div>
              <div style="font-size:12px;color:#6B6560;">${negocio.direccion} &nbsp;·&nbsp; <a href="tel:${negocio.telefonoDigits}" style="color:#6B6560;text-decoration:none;">${negocio.telefonoTexto}</a></div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
