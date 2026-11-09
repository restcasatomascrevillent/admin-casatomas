/**
 * RRSS · capa de datos del panel (pestañas Facebook y Subida de fotos).
 *
 *   Tablas rrss_* (RLS de Marketing: leer con «Ver», escribir con «Editar»)
 *   Cubo PRIVADO «rrss»: originales, previas, audio y resultados (URL firmadas)
 *   IA que propone:       Edge Function rrss-ia (Supabase)        → proponer, pieza, textos, ideas, transcribir
 *   Motor que transforma: /api/rrss-foto y /api/rrss-video (Vercel) → analizar, generar
 *
 * Nada de aquí publica en ninguna red social.
 */
import { supabase } from "@/integrations/supabase/client";
import { auditDeviceId } from "@/lib/audit-device";
import type { EstiloId } from "@/lib/rrss/estilos";
import type { Canal, Medio, TipoContenido } from "@/lib/rrss/formatos";
import type { PlanEdicion, TextosPublicacion } from "@/lib/rrss/plan";
import type { MarcaId } from "@/lib/instagram/tokens";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");
export const BUCKET_RRSS = "rrss";
export const URL_IA_RRSS = `${SUPABASE_URL}/functions/v1/rrss-ia`;
/** 50 MB: el máximo por archivo del plan de Supabase (y del cubo). */
export const BYTES_MAXIMOS = 50 * 1024 * 1024;
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export const TIPOS_VIDEO = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"] as const;
export const ACEPTA_ARCHIVOS = "image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,video/x-m4v,.heic,.heif,.mov,.m4v";

// ── Tipos de las filas ──────────────────────────────────────────────────────

export type EstadoProyecto = "borrador" | "listo" | "archivado";
export type EstadoArchivo = "subido" | "analizando" | "listo" | "error";
export type EstadoGeneracion = "pendiente" | "procesando" | "listo" | "error" | "cancelado";

