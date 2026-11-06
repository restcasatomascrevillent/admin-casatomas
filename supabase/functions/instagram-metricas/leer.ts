/**
 * Acción «leer»: lo que enseña la pestaña «Métricas», leído COMO EL USUARIO
 * (la RLS de las tablas exige can_read_section('marketing')). No llama a Meta.
 *
 *   resumen   7 y 28 días con la variación frente al periodo anterior
 *   serie     28 días (alcance, seguidores, visualizaciones, interacciones)
 *   publicaciones  última captura de cada publicación, con marca, plantilla,
 *             formato, foto y tipo de foto si salió de una pieza del panel
 *             (instagram_piezas por media_id o pieza_id). Tipo de foto:
 *               «drive:<id>» (fotos de Drive, lo normal) → instagram_fotos.drive_id
 *               «<uuid>» (subidas antes de Drive)        → instagram_fotos.id
 *               «carta:<id>» (fotos de la carta)          → «plato»
 *             El de las del catálogo estático lo pone el panel
 *             (src/lib/instagram/fotos.ts).
 *   ultimaCaptura / ultimaCorrecta  para avisar de errores (p. ej. permiso)
 *   queFunciona  «Qué funciona» de los últimos 90 días: la RPC
 *             instagram_que_funciona (20261110000000), leída como el usuario.
 *             null si la migración no está aplicada o la RPC falla (la
 *             pestaña sigue funcionando sin ese bloque).
 */
import { fechaMadrid } from "../_shared/instagram/insights.ts";
import { registro } from "../_shared/instagram/secretos.ts";
import { ErrorBaseDatos, type Rest } from "./acceso.ts";
import { resumirPeriodo, serieDiaria, ultimoDia, type FilaCuenta, type PuntoSerie, type ResumenPeriodo } from "./resumen.ts";

export const DIAS_SERIE = 28;
export const MAX_PUBLICACIONES_LEER = 120;
/** El panel solo enseña el principio del texto (el completo lo usa «Qué funciona»). */
const MAX_CAPTION_LEER = 300;
export const DIAS_QUE_FUNCIONA = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Igual que src/lib/instagram/fotos.ts (PREFIJO_FOTO_DRIVE y esIdDriveValido). */
const PREFIJO_DRIVE = "drive:";
const ID_DRIVE = /^[A-Za-z0-9_-]{10,200}$/;
/** Igual que src/lib/instagram/fotos.ts (PREFIJO_FOTO_CARTA): las fotos de la carta son platos. */
const PREFIJO_CARTA = "carta:";

function driveIdDe(foto: string): string | null {
  if (!foto.startsWith(PREFIJO_DRIVE)) return null;
  const id = foto.slice(PREFIJO_DRIVE.length);
  return ID_DRIVE.test(id) ? id : null;
}

