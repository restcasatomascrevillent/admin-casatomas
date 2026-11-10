// ============================================================================
// PLANTILLAS DEL NEWSLETTER — código PURO (sin Deno, sin red, sin secretos)
// ----------------------------------------------------------------------------
// Una sola copia para dos sitios:
//   · enviar-newsletter/index.ts (el correo real que sale por Resend), y
//   · el panel (src/components/marketing/PreviewNewsletter.tsx), que pinta la
//     vista previa con ESTA MISMA función. Mismo criterio que
//     src/components/emails/motorPlantilla.ts con emails-reserva/plantillas.ts:
//     una vista previa que no es el mismo código acaba mintiendo.
//   Por eso este fichero NO puede importar nada de https:// ni usar Deno.*:
//   el build del panel se rompería (fallo ruidoso, que es lo que queremos).
//
// QUÉ GARANTIZA (encargo del dueño, 2026-10-03: "que en la newsletter se ponga
// automático el darse de baja"):
//   1. TODO correo lleva el pie de baja (`pieBaja`): lo añade la plantilla, no
//      el personal. El personal escribe el texto de los bloques; no hay forma
//      de quitar el pie desde el panel.
//   2. Lo que escribe el personal (o propone la IA) se ESCAPA antes de meterlo
//      en el HTML. Un `<style>.footer{display:none}</style>` en un texto no
//      esconde el enlace de baja: llega como texto visible.
//   3. Las imágenes solo se aceptan si son URL https:// válidas; los botones,
//      https:// o tel:.
//   4. `renderNewsletter` falla si no se le da enlace de baja, e index.ts
//      comprueba con `tieneEnlaceBaja` que el enlace está en el HTML final
//      antes de enviar (defensa en profundidad: si alguien toca una plantilla
//      y se carga el pie, ese correo no sale).
//
// DISEÑO (10/11/2026, «mejorar las plantillas siguiendo la estética actual»):
// el mismo lenguaje que los correos de reserva y la web pública: fondo crema,
// tarjeta blanca de 600 px con filete dorado, logo de la web, títulos en
// Libre Baskerville (Georgia de respaldo), etiquetas en versalitas doradas y
// pie en el gris pizarra de la web. Hecho para clientes de correo reales:
// tablas, estilos en línea, ancho fijo con `max-width` (Outlook con
// condicional `mso`), texto de vista previa (preheader), textos alternativos,
// ajustes de móvil por media query y colores para modo oscuro
// (prefers-color-scheme y [data-ogsc] de Outlook.com). Contenido: bloques
// (../_shared/newsletter/bloques.ts).
// ============================================================================

import {
  bloquesDeMensaje,
  esTipoNewsletter,
  plantillaBase,
  textoPlanoDeBloques,
  urlHttpsSegura,
  validarBloques,
  LIMITE_INSIGNIA,
  LIMITE_MENSAJE,
  LIMITE_PREHEADER,
  LIMITE_TITULO,
  LIMITE_URL,
  URL_WEB,
  TIPOS_NEWSLETTER,
  type Bloque,
  type TipoNewsletter,
} from "../_shared/newsletter/bloques.ts";

export { TIPOS_NEWSLETTER, LIMITE_TITULO, LIMITE_MENSAJE };
export type { TipoNewsletter, Bloque };

export const LIMITE_URL_IMAGEN = LIMITE_URL;

/** Atributo que marca el pie obligatorio (lo usan los tests y la comprobación previa al envío). */
export const MARCA_PIE_BAJA = 'data-pie-baja="obligatorio"';

/** Logo de la web pública (ruta estable, sin hash de compilación). */
export const URL_LOGO = `${URL_WEB}/logo-casa-tomas.png`;

export function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Solo URLs https:// bien formadas; cualquier otra cosa (javascript:, data:, http:, basura) se descarta. */
export function urlImagenSegura(url: string | null | undefined): string | null {
  return urlHttpsSegura(url);
}

export interface DatosNewsletter {
  tipo: TipoNewsletter;
  titulo: string;
  /** Versión de texto (historial). Con bloques, se deriva de ellos si no viene. */
  mensaje: string;
  /** Solo envíos «de siempre» (sin bloques): foto de cabecera. */
  imagenUrl?: string | null;
  /** Diseño por bloques. Sin bloques se pinta título + mensaje (+ foto). */
  bloques?: Bloque[] | null;
  /** Etiqueta sobre el título; por defecto la de la plantilla. */
  insignia?: string | null;
  /** Texto que el programa de correo enseña junto al asunto. */
  preheader?: string | null;
}