export interface Proyecto {
  id: string;
  marca: MarcaId;
  canal: Canal;
  tipo: TipoContenido;
  estilo: EstiloId;
  instrucciones: string;
  permitir_creativo: boolean;
  origen: "editor" | "facebook";
  titulo: string;
  plan: PlanEdicion | null;
  plan_ia: PlanEdicion | null;
  textos: Partial<TextosPublicacion>;
  estado: EstadoProyecto;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface Segmento {
  inicio: number;
  fin: number;
  texto: string;
}

export interface AnalisisArchivo {
  previa_ruta?: string;
  hoja_ruta?: string;
  hoja_instantes?: number[];
  audio_ruta?: string | null;
  tiene_audio?: boolean;
  volumen_medio?: number | null;
  hdr?: boolean;
  transcripcion?: Segmento[];
  transcripcion_texto?: string;
}

export interface Archivo {
  id: string;
  proyecto_id: string;
  tipo: Medio;
  ruta: string;
  nombre: string;
  mime: string;
  bytes: number;
  ancho: number | null;
  alto: number | null;
  duracion_s: number | null;
  orden: number;
  estado: EstadoArchivo;
  analisis: AnalisisArchivo;
  error: string | null;
  created_at: string;
}

export interface Generacion {
  id: string;
  proyecto_id: string;
  medio: Medio;
  piezas: number[] | null;
  estado: EstadoGeneracion;
  progreso: { fraccion?: number; paso?: string };
  avisos: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
  terminado_at: string | null;
}

export interface Resultado {
  id: string;
  proyecto_id: string;
  generacion_id: string | null;
  indice: number;
  medio: Medio;
  ruta: string;
  portada_ruta: string | null;
  ancho: number;
  alto: number;
  duracion_s: number | null;
  bytes: number;
  receta: Record<string, unknown>;
  avisos: string[];
  vigente: boolean;
  created_at: string;
}

export interface PlanoIdea {
  descripcion: string;
  duracion_s: number;
  orientacion: "vertical" | "horizontal";
  luz: string;
  encuadre: string;
  movimiento: string;
}

export interface IdeaGrabar {
  titulo: string;
  idea: string;
  objetivo: string;
  formato: TipoContenido;
  gancho: string;
  guion: string[];
  planos: PlanoIdea[];
  duracion_total_s: number;
  texto_pantalla: string[];
  voz_en_off: string | null;
  material: string[];
  copy: string;
  cta: string;
}

export interface FilaIdeas {
  id: string;
  marca: MarcaId;
  canal: Canal;
  tipo: TipoContenido | null;
  objetivo: { que?: string; detalle?: string; material?: string };
  propuestas: IdeaGrabar[];
  guardada: boolean;
  created_at: string;
}

// ── Errores legibles ────────────────────────────────────────────────────────

export class ErrorRrss extends Error {
  readonly tipo: "sesion" | "sin_permiso" | "cupo" | "duplicada" | "configuracion" | "ia_no_disponible" | "entrada" | "servidor" | "red";
  readonly estado?: number;
  readonly extra: Record<string, unknown>;
  constructor(mensaje: string, tipo: ErrorRrss["tipo"], estado?: number, extra: Record<string, unknown> = {}) {
    super(mensaje);
    this.name = "ErrorRrss";
    this.tipo = tipo;
    this.estado = estado;
    this.extra = extra;
  }
}

/** Mensaje en castellano de un error de PostgREST / Storage. */
export function mensajeError(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  if (/rrss_cupo_ia|rrss_cupo/.test(m)) return m.replace(/^.*?rrss_cupo(_ia)?:\s*/, "").replace(/^\w/, (c) => c.toUpperCase());
  if (/rrss_generaciones_una_activa|duplicate key/.test(m)) return "Ya hay una generación en marcha para este trabajo: espera a que termine o cancélala.";
  if (/row-level security|permission denied|42501/i.test(m)) return "Hace falta «Editar» en Marketing para hacer esto.";
  if (/relation .*rrss_.* does not exist|Could not find the table/i.test(m)) return "Falta aplicar la migración de RRSS (20261118120000_rrss) en este Supabase.";
  if (/Payload too large|exceeded the maximum allowed size|413/i.test(m)) return "El archivo pasa de 50 MB, el máximo admitido.";
  return m || "Ha fallado algo inesperado";
}

async function tokenSesion(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new ErrorRrss("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  return t;
}

// ── Trabajos (proyectos) ────────────────────────────────────────────────────

// Sin tipos generados para rrss_* (src/integrations/supabase/types.ts no los tiene todavía).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const COL_PROYECTO = "id,marca,canal,tipo,estilo,instrucciones,permitir_creativo,origen,titulo,plan,plan_ia,textos,estado,creado_por,created_at,updated_at";

export async function listarProyectos(opts: { canal?: Canal; origen?: "editor" | "facebook"; incluirArchivados?: boolean; limite?: number } = {}): Promise<Proyecto[]> {
  let q = db.from("rrss_proyectos").select(COL_PROYECTO).order("updated_at", { ascending: false }).limit(opts.limite ?? 50);
  if (opts.canal) q = q.eq("canal", opts.canal);
  if (opts.origen) q = q.eq("origen", opts.origen);
  if (!opts.incluirArchivados) q = q.neq("estado", "archivado");
  const { data, error } = await q;
  if (error) throw new Error(mensajeError(error));
  return (data ?? []) as Proyecto[];
}

export async function leerProyecto(id: string): Promise<Proyecto | null> {
  const { data, error } = await db.from("rrss_proyectos").select(COL_PROYECTO).eq("id", id).maybeSingle();
  if (error) throw new Error(mensajeError(error));
  return (data ?? null) as Proyecto | null;
}

export type NuevoProyecto = Pick<Proyecto, "marca" | "canal" | "tipo" | "estilo"> & Partial<Pick<Proyecto, "instrucciones" | "permitir_creativo" | "origen" | "titulo" | "textos">>;

export async function crearProyecto(p: NuevoProyecto): Promise<Proyecto> {
  const { data, error } = await db.from("rrss_proyectos").insert(p).select(COL_PROYECTO).single();
  if (error) throw new Error(mensajeError(error));
  return data as Proyecto;
}

export type CambiosProyecto = Partial<Pick<Proyecto, "marca" | "canal" | "tipo" | "estilo" | "instrucciones" | "permitir_creativo" | "titulo" | "plan" | "textos" | "estado">>;

export async function actualizarProyecto(id: string, cambios: CambiosProyecto): Promise<Proyecto> {
  const { data, error } = await db.from("rrss_proyectos").update(cambios).eq("id", id).select(COL_PROYECTO).single();
  if (error) throw new Error(mensajeError(error));
  return data as Proyecto;
}

/** Borra el trabajo y sus ficheros del cubo (originales, previas, audio y resultados). */
export async function borrarProyecto(id: string): Promise<void> {
  const rutas: string[] = [];
  for (const carpeta of ["originales", "previas", "audio"]) {
    const { data } = await supabase.storage.from(BUCKET_RRSS).list(`${carpeta}/${id}`, { limit: 200 });
    for (const o of data ?? []) rutas.push(`${carpeta}/${id}/${o.name}`);
  }
  const { data: gens } = await supabase.storage.from(BUCKET_RRSS).list(`resultados/${id}`, { limit: 200 });
  for (const g of gens ?? []) {
    const { data } = await supabase.storage.from(BUCKET_RRSS).list(`resultados/${id}/${g.name}`, { limit: 200 });
    for (const o of data ?? []) rutas.push(`resultados/${id}/${g.name}/${o.name}`);
  }
  if (rutas.length) await supabase.storage.from(BUCKET_RRSS).remove(rutas);
  const { error } = await db.from("rrss_proyectos").delete().eq("id", id);
  if (error) throw new Error(mensajeError(error));
}

// ── Archivos ────────────────────────────────────────────────────────────────

const COL_ARCHIVO = "id,proyecto_id,tipo,ruta,nombre,mime,bytes,ancho,alto,duracion_s,orden,estado,analisis,error,created_at";

export async function listarArchivos(proyectoId: string): Promise<Archivo[]> {
  const { data, error } = await db.from("rrss_archivos").select(COL_ARCHIVO).eq("proyecto_id", proyectoId).order("orden", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw new Error(mensajeError(error));
  return ((data ?? []) as Archivo[]).map((a) => ({ ...a, duracion_s: a.duracion_s === null ? null : Number(a.duracion_s) }));
}

export function medioDeArchivo(f: File): Medio | null {
  const t = (f.type || "").toLowerCase();
  const n = f.name.toLowerCase();
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(n)) return "foto";
  if (t.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(n)) return "video";
  return null;
}

/** Problema de un archivo antes de subirlo (null si vale). */
export function problemaArchivo(f: File): string | null {
  const medio = medioDeArchivo(f);
  if (!medio) return `«${f.name}»: solo se admiten fotos (JPEG, PNG, WebP o HEIC) y vídeos (MP4, MOV o WebM)`;
  if (f.size > BYTES_MAXIMOS) return `«${f.name}» pesa ${(f.size / 1048576).toFixed(0)} MB: el máximo es 50 MB (recorta el vídeo en el móvil o grábalo en 1080p)`;
  if (f.size === 0) return `«${f.name}» está vacío`;
  return null;
}

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v" };

/**
 * HEIC (iPhone) → JPEG en el navegador si sabe decodificarlo (Safari); el
 * motor no lee HEIC. Si no puede, lanza con un mensaje para el usuario.
 */
export async function prepararFoto(f: File): Promise<File> {
  const esHeic = /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
  if (!esHeic) return f;
  try {
    const bmp = await createImageBitmap(f);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
    if (!blob) throw new Error("sin JPEG");
    return new File([blob], f.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" });
  } catch {
    throw new ErrorRrss(`«${f.name}» es HEIC y este navegador no lo puede convertir: compártela desde el móvil como JPEG («Más compatible») o súbela desde Safari`, "entrada");
  }
}

/** Sube con progreso (XHR a la API de Storage con la sesión del usuario). */
function subirConProgreso(ruta: string, archivo: File, token: string, alProgreso?: (fraccion: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${BUCKET_RRSS}/${ruta}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", CLAVE_PUBLICA);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", archivo.type || "application/octet-stream");
    xhr.setRequestHeader("Cache-Control", "3600");
    xhr.upload.onprogress = (e) => e.lengthComputable && alProgreso?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(mensajeError(xhr.responseText || `Storage respondió ${xhr.status}`))));
    xhr.onerror = () => reject(new ErrorRrss("Se ha cortado la conexión al subir", "red"));
    xhr.onabort = () => reject(new DOMException("Cancelado", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(archivo);
  });
}

/**
 * Sube un ORIGINAL (no se toca nunca), crea su fila y pide al motor que lo
 * analice (previa, medidas; en vídeos, hoja de contactos y audio).
 */
export async function subirArchivo(proyectoId: string, archivo: File, orden: number, opts: { alProgreso?: (fraccion: number) => void; signal?: AbortSignal } = {}): Promise<Archivo> {
  const problema = problemaArchivo(archivo);
  if (problema) throw new ErrorRrss(problema, "entrada");
  const medio = medioDeArchivo(archivo) as Medio;
  const f = medio === "foto" ? await prepararFoto(archivo) : archivo;
  const tipo = (f.type || (medio === "video" ? "video/mp4" : "image/jpeg")).toLowerCase();
  const ext = EXTENSION[tipo] ?? (medio === "video" ? "mp4" : "jpg");
  const id = crypto.randomUUID();
  const ruta = `originales/${proyectoId}/${id}.${ext}`;
  const token = await tokenSesion();
  await subirConProgreso(ruta, new File([f], f.name, { type: tipo }), token, opts.alProgreso, opts.signal);
  const { data, error } = await db
    .from("rrss_archivos")
    .insert({ id, proyecto_id: proyectoId, tipo: medio, ruta, nombre: archivo.name.slice(0, 200), mime: tipo, bytes: f.size, orden })
    .select(COL_ARCHIVO)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET_RRSS).remove([ruta]);
    throw new Error(mensajeError(error));
  }
  return data as Archivo;
}

