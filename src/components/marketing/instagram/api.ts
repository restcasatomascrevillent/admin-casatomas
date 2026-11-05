/**
 * Llamadas de Marketing › Instagram con el JWT de la sesión:
 *
 *  - Render (JPEG): función de Vercel `/api/instagram-render` (necesita
 *    Chromium; no usa secretos de Meta). En local (`vite`) NO existe: Vite
 *    contesta con el index.html (200, text/html) o con un 404, y en vez de
 *    fallar con un «Unexpected token <» se lanza un ErrorInstagram de tipo
 *    «sin-servidor» con un texto claro.
 *  - Publicar y comprobar la conexión: Edge Functions de Supabase
 *    (`instagram-publicar` e `instagram-estado`), donde viven los secretos de
 *    Meta. Funcionan también en local: van al Supabase de VITE_SUPABASE_URL
 *    con la clave pública (`apikey`) y el JWT, como el resto de funciones.
 *  - Biblioteca de fotos en Google Drive: Edge Function `instagram-drive`
 *    (listar, subir, miniatura y preparar la copia temporal en el bucket),
 *    también para las fotos de la carta (preparar con origen «carta»).
 */
import { supabase } from "@/integrations/supabase/client";
import type { FotoDrive, MarcaId } from "@/lib/instagram";
import { auditDeviceId } from "@/lib/audit-device";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");

export const URL_RENDER = "/api/instagram-render";
export const URL_PUBLICAR = `${SUPABASE_URL}/functions/v1/instagram-publicar`;
export const URL_ESTADO = `${SUPABASE_URL}/functions/v1/instagram-estado`;
export const URL_DRIVE = `${SUPABASE_URL}/functions/v1/instagram-drive`;

export const MENSAJE_SIN_SERVIDOR =
  "La imagen definitiva solo se genera en la demo de Vercel: en local (npm run dev) no existe la función /api/instagram-render.";

export type TipoErrorInstagram = "sin-servidor" | "sesion" | "validacion" | "servidor" | "red";

export class ErrorInstagram extends Error {
  constructor(
    mensaje: string,
    readonly tipo: TipoErrorInstagram,
    readonly estado?: number,
    /** Pasos para arreglarlo que devuelve la función (si los hay). */
    readonly comoArreglarlo?: string | string[],
    /** Problemas de validación (422 de instagram-render). */
    readonly problemas?: string[],
  ) {
    super(mensaje);
    this.name = "ErrorInstagram";
  }
}

export interface RespuestaRender {
  id: string;
  urlJpeg: string;
  ancho: number;
  alto: number;
  avisos?: string[];
}

export type EstadoPublicacion = "prueba_ok" | "publicada" | "en_proceso" | "error" | string;

export interface Cuota {
  usadas: number;
  /** null si Meta no devuelve el total. */
  total: number | null;
  ventanaHoras?: number | null;
}

/** Cuenta de Instagram con la que se publica una pieza (la de su marca o la general). */
export interface CuentaPublicacion {
  marca: string;
  igUserId: string | null;
  /** true si la marca tiene secretos propios (IG_USER_ID_<MARCA>…). */
  propia: boolean;
}

/** Respuesta de instagram-publicar, ya normalizada. */
export interface RespuestaPublicar {
  cuenta: CuentaPublicacion | null;
  /** «programada», «publicacion_en_curso»… en los 409. */
  tipo?: string | null;
  estado: EstadoPublicacion;
  contenedorId: string | null;
  /** Estado del contenedor en Meta (FINISHED, IN_PROGRESS…). */
  estadoContenedor: string | null;
  cuota: Cuota | null;
  urlJpeg: string | null;
  permalink: string | null;
  avisos: string[];
  mensaje: string | null;
}

export type EstadoComprobacion = "ok" | "falla" | "aviso";

export interface Comprobacion {
  seccion?: string;
  nombre: string;
  estado: EstadoComprobacion;
  detalle?: string;
  comoArreglarlo?: string;
}

