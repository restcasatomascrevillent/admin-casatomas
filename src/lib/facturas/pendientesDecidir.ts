// ============================================================================
//  «Pendientes de decidir»: duplicados que se pueden sustituir.
// ----------------------------------------------------------------------------
//  Los dos caminos guardan el documento leído en ocr_trabajos con
//  estado='duplicado' y resultado.sustituible (procesar-factura:
//  registrarDuplicadoSincrono para el de una página; ocr_terminar_trabajo para
//  el largo). Al sustituir, el trabajo pasa a 'completado' y deja de salir.
//  Así la lista sobrevive a navegar y a RECARGAR la página: se lee de la BD.
//
//  «Dejar la existente» (05/11/2026): llama a la RPC ocr_descartar_trabajo,
//  que pasa el trabajo a «cancelado» (deja de salir en todos los navegadores y
//  el servidor borra sus ficheros temporales). Solo si la RPC aún no existe se
//  recuerda EN ESTE NAVEGADOR (localStorage), como antes. Solo se miran los
//  últimos 7 días y los documentos que subió el propio usuario.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { type Anadible, descartarTrabajo, type Sustituible } from "./documentoLargo";
import type { ElementoCola } from "./colaSubida";

export const DIAS_PENDIENTES = 7;
export const CLAVE_DESCARTADOS = "facturas.pendientesDescartados";

/**
 * Un documento por decidir: o se puede SUSTITUIR la existente por él, o es
 * OTRA página de la existente y se puede AÑADIR (nunca las dos cosas).
 */
export type PendienteDecidir = {
  trabajoId: string;
  nombre: string;
  creado: string | null;
} & ({ sustituible: Sustituible; anadible?: null } | { sustituible?: null; anadible: Anadible });

const esSustituible = (s: unknown): s is Sustituible => {
  const x = s as Sustituible | null;
  return !!x && typeof x.trabajo_id === "string" && !!x.existente && typeof x.existente.id === "number" && !!x.nuevo;
};

const esAnadible = (s: unknown): s is Anadible => {
  const x = s as Anadible | null;
  return esSustituible(s) && !!x!.pagina && Number.isInteger(x!.pagina.actual) && Number.isInteger(x!.pagina.total);
};

/** Lo que se ofrece para un resultado: añadir como página (si lo es) o sustituir. */
function oferta(r: { sustituible?: unknown; anadible?: unknown } | null | undefined):
  { sustituible: Sustituible; anadible?: null } | { sustituible?: null; anadible: Anadible } | null {
  if (esAnadible(r?.anadible)) return { anadible: r!.anadible as Anadible };
  if (esSustituible(r?.sustituible)) return { sustituible: r!.sustituible as Sustituible };
  return null;
}

/** Id del trabajo del pendiente. */
export const trabajoDe = (p: PendienteDecidir) => p.trabajoId;

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
  const filas = data as unknown as {
    id: string;
    nombre_original: string;
    resultado: { sustituible?: unknown; anadible?: unknown } | null;
    created_at: string | null;
  }[];
  const out: PendienteDecidir[] = [];
  for (const f of filas) {
    const o = oferta(f.resultado);
    if (o) out.push({ trabajoId: f.id, nombre: f.nombre_original, creado: f.created_at, ...o });
  }
  return out;
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
    const o = e.fase === "terminado" && e.resultado?.duplicado ? oferta(e.resultado) : null;
    if (o) {
      const trabajoId = (o.anadible ?? o.sustituible)!.trabajo_id;
      meter({ trabajoId, nombre: e.nombre, creado: null, ...o });
    }
  }
  deBd.forEach(meter);
  return out;
}

/**
 * Cómo quedó un «Dejar la que hay»:
 *  · `servidor`: descartado en el servidor (ocr_descartar_trabajo);
 *  · `local`: la RPC aún no existe → solo se oculta en este navegador;
 *  · `error`: el servidor no lo ha permitido (con el motivo).
 */
export type ResultadoDescartar = { como: "servidor" | "local" } | { como: "error"; motivo: string };

export async function descartarPendienteServidor(
  trabajoId: string,
  rpc: typeof descartarTrabajo = descartarTrabajo,
): Promise<ResultadoDescartar> {
  try {
    const r = await rpc(trabajoId);
    if (!r.disponible) return { como: "local" };
    if (r.ok) return { como: "servidor" };
    // Ya cancelado/terminado desde otro sitio: no hay nada que decidir.
    if (r.estado === "cancelado" || r.estado === "completado") return { como: "servidor" };
    return { como: "error", motivo: r.motivo || "El servidor no ha dejado descartarlo ahora." };
  } catch {
    return { como: "local" };
  }
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