export async function quitarArchivo(a: Pick<Archivo, "id" | "ruta" | "proyecto_id" | "analisis">): Promise<void> {
  const { error } = await db.from("rrss_archivos").delete().eq("id", a.id);
  if (error) throw new Error(mensajeError(error));
  const rutas = [a.ruta, a.analisis?.previa_ruta, a.analisis?.hoja_ruta, a.analisis?.audio_ruta].filter((x): x is string => typeof x === "string" && !!x);
  await supabase.storage.from(BUCKET_RRSS).remove(rutas);
}

export async function ordenarArchivos(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, orden) => db.from("rrss_archivos").update({ orden }).eq("id", id)));
}

// ── Motor (Vercel) ──────────────────────────────────────────────────────────

const rutaMotor = (medio: Medio) => (medio === "video" ? "/api/rrss-video" : "/api/rrss-foto");

async function llamarMotor(medio: Medio, cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await tokenSesion();
  let r: Response;
  try {
    r = await fetch(rutaMotor(medio), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(cuerpo) });
  } catch (e) {
    throw new ErrorRrss((e as Error)?.message || "Sin conexión con el motor", "red");
  }
  const texto = await r.text();
  let c: Record<string, unknown> = {};
  try {
    c = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    // Con `npm run dev` (vite) no hay funciones de Vercel: devuelve el index.html.
    if (r.ok || r.status === 404) throw new ErrorRrss("El motor de edición no está disponible aquí: funciona en la demo y en producción (Vercel)", "configuracion", r.status);
    throw new ErrorRrss(`El motor respondió ${r.status}`, "servidor", r.status);
  }
  if (r.ok) return c;
  const mensaje = typeof c.error === "string" ? c.error : `El motor respondió ${r.status}`;
  if (r.status === 401) throw new ErrorRrss(mensaje, "sesion", 401);
  if (r.status === 403) throw new ErrorRrss(mensaje, "sin_permiso", 403);
  if (r.status === 409) throw new ErrorRrss(mensaje, "duplicada", 409);
  throw new ErrorRrss(mensaje, "servidor", r.status);
}

