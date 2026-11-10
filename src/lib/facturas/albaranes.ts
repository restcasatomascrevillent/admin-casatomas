/**
 * «Subir albaranes» (10/11/2026, tipo de usuario «Albaranes»): subir fotos o PDF de albaranes y
 * facturas para que se lean solos, y ver si llegaron. Sin nada de lo leído.
 *
 * Usa el mismo camino que la pestaña Cargar (fotos a facturas-originales/pendientes/{uid}/ y
 * procesar-factura en modo «iniciar», que no devuelve datos), pero no lee ocr_trabajos (ahí va el
 * resultado con sus importes): el estado sale de albaranes_mis_subidas(), que solo da nombre, estado,
 * páginas y fechas. La BD lo hace cumplir (migración 20261122143000_usuarios_reservas_albaranes).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  iniciarDocumentoLargo,
  iniciarDocumentoUnico,
  planificarDocumento,
  type InicioDocumentoLargo,
  type PlanDocumento,
} from "@/lib/facturas/documentoLargo";
import { MAX_BYTES_ARCHIVO } from "@/lib/facturas/colaSubida";

/** Lo que admite la lectura (procesar-factura › trabajos.ts, MIMES). */
export const TIPOS_ADMITIDOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export interface SubidaAlbaran {
  id: string;
  nombre_original: string;
  estado: string;
  num_paginas: number | null;
  created_at: string;
  terminado_at: string | null;
}

export type ClaseEstado = "leyendo" | "recibido" | "repetido" | "fallido" | "cancelado";

/** Estado del trabajo de lectura → lo que ve quien sube (sin detalles internos). */
export function claseEstado(estado: string): ClaseEstado {
  switch (estado) {
    case "completado":
      return "recibido";
    case "duplicado":
      return "repetido";
    case "fallido":
      return "fallido";
    case "cancelado":
      return "cancelado";
    default:
      // pendiente, pagina1, paginas, consolidando
      return "leyendo";
  }
}

export const TEXTO_ESTADO: Record<ClaseEstado, { etiqueta: string; detalle: string }> = {
  leyendo: { etiqueta: "Leyendo", detalle: "Recibido. Se está leyendo; no hace falta esperar con la pantalla abierta." },
  recibido: { etiqueta: "Recibido", detalle: "Leído y guardado. La oficina revisa los datos." },
  repetido: { etiqueta: "Ya estaba subido", detalle: "Este documento ya estaba en el sistema: no se ha guardado otra vez." },
  fallido: { etiqueta: "No se pudo leer", detalle: "Vuelve a hacer la foto, con más luz y el albarán entero a la vista." },
  cancelado: { etiqueta: "Cancelado", detalle: "Se canceló antes de leerse." },
};

/** ¿Se puede subir este fichero? Null si sí; si no, el motivo para enseñar. */
export function problemaFichero(file: Pick<File, "type" | "size" | "name">): string | null {
  if (!(TIPOS_ADMITIDOS as readonly string[]).includes(file.type)) {
    return `«${file.name}» no es una foto (JPG, PNG o WebP) ni un PDF.`;
  }
  if (file.size > MAX_BYTES_ARCHIVO) return `«${file.name}» pesa más de 10 MB: haz la foto con menos resolución.`;
  if (file.size === 0) return `«${file.name}» está vacío.`;
  return null;
}

export interface DepsSubida {
  planificar: (file: File) => Promise<PlanDocumento>;
  iniciarLargo: (file: File, plan: Extract<PlanDocumento, { camino: "largo" }>) => Promise<InicioDocumentoLargo>;
  iniciarUnico: (file: File) => Promise<InicioDocumentoLargo>;
}

const depsReales: DepsSubida = {
  planificar: planificarDocumento,
  iniciarLargo: (file, plan) => iniciarDocumentoLargo(file, plan),
  iniciarUnico: (file) => iniciarDocumentoUnico(file),
};

/**
 * Sube un fichero y crea su trabajo de lectura. Un PDF de varias páginas o una foto muy alta se
 * trocean como en Cargar; lo demás va de una pieza. Lanza con un mensaje en español si falla.
 */
export async function subirAlbaran(file: File, deps: DepsSubida = depsReales): Promise<InicioDocumentoLargo> {
  const problema = problemaFichero(file);
  if (problema) throw new Error(problema);
  const plan = await deps.planificar(file);
  return plan.camino === "largo" ? deps.iniciarLargo(file, plan) : deps.iniciarUnico(file);
}

/** Lo subido por el usuario en los últimos 14 días (solo estado). */
export async function leerMisSubidas(limite = 30): Promise<SubidaAlbaran[]> {
  const { data, error } = await supabase.rpc("albaranes_mis_subidas" as never, { p_limite: limite } as never);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as SubidaAlbaran[];
}

/** ¿Queda alguna leyéndose? (para seguir refrescando). */
export const hayLeyendo = (subidas: ReadonlyArray<Pick<SubidaAlbaran, "estado">>) =>
  subidas.some((s) => claseEstado(s.estado) === "leyendo");
