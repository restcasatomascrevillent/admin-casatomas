/**
 * Publicación de CARRUSELES (2–10 imágenes, migración 20261112000000; ver
 * docs/instagram-carrusel.md) y PROGRAMAR sin prueba previa. Mismo núcleo que
 * las imágenes (publicar.ts: sesión, cerrojo, caption, cuota, estados), con
 * estas diferencias:
 *
 *  - Las imágenes son los JPEG de instagram_piezas.diapositivas (en orden; la
 *    primera es la portada). Antes de nada se comprueba por HEAD que Meta las
 *    podrá descargar TODAS (200, image/jpeg, ≤ 8 MB).
 *  - Contenedores (doc oficial, ver ClienteGraph.crearCarrusel): un hijo por
 *    imagen (is_carousel_item=true, image_url y su alt_text), espera a que
 *    todos estén FINISHED y luego el contenedor CAROUSEL con children y
 *    caption. Si un hijo falla, NO se crea el carrusel ni se publica nada (la
 *    pieza queda en «error» diciendo qué imagen).
 *  - Doble publicación: igual que una imagen (feat/instagram-seguridad). El
 *    contenedor que se guarda es el del CARRUSEL (los hijos no se publican
 *    solos): antes de crear otro se mira si el anterior salió, media_publish
 *    no se reintenta nunca y media_id se guarda nada más publicarse.
 *  - Archivo: las N imágenes van a Drive (marketing/instagram/publicadas/
 *    AAAA-MM). SOLO si Drive las tiene TODAS se borran del bucket (y las copias
 *    tmp/ de sus fotos); drive_id = la portada y drive_ids = todas.
 */
import { carpetaPublicadas, leerConfigDrive } from "../_shared/instagram/drive.ts";
import { ClienteGraph, type FuncionFetch, type InfoContenedor } from "../_shared/instagram/cliente.ts";
import { cuotaDe, type CuotaPublicacion } from "../_shared/instagram/comprobacion.ts";
import { ErrorInstagram, errorInstagramAJson, estadoHttpDeError } from "../_shared/instagram/errores.ts";
import { json } from "../_shared/instagram/http.ts";
import { registro, sanear } from "../_shared/instagram/secretos.ts";
import {
  actualizarPieza,
  anotarAltText,
  anotarDiapositivas,
  anotarDriveCarrusel,
  anotarError,
  borrarObjetos,
  ErrorSupabase,
  programarPieza,
  urlPublica,
  type FilaDiapositiva,
  type FilaPieza,
  type Sesion,
} from "../_shared/instagram/supabase.ts";
import { MAX_BYTES_IMAGEN } from "../_shared/instagram/validacion.ts";
import {
  AVISO_JPEG_NO_BORRADO,
  AVISO_SIN_DRIVE,
  comprobarContenedorAnterior,
  guardarPublicada,
  INTERVALO_SONDEO_MS,
  MIN_PARA_EMPEZAR_MS,
  PRESUPUESTO_SONDEO_MS,
  quedaMs,
  recuperarPublicada,
  RESERVA_PUBLICAR_MS,
  respuestaSinTiempo,
  VIDA_CONTENEDOR_MS,
  type ContextoPublicacion,
  type DependenciasPublicar,
} from "./publicar.ts";

const ETIQUETA = "instagram-publicar";
export const MIN_IMAGENES_CARRUSEL = 2;
export const MAX_IMAGENES_CARRUSEL = 10;

export function esCarrusel(fila: FilaPieza): boolean {
  return fila.tipo_medio === "carrusel";
}

/** Por qué no se puede publicar este carrusel (o null). */
export function problemaCarrusel(fila: FilaPieza): Record<string, unknown> | null {
  const ds = fila.diapositivas;
  if (!Array.isArray(ds) || ds.length < MIN_IMAGENES_CARRUSEL || ds.some((d) => !d || typeof d.imagen_ruta !== "string" || !d.imagen_ruta)) {
    return { ok: false, tipo: "sin_imagenes", error: "El carrusel no tiene sus imágenes: genéralo antes de publicarlo" };
  }
  if (ds.length > MAX_IMAGENES_CARRUSEL) return { ok: false, error: `Un carrusel lleva como mucho ${MAX_IMAGENES_CARRUSEL} imágenes` };
  if (fila.imagen_borrada_at) {
    return { ok: false, tipo: "imagen_borrada", error: "Las imágenes de este carrusel se borraron del bucket por llevar días sin publicarse: vuelve a generarlo" };
  }
  return null;
}

