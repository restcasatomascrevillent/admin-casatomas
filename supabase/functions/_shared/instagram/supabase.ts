/**
 * Acceso a Supabase de las Edge Functions de Instagram COMO EL USUARIO: clave
 * pública (anon/publishable) + `Authorization: Bearer <JWT del usuario>`, así
 * que la RLS de `instagram_piezas` y del bucket «instagram» se aplica igual
 * que en el panel. Excepción (al final del fichero): el estado de publicación
 * (estado, contenedor_id, media_id, permalink, drive_id) solo lo puede
 * escribir el servidor, con service_role y DESPUÉS de autorizar al usuario.
 *
 * Autorización: sesión válida (/auth/v1/user) + permiso de la sección
 * Marketing. Para escribir, publicar, programar, usar la IA o subir hace falta
 * «Editar» (`can_edit_section('marketing')`, la misma función que usan las
 * políticas de RLS de escritura desde 20261111000000); para leer basta «Ver»
 * (`can_read_section`). `can_write_section` NO se usa: mira «Ver» a propósito
 * en todo el panel.
 *
 * Sin dependencias (ni supabase-js): fetch a Auth, PostgREST y Storage, que
 * se puede simular en los tests. SUPABASE_URL y SUPABASE_ANON_KEY los inyecta
 * la plataforma en todas las Edge Functions.
 */
import { registrarSecreto, sanear } from "./secretos.ts";

export interface EntornoSupabase {
  url: string;
  clave: string;
}

/** URL y clave pública del proyecto de Supabase de esta función (null si faltan). */
export function entornoSupabase(env: Record<string, string | undefined> = {}): EntornoSupabase | null {
  const url = env.SUPABASE_URL;
  const clave = env.SUPABASE_ANON_KEY;
  if (!url || !clave) return null;
  return { url: url.replace(/\/+$/, ""), clave };
}

/** Token de `Authorization: Bearer <jwt>` (null si no hay o no tiene forma de JWT). */
export function tokenDeCabecera(cabecera: string | null | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i.exec(cabecera ?? "");
  return m ? m[1] : null;
}

export const SECCION_MARKETING = "marketing";
export const BUCKET = "instagram";
const MS_TIEMPO = 15_000;

export type EstadoPieza = "borrador" | "generada" | "procesando" | "prueba_ok" | "publicada" | "error";

export interface FilaPieza {
  id: string;
  marca: string;
  plantilla: string;
  formato: string;
  datos: unknown;
  caption: string | null;
  estado: EstadoPieza;
  imagen_ruta: string | null;
  contenedor_id: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  /** Texto alternativo de la imagen (migración 20261107000000; no existe antes). */
  alt_text?: string | null;
  /** Cuándo se borró el JPEG por no publicarse (migración 20261107010000; null = está). */
  imagen_borrada_at?: string | null;
  /** Reels (migración 20261109100000; no existen antes): «imagen» o «reel» y su MP4. */
  tipo_medio?: string | null;
  video_ruta?: string | null;
  portada_ruta?: string | null;
  duracion_s?: number | string | null;
  video_bytes?: number | null;
  procesando_accion?: string | null;
  procesando_desde?: string | null;
  /** Carrusel (migración 20261112000000; no existe antes): imágenes en orden de publicación. */
  diapositivas?: FilaDiapositiva[] | null;
  /** Carrusel publicado: id en Drive de cada JPEG (solo el servidor). */
  drive_ids?: string[] | null;
  creado_por: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Una imagen de un carrusel (instagram_piezas.diapositivas, 20261112000000). */
export interface FilaDiapositiva {
  foto?: string | null;
  plantilla: string;
  datos?: unknown;
  alt_text?: string | null;
  imagen_ruta: string;
}

export interface Sesion {
  usuario: string;
  token: string;
  sb: EntornoSupabase;
  fetch: typeof fetch;
}

export type ResultadoSesion = { ok: true; sesion: Sesion } | { ok: false; estado: 401 | 403 | 500 | 503; motivo: string };

export interface OpcionesSupabase {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** «editar» (por defecto): can_edit_section. «leer»: can_read_section. */
  permiso?: PermisoMarketing;
}

export type PermisoMarketing = "editar" | "leer";

/** Mensaje del 403 cuando falta «Editar». */
export const SIN_PERMISO_EDITAR = "Sin permiso para editar Marketing: hace falta «Editar» en Marketing (pídeselo a un administrador en Usuarios), no solo «Ver»";

/** RPC de PostgREST que decide cada permiso. */
export function rpcDePermiso(permiso: PermisoMarketing): "can_edit_section" | "can_read_section" {
  return permiso === "leer" ? "can_read_section" : "can_edit_section";
}

function cabeceras(s: Pick<Sesion, "sb" | "token">, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, ...extra };
}

