// ============================================================================
//  Documentos largos: decidir el camino, subir las piezas y esperar el trabajo
// ----------------------------------------------------------------------------
//  Activación AUTOMÁTICA (decisión del dueño, 05-oct-2026, sin botón):
//    · imagen muy alta (troceado.ts: alto/ancho ≥ 1,9 y alto ≥ 1.400 px)
//      → franjas con solape, cada una una pieza del mismo trabajo;
//    · PDF de más de una página → una pieza por página (y franjas si alguna
//      página es muy alta);
//    · todo lo demás (una página) → desde el 05-oct-2026 TAMBIÉN un trabajo
//      en el servidor, de una sola pieza (iniciarDocumentoUnico), leído con
//      el mismo código que el camino síncrono; el síncrono queda de respaldo
//      si el servidor aún no admite trabajos de una pieza.
//  Las piezas se suben a facturas-originales/pendientes/{uid}/{trabajo}/ y
//  procesar-factura {modo:"iniciar"} crea el trabajo; ocr-trabajo lo lee en
//  segundo plano y aquí se sondea ocr_trabajos cada 3 s (Realtime no está
//  publicado para estas tablas).
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { debeTrocear, dimensionesImagen, trocearImagen } from "./troceado";
import { analizarPdf, dividirPdf } from "./dividirPdf";

export const BUCKET = "facturas-originales";
export const SONDEO_MS = 3000;
/** Un poco más que el límite del trabajo en el servidor (15 min). */
export const ESPERA_MAX_MS = 16 * 60 * 1000;
export const ESTADOS_TERMINALES = ["completado", "duplicado", "fallido", "cancelado"] as const;

export interface PiezaPreparada {
  blob: Blob;
  mime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  pieza: "pagina" | "franja";
  pagina_doc: number;
  franja: number | null;
  franjas_pagina: number | null;
}

export type PlanDocumento =
  | { camino: "unico" }
  | {
    camino: "largo";
    origen: "pdf" | "imagen";
    piezas: PiezaPreparada[];
    paginasDocumento: number;
    /** Original que se archiva. Sin el campo: el fichero subido; `null`: ninguno (fotos unidas sin PDF). */
    original?: File | null;
  };

/** Decide el camino de un fichero y, si es largo, lo trocea. */
export async function planificarDocumento(file: File): Promise<PlanDocumento> {
  if (file.type === "application/pdf") {
    const buf = await file.arrayBuffer();
    const info = await analizarPdf(buf);
    if (info.paginas <= 1 && !info.alguna_alta) return { camino: "unico" };
    const d = await dividirPdf(buf);
    if (d.piezas.length < 2) return { camino: "unico" };
    return {
      camino: "largo",
      origen: "pdf",
      paginasDocumento: d.numPaginas,
      piezas: d.piezas.map((p) => ({
        blob: new Blob([p.bytes], { type: "application/pdf" }),
        mime: "application/pdf",
        pieza: p.franja ? "franja" : "pagina",
        pagina_doc: p.pagina,
        franja: p.franja,
        franjas_pagina: p.franjasPagina,
      })),
    };
  }
  if (!file.type.startsWith("image/")) return { camino: "unico" };
  const { ancho, alto } = await dimensionesImagen(file);
  if (!debeTrocear(ancho, alto)) return { camino: "unico" };
  const t = await trocearImagen(file);
  if (t.franjas.length < 2) return { camino: "unico" };
  return {
    camino: "largo",
    origen: "imagen",
    paginasDocumento: 1,
    piezas: t.franjas.map((f) => ({
      blob: f.blob,
      mime: "image/jpeg",
      pieza: "franja",
      pagina_doc: 1,
      franja: f.franja.indice,
      franjas_pagina: t.franjas.length,
    })),
  };
}

const extension = (mime: string) =>
  mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

export interface InicioDocumentoLargo {
  trabajoId: string;
  numPiezas: number;
}

/** Error que indica que el servidor aún no tiene el OCR de documentos largos
 *  (migración o función sin desplegar): el panel cae al camino de siempre. */
export class SinDocumentosLargos extends Error {}

/**
 * Sube el original y las piezas y crea el trabajo. `onProgreso(subidas, total)`.
 */
