// ============================================================================
//  Importación histórica de facturas (Facturas › Cargar › Importación histórica)
// ----------------------------------------------------------------------------
//  Facturas YA extraídas a JSON (facturas-conocimiento) + su PDF, sin volver a
//  pasar el OCR. El usuario elige una CARPETA con:
//
//    manifest.json   [{ clave, json: "json/x.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1, 2] }],
//                       proveedor, total, fecha, local, indice? }]
//    json/…          una factura por fichero, o un array (se elige por `indice`
//                    o por el «#n» del final de la clave)
//    pdf/…           los PDF originales
//
//  Por cada entrada se monta un PDF con SOLO sus páginas (pueden venir de uno
//  o varios PDF), se pasa a base64 y se manda a la Edge Function
//  `importar-factura-historica`, de una en una. Reanudar es seguro: la función
//  responde «ya_importada» si la clave ya está.
//  pdf-lib se carga con import() dinámico (como dividirPdf.ts).
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { leerErrorFuncion, MENSAJE_SIN_CONEXION, RE_TECNICO_INGLES } from "./documentoLargo";

/**
 * JSON.parse con el error en español («manifest.json no es un JSON válido…»)
 * en vez del técnico en inglés («Expected property name or '}'…»).
 */
export function parsearJson(texto: string, nombre: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(
      `${nombre} no es un JSON válido: revisa que no le falten comillas, comas o corchetes (ábrelo con un editor de texto).`,
    );
  }
}

/** Mensaje de un fallo inesperado: el suyo si está en español; si no, uno genérico. */
const mensajeEs = (e: unknown, porDefecto: string) => {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return MENSAJE_SIN_CONEXION;
  return m && !RE_TECNICO_INGLES.test(m) ? m : porDefecto;
};

export interface PaginasManifiesto {
  pdf: string;
  pages: number[];
}

export interface EntradaManifiesto {
  clave: string;
  json: string;
  paginas: PaginasManifiesto[];
  proveedor: string | null;
  total: number | null;
  fecha: string | null;
  local: string | null;
  /** Posición dentro del JSON si este es un array (opcional). */
  indice?: number | null;
}

export type EstadoImportacion = "pendiente" | "procesando" | "importada" | "ya_importada" | "duplicado" | "error";

/** Estados que no se vuelven a intentar al reanudar. */
export const ESTADOS_FINALES: ReadonlySet<EstadoImportacion> = new Set(["importada", "ya_importada", "duplicado"]);

export interface ResultadoImportacion {
  estado: Exclude<EstadoImportacion, "pendiente" | "procesando">;
  facturaId: number | null;
  mensaje: string;
}

/** Ruta relativa a la carpeta elegida, con «/» y sin «./». */
export function normalizarRuta(r: string): string {
  return r.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/{2,}/g, "/");
}

/**
 * Ficheros de la carpeta indexados por ruta relativa a la carpeta del
 * manifest.json (con webkitdirectory cada File trae «Carpeta/json/x.json»).
 */