/** Sesión válida + permiso de Marketing («Editar» por defecto). */
export async function autorizarMarketing(cabecera: string | null | undefined, opts: OpcionesSupabase = {}): Promise<ResultadoSesion> {
  const token = tokenDeCabecera(cabecera);
  if (!token) return { ok: false, estado: 401, motivo: "Falta la sesión" };
  registrarSecreto(token);
  const sb = entornoSupabase(opts.env);
  if (!sb) return { ok: false, estado: 500, motivo: "Falta la configuración de Supabase" };
  const f = opts.fetch ?? fetch;
  const senal = AbortSignal.timeout(MS_TIEMPO);
  try {
    const rUsuario = await f(`${sb.url}/auth/v1/user`, { headers: cabeceras({ sb, token }), signal: senal });
    if (rUsuario.status === 401 || rUsuario.status === 403) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!rUsuario.ok) return { ok: false, estado: 500, motivo: `Auth respondió ${rUsuario.status}` };
    const usuario = (await rUsuario.json().catch(() => null)) as { id?: string } | null;
    if (!usuario?.id) return { ok: false, estado: 401, motivo: "Sesión no válida" };

    const permiso = opts.permiso ?? "editar";
    const puede = await consultarPermiso({ sb, token, fetch: f }, permiso, senal);
    if (puede === 401) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (typeof puede === "number") return { ok: false, estado: 500, motivo: `La comprobación de permisos respondió ${puede}` };
    if (!puede) return { ok: false, estado: 403, motivo: permiso === "leer" ? "Sin permiso de Marketing" : SIN_PERMISO_EDITAR };
    return { ok: true, sesion: { usuario: usuario.id, token, sb, fetch: f } };
  } catch (e) {
    return { ok: false, estado: 500, motivo: sanear(`No se pudo comprobar la sesión: ${(e as Error)?.message ?? e}`) };
  }
}

