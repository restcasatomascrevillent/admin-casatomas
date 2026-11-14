/**
 * Registro ESTÁTICO de plantillas (en el prototipo se descubrían leyendo la
 * carpeta; aquí no hay fs ni imports dinámicos: funciona en el navegador y en
 * Vercel). Una plantilla nueva = carpeta nueva + una línea en TODAS.
 *
 * problemasDePlantilla() comprueba el contrato de ../tipos.ts; los tests
 * exigen que todas las de PLANTILLAS lo cumplan.
 */
import { FORMATOS, MARCAS, type FormatoId, type MarcaId } from "../tokens.js";
import { CAMPOS_PIEZA, PAPELES, encajeDe, type CampoPieza, type EncajeFoto, type PapelPlantilla, type Plantilla } from "../tipos.js";
import { PLANTILLAS_CT_EDITORIAL } from "./ct-editorial/index.js";
import { PLANTILLAS_TZ_EDITORIAL } from "./tz-editorial/index.js";
import { PLANTILLAS_CT_TAPAS } from "./ct-tapas/index.js";
import { PLANTILLAS_SOLO_FOTO } from "./solo-foto/index.js";
import { PLANTILLAS_CT_ESTILOS } from "./ct-estilos/index.js";
import ctFotoTitular from "./ct-foto-titular/index.js";
import ctMarco from "./ct-marco/index.js";
import ctTipografica from "./ct-tipografica/index.js";
import tzFotoTitular from "./tz-foto-titular/index.js";
import tzMarco from "./tz-marco/index.js";
import tzTipografica from "./tz-tipografica/index.js";

const TODAS: readonly Plantilla[] = [
  // Plantillas v2 (08/11/2026): un juego por marca con papeles (portada, plato, cierre, tipográfica).
  ...PLANTILLAS_CT_EDITORIAL,
  ...PLANTILLAS_TZ_EDITORIAL,
  // Anuncios con flujo propio (12/11/2026): la story del jueves de tapas (no salen en los selectores).
  ...PLANTILLAS_CT_TAPAS,
  // «Solo foto» (12/11/2026): la foto limpia, sin texto; la de por defecto del feed (ct-solo-foto, tz-solo-foto).
  ...PLANTILLAS_SOLO_FOTO,
  // Estilos de las stories que publica hoy Casa Tomás (12/11/2026): rótulos, reseña, Vosotros, anuncios y portadas de destacadas.
  ...PLANTILLAS_CT_ESTILOS,
  // Clásicas (salvo tz-tipografica): se siguen abriendo, pero no salen en los selectores.
  ctFotoTitular,
  ctMarco,
  ctTipografica,
  tzFotoTitular,
  tzMarco,
  tzTipografica,
];

/** Todas las plantillas, ordenadas por id. */
export const PLANTILLAS: readonly Plantilla[] = [...TODAS].sort((a, b) => a.id.localeCompare(b.id));

const POR_ID = new Map(PLANTILLAS.map((p) => [p.id, p]));

/** Plantilla por id, o undefined si no existe (no lanza). */
export function obtenerPlantilla(id: string): Plantilla | undefined {
  return POR_ID.get(id);
}

/** Plantillas de una marca (y, si se pide, que tengan ese formato), ordenadas por id. */
export function plantillasDe(marca: MarcaId, formato?: FormatoId): Plantilla[] {
  return PLANTILLAS.filter((p) => p.marca === marca && (!formato || p.formatos.includes(formato)));
}

/** true si la plantilla es clásica (no sale en los selectores ni la elige la IA). */
export function esClasica(p: Pick<Plantilla, "clasica">): boolean {
  return p.clasica === true;
}

/** Orden de los selectores: por papel, primero a sangre y luego enmarcada, y las sin foto al final de su papel. */
function orden(p: Plantilla): number {
  const papel = p.papel ? PAPELES.indexOf(p.papel) : PAPELES.length;
  const foto = p.admitidos.includes("foto") ? (encajeDe(p) === "sangre" ? 0 : 1) : 2;
  return papel * 10 + foto;
}

/**
 * Plantillas que se ofrecen en los selectores: las de la marca (y formato) que
 * NO son clásicas, por papel. Si se pasa `incluir` (la plantilla que ya tiene
 * la pieza) y es una clásica de esa marca y formato, va al final, para que una
 * pieza guardada con ella se siga viendo bien en el selector.
 */
export function plantillasVisibles(marca: MarcaId, formato?: FormatoId, incluir?: string): Plantilla[] {
  const visibles = plantillasDe(marca, formato)
    // Las de «anuncio» (jueves de tapas) las montan su botón y su automático, no los selectores.
    .filter((p) => !esClasica(p) && p.papel !== "anuncio")
    .sort((a, b) => orden(a) - orden(b) || a.id.localeCompare(b.id));
  const actual = incluir ? obtenerPlantilla(incluir) : undefined;
  if (actual && esClasica(actual) && actual.marca === marca && (!formato || actual.formatos.includes(formato))) visibles.push(actual);
  return visibles;
}

/**
 * Plantilla v2 (no clásica) de la marca con ese papel, formato y encaje, o
 * undefined. Con encaje, solo plantillas con foto; sin él, la primera del papel.
 */
