// ============================================================================
//  originalesDrive.ts · Pasar a Google Drive lo que quede en Storage
// ----------------------------------------------------------------------------
//  Lo usa la Edge Function facturas-originales-drive (pg_cron cada 10 min y,
//  a mano, el rescate de lo antiguo). Idempotente y por lotes:
//    1. Facturas con archivo_path:
//       - sin drive_url → sube el original a Drive (proveedor → mes), guarda
//         drive_url, borra de Storage y deja archivo_path a null;
//       - con drive_url → la copia de Storage sobra: se borra (salvo que sea
//         el original de una PÁGINA AÑADIDA, «{id}-pagN-…», que se sube antes);
//       - Drive falla → facturas_original_drive_fallo (aviso a los 5).
//    2. Huérfanos (ficheros fuera de pendientes/ que ninguna factura usa:
//       originales de documentos sustituidos, páginas añadidas…): a Drive
//       («anterior-…») y se borran.
//    3. pendientes/ de trabajos de OCR terminados o fallidos: se borran.
//  Nunca procesa dos veces lo mismo en una llamada (un Drive caído no gasta
//  los 5 intentos de golpe).
// ============================================================================

import {
  type ConfigDrive,
  esOriginalDePagina,
  marcarPendienteDrive,
  mimeDeNombre,
  nombreEnDrive,
  STORAGE_BUCKET,
  subirADrive,
} from "./archivo.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface FacturaPorPasar {
  id: number;
  archivo_path: string;
  drive_url: string | null;
  fecha: string | null;
  proveedor: string | null;
  drive_intentos?: number | null;
  existe: boolean;
}

export interface HuerfanoPorPasar {
  name: string;
  bytes?: number | null;
  factura_id: number | null;
  fecha: string | null;
  proveedor: string | null;
  /** La factura no tiene original y este fichero es el suyo: se le pone como drive_url. */
  es_su_original?: boolean | null;
}

export interface PorPasar {
  facturas: FacturaPorPasar[];
  huerfanos: HuerfanoPorPasar[];
  pendientes: string[];
}

export interface InformeDrive {
  facturas: { subidas: number; copias_borradas: number; sin_fichero: number; errores: { id: number; error: string }[] };
  huerfanos: { subidos: number; errores: { name: string; error: string }[] };
  pendientes: { borrados: number; errores: string[] };
  /** true si se paró por tiempo y queda trabajo. */
  quedan: boolean;
}

