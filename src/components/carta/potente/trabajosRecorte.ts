/**
 * Fotos de la carta que un móvil no pudo recortar, pendientes de recortar en
 * un ordenador con el panel abierto (tabla trabajos_recorte, RPC
 * reclamar/terminar/soltar_trabajo_recorte y push con notificar-video
 * `tipo: "recorte"`). Mismo esquema que «Mandar a un dispositivo potente» de
 * los vídeos (trabajosVideo.ts), para Platos, Vinos, Bebidas y Cócteles.
 *
 * Todo funciona sin la migración 20261102160000 aplicada: crear devuelve
 * `{ creado: false, motivo: "sin_migracion" }` y el móvil avisa como antes
 * («se recortará desde un ordenador con Quitar fondo»); el ordenador no
 * enseña ningún aviso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { describirDispositivo, esErrorSinMigracion, reclamable } from "./colaPendientes";
import type { DatosRecorte, TablaFoto } from "../recorte/recorteMovil";

// trabajos_recorte aún no está en types.ts (generado).
const sb = supabase as unknown as SupabaseClient;

export type EstadoTrabajoRecorte = "pendiente" | "procesando" | "listo" | "error";

export interface TrabajoRecorte {
  id: string;
  tabla: TablaFoto;
  registro_id: string;
  nombre: string | null;
  ruta_original: string;
  tema: string;
  estado: EstadoTrabajoRecorte;
  creado_por: string | null;
  dispositivo_origen: string | null;
  procesado_por: string | null;
  reclamado_en: string | null;
  intentos: number;
  error: string | null;
  created_at: string;
}

const COLUMNAS =
  "id, tabla, registro_id, nombre, ruta_original, tema, estado, creado_por, dispositivo_origen, procesado_por, reclamado_en, intentos, error, created_at";

/** Además de los del vídeo, el mensaje puede nombrar las piezas de esta migración. */
export function esSinMigracionRecorte(error: unknown): boolean {
  if (esErrorSinMigracion(error)) return true;
  const m = (error as { message?: string } | null)?.message ?? "";
  return /trabajos_recorte|reclamar_trabajo_recorte|terminar_trabajo_recorte|soltar_trabajo_recorte/.test(m) &&
    /does not exist|could not find|schema cache/i.test(m);
}

export type LecturaTrabajosRecorte = { disponible: true; trabajos: TrabajoRecorte[] } | { disponible: false };

export async function trabajosRecorteVivos(): Promise<LecturaTrabajosRecorte> {
  const { data, error } = await sb
    .from("trabajos_recorte")
    .select(COLUMNAS)
    .in("estado", ["pendiente", "procesando"])
    .order("created_at");
  if (error) {
    if (esSinMigracionRecorte(error)) return { disponible: false };
    throw error;
  }
  return { disponible: true, trabajos: (data ?? []) as TrabajoRecorte[] };
}

/** Los que se pueden recortar aquí, del más antiguo al más nuevo (mismas reglas que los vídeos). */
export function recortesReclamables<T extends Pick<TrabajoRecorte, "estado" | "reclamado_en" | "created_at">>(
  trabajos: readonly T[],
  ahora = Date.now(),
): T[] {
  return trabajos.filter((t) => reclamable(t, ahora)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export function nombreTrabajoRecorte(t: Pick<TrabajoRecorte, "nombre">): string {
  return t.nombre?.trim() || "ficha sin nombre";
}

/** «Hay 1 foto pendiente de recortar: Fondillón. ¿Recortarla aquí?» */
export function textoAvisoRecortes(trabajos: readonly Pick<TrabajoRecorte, "nombre">[], maxNombres = 3): string {
  const n = trabajos.length;
  if (n === 0) return "";
  const nombres = trabajos.slice(0, maxNombres).map(nombreTrabajoRecorte);
  const resto = n > maxNombres ? ` y ${n - maxNombres} más` : "";
  const cabeza = n === 1 ? "Hay 1 foto pendiente de recortar" : `Hay ${n} fotos pendientes de recortar`;
  const pregunta = n === 1 ? "¿Recortarla aquí?" : "¿Recortarlas aquí?";
  return `${cabeza}: ${nombres.join(", ")}${resto}. ${pregunta}`;
}

export type ResultadoCrear = { creado: true; trabajo: TrabajoRecorte } | { creado: false; motivo: "sin_migracion" | "sin_sesion" };

/**
 * Crea el trabajo de una foto ya guardada sin recortar. Si la ficha ya tenía
 * uno pendiente (otra foto anterior), se sustituye por este. Lanza solo ante
 * errores inesperados.
 */
export async function crearTrabajoRecorte(d: DatosRecorte): Promise<ResultadoCrear> {
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return { creado: false, motivo: "sin_sesion" };
  const fila = {
    tabla: d.tabla,
    registro_id: d.registroId,
    nombre: d.nombre ? d.nombre.slice(0, 200) : null,
    ruta_original: d.rutaOriginal,
    tema: d.tema,
    creado_por: u.user.id,
    dispositivo_origen: describirDispositivo(),
  };
  for (let intento = 0; intento < 2; intento++) {
    const { data, error } = await sb.from("trabajos_recorte").insert(fila).select(COLUMNAS).single();
    if (!error) return { creado: true, trabajo: data as TrabajoRecorte };
    if (esSinMigracionRecorte(error)) return { creado: false, motivo: "sin_migracion" };
    if ((error as { code?: string }).code === "23505" && intento === 0) {
      // Ya había uno vivo para esta ficha: el pendiente (foto anterior) sobra.
      await sb.from("trabajos_recorte").delete().eq("tabla", d.tabla).eq("registro_id", d.registroId).eq("estado", "pendiente");
      continue;
    }
    throw error;
  }
  throw new Error("Esta ficha ya tiene una foto recortándose en otro dispositivo.");
}

export async function reclamarTrabajoRecorte(id?: string): Promise<TrabajoRecorte | null> {
  const { data, error } = await sb.rpc("reclamar_trabajo_recorte", { p_id: id ?? null, p_dispositivo: describirDispositivo() });
  if (error) throw error;
  const fila = (Array.isArray(data) ? data[0] : data) as TrabajoRecorte | undefined;
  return fila ?? null;
}

export async function terminarTrabajoRecorte(id: string, ok: boolean, mensaje?: string): Promise<void> {
  const { error } = await sb.rpc("terminar_trabajo_recorte", { p_id: id, p_ok: ok, p_error: ok ? null : (mensaje ?? null) });
  if (error) throw error;
}

export async function soltarTrabajoRecorte(id: string): Promise<void> {
  const { error } = await sb.rpc("soltar_trabajo_recorte", { p_id: id });
  if (error) throw error;
}

/** Push al que subió la foto (notificar-video con `tipo: "recorte"`). Nunca lanza. */
export async function notificarRecorte(id: string): Promise<{ ok: boolean; enviadas?: number; motivo?: string }> {
  try {
    const { data, error } = await sb.functions.invoke("notificar-video", { body: { trabajo_id: id, tipo: "recorte" } });
    if (error) return { ok: false, motivo: error.message };
    return { ok: true, enviadas: (data as { enviadas?: number } | null)?.enviadas ?? 0 };
  } catch (e) {
    return { ok: false, motivo: (e as Error)?.message };
  }
}