/** HEAD de cada imagen (lo que hará Meta). Devuelve los problemas (vacío = todo bien). Lanza si la red falla. */
async function comprobarImagenes(fetchMeta: FuncionFetch, urls: string[]): Promise<string[]> {
  const problemas = await Promise.all(
    urls.map(async (url, i) => {
      const r = await fetchMeta(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      const tipoMime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const largo = Number(r.headers.get("content-length") ?? "0");
      const p: string[] = [];
      if (r.status !== 200) p.push(`Imagen ${i + 1}: la URL pública responde ${r.status}`);
      else if (tipoMime !== "image/jpeg") p.push(`Imagen ${i + 1}: la URL pública no sirve un JPEG (Content-Type: ${tipoMime || "vacío"})`);
      if (largo > MAX_BYTES_IMAGEN) p.push(`Imagen ${i + 1}: pesa ${(largo / 1048576).toFixed(1)} MB (máximo 8 MB)`);
      return p;
    }),
  );
  return problemas.flat();
}

function errorMeta(e: ErrorInstagram, extra: Record<string, unknown> = {}): Response {
  return json(estadoHttpDeError(e), { ok: false, ...errorInstagramAJson(e), ...extra });
}

/** Pasos con Meta de un carrusel, con la pieza ya reservada (cerrojo). */
export async function publicarCarruselReservado(c: ContextoPublicacion): Promise<Response> {
  const { s, sw, env, deps, id, dryRun, fotosTmp, fila, cfg, cuenta, contenedorPedido, caption, avisos, resumenCaption } = c;
  const ds = fila.diapositivas as FilaDiapositiva[];
  const altTexts = c.altTexts ?? ds.map((d) => d.alt_text ?? "");
  const urls = ds.map((d) => urlPublica(s.sb, d.imagen_ruta));
  const fetchMeta: FuncionFetch = (url, init) => (deps.fetch ?? fetch)(url, init);
  const cliente = new ClienteGraph({
    token: cfg.token,
    versionApi: cfg.versionApi,
    igUserId: cfg.igUserId,
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    fetch: fetchMeta,
    dormir: deps.dormir,
    ahora: deps.ahora,
    timeoutMs: 15_000,
    reintentos: 2,
    registro: (l) => registro("info", ETIQUETA, l),
    limite: deps.limite,
  });

  // 0. Sin tiempo (programador): ni se empieza. ¿El carrusel anterior salió? No se publica otra vez.
  if (!contenedorPedido && quedaMs(deps) < MIN_PARA_EMPEZAR_MS) return respuestaSinTiempo(c, null);
  const previo = await comprobarContenedorAnterior(c, cliente, contenedorPedido);
  if (previo) return previo;

  // 1. Todas las imágenes se descargan sin sesión (es lo que hará Meta).
  if (!contenedorPedido) {
    let problemas: string[];
    try {
      problemas = await comprobarImagenes(fetchMeta, urls);
    } catch (e) {
      registro("warn", ETIQUETA, "HEAD de las imágenes del carrusel", e);
      return json(502, { ok: false, error: "No se pudo comprobar la URL pública de las imágenes del carrusel" });
    }
    if (problemas.length) {
      await anotarError(sw, id, problemas.join(" · "));
      return json(422, {
        ok: false,
        error: "Meta no podría descargar las imágenes del carrusel",
        problemas,
        comoArreglarlo: "Vuelve a generar el carrusel. Si sigue igual, comprueba que el bucket «instagram» de Supabase es público (Storage → instagram → Public).",
      });
    }
  }

  // 2. Cuota (un carrusel cuenta como UNA publicación).
  let cuota: CuotaPublicacion;
  try {
    cuota = cuotaDe(await cliente.limitePublicacion());
  } catch (e) {
    if (e instanceof ErrorInstagram) {
      await anotarError(sw, id, `${e.message}. ${e.comoArreglarlo}`);
      return errorMeta(e);
    }
    throw e;
  }
  if (cuota.total === null) avisos.push("Meta no devolvió config.quota_total; no se puede comprobar la cuota antes de publicar.");
  else if (cuota.usadas >= cuota.total) {
    return json(429, {
      ok: false,
      error: `Cuota de publicación agotada: ${cuota.usadas}/${cuota.total} en las últimas ${cuota.ventanaHoras ?? 24} h`,
      comoArreglarlo: "Espera a que pase la ventana de 24 h. No se ha creado ni publicado nada.",
      cuota,
    });
  }

  const ahora = deps.ahora ?? Date.now;
  const inicio = ahora();
  const presupuesto = deps.presupuestoMs ?? PRESUPUESTO_SONDEO_MS;
  const intervalo = deps.intervaloMs ?? INTERVALO_SONDEO_MS;
  const sondeo = () => ({ intervaloMs: intervalo, maxMs: Math.max(1_000, Math.min(presupuesto - (ahora() - inicio), quedaMs(deps) - RESERVA_PUBLICAR_MS)) });
  let contenedorId = contenedorPedido;
  let info: InfoContenedor;
  let publicadaYa = false;
  let hijos: string[] = [];
  try {
    // 3. Hijos (uno por imagen) → FINISHED → contenedor CAROUSEL. Un fallo aquí no publica nada.
    if (!contenedorId) {
      const r = await cliente.crearCarrusel(
        urls.map((u, i) => ({ imageUrl: u, altText: altTexts[i] || undefined })),
        { caption: caption || undefined, sondeo: sondeo() },
      );
      contenedorId = r.contenedorId;
      hijos = r.hijos;
      await actualizarPieza(sw, id, { contenedor_id: contenedorId, caption, error: null });
      // Se guardan los textos alternativos enviados (el programador los reutiliza).
      if (ds.some((d, i) => (d.alt_text ?? "") !== altTexts[i])) {
        const aviso = await anotarDiapositivas(sw, id, ds.map((d, i) => ({ ...d, alt_text: altTexts[i] || null })));
        if (aviso) avisos.push(aviso);
      }
      // alt_text de la fila = el de la portada (historial y búsquedas).
      if ((fila.alt_text ?? "") !== (altTexts[0] ?? "")) {
        const aviso = await anotarAltText(sw, id, altTexts[0] || null);
        if (aviso) avisos.push(aviso);
      }
    }
    // 4. El carrusel hasta FINISHED, dentro del tiempo de la función.
    try {
      info = await cliente.esperarFinished(contenedorId, sondeo());
    } catch (e) {
      if (e instanceof ErrorInstagram && e.tipo === "contenedor_tiempo_agotado" && quedaMs(deps) < RESERVA_PUBLICAR_MS) {
        return respuestaSinTiempo(c, contenedorId);
      }
      if (e instanceof ErrorInstagram && e.tipo === "contenedor_tiempo_agotado") {
        const ultimo = /último estado: ([A-Z_]+)/.exec(e.message)?.[1] ?? "IN_PROGRESS";
        return json(202, {
          ok: true,
          estado: "en_proceso",
          id,
          dryRun,
          publicado: false,
          tipoMedio: "carrusel",
          contenedor: { id: contenedorId, estado: ultimo, hijos },
          cuota,
          cuenta,
          avisos,
          mensaje: "Instagram todavía está procesando el carrusel. Vuelve a intentarlo en unos segundos con el mismo contenedor.",
          reintentar: { id, contenedorId, dryRun },
        });
      }
      throw e;
    }

    // 5. Prueba (opción interna): termina aquí, SIN media_publish.
    if (dryRun) {
      await actualizarPieza(sw, id, { estado: "prueba_ok", contenedor_id: contenedorId, caption, error: null });
      return json(200, {
        ok: true,
        id,
        dryRun: true,
        publicado: false,
        estado: "prueba_ok",
        tipoMedio: "carrusel",
        contenedor: { id: contenedorId, estado: info.estado, hijos },
        urlsJpeg: urls,
        mediaId: null,
        permalink: null,
        cuota,
        cuenta,
        caption: resumenCaption,
        avisos: [...avisos, "Prueba correcta: no se ha publicado nada. El contenedor caduca en 24 h."],
      });
    }

    // 6. Publicación real: media_publish UNA vez (sin reintentos; publicarSinDuplicar).
    if (info.estado !== "FINISHED") throw new ErrorInstagram({ tipo: "contenedor_no_listo" });
    if (quedaMs(deps) < RESERVA_PUBLICAR_MS) return respuestaSinTiempo(c, contenedorId);
    const pub = await cliente.publicarSinDuplicar(contenedorId, { caption, tipo: "post", desdeMs: inicio });
    if (pub.recuperado) return await recuperarPublicada(c, cliente, contenedorId, { encontrado: pub, desdeMs: inicio });
    const mediaId = pub.mediaId as string;
    // LO PRIMERO: que conste que ya está en Instagram (antes de Drive o de borrar nada).
    publicadaYa = true;
    const avisoGuardar = await guardarPublicada(c, { contenedor_id: contenedorId, media_id: mediaId, error: null });
    if (avisoGuardar) avisos.push(avisoGuardar);
    let permalink: string | null = null;
    try {
      permalink = await cliente.permalink(mediaId);
    } catch {
      avisos.push("Publicado, pero no se pudo obtener el enlace (permalink).");
    }
    const cuotaDespues = { ...cuota, usadas: cuota.usadas + 1, restantes: cuota.restantes === null ? null : Math.max(0, cuota.restantes - 1) };

    // 7. Archivo: las N imágenes a Drive; solo si están TODAS se borran del bucket.
    const archivo = await archivarCarruselEnDrive(s, env, { ...fila, caption }, urls, deps);
    let enBucket = true;
    let errorFila: string | null = null;
    if (archivo.driveIds) {
      const rutas = ds.map((d) => d.imagen_ruta);
      const borradas = await borrarObjetos(s, rutas);
      enBucket = borradas < rutas.length;
      if (enBucket) {
        const motivo = `se borraron ${borradas} de ${rutas.length} imágenes (¿la RLS del bucket no deja borrar a este usuario?)`;
        registro("warn", ETIQUETA, "carrusel publicado, pero quedan imágenes en el bucket", { id, borradas, total: rutas.length });
        avisos.push(`Publicado y guardado en Drive, pero no se pudieron borrar todas las imágenes del bucket: ${motivo}`);
        errorFila = `${AVISO_JPEG_NO_BORRADO} ${motivo}`;
      }
      if (fotosTmp.length) await borrarObjetos(s, fotosTmp);
    } else {
      registro("warn", ETIQUETA, "carrusel publicado, pero sin archivar en Drive", { id, motivo: archivo.motivo });
      avisos.push(`Publicado, pero no se pudo guardar en Google Drive: ${archivo.motivo}. Las imágenes se quedan en el bucket «instagram» (no se ha borrado ninguna).`);
      errorFila = `${AVISO_SIN_DRIVE} ${archivo.motivo}`.trim();
    }
    const avisoFinal = await guardarPublicada(c, { contenedor_id: contenedorId, media_id: mediaId, permalink, error: errorFila });
    if (avisoFinal && !avisoGuardar) avisos.push("Publicado y anotado, pero no se pudo guardar el enlace ni los avisos de Drive.");
    if (archivo.driveIds) {
      try {
        await anotarDriveCarrusel(sw, id, archivo.driveIds);
      } catch (e) {
        registro("warn", ETIQUETA, "no se pudieron anotar los ficheros de Drive del carrusel", e);
        avisos.push("Las imágenes están en Drive, pero no se pudieron anotar en la pieza (¿falta la migración 20261112000000_instagram_carrusel?).");
      }
    }
    registro("info", ETIQUETA, "carrusel publicado", { id, mediaId, imagenes: ds.length, usuario: s.usuario });
    return json(200, {
      ok: true,
      id,
      dryRun: false,
      publicado: true,
      estado: "publicada",
      tipoMedio: "carrusel",
      contenedor: { id: contenedorId, estado: info.estado, hijos },
      urlsJpeg: urls,
      imagenEnBucket: enBucket,
      driveId: archivo.driveIds?.[0] ?? null,
      driveIds: archivo.driveIds,
      mediaId,
      permalink,
      cuota: cuotaDespues,
      cuenta,
      caption: resumenCaption,
      avisos,
    });
  } catch (e) {
    // Ya en Instagram (media_id guardado): nunca se pasa a «error».
    if (publicadaYa) {
      registro("error", ETIQUETA, "fallo después de publicar el carrusel (sigue publicado)", e);
      return json(500, { ok: false, publicado: true, error: "Publicado en Instagram, pero algo falló después (enlace o archivo). No lo vuelvas a publicar.", detalle: sanear((e as Error)?.message ?? e) });
    }
    if (e instanceof ErrorInstagram && e.tipo === "contenedor_ya_publicado" && contenedorId) {
      return await recuperarPublicada(c, cliente, contenedorId, { desdeMs: inicio - VIDA_CONTENEDOR_MS });
    }
    if (e instanceof ErrorInstagram) {
      registro("warn", ETIQUETA, "error de Meta (carrusel)", { id, tipo: e.tipo, codigo: e.codigo, subcodigo: e.subcodigo, mensaje: e.message });
      await anotarError(sw, id, `${e.message}. ${e.comoArreglarlo}`);
      return errorMeta(e, { contenedor: contenedorId ? { id: contenedorId } : null, cuota });
    }
    if (e instanceof ErrorSupabase) {
      registro("error", ETIQUETA, "base de datos (carrusel)", e);
      return json(500, { ok: false, error: e.message, contenedor: contenedorId ? { id: contenedorId } : null });
    }
    registro("error", ETIQUETA, "fallo (carrusel)", e);
    await anotarError(sw, id, (e as Error)?.message ?? String(e));
    return json(500, { ok: false, error: "No se pudo publicar el carrusel", detalle: sanear((e as Error)?.message ?? e) });
  }
}

/**
 * Guarda las N imágenes publicadas en Drive (marketing/instagram/publicadas/AAAA-MM).
 * Nunca lanza: devuelve los ids (todos, en orden) o el motivo por el que no se pudo.
 * Si falla una, no vale ninguna (las ya subidas se quedan en Drive: no se borra nada allí).
 */
export async function archivarCarruselEnDrive(
  s: Sesion,
  env: Record<string, string | undefined>,
  fila: FilaPieza,
  urls: string[],
  deps: DependenciasPublicar,
): Promise<{ driveIds: string[] | null; motivo: string }> {
  void s;
  const cfg = leerConfigDrive(env, { fetch: deps.fetch });
  if ("faltan" in cfg) return { driveIds: null, motivo: cfg.problema };
  try {
    const fecha = new Date((deps.ahora ?? Date.now)());
    const carpeta = await carpetaPublicadas(cfg.config, fecha);
    const ids: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const r = await (deps.fetch ?? fetch)(urls[i], { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return { driveIds: null, motivo: `no se pudo leer la imagen ${i + 1} del bucket (${r.status})` };
      const bytes = new Uint8Array(await r.arrayBuffer());
      const nombre = `${fecha.toISOString().slice(0, 10)}_${fila.marca}_carrusel_${fila.id.slice(0, 8)}_${String(i + 1).padStart(2, "0")}.jpg`;
      const subido = await cfg.config.cliente.subir(carpeta, nombre, "image/jpeg", bytes, i === 0 && fila.caption ? fila.caption.slice(0, 500) : undefined);
      ids.push(subido.id);
    }
    return { driveIds: ids, motivo: "" };
  } catch (e) {
    return { driveIds: null, motivo: sanear((e as Error)?.message ?? String(e)) };
  }
}

// ── Programar sin prueba previa ─────────────────────────────────────────────

export interface ContextoProgramar {
  s: Sesion;
  env: Record<string, string | undefined>;
  deps: DependenciasPublicar;
  id: string;
  fila: FilaPieza;
  cuenta: { marca: string; igUserId: string; propia: boolean };
  caption: string;
  altText: string;
  altTexts: string[] | null;
  avisos: string[];
  resumenCaption: { caracteres: number; hashtags: number; menciones: number };
}

/**
 * Programa la pieza SIN «Prueba sin publicar»: el texto y los textos
 * alternativos ya están validados (publicarConSesion); aquí se comprueba que
 * Meta podrá descargar las imágenes y se llama a la RPC instagram_programar
 * con el JWT del usuario (comprueba «Editar», la fecha y los conflictos) y con
 * el texto en la misma llamada. Imagen y reel: igual (el reel no se comprueba
 * por HEAD: lo hará la publicación).
 */
export async function programarConSesion(
  c: ContextoProgramar,
  o: { para: string; confirmarConflicto: boolean; captionLlega: boolean; altTextLlega: boolean; altTextsLlegan: boolean },
): Promise<Response> {
  const { s, deps, id, fila, cuenta, caption, altText, altTexts, avisos, resumenCaption } = c;
  if (fila.tipo_medio !== "reel") {
    const rutas = esCarrusel(fila) ? (fila.diapositivas ?? []).map((d) => d.imagen_ruta) : fila.imagen_ruta ? [fila.imagen_ruta] : [];
    if (rutas.length) {
      try {
        const problemas = await comprobarImagenes((url, init) => (deps.fetch ?? fetch)(url, init), rutas.map((r) => urlPublica(s.sb, r)));
        if (problemas.length) {
          return json(422, {
            ok: false,
            error: "Meta no podría descargar la imagen: no se programa",
            problemas,
            comoArreglarlo: "Vuelve a generar la pieza y prográmala otra vez.",
          });
        }
      } catch (e) {
        registro("warn", ETIQUETA, "HEAD al programar", e);
        return json(502, { ok: false, error: "No se pudo comprobar la URL pública de la imagen" });
      }
    }
  }
  const r = await programarPieza(s, {
    piezaId: id,
    para: o.para,
    confirmarConflicto: o.confirmarConflicto,
    // Solo lo que llega: lo guardado ya está en la pieza.
    caption: o.captionLlega ? caption : null,
    altText: o.altTextLlega && !esCarrusel(fila) ? altText : null,
    altTexts: o.altTextsLlegan && altTexts ? altTexts : null,
  });
  if (!r.ok) {
    const sinMigracion = r.estado === 404 || /PGRST202|42883|Could not find the function/i.test(r.error);
    if (sinMigracion) {
      return json(503, { ok: false, error: "Falta aplicar la migración 20261112000000_instagram_carrusel (instagram_programar con el texto)." });
    }
    const estado = r.estado === 401 ? 401 : r.estado === 403 || /42501|permiso|Editar/i.test(r.error) ? 403 : 422;
    return json(estado, { ok: false, error: r.error || "No se pudo programar" });
  }
  const v = r.valor;
  if (v.ok !== true) {
    // 200, como la RPC: el panel enseña los conflictos y repite con confirmarConflicto.
    return json(200, {
      ok: false,
      id,
      requiereConfirmacion: v.requiereConfirmacion === true,
      conflictos: v.conflictos ?? [],
      error: "Hay otra publicación de la marca a menos de 30 minutos: confirma para programarla igualmente.",
    });
  }
  registro("info", ETIQUETA, "programada", { id, para: o.para, usuario: s.usuario });
  return json(200, {
    ok: true,
    id,
    programado: true,
    accion: v.accion ?? "programada",
    programacion: v.programacion ?? null,
    conflictos: v.conflictos ?? [],
    cuenta,
    caption: resumenCaption,
    avisos,
  });
}