/** Bloque «drive» de instagram-estado: Google Drive (archivo de fotos y publicadas). */
export interface EstadoDrive {
  ok: boolean;
  /** «completo», «drive.file», «otro» o null si no se pudo saber. */
  alcance: string | null;
  alcances: string[];
  carpeta: { nombre: string; escribible: boolean } | null;
  comprobaciones: Comprobacion[];
  avisos: string[];
}

/** En qué cuenta publica cada marca (de instagram-estado). */
export interface CuentaDeMarca {
  marca: MarcaId;
  propia: boolean;
  igUserId: string | null;
  username: string | null;
  /** Secretos de los que sale: IG_USER_ID_TOUZA o IG_USER_ID… */
  variableIgUserId: string;
  variableToken: string;
  estado: EstadoComprobacion;
  detalle: string;
}

/** Respuesta de instagram-estado, ya normalizada. Nunca trae valores secretos. */
export interface RespuestaEstado {
  ok: boolean;
  /** Vacío si la función desplegada aún no distingue marcas. */
  cuentasPorMarca: CuentaDeMarca[];
  variables: Comprobacion[];
  comprobaciones: Comprobacion[];
  cuenta: { id: string | null; username: string } | null;
  cuota: Cuota | null;
  avisos: string[];
  comoArreglarlo: string[];
  entornoSupabase?: string;
  /** null si la función desplegada aún no comprueba Drive. */
  drive: EstadoDrive | null;
}

export interface OpcionesLlamada {
  fetch?: typeof fetch;
  /** JWT; por defecto el de la sesión actual. */
  token?: string | null;
}

