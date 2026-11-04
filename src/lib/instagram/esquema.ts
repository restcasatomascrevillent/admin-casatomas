/**
 * Validación del JSON de una pieza contra su plantilla y el catálogo de fotos.
 * Portado del prototipo instagram-studio (src/esquema.ts, 04/11/2026), con las
 * MISMAS reglas, pero SÍNCRONO y sin lanzar: devuelve
 *   { ok: true, datos } | { ok: false, problemas }   (TODOS los problemas, en español).
 *
 * Titular y cita: el titular tiene como máximo 6 palabras (regla de marca); la
 * cita (lema) no tiene límite de palabras, solo el de caracteres de la
 * plantilla. El titular es obligatorio salvo en plantillas con titularOpcional,
 * que piden al menos uno de los dos.
 *
 * Se usa zod 4 (subruta "zod/v4" del paquete zod 3.25 del repo) para que los
 * mensajes salgan idénticos a los del prototipo.
 */
import { z } from "zod/v4";
import { FORMATOS, MARCAS, type FormatoId } from "./tokens.js";
import { AMPLIACION_MAXIMA, FOTOS, escalaParaCubrir, type Foto } from "./fotos.js";
import { PLANTILLAS, obtenerPlantilla } from "./plantillas/index.js";
import type { CampoPieza, DatosPieza, ElementoLista, Plantilla } from "./tipos.js";

export const MAX_PALABRAS_TITULAR = 6;

const texto = z.string().trim();

export const EsquemaElementoLista = z.strictObject({
  etiqueta: texto.min(1),
  valor: texto.min(1).optional(),
});

export const EsquemaPieza = z.strictObject({
  marca: z.enum(["casa-tomas", "touza"]),
  plantilla: texto.min(1),
  formato: z.enum(["post", "story"]),
  foto: texto.min(1).optional(),
  antetitulo: texto.min(1).optional(),
  // Opcional en la forma; si es obligatorio lo decide la plantilla
  // (titularOpcional) en problemasDePieza / problemaTitularAusente.
  titular: texto.min(1).optional(),
  cita: texto.min(1).optional(),
  cta: texto.min(1).optional(),
  lista: z.array(EsquemaElementoLista).min(1).optional(),
  pie: texto.min(1).optional(),
  numeral: texto.min(1).optional(),
});
/** Forma del JSON de entrada (lo que guarda la UI en instagram_piezas.datos). */
export type EntradaPieza = z.infer<typeof EsquemaPieza>;

/**
 * Resultado de validarPieza. Las dos ramas declaran las dos claves (la que no
 * toca, como undefined) para que `r.problemas` / `r.datos` se puedan leer
 * también con strictNullChecks apagado (tsconfig.app.json), donde `if (r.ok)`
 * no estrecha la unión.
 */
export type ResultadoValidacion =
  | { ok: true; datos: DatosPieza; problemas?: undefined }
  | { ok: false; problemas: string[]; datos?: undefined };

// ── Reglas sueltas ───────────────────────────────────────────────────────────

/** Palabras del titular: se separa por espacios; «·» y guiones sueltos no cuentan. */
export function contarPalabras(t: string): number {
  return t.split(/\s+/u).filter((p) => p.length > 0 && !/^[·•\-‐‑‒–—―|/]+$/u.test(p)).length;
}

/**
 * Emojis: cualquier carácter Extended_Pictographic, selector de variación
 * emoji (U+FE0F), indicadores regionales (banderas) o modificadores de tono.
 * Excepción: ©, ® y ™ en su forma de texto (sin U+FE0F), que son tipografía.
 */
const RE_EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]/gu;
export function emojisEn(t: string): string[] {
  const hallados: string[] = [];
  for (const m of t.matchAll(RE_EMOJI)) {
    const c = m[0];
    const siguiente = t[(m.index ?? 0) + c.length];
    if ("©®™".includes(c) && siguiente !== "\u{FE0F}") continue;
    if (c === "\u{FE0F}") continue; // ya se informa del carácter al que acompaña
    hallados.push(c);
  }
  return hallados;
}

// ── Formateo de errores de zod ───────────────────────────────────────────────

function ruta(p: readonly PropertyKey[]): string {
  return p.map((x, i) => (typeof x === "number" ? `[${x}]` : i === 0 ? String(x) : `.${String(x)}`)).join("");
}