export type ResultadoValidacion =
  | { ok: true; datos: DatosNewsletter }
  | { ok: false; error: string };

const unaLinea = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.replace(/[\r\n\t]+/g, " ").trim();
  return t.length > max ? null : t;
};

/** Valida el cuerpo que manda el panel a enviar-newsletter. */
export function validarPayload(raw: unknown): ResultadoValidacion {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Cuerpo de la petición no válido" };
  const r = raw as Record<string, unknown>;
  const tipo = r.tipo;
  if (!esTipoNewsletter(tipo)) return { ok: false, error: "Tipo de newsletter no válido" };
  const titulo = typeof r.titulo === "string" ? r.titulo.trim() : "";
  let mensaje = typeof r.mensaje === "string" ? r.mensaje.trim() : "";

  let bloques: Bloque[] | null = null;
  if (r.bloques !== undefined && r.bloques !== null) {
    const v = validarBloques(r.bloques);
    if (v.ok === false) return { ok: false, error: v.error };
    bloques = v.bloques;
    if (!mensaje) mensaje = textoPlanoDeBloques(bloques);
  }

  if (!titulo || !mensaje) return { ok: false, error: "Campos requeridos: tipo, titulo, mensaje" };
  if (titulo.length > LIMITE_TITULO) return { ok: false, error: `El título no puede superar ${LIMITE_TITULO} caracteres` };
  if (mensaje.length > LIMITE_MENSAJE) return { ok: false, error: `El mensaje no puede superar ${LIMITE_MENSAJE} caracteres` };
  let imagenUrl: string | null = null;
  if (r.imagen_url !== undefined && r.imagen_url !== null && r.imagen_url !== "") {
    imagenUrl = urlImagenSegura(typeof r.imagen_url === "string" ? r.imagen_url : null);
    if (!imagenUrl) return { ok: false, error: "La imagen debe ser una URL https:// válida" };
  }
  const insignia = unaLinea(r.insignia, LIMITE_INSIGNIA);
  if (insignia === null) return { ok: false, error: `La etiqueta no puede superar ${LIMITE_INSIGNIA} caracteres` };
  const preheader = unaLinea(r.preheader, LIMITE_PREHEADER);
  if (preheader === null) return { ok: false, error: `El texto de vista previa no puede superar ${LIMITE_PREHEADER} caracteres` };

  const datos: DatosNewsletter = { tipo, titulo, mensaje, imagenUrl };
  if (bloques) datos.bloques = bloques;
  if (insignia) datos.insignia = insignia;
  if (preheader) datos.preheader = preheader;
  return { ok: true, datos };
}

/** Asunto del correo. Sin saltos de línea (no se pueden colar cabeceras). */
export function asuntoNewsletter(tipo: TipoNewsletter, titulo: string): string {
  const limpio = titulo.replace(/[\r\n]+/g, " ").trim();
  const emoji = plantillaBase(tipo).emoji;
  return emoji ? `${emoji} ${limpio}` : limpio;
}