export function indexarCarpeta(ficheros: ArrayLike<File>): { manifiesto: File | null; porRuta: Map<string, File> } {
  const lista = Array.from(ficheros);
  const ruta = (f: File) => normalizarRuta((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
  const candidatos = lista
    .filter((f) => /(^|\/)manifest\.json$/i.test(ruta(f)))
    .sort((a, b) => ruta(a).split("/").length - ruta(b).split("/").length);
  const manifiesto = candidatos[0] ?? null;
  const base = manifiesto ? ruta(manifiesto).replace(/manifest\.json$/i, "") : "";
  const porRuta = new Map<string, File>();
  for (const f of lista) {
    const r = ruta(f);
    if (base && !r.startsWith(base)) continue;
    porRuta.set(r.slice(base.length), f);
  }
  return { manifiesto, porRuta };
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/**
 * Importe del manifiesto: número, o texto con punto («88.10») o con coma
 * decimal española («88,10», «1.234,56»).
 */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let t = v.trim().replace(/\s|€/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Valida el manifest.json. Lanza con la primera entrada mal formada. */
export function leerManifiesto(json: unknown): EntradaManifiesto[] {
  if (!Array.isArray(json)) throw new Error("manifest.json tiene que ser una lista");
  const claves = new Set<string>();
  return json.map((e, i) => {
    const pos = `Entrada ${i + 1}`;
    if (!e || typeof e !== "object") throw new Error(`${pos}: no es un objeto`);
    const o = e as Record<string, unknown>;
    const clave = texto(o.clave);
    if (!clave) throw new Error(`${pos}: falta «clave»`);
    if (claves.has(clave)) throw new Error(`${pos}: la clave «${clave}» está repetida`);
    claves.add(clave);
    const rutaJson = texto(o.json);
    if (!rutaJson) throw new Error(`${pos} (${clave}): falta «json»`);
    if (!Array.isArray(o.paginas) || o.paginas.length === 0) throw new Error(`${pos} (${clave}): faltan «paginas»`);
    const paginas = o.paginas.map((p, j) => {
      const q = (p ?? {}) as Record<string, unknown>;
      const pdf = texto(q.pdf);
      const pages = Array.isArray(q.pages) ? q.pages.filter((n): n is number => Number.isInteger(n) && (n as number) > 0) : [];
      if (!pdf || pages.length === 0) throw new Error(`${pos} (${clave}): «paginas[${j}]» necesita pdf y pages`);
      return { pdf: normalizarRuta(pdf), pages };
    });
    return {
      clave,
      json: normalizarRuta(rutaJson),
      paginas,
      proveedor: texto(o.proveedor),
      total: num(o.total),
      fecha: texto(o.fecha),
      local: texto(o.local),
      indice: Number.isInteger(o.indice) ? (o.indice as number) : null,
    };
  });
}

/** La factura de esta entrada dentro del JSON (objeto, o elemento de un array). */
export function elegirFactura(json: unknown, entrada: Pick<EntradaManifiesto, "clave" | "indice">): Record<string, unknown> {
  if (json && typeof json === "object" && !Array.isArray(json)) return json as Record<string, unknown>;
  if (!Array.isArray(json)) throw new Error("El JSON no es una factura");
  const m = entrada.clave.match(/#(\d+)$/);
  const i = entrada.indice ?? (m ? Number(m[1]) : json.length === 1 ? 0 : null);
  if (i === null) throw new Error(`El JSON trae ${json.length} facturas y la entrada no dice cuál (añade «indice» o «#n» a la clave)`);
  const f = json[i];
  if (!f || typeof f !== "object" || Array.isArray(f)) throw new Error(`El JSON no tiene la factura nº ${i}`);
  return f as Record<string, unknown>;
}

/** Bytes → base64 por trozos (un PDF de varios MB revienta `String.fromCharCode(...bytes)`). */
export function bytesABase64(bytes: Uint8Array): string {
  let bin = "";
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + TROZO)));
  }
  return btoa(bin);
}

type LectorPdf = (ruta: string) => Promise<Uint8Array>;

/**
 * PDF de UNA factura con solo sus páginas, en el orden del manifiesto.
 * `cache` guarda los PDF de origen ya cargados (un PDF suele traer varias).
 */
export async function construirPdf(
  paginas: PaginasManifiesto[],
  leer: LectorPdf,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: Map<string, any> = new Map(),
): Promise<{ bytes: Uint8Array; numPaginas: number }> {
  const { PDFDocument } = await import("pdf-lib");
  const nuevo = await PDFDocument.create();
  for (const p of paginas) {
    let origen = cache.get(p.pdf);
    if (!origen) {
      origen = await PDFDocument.load(await leer(p.pdf), { ignoreEncryption: true, updateMetadata: false });
      cache.set(p.pdf, origen);
    }
    const n = origen.getPageCount();
    const fuera = p.pages.filter((x) => x > n);
    if (fuera.length > 0) throw new Error(`${p.pdf} tiene ${n} página(s); no existe la ${fuera.join(", ")}`);
    const copias = await nuevo.copyPages(origen, p.pages.map((x) => x - 1));
    copias.forEach((c) => nuevo.addPage(c));
  }
  return { bytes: await nuevo.save(), numPaginas: nuevo.getPageCount() };
}

/** Nombre del PDF en Drive: «2026-03-14 A26-1234 (R1000).pdf». */
export function nombrePdf(entrada: Pick<EntradaManifiesto, "paginas" | "fecha">, factura: Record<string, unknown>): string {
  const base = (entrada.paginas[0]?.pdf.split("/").pop() ?? "factura.pdf").replace(/\.pdf$/i, "");
  const numero = texto(factura.numero_documento) ?? (typeof factura.numero_documento === "number" ? String(factura.numero_documento) : null);
  const fecha = texto(factura.fecha) ?? entrada.fecha;
  const partes = [fecha, numero, `(${base})`].filter(Boolean).join(" ");
  return `${partes.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150)}.pdf`;
}

/** Llamada a la Edge Function. Nunca lanza: los fallos vuelven como estado «error». */
export async function enviarFactura(cuerpo: {
  clave: string;
  datos: Record<string, unknown>;
  pdf_b64: string;
  nombre_pdf: string;
  local: string | null;
  paginas: number;
}): Promise<ResultadoImportacion> {
  try {
    const { data, error } = await supabase.functions.invoke("importar-factura-historica", { body: cuerpo });
    if (error) {
      // FunctionsHttpError: el cuerpo trae { error } (401/403) o { mensaje }; si
      // no es JSON (p. ej. un 500/502 en HTML), un texto en español por código.
      return { estado: "error", facturaId: null, mensaje: await leerErrorFuncion(error, "No se pudo importar la factura") };
    }
    const estado = data?.estado;
    if (estado === "importada" || estado === "ya_importada" || estado === "duplicado" || estado === "error") {
      return { estado, facturaId: typeof data.facturaId === "number" ? data.facturaId : null, mensaje: String(data.mensaje ?? "") };
    }
    return { estado: "error", facturaId: null, mensaje: "Respuesta inesperada del servidor" };
  } catch (e) {
    return { estado: "error", facturaId: null, mensaje: mensajeEs(e, "No se pudo importar la factura") };
  }
}

/** Lee un fichero de la carpeta como texto o bytes (lanza si no está). */
export function lectorCarpeta(porRuta: Map<string, File>) {
  const fichero = (r: string) => {
    const f = porRuta.get(normalizarRuta(r));
    if (!f) throw new Error(`No está en la carpeta: ${r}`);
    return f;
  };
  return {
    texto: (r: string) => fichero(r).text(),
    bytes: async (r: string) => new Uint8Array(await fichero(r).arrayBuffer()),
  };
}

/**
 * Prepara y manda UNA entrada: lee su JSON, monta su PDF y llama a la función.
 * Los fallos de preparación (fichero que falta, página que no existe) vuelven
 * como «error» con su mensaje.
 */
export async function importarEntrada(
  entrada: EntradaManifiesto,
  lector: ReturnType<typeof lectorCarpeta>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cachePdf: Map<string, any>,
  enviar: typeof enviarFactura = enviarFactura,
): Promise<ResultadoImportacion> {
  let cuerpo: Parameters<typeof enviarFactura>[0];
  // Los PDF de origen se reutilizan entre entradas seguidas, sin acumular todos.
  if (cachePdf.size > 8 && !entrada.paginas.every((p) => cachePdf.has(p.pdf))) cachePdf.clear();
  try {
    const factura = elegirFactura(parsearJson(await lector.texto(entrada.json), entrada.json), entrada);
    const pdf = await construirPdf(entrada.paginas, lector.bytes, cachePdf);
    cuerpo = {
      clave: entrada.clave,
      datos: factura,
      pdf_b64: bytesABase64(pdf.bytes),
      nombre_pdf: nombrePdf(entrada, factura),
      local: entrada.local,
      paginas: pdf.numPaginas,
    };
  } catch (e) {
    // PDF dañado o cifrado (pdf-lib lanza en inglés): se dice en español.
    return { estado: "error", facturaId: null, mensaje: mensajeEs(e, "No se pudo preparar el PDF de esta factura (¿está dañado o protegido?)") };
  }
  return enviar(cuerpo);
}
