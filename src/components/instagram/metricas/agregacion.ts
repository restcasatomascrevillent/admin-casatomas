/**
 * «Qué funciona mejor»: alcance e interacción medios de las publicaciones por
 * plantilla, por marca y por tipo de foto. Solo cuentan las publicaciones que
 * salieron de una pieza del panel (las demás no tienen plantilla ni foto
 * conocidas). Funciones puras, probadas en __tests__/agregacion.test.ts.
 *
 * Tasa de interacción de un grupo = Σ interacciones / Σ alcance (no la media
 * de las tasas, que daría el mismo peso a una publicación con 10 cuentas que
 * a una con 10 000).
 */
import { FOTOS, NOMBRE_TIPO_FOTO, buscarFoto, type Foto, type TipoFoto } from "@/lib/instagram/fotos";
import { MARCAS, type MarcaId } from "@/lib/instagram/tokens";
import { obtenerPlantilla } from "@/lib/instagram/plantillas/index";
import type { Publicacion } from "./tipos";

export interface GrupoRendimiento {
  clave: string;
  etiqueta: string;
  publicaciones: number;
  alcanceMedio: number | null;
  interaccionesMedias: number | null;
  /** % (1 decimal). */
  tasaInteraccion: number | null;
}

export interface QueFuncionaMejor {
  porPlantilla: GrupoRendimiento[];
  porMarca: GrupoRendimiento[];
  porTipoFoto: GrupoRendimiento[];
  /** Publicaciones con pieza del panel que entran en la cuenta. */
  conPieza: number;
  /** Publicaciones que no salieron del panel (no se agrupan). */
  sinPieza: number;
}

/** Interacciones de una publicación: las de Meta o, si no hay, la suma de su desglose. */
export function interaccionesDe(p: Pick<Publicacion, "interacciones" | "meGusta" | "comentarios" | "guardados" | "compartidos">): number | null {
  if (typeof p.interacciones === "number") return p.interacciones;
  const partes = [p.meGusta, p.comentarios, p.guardados, p.compartidos].filter((x): x is number => typeof x === "number");
  return partes.length ? partes.reduce((a, b) => a + b, 0) : null;
}

/** Tasa de interacción (%) de una publicación. */
export function tasaDe(p: Publicacion): number | null {
  const i = interaccionesDe(p);
  if (i === null || !p.alcance) return null;
  return Math.round((i / p.alcance) * 1000) / 10;
}

/** Tipo de foto: el que trae la función (fotos subidas) o el del catálogo estático. */
export function tipoFotoDe(p: Pick<Publicacion, "tipoFoto" | "foto">, fotos: readonly Foto[] = FOTOS): TipoFoto | null {
  const t = p.tipoFoto ?? (p.foto ? buscarFoto(p.foto, fotos)?.tipo : undefined) ?? null;
  return t && t in NOMBRE_TIPO_FOTO ? (t as TipoFoto) : null;
}

export function nombrePlantilla(id: string): string {
  return obtenerPlantilla(id)?.nombre ?? id;
}

export function nombreMarca(id: string): string {
  return MARCAS[id as MarcaId]?.nombre ?? id;
}

export function nombreTipoFoto(id: string): string {
  return NOMBRE_TIPO_FOTO[id as TipoFoto] ?? id;
}

const media = (suma: number, n: number) => (n > 0 ? Math.round(suma / n) : null);

/** Agrupa y ordena por alcance medio (de más a menos). */
export function agrupar(
  pubs: readonly Publicacion[],
  claveDe: (p: Publicacion) => string | null,
  etiquetaDe: (clave: string) => string,
): GrupoRendimiento[] {
  const grupos = new Map<string, { n: number; nAlc: number; alc: number; nInt: number; int: number; alcConInt: number; intConAlc: number }>();
  for (const p of pubs) {
    const clave = claveDe(p);
    if (!clave) continue;
    const g = grupos.get(clave) ?? { n: 0, nAlc: 0, alc: 0, nInt: 0, int: 0, alcConInt: 0, intConAlc: 0 };
    g.n++;
    const i = interaccionesDe(p);
    if (typeof p.alcance === "number") {
      g.nAlc++;
      g.alc += p.alcance;
    }
    if (i !== null) {
      g.nInt++;
      g.int += i;
    }
    if (typeof p.alcance === "number" && i !== null) {
      g.alcConInt += p.alcance;
      g.intConAlc += i;
    }
    grupos.set(clave, g);
  }
  return [...grupos.entries()]
    .map(([clave, g]) => ({
      clave,
      etiqueta: etiquetaDe(clave),
      publicaciones: g.n,
      alcanceMedio: media(g.alc, g.nAlc),
      interaccionesMedias: media(g.int, g.nInt),
      tasaInteraccion: g.alcConInt > 0 ? Math.round((g.intConAlc / g.alcConInt) * 1000) / 10 : null,
    }))
    .sort((a, b) => (b.alcanceMedio ?? -1) - (a.alcanceMedio ?? -1) || a.etiqueta.localeCompare(b.etiqueta, "es"));
}

export function queFuncionaMejor(pubs: readonly Publicacion[], fotos: readonly Foto[] = FOTOS): QueFuncionaMejor {
  const conPieza = pubs.filter((p) => p.piezaId && p.marca);
  return {
    porPlantilla: agrupar(conPieza, (p) => p.plantilla, nombrePlantilla),
    porMarca: agrupar(conPieza, (p) => p.marca, nombreMarca),
    porTipoFoto: agrupar(conPieza, (p) => tipoFotoDe(p, fotos), nombreTipoFoto),
    conPieza: conPieza.length,
    sinPieza: pubs.length - conPieza.length,
  };
}

const NUMERO = new Intl.NumberFormat("es-ES");
const DECIMAL = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

export function formatearNumero(n: number | null | undefined): string {
  return typeof n === "number" ? NUMERO.format(n) : "—";
}

export function formatearPorcentaje(n: number | null | undefined): string {
  return typeof n === "number" ? `${DECIMAL.format(n)} %` : "—";
}

/** «+12,5 %», «−3 %», «=» o «—» (sin base). */
export function textoVariacion(v: number | null | undefined): string {
  if (typeof v !== "number") return "—";
  if (v === 0) return "= 0 %";
  return `${v > 0 ? "+" : "−"}${DECIMAL.format(Math.abs(v))} %`;
}

/** Ordena las publicaciones: recientes primero o por alcance. */
export function ordenarPublicaciones(pubs: readonly Publicacion[], orden: "recientes" | "alcance"): Publicacion[] {
  const copia = [...pubs];
  if (orden === "alcance") return copia.sort((a, b) => (b.alcance ?? -1) - (a.alcance ?? -1));
  return copia.sort((a, b) => (b.publicadoAt ?? "").localeCompare(a.publicadoAt ?? ""));
}
