/**
 * Servicios REALES del asistente móvil (con la sesión del usuario: la RLS
 * decide). Lo simulado está en servicios.ts.
 *
 * ── Subida de fotos (rápida en el móvil) ───────────────────────────────────
 *  El JPEG ya comprimido en el navegador se sube DIRECTAMENTE al bucket
 *  «instagram» como tmp/<uuid>.jpg (política instagram_objetos_insert_seccion:
 *  quien tiene Marketing puede escribir en el bucket). Es un solo salto, sin
 *  pasar por la Edge Function ni por Google Drive, y es la misma forma de
 *  «copia preparada» que usan el render y montar_pieza (id «subida:<uuid>»).
 *  Si la red corta a mitad, se reintenta con el MISMO uuid (un 409 «ya
 *  existe» cuenta como subida). El ARCHIVO en Drive se hace DESPUÉS de
 *  publicar o programar (archivarEnDrive), en segundo plano.
 *
 * ── Render y publicación (contrato que se espera del servidor) ─────────────
 *  renderizarImagen → POST /api/instagram-render
 *     { pieza: { marca, formato: "post"|"story", plantilla, foto, …rótulos },
 *       caption, fotoPreparada: { id, url, ancho, alto, tipo: null, marca },
 *       carrusel?: { grupo, indice, total } }            → { id, urlJpeg }
 *     Hoy el render acepta fotoPreparada con id «drive:…» o «carta:…»; las
 *     subidas («subida:<uuid>») y el campo `carrusel` los añade el agente del
 *     servidor de carruseles.
 *  publicar → post: instagram-publicar { id, caption, altText, dryRun: false, fotoTmp }
 *             (lo que ya existe); carrusel: instagram-publicar
 *             { carrusel: { grupo, ids, altTexts }, caption, dryRun: false, fotosTmp }
 *             → { estado: "publicada", permalink }.
 *  programar → RPC instagram_programar(p_pieza_id = primera imagen, p_para,
 *             p_confirmar_conflicto = true). Para un carrusel, el servidor
 *             tiene que publicar el grupo de la portada (render con `carrusel`).
 */
import { supabase } from "@/integrations/supabase/client";
import { auditDeviceId } from "@/lib/audit-device";
import { rutaTmpDeUrl, type MarcaId } from "@/lib/instagram";
import type { FotoParaMontar } from "@/lib/instagram/montar";
import { ErrorInstagram, URL_PUBLICAR, URL_RENDER, normalizarPublicar, prepararFotoCarta, publicar, subirFotoDrive } from "@/components/marketing/instagram/api";
import type { ApiPublicacionMovil, ArgsRender } from "./publicar";
import { ErrorReintentable, conReintentos } from "./reintentos";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");
const BUCKET = "instagram";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new ErrorInstagram("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  return t;
}

async function postJson(url: string, cuerpo: unknown, edge: boolean): Promise<Record<string, unknown>> {
  const t = await token();
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      body: JSON.stringify(cuerpo),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
        ...(edge ? { apikey: CLAVE_PUBLICA, "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}` } : {}),
      },
    });
  } catch (e) {
    throw new ErrorInstagram((e as Error)?.message || "Sin conexión", "red");
  }
  const json = (r.headers.get("content-type") ?? "").includes("application/json");
  const c = json ? ((await r.json().catch(() => ({}))) as Record<string, unknown>) : {};
  if (!json && url === URL_RENDER) throw new ErrorInstagram("La imagen definitiva solo se genera en la demo de Vercel (no en local).", "sin-servidor", r.status);
  if (!r.ok) {
    const problemas = Array.isArray(c.problemas) ? c.problemas.map(String) : undefined;
    const mensaje = (typeof c.error === "string" && c.error) || `El servidor respondió ${r.status}`;
    throw new ErrorInstagram(problemas?.length ? `${mensaje}: ${problemas.join(" · ")}` : mensaje, r.status === 401 || r.status === 403 ? "sesion" : r.status === 422 ? "validacion" : "servidor", r.status, undefined, problemas);
  }
  return c;
}