export async function iniciarDocumentoLargo(
  file: File,
  plan: Extract<PlanDocumento, { camino: "largo" }>,
  onProgreso?: (subidas: number, total: number) => void,
): Promise<InicioDocumentoLargo> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) throw new Error("Sesión caducada: vuelve a entrar en el panel.");
  const trabajoId = crypto.randomUUID();
  const base = `pendientes/${uid}/${trabajoId}`;
  const total = plan.piezas.length + 1;
  let subidas = 0;

  const subir = async (path: string, blob: Blob, mime: string) => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
    if (error) {
      // Sin la política facturas_originales_pendientes_insert (migración sin
      // aplicar) Storage responde 403 / «row-level security».
      if (/row-level security|policy|unauthorized|403/i.test(error.message)) throw new SinDocumentosLargos(error.message);
      throw new Error(`No se pudo subir ${path.split("/").pop()}: ${error.message}`);
    }
    onProgreso?.(++subidas, total);
  };

  // Fotos unidas como un documento: el original es un PDF hecho con ellas
  // (o ninguno si no se pudo hacer: se archiva la primera pieza).
  const ficheroOriginal = plan.original === undefined ? file : plan.original;
  let original: { path: string; mime: string; bytes: number } | null = null;
  if (ficheroOriginal) {
    const mimeOriginal = ficheroOriginal.type || "application/octet-stream";
    original = { path: `${base}/original.${extension(mimeOriginal)}`, mime: mimeOriginal, bytes: ficheroOriginal.size };
    await subir(original.path, ficheroOriginal, mimeOriginal);
  } else {
    onProgreso?.(++subidas, total);
  }
  const piezas = [];
  for (const [i, p] of plan.piezas.entries()) {
    const path = `${base}/${String(i + 1).padStart(2, "0")}.${extension(p.mime)}`;
    await subir(path, p.blob, p.mime);
    piezas.push({
      numero: i + 1, path, mime: p.mime, bytes: p.blob.size,
      pieza: p.pieza, pagina_doc: p.pagina_doc, franja: p.franja, franjas_pagina: p.franjas_pagina,
    });
  }

  await crearTrabajo({ modo: "iniciar", trabajo_id: trabajoId, nombre: file.name, origen: plan.origen, original, piezas });
  return { trabajoId, numPiezas: plan.piezas.length };
}

/** procesar-factura {modo:"iniciar"}: crea el trabajo en el servidor. */
async function crearTrabajo(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("procesar-factura", { body });
  if (error) throw new Error(error.message || "No se pudo iniciar la lectura del documento");
  if (!data?.success) {
    const motivo = String(data?.error ?? "");
    // Una procesar-factura antigua no entiende `modo` y contesta «No se
    // recibió ningún archivo»; la de los documentos largos sin trabajos de
    // una pieza contesta «Un documento de una sola pieza va por el camino
    // normal»: todavía no está desplegada la versión nueva.
    if (/no se recibi[oó] ning[uú]n archivo|una sola pieza va por el camino normal/i.test(motivo)) {
      throw new SinDocumentosLargos(motivo);
    }
    throw new Error(data?.error || "No se pudo iniciar la lectura del documento");
  }
}

/**
 * Documento de UNA página en segundo plano (05-oct-2026): se sube el fichero
 * tal cual como pieza única (que es también el original) y el servidor lo lee
 * con el mismo código que el camino síncrono, sin que haga falta tener la
 * pestaña abierta. Si el servidor aún no lo admite → SinDocumentosLargos y la
 * cola cae al camino síncrono.
 */
