/**
 * RRSS · trabajos del motor: ANALIZAR un archivo recién subido y PROCESAR una
 * generación (transformar de verdad las fotos o montar el vídeo). Todo como el
 * usuario (RLS), con el estado en la base de datos para que el panel lo siga y
 * lo recupere aunque se cambie de sección.
 *
 *   rrss_generaciones: pendiente ──(reclamar, lease 6 min)──► procesando ──► listo
 *                                                               │   └──► error (con el motivo)
 *                                                               └── cancelado (desde el panel) → se para
 *
 * Una generación «procesando» con el lease vencido (la función murió) se puede
 * reclamar otra vez. Los resultados anteriores de las piezas regeneradas dejan
 * de ser vigentes; los originales nunca se tocan.
 */
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type sharpTipo from "sharp";
import { esEstilo, type EstiloId } from "../../../src/lib/rrss/estilos.js";
import { esCanal, esTipoContenido, formatoSalida, type FormatoSalida } from "../../../src/lib/rrss/formatos.js";
import { normalizarPlan, type PiezaFoto, type PiezaVideo, type PlanEdicion } from "../../../src/lib/rrss/plan.js";
import type { MarcaId } from "../../../src/lib/instagram/tokens.js";
import { editarFoto, medidasOrientadas, recetaFoto, type DependenciasFoto } from "./foto.js";
import { actualizar, descargarAFichero, descargarBytes, insertar, seleccionar, subir, type SesionRrss } from "./supabase.js";
import { analizarMedio, ejecutar, extraerAudio, hojaContactos, limpiar, montarVideo, recetaVideo, type FuenteToma, type Segmento } from "./video.js";

type Sharp = typeof sharpTipo;

export const LEASE_MIN = 6;

export interface FilaProyecto {
  id: string;
  marca: MarcaId;
  canal: string;
  tipo: string;
  estilo: string;
  permitir_creativo: boolean;
}

export interface FilaArchivo {
  id: string;
  proyecto_id: string;
  tipo: "foto" | "video";
  ruta: string;
  mime: string;
  bytes: number;
  ancho: number | null;
  alto: number | null;
  duracion_s: number | string | null;
  estado: string;
  analisis: Record<string, unknown>;
}

export interface FilaGeneracion {
  id: string;
  proyecto_id: string;
  medio: "foto" | "video";
  piezas: number[] | null;
  plan: unknown;
  estado: string;
  intentos: number;
}

export interface DependenciasTrabajo {
  sharp: Sharp;
  ffmpeg?: string;
  mascara?: DependenciasFoto["mascara"];
  dirTrabajo?: string;
  ahora?: () => Date;
}

const COL_ARCHIVO = "id,proyecto_id,tipo,ruta,mime,bytes,ancho,alto,duracion_s,estado,analisis";
const uuid = /^[0-9a-f-]{36}$/i;

export class ErrorTrabajo extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado = 400) {
    super(mensaje);
    this.name = "ErrorTrabajo";
    this.estado = estado;
  }
}

const mensaje = (e: unknown) => String((e as Error)?.message ?? e).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]").slice(0, 1500);

async function leerArchivo(s: SesionRrss, id: string): Promise<FilaArchivo> {
  if (!uuid.test(id)) throw new ErrorTrabajo("Archivo no válido");
  const [a] = await seleccionar<FilaArchivo>(s, "rrss_archivos", `id=eq.${id}&select=${COL_ARCHIVO}`);
  if (!a) throw new ErrorTrabajo("Ese archivo no existe o no lo puedes ver", 404);
  return a;
}

