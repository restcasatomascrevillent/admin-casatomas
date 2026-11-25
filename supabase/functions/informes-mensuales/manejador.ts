// ============================================================================
//  informes-mensuales · lógica (sin Deno.env: los tests la llaman directa)
// ----------------------------------------------------------------------------
//  25/11/2026, petición del dueño: «una tarea programada cada mes el último
//  jueves del mes que me saque los informes del apartado de informes en PDF,
//  me saque el recibo mensual de gestor de gasto». La tarea (workflow de
//  GitHub «Informes mensuales», scripts/informes-mensuales.mjs) saca los PDF
//  con el propio panel y los sube aquí, uno a uno, a Google Drive con la
//  cuenta del restaurante (los mismos secretos GOOGLE_* que las facturas).
//
//    POST { accion: "subir", mes: "AAAA-MM", nombre: "x.pdf", pdf_b64 }
//      → { ok: true, id, url, carpeta_id, carpeta_url, reemplazado }
//
//  Carpeta: INFORMES_DRIVE_CARPETA_ID (si existe) o, si no,
//  GOOGLE_DRIVE_PARENT_FOLDER_ID › «Informes mensuales» (en la demo,
//  «Informes mensuales (demo)») › «2026-11 Noviembre». Si ya hay un PDF con ese
//  nombre en la carpeta del mes, se cambia su contenido (mismo enlace): volver
//  a lanzar la tarea no duplica nada.
//
//  Autenticación: SUPER ADMIN con su JWT (el usuario de servicio del panel con
//  el que entra la tarea). No escribe en la base de datos.
// ============================================================================

import { ClienteDrive, ErrorDrive, esIdDrive } from "../_shared/google-drive.ts";
import type { ResultadoAutorizacion } from "../_shared/autorizacion.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Un informe en PDF con muchas diapositivas pesa unos MB; más es casi seguro un error. */
export const MAX_BYTES = 40 * 1024 * 1024;

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** «2026-11» → «2026-11 Noviembre» (como las carpetas de las facturas). null si no es un mes. */
export function carpetaDelMes(mes: unknown): string | null {
  if (typeof mes !== "string") return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes);
  return m ? `${mes} ${MESES[Number(m[2]) - 1]}` : null;
}

/** Nombre de PDF aceptable: sin rutas ni caracteres raros, acabado en .pdf. */
export function nombreValido(nombre: unknown): nombre is string {
  return typeof nombre === "string" && nombre.length <= 150 && /^[\p{L}\p{N} ._()-]+\.pdf$/u.test(nombre) && !nombre.startsWith(".");
}

export const urlFichero = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const urlCarpeta = (id: string) => `https://drive.google.com/drive/folders/${id}`;

export interface ConfigInformesDrive {
  /** El usuario tiene que ser super admin (exigirSuperAdmin). */
  autorizar: (req: Request) => Promise<ResultadoAutorizacion>;
  drive: Pick<ClienteDrive, "configurado" | "asegurarRuta" | "buscarEnCarpeta" | "subir" | "reemplazar">;
  /** INFORMES_DRIVE_CARPETA_ID: carpeta raíz de los informes, si se quiere una concreta. */
  carpetaInformes?: string;
  /** GOOGLE_DRIVE_PARENT_FOLDER_ID: sin la anterior, se crea dentro «Informes mensuales». */
  carpetaPadre?: string;
  /** false en la demo: la carpeta se llama «Informes mensuales (demo)». */
  produccion: boolean;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const error = (msg: string, status: number) => json({ ok: false, error: msg }, status);

function aBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
const esPdf = (b: Uint8Array) => b.length > 5 && String.fromCharCode(...b.subarray(0, 5)) === "%PDF-";

/** Raíz y tramos de carpeta hasta la del mes. null si Drive no tiene dónde guardar. */
export function rutaInformes(cfg: Pick<ConfigInformesDrive, "carpetaInformes" | "carpetaPadre" | "produccion">, mes: string): { raiz: string; tramos: string[] } | null {
  const carpeta = carpetaDelMes(mes);
  if (!carpeta) return null;
  const propia = (cfg.carpetaInformes ?? "").trim();
  if (esIdDrive(propia)) return { raiz: propia, tramos: [carpeta] };
  const padre = (cfg.carpetaPadre ?? "").trim();
  if (!esIdDrive(padre)) return null;
  return { raiz: padre, tramos: [cfg.produccion ? "Informes mensuales" : "Informes mensuales (demo)", carpeta] };
}

export function crearManejador(cfg: ConfigInformesDrive): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return error("Solo POST", 405);
    const quien = await cfg.autorizar(req);
    if (!quien.ok) return quien.response;

    let cuerpo: Record<string, unknown>;
    try {
      cuerpo = await req.json();
    } catch {
      return error("El cuerpo no es un JSON válido", 400);
    }
    if (cuerpo?.accion !== "subir") return error("Acción desconocida (subir)", 400);
    const { mes, nombre, pdf_b64 } = cuerpo;
    if (!carpetaDelMes(mes)) return error("mes tiene que ser AAAA-MM", 400);
    if (!nombreValido(nombre)) return error("nombre no válido (letras, números, espacios, . _ ( ) - y acabado en .pdf)", 400);
    if (typeof pdf_b64 !== "string" || !pdf_b64) return error("Falta pdf_b64", 400);
    const bytes = aBytes(pdf_b64);
    if (!bytes || !esPdf(bytes)) return error(`«${nombre}» no es un PDF válido`, 400);
    if (bytes.length > MAX_BYTES) return error(`«${nombre}» pasa de ${MAX_BYTES / 1024 / 1024} MB`, 413);

    if (!cfg.drive.configurado) return error("Drive no configurado (faltan los secretos GOOGLE_*)", 503);
    const ruta = rutaInformes(cfg, mes as string);
    if (!ruta) return error("Drive no configurado (falta GOOGLE_DRIVE_PARENT_FOLDER_ID o INFORMES_DRIVE_CARPETA_ID)", 503);

    try {
      const carpeta = await cfg.drive.asegurarRuta(ruta.raiz, ruta.tramos);
      const previo = (await cfg.drive.buscarEnCarpeta(carpeta, nombre)).find((f) => f.name === nombre);
      const descripcion = `Informe del panel de Casa Tomás · ${mes} · tarea programada`;
      const f = previo
        ? await cfg.drive.reemplazar(previo.id, nombre, "application/pdf", bytes, descripcion)
        : await cfg.drive.subir(carpeta, nombre, "application/pdf", bytes, descripcion);
      console.log(`[informes-mensuales] usuario:${quien.userId} · ${mes} · ${nombre} · ${previo ? "reemplazado" : "nuevo"} · ${bytes.length} B`);
      return json({ ok: true, id: f.id, url: urlFichero(f.id), carpeta_id: carpeta, carpeta_url: urlCarpeta(carpeta), reemplazado: !!previo });
    } catch (e) {
      const msg = e instanceof ErrorDrive || e instanceof Error ? e.message : String(e);
      console.error(`[informes-mensuales] ${mes} · ${nombre}: ${msg}`);
      return error(`No se pudo subir a Drive: ${msg}`, 502);
    }
  };
}
