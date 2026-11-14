// ============================================================================
//  Logs web · ORIGEN de un error: ¿es un fallo de la web o no depende de ella?
// ----------------------------------------------------------------------------
//  Petición del dueño (14/11/2026): «En logs diferencia entre error web, error
//  que no depende de la web, diferentes colores y se tratan diferente». La
//  lista estaba llena de «Sin respuesta de rest:novedades (sin conexión)» en
//  rojo: el móvil del visitante sin cobertura, no un fallo nuestro.
//
//  Reglas FIJAS (sin IA), en este orden:
//    1. Versión antigua tras publicar (web_eventos.tras_publicar / `accion` de
//       la web): «repetido» o «no se arregló al recargar» → web; sin conexión →
//       conexion; se arregló sola o sin datos de después → version_antigua.
//    2. Despliegue fallido → web. En el servidor, falta una clave o una
//       dirección que ya no existe → web (es configuración nuestra).
//    3. Navegador: extensiones (chrome-extension://…), scripts que inyectan
//       los navegadores de las apps, «ResizeObserver loop», «Script error.» de
//       otro dominio sin datos y rastreadores bloqueados → navegador.
//    4. Navegador: petición sin respuesta (estado 0, «Sin respuesta de…»),
//       «Failed to fetch», «Load failed», «NetworkError», cancelada → conexion.
//    5. Servicio de fuera (Google Maps, Instagram/Meta, Stripe, OpenAI…, o un
//       recurso de otro dominio) → externo, con el nombre del proveedor.
//    6. Todo lo demás → web (JS de nuestro código, React, 404 de nuestras
//       páginas, 5xx de nuestras funciones…).
//  Bots, pruebas automáticas y tráfico interno se marcan aparte («bots»): lo
//  dicen los indicadores del evento, no el mensaje.
//
//  ESPEJO EXACTO de public.web_logs_origen_error() y
//  public.web_logs_proveedor_externo() (20261130100000_logs_web_origen.sql):
//  el servidor clasifica y guarda (web_eventos.origen, web_incidencias.origen)
//  y esto sirve para el panel (eventos aún sin agrupar) y las pruebas. Los
//  mismos casos (__tests__/logs-web-origen-casos.json) pasan por las dos
//  (vitest y PGlite): si cambia una, cambia la otra.
//  Patrones sin \b ni lookarounds para que valgan igual en Postgres.
//  Sin Deno ni imports remotos (lo usan el panel y las funciones).
// ============================================================================

import { PATRON_CHUNK_CADUCADO, PATRON_CRON_PLATAFORMA } from "./huella.ts";

/** Origen técnico de UNA ocurrencia (lo que se guarda en web_eventos.origen). */
export type Origen = "web" | "externo" | "conexion" | "navegador" | "version_antigua";
/** Lo que se enseña: el técnico o, si lo provocan robots o pruebas, «bots». */
export type OrigenVisible = Origen | "bots";
/** Los tres colores. */
export type GrupoOrigen = "web" | "externo" | "no_depende";

export const ORIGENES: OrigenVisible[] = ["web", "externo", "conexion", "navegador", "version_antigua", "bots"];

export interface DatosOrigen {
  tipo: string;
  fuente?: string | null;
  mensaje?: string | null;
  pila?: string | null;
  objetivo?: string | null;
  propiedades?: Record<string, unknown> | null;
  accion?: string | null;
  tras_publicar?: string | null;
}

const TIPOS_JS = ["error_js", "error_promesa", "error_react"];
const TIPOS_CARGA = [...TIPOS_JS, "error_recurso"];

/** El navegador no recibió respuesta (red del visitante, cancelada al cambiar de página…). Solo al mensaje. */
export const PATRON_CONEXION =
  /failed to fetch|load failed|networkerror when attempting to fetch resource|network ?error|network request failed|network connection was lost|internet connection appears to be offline|err_internet_disconnected|err_network_changed|err_connection_(reset|closed|refused|timed_out|aborted)|aborterror|user aborted a request|operation was aborted|signal is aborted|fetch is aborted|request aborted|failed to send a request to the edge function|authretryablefetcherror|^(typeerror: )?(cancelled|canceled|cancelado)$/i;

/** Extensiones del navegador (mensaje, pila u objetivo). */
export const PATRON_EXTENSION = /(chrome|moz|safari|safari-web|ms-browser|edge)-extension:\/\/|webkit-masked-url:\/\//i;

