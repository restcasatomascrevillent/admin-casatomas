// ============================================================================
//  «Pendientes de decidir»: duplicados que se pueden sustituir.
// ----------------------------------------------------------------------------
//  Los dos caminos guardan el documento leído en ocr_trabajos con
//  estado='duplicado' y resultado.sustituible (procesar-factura:
//  registrarDuplicadoSincrono para el de una página; ocr_terminar_trabajo para
//  el largo). Al sustituir, el trabajo pasa a 'completado' y deja de salir.
//  Así la lista sobrevive a navegar y a RECARGAR la página: se lee de la BD.
//
//  «Dejar la existente» no puede escribir en ocr_trabajos (solo escribe el
//  service role): se recuerda EN ESTE NAVEGADOR (localStorage). Solo se miran
//  los últimos 7 días y los documentos que subió el propio usuario.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { Sustituible } from "./documentoLargo";
import type { ElementoCola } from "./colaSubida";

export const DIAS_PENDIENTES = 7;
export const CLAVE_DESCARTADOS = "facturas.pendientesDescartados";

export interface PendienteDecidir {
  trabajoId: string;
  nombre: string;
  creado: string | null;
  sustituible: Sustituible;
}

const esSustituible = (s: unknown): s is Sustituible => {
  const x = s as Sustituible | null;
  return !!x && typeof x.trabajo_id === "string" && !!x.existente && typeof x.existente.id === "number" && !!x.nuevo;
};

/** Duplicados sustituibles del usuario (últimos 7 días). Sin tabla o sin permiso: []. */
export async function leerPendientesDecidir(usuarioId: string, ahora: number = Date.now()): Promise<PendienteDecidir[]> {
  const desde = new Date(ahora - DIAS_PENDIENTES * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("ocr_trabajos")
    .select("id, nombre_original, resultado, created_at")
    .eq("estado", "duplicado")
    .eq("creado_por", usuarioId)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !Array.isArray(data)) return [];
  const filas = data as unknown as { id: string; nombre_original: string; resultado: { sustituible?: unknown } | null; created_at: string | null }[];
  return filas
    .filter((f) => esSustituible(f.resultado?.sustituible))
    .map((f) => ({
      trabajoId: f.id,
      nombre: f.nombre_original,
      creado: f.created_at,
      sustituible: f.resultado!.sustituible as Sustituible,
    }));
}

/**
 * Lista que se enseña: la de la BD + los duplicados recién terminados en esta
 * carga que la BD aún no ha devuelto (o si la lectura falló), sin los
 * ocultos (descartados o ya sustituidos). Sin repetidos.
 */
export function fusionarPendientes(
  deBd: PendienteDecidir[],
  elementos: ElementoCola[],
  /** Descartados («Dejar la existente») y ya sustituidos en esta carga. */
  ocultos: ReadonlySet<string>,
): PendienteDecidir[] {
  const vistos = new Set<string>();
  const out: PendienteDecidir[] = [];
  const meter = (p: PendienteDecidir) => {
    if (vistos.has(p.trabajoId) || ocultos.has(p.trabajoId)) return;
    vistos.add(p.trabajoId);
    out.push(p);
  };
  for (const e of elementos) {
    const s = e.resultado?.sustituible;
    if (e.fase === "terminado" && e.resultado?.duplicado && esSustituible(s)) {
      meter({ trabajoId: s.trabajo_id, nombre: e.nombre, creado: null, sustituible: s });
    }
  }
  deBd.forEach(meter);
  return out;
}

export function leerDescartados(): Set<string> {
  try {
    const crudo = window.localStorage.getItem(CLAVE_DESCARTADOS);
    const lista = crudo ? JSON.parse(crudo) : [];
    return new Set(Array.isArray(lista) ? lista.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function guardarDescartados(ids: ReadonlySet<string>): void {
  try {
    // Solo los 200 últimos: los de hace más de 7 días ya no salen de la BD.
    window.localStorage.setItem(CLAVE_DESCARTADOS, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Navegación privada o almacenamiento lleno: se olvida al recargar, sin más.
  }
}
