// ============================================================================
// PLANTILLAS DE CORREO — esqueleto fijo (aquí) + contenido editable (BD)
// ============================================================================
// CONTRATO para quien construya la interfaz del panel (otro agente, después):
//
// 1. El HTML de correo NUNCA se edita libre. `plantillas_email_reserva`
//    (migración 20260920010000_sistema_emails_reserva.sql) solo guarda TEXTO
//    PLANO en: asunto, saludo, cuerpo, texto_boton_principal,
//    texto_boton_secundario, pie. Ese texto se HTML-escapa siempre antes de
//    insertarse en el esqueleto de abajo — el panel puede dejar que el
//    usuario escriba lo que quiera, incluido "<b>" o "<script>", que llegará
//    aquí como texto literal visible, nunca como markup interpretado. Es
//    deliberado: un editor de HTML libre es la vía directa a un correo roto
//    en Outlook (ver informe). Si algún día se quiere **negrita/enlaces**
//    dentro del cuerpo, es una ampliación de `sustituirTexto`/`parrafosHtml`
//    (una mini-sintaxis tipo `**texto**`), nunca abrir HTML crudo.
//
// 2. `cuerpo` admite párrafos: una línea en blanco separa párrafos (se
//    convierten en `<p>` independientes). Sin líneas en blanco = un único
//    párrafo.
//
// 3. Tokens disponibles (sustitución `{{token}}`, case-sensitive, un token
//    desconocido se sustituye por cadena vacía — nunca deja `{{...}}`
//    literal en el correo final):
//      {{nombre}}              — siempre
//      {{fecha}}               — siempre, "16 de marzo de 2026"
//      {{hora}}                — siempre, hora VIGENTE ("21:00")
//      {{comensales}}          — siempre, "4 personas"
//      {{espacio}}             — SIEMPRE "" (ver punto 7)
//      {{hora_solicitada}}     — solo relevante en tipo 'propuesta'
//      {{espacio_solicitado}}  — SIEMPRE "" (ver punto 7)
//      {{negocio}}             — siempre, "Casa Tomás" | "Touza"
//    Disponibles en TODOS los tipos aunque solo tengan sentido en algunos —
//    usarlos fuera de 'propuesta' es válido pero probablemente no lo que se
//    quiere (mostraría la hora vigente dos veces).
//
// 4. `bloques` (jsonb) — flags EDITORIALES, cada uno con su default si la
//    clave no está presente:
//      mostrar_tabla_detalles    (default true)  — tabla fecha/hora/comensales
//      mostrar_boton_secundario  (default true)  — el 2º botón, si la
//                                                    plantilla y los datos
//                                                    traen uno
//      mostrar_pie_contacto      (default true)  — línea de dirección/teléfono
//    NO existe un flag para "mostrar comparación solicitado/ofrecido": eso
//    NO es editorial, es automático — aparece si y solo si `hayContraoferta()`
//    detecta una diferencia real entre lo pedido y lo ofrecido (ver abajo).
//    Un editor no puede ocultar que se está cambiando la reserva del cliente.
//
// 5. Un tipo sin `texto_boton_principal`/`_secundario` en la fila, o sin
//    URL correspondiente en los datos de la reserva, simplemente no pinta
//    ese botón — no es un error.
//
// 6. `renderPlantilla` es una función PURA (sin I/O): recibe la fila de la
//    tabla + los datos ya resueltos de la reserva (nombres de espacio ya
//    convertidos de uuid a texto por quien llama) y devuelve
//    `{ asunto, html }`. Quien la llama (index.ts) es responsable de leer
//    la plantilla vigente de la BD y de resolver nombres de espacio.
//
// 7. LA SALA NO SALE EN EL CORREO DEL CLIENTE (decisión del dueño,
//    2026-09-28). La sala/espacio es información INTERNA del restaurante
//    "de momento": el cliente no tiene por qué saber si se le sienta en
//    Comedor, Salón o Terraza, y decírselo solo genera llamadas del tipo
//    "quiero que me cambiéis de sala". Qué implica, en este fichero:
//      · la tabla de detalles ya NO pinta la fila "Espacio";
//      · el bloque "Pediste / Te ofrecemos" ya NO pinta " en <sala>";
//      · `hayContraoferta()` mira SOLO la hora (ver su docstring: si
//        siguiera mirando la sala, un cambio de sala a la misma hora
//        pintaría "Pediste: 21:00 / Te ofrecemos: 21:00", dos veces lo
//        mismo, que es peor que no pintar nada);
//      · `{{espacio}}` y `{{espacio_solicitado}}` se sustituyen por cadena
//        vacía — se dejan en el mapa de tokens a propósito, en vez de
//        borrarlos, para que este punto sea visible desde el código y
//        revertirlo sea devolverles su valor (una línea cada uno).
//    `DatosReservaParaCorreo.espacio` / `.espacioSolicitado` SIGUEN en la
//    interfaz y los siguen rellenando index.ts y propuesta-solicitud.ts: no
//    son datos que sobren, son datos que hoy no se enseñan. Quitarlos de la
//    interfaz obligaría a tocar los cuatro sitios que los construyen para
//    nada.
//    PENDIENTE FUERA DE ESTE FICHERO: el panel tiene su propio motor de
//    previsualización (`src/components/emails/motorPlantilla.ts`, copia de
//    este render) y su propio catálogo de tokens
//    (`src/components/emails/catalogoTokens.ts`). Mientras no se les
//    aplique lo mismo, la vista previa del panel enseñará la sala y el
//    catálogo ofrecerá `{{espacio}}` aunque el correo real ya no la pinte.
//
// 8. 'solicitud_recibida' NO SE MANDA EN EL CANAL WEB (misma decisión). La
//    regla vive en `debeEnviarSolicitudRecibida()` (abajo, pura y probada)
//    y la aplica `tipoEmailParaEstado()` en index.ts. Ver el comentario
//    largo de esa función para el porqué y para qué canales siguen
//    recibiéndolo.
// ============================================================================

