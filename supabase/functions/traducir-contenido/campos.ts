// Modo genérico "campos" de traducir-contenido.
// ---------------------------------------------------------------------------
// Los tipos de index.ts/prompts.ts están atados a columnas concretas de la
// carta (nombre_en, descripcion_fr…). El Bot web necesita traducir textos
// libres (bienvenida, instrucciones, frases) de configBotWeb sin inventar un
// "tipo" nuevo por cada tabla, así que este modo acepta:
//
//   { campos: { clave: "texto en español", ... }, destino: ["en", "fr"], contexto?: string }
//
// y devuelve { ok: true, modo: "campos", traducciones: { en: {clave: ...}, fr: {clave: ...} } }
// con EXACTAMENTE las mismas claves. Si falta una clave o una traducción de
// un texto no vacío llega vacía, se considera fallo (el panel nunca debe
// sobrescribir EN/FR con cadenas vacías). Los textos vacíos se devuelven
// vacíos sin pasar por el modelo.
// ---------------------------------------------------------------------------

export type IdiomaDestino = "en" | "fr";

export const IDIOMAS_DESTINO_VALIDOS: IdiomaDestino[] = ["en", "fr"];

const NOMBRE_IDIOMA: Record<IdiomaDestino, string> = { en: "inglés (en)", fr: "francés (fr)" };

// Límite defensivo: esto va entero al prompt de OpenAI.
const MAX_CAMPOS = 20;
const MAX_CARACTERES_TOTALES = 12000;

export const CAMPOS_SYSTEM_BASE = `Eres un traductor nativo profesional para Casa Tomás, un restaurante de Crevillent (Alicante, España). Traduces del español textos de configuración de su asistente virtual de la web (mensaje de bienvenida, instrucciones internas y frases de estilo). Estos textos se insertan en las instrucciones del asistente en cada idioma, así que deben sonar naturales para un hablante nativo, no literales, manteniendo el significado exacto y el tono del original.

Reglas obligatorias:
- Conserva EXACTAMENTE los saltos de línea, líneas en blanco, viñetas y listas ("-", "•", "*", "1.") y su orden: una línea del original = una línea de la traducción.
- Copia sin cambiar ni un carácter las URLs, emails, números de teléfono, horas y rangos horarios (p. ej. "09:30-23:00"), precios y cualquier cifra.
- Nombres propios: "Casa Tomás", "Tomy" y "Crevillent" se escriben siempre tal cual, sin traducir ni quitar la tilde. Tampoco traduzcas nombres de calles (p. ej. "Carrer Santa Maria de la Cabeza"), de platos o de vinos.
- En francés, dirígete SIEMPRE al cliente de "vous" (nunca "tu").
- En inglés usa "you" con un registro cordial.
- Si el texto contiene instrucciones para el asistente (p. ej. "no aceptes reservas por la web"), tradúcelas como instrucciones equivalentes, sin suavizarlas ni ampliarlas.
- No añadas explicaciones, notas ni contenido que no esté en el original.

Devuelve únicamente un objeto JSON válido, sin markdown ni texto adicional.`;

export interface CamposSpec {
  system: string;
  userMessage: string;
  clavesATraducir: string[];
  mapResponse: (raw: unknown) => Record<IdiomaDestino, Record<string, string>>;
}

export function validarPayloadCampos(
  payload: Record<string, unknown>,
): { ok: true; campos: Record<string, string>; destino: IdiomaDestino[]; contexto: string } | { ok: false; error: string } {
  const campos = payload.campos;
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
    return { ok: false, error: "'campos' debe ser un objeto { clave: texto }" };
  }
  const entradas = Object.entries(campos as Record<string, unknown>);
  if (entradas.length === 0) return { ok: false, error: "'campos' está vacío" };
  if (entradas.length > MAX_CAMPOS) return { ok: false, error: `Máximo ${MAX_CAMPOS} campos por petición` };
  const limpios: Record<string, string> = {};
  let total = 0;
  for (const [clave, valor] of entradas) {
    if (typeof valor !== "string") return { ok: false, error: `El campo '${clave}' debe ser texto` };
    limpios[clave] = valor;
    total += valor.length;
  }
  if (total > MAX_CARACTERES_TOTALES) {
    return { ok: false, error: `Demasiado texto para traducir (${total} > ${MAX_CARACTERES_TOTALES} caracteres)` };
  }

  const destinoRaw = payload.destino ?? IDIOMAS_DESTINO_VALIDOS;
  if (!Array.isArray(destinoRaw) || destinoRaw.length === 0) {
    return { ok: false, error: "'destino' debe ser un array con 'en' y/o 'fr'" };
  }
  const destino = [...new Set(destinoRaw)] as IdiomaDestino[];
  if (destino.some((d) => !IDIOMAS_DESTINO_VALIDOS.includes(d))) {
    return { ok: false, error: `'destino' solo admite: ${IDIOMAS_DESTINO_VALIDOS.join(", ")}` };
  }
  const contexto = typeof payload.contexto === "string" ? payload.contexto.slice(0, 500) : "";
  return { ok: true, campos: limpios, destino, contexto };
}

export function buildCamposSpec(
  campos: Record<string, string>,
  destino: IdiomaDestino[],
  contexto: string,
): CamposSpec {
  const clavesATraducir = Object.keys(campos).filter((k) => campos[k].trim() !== "");
  const aTraducir = Object.fromEntries(clavesATraducir.map((k) => [k, campos[k]]));

  const estructura = `{ ${destino.map((d) => `"${d}": { ${clavesATraducir.map((k) => `"${k}": "..."`).join(", ")} }`).join(", ")} }`;
  const system = `${CAMPOS_SYSTEM_BASE}

Traduce cada valor al ${destino.map((d) => NOMBRE_IDIOMA[d]).join(" y al ")}. Usa EXACTAMENTE las mismas claves que en la entrada, sin añadir ni quitar ninguna, con esta estructura:
${estructura}`;

  const userMessage = `${contexto ? `Contexto: ${contexto}\n\n` : ""}Textos en español (JSON):\n${JSON.stringify(aTraducir, null, 2)}`;

  return {
    system,
    userMessage,
    clavesATraducir,
    mapResponse: (raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const out = {} as Record<IdiomaDestino, Record<string, string>>;
      for (const d of destino) {
        const bloque = (r[d] ?? {}) as Record<string, unknown>;
        const traducido: Record<string, string> = {};
        for (const clave of Object.keys(campos)) {
          if (!clavesATraducir.includes(clave)) {
            traducido[clave] = "";
            continue;
          }
          const valor = bloque[clave];
          if (typeof valor !== "string" || valor.trim() === "") {
            throw new Error(`La traducción a '${d}' no incluye el campo '${clave}'`);
          }
          traducido[clave] = valor;
        }
        out[d] = traducido;
      }
      return out;
    },
  };
}