/** Cabeceras RFC 2369 + RFC 8058: botón nativo "Cancelar suscripción" de Gmail/Outlook/Yahoo (un clic, POST). */
export function cabecerasBaja(urlOneClick: string): Record<string, string> {
  if (!urlOneClick) throw new Error("cabecerasBaja: falta la URL de baja one-click");
  return {
    "List-Unsubscribe": `<${urlOneClick}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Pie de baja OBLIGATORIO. Lo mete la plantilla; el personal no lo toca.
 * Explica por qué recibe el correo (consentimiento en la reserva) y da el enlace
 * personal de baja (firmado HMAC por suscriptor, ver newsletter-baja).
 */
export function pieBaja(enlaceBaja: string, colorEnlace: string): string {
  if (!enlaceBaja) throw new Error("pieBaja: falta el enlace de baja");
  const href = escapeHtml(enlaceBaja);
  return `<p ${MARCA_PIE_BAJA} style="margin: 12px 0 0; font-size: 12px; line-height: 1.5;">
        Recibes este correo porque aceptaste recibir las novedades de Casa Tomás al hacer una reserva.<br>
        <a href="${href}" class="ct-enlace-pie" style="color: ${colorEnlace}; text-decoration: underline;">Darse de baja</a> de estos correos en cualquier momento.
      </p>`;
}

/** true si el HTML lleva el pie obligatorio con ESE enlace de baja. */
export function tieneEnlaceBaja(html: string, enlaceBaja: string): boolean {
  if (!html || !enlaceBaja) return false;
  return html.includes(MARCA_PIE_BAJA) && html.includes(`href="${escapeHtml(enlaceBaja)}"`);
}

// ==================== ESTÉTICA ====================
// Colores de la web pública (gris pizarra hsl(206 11% 25%) y dorado
// hsl(38 59% 35–45%)) y de los correos de reserva (crema, bordes arena).

export const COLORES = {
  fondo: "#F7F3EE",
  tarjeta: "#FFFFFF",
  pizarra: "#363E45",
  tinta: "#2B3137",
  texto: "#5A5550",
  suave: "#8A847E",
  oro: "#B8936A",
  /** Dorado oscuro para texto sobre blanco (contraste AA). */
  oroTexto: "#8A6A2E",
  borde: "#E8E0D5",
  crema: "#FBF7F1",
  pieTexto: "#C9C2B8",
  pieEnlace: "#E8D9C4",
} as const;

const SERIF = "'Libre Baskerville', Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const ANCHO = 600;
const ANCHO_CONTENIDO = 520; // 600 − 2 × 40 de margen

const C = COLORES;

/** Párrafos: una línea en blanco separa párrafos; un salto simple es <br>. */
function parrafos(textoPlano: string, estilo: string): string {
  return textoPlano
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="ct-texto" style="${estilo}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

const P_CUERPO = `margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.7;color:${C.texto};`;

const fila = (contenido: string, padding = "0 40px 24px") =>
  `<tr><td class="ct-pad" style="padding:${padding};">${contenido}</td></tr>`;

const etiqueta = (t: string) =>
  `<div class="ct-oro" style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.oroTexto};margin:0 0 10px;">${escapeHtml(t)}</div>`;

function bloqueHtml(b: Bloque): string {
  switch (b.tipo) {
    case "texto":
      return fila(parrafos(b.texto, P_CUERPO), "0 40px 8px");
    case "firma":
      return fila(
        parrafos(b.texto, `margin:0 0 8px;font-family:${SERIF};font-size:16px;font-style:italic;line-height:1.6;color:${C.tinta};`).replace(/class="ct-texto"/g, 'class="ct-titulo"'),
        "8px 40px 24px",
      );
    case "imagen": {
      const img = `<img src="${escapeHtml(b.url)}" width="${ANCHO_CONTENIDO}" alt="${escapeHtml(b.alt)}" style="display:block;width:100%;max-width:${ANCHO_CONTENIDO}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:2px;">`;
      const pie = b.pie
        ? `<div class="ct-suave" style="font-family:${SANS};font-size:13px;font-style:italic;color:${C.suave};text-align:center;padding-top:8px;">${escapeHtml(b.pie)}</div>`
        : "";
      return fila(img + pie);
    }
    case "destacado":
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ct-caja" bgcolor="${C.crema}" style="background-color:${C.crema};border:1px solid ${C.borde};border-left:3px solid ${C.oro};padding:20px 24px;">
          ${b.titulo ? etiqueta(b.titulo) : ""}
          ${parrafos(b.texto, `margin:0 0 8px;font-family:${SANS};font-size:15px;line-height:1.7;color:${C.texto};`)}
        </td></tr></table>`,
      );
    case "platos": {
      const filas = b.platos
        .map(
          (p, i) => `<tr>
            <td class="ct-borde" style="padding:14px 0;${i < b.platos.length - 1 ? `border-bottom:1px solid ${C.borde};` : ""}vertical-align:top;">
              <div class="ct-titulo" style="font-family:${SERIF};font-size:17px;line-height:1.4;color:${C.tinta};">${escapeHtml(p.nombre)}</div>
              ${p.descripcion ? `<div class="ct-suave" style="font-family:${SANS};font-size:14px;font-style:italic;line-height:1.5;color:${C.suave};padding-top:4px;">${escapeHtml(p.descripcion)}</div>` : ""}
            </td>
            <td class="ct-borde" align="right" style="padding:14px 0 14px 16px;${i < b.platos.length - 1 ? `border-bottom:1px solid ${C.borde};` : ""}vertical-align:top;white-space:nowrap;font-family:${SERIF};font-size:16px;color:${C.oroTexto};">${p.precio ? `<span class="ct-oro">${escapeHtml(p.precio)}</span>` : ""}</td>
          </tr>`,
        )
        .join("\n");
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ct-borde" style="border-top:2px solid ${C.oro};">
          ${b.titulo ? `<tr><td colspan="2" style="padding:16px 0 0;text-align:center;">${etiqueta(b.titulo)}</td></tr>` : ""}
          ${filas}
        </table>`,
      );
    }
    case "evento": {
      const datos: Array<[string, string | undefined]> = [
        ["Fecha", b.fecha],
        ["Hora", b.hora],
        ["Lugar", b.lugar],
        ["Precio", b.precio],
      ];
      const filas = datos
        .filter(([, v]) => v)
        .map(
          ([k, v]) => `<tr><td class="ct-borde" style="padding:14px 20px;border-bottom:1px solid ${C.borde};">
              <span class="ct-oro" style="display:block;font-family:${SANS};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.oroTexto};margin-bottom:4px;">${k}</span>
              <span class="ct-titulo" style="font-family:${SANS};font-size:16px;font-weight:600;color:${C.tinta};">${escapeHtml(v!)}</span>
            </td></tr>`,
        )
        .join("\n");
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ct-caja" style="border:1px solid ${C.borde};border-top:2px solid ${C.oro};background-color:${C.tarjeta};">${filas}</table>`,
      );
    }
    case "boton":
      return fila(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto;"><tr>
          <td class="ct-boton" bgcolor="${C.pizarra}" style="background-color:${C.pizarra};border-radius:2px;mso-padding-alt:14px 32px;">
            <a href="${escapeHtml(b.url)}" class="ct-boton-texto" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;">${escapeHtml(b.texto)}</a>
          </td>
        </tr></table>`,
        "8px 40px 24px",
      );
    case "cita":
      return fila(
        `<div style="text-align:center;padding:8px 16px;">
          <div class="ct-oro" style="font-family:${SERIF};font-size:36px;line-height:1;color:${C.oro};">&ldquo;</div>
          <div class="ct-titulo" style="font-family:${SERIF};font-size:19px;font-style:italic;line-height:1.6;color:${C.tinta};">${escapeHtml(b.texto).replace(/\n/g, "<br>")}</div>
          ${b.autor ? `<div class="ct-oro" style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.oroTexto};padding-top:10px;">${escapeHtml(b.autor)}</div>` : ""}
        </div>`,
      );
    case "separador":
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="font-size:0;line-height:0;">
          <div style="width:48px;height:1px;background-color:${C.oro};margin:4px auto;font-size:0;line-height:0;">&nbsp;</div>
        </td></tr></table>`,
        "8px 40px 24px",
      );
  }
}

