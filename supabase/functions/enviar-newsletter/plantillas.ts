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
//      el personal. El personal solo escribe título, mensaje e imagen; no hay
//      forma de quitar el pie desde el panel.
//   2. Lo que escribe el personal se ESCAPA antes de meterlo en el HTML. Antes
//      se interpolaba tal cual: un `<style>.footer{display:none}</style>` en el
//      mensaje escondía el enlace de baja (y cualquier HTML/JS llegaba al
//      cliente de correo y al <iframe> de la vista previa del panel).
//   3. La imagen solo se acepta si es una URL https:// válida.
//   4. `renderNewsletter` falla si no se le da enlace de baja, e index.ts
//      comprueba con `tieneEnlaceBaja` que el enlace está en el HTML final
//      antes de enviar (defensa en profundidad: si alguien toca una plantilla
//      y se carga el pie, ese correo no sale).
// ============================================================================

export type TipoNewsletter = "anuncio" | "nuevo_menu" | "oferta";

export const TIPOS_NEWSLETTER: readonly TipoNewsletter[] = ["anuncio", "nuevo_menu", "oferta"];

export const LIMITE_TITULO = 150;
export const LIMITE_MENSAJE = 5000;
export const LIMITE_URL_IMAGEN = 2000;

/** Atributo que marca el pie obligatorio (lo usan los tests y la comprobación previa al envío). */
export const MARCA_PIE_BAJA = 'data-pie-baja="obligatorio"';

const URL_RESERVAR = "https://restaurantecasatomascrevillente.es/reservar";

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
  const v = (url ?? "").trim();
  if (!v || v.length > LIMITE_URL_IMAGEN) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface DatosNewsletter {
  tipo: TipoNewsletter;
  titulo: string;
  mensaje: string;
  imagenUrl?: string | null;
}

export type ResultadoValidacion =
  | { ok: true; datos: DatosNewsletter }
  | { ok: false; error: string };

/** Valida el cuerpo que manda el panel a enviar-newsletter. */
export function validarPayload(raw: unknown): ResultadoValidacion {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Cuerpo de la petición no válido" };
  const r = raw as Record<string, unknown>;
  const tipo = r.tipo;
  if (typeof tipo !== "string" || !TIPOS_NEWSLETTER.includes(tipo as TipoNewsletter)) {
    return { ok: false, error: "Tipo de newsletter no válido" };
  }
  const titulo = typeof r.titulo === "string" ? r.titulo.trim() : "";
  const mensaje = typeof r.mensaje === "string" ? r.mensaje.trim() : "";
  if (!titulo || !mensaje) return { ok: false, error: "Campos requeridos: tipo, titulo, mensaje" };
  if (titulo.length > LIMITE_TITULO) return { ok: false, error: `El título no puede superar ${LIMITE_TITULO} caracteres` };
  if (mensaje.length > LIMITE_MENSAJE) return { ok: false, error: `El mensaje no puede superar ${LIMITE_MENSAJE} caracteres` };
  let imagenUrl: string | null = null;
  if (r.imagen_url !== undefined && r.imagen_url !== null && r.imagen_url !== "") {
    imagenUrl = urlImagenSegura(typeof r.imagen_url === "string" ? r.imagen_url : null);
    if (!imagenUrl) return { ok: false, error: "La imagen debe ser una URL https:// válida" };
  }
  return { ok: true, datos: { tipo: tipo as TipoNewsletter, titulo, mensaje, imagenUrl } };
}

