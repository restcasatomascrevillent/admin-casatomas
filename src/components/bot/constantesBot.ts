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
// el idioma de la fila que se está editando: buildSystemPrompt (en
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
    { value: "cercano", label: "😊 Cercano", desc: "Amigable, como un camarero que ya te conoce" },
    { value: "formal", label: "👔 Formal", desc: "Profesional y elegante" },
    { value: "divertido", label: "🎉 Divertido", desc: "Desenfadado, con toques de humor" },
    { value: "exclusivo", label: "✨ Exclusivo", desc: "Sofisticado, alta gastronomía" },
  ],
  en: [
    { value: "warm", label: "😊 Warm", desc: "Friendly, like a waiter who already knows you" },
    { value: "formal", label: "👔 Formal", desc: "Professional and elegant" },
    { value: "fun", label: "🎉 Fun", desc: "Relaxed, with a touch of humour" },
    { value: "exclusive", label: "✨ Exclusive", desc: "Sophisticated, fine dining" },
  ],
  fr: [
    { value: "chaleureux", label: "😊 Chaleureux", desc: "Amical, comme un serveur qui vous connaît déjà" },
    { value: "formel", label: "👔 Formel", desc: "Professionnel et élégant" },
    { value: "amusant", label: "🎉 Amusant", desc: "Décontracté, avec une touche d'humour" },
    { value: "exclusif", label: "✨ Exclusif", desc: "Sophistiqué, haute gastronomie" },
  ],
};

export interface DeteccionContacto {
  horario: boolean;
  contacto: boolean;
  direccion: boolean;
  completa: boolean;
}

const PALABRAS_HORARIO = [
  "horario", "horarios", "hours", "heures", "abrimos", "abierto",
  "cerrado", "open", "closed", "fermé", "ferme", "ouvert",
];
const PALABRAS_CONTACTO = [
  "teléfono", "telefono", "tel.", "phone", "téléphone", "telephone",
  "email", "e-mail", "correo", "contacto", "contact",
];
const PALABRAS_DIRECCION = [
  "dirección", "direccion", "address", "adresse", "calle", "carrer",
  "street", "rue", "ubicación", "ubicacion", "location", "situé",
];

const REGEX_HORA = /\b\d{1,2}[:h]\d{2}\b/i;
const REGEX_TELEFONO = /\b\d[\d\s.-]{6,}\d\b/;

function contieneAlguna(texto: string, palabras: string[]): boolean {
  return palabras.some((p) => texto.includes(p));
}

// Heurística de detección, NO una certeza: busca patrones de hora/teléfono y
// palabras clave en es/en/fr dentro de "instrucciones_extra". Sirve para
// avisar de un hueco probable, no para certificar que el contenido es
// correcto — por eso la UI que la usa siempre la etiqueta como aproximada y
// dice "revísalo tú".
export function detectaInfoContacto(texto: string | null | undefined): DeteccionContacto {
  const t = (texto ?? "").trim().toLowerCase();
  const horario = REGEX_HORA.test(t) || contieneAlguna(t, PALABRAS_HORARIO);
  const contacto = REGEX_TELEFONO.test(t) || t.includes("@") || contieneAlguna(t, PALABRAS_CONTACTO);
  const direccion = contieneAlguna(t, PALABRAS_DIRECCION);
  return { horario, contacto, direccion, completa: horario && contacto };
}

// Usado por el botón "Copiar del español" en las pestañas EN/FR: nunca borra
// lo que ya hubiera escrito en ese idioma, lo añade a continuación con una
// nota para que quede claro que hace falta traducirlo/revisarlo.
export function combinarConInstruccionesEspañol(actual: string, español: string): string {
  const nota = "[Copiado del español — tradúcelo y revísalo antes de guardar]";
  const bloque = `${nota}\n${español}`;
  return actual.trim() ? `${actual}\n\n${bloque}` : bloque;
}
