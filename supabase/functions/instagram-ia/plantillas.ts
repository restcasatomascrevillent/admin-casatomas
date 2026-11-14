/**
 * Copia en el servidor de lo que la IA necesita saber de cada plantilla de
 * src/lib/instagram/plantillas (las Edge Functions no pueden importar de src/):
 * marca, campos de texto que usa y su máximo de caracteres, y cómo pone la
 * foto (encaje: «sangre» la amplía hasta cubrir; «marco» la pone entera,
 * para las fotos de la carta de 1200×900). El test
 * instagram-ia/__tests__/plantillas.test.ts falla si esta copia se separa del
 * registro del panel (PLANTILLAS): si añades o cambias una plantilla, cámbiala
 * también aquí.
 */
import type { PlantillaCampana } from "../_shared/instagram/validar-campana.ts";

/**
 * Además de los rótulos, para las campañas (fase 2): formatos que admite,
 * si lleva foto y si sirve para una campaña (tz-tipografica no: necesita la
 * lista de cócteles con precios, que la IA no escribe).
 */
export interface PlantillaIA extends PlantillaCampana {
  campanas: boolean;
  /**
   * Clásica (las de antes del 08/11/2026): se sigue aceptando si llega (las
   * piezas guardadas), pero montar_pieza y las campañas no la eligen.
   */
  clasica?: boolean;
  /** «Solo foto» (12/11/2026): sin ningún texto; los rótulos no se piden ni se revisan. */
  sinTexto?: boolean;
}

/** Papel de una plantilla v2 (src/lib/instagram/tipos.ts → PapelPlantilla). */
export type PapelIA = "portada" | "plato" | "cierre" | "tipografica" | "anuncio" | "foto";

