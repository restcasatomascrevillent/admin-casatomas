// ============================================================================
//  Logs web · saneado de datos ANTES de guardarlos o mandarlos fuera
// ----------------------------------------------------------------------------
//  Lo usan la ingesta (registrar-actividad-web), el registro de errores del
//  servidor (audit-client), los recolectores y, otra vez, el constructor de
//  tickets y el análisis de IA antes de mandar nada a Linear u OpenAI.
//
//  Regla: ante la duda, se quita. Un log con «[email]» sigue sirviendo para
//  depurar; un log con el correo de un cliente es un problema.
//
//    · correos                       → [email]
//    · teléfonos y cifras largas     → [tel] / [num]   (≥ 6 dígitos: DNI, tarjetas, IBAN…)
//    · JWT, Bearer, claves sk_/pk_/sb_, hex/base64 largos → [token]
//    · UUID                          → [id]
//    · query string y fragmento de cualquier URL → fuera (tokens de enlaces de correo, utm…)
//
//  Sin Deno ni imports remotos: se prueba con vitest.
// ============================================================================

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const RE_BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const RE_CLAVES = /\b(sk|pk|rk|sb|whsec|lin_api|lin_oauth|re|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}/gi;
const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RE_HEX_LARGO = /\b[0-9a-f]{24,}\b/gi;
const RE_B64_LARGO = /\b[A-Za-z0-9+_-]{32,}={0,2}(?![A-Za-z0-9])/g;
const RE_UUID_SEGMENTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Teléfono: +34 600 000 000, 600-000-000, (965) 000 000… (9+ dígitos con separadores).
const RE_TELEFONO = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const RE_CIFRA_LARGA = /\d{6,}/g;
const RE_URL = /\bhttps?:\/\/[^\s"'<>()]+/gi;
// Asignaciones típicas de secretos en mensajes: password=…, token: …
const RE_ASIGNACION = /\b(pass(word)?|contrase(ñ|n)a|pwd|secret|token|api[_-]?key|authorization|cookie|session)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi;

/** Quita query string y fragmento de una URL; conserva origen y ruta. */
export function urlSinConsulta(url: string): string {
  const corte = url.search(/[?#]/);
  return corte === -1 ? url : url.slice(0, corte);
}

/** Sanea un texto libre técnico (mensaje de error, línea de pila, etiqueta). */
export function sanearTexto(valor: unknown, max = 500): string | null {
  if (valor === null || valor === undefined) return null;
  let s = String(valor);
  if (!s) return null;
  // Recorte previo: no procesar megas de texto.
  if (s.length > max * 4) s = s.slice(0, max * 4);
  s = s
    .replace(RE_URL, (u) => {
      // Conserva la «:línea:columna» final de las pilas aunque la URL lleve consulta.
      const lineaCol = /(?::\d+){1,2}$/.exec(u)?.[0] ?? "";
      return urlSinConsulta(lineaCol ? u.slice(0, -lineaCol.length) : u) + lineaCol;
    })
    .replace(RE_ASIGNACION, (_m, clave) => `${clave}=[oculto]`)
    .replace(RE_EMAIL, "[email]")
    .replace(RE_JWT, "[token]")
    .replace(RE_BEARER, (_m, tipo) => `${tipo} [token]`)
    .replace(RE_CLAVES, "[token]")
    .replace(RE_UUID, "[id]")
    .replace(RE_HEX_LARGO, "[token]")
    .replace(RE_B64_LARGO, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? "[token]" : m))
    .replace(RE_TELEFONO, (m) => (m.replace(/\D/g, "").length >= 9 ? "[tel]" : m))
    .replace(RE_CIFRA_LARGA, "[num]")
    // Caracteres de control fuera (salvo salto de línea y tabulador).
    // deno-lint-ignore no-control-regex
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Ruta de página: solo el pathname, sin consulta ni fragmento, con los
 * segmentos que parecen identificadores sustituidos por «:id». Máx. 300.
 */
export function sanearRuta(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor) return null;
  let ruta = valor.trim();
  try {
    if (/^https?:\/\//i.test(ruta)) ruta = new URL(ruta).pathname;
  } catch {
    return null;
  }
  ruta = urlSinConsulta(ruta);
  if (!ruta.startsWith("/")) ruta = `/${ruta}`;
  try {
    ruta = decodeURIComponent(ruta);
  } catch {
    // ruta mal codificada: se queda como viene
  }
  const segmentos = ruta.split("/").map((seg) => {
    if (!seg) return seg;
    if (RE_UUID_SEGMENTO.test(seg)) return ":id";
    if (/^\d{4,}$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) || (/^[A-Za-z0-9_-]{24,}$/.test(seg) && /\d/.test(seg))) return ":id";
    if (seg.includes("@")) return ":email";
    return seg.slice(0, 80);
  });
  ruta = segmentos.join("/").replace(/\/{2,}/g, "/");
  if (ruta.length > 1 && ruta.endsWith("/")) ruta = ruta.slice(0, -1);
  return ruta.slice(0, 300);
}

/** Pila de llamadas: cada línea saneada, sin consultas en las URL, máx. 30 líneas y 4000 caracteres. */
export function sanearPila(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const lineas = valor.split(/\r?\n/).slice(0, 30).map((l) => sanearTexto(l, 300)).filter((l): l is string => !!l);
  const s = lineas.join("\n");
  return s ? s.slice(0, 4000) : null;
}

/** Solo el host de una URL de procedencia (sin ruta: puede llevar datos). */
export function hostDe(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(valor) ? valor : `https://${valor}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export type ValorPropiedad = string | number | boolean;

/**
 * Propiedades de un evento: solo las claves permitidas, solo valores
 * primitivos; los textos saneados y cortos (120). Nada anidado.
 */
export function sanearPropiedades(
  valor: unknown,
  permitidas: ReadonlySet<string>,
): Record<string, ValorPropiedad> {
  const salida: Record<string, ValorPropiedad> = {};
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return salida;
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    if (!permitidas.has(clave)) continue;
    if (typeof v === "boolean") salida[clave] = v;
    else if (typeof v === "number" && Number.isFinite(v)) salida[clave] = Math.round(v * 1000) / 1000;
    else if (typeof v === "string") {
      const s = sanearTexto(v, 120);
      if (s) salida[clave] = s;
    }
  }
  return salida;
}

/** ¿Queda algo que parezca un dato personal? (comprobación de las pruebas y del constructor de tickets). */
export function pareceDatoPersonal(texto: string): boolean {
  const telefonos = (texto.match(RE_TELEFONO) ?? ([] as string[])).some((m) => m.replace(/\D/g, "").length >= 9);
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(texto) || /\beyJ[A-Za-z0-9_-]{8,}\./.test(texto) || telefonos || /\d{6,}/.test(texto);
}
