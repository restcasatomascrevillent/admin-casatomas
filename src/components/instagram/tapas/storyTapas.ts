/**
 * Story del jueves de tapas (12/11/2026): el flujo del panel.
 *
 *  asegurarStoryTapas   AUTOMÁTICO. Lo llaman Gestión web › Tapas al guardar
 *                       unas tapas y su interruptor al encender «Tapas» en la
 *                       web. Con la sesión de quien guarda: si la story
 *                       automática está activada, las tapas salen en la web y
 *                       el día no ha pasado, crea la story (render) y la
 *                       PROGRAMA para ese día a la hora de los ajustes (12:00
 *                       por defecto; si ya ha pasado, en 15 min). Si cambian
 *                       las tapas antes de publicarse, regenera la MISMA pieza
 *                       y la vuelve a programar a la misma hora. Nunca dos la
 *                       misma semana (lo decide la base de datos con cerrojo:
 *                       instagram_story_tapas_reclamar).
 *  storyTapasManual     el botón «Crear story de Instagram» del editor de tapas:
 *                       publicar ahora o programar a una hora elegida.
 *  publicarAhoraAviso   «Publicar ahora» del aviso de la campana.
 *
 * Todo lo que habla con el servidor va por DepsStoryTapas (api.ts la real; las
 * pruebas, una simulada).
 */
import {
  HORA_TAPAS_POR_DEFECTO,
  PLANTILLA_TAPAS_POR_DEFECTO,
  hoyEnMadrid,
  huellaTapas,
  instanteProgramacion,
  limpiarTapas,
  piezaStoryTapas,
  problemasTapas,
  semanaDe,
  type AccionStoryTapas,
  type FilaStoryTapas,
  type PlantillaTapas,
} from "@/lib/instagram/tapas";
import type { FotoPreparada } from "@/components/marketing/instagram/api";

export interface AjustesStoryTapas {
  activa: boolean;
  hora: string;
  plantilla: PlantillaTapas;
  foto: string | null;
}

export const AJUSTES_POR_DEFECTO: AjustesStoryTapas = { activa: true, hora: HORA_TAPAS_POR_DEFECTO, plantilla: PLANTILLA_TAPAS_POR_DEFECTO, foto: null };

export interface FilaCompleta extends FilaStoryTapas {
  fecha_tapas: string;
  programada_para: string | null;
  error?: string | null;
  tapas?: unknown;
}

export interface DepsStoryTapas {
  /** null = sin permiso de Marketing o sin la migración: el automático no hace nada. */
  leerAjustes(): Promise<AjustesStoryTapas | null>;
  /** El interruptor «Mostrar Tapas en la web» está encendido. */
  tapasEnLaWeb(): Promise<boolean>;
  /** «20:30 y 22:00» (horas fijas del jueves), o null. */
  turnos(): Promise<string | null>;
  reclamar(fecha: string, huella: string, manual: boolean): Promise<{ accion: AccionStoryTapas; fila: FilaCompleta }>;
  /** Copia al bucket la foto de Drive o de la carta (null si es del catálogo estático). */
  prepararFoto(id: string): Promise<FotoPreparada | null>;
  renderizar(pieza: Record<string, unknown>, piezaId: string | null, foto: FotoPreparada | null): Promise<{ id: string }>;
  /** Cancela una programación pendiente; no falla si ya no lo estaba. */
  cancelarProgramacion(id: string): Promise<void>;
  programar(piezaId: string, instante: Date): Promise<{ id: string; programadaPara: string }>;
  registrar(semana: string, piezaId: string, programacionId: string | null, huella: string, tapas: string[], plantilla: PlantillaTapas): Promise<FilaCompleta>;
  fallo(semana: string, error: string): Promise<void>;
  publicar(piezaId: string, fotosTmp: string[], contenedorId?: string | null): Promise<{ estado: string; permalink: string | null; contenedorId: string | null }>;
  ahora(): Date;
}

export type ResultadoStoryTapas =
  | { estado: "programada"; regenerada: boolean; programadaPara: string; piezaId: string; mensaje: string }
  | { estado: "publicada"; piezaId: string; permalink: string | null; mensaje: string }
  | { estado: "en_proceso"; piezaId: string; mensaje: string }
  | { estado: "nada"; motivo: "sin-permiso" | "desactivada" | "web-apagada" | "pasada" | "ya-hecha" | "publicada" | "cancelada" | "otra-en-curso"; mensaje: string }
  | { estado: "error"; mensaje: string };