/** Analiza un archivo subido (las fotos con el motor de fotos; los vídeos con el de vídeo). */
export async function analizarArchivo(a: Pick<Archivo, "id" | "tipo">): Promise<Archivo> {
  const c = await llamarMotor(a.tipo, { accion: "analizar", archivoId: a.id });
  return c.archivo as Archivo;
}

const COL_GENERACION = "id,proyecto_id,medio,piezas,estado,progreso,avisos,error,created_at,updated_at,terminado_at";

/**
 * Pide al motor que haga el plan (todas las piezas o solo `piezas`). La fila
 * se crea «pendiente» (una sola viva por trabajo: el índice único evita
 * duplicados) y el motor la procesa en segundo plano; el panel la sigue con
 * `leerUltimaGeneracion`.
 */
export async function generar(proyectoId: string, medio: Medio, plan: PlanEdicion, piezas: number[] | null = null): Promise<Generacion> {
  const { data, error } = await db.from("rrss_generaciones").insert({ proyecto_id: proyectoId, medio, plan, piezas }).select(COL_GENERACION).single();
  if (error) {
    const m = mensajeError(error);
    throw new ErrorRrss(m, /en marcha/.test(m) ? "duplicada" : /tope/.test(m) ? "cupo" : "servidor");
  }
  const g = data as Generacion;
  try {
    await llamarMotor(medio, { accion: "generar", generacionId: g.id });
  } catch (e) {
    // El motor no la ha cogido: se deja en error para poder volver a pedirla.
    if (!(e instanceof ErrorRrss && e.tipo === "duplicada")) {
      await db.from("rrss_generaciones").update({ estado: "error", error: (e as Error).message.slice(0, 1000), terminado_at: new Date().toISOString() }).eq("id", g.id).in("estado", ["pendiente"]);
    }
    throw e;
  }
  return g;
}