export function plantillaPara(marca: MarcaId, formato: FormatoId, papel: PapelPlantilla, encaje?: EncajeFoto): Plantilla | undefined {
  return plantillasVisibles(marca, formato).find(
    (p) => p.papel === papel && (encaje === undefined || (p.admitidos.includes("foto") && encajeDe(p) === encaje)),
  );
}

/**
 * La misma plantilla con el otro encaje (a sangre ↔ enmarcada): mismo papel y
 * marca, y que tenga ese formato. Las clásicas se emparejan entre sí
 * (ct-foto-titular ↔ ct-marco). undefined si no hay.
 */
export function varianteConEncaje(plantilla: Plantilla, encaje: EncajeFoto, formato: FormatoId): Plantilla | undefined {
  if (plantilla.admitidos.includes("foto") && encajeDe(plantilla) === encaje) return plantilla;
  return plantillasDe(plantilla.marca, formato).find(
    (p) =>
      p.admitidos.includes("foto") &&
      encajeDe(p) === encaje &&
      esClasica(p) === esClasica(plantilla) &&
      (esClasica(p) || p.papel === plantilla.papel),
  );
}

/**
 * Plantilla enmarcada («Foto enmarcada», encaje «marco») de la marca para ese
 * formato, o undefined. Es la que vale para las fotos que no cubren el lienzo
 * (las de la carta, 1200×900 apaisadas). Por defecto la de portada.
 */
export function plantillaEnmarcada(marca: MarcaId, formato: FormatoId, papel: PapelPlantilla = "portada"): Plantilla | undefined {
  return plantillaPara(marca, formato, papel, "marco");
}

/** Comprueba que un objeto cumple el contrato Plantilla. Devuelve la lista de problemas ([] = bien). */
export function problemasDePlantilla(p: unknown): string[] {
  const errores: string[] = [];
  if (!p || typeof p !== "object") return ["no es un objeto plantilla"];
  const o = p as Record<string, unknown>;
  const texto = (k: string) => {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) errores.push(`«${k}» debe ser un texto no vacío`);
  };
  texto("id");
  texto("nombre");
  texto("descripcion");
  if (typeof o.marca !== "string" || !(o.marca in MARCAS)) {
    errores.push(`«marca» debe ser una de: ${Object.keys(MARCAS).join(", ")}`);
  }
  const listaDe = (k: string, validos: readonly string[], vacioOk: boolean) => {
    const v = o[k];
    if (!Array.isArray(v)) {
      errores.push(`«${k}» debe ser una lista`);
      return;
    }
    if (!vacioOk && v.length === 0) errores.push(`«${k}» no puede estar vacía`);
    for (const x of v) if (!validos.includes(x as string)) errores.push(`«${k}» contiene «${String(x)}», que no es válido`);
  };
  listaDe("formatos", Object.keys(FORMATOS), false);
  listaDe("obligatorios", CAMPOS_PIEZA, true);
  listaDe("admitidos", CAMPOS_PIEZA, true);
  if (Array.isArray(o.obligatorios) && Array.isArray(o.admitidos)) {
    const admitidos = o.admitidos as string[];
    for (const c of o.obligatorios as string[]) {
      if (c !== "titular" && !admitidos.includes(c)) errores.push(`el campo obligatorio «${c}» no está en «admitidos»`);
    }
  }
  if (o.limites !== undefined) {
    if (!o.limites || typeof o.limites !== "object") errores.push("«limites» debe ser un objeto");
    else
      for (const [k, v] of Object.entries(o.limites)) {
        if (!CAMPOS_PIEZA.includes(k as CampoPieza)) errores.push(`«limites» tiene el campo desconocido «${k}»`);
        if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) errores.push(`«limites.${k}» debe ser un entero positivo`);
      }
  }
  if (o.titularOpcional !== undefined && typeof o.titularOpcional !== "boolean") {
    errores.push("«titularOpcional» debe ser true o false");
  }
  if (o.titularOpcional === true && Array.isArray(o.admitidos) && !(o.admitidos as string[]).includes("cita")) {
    errores.push("con «titularOpcional» la plantilla debe admitir «cita» (si no, la pieza se quedaría sin texto)");
  }
  if (o.tiposFoto !== undefined && (!Array.isArray(o.tiposFoto) || o.tiposFoto.some((t) => typeof t !== "string"))) {
    errores.push("«tiposFoto» debe ser una lista de textos");
  }
  if (o.encaje !== undefined && o.encaje !== "sangre" && o.encaje !== "marco") errores.push("«encaje» debe ser «sangre» o «marco»");
  if (o.papel !== undefined && !PAPELES.includes(o.papel as PapelPlantilla)) errores.push(`«papel» debe ser uno de: ${PAPELES.join(", ")}`);
  if (o.clasica !== undefined && typeof o.clasica !== "boolean") errores.push("«clasica» debe ser true o false");
  if (o.sinTexto !== undefined && typeof o.sinTexto !== "boolean") errores.push("«sinTexto» debe ser true o false");
  if (o.sinTexto === true && Array.isArray(o.admitidos) && (o.admitidos as string[]).some((c) => c !== "foto")) {
    errores.push("con «sinTexto» la plantilla solo puede admitir «foto»");
  }
  if (o.encaje !== undefined && Array.isArray(o.admitidos) && !(o.admitidos as string[]).includes("foto")) {
    errores.push("«encaje» solo tiene sentido en una plantilla con foto");
  }
  if (typeof o.html !== "function") errores.push("«html» debe ser una función (datos, ctx) => string");
  return errores;
}