const CSS = `
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    body { margin:0 !important; padding:0 !important; width:100% !important; }
    a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
    @media only screen and (max-width:620px) {
      .ct-exterior { padding:16px 8px !important; }
      .ct-pad { padding-left:24px !important; padding-right:24px !important; }
      .ct-cab { padding:28px 24px 20px !important; }
      .ct-h1 { font-size:24px !important; }
      .ct-logo { width:120px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .ct-fondo { background-color:#15181B !important; }
      .ct-tarjeta { background-color:#1F2429 !important; }
      .ct-caja { background-color:#272D33 !important; border-color:#3A4249 !important; }
      .ct-borde { border-color:#3A4249 !important; }
      .ct-texto { color:#D9D3CB !important; }
      .ct-titulo { color:#F3EEE7 !important; }
      .ct-suave { color:#A9A29A !important; }
      .ct-oro { color:#D4B07E !important; }
      .ct-boton { background-color:#B8936A !important; }
      .ct-boton-texto { color:#15181B !important; }
      .ct-pie { background-color:#111417 !important; }
    }
    [data-ogsc] .ct-fondo { background-color:#15181B !important; }
    [data-ogsc] .ct-tarjeta { background-color:#1F2429 !important; }
    [data-ogsc] .ct-caja { background-color:#272D33 !important; }
    [data-ogsc] .ct-texto { color:#D9D3CB !important; }
    [data-ogsc] .ct-titulo { color:#F3EEE7 !important; }
    [data-ogsc] .ct-oro { color:#D4B07E !important; }`;

/** Relleno invisible tras el preheader: evita que el programa de correo enseñe el resto del cuerpo como vista previa. */
const RELLENO_PREHEADER = "&#8199;&#65279;&#847; ".repeat(40);

/**
 * HTML final del newsletter. `enlaceBaja` es obligatorio: el enlace personal
 * del suscriptor (envío real), el marcador de Resend (Broadcast) o uno de
 * muestra (vista previa del panel).
 */
