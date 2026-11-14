/**
 * Story del jueves de tapas: lo que habla con el servidor (DepsStoryTapas de
 * verdad). Siempre con la sesión del usuario del panel: render en Vercel
 * (/api/instagram-render), programar y la fila de la semana por RPC de
 * Supabase, publicar por instagram-publicar. Las tablas nuevas no están en
 * src/integrations/supabase/types.ts: se consultan sin tipos, como
 * instagram_piezas.
 */
import { supabase } from "@/integrations/supabase/client";
import { generarImagen, prepararFotoOrigen, publicarDirecto, type FotoPreparada } from "@/components/marketing/instagram/api";
import { fotoPreparable } from "@/lib/instagram";
import { PLANTILLAS_TAPAS, normalizarHora, textoTurnos, type PlantillaTapas } from "@/lib/instagram/tapas";
import { AJUSTES_POR_DEFECTO, type AjustesStoryTapas, type DepsStoryTapas, type FilaCompleta } from "./storyTapas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tablas y RPC fuera de los tipos generados.
const sb = supabase as any;

export const CLAVE_AJUSTES_TAPAS = ["instagram_story_tapas_ajustes"] as const;
export const CLAVE_STORY_TAPAS = ["instagram_story_tapas"] as const;

function errorDe(e: { message?: string } | null | undefined, porDefecto: string): Error {
  return new Error(e?.message || porDefecto);
}

export function ajustesDesdeFila(f: Record<string, unknown> | null | undefined): AjustesStoryTapas {
  if (!f) return AJUSTES_POR_DEFECTO;
  return {
    activa: f.activa !== false,
    hora: normalizarHora(f.hora),
    plantilla: PLANTILLAS_TAPAS.includes(f.plantilla as PlantillaTapas) ? (f.plantilla as PlantillaTapas) : AJUSTES_POR_DEFECTO.plantilla,
    foto: typeof f.foto === "string" && f.foto ? f.foto : null,
  };
}

/** Ajustes (null si no se pueden leer: sin Marketing o sin la migración). */
export async function leerAjustesTapas(): Promise<AjustesStoryTapas | null> {
  const { data, error } = await sb.from("instagram_story_tapas_ajustes").select("activa, hora, plantilla, foto").eq("id", true).maybeSingle();
  if (error || !data) return null;
  return ajustesDesdeFila(data);
}

export async function guardarAjustesTapas(cambios: Partial<AjustesStoryTapas>): Promise<void> {
  const fila: Record<string, unknown> = {};
  if (cambios.activa !== undefined) fila.activa = cambios.activa;
  if (cambios.hora !== undefined) fila.hora = normalizarHora(cambios.hora);
  if (cambios.plantilla !== undefined) fila.plantilla = cambios.plantilla;
  if (cambios.foto !== undefined) fila.foto = cambios.foto;
  const { data, error } = await sb.from("instagram_story_tapas_ajustes").update(fila).eq("id", true).select("id");
  if (error) throw errorDe(error, "No se pudieron guardar los ajustes");
  if (!data?.length) throw new Error("No se han guardado: hace falta «Editar» en Marketing (o aplicar la migración de la story de tapas).");
}

/** Fila de la semana al día (sincronizada con la programación). null si no hay. */
export async function verStoryTapas(semana: string): Promise<FilaCompleta | null> {
  const { data, error } = await sb.rpc("instagram_story_tapas_ver", { p_semana: semana });
  if (error) throw errorDe(error, "No se pudo leer la story de tapas");
  return (data as FilaCompleta | null) ?? null;
}

export async function cancelarStoryTapas(semana: string): Promise<void> {
  const { error } = await sb.rpc("instagram_story_tapas_cancelar", { p_semana: semana });
  if (error) throw errorDe(error, "No se pudo cancelar");
}

async function cancelarProgramacion(id: string): Promise<void> {
  const { error } = await sb.rpc("instagram_cancelar_programacion", { p_id: id });
  // Ya no estaba pendiente (P0002): da igual, lo que se quería es que no saliera.
  if (error && error.code !== "P0002") throw errorDe(error, "No se pudo cancelar la programación");
}

export const DEPS_STORY_TAPAS: DepsStoryTapas = {
  leerAjustes: leerAjustesTapas,
  async tapasEnLaWeb() {
    const { data, error } = await sb.from("configuracion_web").select("mostrar_tapas_casa_tomas").eq("id", true).maybeSingle();
    if (error) return false;
    return data?.mostrar_tapas_casa_tomas !== false;
  },
  async turnos() {
    // El periodo del jueves con horas fijas («Cena · Jueves de tapas», 20261122200100).
    const { data, error } = await sb.from("configuracion_turnos").select("horas_fijas, dias_semana, activo").eq("activo", true).contains("dias_semana", [4]).not("horas_fijas", "is", null);
    if (error || !Array.isArray(data)) return null;
    for (const f of data) {
      const t = textoTurnos(f.horas_fijas);
      if (t && Array.isArray(f.horas_fijas) && f.horas_fijas.length > 1) return t;
    }
    return null;
  },
  async reclamar(fecha, huella, manual) {
    const { data, error } = await sb.rpc("instagram_story_tapas_reclamar", { p_fecha: fecha, p_huella: huella, p_manual: manual });
    if (error) throw errorDe(error, "No se pudo reservar la story de la semana");
    return data as { accion: "crear" | "regenerar" | "nada"; fila: FilaCompleta };
  },
  async prepararFoto(id) {
    const origen = fotoPreparable(id);
    if (!origen) return null;
    const c = await prepararFotoOrigen("casa-tomas", origen);
    return { id, url: c.url, ancho: c.ancho ?? 1080, alto: c.alto ?? 1920, tipo: null, marca: "casa-tomas" } satisfies FotoPreparada;
  },
  async renderizar(pieza, piezaId, foto) {
    const r = await generarImagen(pieza, piezaId, undefined, foto);
    return { id: r.id };
  },
  cancelarProgramacion,
  async programar(piezaId, instante) {
    // Una story no se debe quedar sin salir por otra publicación cercana: se confirma el aviso de ±30 min.
    const { data, error } = await sb.rpc("instagram_programar", { p_pieza_id: piezaId, p_para: instante.toISOString(), p_confirmar_conflicto: true });
    if (error) throw errorDe(error, "No se pudo programar");
    const p = (data as { programacion?: { id: string; programada_para: string } })?.programacion;
    if (!p?.id) throw new Error("No se pudo programar la story");
    return { id: p.id, programadaPara: p.programada_para };
  },
  async registrar(semana, piezaId, programacionId, huella, tapas, plantilla) {
    const { data, error } = await sb.rpc("instagram_story_tapas_registrar", {
      p_semana: semana,
      p_pieza_id: piezaId,
      p_programacion_id: programacionId,
      p_huella: huella,
      p_tapas: tapas,
      p_plantilla: plantilla,
    });
    if (error) throw errorDe(error, "No se pudo guardar la story de la semana");
    return (data as { fila: FilaCompleta }).fila;
  },
  async fallo(semana, mensaje) {
    await sb.rpc("instagram_story_tapas_fallo", { p_semana: semana, p_error: mensaje.slice(0, 1000) });
  },
  async publicar(piezaId, fotosTmp, contenedorId) {
    const r = await publicarDirecto({ ids: [piezaId], caption: "", altTexts: [""], fotosTmp, contenedorId });
    return { estado: r.estado, permalink: r.permalink, contenedorId: r.contenedorId };
  },
  ahora: () => new Date(),
};