/** Avisos del propio navegador y scripts que inyectan los navegadores de las apps (Facebook, Instagram, Bing…). */
export const PATRON_NAVEGADOR =
  /resizeobserver loop|_autofillcallbackhandler|instantsearchsdkjsbridge|__gcrweb|weixinjsbridge|webkit\.messagehandlers|java object is gone|zalojsv2|getreadmode(config|render|extract)|symbrowser_|cefsharp|non-error promise rejection captured|can.t find variable: (gmo|zalo|_autofill)/i;

/** «Script error.»: un script de otro dominio falló y el navegador no deja ver nada más. Mensaje entero. */
export const PATRON_SCRIPT_ERROR = /^(uncaught )?script error\.?$/i;

/** Rastreadores que bloquean los bloqueadores de anuncios (recursos que no cargan). */
export const PATRON_BLOQUEADORES =
  /googletagmanager\.com|google-analytics\.com|doubleclick\.net|googlesyndication\.com|clarity\.ms|hotjar\.com|cloudflareinsights\.com|fbevents\.js/i;

/** Servidor: falta una clave o configuración nuestra (no es culpa del proveedor). */
export const PATRON_FALTA_CONFIG =
  /falta_secreto|falta (el |la )?(secreto|clave|configur|firma)|not_configured|no_configurado|no está configurad|missing (secret|api key|env)/i;

/** Servidor: llama a una dirección que ya no existe (URL fija antigua: es nuestra). */
export const PATRON_DNS = /dns error|failed to lookup address|enotfound|name or service not known/i;

/** Nuestros dominios (lo que no es esto, en un recurso que no carga, es de fuera). */
export const PATRON_PROPIOS =
  /(^|\.)(restaurantecasatomascrevillente\.es|web-casatomas[a-z0-9-]*\.vercel\.app|admin-casatomas[a-z0-9-]*\.vercel\.app|localhost|127\.0\.0\.1|[a-z]{20}\.supabase\.co)$/;

/** Servicios de fuera de los que dependemos, en orden (el primero que encaja). */
export const PROVEEDORES: ReadonlyArray<{ nombre: string; patron: RegExp }> = [
  { nombre: "Google Maps", patron: /maps\.googleapis\.com|maps\.gstatic\.com|google maps|google\.maps|maps\.google\./i },
  { nombre: "Mapbox", patron: /mapbox/i },
  { nombre: "Instagram / Meta", patron: /instagram\.com|cdninstagram\.com|instgrm|graph\.facebook\.com|graph api|fbcdn\.net|connect\.facebook\.net|errores? (temporal )?de meta|meta (no |ha )/i },
  { nombre: "Stripe", patron: /api\.stripe\.com|js\.stripe\.com|m\.stripe\.network|stripe(api|connection|ratelimit|authentication|invalidrequest|card|permission)error|consultar stripe|stripe no respond/i },
  { nombre: "OpenAI", patron: /openai|chatgpt/i },
  { nombre: "Google (IA)", patron: /generativelanguage\.googleapis\.com|gemini/i },
  { nombre: "Google Drive", patron: /google drive|drive token|googleapis\.com\/(upload\/)?drive/i },
  { nombre: "Google (reseñas y sitios)", patron: /google places|places api|mybusiness|businessprofile|google my business/i },
  { nombre: "Resend", patron: /api\.resend\.com|resend_error|resend_sandbox|resend (api|respondió|devolvió|no respond)|(segments|contactos|audiencia) de resend|con resend|en resend/i },
  { nombre: "Vercel", patron: /api\.vercel\.com|vercel [0-9]{3}|vercel (api|no respond)/i },
  { nombre: "Telegram", patron: /api\.telegram\.org|telegram (api|respondió|devolvió|no respond)/i },
  { nombre: "Vapi", patron: /api\.vapi\.ai|vapi responded/i },
  { nombre: "Google Fonts", patron: /fonts\.googleapis\.com|fonts\.gstatic\.com/i },
  { nombre: "YouTube", patron: /youtube\.com|ytimg\.com|youtube-nocookie\.com/i },
];

const esNavegador = (d: DatosOrigen) => (d.fuente ?? "navegador") === "navegador";

/** Host de una URL absoluta (sin «www.»), como en el SQL: `^https?://([^/:?#]+)`. */
export function hostDeUrl(url: string | null | undefined): string | null {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url ?? "");
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
}

