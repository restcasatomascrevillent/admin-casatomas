/**
 * newsletter-ia · lo que propone la IA pasa por aquí antes de llegar al panel.
 *
 * - Recorta los textos a los límites (en vez de rechazar la propuesta entera).
 * - Imágenes: solo las de la galería que mandó el panel (la IA no inventa URLs).
 * - Botones: solo enlaces a la web del restaurante o su teléfono; cualquier
 *   otro se cambia por «Reservar» y se avisa.
 * - Avisa de precios o porcentajes que no estaban en la petición (posible dato
 *   inventado) y de huecos entre corchetes por completar.
 * - Al final, la misma validación que enviar-newsletter (validarBloques): lo
 *   que sale de aquí se puede enviar tal cual… después de que el personal lo
 *   revise y confirme en el panel.
 */
import {
  esEnlacePropio,
  esTipoNewsletter,
  urlBotonSegura,
  urlHttpsSegura,
  validarBloques,
  LIMITE_INSIGNIA,
  LIMITE_PREHEADER,
  LIMITE_TEXTO_BLOQUE,
  MAX_BLOQUES,
  MAX_PLATOS,
  URL_RESERVAR,
  type Bloque,
  type TipoNewsletter,
} from "../_shared/newsletter/bloques.ts";

export interface PropuestaNewsletter {
  tipo: TipoNewsletter;
  insignia: string;
  titulo: string;
  preheader: string;
  bloques: Bloque[];
}

export class ErrorPropuesta extends Error {}