export async function leerUltimaGeneracion(proyectoId: string): Promise<Generacion | null> {
  const { data, error } = await db.from("rrss_generaciones").select(COL_GENERACION).eq("proyecto_id", proyectoId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(mensajeError(error));
  return (data ?? null) as Generacion | null;
}

export async function cancelarGeneracion(id: string): Promise<void> {
  const { error } = await db.from("rrss_generaciones").update({ estado: "cancelado", terminado_at: new Date().toISOString() }).eq("id", id).in("estado", ["pendiente", "procesando"]);
  if (error) throw new Error(mensajeError(error));
}

export const generacionActiva = (g: Generacion | null | undefined) => !!g && (g.estado === "pendiente" || g.estado === "procesando");

const COL_RESULTADO = "id,proyecto_id,generacion_id,indice,medio,ruta,portada_ruta,ancho,alto,duracion_s,bytes,receta,avisos,vigente,created_at";

export async function listarResultados(proyectoId: string): Promise<Resultado[]> {
  const { data, error } = await db.from("rrss_resultados").select(COL_RESULTADO).eq("proyecto_id", proyectoId).eq("vigente", true).order("indice", { ascending: true });
  if (error) throw new Error(mensajeError(error));
  return ((data ?? []) as Resultado[]).map((r) => ({ ...r, duracion_s: r.duracion_s === null ? null : Number(r.duracion_s) }));
}

// ── URL firmadas y descargas ────────────────────────────────────────────────

/** URL firmadas (1 h) de varias rutas del cubo privado. */
export async function urlsFirmadas(rutas: string[], segundos = 3600): Promise<Record<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))];
  if (unicas.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET_RRSS).createSignedUrls(unicas, segundos);
  if (error) throw new Error(mensajeError(error));
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

/** Descarga un archivo del cubo con un nombre legible. */
export async function descargar(ruta: string, nombre: string): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET_RRSS).download(ruta);
  if (error || !data) throw new Error(mensajeError(error ?? "No se pudo descargar"));
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function nombreDescarga(p: Pick<Proyecto, "titulo" | "canal" | "tipo">, r: Pick<Resultado, "indice" | "medio">): string {
  const base = (p.titulo || `${p.canal}-${p.tipo}`).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 50) || "rrss";
  return `${base}-${String(r.indice + 1).padStart(2, "0")}.${r.medio === "video" ? "mp4" : "jpg"}`;
}

// ── IA (Edge Function rrss-ia) ──────────────────────────────────────────────