function dirTemporal(deps: DependenciasTrabajo, etiqueta: string): string {
  return path.join(deps.dirTrabajo ?? os.tmpdir(), `rrss-${etiqueta}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
}

// ── Análisis ────────────────────────────────────────────────────────────────

/**
 * Foto: medidas y previa de 1024 px. Vídeo: medidas giradas, duración, audio,
 * HDR, póster, hoja de contactos y audio a 16 kHz para transcribir la voz.
 */
export async function analizarArchivo(s: SesionRrss, archivoId: string, deps: DependenciasTrabajo): Promise<FilaArchivo> {
  const a = await leerArchivo(s, archivoId);
  await actualizar(s, "rrss_archivos", `id=eq.${a.id}`, { estado: "analizando", error: null });
  const previa = `previas/${a.proyecto_id}/${a.id}.jpg`;
  try {
    if (a.tipo === "foto") {
      const bytes = await descargarBytes(s, a.ruta);
      const { ancho, alto } = await medidasOrientadas(deps.sharp, bytes);
      const jpeg = await deps.sharp(bytes, { failOn: "none" }).rotate().resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
      await subir(s, previa, jpeg, "image/jpeg");
      const [fila] = await actualizar<FilaArchivo>(s, "rrss_archivos", `id=eq.${a.id}`, { estado: "listo", ancho, alto, analisis: { ...a.analisis, previa_ruta: previa } });
      return fila;
    }
    if (!deps.ffmpeg) throw new ErrorTrabajo("El análisis de vídeo va por /api/rrss-video", 400);
    const dir = dirTemporal(deps, "analisis");
    await mkdir(dir, { recursive: true });
    try {
      const local = path.join(dir, `original${path.extname(a.ruta)}`);
      await descargarAFichero(s, a.ruta, local);
      const info = await analizarMedio(deps.ffmpeg, local);
      if (info.duracion <= 0) throw new ErrorTrabajo("No se pudo leer la duración del vídeo");
      const hoja = await hojaContactos(deps.ffmpeg, deps.sharp, local, info, dir);
      await subir(s, `previas/${a.proyecto_id}/${a.id}-hoja.jpg`, hoja.jpeg, "image/jpeg");
      const poster = path.join(dir, "poster.jpg");
      await ejecutar(deps.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.min(0.5, info.duracion / 2)), "-i", local, "-frames:v", "1", "-vf", "scale=1024:1024:force_original_aspect_ratio=decrease", "-q:v", "3", poster], { timeoutMs: 30_000 });
      const { readFile } = await import("node:fs/promises");
      await subir(s, previa, await readFile(poster), "image/jpeg");
      let audioRuta: string | null = null;
      let volumen: number | null = null;
      if (info.tieneAudio) {
        const audio = await extraerAudio(deps.ffmpeg, local, path.join(dir, "audio.m4a"));
        volumen = audio?.volumenMedio ?? null;
        // Por debajo de −50 dB es silencio o ruido: no se transcribe.
        if (audio && (volumen === null || volumen > -50)) {
          audioRuta = `audio/${a.proyecto_id}/${a.id}.m4a`;
          await subir(s, audioRuta, await readFile(audio.ruta), "audio/mp4");
        }
      }
      const [fila] = await actualizar<FilaArchivo>(s, "rrss_archivos", `id=eq.${a.id}`, {
        estado: "listo",
        ancho: info.ancho,
        alto: info.alto,
        duracion_s: info.duracion,
        analisis: {
          ...a.analisis,
          previa_ruta: previa,
          hoja_ruta: `previas/${a.proyecto_id}/${a.id}-hoja.jpg`,
          hoja_instantes: hoja.instantes,
          audio_ruta: audioRuta,
          tiene_audio: info.tieneAudio,
          volumen_medio: volumen,
          hdr: info.hdr,
          rotacion: info.rotacion,
          fps: info.fps,
          codec: info.codec,
        },
      });
      return fila;
    } finally {
      await limpiar(dir);
    }
  } catch (e) {
    await actualizar(s, "rrss_archivos", `id=eq.${a.id}`, { estado: "error", error: mensaje(e) }).catch(() => undefined);
    throw e;
  }
}

// ── Generaciones ────────────────────────────────────────────────────────────

/** Reclama la generación (pendiente, o procesando con el lease vencido). null si ya la tiene otro o ya acabó. */
export async function reclamarGeneracion(s: SesionRrss, id: string, deps: DependenciasTrabajo, medio?: "foto" | "video"): Promise<FilaGeneracion | null> {
  if (!uuid.test(id)) throw new ErrorTrabajo("Generación no válida");
  const [g] = await seleccionar<FilaGeneracion>(s, "rrss_generaciones", `id=eq.${id}&select=id,proyecto_id,medio,piezas,plan,estado,intentos,lease_hasta`);
  if (!g) throw new ErrorTrabajo("Esa generación no existe", 404);
  if (medio && g.medio !== medio) throw new ErrorTrabajo(`Esta generación es de ${g.medio === "video" ? "vídeo: va por /api/rrss-video" : "fotos: va por /api/rrss-foto"}`);
  const ahora = (deps.ahora ?? (() => new Date()))();
  const lease = new Date(ahora.getTime() + LEASE_MIN * 60_000).toISOString();
  if (g.intentos >= 3) {
    await actualizar(s, "rrss_generaciones", `id=eq.${id}&estado=in.(pendiente,procesando)`, { estado: "error", error: "Se ha intentado 3 veces sin terminar", terminado_at: ahora.toISOString() });
    return null;
  }
  const filtro = `id=eq.${id}&or=(estado.eq.pendiente,and(estado.eq.procesando,lease_hasta.lt.${encodeURIComponent(ahora.toISOString())}))`;
  const [reclamada] = await actualizar<FilaGeneracion>(s, "rrss_generaciones", filtro, { estado: "procesando", lease_hasta: lease, intentos: g.intentos + 1, progreso: { fraccion: 0, paso: "Empezando" } });
  return reclamada ?? null;
}

async function cancelada(s: SesionRrss, id: string): Promise<boolean> {
  const [g] = await seleccionar<{ estado: string }>(s, "rrss_generaciones", `id=eq.${id}&select=estado`).catch(() => [] as { estado: string }[]);
  return g?.estado === "cancelado";
}

function contexto(p: FilaProyecto, archivos: FilaArchivo[]): { formato: FormatoSalida; estilo: EstiloId } {
  if (!esCanal(p.canal) || !esTipoContenido(p.tipo)) throw new ErrorTrabajo("El trabajo tiene un canal o un tipo no válido");
  const hayVideos = archivos.some((a) => a.tipo === "video");
  return { formato: formatoSalida(p.canal, p.tipo, hayVideos), estilo: esEstilo(p.estilo) ? p.estilo : "elegante" };
}

async function guardarResultado(
  s: SesionRrss,
  g: FilaGeneracion,
  indice: number,
  datos: { medio: "foto" | "video"; bytes: Buffer; tipo: string; ext: "jpg" | "mp4"; ancho: number; alto: number; duracion?: number; portada?: Buffer; receta: unknown; avisos: string[] },
): Promise<void> {
  const ruta = `resultados/${g.proyecto_id}/${g.id}/${indice}.${datos.ext}`;
  await subir(s, ruta, datos.bytes, datos.tipo);
  let portada: string | null = null;
  if (datos.portada) {
    portada = `resultados/${g.proyecto_id}/${g.id}/${indice}-portada.jpg`;
    await subir(s, portada, datos.portada, "image/jpeg");
  }
  await actualizar(s, "rrss_resultados", `proyecto_id=eq.${g.proyecto_id}&indice=eq.${indice}&vigente=eq.true`, { vigente: false });
  await insertar(s, "rrss_resultados", {
    proyecto_id: g.proyecto_id,
    generacion_id: g.id,
    indice,
    medio: datos.medio,
    ruta,
    portada_ruta: portada,
    ancho: datos.ancho,
    alto: datos.alto,
    duracion_s: datos.duracion ?? null,
    bytes: datos.bytes.byteLength,
    receta: datos.receta,
    avisos: datos.avisos.slice(0, 20),
  });
}

async function progreso(s: SesionRrss, id: string, fraccion: number, paso: string): Promise<void> {
  await actualizar(s, "rrss_generaciones", `id=eq.${id}&estado=eq.procesando`, { progreso: { fraccion: Math.round(fraccion * 100) / 100, paso } }).catch(() => undefined);
}

/** Procesa una generación ya reclamada. Nunca lanza: deja la fila en «listo», «error» o «cancelado». */
export async function procesarGeneracion(s: SesionRrss, g: FilaGeneracion, deps: DependenciasTrabajo): Promise<{ estado: string; error?: string }> {
  const avisos: string[] = [];
  try {
    const [p] = await seleccionar<FilaProyecto>(s, "rrss_proyectos", `id=eq.${g.proyecto_id}&select=id,marca,canal,tipo,estilo,permitir_creativo`);
    if (!p) throw new ErrorTrabajo("El trabajo ya no existe", 404);
    const archivos = await seleccionar<FilaArchivo>(s, "rrss_archivos", `proyecto_id=eq.${p.id}&select=${COL_ARCHIVO}&order=orden.asc`);
    const { formato, estilo } = contexto(p, archivos);
    const conVoz = archivos.filter((a) => Array.isArray(a.analisis?.transcripcion) && (a.analisis.transcripcion as unknown[]).length > 0).map((a) => a.id);
    const plan: PlanEdicion = normalizarPlan(g.plan, {
      archivos: archivos.map((a) => ({ id: a.id, tipo: a.tipo, duracion_s: a.duracion_s === null ? null : Number(a.duracion_s) })),
      formato,
      estilo,
      permitirCreativo: p.permitir_creativo,
      conVoz,
    });
    avisos.push(...plan.avisos);
    if (plan.piezas.length === 0) throw new ErrorTrabajo("El plan no tiene ninguna pieza que hacer");
    const porId = new Map(archivos.map((a) => [a.id, a]));
    const indices = (g.piezas ?? plan.piezas.map((_, i) => i)).filter((i) => i >= 0 && i < plan.piezas.length);

    if (formato.medio === "foto") {
      for (let k = 0; k < indices.length; k++) {
        if (await cancelada(s, g.id)) return { estado: "cancelado" };
        const i = indices[k];
        const pieza = plan.piezas[i] as PiezaFoto;
        await progreso(s, g.id, k / indices.length, `Editando la foto ${k + 1} de ${indices.length}`);
        const archivo = porId.get(pieza.archivo);
        if (!archivo) throw new ErrorTrabajo("Falta una foto del trabajo");
        const original = await descargarBytes(s, archivo.ruta);
        const receta = recetaFoto(pieza, p.marca, plan.estilo, formato);
        const r = await editarFoto(original, receta, { sharp: deps.sharp, mascara: deps.mascara });
        await guardarResultado(s, g, i, { medio: "foto", bytes: r.jpeg, tipo: "image/jpeg", ext: "jpg", ancho: r.ancho, alto: r.alto, receta: { pieza, estilo: plan.estilo, tratamiento: receta.tratamiento, recorte: r.recorte }, avisos: r.avisos });
        avisos.push(...r.avisos.map((a) => `Foto ${i + 1}: ${a}`));
      }
      if (!g.piezas) await actualizar(s, "rrss_resultados", `proyecto_id=eq.${p.id}&indice=gte.${plan.piezas.length}&vigente=eq.true`, { vigente: false });
    } else {
      if (!deps.ffmpeg) throw new ErrorTrabajo("Los vídeos se montan en /api/rrss-video");
      const pieza = plan.piezas[0] as PiezaVideo;
      const dir = dirTemporal(deps, "video");
      await mkdir(dir, { recursive: true });
      const vigilante = setInterval(() => {
        void cancelada(s, g.id).then((c) => c && control.abort());
      }, 4000);
      const control = new AbortController();
      try {
        await progreso(s, g.id, 0.02, "Preparando los clips");
        const fuentes = new Map<string, FuenteToma>();
        const transcripciones = new Map<string, Segmento[]>();
        for (const id of new Set(pieza.tomas.map((t) => t.archivo))) {
          const a = porId.get(id);
          if (!a) throw new ErrorTrabajo("Falta un archivo del vídeo");
          const local = path.join(dir, `${a.id}${path.extname(a.ruta)}`);
          await descargarAFichero(s, a.ruta, local);
          fuentes.set(a.id, { ruta: local, medio: a.tipo, ancho: Number(a.ancho ?? 0), alto: Number(a.alto ?? 0), tieneAudio: a.analisis?.tiene_audio === true, hdr: a.analisis?.hdr === true });
          if (a.tipo === "video" && (!a.ancho || !a.alto)) {
            const info = await analizarMedio(deps.ffmpeg, local);
            fuentes.set(a.id, { ...fuentes.get(a.id)!, ancho: info.ancho, alto: info.alto, tieneAudio: info.tieneAudio, hdr: info.hdr });
          }
          const tr = a.analisis?.transcripcion;
          if (Array.isArray(tr)) transcripciones.set(a.id, tr as Segmento[]);
        }
        const receta = recetaVideo(pieza, p.marca, plan.estilo, formato, fuentes, transcripciones);
        await progreso(s, g.id, 0.08, "Montando el vídeo");
        const v = await montarVideo(receta, {
          ffmpeg: deps.ffmpeg,
          sharp: deps.sharp,
          dirTrabajo: path.join(dir, "montaje"),
          signal: control.signal,
          alProgreso: (fr) => void progreso(s, g.id, 0.08 + 0.82 * fr, "Montando el vídeo"),
        });
        if (control.signal.aborted) return { estado: "cancelado" };
        await progreso(s, g.id, 0.93, "Guardando el vídeo");
        await guardarResultado(s, g, 0, { medio: "video", bytes: v.mp4, tipo: "video/mp4", ext: "mp4", ancho: v.ancho, alto: v.alto, duracion: v.duracion, portada: v.portada, receta: { pieza, estilo: plan.estilo, subtitulos: receta.subtitulos.length }, avisos: v.avisos });
        avisos.push(...v.avisos);
      } finally {
        clearInterval(vigilante);
        await limpiar(dir);
      }
    }
    await actualizar(s, "rrss_generaciones", `id=eq.${g.id}&estado=eq.procesando`, {
      estado: "listo",
      progreso: { fraccion: 1, paso: "Listo" },
      avisos: [...new Set(avisos)].slice(0, 30),
      terminado_at: new Date().toISOString(),
      lease_hasta: null,
    });
    return { estado: "listo" };
  } catch (e) {
    if (await cancelada(s, g.id)) return { estado: "cancelado" };
    const error = mensaje(e);
    await actualizar(s, "rrss_generaciones", `id=eq.${g.id}`, { estado: "error", error, terminado_at: new Date().toISOString(), lease_hasta: null, avisos: [...new Set(avisos)].slice(0, 30) }).catch(() => undefined);
    return { estado: "error", error };
  }
}
