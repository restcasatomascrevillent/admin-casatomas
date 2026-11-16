// ============================================================================
//  subir-original-drive · lógica (sin Deno.env: los tests la llaman directa)
// ----------------------------------------------------------------------------
//  Sube a Google Drive, con la cuenta del restaurante, el PDF de UNA factura
//  del histórico y devuelve su enlace. NO escribe en la base de datos: los
//  enlaces se guardan en local (drive_ids.json) y se meten después en
//  facturas.drive_url con un único SQL. Así no se carga la BD de producción
//  factura a factura (16/11/2026).
//
//    IN : { pdf_b64, nombre_pdf, fecha, proveedor }   (POST, JSON)
//    OUT: { ok: true, drive_url, ya_estaba }  ·  { ok: false, error }
//
//  Carpeta: GOOGLE_DRIVE_PARENT_FOLDER_ID › proveedor › «2025-03 Marzo», igual
//  que procesar-factura (subirADrive). Si ya hay un fichero con ese nombre en
//  esa carpeta, devuelve su enlace sin subir nada (reanudar sin duplicados).
//
//  Autenticación: cabecera `x-subida-token` == secreto SUBIDA_DRIVE_TOKEN
//  (tiempo constante). Sin el secreto → 503 (falla cerrado). Mal → 401.
// ============================================================================

import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { type ConfigDrive, driveActivo, subirADriveSiNoEsta } from "../procesar-factura/archivo.ts";

export interface ConfigSubida {
  /** Secreto SUBIDA_DRIVE_TOKEN (undefined/vacío si no está puesto). */
  token: string | undefined;
  drive: ConfigDrive;
  subir?: typeof subirADriveSiNoEsta;
}

/** Un PDF de un histórico cabe de sobra; más grande es casi seguro un error. */
export const MAX_BYTES = 25 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

export function crearManejador(cfg: ConfigSubida): (req: Request) => Promise<Response> {
  const subir = cfg.subir ?? subirADriveSiNoEsta;
  return async (req) => {
    const secreto = (cfg.token ?? "").trim();
    if (!secreto) return error("Subida no configurada (falta el secreto SUBIDA_DRIVE_TOKEN)", 503);
    if (!compararTiempoConstante(req.headers.get("x-subida-token") ?? "", secreto)) return error("No autorizado", 401);
    if (req.method !== "POST") return error("Solo POST", 405);
    if (!driveActivo(cfg.drive)) return error("Drive no configurado (faltan los secretos GOOGLE_*)", 503);

    let cuerpo: Record<string, unknown>;
    try {
      cuerpo = await req.json();
    } catch {
      return error("El cuerpo no es un JSON válido", 400);
    }
    const { pdf_b64, nombre_pdf, fecha, proveedor } = cuerpo ?? {};
    if (typeof pdf_b64 !== "string" || !pdf_b64) return error("Falta pdf_b64", 400);
    if (typeof nombre_pdf !== "string" || !nombre_pdf.trim() || nombre_pdf.length > 200) return error("Falta nombre_pdf (o es demasiado largo)", 400);
    if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return error("fecha tiene que ser AAAA-MM-DD", 400);
    if (proveedor !== null && proveedor !== undefined && typeof proveedor !== "string") return error("proveedor tiene que ser texto", 400);
    const bytes = aBytes(pdf_b64);
    if (!bytes || !esPdf(bytes)) return error(`«${nombre_pdf}» no es un PDF válido`, 400);
    if (bytes.length > MAX_BYTES) return error(`«${nombre_pdf}» pasa de ${MAX_BYTES / 1024 / 1024} MB`, 413);

    try {
      const r = await subir(cfg.drive, bytes, nombre_pdf.trim(), "application/pdf", fecha, (proveedor as string | null) ?? null);
      return json({ ok: true, drive_url: r.url, ya_estaba: r.yaEstaba });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[subir-original-drive] ${nombre_pdf}:`, msg);
      // 502: el fallo es de Drive; el script lo reintenta con pausa.
      return error(msg.slice(0, 500), 502);
    }
  };
}