// Negocio del correo (2026-09-24): las reservas de "El Reservado" son de
// Touza (`reservas.marca = 'touza'`) y se gestionan igual que las de Casa
// Tomás, así que su correo lleva el nombre, la dirección y el teléfono de
// Touza. Única fuente de esos datos: `NEGOCIOS` de reservas-web (módulo puro,
// sin imports). Sin marca o marca desconocida => Casa Tomás.
import { NEGOCIOS, NEGOCIO_POR_DEFECTO, esMarcaValida, type DatosNegocio } from "../reservas-web/plantillas.ts";

export type { DatosNegocio };

/** Datos de contacto del negocio de una marca (desconocida/null => Casa Tomás). */
export function negocioParaMarca(marca: unknown): DatosNegocio {
  return NEGOCIOS[esMarcaValida(marca) ? marca : NEGOCIO_POR_DEFECTO];
}

export type TipoPlantilla =
  | "solicitud_recibida"
  | "propuesta"
  | "confirmada"
  | "rechazada"
  | "recordatorio";

export const TIPOS_PLANTILLA: readonly TipoPlantilla[] = [
  "solicitud_recibida",
  "propuesta",
  "confirmada",
  "rechazada",
  "recordatorio",
];

export interface FilaPlantilla {
  tipo: TipoPlantilla;
  version: number;
  asunto: string;
  saludo: string;
  cuerpo: string;
  texto_boton_principal: string | null;
  texto_boton_secundario: string | null;
  pie: string | null;
  color_acento: string;
  color_oscuro: string;
  logo_url: string | null;
  bloques: Record<string, unknown> | null;
}