/** true/false, o el estado HTTP si la comprobación falló. */
async function consultarPermiso(
  s: Pick<Sesion, "sb" | "token" | "fetch">,
  permiso: PermisoMarketing,
  senal: AbortSignal = AbortSignal.timeout(MS_TIEMPO),
): Promise<boolean | number> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/${rpcDePermiso(permiso)}`, {
    method: "POST",
    headers: cabeceras(s, { "Content-Type": "application/json" }),
    body: JSON.stringify({ _section: SECCION_MARKETING }),
    signal: senal,
  });
  if (!r.ok) return r.status;
  return (await r.json().catch(() => null)) === true;
}

/**
 * Para las funciones que autorizan con «leer» y tienen acciones de escritura
 * (instagram-drive): ¿la sesión tiene además «Editar»? Nunca lanza (false).
 */
export async function puedeEditarMarketing(s: Sesion): Promise<boolean> {
  try {
    return (await consultarPermiso(s, "editar")) === true;
  } catch {
    return false;
  }
}

export class ErrorSupabase extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(sanear(mensaje));
    this.name = "ErrorSupabase";
    this.estado = estado;
  }
}

async function detalle(r: Response): Promise<string> {
  const texto = await r.text().catch(() => "");
  try {
    const j = JSON.parse(texto) as { message?: string; error?: string; msg?: string };
    return sanear(j.message ?? j.error ?? j.msg ?? texto).slice(0, 300);
  } catch {
    return sanear(texto).slice(0, 300);
  }
}

const COLUMNAS = "id,marca,plantilla,formato,datos,caption,estado,imagen_ruta,contenedor_id,media_id,permalink,error,creado_por,created_at,updated_at";

/** Fila de instagram_piezas visible para el usuario (null si no existe o la RLS la oculta). */
export async function leerPieza(s: Sesion, id: string): Promise<FilaPieza | null> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}&select=${COLUMNAS}`, {
    headers: cabeceras(s, { Accept: "application/json" }),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer la pieza (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as FilaPieza[];
  return filas[0] ?? null;
}

export async function actualizarPieza(s: Sesion, id: string, cambios: Partial<FilaPieza>): Promise<FilaPieza> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}&select=${COLUMNAS}`, {
    method: "PATCH",
    headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(cambios),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo actualizar la pieza (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as FilaPieza[];
  if (!filas[0]) throw new ErrorSupabase("La pieza no existe o no tienes permiso para cambiarla", 404);
  return filas[0];
}

/** Igual que actualizarPieza pero nunca lanza (para anotar errores). */
export async function anotarError(s: Sesion, id: string, mensaje: string): Promise<void> {
  try {
    await actualizarPieza(s, id, { estado: "error", error: sanear(mensaje).slice(0, 1000) });
  } catch {
    /* sin consecuencias: la respuesta ya lleva el error */
  }
}

/** URL pública del objeto (bucket público). */
export function urlPublica(sb: EntornoSupabase, ruta: string): string {
  return `${sb.url}/storage/v1/object/public/${BUCKET}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Borra el JPEG del bucket con el JWT del usuario (DELETE en bloque de
 * Storage, que devuelve los objetos borrados). Si la RLS no deja borrar,
 * Storage no da error: devuelve una lista vacía. Nunca lanza.
 */
