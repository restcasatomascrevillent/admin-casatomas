// ============================================================================
//  Documentos largos: decidir el camino, subir las piezas y esperar el trabajo
// ----------------------------------------------------------------------------
//  Activación AUTOMÁTICA (decisión del dueño, 05-oct-2026, sin botón):
//    · imagen muy alta (troceado.ts: alto/ancho ≥ 1,9 y alto ≥ 1.400 px)
//      → franjas con solape, cada una una pieza del mismo trabajo;
//    · PDF de más de una página → una pieza por página (y franjas si alguna
//      página es muy alta);
//    · todo lo demás → camino síncrono de una página, como siempre.
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
  mime: "application/pdf" | "image/jpeg";
  pieza: "pagina" | "franja";
  pagina_doc: number;
  franja: number | null;
  franjas_pagina: number | null;
}

export type PlanDocumento =
  | { camino: "unico" }
  | { camino: "largo"; origen: "pdf" | "imagen"; piezas: PiezaPreparada[]; paginasDocumento: number };

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

  const mimeOriginal = file.type || "application/octet-stream";
  const original = { path: `${base}/original.${extension(mimeOriginal)}`, mime: mimeOriginal, bytes: file.size };
  await subir(original.path, file, mimeOriginal);
  const piezas = [];
  for (const [i, p] of plan.piezas.entries()) {
    const path = `${base}/${String(i + 1).padStart(2, "0")}.${extension(p.mime)}`;
    await subir(path, p.blob, p.mime);
    piezas.push({
      numero: i + 1, path, mime: p.mime, bytes: p.blob.size,
      pieza: p.pieza, pagina_doc: p.pagina_doc, franja: p.franja, franjas_pagina: p.franjas_pagina,
    });
  }

  const { data, error } = await supabase.functions.invoke("procesar-factura", {
    body: { modo: "iniciar", trabajo_id: trabajoId, nombre: file.name, origen: plan.origen, original, piezas },
  });
  if (error) throw new Error(error.message || "No se pudo iniciar la lectura del documento");
  if (!data?.success) {
    // Una procesar-factura antigua no entiende `modo` y contesta «No se
    // recibió ningún archivo»: todavía no está desplegada la versión nueva.
    if (/no se recibi[oó] ning[uú]n archivo/i.test(String(data?.error))) throw new SinDocumentosLargos(String(data?.error));
    throw new Error(data?.error || "No se pudo iniciar la lectura del documento");
  }
  return { trabajoId, numPiezas: plan.piezas.length };
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

/** Resumen de la factura existente que enseña el diálogo de sustitución. */
export interface Sustituible {
  trabajo_id: string;
  existente: {
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
  };
  nuevo: {
    total: number | null;
    total_origen: string | null;
    lineas: number;
    alertas: number;
    proveedor: string | null;
    fecha: string;
  };
}

/** Sustituye EN SITIO la factura existente por el documento nuevo. */
export async function sustituirExistente(s: Sustituible): Promise<{ message: string; alertas: unknown[] }> {
  const { data, error } = await supabase.functions.invoke("procesar-factura", {
    body: {
      modo: "sustituir",
      factura_id: s.existente.id,
      trabajo_id: s.trabajo_id,
      esperado: { lineas: s.existente.lineas, updated_at: s.existente.updated_at ?? null },
    },
  });
  if (error) {
    // 403 sin permiso de edición: el cuerpo trae el motivo.
    let motivo = error.message;
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx && typeof ctx.json === "function") motivo = (await ctx.json())?.error ?? motivo;
    } catch {
      // se queda el mensaje genérico
    }
    throw new Error(motivo || "No se pudo sustituir la factura");
  }
  if (!data?.success) throw new Error(data?.error || "No se pudo sustituir la factura");
  return { message: data.message, alertas: Array.isArray(data.alertas) ? data.alertas : [] };
}