export interface DatosReservaParaCorreo {
  nombre: string;
  /** ISO "YYYY-MM-DD" */
  fecha: string;
  /** "HH:MM" o "HH:MM:SS" — hora VIGENTE (la ofrecida, si hubo contraoferta) */
  hora: string;
  comensales: number;
  /** Nombre del espacio VIGENTE ya resuelto (no el uuid), o null si no hay asignado */
  espacio: string | null;
  /** Hora tal y como se pidió originalmente. Si es igual a `hora`, no hay contraoferta de hora. */
  horaSolicitada?: string | null;
  /** Nombre del espacio tal y como se pidió originalmente, ya resuelto. */
  espacioSolicitado?: string | null;
  botonPrincipalUrl?: string | null;
  botonSecundarioUrl?: string | null;
  /** Negocio de la reserva (ver `negocioParaMarca`). Sin él, Casa Tomás. */
  negocio?: DatosNegocio | null;
}

interface FilaTabla {
  etiqueta: string;
  valor: string;
}

interface Boton {
  texto: string;
  url: string;
  estilo: "primario" | "secundario";
}

export interface ResultadoRenderizado {
  asunto: string;
  html: string;
}

// ----------------------------------------------------------------------------
// Utilidades puras
// ----------------------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-03-16" -> "16 de marzo de 2026". Sin Intl a propósito: determinista
 * en cualquier runtime/entorno de test, sin depender de locales instalados. */
export function formatearFecha(fechaIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIso || "");
  if (!m) return fechaIso || "";
  const [, anio, mes, dia] = m;
  const idx = parseInt(mes, 10) - 1;
  const nombreMes = MESES[idx] ?? mes;
  return `${parseInt(dia, 10)} de ${nombreMes} de ${anio}`;
}

/** "21:00:00" o "21:00" -> "21:00" */
export function formatearHora(hora: string): string {
  return (hora || "").slice(0, 5);
}

/** Verdadero si la HORA vigente difiere de la solicitada originalmente. Es
 * la única señal que decide si se pinta el bloque de comparación — no
 * depende de ningún flag editorial (ver contrato arriba).
 *
 * SOLO LA HORA desde 2026-09-28 (punto 7 del contrato): antes también
 * devolvía true cuando cambiaba la SALA. Ahora que el correo del cliente no
 * nombra la sala, esa rama pintaba un bloque absurdo — un cambio de sala a
 * la misma hora daba literalmente "Pediste: 21:00 / Te ofrecemos: 21:00".
 * El cliente no pierde información: la sala nunca la pidió (ver
 * `datosCorreoPropuestaSolicitud` en propuesta-solicitud.ts, que ya ponía
 * `espacio === espacioSolicitado` justamente porque "la sala no se
 * compara"), y un cambio de hora sí se le sigue enseñando. */
export function hayContraoferta(datos: DatosReservaParaCorreo): boolean {
  if (datos.horaSolicitada === undefined || datos.horaSolicitada === null) return false;
  return formatearHora(datos.hora) !== formatearHora(datos.horaSolicitada);
}

/**
 * ¿Toca mandar el correo de 'solicitud_recibida' a una reserva de este
 * canal? (`reservas.canal`: 'web' | 'telefono' | 'manual' | null).
 *
 * DECISIÓN DEL DUEÑO (2026-09-28): en el canal WEB el cliente recibía DOS
 * correos seguidos — 'solicitud_recibida' ("hemos recibido tu solicitud") y,
 * en cuanto alguien la revisaba, 'propuesta' ("confirma tu reserva", la de
 * los botones). El primero sobra: el propio formulario ya le dice en
 * pantalla que se le contactará cuando se confirme, así que el único correo
 * que recibe es la 'propuesta'.
 *
 * SE SILENCIA POR CANAL, NO GLOBALMENTE, porque el tipo sigue vivo para
 * otros:
 *   · 'telefono' — `fn_aceptar_propuesta_solicitud` crea la reserva en
 *     estado 'pendiente' (en vez de 'confirmada') cuando el cliente está en
 *     la lista negra, e `index.ts::ejecutarPropuesta` manda entonces este
 *     correo. Ahí el cliente NO ha visto ninguna pantalla que se lo diga:
 *     pulsó "aceptar" en un correo y necesita saber que su petición quedó
 *     registrada. La reserva nace con canal='telefono', así que esa rama no
 *     la toca esta regla.
 *   · 'manual' — altas del panel. Hoy nacen 'verificada' (correo
 *     'propuesta'), pero si alguien mueve una reserva a 'pendiente' desde
 *     la lista, sigue saliendo su correo.
 *
 * Y se silencia AQUÍ, en emails-reserva, y no solo dejando de llamar desde
 * reservas-web, porque `/notificar` deriva el tipo del ESTADO de la reserva
 * y lo llama también `notify-reservation-change` (panel). Sin esta regla,
 * devolver una reserva web a 'pendiente' desde la lista le mandaría al
 * cliente el correo que acabamos de quitar.
 *
 * REVERSIBLE: vaciar `CANALES_SIN_SOLICITUD_RECIBIDA` devuelve el correo a
 * todos los canales. No se ha tocado ni la fila de `plantillas_email_reserva`
 * ni el CHECK de `envios_email_reserva.tipo_email` (ver informe).
 */