/** Asunto del correo. Sin saltos de línea (no se pueden colar cabeceras). */
export function asuntoNewsletter(tipo: TipoNewsletter, titulo: string): string {
  const limpio = titulo.replace(/[\r\n]+/g, " ").trim();
  if (tipo === "nuevo_menu") return `🍽️ ${limpio}`;
  if (tipo === "oferta") return `🎉 ${limpio}`;
  return limpio;
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
 * Pie de baja OBLIGATORIO. Lo meten las tres plantillas; el personal no lo toca.
 * Explica por qué recibe el correo (consentimiento en la reserva) y da el enlace
 * personal de baja (firmado HMAC por suscriptor, ver newsletter-baja).
 */
export function pieBaja(enlaceBaja: string, colorEnlace: string): string {
  if (!enlaceBaja) throw new Error("pieBaja: falta el enlace de baja");
  const href = escapeHtml(enlaceBaja);
  return `<p ${MARCA_PIE_BAJA} style="margin: 12px 0 0; font-size: 12px; line-height: 1.5;">
        Recibes este correo porque aceptaste recibir las novedades de Casa Tomás al hacer una reserva.<br>
        <a href="${href}" style="color: ${colorEnlace}; text-decoration: underline;">Darse de baja</a> de estos correos en cualquier momento.
      </p>`;
}

/** true si el HTML lleva el pie obligatorio con ESE enlace de baja. */
export function tieneEnlaceBaja(html: string, enlaceBaja: string): boolean {
  if (!html || !enlaceBaja) return false;
  return html.includes(MARCA_PIE_BAJA) && html.includes(`href="${escapeHtml(enlaceBaja)}"`);
}

// ==================== PLANTILLAS HTML ====================
// Mismo diseño que tenían antes en index.ts y en PreviewNewsletter.tsx; lo
// único que cambia es que el texto va escapado y el pie es pieBaja().

function plantillaAnuncio(titulo: string, mensaje: string, enlaceBaja: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #555555; }
    .container { background-color: #ffffff; max-width: 600px; margin: 40px auto; box-shadow: 0 5px 15px rgba(0,0,0,0.08); }
    .header { background-color: #363e45; padding: 30px; text-align: center; }
    .brand-name { font-family: 'Georgia', serif; color: #ffffff; font-size: 26px; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
    .brand-subtitle { color: #c49a6c; font-size: 10px; text-transform: uppercase; letter-spacing: 3px; margin-top: 5px; display: block; }
    .content { padding: 40px; line-height: 1.8; font-size: 16px; color: #363e45; }
    .footer { background-color: #f9f9f9; padding: 20px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #eee; }
    a { color: #363e45; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-name">Casa Tomás</h1>
      <span class="brand-subtitle">Comunicado Oficial</span>
    </div>
    <div class="content">
      <h2 style="color: #c49a6c; margin-top: 0; font-family: 'Georgia', serif;">${titulo}</h2>
      <p style="white-space: pre-line;">${mensaje}</p>
      <p style="margin-top: 30px; font-style: italic;">
        Atentamente,<br>
        <strong>La Dirección de Casa Tomás</strong>
      </p>
    </div>
    <div class="footer">
      <p>C/ Santa María de la Cabeza, 2, Crevillente | Tel: 966 10 78 87</p>
      ${pieBaja(enlaceBaja, "#363e45")}
    </div>
  </div>
</body>
</html>`;
}

function plantillaNuevoMenu(titulo: string, mensaje: string, imagenUrl: string | null, enlaceBaja: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #555555; }
    .container { background-color: #ffffff; max-width: 600px; margin: 40px auto; box-shadow: 0 5px 15px rgba(0,0,0,0.08); border-top: 5px solid #c49a6c; }
    .header { background-color: #ffffff; padding: 40px 20px 20px; text-align: center; border-bottom: 1px solid #f0f0f0; }
    .brand-name { font-family: 'Georgia', serif; color: #363e45; font-size: 28px; margin: 0; text-transform: uppercase; }
    .content { padding: 40px; line-height: 1.6; }
    .menu-box { background-color: #fffcf5; border: 1px solid #eaddcf; padding: 30px; margin: 20px 0; text-align: center; }
    .menu-title { color: #c49a6c; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; font-size: 14px; margin-bottom: 20px; display: block; }
    .menu-text { white-space: pre-line; color: #555; font-style: italic; font-size: 16px; line-height: 2; }
    .btn-gold { display: inline-block; background-color: #363e45; color: #fff !important; padding: 12px 30px; text-decoration: none; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-size: 13px; margin-top: 20px; }
    .footer { background-color: #363e45; padding: 30px; font-size: 12px; color: #aaa; text-align: center; }
    .footer a { color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-name">Casa Tomás</h1>
      <p style="color: #999; text-transform: uppercase; font-size: 11px; letter-spacing: 2px; margin-top: 5px;">Gastronomía &amp; Tradición</p>
    </div>
    <div class="content">
      ${imagenUrl ? `<img src="${escapeHtml(imagenUrl)}" style="width: 100%; height: auto; display: block; margin-bottom: 30px; border-radius: 2px;" alt="Nuevo plato">` : ""}
      <h2 style="text-align: center; color: #363e45; margin-bottom: 10px;">${titulo}</h2>
      <div class="menu-box">
        <span class="menu-title">Propuesta Gastronómica</span>
        <div class="menu-text">${mensaje}</div>
      </div>
      <div style="text-align: center;">
        <a href="${URL_RESERVAR}" class="btn-gold">Reservar Mesa</a>
      </div>
    </div>
    <div class="footer">
      <p>Casa Tomás Crevillente</p>
      ${pieBaja(enlaceBaja, "#ffffff")}
    </div>
  </div>
</body>
</html>`;
}

function plantillaOferta(titulo: string, mensaje: string, imagenUrl: string | null, enlaceBaja: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #222; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
    .container { background-color: #ffffff; max-width: 600px; margin: 0 auto; }
    .hero { background-color: #363e45; color: #ffffff; padding: 40px; text-align: center; }
    .brand-name { font-family: 'Georgia', serif; font-size: 24px; margin-bottom: 20px; display: block; }
    .offer-badge { display: inline-block; background-color: #c49a6c; color: #fff; padding: 5px 15px; text-transform: uppercase; font-size: 12px; font-weight: bold; letter-spacing: 1px; margin-bottom: 15px; }
    .content { padding: 40px; text-align: center; }
    .btn-cta { display: inline-block; background-color: #c49a6c; color: #ffffff !important; padding: 15px 40px; text-decoration: none; font-size: 18px; font-weight: bold; border-radius: 4px; margin-top: 20px; box-shadow: 0 4px 10px rgba(196, 154, 108, 0.4); }
    .footer { background-color: #f4f4f4; padding: 20px; font-size: 11px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    ${imagenUrl ? `<img src="${escapeHtml(imagenUrl)}" style="width: 100%; height: auto; display: block;" alt="Oferta Especial">` : ""}
    <div class="hero">
      <span class="brand-name">Casa Tomás</span>
      <h1 style="margin: 0; font-size: 28px; line-height: 1.2;">${titulo}</h1>
    </div>
    <div class="content">
      <span class="offer-badge">Promoción Exclusiva</span>
      <p style="font-size: 18px; color: #555; line-height: 1.6; margin-bottom: 30px; white-space: pre-line;">${mensaje}</p>
      <a href="${URL_RESERVAR}" class="btn-cta">APROVECHAR OFERTA</a>
    </div>
    <div class="footer">
      <p>Oferta válida según disponibilidad.</p>
      ${pieBaja(enlaceBaja, "#888888")}
    </div>
  </div>
</body>
</html>`;
}

/**
 * HTML final del newsletter. `enlaceBaja` es obligatorio: el enlace personal
 * del suscriptor (envío real) o un marcador (vista previa del panel).
 */
export function renderNewsletter(datos: DatosNewsletter, enlaceBaja: string): string {
  if (!enlaceBaja) throw new Error("renderNewsletter: falta el enlace de baja (es obligatorio en todo envío)");
  const titulo = escapeHtml(datos.titulo);
  const mensaje = escapeHtml(datos.mensaje);
  const imagen = urlImagenSegura(datos.imagenUrl);
  switch (datos.tipo) {
    case "nuevo_menu":
      return plantillaNuevoMenu(titulo, mensaje, imagen, enlaceBaja);
    case "oferta":
      return plantillaOferta(titulo, mensaje, imagen, enlaceBaja);
    case "anuncio":
    default:
      return plantillaAnuncio(titulo, mensaje, enlaceBaja);
  }
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
