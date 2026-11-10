// ============================================================================
// Diseño de un correo de la newsletter en el panel (puro)
// ----------------------------------------------------------------------------
// Lo que edita el personal en «Enviar Newsletter»: plantilla (tipo), asunto,
// etiqueta, texto de vista previa y bloques. El modelo de bloques, su
// validación y las plantillas de partida son los MISMOS que usa el envío
// (supabase/functions/_shared/newsletter/bloques.ts).
// ============================================================================
import {
  plantillaBase,
  textoPlanoDeBloques,
  validarBloques,
  URL_RESERVAR,
  type Bloque,
  type PlantillaBase,
  type TipoBloque,
  type TipoNewsletter,
} from "../../../supabase/functions/_shared/newsletter/bloques";

export * from "../../../supabase/functions/_shared/newsletter/bloques";

export interface DisenoNewsletter {
  tipo: TipoNewsletter;
  titulo: string;
  insignia: string;
  preheader: string;
  bloques: Bloque[];
}

/** Fila de newsletter_plantillas (las que guarda el personal). */
export interface PlantillaGuardada {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: TipoNewsletter;
  titulo: string;
  insignia: string;
  preheader: string;
  bloques: Bloque[];
  origen: "manual" | "ia";
  created_at: string;
  updated_at: string;
}

const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function disenoDePlantilla(p: PlantillaBase | PlantillaGuardada): DisenoNewsletter {
  const base = plantillaBase(p.tipo);
  return {
    tipo: p.tipo,
    titulo: p.titulo,
    insignia: p.insignia || base.insignia,
    preheader: p.preheader,
    bloques: copia(p.bloques),
  };
}

export function bloqueVacio(tipo: TipoBloque): Bloque {
  switch (tipo) {
    case "texto":
      return { tipo, texto: "" };
    case "firma":
      return { tipo, texto: "Un abrazo,\nEl equipo de Casa Tomás" };
    case "imagen":
      return { tipo, url: "", alt: "" };
    case "destacado":
      return { tipo, titulo: "", texto: "" };
    case "platos":
      return { tipo, titulo: "", platos: [{ nombre: "" }] };
    case "evento":
      return { tipo, fecha: "", hora: "", lugar: "", precio: "" };
    case "boton":
      return { tipo, texto: "Reservar mesa", url: URL_RESERVAR };
    case "cita":
      return { tipo, texto: "", autor: "" };
    case "separador":
      return { tipo };
  }
}

/** Huecos sin rellenar: «[fecha]» (los deja la IA) o los «…» de las plantillas de partida. */
export function huecosPorCompletar(d: DisenoNewsletter): string[] {
  const texto = [d.titulo, d.preheader, textoPlanoDeBloques(d.bloques)].join("\n");
  const huecos = new Set<string>();
  for (const m of texto.matchAll(/\[[^\]\n]{1,60}\]/g)) huecos.add(m[0]);
  if (/…/.test(texto)) huecos.add("…");
  return [...huecos];
}

export type ResultadoDiseno =
  | { ok: true; payload: { tipo: TipoNewsletter; titulo: string; mensaje: string; bloques: Bloque[]; insignia?: string; preheader?: string } }
  | { ok: false; error: string };

/**
 * Cuerpo para enviar-newsletter. `mensaje` va SIEMPRE (versión de texto): si
 * la función desplegada todavía es la anterior (sin bloques), manda al menos
 * ese texto con el título, nunca un correo vacío.
 */
export function payloadDeDiseno(d: DisenoNewsletter): ResultadoDiseno {
  const titulo = d.titulo.trim();
  if (!titulo) return { ok: false, error: "Escribe el asunto del correo." };
  const v = validarBloques(d.bloques);
  if (v.ok === false) return { ok: false, error: v.error };
  const insignia = d.insignia.trim();
  const preheader = d.preheader.trim();
  return {
    ok: true,
    payload: {
      tipo: d.tipo,
      titulo,
      mensaje: textoPlanoDeBloques(v.bloques),
      bloques: v.bloques,
      ...(insignia ? { insignia } : {}),
      ...(preheader ? { preheader } : {}),
    },
  };
}