export const CANALES_SIN_SOLICITUD_RECIBIDA: readonly string[] = ["web"];

export function debeEnviarSolicitudRecibida(canal: string | null | undefined): boolean {
  return !CANALES_SIN_SOLICITUD_RECIBIDA.includes((canal ?? "").trim().toLowerCase());
}

const TOKEN_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

export function construirTokens(datos: DatosReservaParaCorreo): Record<string, string> {
  return {
    nombre: datos.nombre || "",
    fecha: formatearFecha(datos.fecha),
    hora: formatearHora(datos.hora),
    comensales: `${datos.comensales} ${datos.comensales === 1 ? "persona" : "personas"}`,
    // La sala no se le dice al cliente (punto 7 del contrato): estos dos
    // tokens se quedan en el mapa —siguen siendo tokens CONOCIDOS, no
    // dejan "{{espacio}}" literal en el correo— pero se sustituyen por
    // cadena vacía. Se dejan aquí en vez de borrarlos para que la decisión
    // se vea en el código y revertirla sea devolverles `datos.espacio || ""`
    // y `datos.espacioSolicitado || ""`. Hoy no los usa NINGUNA plantilla de
    // `plantillas_email_reserva` (comprobado en la BD del proyecto el
    // 2026-09-28), así que esto no cambia ni un correo existente.
    espacio: "",
    hora_solicitada: formatearHora(datos.horaSolicitada || datos.hora),
    espacio_solicitado: "",
    negocio: (datos.negocio ?? NEGOCIOS[NEGOCIO_POR_DEFECTO]).nombre,
  };
}

/** Sustituye {{token}} en texto plano por valores de `tokens`. Escapa TANTO
 * el texto de la plantilla COMO cada valor sustituido — no basta con
 * escapar solo el texto: `datos.nombre` viene de `reservas.nombre`, que
 * varios canales de alta (Touza en particular, ver
 * docs/funcionalidades/01-reservas.md §5.5: "No valida absolutamente
 * nada") aceptan sin ninguna validación. Un cliente podría escribir
 * "<script>" como nombre; sin este doble escapado acabaría interpretado en
 * el HTML del correo. Un token no reconocido se sustituye por "" (nunca
 * deja "{{...}}" literal en el correo). */
export function sustituirTexto(textoPlano: string, tokens: Record<string, string>): string {
  const escapado = escapeHtml(textoPlano ?? "");
  return escapado.replace(TOKEN_RE, (_match, clave: string) => {
    const valor = tokens[clave];
    return valor !== undefined ? escapeHtml(valor) : "";
  });
}