export async function llamarIA<T = Record<string, unknown>>(cuerpo: Record<string, unknown>): Promise<T> {
  const token = await tokenSesion();
  let r: Response;
  try {
    r = await fetch(URL_IA_RRSS, {
      method: "POST",
      body: JSON.stringify(cuerpo),
      headers: { "Content-Type": "application/json", apikey: CLAVE_PUBLICA, "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}`, Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new ErrorRrss((e as Error)?.message || "Sin conexión", "red");
  }
  let c: Record<string, unknown> = {};
  try {
    c = ((await r.json()) ?? {}) as Record<string, unknown>;
  } catch {
    throw new ErrorRrss(`Respuesta no válida de la IA (${r.status})`, "servidor", r.status);
  }
  if (r.ok) return c as T;
  const mensaje = typeof c.error === "string" ? c.error : typeof c.message === "string" ? c.message : `La IA respondió ${r.status}`;
  if (r.status === 404 && typeof c.error !== "string") throw new ErrorRrss("La IA de RRSS no está desplegada en este Supabase (docs/rrss.md)", "configuracion", 404);
  if (r.status === 401) throw new ErrorRrss(mensaje, "sesion", 401);
  if (r.status === 403) throw new ErrorRrss(mensaje, "sin_permiso", 403);
  if (r.status === 429) throw new ErrorRrss(mensaje, "cupo", 429);
  if (r.status === 400 || r.status === 409 || r.status === 422) throw new ErrorRrss(mensaje, "entrada", r.status, c);
  if (r.status === 503 || c.tipo === "ia_no_disponible") throw new ErrorRrss(mensaje, "ia_no_disponible", r.status);
  throw new ErrorRrss(mensaje, "servidor", r.status);
}

export interface RespuestaPlan {
  plan: PlanEdicion;
  avisos: string[];
  modelo: string;
}

export const proponerPlan = (proyectoId: string) => llamarIA<RespuestaPlan>({ accion: "proponer", proyectoId });
export const proponerPieza = (proyectoId: string, indice: number, indicacion?: string) => llamarIA<RespuestaPlan & { indice: number }>({ accion: "pieza", proyectoId, indice, indicacion });
export const proponerTextos = (proyectoId: string, indicacion?: string) => llamarIA<{ textos: TextosPublicacion; avisos: string[] }>({ accion: "textos", proyectoId, indicacion });
export const transcribir = (archivoId: string) => llamarIA<{ segmentos: Segmento[]; texto: string }>({ accion: "transcribir", archivoId });

export type QuePromocionar = "plato" | "vino" | "menu" | "evento" | "ambiente" | "equipo";

export interface PeticionIdeas {
  marca: MarcaId;
  canal: Canal;
  tipo?: TipoContenido | null;
  promocionar: { tipo: QuePromocionar; detalle?: string; platoId?: string | null; vinoId?: string | null };
  material?: string;
}

export const pedirIdeas = (p: PeticionIdeas) => llamarIA<{ id: string | null; ideas: IdeaGrabar[]; preguntas: string[]; avisos: string[] }>({ accion: "ideas", ...p });

export async function listarIdeas(limite = 20): Promise<FilaIdeas[]> {
  const { data, error } = await db.from("rrss_ideas").select("id,marca,canal,tipo,objetivo,propuestas,guardada,created_at").order("created_at", { ascending: false }).limit(limite);
  if (error) throw new Error(mensajeError(error));
  return (data ?? []) as FilaIdeas[];
}

export async function guardarIdeas(id: string, guardada: boolean): Promise<void> {
  const { error } = await db.from("rrss_ideas").update({ guardada }).eq("id", id);
  if (error) throw new Error(mensajeError(error));
}

/** Texto de una idea para copiar (guion, planos y copy). */
export function ideaComoTexto(i: IdeaGrabar): string {
  const lineas = [
    i.titulo.toUpperCase(),
    `${i.idea} · Objetivo: ${i.objetivo}`,
    `Formato: ${i.formato} · ${Math.round(i.duracion_total_s)} s`,
    `Gancho: ${i.gancho}`,
    "",
    "GUION",
    ...i.guion.map((g, n) => `${n + 1}. ${g}`),
    "",
    "PLANOS",
    ...i.planos.map((p, n) => `${n + 1}. ${p.descripcion} (${p.duracion_s} s) — ${p.orientacion}; luz: ${p.luz}; encuadre: ${p.encuadre}; movimiento: ${p.movimiento}`),
    "",
    i.texto_pantalla.length ? `Texto en pantalla: ${i.texto_pantalla.join(" / ")}` : "",
    i.voz_en_off ? `Voz en off: ${i.voz_en_off}` : "",
    `Material: ${i.material.join(", ")}`,
    "",
    i.copy,
    i.cta,
  ];
  return lineas.filter((l, n, arr) => !(l === "" && arr[n - 1] === "")).join("\n").trim();
}

/** Texto de la publicación listo para pegar (caption + hashtags). */
export function textoParaCopiar(t: Partial<TextosPublicacion>): string {
  return [t.caption?.trim(), (t.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
}
