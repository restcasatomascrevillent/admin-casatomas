/**
 * Nombres comprensibles para el informe «para el dueño»: rutas de la web,
 * procedencias (referrer), dispositivos, países e idioma de la página.
 * Nada de jerga: «Carta de vinos» en vez de `/carta/vinos`.
 */
import { mayusculaInicial } from "./formatoInforme";

// ─── Idioma de la página (la web sirve /en/… y /fr/…) ────────────────────────
export type Idioma = "es" | "en" | "fr";

export const NOMBRE_IDIOMA: Record<Idioma, string> = { es: "Español", en: "Inglés", fr: "Francés" };

/** Separa el prefijo de idioma: «/en/carta/vinos» → { idioma: "en", ruta: "/carta/vinos" }. */
export function idiomaDeRuta(ruta: string): { idioma: Idioma; ruta: string } {
  const limpia = normalizarRuta(ruta);
  const m = /^\/(en|fr)(\/.*)?$/.exec(limpia);
  if (!m) return { idioma: "es", ruta: limpia };
  return { idioma: m[1] as Idioma, ruta: m[2] ?? "/" };
}

/** Quita query, ancla y barra final («/carta/» → «/carta»); la raíz queda «/». */
export function normalizarRuta(ruta: string): string {
  const sinQuery = ruta.split(/[?#]/)[0].trim() || "/";
  const conBarra = sinQuery.startsWith("/") ? sinQuery : `/${sinQuery}`;
  return conBarra.length > 1 ? conBarra.replace(/\/+$/, "") || "/" : conBarra;
}

// ─── Páginas ─────────────────────────────────────────────────────────────────
/** Rutas fijas de la web de Casa Tomás (web-casatomas/src/App.tsx). */
const PAGINAS_CASA_TOMAS: Record<string, string> = {
  "/": "Inicio",
  "/carta": "Carta",
  "/carta/vinos": "Carta de vinos",
  "/carta/bebidas": "Bebidas",
  "/carta/novedades-del-dia": "Novedades del día",
  "/reservas": "Reservas",
  "/reserva/respuesta": "Respuesta a una reserva",
  "/el-restaurante": "El restaurante",
  "/contacto": "Contacto",
  "/regala": "Cheques regalo",
  "/touza": "Touza",
  "/politica-privacidad": "Política de privacidad",
  "/condiciones": "Condiciones",
  "/aviso-legal": "Aviso legal",
  "/newsletter/baja": "Baja del boletín",
  "/404": "Página no encontrada",
};

/** Rutas de la web de Touza. */
const PAGINAS_TOUZA: Record<string, string> = {
  "/": "Inicio",
  "/carta": "Carta",
  "/galeria": "Galería",
  "/reservado": "Reservado",
};

/** Categorías de la carta con tildes o nombre propio; el resto se deduce del slug. */
const CATEGORIAS_CARTA: Record<string, string> = {
  "entrantes-frios": "Entrantes fríos",
  "entrantes-calientes": "Entrantes calientes",
  "novedades-del-dia": "Novedades del día",
};

/** «entrantes-calientes» → «Entrantes calientes»; corrige las tildes más comunes. */
export function slugALegible(slug: string): string {
  let texto: string;
  try {
    texto = decodeURIComponent(slug);
  } catch {
    texto = slug;
  }
  texto = texto.replace(/[-_]+/g, " ").trim();
  texto = texto
    .replace(/\bdia\b/gi, "día")
    .replace(/\bfrios\b/gi, "fríos")
    .replace(/\bpanaderia\b/gi, "panadería")
    .replace(/\bgaleria\b/gi, "galería");
  return mayusculaInicial(texto);
}

/**
 * Nombre de una página para el dueño. Con `conWeb` (informe de las dos webs)
 * las de Touza llevan «Touza · » delante; las versiones en otro idioma llevan
 * el idioma detrás: «Inicio (en inglés)».
 */
export function nombrePagina(ruta: string, proyecto: string, conWeb = false): string {
  const { idioma, ruta: base } = idiomaDeRuta(ruta);
  const fijas = proyecto === "touza-restaurant-website" ? PAGINAS_TOUZA : PAGINAS_CASA_TOMAS;
  let nombre = fijas[base];
  if (!nombre) {
    const partes = base.split("/").filter(Boolean);
    if (proyecto !== "touza-restaurant-website" && partes[0] === "carta" && partes.length >= 2) {
      const categoria = CATEGORIAS_CARTA[partes[1]] ?? slugALegible(partes[1]);
      nombre = partes.length === 2 ? `Carta: ${categoria}` : `${categoria}: ${slugALegible(partes[partes.length - 1])}`;
    } else if (partes.length > 0) {
      nombre = slugALegible(partes[partes.length - 1]);
    } else {
      nombre = "Inicio";
    }
  }
  if (idioma !== "es") nombre = `${nombre} (en ${NOMBRE_IDIOMA[idioma].toLowerCase()})`;
  if (conWeb && proyecto === "touza-restaurant-website") nombre = `Touza · ${nombre}`;
  return nombre;
}

/** ¿La ruta es de la carta (cualquier sección, cualquier idioma)? */
export const esRutaCarta = (ruta: string): boolean => /^\/carta(\/|$)/.test(idiomaDeRuta(ruta).ruta);

/** ¿La ruta es la página de reservas de Casa Tomás (cualquier idioma)? */
export const esRutaReservas = (ruta: string): boolean => idiomaDeRuta(ruta).ruta === "/reservas";

// ─── Procedencia (referrer) ──────────────────────────────────────────────────
export type GrupoProcedencia = "directo" | "buscador" | "redes" | "pago" | "interno" | "web";

export interface Procedencia {
  nombre: string;
  grupo: GrupoProcedencia;
  /** Una línea en llano para la nota al pie de la diapositiva. */
  explicacion?: string;
}

const REGLAS_PROCEDENCIA: { patron: RegExp; procedencia: Procedencia }[] = [
  { patron: /(^|\.)google\./, procedencia: { nombre: "Google", grupo: "buscador", explicacion: "búsquedas y la ficha del restaurante en Google" } },
  { patron: /(^|\.)bing\.com$/, procedencia: { nombre: "Bing", grupo: "buscador" } },
  { patron: /(^|\.)duckduckgo\.com$/, procedencia: { nombre: "DuckDuckGo", grupo: "buscador" } },
  { patron: /(^|\.)(yahoo|ecosia|qwant|yandex|brave)\./, procedencia: { nombre: "Otros buscadores", grupo: "buscador" } },
  { patron: /(^|\.)(instagram\.com|ig\.me)$/, procedencia: { nombre: "Instagram", grupo: "redes" } },
  { patron: /(^|\.)(facebook\.com|fb\.me|fb\.com|messenger\.com)$/, procedencia: { nombre: "Facebook", grupo: "redes" } },
  { patron: /(^|\.)tiktok\.com$/, procedencia: { nombre: "TikTok", grupo: "redes" } },
  { patron: /(^|\.)(twitter\.com|x\.com|t\.co)$/, procedencia: { nombre: "X (Twitter)", grupo: "redes" } },
  { patron: /(^|\.)(whatsapp\.com|wa\.me)$/, procedencia: { nombre: "WhatsApp", grupo: "redes" } },
  { patron: /(^|\.)linkedin\.com$/, procedencia: { nombre: "LinkedIn", grupo: "redes" } },
  { patron: /(^|\.)(tripadvisor\.[a-z.]+)$/, procedencia: { nombre: "Tripadvisor", grupo: "web" } },
  { patron: /(^|\.)(thefork\.[a-z.]+|eltenedor\.[a-z.]+)$/, procedencia: { nombre: "TheFork", grupo: "web" } },
  { patron: /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com)$/, procedencia: { nombre: "Asistentes de IA", grupo: "web" } },
  {
    patron: /(^|\.)(stripe\.com)$/,
    procedencia: { nombre: "Vuelta de un pago", grupo: "pago", explicacion: "vuelven a la web después de pagar con tarjeta" },
  },
  { patron: /(^|\.)vercel\.com$/, procedencia: { nombre: "Pruebas internas", grupo: "interno", explicacion: "visitas del equipo técnico desde Vercel, el servicio que aloja la web" } },
  { patron: /(^|\.)casa-tomas-story\.vercel\.app$|(^|\.)casatomas\./, procedencia: { nombre: "Web de Casa Tomás", grupo: "web", explicacion: "enlaces desde la propia web de Casa Tomás" } },
  { patron: /(^|\.)touza[^.]*\.vercel\.app$|(^|\.)touza\./, procedencia: { nombre: "Web de Touza", grupo: "web" } },
];

/** Nombre y grupo de una procedencia. `(directo)` es el valor que guarda la sincronización si no hay referrer. */
export function nombreProcedencia(valor: string): Procedencia {
  const v = valor.trim().toLowerCase();
  if (v === "" || v === "(directo)" || v === "(direct)" || v === "direct") {
    return {
      nombre: "Directo",
      grupo: "directo",
      explicacion: "escriben la dirección, usan un favorito, un código QR o un enlace de WhatsApp o del correo",
    };
  }
  const host = v.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  for (const r of REGLAS_PROCEDENCIA) if (r.patron.test(host)) return r.procedencia;
  return { nombre: host, grupo: "web" };
}

// ─── Dispositivos y países ───────────────────────────────────────────────────
export type ClaveDispositivo = "mobile" | "desktop" | "tablet";

/** Orden FIJO (el color sigue a la entidad, no al puesto): móvil, ordenador, tablet. */
export const ORDEN_DISPOSITIVOS: ClaveDispositivo[] = ["mobile", "desktop", "tablet"];

export const NOMBRE_DISPOSITIVO: Record<ClaveDispositivo, string> = {
  mobile: "Móvil",
  desktop: "Ordenador",
  tablet: "Tablet",
};

export function claveDispositivo(valor: string): ClaveDispositivo | null {
  const v = valor.trim().toLowerCase();
  if (v === "mobile" || v === "smartphone" || v === "phone") return "mobile";
  if (v === "desktop" || v === "laptop") return "desktop";
  if (v === "tablet") return "tablet";
  return null;
}

let nombresPaises: Intl.DisplayNames | null = null;
/** «ES» → «España». Si el código no es ISO de 2 letras se devuelve tal cual. */
export function nombrePais(codigo: string): string {
  if (!/^[A-Za-z]{2}$/.test(codigo)) return codigo;
  try {
    nombresPaises ??= new Intl.DisplayNames(["es"], { type: "region" });
    return nombresPaises.of(codigo.toUpperCase()) ?? codigo;
  } catch {
    return codigo;
  }
}

// ─── Días de la semana (isodow 1 = lunes) ────────────────────────────────────
export const DIAS_SEMANA = [
  { corto: "Lun", singular: "lunes", plural: "lunes" },
  { corto: "Mar", singular: "martes", plural: "martes" },
  { corto: "Mié", singular: "miércoles", plural: "miércoles" },
  { corto: "Jue", singular: "jueves", plural: "jueves" },
  { corto: "Vie", singular: "viernes", plural: "viernes" },
  { corto: "Sáb", singular: "sábado", plural: "sábados" },
  { corto: "Dom", singular: "domingo", plural: "domingos" },
] as const;

// ─── La web del informe ──────────────────────────────────────────────────────
/** «la web de Casa Tomás», «la web de Touza», «las webs de Casa Tomás y Touza». */
export function nombreWeb(proyecto: string): string {
  if (proyecto === "touza-restaurant-website") return "la web de Touza";
  if (proyecto === "casa-tomas-story") return "la web de Casa Tomás";
  return "las webs de Casa Tomás y Touza";
}