/** Mensaje del servidor sin el «<función>: » del principio: el nombre de la función no es el proveedor (stripe-estado-cuenta, ia-modelos-openai…). */
function sinPrefijoFuncion(mensaje: string, objetivo: string | null | undefined): string {
  return objetivo && mensaje.startsWith(`${objetivo}: `) ? mensaje.slice(objetivo.length + 2) : mensaje;
}

/** ¿Fichero de una versión anterior tras publicar? (= public.web_logs_es_version_antigua). */
export function esVersionAntigua(d: Pick<DatosOrigen, "tipo" | "mensaje" | "pila" | "objetivo">): boolean {
  if (TIPOS_JS.includes(d.tipo)) return PATRON_CHUNK_CADUCADO.test(`${d.mensaje ?? ""}\n${d.pila ?? ""}`);
  if (d.tipo === "error_recurso") return /\/assets\/[^/?#]+-[A-Za-z0-9_-]{8}\.(m?js|css)($|[?#])/.test(d.objetivo ?? "");
  return false;
}

/**
 * Servicio de fuera que falla, o null. En el navegador mira el objetivo (la URL
 * del recurso), el mensaje y la pila; en el servidor solo el mensaje (la pila
 * lleva el nombre del fichero de la función, que puede llamarse como el proveedor).
 */
export function proveedorExterno(d: DatosOrigen): string | null {
  const navegador = esNavegador(d);
  const mensaje = d.mensaje ?? "";
  const texto = navegador
    ? `${d.objetivo ?? ""}\n${mensaje}\n${d.pila ?? ""}`
    : sinPrefijoFuncion(mensaje, d.objetivo);
  if (!navegador && PATRON_CRON_PLATAFORMA.test(texto)) return "Supabase";
  for (const p of PROVEEDORES) if (p.patron.test(texto)) return p.nombre;
  if (navegador && d.tipo === "error_recurso") {
    const host = hostDeUrl(d.objetivo);
    if (host && !PATRON_PROPIOS.test(host)) return host;
  }
  return null;
}

/** Origen técnico de una ocurrencia (sin mirar si es un bot: eso va en `origenDeOcurrencia`). */
export function origenDeError(d: DatosOrigen): Origen {
  const mensaje = d.mensaje ?? "";
  const texto = `${mensaje}\n${d.pila ?? ""}`;
  const navegador = esNavegador(d);

  // 1. Versión antigua tras publicar: lo que pasó después manda.
  if (d.tras_publicar === "repetido") return "web";
  if (d.tras_publicar === "sin_conexion") return "conexion";
  if (d.tras_publicar === "sin_impacto" || d.tras_publicar === "sin_datos") return "version_antigua";
  if (TIPOS_CARGA.includes(d.tipo)) {
    if (d.accion === "recarga_sin_efecto" || d.accion === "aviso_version_nueva" || d.accion === "sin_version_nueva") return "web";
    if (d.accion === "sin_conexion") return "conexion";
    if (d.accion === "recuperado_tras_recarga") return "version_antigua";
  }
  if (esVersionAntigua(d)) return "version_antigua";

  // 2. Nuestro aunque lo parezca de fuera.
  if (d.tipo === "error_despliegue") return "web";
  if (!navegador && (PATRON_FALTA_CONFIG.test(texto) || PATRON_DNS.test(texto))) return "web";

  if (navegador) {
    // 3. El navegador o una extensión.
    if (PATRON_EXTENSION.test(`${texto}\n${d.objetivo ?? ""}`) || PATRON_NAVEGADOR.test(texto) || PATRON_SCRIPT_ERROR.test(mensaje.trim())) return "navegador";
    if (d.tipo === "error_recurso" && PATRON_BLOQUEADORES.test(d.objetivo ?? "")) return "navegador";
    // 4. La conexión del visitante.
    if (d.tipo === "error_peticion" && (String(d.propiedades?.status ?? "") === "0" || /^sin respuesta/i.test(mensaje))) return "conexion";
    if (TIPOS_JS.includes(d.tipo) && PATRON_CONEXION.test(mensaje)) return "conexion";
  }

  // 5. Un servicio de fuera.
  if (proveedorExterno(d)) return "externo";
  // 6. Lo nuestro.
  return "web";
}

export interface MarcasOcurrencia {
  es_bot?: boolean | null;
  es_prueba?: boolean | null;
  es_interno?: boolean | null;
  /** Lo guardado por el servidor (web_eventos.origen); si falta, se calcula aquí. */
  origen?: string | null;
}

const esOrigen = (o: unknown): o is Origen => typeof o === "string" && ["web", "externo", "conexion", "navegador", "version_antigua"].includes(o);

/** Lo que se enseña de UNA ocurrencia: bots/pruebas/interno aparte; si no, el origen guardado o el calculado. */
export function origenDeOcurrencia(e: DatosOrigen & MarcasOcurrencia): OrigenVisible {
  if (e.es_bot || e.es_prueba || e.es_interno) return "bots";
  return esOrigen(e.origen) ? e.origen : origenDeError(e);
}

export type CuentasOrigen = Partial<Record<Origen, number>>;

/**
 * Origen de una incidencia a partir de sus ocurrencias de visitantes reales
 * (= el CASE de web_logs_agrupar_errores): basta UNA de la web para que sea de
 * la web (lo que cuenta para el ticket), luego externo; si no hay ninguna real,
 * «bots»; si no, la que más se repite (a igualdad: navegador, conexión, versión).
 */
export function combinarOrigenes(c: CuentasOrigen): OrigenVisible {
  const n = (o: Origen) => c[o] ?? 0;
  if (n("web") > 0) return "web";
  if (n("externo") > 0) return "externo";
  if (n("conexion") + n("navegador") + n("version_antigua") === 0) return "bots";
  if (n("navegador") >= n("conexion") && n("navegador") >= n("version_antigua")) return "navegador";
  if (n("conexion") >= n("version_antigua")) return "conexion";
  return "version_antigua";
}

export function grupoDeOrigen(o: OrigenVisible | null | undefined): GrupoOrigen {
  return o === "web" || !o ? "web" : o === "externo" ? "externo" : "no_depende";
}

/** ¿Puede abrir o reabrir un ticket en Linear? Sin origen (migración sin aplicar): como antes. */
export function puedeAbrirTicket(origen: string | null | undefined, ticketsExternos: boolean): boolean {
  if (!origen) return true;
  return origen === "web" || (origen === "externo" && ticketsExternos);
}

/** Nombre de cada origen y de cada grupo (los mismos en el panel y en el ticket). */
export const NOMBRE_ORIGEN: Record<OrigenVisible, string> = {
  web: "Fallo de la web",
  externo: "Servicio externo",
  conexion: "Conexión del visitante",
  navegador: "Navegador o extensión",
  version_antigua: "Versión antigua (se arregló sola)",
  bots: "Bots y pruebas",
};

export const NOMBRE_GRUPO_ORIGEN: Record<GrupoOrigen, string> = {
  web: "Fallos de la web",
  externo: "Externos",
  no_depende: "No dependen de la web",
};

/** Una línea en llano para el dueño: qué es y qué hacer. */
export function explicacionOrigen(o: OrigenVisible, proveedor?: string | null): string {
  switch (o) {
    case "web":
      return "Fallo de la web: algo de nuestro código o de nuestro servidor no funcionó. Es lo que hay que arreglar.";
    case "externo":
      return `No es un fallo de nuestro código: depende de ${proveedor || "un servicio de fuera"}. Si se repite mucho, hay que mirarlo con ese servicio.`;
    case "conexion":
      return "No depende de la web: el móvil del visitante se quedó sin cobertura (o cambió de página) mientras cargaba. No hay que hacer nada salvo que se repita mucho.";
    case "navegador":
      return "No depende de la web: lo provoca el navegador del visitante o una extensión que tiene instalada (traductores, bloqueadores de anuncios…). No hay que hacer nada.";
    case "version_antigua":
      return "No depende de la web: tenía abierta una versión anterior justo cuando publicamos y se arregló sola al recargar. No hay que hacer nada.";
    case "bots":
      return "No depende de la web: lo provocan robots o pruebas automáticas, no clientes. No hay que hacer nada.";
  }
}

/** Por qué una incidencia no abre ticket (motivo que se guarda y se enseña). */
export function motivoSinTicket(o: OrigenVisible, proveedor?: string | null): string {
  return o === "externo"
    ? `Servicio externo (${proveedor || "de fuera"}): no abre ticket salvo que se active en Configuración`
    : `${NOMBRE_ORIGEN[o]}: no depende de la web, no abre ticket`;
}