interface FilaPublicacion {
  media_id: string;
  pieza_id: string | null;
  fecha_captura: string;
  tipo_medio: string | null;
  producto: string | null;
  publicado_at: string | null;
  permalink: string | null;
  miniatura_url: string | null;
  caption: string | null;
  alcance: number | null;
  me_gusta: number | null;
  comentarios: number | null;
  guardados: number | null;
  compartidos: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

interface FilaPieza {
  id: string;
  media_id: string | null;
  marca: string;
  plantilla: string;
  formato: string;
  foto: string | null;
}

export interface Captura {
  inicio: string;
  fin: string | null;
  ok: boolean;
  origen: string;
  errorTipo: string | null;
  error: string | null;
  avisos: string[];
}

export interface Publicacion {
  mediaId: string;
  piezaId: string | null;
  marca: string | null;
  plantilla: string | null;
  formato: string | null;
  foto: string | null;
  tipoFoto: string | null;
  tipoMedio: string | null;
  producto: string | null;
  publicadoAt: string | null;
  permalink: string | null;
  miniaturaUrl: string | null;
  caption: string | null;
  fechaCaptura: string;
  alcance: number | null;
  meGusta: number | null;
  comentarios: number | null;
  guardados: number | null;
  compartidos: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

export interface RespuestaLeer {
  ok: true;
  igUserId: string | null;
  hoy: string;
  ultimoDia: string | null;
  resumen: { d7: ResumenPeriodo; d28: ResumenPeriodo } | null;
  serie: PuntoSerie[];
  publicaciones: Publicacion[];
  ultimaCaptura: Captura | null;
  ultimaCorrecta: Captura | null;
  /** Respuesta de instagram_que_funciona (ver la migración 20261110000000), o null. */
  queFunciona: Record<string, unknown> | null;
}

const COLS_CUENTA =
  "fecha,ig_user_id,seguidores,alcance,visualizaciones,visitas_perfil,cuentas_interaccion,interacciones,me_gusta,comentarios,guardados,compartidos,toques_enlaces";
const COLS_PUB =
  "media_id,pieza_id,fecha_captura,tipo_medio,producto,publicado_at,permalink,miniatura_url,caption,alcance,me_gusta,comentarios,guardados,compartidos,visualizaciones,interacciones";
const COLS_CAPTURA = "inicio,fin,ok,origen,error_tipo,error,avisos";

function captura(f: Record<string, unknown> | undefined): Captura | null {
  if (!f) return null;
  return {
    inicio: String(f.inicio),
    fin: (f.fin as string | null) ?? null,
    ok: f.ok === true,
    origen: String(f.origen ?? ""),
    errorTipo: (f.error_tipo as string | null) ?? null,
    error: (f.error as string | null) ?? null,
    avisos: Array.isArray(f.avisos) ? f.avisos.map(String) : [],
  };
}

/** Filtro de cuenta: la de IG_USER_ID si está; si no, todas (normalmente solo hay una). */
function filtroCuenta(igUserId: string | null): string {
  return igUserId && /^\d+$/.test(igUserId) ? `&ig_user_id=eq.${igUserId}` : "";
}

/**
 * «Qué funciona» (RPC instagram_que_funciona por GET, como el usuario). Nunca
 * lanza: sin la migración o con cualquier fallo, null.
 */
export async function leerQueFunciona(db: Rest, igUserId: string | null, marca: string | null): Promise<Record<string, unknown> | null> {
  const q = new URLSearchParams({ p_dias: String(DIAS_QUE_FUNCIONA) });
  if (igUserId && /^\d+$/.test(igUserId)) q.set("p_ig_user_id", igUserId);
  if (marca === "casa-tomas" || marca === "touza") q.set("p_marca", marca);
  try {
    const r = (await db.leer<unknown>(`rpc/instagram_que_funciona?${q.toString()}`, "qué funciona")) as unknown;
    const v = Array.isArray(r) ? r[0] : r;
    return v && typeof v === "object" && !Array.isArray(v) && typeof (v as { publicaciones?: unknown }).publicaciones === "number"
      ? (v as Record<string, unknown>)
      : null;
  } catch (e) {
    const sinMigracion = e instanceof ErrorBaseDatos && (e.estado === 404 || e.codigo === "PGRST202" || e.codigo === "42883");
    if (!sinMigracion) registro("warn", "instagram-metricas", "no se pudo leer «Qué funciona»", e);
    return null;
  }
}

export async function leerMetricas(
  db: Rest,
  opciones: { igUserId: string | null; ahora: number; marca?: string | null },
): Promise<RespuestaLeer> {
  const f = filtroCuenta(opciones.igUserId);
  const [cuenta, pubs, capturas, correctas, queFunciona] = await Promise.all([
    db.leer<FilaCuenta & { ig_user_id: string }>(
      `instagram_metricas_cuenta?select=${COLS_CUENTA}${f}&order=fecha.desc&limit=${DIAS_SERIE * 2 + 7}`,
      "las métricas de la cuenta",
    ),
    db.leer<FilaPublicacion>(
      `instagram_metricas_publicacion_ultima?select=${COLS_PUB}${f}&order=publicado_at.desc.nullslast&limit=${MAX_PUBLICACIONES_LEER}`,
      "las métricas de las publicaciones",
    ),
    db.leer<Record<string, unknown>>(`instagram_metricas_capturas?select=${COLS_CAPTURA}&order=inicio.desc&limit=1`, "las capturas"),
    db.leer<Record<string, unknown>>(`instagram_metricas_capturas?select=${COLS_CAPTURA}&ok=is.true&order=inicio.desc&limit=1`, "las capturas"),
    leerQueFunciona(db, opciones.igUserId, opciones.marca ?? null),
  ]);

  // Piezas del panel (por media_id o por pieza_id).
  const piezasPorMedia = new Map<string, FilaPieza>();
  const piezasPorId = new Map<string, FilaPieza>();
  const mediaIds = pubs.map((p) => p.media_id).filter((m) => /^\d+$/.test(m));
  const piezaIds = pubs.map((p) => p.pieza_id).filter((p): p is string => typeof p === "string" && UUID.test(p));
  if (mediaIds.length || piezaIds.length) {
    const condiciones = [
      mediaIds.length ? `media_id.in.(${mediaIds.join(",")})` : null,
      piezaIds.length ? `id.in.(${piezaIds.join(",")})` : null,
    ].filter(Boolean);
    const piezas = await db.leer<FilaPieza>(
      `instagram_piezas?select=id,media_id,marca,plantilla,formato,foto:datos->>foto&or=(${condiciones.join(",")})`,
      "las piezas de Instagram",
    );
    for (const p of piezas) {
      piezasPorId.set(p.id, p);
      if (p.media_id) piezasPorMedia.set(p.media_id, p);
    }
  }

  // Tipo de las fotos (las del catálogo estático las resuelve el panel). La
  // clave del mapa es el valor de `datos.foto` tal cual («drive:<id>», uuid…).
  const tipos = new Map<string, string>();
  const fotosPiezas = [...new Set([...piezasPorId.values()].map((p) => p.foto).filter((x): x is string => !!x))];
  for (const foto of fotosPiezas) if (foto.startsWith(PREFIJO_CARTA)) tipos.set(foto, "plato");
  const fotosSubidas = fotosPiezas.filter((x) => UUID.test(x));
  const fotosDrive = fotosPiezas.map((x) => [x, driveIdDe(x)] as const).filter((x): x is readonly [string, string] => x[1] !== null);
  const sinTabla = (e: unknown) => e instanceof ErrorBaseDatos && (e.estado === 404 || e.codigo === "PGRST205" || e.codigo === "42P01");
  if (fotosSubidas.length) {
    try {
      const fotos = await db.leer<{ id: string; tipo: string }>(`instagram_fotos?select=id,tipo&id=in.(${fotosSubidas.join(",")})`, "las fotos");
      for (const foto of fotos) tipos.set(foto.id, foto.tipo);
    } catch (e) {
      // Sin la tabla instagram_fotos (migración 20261105120000 sin aplicar) se sigue sin el tipo.
      if (!sinTabla(e)) throw e;
    }
  }
  if (fotosDrive.length) {
    try {
      // Los ids de Drive solo llevan [A-Za-z0-9_-]: van entre comillas por si acaso.
      const lista = fotosDrive.map(([, d]) => `"${d}"`).join(",");
      const fotos = await db.leer<{ drive_id: string; tipo: string }>(`instagram_fotos?select=drive_id,tipo&drive_id=in.(${lista})`, "las fotos de Drive");
      const porDrive = new Map(fotos.map((f) => [f.drive_id, f.tipo]));
      for (const [foto, d] of fotosDrive) {
        const tipo = porDrive.get(d);
        if (tipo) tipos.set(foto, tipo);
      }
    } catch (e) {
      // Sin la columna drive_id (migración 20261105150000 sin aplicar) se sigue sin el tipo.
      if (!sinTabla(e) && !(e instanceof ErrorBaseDatos && (e.estado === 400 || e.codigo === "42703"))) throw e;
    }
  }

  const publicaciones: Publicacion[] = pubs.map((p) => {
    const pieza = piezasPorMedia.get(p.media_id) ?? (p.pieza_id ? piezasPorId.get(p.pieza_id) : undefined) ?? null;
    const foto = pieza?.foto ?? null;
    return {
      mediaId: p.media_id,
      piezaId: pieza?.id ?? p.pieza_id ?? null,
      marca: pieza?.marca ?? null,
      plantilla: pieza?.plantilla ?? null,
      formato: pieza?.formato ?? null,
      foto,
      tipoFoto: foto ? (tipos.get(foto) ?? null) : null,
      tipoMedio: p.tipo_medio,
      producto: p.producto,
      publicadoAt: p.publicado_at,
      permalink: p.permalink,
      miniaturaUrl: p.miniatura_url,
      caption: typeof p.caption === "string" ? p.caption.slice(0, MAX_CAPTION_LEER) : p.caption,
      fechaCaptura: p.fecha_captura,
      alcance: p.alcance,
      meGusta: p.me_gusta,
      comentarios: p.comentarios,
      guardados: p.guardados,
      compartidos: p.compartidos,
      visualizaciones: p.visualizaciones,
      interacciones: p.interacciones,
    };
  });

  const fin = ultimoDia(cuenta);
  return {
    ok: true,
    igUserId: opciones.igUserId ?? cuenta[0]?.ig_user_id ?? null,
    hoy: fechaMadrid(opciones.ahora),
    ultimoDia: fin,
    resumen: fin ? { d7: resumirPeriodo(cuenta, fin, 7), d28: resumirPeriodo(cuenta, fin, 28) } : null,
    serie: fin ? serieDiaria(cuenta, fin, DIAS_SERIE) : [],
    publicaciones,
    ultimaCaptura: captura(capturas[0]),
    ultimaCorrecta: captura(correctas[0]),
    queFunciona,
  };
}
