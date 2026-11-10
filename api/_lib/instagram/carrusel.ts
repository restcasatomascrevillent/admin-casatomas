/**
 * Render de un CARRUSEL (2–10 imágenes 1080×1350) en una sola llamada a
 * POST /api/instagram-render. Ver docs/instagram-carrusel.md.
 *
 *   Cuerpo: { "tipo": "carrusel", "marca": "casa-tomas"|"touza",
 *             "diapositivas": [ { foto, plantilla, datos, altText?, fotoPreparada? }, … ],
 *             "id"?: "<uuid para regenerar>", "caption"?: "…" }
 *     Cada diapositiva es una DiapositivaMontada (src/lib/instagram/montar.ts,
 *     lo que devuelve «Montar con IA») + la foto preparada en el bucket
 *     (`fotoPreparada`, la misma forma que en una pieza suelta). Se valida con
 *     el esquema de siempre (validarPieza) como un post de la marca:
 *     { ...datos, marca, plantilla, formato: "post", foto }.
 *   200: { ok, id, estado: "generada", tipoMedio: "carrusel", urlJpeg (portada),
 *          imagenRuta (portada), diapositivas: [{ orden, urlJpeg, imagenRuta, ancho, alto, bytes, calidad, avisos }],
 *          avisos, msTotal }
 *   400 cuerpo · 404 id · 409 publicada / no es un carrusel · 422 problemas
 *   («Imagen N: …», de TODAS las imágenes a la vez) · 500/502.
 *
 * Un solo Chromium y varias páginas a la vez (INSTAGRAM_RENDER_PARALELO, 3
 * por defecto): 6 imágenes tardan como 2 sueltas. Los JPEG se suben en
 * paralelo a piezas/AAAA-MM/<id>-NN.jpg con el JWT del usuario y la fila se
 * guarda UNA vez con todas (columna diapositivas, migración 20261112000000).
 * Si se regenera con menos imágenes, las que sobran se borran del bucket.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { json } from "./http.js";
import { lanzarNavegador } from "./navegador.js";
import {
  CODIGO_COMPROBAR_MAQUETACION,
  CODIGO_ESPERAR_RECURSOS,
  RUTA_RECURSOS_PANEL,
  baseFotosPublica,
  baseRecursosPanel,
  construirDocumento,
  fondoDeMarca,
  medidas,
  validarPieza,
  type DatosPieza,
} from "./nucleo.js";
import { CONCURRENCIA_LOTE, crearRenderizadorLote, ErrorRender, loteDesde, type PeticionRender, type RenderizadorLote, type ResultadoLote } from "./render.js";
import { catalogoParaPieza, ErrorFotoPreparada } from "./fotos.js";
import { registro, sanear } from "./secretos.js";
import {
  actualizarPieza,
  borrarObjetos,
  ErrorSupabase,
  insertarPieza,
  leerPieza,
  subirJpeg,
  urlPublica,
  type FilaDiapositiva,
  type FilaPieza,
  type Sesion,
} from "./supabase.js";
import { MARCAS } from "../../../src/lib/instagram/tokens.js";
import type { DependenciasRender } from "../../instagram-render.js";

const ETIQUETA = "instagram-render";
export const MIN_DIAPOSITIVAS = 2;
/** = MAX_FOTOS_CARRUSEL de src/lib/instagram/montar.ts (un test comprueba que coinciden; Meta admite hasta 20). */
export const MAX_DIAPOSITIVAS = 10;
export const MAX_ALT_TEXT = 1000;

/** Ruta del JPEG de la imagen `orden` (1…10) de un carrusel: piezas/AAAA-MM/<id>-NN.jpg */
export function rutaDiapositiva(id: string, orden: number, mes: string): string {
  return `piezas/${mes}/${id}-${String(orden).padStart(2, "0")}.jpg`;
}

/** AAAA-MM de una ruta piezas/AAAA-MM/… (null si no lo es). */
export function mesDeRuta(ruta: string | null | undefined): string | null {
  return /^piezas\/(\d{4}-\d{2})\//.exec(ruta ?? "")?.[1] ?? null;
}

