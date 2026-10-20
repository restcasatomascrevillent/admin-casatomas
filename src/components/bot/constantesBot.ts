import type { IdiomaBotWeb } from "@/hooks/useConfigBotWeb";

export const IDIOMAS: { value: IdiomaBotWeb; label: string; flag: string }[] = [
  { value: "es", label: "Español", flag: "🇪🇸" },
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "fr", label: "Français", flag: "🇫🇷" },
];

export interface TonoOpcion {
  value: string;
  label: string;
  desc: string;
}

// Mismo concepto de tono en los 3 idiomas, pero el VALOR que se guarda va en
// el idioma de cada fila (el panel solo edita ES; EN/FR se derivan por
// posición en traduccionBot.ts → tonoEquivalente): buildSystemPrompt (en
// supabase/functions/chat-web/index.ts) mete este texto tal cual dentro del
// prompt de ESE idioma ("Tone: ${tono}" / "Ton: ${tono}" / "Tono: ${tono}") —
// guardar una palabra en español en la fila inglesa colaría una palabra
// suelta en español dentro de un prompt que se supone 100% en inglés.
//
// Los valores por defecto coinciden con los datos reales en producción
// (comprobado en vivo el 2026-09-22): es.tono="divertido", en.tono="fun",
// fr.tono="amusant" — así que al abrir la pantalla el tono ya guardado
// aparece correctamente seleccionado en los 3 idiomas, no solo en español
// como pasaba con el selector anterior (que solo tenía las 4 opciones en
// español, también al editar EN o FR).
export const TONO_OPTIONS: Record<IdiomaBotWeb, TonoOpcion[]> = {
  es: [
    { value: "cercano", label: "Cercano", desc: "Amigable, como un camarero que ya te conoce" },
    { value: "formal", label: "Formal", desc: "Profesional y elegante" },
    { value: "divertido", label: "Divertido", desc: "Desenfadado, con toques de humor" },
    { value: "exclusivo", label: "Exclusivo", desc: "Sofisticado, alta gastronomía" },
  ],
  en: [
    { value: "warm", label: "Warm", desc: "Friendly, like a waiter who already knows you" },
    { value: "formal", label: "Formal", desc: "Professional and elegant" },
    { value: "fun", label: "Fun", desc: "Relaxed, with a touch of humour" },
    { value: "exclusive", label: "Exclusive", desc: "Sophisticated, fine dining" },
  ],
  fr: [
    { value: "chaleureux", label: "Chaleureux", desc: "Amical, comme un serveur qui vous connaît déjà" },
    { value: "formel", label: "Formel", desc: "Professionnel et élégant" },
    { value: "amusant", label: "Amusant", desc: "Décontracté, avec une touche d'humour" },
    { value: "exclusif", label: "Exclusif", desc: "Sophistiqué, haute gastronomie" },
  ],
};

// Etiquetas de la INTERFAZ (siempre en español, como el resto del panel).
// Van en el mismo orden que cada lista de TONO_OPTIONS: la posición es el
// "concepto" de tono y TONO_OPTIONS[idioma][i].value es lo que se guarda en
// la fila de ese idioma. Así el selector se lee en español aunque se esté
// editando EN o FR, sin cambiar lo que se persiste.
export const TONOS_UI: { label: string; desc: string }[] = [
  { label: "Cercano", desc: "Amigable, como un camarero que ya te conoce" },
  { label: "Formal", desc: "Profesional y elegante" },
  { label: "Divertido", desc: "Desenfadado, con toques de humor" },
  { label: "Exclusivo", desc: "Sofisticado, alta gastronomía" },
];

export interface DeteccionContacto {
  horario: boolean;
  contacto: boolean;
  direccion: boolean;
  completa: boolean;
}

const PALABRAS_HORARIO = [
  "horario", "horarios", "hours", "heures", "horaire", "horaires", "abrimos", "abierto",
  "cerrado", "open", "closed", "fermé", "ferme", "ouvert",
];
const PALABRAS_CONTACTO = [
  "teléfono", "telefono", "tel", "tlf", "phone", "téléphone", "telephone",
  "email", "e-mail", "correo", "contacto", "contact",
];
const PALABRAS_DIRECCION = [
  "dirección", "direccion", "address", "adresse", "calle", "carrer",
  "street", "rue", "avenida", "avinguda", "avenue", "plaza", "plaça",
  "ubicación", "ubicacion", "location", "situé", "situés", "située",
];

// Una hora: "9:30", "09h30", "9h", "13 h", "9 am", "9pm", "9 a.m.". No se
// aceptan "9.30"/"9,30" (se confunden con precios). Delante no puede haber
// otro dígito ni separador decimal, y "h"/"am"/"pm" no pueden ir pegados a
// una letra ("2 hours", "9 amigos").
const REGEX_HORA =
  /(?<![\d.,])(?:[01]?\d|2[0-3])(?:\s?[:h]\s?[0-5]\d|\s?h(?!\p{L})|\s?(?:a\.?m|p\.?m)\.?(?!\p{L}))/iu;
// Candidatos a teléfono: tramo de dígitos con espacios, puntos, guiones o
// paréntesis. Solo cuenta si suma entre 9 y 15 dígitos (España = 9; E.164 ≤
// 15), así un rango de años "2025-2026" (8 dígitos) no pasa por teléfono.
const REGEX_CANDIDATO_TELEFONO = /\+?\d[\d\s.()-]{6,}\d/g;
const REGEX_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Coincidencia por PALABRA completa, consciente de acentos (\b de JS solo
// entiende ASCII): "rue" no casa con "true", ni "open" con "opening".
function regexPalabras(palabras: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${palabras.map(escaparRegex).join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

const RE_HORARIO = regexPalabras(PALABRAS_HORARIO);
const RE_CONTACTO = regexPalabras(PALABRAS_CONTACTO);
const RE_DIRECCION = regexPalabras(PALABRAS_DIRECCION);

function contieneTelefono(texto: string): boolean {
  for (const m of texto.matchAll(REGEX_CANDIDATO_TELEFONO)) {
    const digitos = m[0].replace(/\D/g, "").length;
    if (digitos >= 9 && digitos <= 15) return true;
  }
  return false;
}

// Heurística de detección, NO una certeza: busca patrones de hora/teléfono y
// palabras clave en es/en/fr dentro de "instrucciones_extra". Sirve para
// avisar de un hueco probable, no para certificar que el contenido es
// correcto — por eso la UI que la usa siempre la etiqueta como aproximada y
// dice "revísalo tú".
export function detectaInfoContacto(texto: string | null | undefined): DeteccionContacto {
  const t = (texto ?? "").trim().toLowerCase();
  const horario = REGEX_HORA.test(t) || RE_HORARIO.test(t);
  const contacto = contieneTelefono(t) || REGEX_EMAIL.test(t) || RE_CONTACTO.test(t);
  const direccion = RE_DIRECCION.test(t);
  return { horario, contacto, direccion, completa: horario && contacto && direccion };
}

// Límite de "Instrucciones extra": va entero en el prompt de cada mensaje, así
// que cuanto más largo, más caro y más diluido. Se muestra con contador.
export const MAX_INSTRUCCIONES_EXTRA = 1500;