export function renderNewsletter(datos: DatosNewsletter, enlaceBaja: string): string {
  if (!enlaceBaja) throw new Error("renderNewsletter: falta el enlace de baja (es obligatorio en todo envío)");
  const base = plantillaBase(datos.tipo);
  const bloques = datos.bloques?.length ? datos.bloques : bloquesDeMensaje(datos.tipo, datos.mensaje, urlImagenSegura(datos.imagenUrl));
  const insignia = (datos.insignia ?? "").trim() || base.insignia;
  const preheader = (datos.preheader ?? "").trim() || base.preheader;
  const titulo = escapeHtml(datos.titulo);

  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <title>${titulo}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&amp;display=swap" rel="stylesheet">
  <style>${CSS}
  </style>
</head>
<body class="ct-fondo" style="margin:0;padding:0;background-color:${C.fondo};">
  ${preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${RELLENO_PREHEADER}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ct-fondo" bgcolor="${C.fondo}" style="background-color:${C.fondo};">
    <tr>
      <td align="center" class="ct-exterior" style="padding:32px 12px;">
        <!--[if mso]><table role="presentation" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
        <table role="presentation" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0" class="ct-tarjeta" bgcolor="${C.tarjeta}" style="width:100%;max-width:${ANCHO}px;background-color:${C.tarjeta};border-top:3px solid ${C.oro};">
          <tr>
            <td align="center" class="ct-cab" bgcolor="#FFFFFF" style="padding:36px 40px 24px;background-color:#FFFFFF;border-bottom:1px solid ${C.borde};">
              <a href="${URL_WEB}" style="text-decoration:none;"><img src="${URL_LOGO}" width="150" alt="Casa Tomás · restaurante" class="ct-logo" style="display:block;width:150px;max-width:150px;height:auto;margin:0 auto;border:0;font-family:${SERIF};font-size:22px;letter-spacing:3px;color:${C.pizarra};"></a>
              <div style="width:40px;height:1px;background-color:${C.oro};margin:16px auto 10px;font-size:0;line-height:0;">&nbsp;</div>
              <div style="font-family:${SANS};font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${C.oroTexto};">Crevillente</div>
            </td>
          </tr>
          <tr>
            <td class="ct-pad" align="center" style="padding:32px 40px 0;">
              <span class="ct-caja ct-suave" style="display:inline-block;background-color:${C.fondo};border:1px solid ${C.borde};color:${C.texto};font-family:${SANS};font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:6px 16px;">${escapeHtml(insignia)}</span>
            </td>
          </tr>
          <tr>
            <td class="ct-pad" align="center" style="padding:20px 40px 24px;">
              <h1 class="ct-h1 ct-titulo" style="margin:0;font-family:${SERIF};font-size:28px;line-height:1.3;font-weight:normal;color:${C.tinta};">${titulo}</h1>
            </td>
          </tr>
          ${bloques.map(bloqueHtml).join("\n          ")}
          <tr>
            <td class="ct-pad ct-borde" align="center" style="padding:20px 40px;border-top:1px solid ${C.borde};">
              <p class="ct-suave" style="margin:0;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.suave};">
                Casa Tomás · C/ Santa María de la Cabeza, 2 · Crevillente<br>
                <a href="tel:+34966107887" class="ct-suave" style="color:${C.suave};text-decoration:none;">966 10 78 87</a> ·
                <a href="${URL_WEB}" class="ct-oro" style="color:${C.oroTexto};text-decoration:underline;">restaurantecasatomascrevillente.es</a>
              </p>
            </td>
          </tr>
          <tr>
            <td class="ct-pad ct-pie" align="center" bgcolor="${C.pizarra}" style="padding:24px 40px;background-color:${C.pizarra};font-family:${SANS};font-size:12px;line-height:1.6;color:${C.pieTexto};">
              ${pieBaja(enlaceBaja, C.pieEnlace)}
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ==================== LÍMITE DEL ENVÍO TRANSACCIONAL ====================
// enviar-newsletter manda un correo TRANSACCIONAL por suscriptor (emails.send).
// En el plan gratuito de Resend eso cuenta contra la cuota transaccional de
// 100 correos/día y 3.000/mes, COMPARTIDA con los correos de reservas: un
// newsletter grande dejaría sin correos de confirmación al resto del día
// (https://resend.com/docs/knowledge-base/account-quotas-and-limits). Los
// 1.000 contactos del plan de marketing solo se usan enviando como Broadcast
// (fase 2, ver docs/funcionalidades/newsletter-resend-marketing.md).

export const LIMITE_TRANSACCIONAL_POR_DEFECTO = 80;

/** Límite de destinatarios por envío transaccional. "0" lo desactiva (plan de pago). */
export function limiteTransaccional(env: string | null | undefined): number | null {
  const v = (env ?? "").trim();
  if (v === "") return LIMITE_TRANSACCIONAL_POR_DEFECTO;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return LIMITE_TRANSACCIONAL_POR_DEFECTO;
  return n === 0 ? null : Math.floor(n);
}