/** Sube el JPEG a tmp/<uuid>.jpg del bucket (un solo intento: los reintentos los pone quien llama). */
export async function subirFotoTmp(blob: Blob, uuid: string, medidas: { ancho: number | null; alto: number | null }): Promise<FotoParaMontar> {
  const ruta = `tmp/${uuid}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: false });
  if (error) {
    const e = error as { message?: string; status?: number | string; statusCode?: number | string };
    const estado = Number(e.statusCode ?? e.status ?? 0) || undefined;
    const msg = e.message ?? "No se ha podido subir la foto";
    // Reintento tras un corte: el fichero ya llegó la vez anterior.
    if (estado === 409 || /exist|duplicate/i.test(msg)) {
      /* ya está */
    } else {
      const reintentable = !estado || estado >= 500 || estado === 408 || estado === 429;
      throw new ErrorReintentable(estado === 403 ? "Tu usuario no puede subir fotos de Instagram (permiso de Marketing)." : msg, reintentable, estado);
    }
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
  return { id: `subida:${uuid}`, url: data.publicUrl, ancho: medidas.ancho, alto: medidas.alto };
}

export interface PlatoCarta {
  id: string;
  nombre: string;
  url: string;
}

/** Platos activos con foto de la marca (como useFotosInstagram). */
export async function listarPlatosCarta(marca: MarcaId): Promise<PlatoCarta[]> {
  const { data, error } = await supabase
    .from("Platos")
    .select("id,nombre,imagen_url")
    .eq("activado", true)
    .eq(marca === "touza" ? "touza" : "restaurante", true)
    .not("imagen_url", "is", null)
    .order("nombre", { ascending: true })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string | number; nombre: string | null; imagen_url: string | null }>)
    .filter((p) => p.imagen_url)
    .map((p) => ({ id: String(p.id), nombre: p.nombre ?? "Plato", url: String(p.imagen_url) }));
}

/** Copia la foto del plato al bucket (tmp/) para montarla. */
export async function prepararPlatoCarta(marca: MarcaId, platoId: string): Promise<FotoParaMontar> {
  const r = await prepararFotoCarta(marca, platoId);
  return { id: `carta:${platoId}`, url: r.url, ancho: r.ancho, alto: r.alto };
}

function rutaTmp(url: string): string | null {
  return rutaTmpDeUrl(url, SUPABASE_URL);
}

function piezaDeDiapositiva(a: ArgsRender): Record<string, unknown> {
  const pieza: Record<string, unknown> = { ...a.diapositiva.datos };
  pieza.marca = a.marca;
  pieza.formato = a.formato === "story" ? "story" : "post";
  pieza.plantilla = a.diapositiva.plantilla;
  pieza.foto = a.foto.id;
  return pieza;
}

export const apiPublicacionReal: ApiPublicacionMovil = {
  async renderizarImagen(a) {
    const cuerpo: Record<string, unknown> = {
      pieza: piezaDeDiapositiva(a),
      caption: a.caption,
      fotoPreparada: { id: a.foto.id, url: a.foto.url, ancho: a.foto.ancho ?? null, alto: a.foto.alto ?? null, tipo: null, marca: a.marca },
    };
    if (a.formato === "carrusel") cuerpo.carrusel = { grupo: a.grupo, indice: a.indice, total: a.total };
    const r = await postJson(URL_RENDER, cuerpo, false);
    return { piezaId: String(r.id ?? ""), urlJpeg: String(r.urlJpeg ?? "") };
  },
  async publicar(a) {
    if (a.formato !== "carrusel") {
      const r = await publicar({ id: a.piezaIds[0], caption: a.caption, altText: a.altTexts[0], dryRun: false, fotoTmp: rutaTmp(a.fotosTmp[0] ?? "") });
      if (r.estado !== "publicada") throw new ErrorInstagram(r.mensaje ?? "Instagram aún no ha terminado de publicarla. Mira el calendario en unos minutos.", "servidor");
      return { permalink: r.permalink, avisos: r.avisos };
    }
    const crudo = await postJson(
      URL_PUBLICAR,
      { carrusel: { grupo: a.grupo, ids: a.piezaIds, altTexts: a.altTexts }, caption: a.caption, dryRun: false, fotosTmp: a.fotosTmp.map(rutaTmp).filter(Boolean) },
      true,
    );
    const r = normalizarPublicar(crudo);
    if (r.estado !== "publicada") throw new ErrorInstagram(r.mensaje ?? "Instagram aún no ha terminado de publicarla. Mira el calendario en unos minutos.", "servidor");
    return { permalink: r.permalink, avisos: r.avisos };
  },
  async programar(a) {
    const sb = supabase as unknown as { rpc(f: string, p: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
    const { data, error } = await sb.rpc("instagram_programar", { p_pieza_id: a.piezaIds[0], p_para: a.instante.toISOString(), p_confirmar_conflicto: true });
    if (error) throw new ErrorInstagram(error.message ?? "No se ha podido programar", "servidor");
    const d = (data ?? {}) as { ok?: boolean; error?: string; programacion?: { programada_para?: string } };
    if (d.ok === false) throw new ErrorInstagram(d.error ?? "No se ha podido programar", "servidor");
    return { programadaPara: d.programacion?.programada_para ?? a.instante.toISOString(), avisos: [] };
  },
};

/**
 * Guarda en Google Drive (biblioteca de la marca) las fotos hechas con el
 * móvil, DESPUÉS de publicar o programar. En segundo plano y con reintentos;
 * devuelve cuántas se guardaron.
 */
export async function archivarEnDrive(fotos: Array<{ blob: Blob }>, marca: MarcaId, descripcion: string): Promise<number> {
  let hechas = 0;
  for (const f of fotos) {
    await conReintentos(() => subirFotoDrive({ blob: f.blob, marca, tipo: "plato", descripcion: descripcion.slice(0, 140) }), { intentos: 3 });
    hechas++;
  }
  return hechas;
}
