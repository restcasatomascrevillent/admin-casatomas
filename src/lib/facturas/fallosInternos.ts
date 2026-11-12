import { supabase } from "@/integrations/supabase/client";
import type { AlertaValidacion } from "@/hooks/useFacturas";
import { alertasRelevantes, type ResultadoProcesamiento } from "./colaSubida";

/**
 * Fallos internos para desarrolladores (Telegram, 12/11/2026). PUNTO ÚNICO de envío desde el
 * panel: el RPC `registrar_fallo_interno(tipo, datos, clave)` (migración
 * 20261127100000_fallos_internos_telegram). Otros tipos se añaden a la lista blanca del RPC.
 * Nunca lanza: un fallo al avisar no puede romper lo que el usuario está haciendo.
 */
export type TipoFalloInterno = "albaran_aviso";

// Tabla/RPC sin tipos generados todavía.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function registrarFalloInterno(tipo: TipoFalloInterno, datos: Record<string, unknown>, clave?: string): Promise<void> {
  try {
    const { error } = await db.rpc("registrar_fallo_interno", { p_tipo: tipo, p_datos: datos, p_clave: clave ?? null });
    if (error) console.info("[fallos-internos] no se pudo avisar:", error.message);
  } catch (e) {
    console.info("[fallos-internos] no se pudo avisar:", e);
  }
}

/** Datos del fallo `albaran_aviso`, o null si el resultado no es un albarán con avisos. */
export function falloDeAlbaran(r: ResultadoProcesamiento | undefined): { datos: Record<string, unknown>; clave: string } | null {
  if (!r?.success || r.duplicado || r.tipo !== "albaran" || !r.facturaId) return null;
  const avisos: AlertaValidacion[] = alertasRelevantes(r);
  if (avisos.length === 0) return null;
  const lista = avisos.slice(0, 20).map((a) => ({ codigo: a.codigo, severidad: a.severidad, mensaje: String(a.mensaje ?? "").slice(0, 500) }));
  return {
    datos: { factura_id: r.facturaId, archivo: r.nombre.slice(0, 200), avisos: lista },
    clave: `albaran:${r.facturaId}:${avisos.map((a) => a.codigo).sort().join(",")}`.slice(0, 200),
  };
}

/** Manda al Telegram de desarrolladores los avisos de un albarán recién subido (si los tiene). */
export function avisarFalloAlbaran(r: ResultadoProcesamiento | undefined): void {
  const f = falloDeAlbaran(r);
  if (f) void registrarFalloInterno("albaran_aviso", f.datos, f.clave);
}