export const PLANTILLAS_IA: readonly PlantillaIA[] = [
  {
    id: "ct-cierre",
    marca: "casa-tomas",
    campos: ["titular", "cita", "cta", "pie"],
    limites: { titular: 40, cita: 90, cta: 26, pie: 48 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    papel: "cierre",
    campanas: true,
  },
  {
    id: "ct-cierre-marca",
    marca: "casa-tomas",
    campos: ["titular", "cita", "cta", "pie"],
    limites: { titular: 40, cita: 70, cta: 26, pie: 30 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: false,
    papel: "cierre",
    campanas: true,
  },
  {
    id: "ct-cierre-marco",
    marca: "casa-tomas",
    campos: ["titular", "cita", "cta", "pie"],
    limites: { titular: 40, cita: 80, cta: 26, pie: 48 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    papel: "cierre",
    campanas: true,
  },
  {
    id: "ct-foto-titular",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cta", "pie"],
    limites: { antetitulo: 40, titular: 44, cta: 26, pie: 48 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    clasica: true,
    campanas: false,
  },
  {
    id: "ct-frase",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 40, titular: 60, cita: 90, pie: 48 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: false,
    papel: "tipografica",
    campanas: true,
  },
  {
    id: "ct-marco",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 34, titular: 38, cita: 70, cta: 26, pie: 48 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    clasica: true,
    campanas: false,
  },
  {
    id: "ct-plato",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita"],
    limites: { antetitulo: 30, titular: 34, cita: 60 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    papel: "plato",
    campanas: true,
  },
  {
    id: "ct-plato-marco",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita"],
    limites: { antetitulo: 34, titular: 38, cita: 70 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    papel: "plato",
    campanas: true,
  },
  {
    id: "ct-portada",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 24, titular: 44, cita: 80, cta: 24, pie: 34 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    papel: "portada",
    campanas: true,
  },
  {
    id: "ct-portada-marco",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 34, titular: 38, cita: 70, cta: 24, pie: 34 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    papel: "portada",
    campanas: true,
  },
  // Story del jueves de tapas (12/11/2026): papel «anuncio», la montan su botón y su automático
  // (lista de tapas obligatoria): ni montar_pieza ni las campañas las eligen.
  // «Solo foto» (12/11/2026): la foto limpia, sin texto; la de por defecto del feed en montar_pieza.
  {
    id: "ct-solo-foto",
    marca: "casa-tomas",
    campos: [],
    limites: {},
    formatos: ["post"],
    conFoto: true,
    encaje: "marco",
    papel: "foto",
    sinTexto: true,
    campanas: false,
  },
  {
    id: "ct-tapas",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 20, titular: 12, cita: 30, pie: 44 },
    formatos: ["story"],
    conFoto: true,
    encaje: "marco",
    papel: "anuncio",
    campanas: false,
  },
  {
    id: "ct-tapas-clasica",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular"],
    limites: { antetitulo: 20, titular: 12 },
    formatos: ["story"],
    conFoto: true,
    encaje: "marco",
    papel: "anuncio",
    campanas: false,
  },
  {
    id: "ct-tipografica",
    marca: "casa-tomas",
    campos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 40, titular: 60, cita: 70, pie: 48 },
    titularOpcional: true,
    formatos: ["post"],
    conFoto: false,
    clasica: true,
    campanas: false,
  },
  {
    id: "tz-cierre",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 30, titular: 36, cita: 90, cta: 22, pie: 34 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    papel: "cierre",
    campanas: true,
  },
  {
    id: "tz-cierre-marca",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 28, titular: 36, cita: 80, cta: 22, pie: 40 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: false,
    papel: "cierre",
    campanas: true,
  },
  {
    id: "tz-cierre-marco",
    marca: "touza",
    campos: ["titular", "cita", "cta", "pie"],
    limites: { titular: 36, cita: 70, cta: 22, pie: 40 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    papel: "cierre",
    campanas: true,
  },
  {
    id: "tz-foto-titular",
    marca: "touza",
    campos: ["antetitulo", "titular", "cta", "pie"],
    limites: { antetitulo: 36, titular: 40, cta: 22, pie: 70 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    clasica: true,
    campanas: false,
  },
  {
    id: "tz-frase",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita", "pie"],
    limites: { antetitulo: 36, titular: 40, cita: 90, pie: 30 },
    titularOpcional: true,
    formatos: ["post", "story"],
    conFoto: false,
    papel: "tipografica",
    campanas: true,
  },
  {
    id: "tz-marco",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 34, titular: 38, cita: 70, cta: 22, pie: 48 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    clasica: true,
    campanas: false,
  },
  {
    id: "tz-plato",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita"],
    limites: { antetitulo: 30, titular: 32, cita: 64 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    papel: "plato",
    campanas: true,
  },
  {
    id: "tz-plato-marco",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita"],
    limites: { antetitulo: 30, titular: 36, cita: 70 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    papel: "plato",
    campanas: true,
  },
  {
    id: "tz-portada",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 30, titular: 36, cita: 80, cta: 22, pie: 30 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "sangre",
    papel: "portada",
    campanas: true,
  },
  {
    id: "tz-portada-marco",
    marca: "touza",
    campos: ["antetitulo", "titular", "cita", "cta", "pie"],
    limites: { antetitulo: 30, titular: 36, cita: 70, cta: 22, pie: 30 },
    formatos: ["post", "story"],
    conFoto: true,
    encaje: "marco",
    papel: "portada",
    campanas: true,
  },
  {
    id: "tz-solo-foto",
    marca: "touza",
    campos: [],
    limites: {},
    formatos: ["post"],
    conFoto: true,
    encaje: "marco",
    papel: "foto",
    sinTexto: true,
    campanas: false,
  },
  {
    id: "tz-tipografica",
    marca: "touza",
    campos: ["antetitulo", "titular", "pie"],
    limites: { antetitulo: 28, titular: 40, pie: 40 },
    formatos: ["post"],
    conFoto: false,
    papel: "tipografica",
    campanas: false,
  },
  // Estilos de las stories que publica hoy Casa Tomás (src/lib/instagram/plantillas/ct-estilos,
  // 12/11/2026). Al FINAL a propósito: plantillaPara devuelve la primera que encaja, y tienen
  // que seguir saliendo ct-portada, ct-plato, ct-cierre y sus «-marco».
  { id: "ct-rotulo-hilo", marca: "casa-tomas", campos: ["titular", "cita"], limites: { titular: 40, cita: 60 }, formatos: ["post", "story"], conFoto: true, encaje: "sangre", papel: "plato", campanas: true },
  { id: "ct-rotulo-recuadro", marca: "casa-tomas", campos: ["titular", "cita"], limites: { titular: 32, cita: 70 }, formatos: ["post", "story"], conFoto: true, encaje: "sangre", papel: "plato", campanas: true },
  { id: "ct-rotulo-titular", marca: "casa-tomas", campos: ["titular", "cita"], limites: { titular: 28, cita: 40 }, formatos: ["post", "story"], conFoto: true, encaje: "sangre", papel: "portada", campanas: true },
  { id: "ct-rotulo-manuscrita", marca: "casa-tomas", campos: ["titular", "cita"], limites: { titular: 26, cita: 22 }, formatos: ["post", "story"], conFoto: true, encaje: "sangre", papel: "plato", campanas: true },
  { id: "ct-resena", marca: "casa-tomas", campos: ["antetitulo", "titular", "cita"], limites: { antetitulo: 32, titular: 34, cita: 560 }, titularOpcional: true, formatos: ["post", "story"], conFoto: false, papel: "tipografica", campanas: false },
  { id: "ct-resena-foto", marca: "casa-tomas", campos: ["antetitulo", "titular", "cita"], limites: { antetitulo: 32, titular: 34, cita: 560 }, titularOpcional: true, formatos: ["post", "story"], conFoto: true, encaje: "marco", papel: "portada", campanas: false },
  { id: "ct-vosotros-celebracion", marca: "casa-tomas", campos: ["titular", "cita"], limites: { titular: 48, cita: 56 }, formatos: ["story"], conFoto: true, encaje: "marco", papel: "portada", campanas: false },
  { id: "ct-vosotros-gracias", marca: "casa-tomas", campos: ["titular", "pie"], limites: { titular: 34, pie: 32 }, formatos: ["story"], conFoto: true, encaje: "marco", papel: "portada", campanas: false },
  { id: "ct-reserva-mesa", marca: "casa-tomas", campos: ["titular", "cita"], limites: { titular: 16, cita: 32 }, formatos: ["story"], conFoto: true, encaje: "sangre", papel: "cierre", campanas: true },
  { id: "ct-touza-descubre", marca: "casa-tomas", campos: ["titular", "cita", "pie"], limites: { titular: 22, cita: 60, pie: 34 }, formatos: ["story"], conFoto: true, encaje: "sangre", papel: "portada", campanas: true },
  { id: "ct-tapas-poster", marca: "casa-tomas", campos: ["antetitulo", "titular", "pie"], limites: { antetitulo: 14, titular: 20, pie: 22 }, formatos: ["story"], conFoto: true, encaje: "sangre", papel: "portada", campanas: true },
  { id: "ct-icono-destacada", marca: "casa-tomas", campos: ["titular"], limites: { titular: 18 }, formatos: ["story"], conFoto: false, papel: "tipografica", campanas: false },
];

/** «Solo foto» de la marca (post), o null. */
export function plantillaSoloFoto(marca: string): PlantillaIA | null {
  return PLANTILLAS_IA.find((p) => p.marca === marca && p.sinTexto === true && p.formatos.includes("post")) ?? null;
}

export function plantillaIA(id: unknown): PlantillaIA | null {
  return PLANTILLAS_IA.find((p) => p.id === id) ?? null;
}

/**
 * Plantilla v2 (no clásica) con foto de la marca, el papel, el formato y el
 * encaje pedidos, o null (src/lib/instagram → plantillaPara).
 */
export function plantillaPara(marca: string, formato: "post" | "story", papel: PapelIA, encaje: "sangre" | "marco"): PlantillaIA | null {
  return (
    PLANTILLAS_IA.find(
      (p) => p.marca === marca && !p.clasica && p.conFoto && p.papel === papel && (p.encaje ?? "sangre") === encaje && p.formatos.includes(formato),
    ) ?? null
  );
}

/**
 * Plantilla enmarcada («Foto enmarcada») de la marca para ese formato, o null.
 * Es la que vale para una foto que no cubre el lienzo (las de la carta). Por
 * defecto la de portada.
 */
export function plantillaMarco(marca: string, formato: "post" | "story", papel: PapelIA = "portada"): PlantillaIA | null {
  return plantillaPara(marca, formato, papel, "marco");
}

/** Plantillas de una marca que sirven para una campaña. */
export function plantillasCampana(marca: string): PlantillaIA[] {
  return PLANTILLAS_IA.filter((p) => p.marca === marca && p.campanas);
}