function problemaZod(issue: z.core.$ZodIssue, entrada: unknown): string {
  const campo = ruta(issue.path);
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys
        .map((k) => `Campo desconocido «${campo ? `${campo}.` : ""}${k}» (campos válidos: ${Object.keys(EsquemaPieza.shape).join(", ")})`)
        .join("\n");
    case "invalid_type": {
      // ¿falta el campo o tiene otro tipo?
      let valor: unknown = entrada;
      for (const k of issue.path) valor = valor && typeof valor === "object" ? (valor as Record<PropertyKey, unknown>)[k] : undefined;
      if (valor === undefined) return campo ? `Falta el campo obligatorio «${campo}»` : "La pieza debe ser un objeto JSON";
      const tipo =
        issue.expected === "string" ? "un texto" : issue.expected === "array" ? "una lista" : issue.expected === "object" ? "un objeto" : issue.expected;
      return campo ? `«${campo}» debe ser ${tipo}` : "La pieza debe ser un objeto JSON";
    }
    case "invalid_value":
      return `«${campo}» debe ser uno de: ${issue.values.map(String).join(", ")}`;
    case "too_small":
      return issue.origin === "array" ? `«${campo}» no puede ser una lista vacía (quítala si no se usa)` : `«${campo}» está vacío (quítalo si no se usa)`;
    default:
      return `«${campo || "pieza"}»: ${issue.message}`;
  }
}

// ── Validación completa ──────────────────────────────────────────────────────

export interface OpcionesValidacion {
  /** Resolver de plantillas (por defecto, el registro PLANTILLAS). */
  buscarPlantilla?: (id: string) => Plantilla | undefined;
  /** Catálogo de fotos (por defecto, FOTOS). */
  fotos?: readonly Foto[];
}

const CAMPOS_OPCIONALES: readonly CampoPieza[] = ["foto", "antetitulo", "cita", "cta", "lista", "pie", "numeral"];
const TEXTOS: ReadonlyArray<Exclude<CampoPieza, "lista">> = ["foto", "antetitulo", "titular", "cita", "cta", "pie", "numeral"];

/**
 * Problema si la pieza no trae titular: en plantillas normales falta un campo
 * obligatorio; con titularOpcional basta la cita (hace falta uno de los dos).
 */
function problemaTitularAusente(d: { titular?: unknown; cita?: unknown }, plantilla: Plantilla | undefined): string | undefined {
  if (d.titular !== undefined) return undefined;
  if (plantilla?.titularOpcional) {
    if (d.cita !== undefined) return undefined;
    return `La plantilla «${plantilla.id}» necesita un «titular» o una «cita» (al menos uno de los dos)`;
  }
  return "Falta el campo obligatorio «titular»";
}

/** Problemas de una pieza ya parseada respecto a su plantilla y al catálogo. */
export function problemasDePieza(d: EntradaPieza, plantilla: Plantilla | undefined, fotos: readonly Foto[], disponibles: readonly string[] = []): string[] {
  const p: string[] = [];

  // Titular (máx. 6 palabras). La cita no tiene límite de palabras.
  const ausente = problemaTitularAusente(d, plantilla);
  if (ausente) p.push(ausente);
  if (d.titular !== undefined) {
    const palabras = contarPalabras(d.titular);
    if (palabras > MAX_PALABRAS_TITULAR) {
      p.push(`El titular tiene ${palabras} palabras; máximo ${MAX_PALABRAS_TITULAR} («${d.titular}»)`);
    }
  }

  // Emojis en cualquier campo
  const revisar: Array<[string, string]> = [];
  for (const c of TEXTOS) {
    const v = d[c];
    if (v !== undefined) revisar.push([c, v]);
  }
  d.lista?.forEach((e, i) => {
    revisar.push([`lista[${i}].etiqueta`, e.etiqueta]);
    if (e.valor !== undefined) revisar.push([`lista[${i}].valor`, e.valor]);
  });
  for (const [c, v] of revisar) {
    const em = emojisEn(v);
    if (em.length) p.push(`El campo «${c}» lleva emojis (${em.join(" ")}): no se admiten`);
  }

  // Plantilla
  if (!plantilla) {
    p.push(`La plantilla «${d.plantilla}» no existe${disponibles.length ? `. Disponibles: ${disponibles.join(", ")}` : ""}`);
  } else {
    if (plantilla.marca !== d.marca) {
      p.push(`La plantilla «${plantilla.id}» es de ${MARCAS[plantilla.marca].nombre} y la pieza es de ${MARCAS[d.marca].nombre}`);
    }
    if (!plantilla.formatos.includes(d.formato)) {
      p.push(`La plantilla «${plantilla.id}» no tiene formato ${d.formato} (sí: ${plantilla.formatos.join(", ")})`);
    }
    for (const c of plantilla.obligatorios) {
      if (d[c] === undefined) p.push(`La plantilla «${plantilla.id}» necesita el campo «${c}»`);
    }
    for (const c of CAMPOS_OPCIONALES) {
      if (d[c] !== undefined && !plantilla.admitidos.includes(c)) p.push(`La plantilla «${plantilla.id}» no usa el campo «${c}»: quítalo`);
    }
    for (const [c, max] of Object.entries(plantilla.limites ?? {}) as Array<[CampoPieza, number]>) {
      const v = d[c];
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        if (v.length > max) p.push(`«${c}» tiene ${v.length} elementos; la plantilla «${plantilla.id}» admite ${max} como máximo`);
      } else if ([...v].length > max) {
        p.push(`«${c}» tiene ${[...v].length} caracteres; máximo ${max} en «${plantilla.id}»`);
      }
    }
  }

  // Foto
  if (d.foto !== undefined) {
    const foto = fotos.find((f) => f.id === d.foto);
    if (!foto) {
      p.push(`La foto «${d.foto}» no está en el catálogo de fotos`);
    } else {
      if (foto.marca !== d.marca) {
        p.push(`La foto «${foto.id}» es de ${MARCAS[foto.marca].nombre}; una pieza solo puede usar fotos de su marca (${MARCAS[d.marca].nombre})`);
      }
      // Sin tipo (foto de Drive sin clasificar): vale para cualquier plantilla.
      if (plantilla?.tiposFoto && foto.tipo && !plantilla.tiposFoto.includes(foto.tipo)) {
        p.push(`La foto «${foto.id}» es de tipo «${foto.tipo}» y la plantilla «${plantilla.id}» solo admite: ${plantilla.tiposFoto.join(", ")}`);
      }
      const f = FORMATOS[d.formato as FormatoId];
      const escala = escalaParaCubrir(foto.ancho, foto.alto, f.ancho, f.alto);
      if (escala > AMPLIACION_MAXIMA) {
        p.push(
          `La foto «${foto.id}» (${foto.ancho}×${foto.alto}) tendría que ampliarse un ${Math.round((escala - 1) * 100)} % para cubrir un ${d.formato} de ${f.ancho}×${f.alto} (máximo ${Math.round((AMPLIACION_MAXIMA - 1) * 100)} %)`,
        );
      }
    }
  }
  return p;
}