/** Concurrencia del render (1–6), de INSTAGRAM_RENDER_PARALELO. */
export function concurrenciaRender(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.INSTAGRAM_RENDER_PARALELO);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 6) : CONCURRENCIA_LOTE;
}

interface DiapositivaValida {
  orden: number;
  foto: string | null;
  plantilla: string;
  datos: DatosPieza;
  altText: string | null;
  fotos: Awaited<ReturnType<typeof catalogoParaPieza>>;
}

/** Valida el cuerpo y cada diapositiva con el esquema de siempre. */
async function validar(
  s: Sesion,
  entrada: Record<string, unknown>,
): Promise<{ ok: true; marca: string; diapositivas: DiapositivaValida[] } | { ok: false; estado: 400 | 422 | 502; cuerpo: Record<string, unknown> }> {
  const marca = entrada.marca;
  if (typeof marca !== "string" || !(marca in MARCAS)) return { ok: false, estado: 400, cuerpo: { ok: false, error: "«marca» no es válida" } };
  const lista = entrada.diapositivas;
  if (!Array.isArray(lista)) return { ok: false, estado: 400, cuerpo: { ok: false, error: "Falta «diapositivas» (lista de imágenes del carrusel)" } };
  if (lista.length < MIN_DIAPOSITIVAS || lista.length > MAX_DIAPOSITIVAS) {
    return {
      ok: false,
      estado: 422,
      cuerpo: { ok: false, error: `Un carrusel lleva de ${MIN_DIAPOSITIVAS} a ${MAX_DIAPOSITIVAS} imágenes (llegan ${lista.length})`, problemas: [`Número de imágenes: ${lista.length}`] },
    };
  }
  const problemas: string[] = [];
  const salida: DiapositivaValida[] = [];
  for (let i = 0; i < lista.length; i++) {
    const n = i + 1;
    const d = lista[i] as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      problemas.push(`Imagen ${n}: no es un objeto`);
      continue;
    }
    if (typeof d.plantilla !== "string") problemas.push(`Imagen ${n}: falta «plantilla»`);
    if (d.datos !== undefined && (typeof d.datos !== "object" || d.datos === null || Array.isArray(d.datos))) problemas.push(`Imagen ${n}: «datos» tiene que ser un objeto`);
    if (d.foto !== undefined && d.foto !== null && typeof d.foto !== "string") problemas.push(`Imagen ${n}: «foto» tiene que ser texto`);
    const alt = d.altText ?? d.alt_text;
    if (alt !== undefined && alt !== null && typeof alt !== "string") problemas.push(`Imagen ${n}: «altText» tiene que ser texto`);
    if (typeof alt === "string" && alt.trim().length > MAX_ALT_TEXT) problemas.push(`Imagen ${n}: el texto alternativo pasa de ${MAX_ALT_TEXT} caracteres`);
    if (typeof d.plantilla !== "string") continue;
    // Pieza como un post de la marca: mismos campos que DatosPieza.
    const datos = (d.datos ?? {}) as Record<string, unknown>;
    const pieza: Record<string, unknown> = { ...datos, marca, plantilla: d.plantilla, formato: "post" };
    if (typeof d.foto === "string" && d.foto) pieza.foto = d.foto;
    let fotos: DiapositivaValida["fotos"];
    try {
      fotos = await catalogoParaPieza(s, pieza, d.fotoPreparada);
    } catch (e) {
      if (e instanceof ErrorFotoPreparada) {
        problemas.push(`Imagen ${n}: ${e.message}`);
        continue;
      }
      registro("error", ETIQUETA, "leer foto subida (carrusel)", e);
      return { ok: false, estado: 502, cuerpo: { ok: false, error: sanear((e as Error).message) } };
    }
    const v = validarPieza(pieza, { fotos });
    if (!v.ok) {
      problemas.push(...(v.problemas ?? []).map((p) => `Imagen ${n}: ${p}`));
      continue;
    }
    salida.push({ orden: n, foto: typeof pieza.foto === "string" ? pieza.foto : null, plantilla: v.datos.plantilla, datos: v.datos, altText: typeof alt === "string" && alt.trim() ? alt.trim() : null, fotos });
  }
  if (problemas.length) return { ok: false, estado: 422, cuerpo: { ok: false, error: "El carrusel no es válido", problemas } };
  return { ok: true, marca, diapositivas: salida };
}