/** Texto ya escapado+sustituido, con línea en blanco = separador de párrafo. */
function parrafosHtml(textoEscapado: string): string {
  const bloques = textoEscapado
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (bloques.length === 0) return "";
  return bloques
    .map((b) => `<p style="margin:0 0 20px;font-size:15px;color:#6B6560;line-height:1.7;">${b.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function leerBloque(bloques: Record<string, unknown> | null, clave: string, porDefecto: boolean): boolean {
  if (!bloques || !(clave in bloques)) return porDefecto;
  return bloques[clave] !== false;
}

const INSIGNIA_POR_TIPO: Record<TipoPlantilla, string> = {
  solicitud_recibida: "Solicitud recibida",
  propuesta: "Confirmación pendiente",
  confirmada: "Reserva confirmada",
  rechazada: "Solicitud no procesada",
  recordatorio: "Recordatorio de tu reserva",
};

// ----------------------------------------------------------------------------
// Esqueleto fijo — mismo lenguaje visual que supabase/functions/reservas-web
// (tabla de 560px, Georgia serif para la marca, paleta oro/antracita, todo
// estilos en línea: es el subconjunto de CSS que sobrevive en Outlook/Gmail).
// No se toca reservas-web; esto es una copia deliberada del mismo estilo,
// parametrizada, para que los correos de ambas funciones sean indistinguibles
// para el cliente.
// ----------------------------------------------------------------------------

function filaTablaHtml(fila: FilaTabla): string {
  return `
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E0D5;">
                    <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#B8936A;display:block;margin-bottom:4px;">${escapeHtml(fila.etiqueta)}</span>
                    <span style="font-size:16px;color:#1C1F22;font-weight:600;">${escapeHtml(fila.valor)}</span>
                  </td>
                </tr>`;
}

function botonHtml(boton: Boton, colorAcento: string, colorOscuro: string): string {
  const esPrimario = boton.estilo === "primario";
  const fondo = esPrimario ? colorAcento : "transparent";
  const color = esPrimario ? "#FFFFFF" : "#6B6560";
  const borde = esPrimario ? "" : `border:1px solid #E8E0D5;`;
  return `
              <a href="${escapeHtml(boton.url)}" style="display:block;text-align:center;background:${fondo};color:${color};text-decoration:none;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:18px 0;margin-bottom:12px;${borde}">
                ${escapeHtml(boton.texto)}
              </a>`;
}

interface EsqueletoParams {
  insignia: string;
  saludoHtml: string;
  cuerpoHtml: string;
  filasTabla: FilaTabla[];
  comparacion: { solicitado: FilaTabla; ofrecido: FilaTabla } | null;
  botones: Boton[];
  pieHtml: string | null;
  colorAcento: string;
  colorOscuro: string;
  logoUrl: string | null;
  negocio: DatosNegocio;
}

function envolverEsqueleto(p: EsqueletoParams): string {
  const marca = p.logoUrl
    ? `<img src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.negocio.nombre)}" style="max-height:48px;display:inline-block;">`
    : `<div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:4px;color:${escapeHtml(p.colorOscuro)};text-transform:uppercase;font-weight:normal;">${escapeHtml(p.negocio.nombre)}</div>`;

  const bloqueComparacion = p.comparacion
    ? `
          <tr>
            <td style="padding:0 48px 8px;">
              <div style="background:#FFF9F0;border:1px solid ${escapeHtml(p.colorAcento)};padding:16px 20px;font-size:13px;color:#6B6560;line-height:1.6;">
                <strong style="color:${escapeHtml(p.colorOscuro)};">Pediste:</strong> ${escapeHtml(p.comparacion.solicitado.valor)}<br>
                <strong style="color:${escapeHtml(p.colorOscuro)};">Te ofrecemos:</strong> ${escapeHtml(p.comparacion.ofrecido.valor)}
              </div>
            </td>
          </tr>`
    : "";

  const bloqueTabla = p.filasTabla.length
    ? `
          <tr>
            <td style="padding:0 48px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D5;border-top:2px solid ${escapeHtml(p.colorAcento)};">
                ${p.filasTabla.map(filaTablaHtml).join("\n")}
              </table>
            </td>
          </tr>`
    : "";

  const bloqueBotones = p.botones.length
    ? `
          <tr>
            <td style="padding:0 48px 16px;">
              ${p.botones.map((b) => botonHtml(b, p.colorAcento, p.colorOscuro)).join("\n")}
            </td>
          </tr>`
    : "";

  const bloquePie = p.pieHtml
    ? `
          <tr>
            <td style="padding:24px 48px;background:${escapeHtml(p.colorOscuro)};text-align:center;">
              <div style="font-size:12px;color:#C9C2B8;line-height:1.6;">${p.pieHtml}</div>
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(p.negocio.nombre)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3EE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EE;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-top:3px solid ${escapeHtml(p.colorAcento)};">
          <tr>
            <td style="padding:40px 48px 32px;text-align:center;border-bottom:1px solid #E8E0D5;">
              ${marca}
              <div style="width:40px;height:1px;background:${escapeHtml(p.colorAcento)};margin:14px auto 10px;"></div>
              <div style="font-size:10px;letter-spacing:3px;color:${escapeHtml(p.colorAcento)};text-transform:uppercase;">${escapeHtml(p.negocio.localidad)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 48px 0;text-align:center;">
              <span style="display:inline-block;background:#F7F3EE;border:1px solid #E8E0D5;color:#6B6560;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:6px 16px;">${escapeHtml(p.insignia)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 48px 0;">
              <p style="margin:0 0 20px;font-size:22px;color:${escapeHtml(p.colorOscuro)};font-family:Georgia,'Times New Roman',serif;font-weight:normal;">${p.saludoHtml}</p>
              ${p.cuerpoHtml}
            </td>
          </tr>${bloqueComparacion}${bloqueTabla}${bloqueBotones}
          <tr>
            <td style="padding:0 48px 24px;">
              <p style="margin:0;font-size:12px;color:#9B948E;text-align:center;line-height:1.6;">${escapeHtml(p.negocio.nombre)} · ${escapeHtml(p.negocio.direccion)}, ${escapeHtml(p.negocio.localidad)} · <a href="tel:${escapeHtml(p.negocio.telefonoDigits)}" style="color:#9B948E;">${escapeHtml(p.negocio.telefonoTexto)}</a></p>
            </td>
          </tr>${bloquePie}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ----------------------------------------------------------------------------
// Render principal
// ----------------------------------------------------------------------------

/**
 * Las plantillas de `plantillas_email_reserva` son UNA por tipo (no por
 * negocio) y su texto se escribió para Casa Tomás ("Gracias por reservar en
 * Casa Tomás"). En un correo de otro negocio, cada mención literal de "Casa
 * Tomás" se cambia por el nombre de ese negocio; para textos nuevos, mejor
 * usar el token {{negocio}}. En un correo de Casa Tomás no cambia nada.
 */
export function adaptarTextoANegocio(textoPlano: string, negocio: DatosNegocio): string {
  if (!textoPlano || negocio.nombre === NEGOCIOS[NEGOCIO_POR_DEFECTO].nombre) return textoPlano;
  return textoPlano.replace(/Casa Tom[aá]s/gi, negocio.nombre);
}

/**
 * Páginas HTML que ve el cliente al pulsar un enlace del correo (index.ts):
 * se escribieron con el nombre y el teléfono de Casa Tomás. Para una reserva
 * de otro negocio se cambian por los suyos. En Casa Tomás no cambia nada.
 */
export function adaptarPaginaANegocio(html: string, negocio: DatosNegocio): string {
  const ct = NEGOCIOS[NEGOCIO_POR_DEFECTO];
  if (!html || negocio.nombre === ct.nombre) return html;
  return html
    .split(ct.nombre).join(negocio.nombre)
    .split(ct.telefonoTexto).join(negocio.telefonoTexto)
    .split(`tel:${ct.telefonoDigits}`).join(`tel:${negocio.telefonoDigits}`);
}

export function renderPlantilla(
  plantilla: FilaPlantilla,
  datos: DatosReservaParaCorreo,
): ResultadoRenderizado {
  const tokens = construirTokens(datos);
  const negocio = datos.negocio ?? NEGOCIOS[NEGOCIO_POR_DEFECTO];
  const texto = (t: string) => adaptarTextoANegocio(t, negocio);

  const asunto = sustituirTexto(texto(plantilla.asunto), tokens);
  const saludoHtml = sustituirTexto(texto(plantilla.saludo), tokens);
  const cuerpoHtml = parrafosHtml(sustituirTexto(texto(plantilla.cuerpo), tokens));
  const pieTexto = plantilla.pie ? sustituirTexto(texto(plantilla.pie), tokens) : null;

  const mostrarTabla = leerBloque(plantilla.bloques, "mostrar_tabla_detalles", true);
  const mostrarBotonSecundario = leerBloque(plantilla.bloques, "mostrar_boton_secundario", true);
  const mostrarPie = leerBloque(plantilla.bloques, "mostrar_pie_contacto", true);

  // Tres filas FIJAS. Antes había una cuarta, "Espacio", condicionada a
  // `datos.espacio` — fuera desde 2026-09-28 (punto 7 del contrato).
  // El diseño no hay que cuadrarlo: `filaTablaHtml` apila `<tr>` a ancho
  // completo (etiqueta arriba, valor debajo), sin columnas ni alturas
  // fijas, y la tabla de 3 filas ya era el caso NORMAL —la cuarta solo
  // salía si la reserva tenía sala asignada, que en un correo de
  // 'solicitud_recibida' o de 'propuesta' de la web casi nunca pasaba—.
  // Lo único que cambia es que la tabla mide una fila menos.
  const filasTabla: FilaTabla[] = mostrarTabla
    ? [
        { etiqueta: "Fecha", valor: formatearFecha(datos.fecha) },
        { etiqueta: "Hora", valor: formatearHora(datos.hora) },
        { etiqueta: "Comensales", valor: `${datos.comensales}` },
      ]
    : [];

  // Solo horas: ni "Pediste: 20:00 en Terraza" ni "Te ofrecemos: 21:00 en
  // Comedor" (punto 7). `hayContraoferta` ya garantiza que las dos horas
  // son distintas, así que el bloque nunca sale diciendo lo mismo dos veces.
  const comparacion = hayContraoferta(datos)
    ? {
        solicitado: { etiqueta: "Solicitado", valor: formatearHora(datos.horaSolicitada || datos.hora) },
        ofrecido: { etiqueta: "Ofrecido", valor: formatearHora(datos.hora) },
      }
    : null;

  const botones: Boton[] = [];
  if (plantilla.texto_boton_principal && datos.botonPrincipalUrl) {
    botones.push({
      texto: sustituirTexto(plantilla.texto_boton_principal, tokens),
      url: datos.botonPrincipalUrl,
      estilo: "primario",
    });
  }
  if (mostrarBotonSecundario && plantilla.texto_boton_secundario && datos.botonSecundarioUrl) {
    botones.push({
      texto: sustituirTexto(plantilla.texto_boton_secundario, tokens),
      url: datos.botonSecundarioUrl,
      estilo: "secundario",
    });
  }

  const html = envolverEsqueleto({
    insignia: INSIGNIA_POR_TIPO[plantilla.tipo],
    saludoHtml,
    cuerpoHtml,
    filasTabla,
    comparacion,
    botones,
    pieHtml: mostrarPie ? pieTexto : null,
    colorAcento: plantilla.color_acento || "#B8936A",
    colorOscuro: plantilla.color_oscuro || "#1C1F22",
    // El logo guardado en la plantilla es el de Casa Tomás: en un correo de
    // otro negocio se pinta su nombre en texto.
    logoUrl: negocio === NEGOCIOS[NEGOCIO_POR_DEFECTO] ? plantilla.logo_url : null,
    negocio,
  });

  return { asunto, html };
}