/** Tiempo mínimo que tiene que quedar para mantener la hora de una story ya programada al regenerarla. */
const MARGEN_MANTENER_MS = 11 * 60_000;

function mensajeError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return m || "Error desconocido";
}

function porQueNada(fila: FilaCompleta): Extract<ResultadoStoryTapas, { estado: "nada" }> {
  if (fila.estado === "publicada") return { estado: "nada", motivo: "publicada", mensaje: "La story de tapas de esta semana ya está publicada: no se publica otra." };
  if (fila.estado === "cancelada") return { estado: "nada", motivo: "cancelada", mensaje: "La story de tapas de esta semana se canceló: no se vuelve a crear sola." };
  if (fila.estado === "programada") return { estado: "nada", motivo: "ya-hecha", mensaje: "La story de tapas ya estaba programada con estas tapas." };
  return { estado: "nada", motivo: "otra-en-curso", mensaje: "La story de tapas se está preparando en otra pestaña o publicando ahora mismo." };
}

async function generar(
  deps: DepsStoryTapas,
  e: { fecha: string; tapas: string[]; plantilla: PlantillaTapas; foto: string | null; turnos: string | null; fila: FilaCompleta; accion: AccionStoryTapas },
): Promise<{ piezaId: string; fotosTmp: string[] }> {
  // Una programada no deja cambiar su imagen: se cancela antes de regenerar.
  if (e.accion === "regenerar" && e.fila.programacion_id && (e.fila.estado === "programada" || e.fila.estado === "error")) {
    await deps.cancelarProgramacion(e.fila.programacion_id);
  }
  const preparada = e.foto ? await deps.prepararFoto(e.foto) : null;
  const pieza = piezaStoryTapas({ dia: e.fecha, tapas: e.tapas, plantilla: e.plantilla, foto: e.foto, turnos: e.turnos });
  const { id } = await deps.renderizar(pieza, e.fila.pieza_id, preparada);
  const tmp = preparada ? /tmp\/[^?#]+$/.exec(preparada.url)?.[0] : null;
  return { piezaId: id, fotosTmp: tmp ? [tmp] : [] };
}

/** AUTOMÁTICO: ver la cabecera. No lanza: devuelve qué ha pasado. */
export async function asegurarStoryTapas(entrada: { fecha: string; tapas: readonly string[] }, deps: DepsStoryTapas): Promise<ResultadoStoryTapas> {
  let ajustes: AjustesStoryTapas | null;
  try {
    ajustes = await deps.leerAjustes();
  } catch {
    ajustes = null;
  }
  if (!ajustes) return { estado: "nada", motivo: "sin-permiso", mensaje: "Sin permiso de Marketing: la story de tapas no se crea sola." };
  if (!ajustes.activa) return { estado: "nada", motivo: "desactivada", mensaje: "La story automática del jueves de tapas está apagada." };
  const ahora = deps.ahora();
  if (entrada.fecha < hoyEnMadrid(ahora)) return { estado: "nada", motivo: "pasada", mensaje: "Ese día ya ha pasado: no se crea la story." };
  if (!(await deps.tapasEnLaWeb().catch(() => false))) {
    return { estado: "nada", motivo: "web-apagada", mensaje: "«Tapas» no está activo en la web: la story se creará al activarlo." };
  }
  const tapas = limpiarTapas(entrada.tapas);
  const turnos = ajustes.plantilla === "ct-tapas" ? await deps.turnos().catch(() => null) : null;
  const problemas = problemasTapas(tapas, ajustes.plantilla, !!turnos);
  if (problemas.length) return { estado: "error", mensaje: `No se puede crear la story de tapas: ${problemas.join(" ")}` };

  const huella = huellaTapas(entrada.fecha, tapas);
  let reclamo: { accion: AccionStoryTapas; fila: FilaCompleta };
  try {
    reclamo = await deps.reclamar(entrada.fecha, huella, false);
  } catch (e) {
    return { estado: "error", mensaje: `No se pudo preparar la story de tapas: ${mensajeError(e)}` };
  }
  const { accion, fila } = reclamo;
  if (accion === "nada") return porQueNada(fila);

  const semana = fila.semana ?? semanaDe(entrada.fecha);
  try {
    const { piezaId } = await generar(deps, { fecha: entrada.fecha, tapas, plantilla: ajustes.plantilla, foto: ajustes.foto, turnos, fila, accion });
    // Al regenerar se mantiene la hora que tenía (también si se cambió a mano), si aún da tiempo.
    const anterior = accion === "regenerar" && fila.programada_para ? new Date(fila.programada_para) : null;
    const instante =
      anterior && anterior.getTime() - ahora.getTime() > MARGEN_MANTENER_MS ? anterior : instanteProgramacion(entrada.fecha, ajustes.hora, ahora).instante;
    const prog = await deps.programar(piezaId, instante);
    await deps.registrar(semana, piezaId, prog.id, huella, tapas, ajustes.plantilla);
    return {
      estado: "programada",
      regenerada: accion === "regenerar",
      programadaPara: prog.programadaPara,
      piezaId,
      mensaje: accion === "regenerar" ? "Story de tapas rehecha con las tapas nuevas y programada de nuevo." : "Story de tapas creada y programada.",
    };
  } catch (e) {
    const m = mensajeError(e);
    await deps.fallo(semana, m).catch(() => undefined);
    return { estado: "error", mensaje: `No se pudo crear la story de tapas: ${m}` };
  }
}

export interface PeticionManual {
  fecha: string;
  tapas: readonly string[];
  plantilla: PlantillaTapas;
  foto: string | null;
  turnos: string | null;
  /** null = publicar ahora. */
  programarPara: Date | null;
}

/** Publica (reintentando si Meta aún procesa la imagen) y deja la fila al día. */
async function publicarYRegistrar(deps: DepsStoryTapas, piezaId: string, fotosTmp: string[]): Promise<ResultadoStoryTapas> {
  let r = await deps.publicar(piezaId, fotosTmp);
  for (let i = 0; i < 3 && r.estado === "en_proceso" && r.contenedorId; i++) r = await deps.publicar(piezaId, fotosTmp, r.contenedorId);
  if (r.estado === "en_proceso") return { estado: "en_proceso", piezaId, mensaje: "Instagram aún está procesando la story. Mira en unos minutos si ha salido." };
  return { estado: "publicada", piezaId, permalink: r.permalink, mensaje: "Story de tapas publicada." };
}

/** Botón «Crear story de Instagram» del editor de tapas. No lanza. */
export async function storyTapasManual(p: PeticionManual, deps: DepsStoryTapas): Promise<ResultadoStoryTapas> {
  const tapas = limpiarTapas(p.tapas);
  const problemas = problemasTapas(tapas, p.plantilla, p.plantilla === "ct-tapas" && !!p.turnos);
  if (problemas.length) return { estado: "error", mensaje: problemas.join(" ") };
  const huella = huellaTapas(p.fecha, tapas);
  let reclamo: { accion: AccionStoryTapas; fila: FilaCompleta };
  try {
    reclamo = await deps.reclamar(p.fecha, huella, true);
  } catch (e) {
    return { estado: "error", mensaje: mensajeError(e) };
  }
  if (reclamo.accion === "nada") return porQueNada(reclamo.fila);
  const semana = reclamo.fila.semana ?? semanaDe(p.fecha);
  try {
    const { piezaId, fotosTmp } = await generar(deps, { fecha: p.fecha, tapas, plantilla: p.plantilla, foto: p.foto, turnos: p.turnos, fila: reclamo.fila, accion: reclamo.accion });
    if (p.programarPara) {
      const prog = await deps.programar(piezaId, p.programarPara);
      await deps.registrar(semana, piezaId, prog.id, huella, tapas, p.plantilla);
      return { estado: "programada", regenerada: reclamo.accion === "regenerar", programadaPara: prog.programadaPara, piezaId, mensaje: "Story de tapas programada." };
    }
    // Se registra ANTES de publicar (sin programación): si la publicación se corta, el automático no la rehace.
    await deps.registrar(semana, piezaId, null, huella, tapas, p.plantilla);
    return await publicarYRegistrar(deps, piezaId, fotosTmp);
  } catch (e) {
    const m = mensajeError(e);
    await deps.fallo(semana, m).catch(() => undefined);
    return { estado: "error", mensaje: m };
  }
}

/** «Publicar ahora» del aviso: cancela la programación y publica la pieza ya generada. No lanza. */
export async function publicarAhoraAviso(a: { piezaId: string; programacionId: string | null }, deps: Pick<DepsStoryTapas, "cancelarProgramacion" | "publicar">): Promise<ResultadoStoryTapas> {
  try {
    if (a.programacionId) await deps.cancelarProgramacion(a.programacionId);
    return await publicarYRegistrar(deps as DepsStoryTapas, a.piezaId, []);
  } catch (e) {
    return {
      estado: "error",
      mensaje: `${mensajeError(e)}${a.programacionId ? " La programación quedó cancelada: vuelve a programarla desde el calendario si hace falta." : ""}`,
    };
  }
}