export async function borrarJpeg(s: Sesion, ruta: string): Promise<{ borrado: boolean; motivo?: string }> {
  try {
    const r = await s.fetch(`${s.sb.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: cabeceras(s, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [ruta] }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    if (!r.ok) return { borrado: false, motivo: `Storage respondió ${r.status}: ${await detalle(r)}` };
    const lista = (await r.json().catch(() => null)) as Array<{ name?: string }> | null;
    if (!Array.isArray(lista) || lista.length === 0) {
      return { borrado: false, motivo: "Storage no borró nada (el fichero ya no estaba o la RLS del bucket no deja borrar a este usuario)" };
    }
    return { borrado: true };
  } catch (e) {
    return { borrado: false, motivo: sanear(`No se pudo borrar el JPEG: ${(e as Error)?.message ?? e}`) };
  }
}

// ── Escala temporal en el bucket y fotos de Drive (instagram-drive) ──────────

/** Copias temporales de fotos de Drive para la vista previa y el render: tmp/<uuid>.<ext>. */
export const RE_RUTA_TMP = /^tmp\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function esRutaTmp(v: unknown): v is string {
  return typeof v === "string" && RE_RUTA_TMP.test(v);
}

/** Sube un objeto al bucket con el JWT del usuario (RLS del bucket). */
export async function subirObjeto(s: Sesion, ruta: string, bytes: Uint8Array, tipo: string): Promise<void> {
  const r = await s.fetch(`${s.sb.url}/storage/v1/object/${BUCKET}/${ruta.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: cabeceras(s, { "Content-Type": tipo, "Cache-Control": "max-age=3600", "x-upsert": "false" }),
    body: bytes as Uint8Array<ArrayBuffer>,
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo subir al bucket (${r.status}): ${await detalle(r)}`, r.status);
}

export interface ObjetoBucket {
  name: string;
  created_at?: string | null;
}

/** Objetos de una carpeta del bucket (los más antiguos primero). Nunca lanza: [] si falla. */
export async function listarObjetos(s: Sesion, carpeta: string, limite = 200): Promise<ObjetoBucket[]> {
  try {
    const r = await s.fetch(`${s.sb.url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: cabeceras(s, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: carpeta, limit: limite, offset: 0, sortBy: { column: "created_at", order: "asc" } }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    if (!r.ok) return [];
    const lista = (await r.json().catch(() => [])) as ObjetoBucket[];
    return Array.isArray(lista) ? lista.filter((o) => typeof o?.name === "string") : [];
  } catch {
    return [];
  }
}

/** Borra objetos de un cubo («instagram» por defecto). Devuelve cuántos borró. Nunca lanza. */
export async function borrarObjetos(s: Sesion, rutas: string[], cubo: string = BUCKET): Promise<number> {
  if (!rutas.length) return 0;
  try {
    const r = await s.fetch(`${s.sb.url}/storage/v1/object/${cubo}`, {
      method: "DELETE",
      headers: cabeceras(s, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: rutas }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    if (!r.ok) return 0;
    const lista = (await r.json().catch(() => null)) as unknown[] | null;
    return Array.isArray(lista) ? lista.length : 0;
  } catch {
    return 0;
  }
}

/** Fila de instagram_fotos (metadatos de una foto de Drive). */
export interface FilaFotoDrive {
  id: string;
  marca: string;
  drive_id: string | null;
  ancho: number;
  alto: number;
  tipo: string;
  descripcion: string | null;
}

const COLUMNAS_FOTO_DRIVE = "id,marca,drive_id,ancho,alto,tipo,descripcion";

/**
 * Filas de instagram_fotos de una marca con drive_id (RLS del usuario). Si la
 * migración 20261105150000_instagram_drive aún no está aplicada (no existe
 * drive_id), devuelve [] y `sinColumna: true` en vez de fallar.
 */
export async function leerFotosDrive(s: Sesion, marca: string): Promise<{ filas: FilaFotoDrive[]; sinColumna: boolean }> {
  const r = await s.fetch(
    `${s.sb.url}/rest/v1/instagram_fotos?marca=eq.${encodeURIComponent(marca)}&drive_id=not.is.null&select=${COLUMNAS_FOTO_DRIVE}&limit=1000`,
    { headers: cabeceras(s, { Accept: "application/json" }), signal: AbortSignal.timeout(MS_TIEMPO) },
  );
  if (r.status === 400 || r.status === 404) {
    const texto = await detalle(r);
    if (/drive_id|instagram_fotos|42703|42P01|PGRST/.test(texto)) return { filas: [], sinColumna: true };
    throw new ErrorSupabase(`No se pudieron leer las fotos (${r.status}): ${texto}`, r.status);
  }
  if (!r.ok) throw new ErrorSupabase(`No se pudieron leer las fotos (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json().catch(() => [])) as FilaFotoDrive[];
  return { filas: Array.isArray(filas) ? filas : [], sinColumna: false };
}

/** Guarda la fila de una foto subida a Drive. */
export async function insertarFotoDrive(s: Sesion, fila: Omit<FilaFotoDrive, "drive_id"> & { drive_id: string }): Promise<FilaFotoDrive> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_fotos?select=${COLUMNAS_FOTO_DRIVE}`, {
    method: "POST",
    headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ ...fila, ruta: null }),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo guardar la foto (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as FilaFotoDrive[];
  if (!filas[0]) throw new ErrorSupabase("No se pudo guardar la foto (sin permiso)", 403);
  return filas[0];
}

/** Anota el id de Drive del JPEG publicado (columna de 20261105150000_instagram_drive). */
export async function anotarDrivePieza(s: Sesion, id: string, driveId: string): Promise<void> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ drive_id: driveId }),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo anotar el id de Drive (${r.status}): ${await detalle(r)}`, r.status);
}

// ── Escritura del estado de publicación (solo el servidor) ──────────────────
//
// Desde la migración 20261107000000_instagram_publicacion_servidor, un usuario
// del panel (authenticated) NO puede cambiar estado (salvo a borrador o
// generada), contenedor_id, media_id, permalink ni drive_id de una pieza, ni
// tocar una ya publicada. Lo escribe la Edge Function con la clave de servicio,
// después de haber autorizado al usuario con su JWT. La auditoría recibe la
// función (x-audit-source) y el usuario (x-audit-actor-id).

/**
 * Sesión para ESCRIBIR el estado de publicación. Si `s` ya es de servicio (el
 * programador), la misma. Si falta SUPABASE_SERVICE_ROLE_KEY (no pasa en
 * Supabase, que la inyecta siempre) se usa la del usuario, como antes.
 */
export function sesionEscritura(s: Sesion, env: Record<string, string | undefined>, etiqueta: string): Sesion {
  const clave = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!clave || s.token === clave) return s;
  registrarSecreto(clave);
  const base = s.sb.url;
  const actor = /^[0-9a-f-]{36}$/i.test(s.usuario) ? s.usuario : null;
  const fetchAuditado: typeof fetch = (entrada, init = {}) => {
    const destino = String(entrada instanceof Request ? entrada.url : entrada);
    if (!destino.startsWith(base)) return s.fetch(entrada, init);
    const cabeceras = new Headers(init.headers);
    cabeceras.set("x-audit-source", etiqueta);
    if (actor) cabeceras.set("x-audit-actor-id", actor);
    return s.fetch(entrada, { ...init, headers: cabeceras });
  };
  return { usuario: s.usuario, token: clave, sb: { url: base, clave }, fetch: fetchAuditado };
}

/** Fila con TODAS las columnas (alt_text incluido si ya existe la columna). */
export async function leerPiezaCompleta(s: Sesion, id: string): Promise<(FilaPieza & { alt_text?: string | null }) | null> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: cabeceras(s, { Accept: "application/json" }),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer la pieza (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as Array<FilaPieza & { alt_text?: string | null }>;
  return filas[0] ?? null;
}

/**
 * Guarda el texto alternativo (columna de 20261107000000). Nunca lanza:
 * devuelve un aviso si no se pudo (p. ej. migración sin aplicar).
 */
export async function anotarAltText(s: Sesion, id: string, alt: string | null): Promise<string | null> {
  try {
    const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ alt_text: alt }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    if (r.ok) return null;
    const texto = await detalle(r);
    if (/alt_text|PGRST204|42703/.test(texto)) return "El texto alternativo se ha enviado a Instagram, pero no se ha guardado en el panel: falta aplicar la migración 20261107000000_instagram_publicacion_servidor.";
    return `No se pudo guardar el texto alternativo (${r.status}): ${texto}`;
  } catch (e) {
    return sanear(`No se pudo guardar el texto alternativo: ${(e as Error)?.message ?? e}`);
  }
}

async function rpcServicio(s: Sesion, nombre: string, cuerpo: Record<string, unknown>): Promise<{ estado: number; valor: unknown; texto: string }> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/${nombre}`, {
    method: "POST",
    headers: cabeceras(s, { "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  const texto = await r.text().catch(() => "");
  let valor: unknown = null;
  try {
    valor = texto ? JSON.parse(texto) : null;
  } catch {
    valor = null;
  }
  return { estado: r.status, valor, texto: sanear(texto).slice(0, 300) };
}

/** ¿La RPC no existe todavía (migración sin aplicar)? */
function rpcSinCrear(estado: number, texto: string): boolean {
  return estado === 404 || /PGRST202|42883|Could not find the function/i.test(texto);
}

export type ReservaPublicacion =
  | { ok: true; bloqueo: string | null; sinCerrojo?: true }
  | { ok: false; motivo: "en_curso" | "programada" | "publicada" | "no_existe"; programadaPara?: string | null; permalink?: string | null };

/**
 * Cerrojo de publicación de una pieza (RPC instagram_pieza_reservar_publicacion,
 * solo service_role): impide dos publicaciones (o una prueba y una
 * publicación) a la vez, y —si `comprobarProgramacion`— publicar a mano una
 * pieza que tiene una programación activa. Sin la migración, sigue sin cerrojo.
 */
export async function reservarPublicacion(
  s: Sesion,
  piezaId: string,
  o: { segundos: number; comprobarProgramacion: boolean },
): Promise<ReservaPublicacion> {
  const r = await rpcServicio(s, "instagram_pieza_reservar_publicacion", {
    p_pieza_id: piezaId,
    p_segundos: o.segundos,
    p_comprobar_programacion: o.comprobarProgramacion,
  });
  if (r.estado >= 200 && r.estado < 300) {
    const v = (r.valor ?? {}) as { ok?: boolean; bloqueo?: string; motivo?: string; programadaPara?: string | null; permalink?: string | null };
    if (v.ok === true && typeof v.bloqueo === "string") return { ok: true, bloqueo: v.bloqueo };
    const motivo = v.motivo === "programada" || v.motivo === "publicada" || v.motivo === "no_existe" ? v.motivo : "en_curso";
    return { ok: false, motivo, programadaPara: v.programadaPara ?? null, permalink: v.permalink ?? null };
  }
  if (rpcSinCrear(r.estado, r.texto)) return { ok: true, bloqueo: null, sinCerrojo: true };
  throw new ErrorSupabase(`No se pudo reservar la publicación (${r.estado}): ${r.texto}`, r.estado);
}

/** Suelta el cerrojo. Nunca lanza (si falla, caduca solo). */
export async function liberarPublicacion(s: Sesion, piezaId: string, bloqueo: string | null): Promise<void> {
  if (!bloqueo) return;
  try {
    await rpcServicio(s, "instagram_pieza_liberar_publicacion", { p_pieza_id: piezaId, p_bloqueo: bloqueo });
  } catch {
    /* caduca solo */
  }
}

// ── Carrusel (migración 20261112000000) ─────────────────────────────────────

/** Anota los JPEG de un carrusel archivados en Drive (drive_id = portada, drive_ids = todos). Solo el servidor. */
export async function anotarDriveCarrusel(s: Sesion, id: string, driveIds: string[]): Promise<void> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ drive_id: driveIds[0] ?? null, drive_ids: driveIds }),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudieron anotar los ficheros de Drive (${r.status}): ${await detalle(r)}`, r.status);
}

/** Guarda las diapositivas (textos alternativos enviados). Nunca lanza: aviso si no se pudo. */
export async function anotarDiapositivas(s: Sesion, id: string, diapositivas: FilaDiapositiva[]): Promise<string | null> {
  try {
    const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ diapositivas }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    if (r.ok) return null;
    return `Los textos alternativos se han enviado a Instagram, pero no se han guardado en el panel (${r.status}): ${await detalle(r)}`;
  } catch (e) {
    return sanear(`No se pudieron guardar los textos alternativos: ${(e as Error)?.message ?? e}`);
  }
}

export interface PeticionProgramar {
  piezaId: string;
  para: string;
  confirmarConflicto?: boolean;
  caption?: string | null;
  altText?: string | null;
  altTexts?: string[] | null;
}

/**
 * RPC instagram_programar COMO EL USUARIO (su JWT: la RPC comprueba «Editar»
 * y la sesión de panel). Devuelve su JSON o `{ estado, error }` si PostgREST
 * la rechaza (fecha, pieza sin imagen, permiso…).
 */
export async function programarPieza(s: Sesion, p: PeticionProgramar): Promise<{ ok: true; valor: Record<string, unknown> } | { ok: false; estado: number; error: string }> {
  const cuerpo: Record<string, unknown> = { p_pieza_id: p.piezaId, p_para: p.para, p_confirmar_conflicto: p.confirmarConflicto === true };
  if (typeof p.caption === "string") cuerpo.p_caption = p.caption;
  if (typeof p.altText === "string") cuerpo.p_alt_text = p.altText;
  if (Array.isArray(p.altTexts)) cuerpo.p_alt_texts = p.altTexts;
  const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/instagram_programar`, {
    method: "POST",
    headers: cabeceras(s, { "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (r.ok) {
    const valor = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: true, valor: valor ?? {} };
  }
  return { ok: false, estado: r.status, error: await detalle(r) };
}
