/**
 * Chat de facturas: el número de un documento citado en la respuesta se
 * convierte en enlace a su original en Google Drive (petición del dueño,
 * 12/11/2026: «que cuando se nombre una factura en el chat de facturas salga
 * el enlace para abrir esa factura en Drive»).
 *
 * La función `chat-facturas` manda los documentos citados (adjunto
 * `documentos`, con `drive_url`); aquí se busca, en el markdown de la
 * respuesta, la PRIMERA vez que sale el número de cada uno y se envuelve en
 * `[número](drive_url)`. Además siguen listados debajo («Documentos citados»).
 *
 *  - Solo con `drive_url` http(s) (`urlSegura`): lo que solo está en el bucket
 *    privado necesita URL firmada y se abre con el botón de la lista.
 *  - El número casa con los separadores que ponga el modelo («FV-2026/12» =
 *    «FV 2026 12») y nunca pegado a otra letra o cifra (`2482` no casa con
 *    `12482` ni con `24,82 €`). Mismo criterio que `respuestaNombra` de la
 *    función.
 *  - No se toca lo que ya es código (``` y `…`), un enlace o una URL.
 */
import { urlSegura } from "@/lib/url-segura";
import type { DocumentoCitado } from "@/lib/facturas/seriePrecio";

interface Trozo {
  texto: string;
  protegido: boolean;
}

/** Código (bloque o en línea), enlaces markdown y URLs sueltas: no se enlaza dentro. */
const PROTEGIDO = /```[\s\S]*?```|`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/[^\s)]+/g;

function trocear(texto: string): Trozo[] {
  const trozos: Trozo[] = [];
  let desde = 0;
  for (const m of texto.matchAll(PROTEGIDO)) {
    const i = m.index ?? 0;
    if (i > desde) trozos.push({ texto: texto.slice(desde, i), protegido: false });
    trozos.push({ texto: m[0], protegido: true });
    desde = i + m[0].length;
  }
  if (desde < texto.length) trozos.push({ texto: texto.slice(desde), protegido: false });
  return trozos;
}

/** Expresión del número: sus letras y cifras, con cualquier separador entre ellas. */
export function patronNumero(numero: string): RegExp | null {
  const chars = numero
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .split("");
  if (chars.length < 3) return null;
  const cuerpo = chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s./-]*");
  return new RegExp(`(?<![\\p{L}\\p{N}])${cuerpo}(?![\\p{L}\\p{N}])`, "iu");
}

/** Texto del enlace: los corchetes romperían el markdown. */
const textoEnlace = (s: string) => s.replace(/[[\]]/g, "\\$&");

export function enlazarDocumentos(texto: string, documentos: DocumentoCitado[]): string {
  if (!texto || documentos.length === 0) return texto;
  let trozos = trocear(texto);
  for (const d of documentos) {
    const url = urlSegura(d.drive_url);
    const patron = d.numero ? patronNumero(d.numero) : null;
    if (!url || !patron) continue;
    const i = trozos.findIndex((t) => !t.protegido && patron.test(t.texto));
    if (i === -1) continue;
    const t = trozos[i];
    const m = patron.exec(t.texto);
    if (!m) continue;
    const antes = t.texto.slice(0, m.index);
    const despues = t.texto.slice(m.index + m[0].length);
    trozos = [
      ...trozos.slice(0, i),
      ...(antes ? [{ texto: antes, protegido: false }] : []),
      // `<url>`: un paréntesis en la URL no corta el enlace.
      { texto: `[${textoEnlace(m[0])}](<${url}>)`, protegido: true },
      ...(despues ? [{ texto: despues, protegido: false }] : []),
      ...trozos.slice(i + 1),
    ];
  }
  return trozos.map((t) => t.texto).join("");
}
