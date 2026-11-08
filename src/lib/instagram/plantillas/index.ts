/**
 * Registro ESTÁTICO de plantillas (en el prototipo se descubrían leyendo la
 * carpeta; aquí no hay fs ni imports dinámicos: funciona en el navegador y en
 * Vercel). Una plantilla nueva = carpeta nueva + una línea en TODAS.
 *
 * problemasDePlantilla() comprueba el contrato de ../tipos.ts; los tests
 * exigen que todas las de PLANTILLAS lo cumplan.
 */
import { FORMATOS, MARCAS, type FormatoId, type MarcaId } from "../tokens.js";
import { CAMPOS_PIEZA, encajeDe, type CampoPieza, type Plantilla } from "../tipos.js";
import ctFotoTitular from "./ct-foto-titular/index.js";
import ctMarco from "./ct-marco/index.js";
import ctTipografica from "./ct-tipografica/index.js";
import tzFotoTitular from "./tz-foto-titular/index.js";
import tzMarco from "./tz-marco/index.js";
import tzTipografica from "./tz-tipografica/index.js";

const TODAS: readonly Plantilla[] = [ctFotoTitular, ctMarco, ctTipografica, tzFotoTitular, tzMarco, tzTipografica];

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

/**
 * Plantilla enmarcada («Foto enmarcada», encaje «marco») de la marca para ese
 * formato, o undefined. Es la que vale para las fotos que no cubren el lienzo
 * (las de la carta, 1200×900 apaisadas).
 */
export function plantillaEnmarcada(marca: MarcaId, formato: FormatoId): Plantilla | undefined {
  return plantillasDe(marca, formato).find((p) => p.admitidos.includes("foto") && encajeDe(p) === "marco");
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
  if (o.encaje !== undefined && Array.isArray(o.admitidos) && !(o.admitidos as string[]).includes("foto")) {
    errores.push("«encaje» solo tiene sentido en una plantilla con foto");
  }
  if (typeof o.html !== "function") errores.push("«html» debe ser una función (datos, ctx) => string");
  return errores;
}
