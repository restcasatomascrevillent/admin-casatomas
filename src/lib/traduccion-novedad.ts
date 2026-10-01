// Traducción de NOVEDADES: qué cuenta como "traducción completa".
// ---------------------------------------------------------------------------
// `traducir-contenido` (tipo "novedad") respondía ok:true aunque al modelo se
// le hubiera olvidado un idioma entero o la mitad de los puntos: devolvía
// nulls/arrays vacíos y el panel los guardaba como si fueran la traducción.
// En una novedad nueva la web enseñaba el español en EN/FR sin que nadie se
// enterase; al EDITAR una novedad era peor: se sobrescribía la traducción buena
// que ya había con huecos.
//
// Este módulo es la red del panel: una traducción solo se acepta si cada campo
// que tiene texto en español llega traducido en los dos idiomas, y los puntos
// y etiquetas llegan con el mismo número. Si no, el editor la trata como un
// fallo del traductor (aviso al guardar y se conserva lo anterior).
//
// La función desplegada aplica la misma regla en
// supabase/functions/traducir-contenido/prompts.ts (`camposNovedadSinTraducir`);
// esta copia protege también mientras la función nueva no esté desplegada.
// ---------------------------------------------------------------------------

export interface EspanolNovedad {
  titulo?: string | null;
  descripcion?: string | null;
  badge_text?: string | null;
  bullets?: string[] | null;
  tags?: string[] | null;
}

export interface TraduccionNovedad {
  titulo_en: string;
  titulo_fr: string;
  descripcion_en: string;
  descripcion_fr: string;
  badge_text_en: string;
  badge_text_fr: string;
  bullets_en: string[];
  bullets_fr: string[];
  tags_en: string[];
  tags_fr: string[];
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];

/** Normaliza el `translations` crudo de traducir-contenido a strings/arrays. */
export function normalizarTraduccionNovedad(t: Record<string, unknown> | null | undefined): TraduccionNovedad {
  const r = t ?? {};
  return {
    titulo_en: texto(r.titulo_en),
    titulo_fr: texto(r.titulo_fr),
    descripcion_en: texto(r.descripcion_en),
    descripcion_fr: texto(r.descripcion_fr),
    badge_text_en: texto(r.badge_text_en),
    badge_text_fr: texto(r.badge_text_fr),
    bullets_en: lista(r.bullets_en),
    bullets_fr: lista(r.bullets_fr),
    tags_en: lista(r.tags_en),
    tags_fr: lista(r.tags_fr),
  };
}

/**
 * Columnas que faltan (o no cuadran) en la traducción respecto al español.
 * Lista vacía = traducción completa y se puede guardar.
 */
export function camposSinTraducir(es: EspanolNovedad, t: TraduccionNovedad): string[] {
  const faltan: string[] = [];
  const textos = [
    ["titulo", es.titulo],
    ["descripcion", es.descripcion],
    ["badge_text", es.badge_text],
  ] as const;
  const listas = [
    ["bullets", es.bullets],
    ["tags", es.tags],
  ] as const;

  for (const idioma of ["en", "fr"] as const) {
    for (const [campo, original] of textos) {
      const clave = `${campo}_${idioma}` as keyof TraduccionNovedad;
      if (texto(original) && !texto(t[clave])) faltan.push(clave);
    }
    for (const [campo, original] of listas) {
      const clave = `${campo}_${idioma}` as keyof TraduccionNovedad;
      const esperados = lista(original).length;
      if (esperados > 0 && lista(t[clave]).length !== esperados) faltan.push(clave);
    }
  }
  return faltan;
}