export async function manejarRenderCarrusel(
  request: Request,
  s: Sesion,
  entrada: Record<string, unknown>,
  deps: DependenciasRender,
  t0: number,
): Promise<Response> {
  const v = await validar(s, entrada);
  if (!v.ok) {
    // Cast explícito: Vercel compila api/ sin strictNullChecks y ahí `ok: false` no estrecha la unión.
    const fallo = v as Extract<typeof v, { ok: false }>;
    return json(fallo.estado, fallo.cuerpo);
  }

  let existente: FilaPieza | null = null;
  const idPedido = typeof entrada.id === "string" ? entrada.id : null;
  try {
    if (idPedido) {
      existente = await leerPieza(s, idPedido, { conCarrusel: true });
      if (!existente) return json(404, { ok: false, error: "No existe esa pieza (o no tienes acceso)" });
      if (existente.estado === "publicada") {
        return json(409, { ok: false, error: "Ese carrusel ya está publicado en Instagram; crea uno nuevo", permalink: existente.permalink });
      }
      if (existente.tipo_medio !== "carrusel") {
        return json(409, { ok: false, tipo: "no_es_carrusel", error: "Esa pieza no es un carrusel: crea una nueva (una pieza no cambia de tipo)" });
      }
    }
  } catch (e) {
    registro("error", ETIQUETA, "leer pieza (carrusel)", e);
    return json(e instanceof ErrorSupabase && e.estado < 500 ? 502 : 500, { ok: false, error: sanear((e as Error).message) });
  }

  // Un Chromium, varias páginas a la vez.
  const origen = new URL(request.url).origin;
  const recursosLocales = { origen, prefijo: RUTA_RECURSOS_PANEL, dir: deps.dirRecursos ?? path.join(process.cwd(), "public", "instagram") };
  const peticiones: PeticionRender[] = v.diapositivas.map((d) => {
    const { ancho, alto } = medidas(d.datos);
    return {
      html: construirDocumento(d.datos, { baseRecursos: baseRecursosPanel(origen), baseFotos: baseFotosPublica(s.sb.url), fotos: d.fotos }),
      ancho,
      alto,
      codigoComprobar: CODIGO_COMPROBAR_MAQUETACION,
      codigoEsperar: CODIGO_ESPERAR_RECURSOS,
      fondo: fondoDeMarca(d.datos),
      recursosLocales,
    };
  });
  const lote: RenderizadorLote = deps.renderizarLote ?? (deps.renderizar ? loteDesde(deps.renderizar) : crearRenderizadorLote(lanzarNavegador));
  let resultados: Awaited<ReturnType<RenderizadorLote>>;
  const tRender = performance.now();
  try {
    resultados = await lote(peticiones, { concurrencia: concurrenciaRender({ INSTAGRAM_RENDER_PARALELO: deps.env?.INSTAGRAM_RENDER_PARALELO ?? process.env.INSTAGRAM_RENDER_PARALELO }) });
  } catch (e) {
    registro("error", ETIQUETA, "render carrusel", e);
    return json(500, { ok: false, error: "No se pudo generar el carrusel en el servidor", detalle: sanear((e as Error)?.message ?? e) });
  }
  const msRender = Math.round(performance.now() - tRender);
  const fallos = resultados.flatMap((r, i) => (r.ok ? [] : [{ n: i + 1, error: (r as Extract<ResultadoLote, { ok: false }>).error }]));
  if (fallos.length) {
    const inesperado = fallos.find((f) => !(f.error instanceof ErrorRender));
    if (inesperado) {
      registro("error", ETIQUETA, "render carrusel", inesperado.error);
      return json(500, { ok: false, error: `No se pudo generar la imagen ${inesperado.n} del carrusel`, detalle: sanear((inesperado.error as Error)?.message ?? inesperado.error) });
    }
    const errores = fallos.map((f) => ({ n: f.n, e: f.error as ErrorRender }));
    const tipo = errores.some((x) => x.e.tipo === "recursos") ? "recursos" : errores.some((x) => x.e.tipo === "maquetacion") ? "maquetacion" : "tamano";
    const titulo = tipo === "maquetacion" ? "Alguna imagen no pasa las comprobaciones de maquetación" : tipo === "recursos" ? "Hay recursos del carrusel que no cargan" : "Alguna imagen generada no es válida";
    return json(422, {
      ok: false,
      error: titulo,
      tipo,
      imagenes: errores.map((x) => x.n),
      problemas: errores.flatMap((x) => x.e.problemas.map((p) => `Imagen ${x.n}: ${p}`)),
    });
  }
  const imagenes = resultados.map((r) => (r as { ok: true; r: Awaited<ReturnType<NonNullable<DependenciasRender["renderizar"]>>> }).r);

  const id = existente?.id ?? (deps.nuevoId ?? randomUUID)();
  // Al regenerar se conserva el mes de las rutas; si no, el actual.
  const mes = mesDeRuta(existente?.imagen_ruta) ?? (deps.ahora ?? (() => new Date()))().toISOString().slice(0, 7);
  const rutas = v.diapositivas.map((d) => rutaDiapositiva(id, d.orden, mes));
  const diapositivas: FilaDiapositiva[] = v.diapositivas.map((d, i) => ({ foto: d.foto, plantilla: d.plantilla, datos: d.datos, alt_text: d.altText, imagen_ruta: rutas[i] }));
  const caption = typeof entrada.caption === "string" ? entrada.caption : undefined;
  const portada = v.diapositivas[0];
  try {
    await Promise.all(rutas.map((ruta, i) => subirJpeg(s, ruta, imagenes[i].jpg)));
    const cambios: Partial<FilaPieza> & Record<string, unknown> = {
      marca: v.marca,
      plantilla: portada.plantilla,
      formato: "carrusel",
      tipo_medio: "carrusel",
      // datos = la portada (para el historial y las miniaturas); todas, en diapositivas.
      datos: portada.datos,
      diapositivas,
      estado: "generada",
      imagen_ruta: rutas[0],
      error: null,
      contenedor_id: null,
      ...(caption !== undefined ? { caption } : {}),
    };
    if (existente) await actualizarPieza(s, id, cambios);
    else await insertarPieza(s, { id, ...cambios });
  } catch (e) {
    registro("error", ETIQUETA, "guardar carrusel", e);
    const estado = e instanceof ErrorSupabase && (e.estado === 401 || e.estado === 403) ? 403 : e instanceof ErrorSupabase && e.estado === 409 ? 409 : 500;
    return json(estado, { ok: false, error: sanear((e as Error).message) });
  }

  // Regenerado con menos imágenes: las que sobran ya no son de nadie.
  const avisos = imagenes.flatMap((r, i) => r.avisos.map((a) => `Imagen ${i + 1}: ${a}`));
  const sobrantes = (existente?.diapositivas ?? []).map((d) => d?.imagen_ruta).filter((r): r is string => typeof r === "string" && !rutas.includes(r));
  if (sobrantes.length) {
    const borradas = await borrarObjetos(s, sobrantes);
    if (borradas < sobrantes.length) avisos.push(`No se pudieron borrar ${sobrantes.length - borradas} imágenes viejas del carrusel (las quitará la limpieza).`);
  }

  const v0 = Date.now();
  registro("info", ETIQUETA, "carrusel generado", {
    id,
    usuario: s.usuario,
    imagenes: rutas.length,
    bytes: imagenes.reduce((t, r) => t + r.jpg.byteLength, 0),
    msRender,
    msTotal: Math.round(performance.now() - t0),
  });
  return json(200, {
    ok: true,
    id,
    estado: "generada",
    tipoMedio: "carrusel",
    urlJpeg: `${urlPublica(s.sb, rutas[0])}?v=${v0}`,
    imagenRuta: rutas[0],
    diapositivas: imagenes.map((r, i) => ({
      orden: i + 1,
      urlJpeg: `${urlPublica(s.sb, rutas[i])}?v=${v0}`,
      imagenRuta: rutas[i],
      ancho: r.ancho,
      alto: r.alto,
      bytes: r.jpg.byteLength,
      calidad: r.calidad,
      avisos: r.avisos,
      tiempos: r.tiempos,
    })),
    avisos,
    msRender,
    msTotal: Math.round(performance.now() - t0),
  });
}