/** Recorta a `max` caracteres (con «…») y quita espacios sobrantes. */
export function recortar(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const t = v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…` : t;
}

const unaLinea = (v: unknown, max: number) => recortar(typeof v === "string" ? v.replace(/\s+/g, " ") : v, max);

/** Quita restos de Markdown/HTML que a veces cuela el modelo («**», «#», etiquetas). */
export function limpiarFormato(t: string): string {
  return t
    .replace(/<[^>]{1,200}>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}

const txt = (v: unknown, max: number) => limpiarFormato(recortar(v, max));
const linea = (v: unknown, max: number) => limpiarFormato(unaLinea(v, max));

/** Cifras con € o % de un texto, normalizadas («35 €» → «35€», «12,50€» → «12,50€»). */
export function cifras(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(/(\d+(?:[.,]\d+)?)\s*(€|euros?|%)/gi)) {
    out.add(`${m[1]}${m[2].startsWith("%") ? "%" : "€"}`);
  }
  return [...out];
}

function textosDeBloques(bloques: Bloque[]): string {
  return bloques
    .map((b) => Object.values(b).flatMap((v) => (Array.isArray(v) ? v.flatMap((p) => Object.values(p)) : [v])).filter((v) => typeof v === "string").join(" "))
    .join(" ");
}

export interface ContextoNormalizar {
  /** Petición del usuario + diseño actual: lo que la IA SÍ podía usar. */
  fuente: string;
  imagenes: readonly string[];
  tipoPedido: TipoNewsletter | null;
}

export function normalizarPropuesta(raw: unknown, ctx: ContextoNormalizar): { propuesta: PropuestaNewsletter; avisos: string[] } {
  if (!raw || typeof raw !== "object") throw new ErrorPropuesta("La IA no devolvió una propuesta");
  const r = raw as Record<string, unknown>;
  const avisos: string[] = [];
  const imagenes = new Set(ctx.imagenes.map((u) => urlHttpsSegura(u)).filter(Boolean) as string[]);

  const tipo: TipoNewsletter = esTipoNewsletter(r.tipo) ? r.tipo : ctx.tipoPedido ?? "personalizada";
  const titulo = linea(r.titulo, 120);
  if (!titulo) throw new ErrorPropuesta("La IA no propuso un asunto");

  const bloques: Bloque[] = [];
  const crudos = Array.isArray(r.bloques) ? r.bloques : [];
  let imagenesDescartadas = 0;
  let enlacesCambiados = 0;
  for (const c of crudos.slice(0, MAX_BLOQUES) as Array<Record<string, unknown> | null>) {
    if (!c || typeof c !== "object") continue;
    switch (c.tipo) {
      case "texto":
      case "firma": {
        const t = txt(c.texto, LIMITE_TEXTO_BLOQUE);
        if (t) bloques.push({ tipo: c.tipo, texto: t });
        break;
      }
      case "imagen": {
        const url = urlHttpsSegura(typeof c.url === "string" ? c.url : null);
        if (!url || !imagenes.has(url)) {
          imagenesDescartadas++;
          break;
        }
        const pie = linea(c.texto, 120);
        bloques.push({ tipo: "imagen", url, alt: linea(c.alt, 120) || "Foto de Casa Tomás", ...(pie ? { pie } : {}) });
        break;
      }
      case "destacado": {
        const t = txt(c.texto, LIMITE_TEXTO_BLOQUE);
        const ti = linea(c.titulo, 120);
        if (t) bloques.push({ tipo: "destacado", texto: t, ...(ti ? { titulo: ti } : {}) });
        break;
      }
      case "platos": {
        const platos = (Array.isArray(c.platos) ? c.platos : [])
          .slice(0, MAX_PLATOS)
          .map((p: Record<string, unknown> | null) => {
            const nombre = linea(p?.nombre, 120);
            const descripcion = linea(p?.descripcion, 300);
            const precio = linea(p?.precio, 30);
            return { nombre, ...(descripcion ? { descripcion } : {}), ...(precio ? { precio } : {}) };
          })
          .filter((p) => p.nombre);
        const ti = linea(c.titulo, 120);
        if (platos.length) bloques.push({ tipo: "platos", platos, ...(ti ? { titulo: ti } : {}) });
        break;
      }
      case "evento": {
        const campos = { fecha: linea(c.fecha, 80), hora: linea(c.hora, 40), lugar: linea(c.lugar, 120), precio: linea(c.precio, 60) };
        const limpio = Object.fromEntries(Object.entries(campos).filter(([, v]) => v));
        if (Object.keys(limpio).length) bloques.push({ tipo: "evento", ...limpio });
        break;
      }
      case "boton": {
        const t = linea(c.texto, 40) || "Reservar mesa";
        let url = urlBotonSegura(typeof c.url === "string" ? c.url : null);
        if (!url || !esEnlacePropio(url)) {
          enlacesCambiados++;
          url = URL_RESERVAR;
        }
        bloques.push({ tipo: "boton", texto: t, url });
        break;
      }
      case "cita": {
        const t = txt(c.texto, 600);
        const autor = linea(c.autor, 80);
        if (t) bloques.push({ tipo: "cita", texto: t, ...(autor ? { autor } : {}) });
        break;
      }
      case "separador":
        // Nunca dos seguidos ni al principio.
        if (bloques.length && bloques[bloques.length - 1].tipo !== "separador") bloques.push({ tipo: "separador" });
        break;
    }
  }
  while (bloques.length && bloques[bloques.length - 1].tipo === "separador") bloques.pop();

  const v = validarBloques(bloques);
  if (v.ok === false) throw new ErrorPropuesta(`La propuesta de la IA no es válida: ${v.error}`);

  if (imagenesDescartadas) avisos.push("Se ha quitado una foto que no era de la galería: elige tú la foto si quieres una.");
  if (enlacesCambiados) avisos.push("Un botón apuntaba fuera de la web del restaurante y se ha cambiado por la página de reservas.");

  const propuesta: PropuestaNewsletter = {
    tipo,
    insignia: linea(r.insignia, LIMITE_INSIGNIA),
    titulo,
    preheader: linea(r.preheader, LIMITE_PREHEADER),
    bloques: v.bloques,
  };

  // ¿Cifras que no venían en la petición? Posible dato inventado.
  const permitidas = new Set(cifras(ctx.fuente));
  const nuevas = cifras(`${propuesta.titulo} ${propuesta.preheader} ${textosDeBloques(propuesta.bloques)}`).filter((c) => !permitidas.has(c));
  if (nuevas.length) avisos.push(`Revisa ${nuevas.map((c) => `«${c}»`).join(", ")}: no estaba en tu descripción.`);

  const faltan = (Array.isArray(r.faltan) ? r.faltan : []).map((f) => linea(f, 80)).filter(Boolean).slice(0, 8);
  if (faltan.length) avisos.push(`Falta completar: ${faltan.join(", ")}.`);
  else if (/\[[^\]\n]{1,60}\]/.test(textosDeBloques(propuesta.bloques) + propuesta.titulo)) avisos.push("Hay huecos entre corchetes por completar antes de enviar.");

  return { propuesta, avisos };
}