export async function iniciarDocumentoUnico(
  file: File,
  onProgreso?: (subidas: number, total: number) => void,
): Promise<InicioDocumentoLargo> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) throw new Error("Sesión caducada: vuelve a entrar en el panel.");
  const trabajoId = crypto.randomUUID();
  const mime = file.type || "application/octet-stream";
  const path = `pendientes/${uid}/${trabajoId}/01.${extension(mime)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (error) {
    if (/row-level security|policy|unauthorized|403/i.test(error.message)) throw new SinDocumentosLargos(error.message);
    throw new Error(`No se pudo subir ${file.name}: ${error.message}`);
  }
  onProgreso?.(1, 1);
  const pieza = { path, mime, bytes: file.size };
  await crearTrabajo({
    modo: "iniciar",
    trabajo_id: trabajoId,
    nombre: file.name,
    origen: mime === "application/pdf" ? "pdf" : "imagen",
    original: pieza,
    piezas: [{ numero: 1, ...pieza, pieza: "pagina", pagina_doc: 1, franja: null, franjas_pagina: null }],
  });
  return { trabajoId, numPiezas: 1 };
}

export interface EstadoTrabajo {
  id: string;
  estado: string;
  num_paginas: number;
  nombre_original: string;
  error: string | null;
  resultado: Record<string, unknown> | null;
  factura_id: number | null;
  updated_at: string;
  created_at?: string;
  ocr_trabajo_paginas?: {
    numero: number;
    estado: string;
    intentos: number;
    relecturas: number;
    filas_extraidas: number | null;
    filas_contadas: number | null;
    error: string | null;
  }[];
}

export const SELECT_TRABAJO =
  "id, estado, num_paginas, nombre_original, error, resultado, factura_id, updated_at, created_at, " +
  "ocr_trabajo_paginas(numero, estado, intentos, relecturas, filas_extraidas, filas_contadas, error)";

export async function leerTrabajo(id: string): Promise<EstadoTrabajo | null> {
  const { data, error } = await supabase.from("ocr_trabajos").select(SELECT_TRABAJO).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as EstadoTrabajo | null) ?? null;
}

export function esTerminal(estado: string | undefined | null): boolean {
  return !!estado && (ESTADOS_TERMINALES as readonly string[]).includes(estado);
}

/** Texto corto del progreso: «Leyendo 3 de 5 trozos…». */
export function describirProgreso(t: EstadoTrabajo | null): string {
  if (!t) return "Preparando…";
  const ps = t.ocr_trabajo_paginas ?? [];
  const hechas = ps.filter((p) => p.estado === "completada" || p.estado === "fallida").length;
  if (t.num_paginas === 1) {
    // Documento de una página leído en segundo plano.
    switch (t.estado) {
      case "pendiente":
        return "En cola…";
      case "pagina1":
        return ps[0]?.intentos && ps[0].intentos > 1 ? "Leyendo el documento (reintento)…" : "Leyendo el documento…";
      case "paginas":
      case "consolidando":
        return "Comprobando importes y guardando…";
      default:
        return t.estado;
    }
  }
  switch (t.estado) {
    case "pendiente":
      return "En cola…";
    case "pagina1":
      return `Leyendo el trozo 1 de ${t.num_paginas}…`;
    case "paginas":
      return `Leídos ${hechas} de ${t.num_paginas} trozos…`;
    case "consolidando":
      return "Uniendo los trozos y comprobando importes…";
    default:
      return t.estado;
  }
}

/** Sondea el trabajo hasta un estado terminal (o hasta ESPERA_MAX_MS). */
export async function esperarTrabajo(
  id: string,
  onCambio?: (t: EstadoTrabajo | null) => void,
  opciones: { sondeoMs?: number; esperaMaxMs?: number; dormir?: (ms: number) => Promise<void> } = {},
): Promise<EstadoTrabajo> {
  const sondeo = opciones.sondeoMs ?? SONDEO_MS;
  const max = opciones.esperaMaxMs ?? ESPERA_MAX_MS;
  const dormir = opciones.dormir ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const t0 = Date.now();
  let ultimo: EstadoTrabajo | null = null;
  for (;;) {
    try {
      ultimo = await leerTrabajo(id);
      onCambio?.(ultimo);
      if (ultimo && esTerminal(ultimo.estado)) return ultimo;
    } catch {
      // Un fallo de red puntual no corta la espera.
    }
    if (Date.now() - t0 > max) {
      throw new Error(
        "El documento sigue procesándose en segundo plano. Aparecerá en la lista cuando termine; " +
          "puedes cerrar esta pantalla.",
      );
    }
    await dormir(sondeo);
  }
}


// ── Fotos unidas como UN documento (revisión del 10/10/2026) ────────────────

/** Imágenes que se pueden unir como páginas de un documento. */
export const MIMES_UNIBLES = ["image/jpeg", "image/png", "image/webp"];
/** Como mucho, páginas por documento (lo que acepta el servidor). */
export const MAX_PAGINAS_UNIDAS = 20;

/**
 * Varias fotos = UN documento de varias páginas (cada foto, su página; las
 * muy altas, en franjas). Va por el camino de documento largo con
 * `paginas_documento` = nº de fotos. El original que se archiva es un PDF con
 * todas las fotos (si se puede hacer y pesa menos de 10 MB).
 */
export async function planificarGrupo(
  fotos: File[],
  opciones: { hacerPdf?: (fotos: File[]) => Promise<File | null> } = {},
): Promise<Extract<PlanDocumento, { camino: "largo" }>> {
  if (fotos.length < 2) throw new Error("Para unir hacen falta al menos dos fotos");
  if (fotos.length > MAX_PAGINAS_UNIDAS) throw new Error(`Como mucho ${MAX_PAGINAS_UNIDAS} páginas por documento`);
  const piezas: PiezaPreparada[] = [];
  for (const [i, f] of fotos.entries()) {
    if (!MIMES_UNIBLES.includes(f.type)) throw new Error(`${f.name} no es una foto (solo se unen imágenes)`);
    let franjas: { blob: Blob }[] = [];
    try {
      const { ancho, alto } = await dimensionesImagen(f);
      if (debeTrocear(ancho, alto)) franjas = (await trocearImagen(f)).franjas;
    } catch {
      // Sin canvas (o imagen rara): la foto va entera.
    }
    if (franjas.length >= 2) {
      franjas.forEach((fr, k) =>
        piezas.push({
          blob: fr.blob, mime: "image/jpeg", pieza: "franja", pagina_doc: i + 1, franja: k + 1, franjas_pagina: franjas.length,
        }),
      );
    } else {
      piezas.push({
        blob: f, mime: f.type as PiezaPreparada["mime"], pieza: "pagina", pagina_doc: i + 1, franja: null, franjas_pagina: null,
      });
    }
  }
  let original: File | null = null;
  try {
    original = await (opciones.hacerPdf ?? pdfDeFotos)(fotos);
  } catch (err) {
    console.warn("[unir-fotos] no se pudo hacer el PDF del original:", err);
  }
  if (original && original.size > 10 * 1024 * 1024) original = null;
  return { camino: "largo", origen: "imagen", piezas, paginasDocumento: fotos.length, original };
}

/** PDF con una foto por página (reducidas a 1.800 px y JPEG 0,8 para no pasar de 10 MB). */
export async function pdfDeFotos(fotos: File[]): Promise<File | null> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const f of fotos) {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    try {
      const escala = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * escala);
      canvas.height = Math.round(bmp.height * escala);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((ok, ko) =>
        canvas.toBlob((b) => (b ? ok(b) : ko(new Error("No se pudo codificar la foto"))), "image/jpeg", 0.8),
      );
      const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const pag = pdf.addPage([img.width, img.height]);
      pag.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } finally {
      bmp.close();
    }
  }
  const bytes = await pdf.save();
  const base = fotos[0].name.replace(/\.[^.]+$/, "");
  return new File([bytes], `${base}-${fotos.length}pag.pdf`, { type: "application/pdf" });
}

// ── Duplicados: sustituir o añadir como página ──────────────────────────────

/** Resumen de la factura existente que enseñan los diálogos. */
export interface ResumenExistente {
  id: number;
  numero_documento: string;
  proveedor: string | null;
  fecha: string | null;
  total: number | null;
  total_origen: string | null;
  lineas: number;
  alertas: number;
  alertas_graves: number;
  updated_at?: string | null;
  paginas?: number | null;
  paginas_lineas?: number[] | null;
  trabajo_pendiente?: boolean | null;
}

export interface ResumenNuevo {
  total: number | null;
  total_origen: string | null;
  lineas: number;
  alertas: number;
  proveedor: string | null;
  fecha: string;
}

/** Duplicado que se puede SUSTITUIR por el documento nuevo. */
export interface Sustituible {
  trabajo_id: string;
  existente: ResumenExistente;
  nuevo: ResumenNuevo;
}

/** Otra página de un documento que ya existe: se ofrece AÑADIRLA (nunca sustituir). */
export interface Anadible {
  trabajo_id: string;
  existente: ResumenExistente;
  pagina: { actual: number; total: number };
  nuevo: ResumenNuevo;
}

/** Lo que el usuario ve y confirma: el estado de la existente en ese momento. */
export interface Esperado {
  lineas: number;
  updated_at: string | null;
}

/**
 * Relee la factura existente al abrir el aviso (no la «foto vieja» de cuando
 * se detectó el duplicado). `null` si el servidor aún no tiene la RPC.
 */
export async function leerResumenFactura(id: number): Promise<ResumenExistente | null> {
  const { data, error } = await supabase.rpc("ocr_resumen_factura" as never, { p_factura_id: id } as never);
  if (error) {
    console.warn("[duplicados] ocr_resumen_factura (¿migración sin aplicar?):", error.message);
    return null;
  }
  const r = data as unknown as (ResumenExistente & { total: number | string | null }) | null;
  if (!r || typeof r.id !== "number") return null;
  return { ...r, total: r.total === null || r.total === undefined ? null : Number(r.total) };
}

/** ¿Se puede sustituir/añadir ahora? El motivo si no. */
export function motivoBloqueo(
  e: Pick<ResumenExistente, "lineas" | "trabajo_pendiente">,
  operacion: "sustituir" | "anadir",
): string | null {
  if (e.trabajo_pendiente) return "La factura que ya existe aún se está guardando. Espera a que termine y vuelve a abrir este aviso.";
  if (operacion === "sustituir" && !(e.lineas > 0)) {
    return "La factura que ya existe no tiene líneas todavía (puede que aún se esté guardando): no se ofrece sustituirla.";
  }
  return null;
}

/** El servidor abortó porque la factura cambió (o seguía guardándose). */
export class FacturaCambiada extends Error {}

export const MENSAJE_FACTURA_CAMBIADA = "La factura ha cambiado: revisa los datos y confirma de nuevo.";

const RE_CAMBIO = /ha cambiado desde que la viste|se ha modificado|tiene ahora|no tiene l[ií]neas|a[uú]n se est[aá] (leyendo|guardando)/i;

async function invocarDecision(body: Record<string, unknown>, porDefecto: string) {
  const { data, error } = await supabase.functions.invoke("procesar-factura", { body });
  if (error) {
    // 403 sin permiso de edición: el cuerpo trae el motivo.
    let motivo = error.message;
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx && typeof ctx.json === "function") motivo = (await ctx.json())?.error ?? motivo;
    } catch {
      // se queda el mensaje genérico
    }
    throw new Error(motivo || porDefecto);
  }
  if (!data?.success) {
    const motivo = String(data?.error || porDefecto);
    if (RE_CAMBIO.test(motivo)) throw new FacturaCambiada(`${MENSAJE_FACTURA_CAMBIADA} (${motivo.replace(/^No se ha (sustituido|añadido) nada: /, "")})`);
    throw new Error(motivo);
  }
  return { message: String(data.message ?? ""), alertas: Array.isArray(data.alertas) ? data.alertas : [] };
}

/** Sustituye EN SITIO la factura existente por el documento nuevo. `esperado`: lo que el usuario acaba de ver. */
export async function sustituirExistente(s: Sustituible, esperado?: Esperado): Promise<{ message: string; alertas: unknown[] }> {
  return invocarDecision(
    {
      modo: "sustituir",
      factura_id: s.existente.id,
      trabajo_id: s.trabajo_id,
      esperado: esperado ?? { lineas: s.existente.lineas, updated_at: s.existente.updated_at ?? null },
    },
    "No se pudo sustituir la factura",
  );
}

/** Añade el documento nuevo como página x de la factura existente (sin borrar nada). */
export async function anadirComoPagina(a: Anadible, esperado?: Esperado): Promise<{ message: string; alertas: unknown[] }> {
  return invocarDecision(
    {
      modo: "anadir_pagina",
      factura_id: a.existente.id,
      trabajo_id: a.trabajo_id,
      esperado: esperado ?? { lineas: a.existente.lineas, updated_at: a.existente.updated_at ?? null },
    },
    "No se pudo añadir la página",
  );
}
