import type { ConfigBotWeb, ConfigBotWebUpdate, DraftBotWeb, IdiomaBotWeb } from "@/hooks/useConfigBotWeb";
import { TONO_OPTIONS } from "./constantesBot";

// Lógica pura de la traducción automática del Bot web: el dueño solo edita
// la fila ES de configBotWeb y las filas EN/FR se generan a partir de ella.
// Aislada del componente/hook para poder testearla sin Supabase.

export type IdiomaTraducido = Exclude<IdiomaBotWeb, "es">;
export const IDIOMAS_TRADUCIDOS: IdiomaTraducido[] = ["en", "fr"];

// usePlatos/useVinos hacen select("*"), así que las filas traen también las
// columnas traducidas aunque sus interfaces no las declaren.
export type ConTraduccion = { nombre_en?: string | null; nombre_fr?: string | null };
export type ItemCarta = { nombre: string | null } & ConTraduccion;

// Mismo criterio que localizar() en supabase/functions/chat-web/index.ts: en
// en/fr se usa nombre_<idioma> si tiene contenido y si no, el nombre español.
// Así lo que se guarda en platos/vinos_recomendados coincide con los nombres
// que la herramienta del bot devuelve en ese idioma.
export function nombreLocalizado(item: ItemCarta, idioma: IdiomaBotWeb): string | null {
  if (idioma === "en" && item.nombre_en?.trim()) return item.nombre_en.trim();
  if (idioma === "fr" && item.nombre_fr?.trim()) return item.nombre_fr.trim();
  return item.nombre;
}

// Los nombres de platos/vinos NO se traducen con IA: se buscan en la carta
// (nombre_en/nombre_fr ya revisados allí) y, si no hay traducción o el
// nombre ya no existe en la carta, se deja el español tal cual.
export function mapearNombres(nombresEs: string[], catalogo: ItemCarta[], idioma: IdiomaTraducido): string[] {
  const porNombre = new Map<string, ItemCarta>();
  for (const item of catalogo) {
    const clave = item.nombre?.trim().toLowerCase();
    if (clave && !porNombre.has(clave)) porNombre.set(clave, item);
  }
  return nombresEs.map((nombre) => {
    const item = porNombre.get(nombre.trim().toLowerCase());
    return (item && nombreLocalizado(item, idioma)) || nombre;
  });
}

// El tono es un concepto por POSICIÓN en TONO_OPTIONS (cercano ↔ warm ↔
// chaleureux…). Si el valor español es uno de los conocidos se usa su
// equivalente; si es un valor personalizado devuelve null y hay que
// traducirlo como texto.
export function tonoEquivalente(tonoEs: string, idioma: IdiomaTraducido): string | null {
  const idx = TONO_OPTIONS.es.findIndex((t) => t.value === tonoEs);
  if (idx === -1) return null;
  return TONO_OPTIONS[idioma][idx]?.value ?? null;
}

// Claves que viajan a traducir-contenido (modo "campos").
export const CAMPOS_TRADUCIBLES = ["mensaje_bienvenida", "instrucciones_extra", "frases_personalizadas"] as const;

export function camposATraducir(draftEs: DraftBotWeb): Record<string, string> {
  const campos: Record<string, string> = {
    mensaje_bienvenida: draftEs.mensaje_bienvenida,
    instrucciones_extra: draftEs.instrucciones_extra,
    frases_personalizadas: draftEs.frases_personalizadas,
  };
  // Tono personalizado (no es una de las 4 opciones): se traduce como texto.
  if (draftEs.tono.trim() && tonoEquivalente(draftEs.tono, "en") === null) {
    campos.tono = draftEs.tono;
  }
  return campos;
}

export interface CatalogosCarta {
  platos: ItemCarta[];
  vinos: ItemCarta[];
}

// Construye el UPDATE de la fila EN o FR a partir del borrador ES guardado y
// la respuesta de traducir-contenido. Lanza si falta un texto que en ES no
// está vacío: nunca se sobrescribe EN/FR con una cadena vacía por un fallo.
export function construirUpdateTraducido(
  draftEs: DraftBotWeb,
  traducidos: Record<string, string> | undefined,
  idioma: IdiomaTraducido,
  catalogos: CatalogosCarta,
): ConfigBotWebUpdate {
  const t = traducidos ?? {};
  const texto = (clave: string): string => {
    const origen = clave === "tono" ? draftEs.tono : (draftEs[clave as (typeof CAMPOS_TRADUCIBLES)[number]] ?? "");
    if (!origen.trim()) return "";
    const valor = t[clave];
    if (typeof valor !== "string" || !valor.trim()) {
      throw new Error(`Falta la traducción de "${clave}" (${idioma.toUpperCase()})`);
    }
    return valor;
  };

  const tono = draftEs.tono.trim() ? (tonoEquivalente(draftEs.tono, idioma) ?? texto("tono")) : "";

  return {
    tono,
    mensaje_bienvenida: texto("mensaje_bienvenida"),
    instrucciones_extra: texto("instrucciones_extra"),
    frases_personalizadas: texto("frases_personalizadas"),
    platos_recomendados: mapearNombres(draftEs.platos, catalogos.platos, idioma).join(", "),
    vinos_recomendados: mapearNombres(draftEs.vinos, catalogos.vinos, idioma).join(", "),
  };
}

export type EstadoTraduccion = "al_dia" | "desactualizado" | "sin_traducir";

// Compara updated_at (lo pone el trigger update_config_bot_web_updated_at en
// cada UPDATE): la traducción se escribe DESPUÉS de guardar ES, así que si ES
// es más reciente que EN/FR, esa traducción no refleja lo último guardado.
export function estadoTraduccion(es: ConfigBotWeb | null, destino: ConfigBotWeb | null): EstadoTraduccion {
  if (!destino) return "sin_traducir";
  if (!es) return "al_dia";
  const tEs = Date.parse(es.updated_at);
  const tDestino = Date.parse(destino.updated_at);
  if (Number.isNaN(tEs) || Number.isNaN(tDestino)) return "al_dia";
  return tEs > tDestino ? "desactualizado" : "al_dia";
}
