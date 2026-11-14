/**
 * Peticiones (usuarios del panel) y Tickets (Super Admin), 13/11/2026. Acceso a datos del panel.
 *
 *   · Crear: captura opcional al cubo privado «peticiones» (`<uid>/<uuid>.<ext>`, reducida a JPEG si se puede)
 *     y fila en `peticiones` (la BD pone autor, estado y análisis: migración 20261129100000).
 *   · Después de guardar, `pedirAnalisis` lanza la Edge Function `analizar-peticion` en segundo plano (una vez).
 *   · El super admin lee todas, cambia el estado y puede volver a analizar.
 *
 * La lista de módulos, prioridades, estados y la lectura del análisis viven en
 * `supabase/functions/_shared/peticiones.ts` (las comparte la Edge Function).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { redimensionarFoto } from "@/components/carta/redimensionarFoto";
import {
  BUCKET_CAPTURAS,
  MAX_CAPTURA_BYTES,
  type EstadoAnalisis,
  type EstadoPeticion,
  type PrioridadPeticion,
} from "../../supabase/functions/_shared/peticiones";

// `peticiones` aún no está en los tipos generados de Supabase.
const sb = supabase as unknown as SupabaseClient;

export interface Peticion {
  id: string;
  creado_por: string | null;
  creado_por_nombre: string | null;
  creado_por_email: string | null;
  titulo: string;
  prioridad: PrioridadPeticion;
  modulo: string;
  descripcion: string;
  captura_path: string | null;
  ruta: string | null;
  dispositivo: string | null;
  estado: EstadoPeticion;
  motivo_descarte: string | null;
  estado_cambiado_en: string | null;
  analisis: unknown;
  analisis_estado: EstadoAnalisis;
  analisis_error: string | null;
  analisis_modelo: string | null;
  analizado_en: string | null;
  linear_id: string | null;
  linear_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface NuevaPeticion {
  titulo: string;
  prioridad: PrioridadPeticion;
  modulo: string;
  descripcion: string;
  captura?: File | null;
  /** Página del panel en la que estaba (con su `?tab=`). */
  ruta?: string | null;
}

const TIPOS_CAPTURA: Record<string, "jpg" | "png" | "webp"> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** User agent (+ «iPad» si es un iPad que se presenta como Mac, para saber que es tablet). */
export function dispositivoActual(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> | undefined = typeof navigator !== "undefined" ? navigator : undefined): string | null {
  if (!nav?.userAgent) return null;
  const ua = /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1 ? `${nav.userAgent} (iPad)` : nav.userAgent;
  return ua.slice(0, 400);
}

export interface DepsCaptura {
  reducir?: (f: Blob) => Promise<{ blob: Blob }>;
  subir?: (ruta: string, blob: Blob, tipo: string) => Promise<void>;
  uuid?: () => string;
}

/** Prepara la captura: JPEG reducido si se puede; si no, la original (jpg/png/webp de hasta 5 MB). */
export async function prepararCaptura(file: File, reducir: DepsCaptura["reducir"] = redimensionarFoto): Promise<{ blob: Blob; tipo: string; ext: string }> {
  if (!file.type.startsWith("image/")) throw new Error("La captura tiene que ser una imagen (foto o captura de pantalla).");
  try {
    const { blob } = await reducir(file);
    if (blob.size > 0 && blob.size <= MAX_CAPTURA_BYTES) return { blob, tipo: "image/jpeg", ext: "jpg" };
  } catch {
    // Si no se puede reducir (formato raro), se intenta con la original.
  }
  const ext = TIPOS_CAPTURA[file.type];
  if (!ext) throw new Error("No se ha podido leer la imagen. Prueba con una captura en JPG o PNG.");
  if (file.size > MAX_CAPTURA_BYTES) throw new Error("La imagen pesa más de 5 MB. Prueba con una captura más pequeña.");
  return { blob: file, tipo: file.type, ext };
}

/** Sube la captura a la carpeta del usuario y devuelve su ruta en el cubo. */
export async function subirCaptura(file: File, userId: string, deps: DepsCaptura = {}): Promise<string> {
  const { blob, tipo, ext } = await prepararCaptura(file, deps.reducir);
  const ruta = `${userId}/${(deps.uuid ?? (() => crypto.randomUUID()))()}.${ext}`;
  if (deps.subir) {
    await deps.subir(ruta, blob, tipo);
  } else {
    const { error } = await sb.storage.from(BUCKET_CAPTURAS).upload(ruta, blob, { contentType: tipo, upsert: false });
    if (error) throw new Error("No se ha podido subir la captura. Prueba otra vez o envía la petición sin ella.");
  }
  return ruta;
}

/** Guarda la petición (y su captura). La BD pone autor, estado y el resto. */
export async function crearPeticion(d: NuevaPeticion, userId: string, deps: DepsCaptura = {}): Promise<Peticion> {
  const captura_path = d.captura ? await subirCaptura(d.captura, userId, deps) : null;
  const { data, error } = await sb
    .from("peticiones")
    .insert({
      titulo: d.titulo.trim(),
      prioridad: d.prioridad,
      modulo: d.modulo,
      descripcion: d.descripcion.trim(),
      captura_path,
      ruta: d.ruta ? d.ruta.slice(0, 300) : null,
      dispositivo: dispositivoActual(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Peticion;
}

/**
 * Pide el análisis de la IA. Sin `forzar`, la Edge Function solo analiza si aún no se ha hecho (se llama
 * justo después de guardar y al abrir un ticket pendiente). `forzar` = «Volver a analizar» (super admin).
 */
export async function pedirAnalisis(id: string, forzar = false): Promise<{ ok: boolean; analisis_estado?: EstadoAnalisis; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; analisis_estado?: EstadoAnalisis; error?: string }>("analizar-peticion", {
    body: { peticion_id: id, forzar },
  });
  if (error) throw error;
  return data ?? { ok: false };
}

export async function leerMisPeticiones(userId: string): Promise<Peticion[]> {
  const { data, error } = await sb
    .from("peticiones")
    .select("id, creado_por, titulo, prioridad, modulo, descripcion, captura_path, estado, motivo_descarte, estado_cambiado_en, created_at, updated_at")
    .eq("creado_por", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Peticion[];
}

/** Todas (super admin; la RLS no deja a nadie más). */
export async function leerTickets(): Promise<Peticion[]> {
  const { data, error } = await sb.from("peticiones").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as Peticion[];
}

export async function cambiarEstadoPeticion(id: string, estado: EstadoPeticion, motivo?: string | null): Promise<void> {
  const { data, error } = await sb
    .from("peticiones")
    .update({ estado, motivo_descarte: estado === "descartada" ? (motivo ?? "").trim() : null })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  // La RLS no da error si no deja cambiar: simplemente no cambia nada.
  if (!data?.length) throw new Error("No se ha podido cambiar el estado: solo el super admin puede hacerlo.");
}

/** Al abrir un ticket «Recibido», pasa a «En análisis» (quien lo envió ve que alguien lo está mirando). */
export async function marcarEnAnalisis(id: string): Promise<boolean> {
  const { data, error } = await sb.from("peticiones").update({ estado: "en_analisis" }).eq("id", id).eq("estado", "nueva").select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Enlace temporal (10 min) a la captura. */
export async function urlCaptura(ruta: string): Promise<string | null> {
  const { data, error } = await sb.storage.from(BUCKET_CAPTURAS).createSignedUrl(ruta, 600);
  if (error) return null;
  return data?.signedUrl ?? null;
}