/** Cabeceras extra de las Edge Functions: clave pública + identificador del panel (auditoría). */
function cabecerasEdge(): Record<string, string> {
  return { apikey: CLAVE_PUBLICA, "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}` };
}

async function tokenSesion(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function esJson(r: Response): boolean {
  return (r.headers.get("content-type") ?? "").includes("application/json");
}

async function llamar<T>(url: string, init: RequestInit, opts: OpcionesLlamada = {}, extra: Record<string, string> = {}): Promise<T> {
  const token = opts.token === undefined ? await tokenSesion() : opts.token;
  if (!token) throw new ErrorInstagram("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  const f = opts.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(url, {
      ...init,
      // FormData lleva su propio Content-Type (multipart con frontera): no se pisa.
      headers: { ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...extra, Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new ErrorInstagram((e as Error)?.message || "Sin conexión", "red");
  }
  // En local, Vite responde con HTML (o 404 vacío): no hay función de Vercel detrás.
  if (!esJson(r)) {
    if (url === URL_RENDER && (r.status === 404 || r.ok || (r.headers.get("content-type") ?? "").includes("text/html"))) {
      throw new ErrorInstagram(MENSAJE_SIN_SERVIDOR, "sin-servidor", r.status);
    }
    throw new ErrorInstagram(`El servidor respondió ${r.status}`, "servidor", r.status);
  }
  let cuerpo: unknown;
  try {
    cuerpo = await r.json();
  } catch {
    throw new ErrorInstagram(`Respuesta no válida del servidor (${r.status})`, "servidor", r.status);
  }
  if (!r.ok) {
    const c = (cuerpo ?? {}) as { error?: string; message?: string; comoArreglarlo?: string | string[]; problemas?: string[] };
    if (r.status === 422 && Array.isArray(c.problemas)) {
      throw new ErrorInstagram(c.error ?? "La pieza tiene problemas", "validacion", 422, c.comoArreglarlo, c.problemas);
    }
    // La pasarela de Supabase contesta 404 { message } si la Edge Function no está desplegada.
    if (r.status === 404 && !c.error && url !== URL_RENDER) {
      throw new ErrorInstagram(
        "La función de Instagram no está desplegada en este Supabase.",
        "servidor",
        404,
        "Despliégala desde la raíz del repo: npx supabase functions deploy instagram-drive instagram-publicar instagram-estado --project-ref <ref del proyecto> (docs/instagram.md).",
      );
    }
    const tipo: TipoErrorInstagram = r.status === 401 || r.status === 403 ? "sesion" : "servidor";
    throw new ErrorInstagram(c.error ?? c.message ?? `El servidor respondió ${r.status}`, tipo, r.status, c.comoArreglarlo);
  }
  return cuerpo as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON del servidor sin tipar: se normaliza justo aquí.
type Crudo = Record<string, any>;

function normalizarEstadoComprobacion(e: unknown): EstadoComprobacion {
  return e === "ok" ? "ok" : e === "aviso" ? "aviso" : "falla";
}

function normalizarCuota(c: unknown): Cuota | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Crudo;
  if (typeof o.usadas !== "number") return null;
  return { usadas: o.usadas, total: typeof o.total === "number" ? o.total : null, ventanaHoras: o.ventanaHoras ?? null };
}

export function normalizarPublicar(r: Crudo): RespuestaPublicar {
  const c = r.cuenta;
  return {
    cuenta: c && typeof c === "object" && typeof c.marca === "string" ? { marca: c.marca, igUserId: c.igUserId ?? null, propia: c.propia === true } : null,
    tipo: typeof r.tipo === "string" ? r.tipo : null,
    estado: String(r.estado ?? ""),
    contenedorId: r.contenedor?.id ?? r.contenedorId ?? null,
    estadoContenedor: r.contenedor?.estado ?? null,
    cuota: normalizarCuota(r.cuota),
    urlJpeg: r.urlJpeg ?? null,
    permalink: r.permalink ?? null,
    avisos: Array.isArray(r.avisos) ? r.avisos.map(String) : [],
    mensaje: typeof r.mensaje === "string" ? r.mensaje : null,
  };
}

export function normalizarEstado(r: Crudo): RespuestaEstado {
  const comp = (x: Crudo): Comprobacion => ({
    seccion: x.seccion,
    nombre: String(x.nombre ?? ""),
    estado: normalizarEstadoComprobacion(x.estado),
    detalle: x.detalle ?? undefined,
    comoArreglarlo: x.comoArreglarlo ?? undefined,
  });
  const variables = Array.isArray(r.variables) ? r.variables.map(comp) : [];
  const comprobaciones = Array.isArray(r.comprobaciones) ? r.comprobaciones.map(comp) : [];
  const username = r.identidad?.username ?? r.cuenta?.username ?? null;
  const pasos = new Set<string>();
  for (const x of [...variables, ...comprobaciones]) if (x.estado !== "ok" && x.comoArreglarlo) pasos.add(x.comoArreglarlo);
  for (const x of [r.comoArreglarlo].flat()) if (typeof x === "string" && x) pasos.add(x);
  const cuentasPorMarca: CuentaDeMarca[] = Array.isArray(r.cuentasPorMarca)
    ? r.cuentasPorMarca
        .filter((x: Crudo) => x && (x.marca === "casa-tomas" || x.marca === "touza"))
        .map((x: Crudo) => ({
          marca: x.marca as MarcaId,
          propia: x.propia === true,
          igUserId: typeof x.igUserId === "string" ? x.igUserId : null,
          username: typeof x.username === "string" ? x.username : null,
          variableIgUserId: String(x.variableIgUserId ?? "IG_USER_ID"),
          variableToken: String(x.variableToken ?? "IG_ACCESS_TOKEN"),
          estado: normalizarEstadoComprobacion(x.estado),
          detalle: String(x.detalle ?? ""),
        }))
    : [];
  return {
    ok: r.ok === true,
    cuentasPorMarca,
    variables,
    comprobaciones,
    cuenta: username ? { id: r.identidad?.igUserId ?? r.cuenta?.id ?? null, username } : null,
    cuota: normalizarCuota(r.cuota),
    avisos: [...(Array.isArray(r.avisos) ? r.avisos : []), ...(Array.isArray(r.noVerificado) ? r.noVerificado : [])].map(String),
    comoArreglarlo: [...pasos],
    entornoSupabase: r.entornoSupabase,
    drive: normalizarDrive(r.drive),
  };
}

function normalizarDrive(d: unknown): EstadoDrive | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Crudo;
  return {
    ok: o.ok === true,
    alcance: typeof o.alcance === "string" ? o.alcance : null,
    alcances: Array.isArray(o.alcances) ? o.alcances.map(String) : [],
    carpeta: o.carpeta && typeof o.carpeta.nombre === "string" ? { nombre: o.carpeta.nombre, escribible: o.carpeta.escribible === true } : null,
    comprobaciones: Array.isArray(o.comprobaciones)
      ? o.comprobaciones.map((x: Crudo) => ({
          nombre: String(x.nombre ?? ""),
          estado: normalizarEstadoComprobacion(x.estado),
          detalle: x.detalle ?? undefined,
          comoArreglarlo: x.comoArreglarlo ?? undefined,
        }))
      : [],
    avisos: Array.isArray(o.avisos) ? o.avisos.map(String) : [],
  };
}

/**
 * @usuario de la cuenta en la que publica una marca. Si la función desplegada
 * aún no distingue marcas, la cuenta general (`cuenta`).
 */
export function cuentaDeMarca(estado: RespuestaEstado | null, marca: string): string | null {
  if (!estado) return null;
  const propia = estado.cuentasPorMarca.find((c) => c.marca === marca);
  return propia ? propia.username : (estado.cuenta?.username ?? null);
}

/** Foto de Drive ya copiada al bucket, tal como la necesita el render. */
export interface FotoPreparada {
  id: string;
  url: string;
  ancho: number;
  alto: number;
  tipo: string | null;
  marca: MarcaId;
}

/** Genera el JPEG definitivo y guarda (o actualiza, con `id`) la pieza. */
export function generarImagen(pieza: unknown, id?: string | null, opts?: OpcionesLlamada, fotoPreparada?: FotoPreparada | null) {
  const cuerpo: Record<string, unknown> = { pieza };
  if (id) cuerpo.id = id;
  if (fotoPreparada) cuerpo.fotoPreparada = fotoPreparada;
  return llamar<RespuestaRender>(URL_RENDER, { method: "POST", body: JSON.stringify(cuerpo) }, opts);
}

/**
 * Prueba (dryRun) o publicación real. `contenedorId` para reintentar uno
 * «en_proceso». `fotoTmp`: copia temporal de la foto de Drive (se borra al
 * publicar). `altText`: texto alternativo (solo posts; se guarda en la pieza).
 */
export function publicar(
  args: { id: string; caption: string; altText?: string; dryRun: boolean; contenedorId?: string | null; fotoTmp?: string | null },
  opts?: OpcionesLlamada,
) {
  const cuerpo: Record<string, unknown> = { id: args.id, caption: args.caption, dryRun: args.dryRun };
  if (args.altText !== undefined) cuerpo.altText = args.altText;
  if (args.contenedorId) cuerpo.contenedorId = args.contenedorId;
  if (args.fotoTmp) cuerpo.fotoTmp = args.fotoTmp;
  return llamar<Crudo>(URL_PUBLICAR, { method: "POST", body: JSON.stringify(cuerpo) }, opts, cabecerasEdge()).then(normalizarPublicar);
}

/** Estado de la conexión (variables, cuenta y cupo). Nunca devuelve valores secretos. */
export function comprobarConexion(opts?: OpcionesLlamada) {
  return llamar<Crudo>(URL_ESTADO, { method: "GET" }, opts, cabecerasEdge()).then(normalizarEstado);
}

// ── Biblioteca de fotos en Google Drive (Edge Function instagram-drive) ─────

export interface RespuestaListarDrive {
  fotos: FotoDrive[];
  /** «completo», «drive.file» u «otro». */
  alcance: string | null;
  avisos: string[];
}

/** Fotos de la carpeta de Drive de la marca, con sus metadatos. */
export async function listarFotosDrive(marca: MarcaId, opts?: OpcionesLlamada): Promise<RespuestaListarDrive> {
  const r = await llamar<Crudo>(URL_DRIVE, { method: "POST", body: JSON.stringify({ accion: "listar", marca }) }, opts, cabecerasEdge());
  return {
    fotos: Array.isArray(r.fotos) ? (r.fotos as FotoDrive[]) : [],
    alcance: typeof r.alcance === "string" ? r.alcance : null,
    avisos: Array.isArray(r.avisos) ? r.avisos.map(String) : [],
  };
}

/** Sube un JPEG ya preparado a la carpeta de Drive de la marca y guarda su tipo y descripción. */
export async function subirFotoDrive(
  n: { blob: Blob; marca: MarcaId; tipo: string; descripcion: string },
  opts?: OpcionesLlamada,
): Promise<{ foto: FotoDrive; avisos: string[] }> {
  const form = new FormData();
  form.set("marca", n.marca);
  form.set("tipo", n.tipo);
  form.set("descripcion", n.descripcion.trim());
  form.set("archivo", n.blob, "foto.jpg");
  const r = await llamar<Crudo>(`${URL_DRIVE}?accion=subir`, { method: "POST", body: form }, opts, cabecerasEdge());
  return { foto: r.foto as FotoDrive, avisos: Array.isArray(r.avisos) ? r.avisos.map(String) : [] };
}

/** Copia la foto de Drive al bucket (tmp/) y devuelve su URL pública, para la vista previa y el render. */
export async function prepararFotoDrive(
  marca: MarcaId,
  driveId: string,
  opts?: OpcionesLlamada,
): Promise<{ ruta: string; url: string; ancho: number | null; alto: number | null }> {
  const r = await llamar<Crudo>(URL_DRIVE, { method: "POST", body: JSON.stringify({ accion: "preparar", marca, id: driveId }) }, opts, cabecerasEdge());
  return { ruta: String(r.ruta ?? ""), url: String(r.url ?? ""), ancho: typeof r.ancho === "number" ? r.ancho : null, alto: typeof r.alto === "number" ? r.alto : null };
}

/** Copia la foto de un plato de la carta al bucket (tmp/) y devuelve su URL pública (como prepararFotoDrive). */
export async function prepararFotoCarta(
  marca: MarcaId,
  platoId: string,
  opts?: OpcionesLlamada,
): Promise<{ ruta: string; url: string; ancho: number | null; alto: number | null }> {
  const r = await llamar<Crudo>(URL_DRIVE, { method: "POST", body: JSON.stringify({ accion: "preparar", origen: "carta", marca, platoId }) }, opts, cabecerasEdge());
  return { ruta: String(r.ruta ?? ""), url: String(r.url ?? ""), ancho: typeof r.ancho === "number" ? r.ancho : null, alto: typeof r.alto === "number" ? r.alto : null };
}

/** Miniatura de una foto de Drive (bytes, pedidos con la sesión). null si Drive no la tiene. */
export async function miniaturaDrive(marca: MarcaId, driveId: string, opts: OpcionesLlamada = {}): Promise<Blob | null> {
  const token = opts.token === undefined ? await tokenSesion() : opts.token;
  if (!token) throw new ErrorInstagram("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  const url = `${URL_DRIVE}?accion=miniatura&marca=${encodeURIComponent(marca)}&id=${encodeURIComponent(driveId)}`;
  const r = await (opts.fetch ?? fetch)(url, { headers: { ...cabecerasEdge(), Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) throw new ErrorInstagram(`La miniatura respondió ${r.status}`, "servidor", r.status);
  return await r.blob();
}

/** Texto para el usuario a partir de cualquier error de estas llamadas. */
export function textoError(e: unknown): string {
  if (e instanceof ErrorInstagram) return e.message;
  return (e as Error)?.message || "Error desconocido";
}