export function informeVacio(): InformeDrive {
  return {
    facturas: { subidas: 0, copias_borradas: 0, sin_fichero: 0, errores: [] },
    huerfanos: { subidos: 0, errores: [] },
    pendientes: { borrados: 0, errores: [] },
    quedan: false,
  };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function descargar(supabase: Supa, path: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download ${path}: ${error?.message ?? "sin datos"}`);
  return { bytes: new Uint8Array(await data.arrayBuffer()), mime: mimeDeNombre(path, data.type) };
}

async function borrar(supabase: Supa, paths: string[]): Promise<void> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) throw new Error(`Storage remove: ${error.message}`);
}

/** Una factura con archivo_path. Devuelve qué pasó (o lanza con el error). */
export async function pasarFactura(
  supabase: Supa,
  drive: ConfigDrive,
  f: FacturaPorPasar,
): Promise<"subida" | "copia_borrada" | "sin_fichero"> {
  const path = f.archivo_path;
  if (!f.existe) {
    // El fichero ya no está: se quita la referencia rota.
    const cambios: Record<string, unknown> = { archivo_path: null };
    if (!f.drive_url) cambios.drive_error = `el original ya no estaba en Storage (${path})`;
    const { error } = await supabase.from("facturas").update(cambios).eq("id", f.id).eq("archivo_path", path);
    if (error) throw new Error(`update factura ${f.id}: ${error.message}`);
    return "sin_fichero";
  }
  const subir = !f.drive_url || esOriginalDePagina(path);
  if (subir) {
    try {
      const { bytes, mime } = await descargar(supabase, path);
      const url = await subirADrive(drive, bytes, nombreEnDrive(path), mime, f.fecha, f.proveedor);
      if (!f.drive_url) {
        const { error } = await supabase.from("facturas")
          .update({ drive_url: url, drive_intentos: 0, drive_error: null, drive_intento_at: null })
          .eq("id", f.id).eq("archivo_path", path);
        if (error) throw new Error(`update factura ${f.id}: ${error.message}`);
      }
    } catch (e) {
      await marcarPendienteDrive(supabase, f.id, msg(e));
      throw e;
    }
  }
  // Ya está en Drive: la copia de Storage sobra.
  await borrar(supabase, [path]);
  const { error } = await supabase.from("facturas")
    .update({ archivo_path: null, drive_intentos: 0, drive_error: null, drive_intento_at: null })
    .eq("id", f.id).eq("archivo_path", path);
  if (error) throw new Error(`update factura ${f.id}: ${error.message}`);
  return subir ? "subida" : "copia_borrada";
}

/**
 * Un fichero huérfano: a Drive y fuera de Storage. Si es el original de una
 * factura que se quedó sin ninguno, se le apunta como drive_url; si no, va a
 * Drive como «anterior-…» (original de un documento sustituido).
 */
export async function pasarHuerfano(supabase: Supa, drive: ConfigDrive, h: HuerfanoPorPasar): Promise<void> {
  const { bytes, mime } = await descargar(supabase, h.name);
  const base = nombreEnDrive(h.name);
  const nombre = h.name.startsWith("temporal/") || h.es_su_original ? base : `anterior-${base}`;
  const url = await subirADrive(drive, bytes, nombre, mime, h.fecha, h.proveedor);
  if (h.es_su_original && h.factura_id) {
    const { error } = await supabase.from("facturas").update({ drive_url: url })
      .eq("id", h.factura_id).is("drive_url", null).is("archivo_path", null);
    if (error) throw new Error(`update factura ${h.factura_id}: ${error.message}`);
  }
  await borrar(supabase, [h.name]);
}

export interface OpcionesLote {
  supabase: Supa;
  drive: ConfigDrive;
  /** Filas por consulta (por defecto 15). */
  limite?: number;
  /** Tiempo máximo de la llamada en ms (por defecto 100 s; la Edge Function corta a 150 s). */
  presupuestoMs?: number;
  ahora?: () => number;
}

/** Pasa a Drive / limpia lotes hasta acabar o agotar el tiempo. */
export async function pasarLote(o: OpcionesLote): Promise<InformeDrive> {
  const { supabase, drive } = o;
  const limite = o.limite ?? 15;
  const ahora = o.ahora ?? Date.now;
  const fin = ahora() + (o.presupuestoMs ?? 100_000);
  const informe = informeVacio();
  const vistas = new Set<string>();

  for (let vuelta = 0; vuelta < 200; vuelta++) {
    const { data, error } = await supabase.rpc("facturas_originales_por_pasar", { p_limite: limite });
    if (error) throw new Error(`facturas_originales_por_pasar: ${error.message}`);
    const lote = (data ?? { facturas: [], huerfanos: [], pendientes: [] }) as PorPasar;
    const facturas = (lote.facturas ?? []).filter((f) => !vistas.has(`f${f.id}`));
    const huerfanos = (lote.huerfanos ?? []).filter((h) => !vistas.has(`h${h.name}`));
    const pendientes = (lote.pendientes ?? []).filter((p) => !vistas.has(`p${p}`));
    if (facturas.length + huerfanos.length + pendientes.length === 0) return informe;

    for (const f of facturas) {
      if (ahora() > fin) return { ...informe, quedan: true };
      vistas.add(`f${f.id}`);
      try {
        const r = await pasarFactura(supabase, drive, f);
        if (r === "subida") informe.facturas.subidas++;
        else if (r === "copia_borrada") informe.facturas.copias_borradas++;
        else informe.facturas.sin_fichero++;
      } catch (e) {
        informe.facturas.errores.push({ id: f.id, error: msg(e).slice(0, 300) });
      }
    }
    for (const h of huerfanos) {
      if (ahora() > fin) return { ...informe, quedan: true };
      vistas.add(`h${h.name}`);
      try {
        await pasarHuerfano(supabase, drive, h);
        informe.huerfanos.subidos++;
      } catch (e) {
        informe.huerfanos.errores.push({ name: h.name, error: msg(e).slice(0, 300) });
      }
    }
    for (let i = 0; i < pendientes.length; i += 100) {
      const trozo = pendientes.slice(i, i + 100);
      trozo.forEach((p) => vistas.add(`p${p}`));
      try {
        await borrar(supabase, trozo);
        informe.pendientes.borrados += trozo.length;
      } catch (e) {
        informe.pendientes.errores.push(msg(e).slice(0, 300));
      }
    }
    if (ahora() > fin) return { ...informe, quedan: true };
  }
  return { ...informe, quedan: true };
}