/**
 * Quita las claves undefined. Sin titular (solo posible si la plantilla tiene
 * titularOpcional y llega cita) → titular "".
 */
function aDatos(d: EntradaPieza): DatosPieza {
  const datos: DatosPieza = { marca: d.marca, plantilla: d.plantilla, formato: d.formato, titular: d.titular ?? "" };
  if (d.foto !== undefined) datos.foto = d.foto;
  if (d.antetitulo !== undefined) datos.antetitulo = d.antetitulo;
  if (d.cita !== undefined) datos.cita = d.cita;
  if (d.cta !== undefined) datos.cta = d.cta;
  if (d.pie !== undefined) datos.pie = d.pie;
  if (d.numeral !== undefined) datos.numeral = d.numeral;
  if (d.lista !== undefined) {
    datos.lista = d.lista.map((e) => {
      const el: ElementoLista = { etiqueta: e.etiqueta };
      if (e.valor !== undefined) el.valor = e.valor;
      return el;
    });
  }
  return datos;
}

/**
 * Valida el JSON de una pieza. Devuelve los datos limpios (con trim) o la
 * lista de TODOS los problemas. Síncrona; no lanza.
 */
export function validarPieza(json: unknown, opciones: OpcionesValidacion = {}): ResultadoValidacion {
  const buscar = opciones.buscarPlantilla ?? obtenerPlantilla;
  const r = EsquemaPieza.safeParse(json);
  if (!r.success) {
    const problemas = r.error.issues.flatMap((i) => problemaZod(i, json).split("\n"));
    // Aunque la forma falle, se dan también los problemas de contenido más
    // útiles (titular ausente, palabras del titular y emojis) si se puede.
    const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    // Titular ausente: depende de la plantilla (titularOpcional), si se conoce.
    if (json && typeof json === "object" && !Array.isArray(json) && o.titular === undefined) {
      const pl = typeof o.plantilla === "string" ? buscar(o.plantilla) : undefined;
      const ausente = problemaTitularAusente(o, pl);
      if (ausente && !problemas.includes(ausente)) problemas.push(ausente);
    }
    if (typeof o.titular === "string" && contarPalabras(o.titular) > MAX_PALABRAS_TITULAR) {
      problemas.push(`El titular tiene ${contarPalabras(o.titular)} palabras; máximo ${MAX_PALABRAS_TITULAR}`);
    }
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && emojisEn(v).length) problemas.push(`El campo «${k}» lleva emojis (${emojisEn(v).join(" ")}): no se admiten`);
    }
    return { ok: false, problemas };
  }
  const d = r.data;
  const plantilla = buscar(d.plantilla);
  const disponibles = plantilla || opciones.buscarPlantilla ? [] : PLANTILLAS.map((x) => x.id);
  const problemas = problemasDePieza(d, plantilla, opciones.fotos ?? FOTOS, disponibles);
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, datos: aDatos(d) };
}
