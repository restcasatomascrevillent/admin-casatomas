/**
 * POST /api/instagram-render — genera el JPEG de una pieza de Instagram en el
 * servidor (Vercel Function, Node) con Chromium (playwright-core +
 * @sparticuz/chromium) y lo guarda en el bucket «instagram». Ver docs/instagram.md.
 *
 *   Petición: `Authorization: Bearer <JWT de Supabase>` y JSON
 *             { "pieza": { …JSON de la pieza… }, "id"?: "<uuid para regenerar>", "caption"?: "…" }
 *   200: { ok: true, id, urlJpeg, imagenRuta, ancho, alto, bytes, calidad, avisos: string[], estado: "generada" }
 *   Errores (JSON { ok: false, error, problemas? }):
 *     400 cuerpo no válido · 401 sin sesión · 403 sin permiso de Marketing ·
 *     404 el id no existe (o la RLS no lo deja ver) · 409 la pieza ya está publicada ·
 *     413 cuerpo > 256 KB · 422 la pieza no es válida, no carga un recurso o
 *     no pasa la maquetación (problemas: string[]) · 500/502 fallo del servidor.
 *
 * Todo con el JWT del usuario (clave pública + Authorization): la RLS de
 * instagram_piezas y del bucket decide. Nunca service_role.
 *
 * GET /api/instagram-render (con sesión de Marketing) — diagnóstico: arranca
 * Chromium y renderiza un lienzo de prueba (sin guardar nada).
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { json, jsonAuth, leerJson } from "./_lib/instagram/http.js";
import { lanzarNavegador } from "./_lib/instagram/navegador.js";
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
} from "./_lib/instagram/nucleo.js";
import { crearRenderizador, ErrorRender, type Renderizador } from "./_lib/instagram/render.js";
import { registro, sanear } from "./_lib/instagram/secretos.js";
import {
  autorizarMarketing,
  ErrorSupabase,
  insertarPieza,
  actualizarPieza,
  leerPieza,
  rutaJpeg,
  subirJpeg,
  urlPublica,
  type FilaPieza,
} from "./_lib/instagram/supabase.js";
import { esUuid } from "./_lib/instagram/validacion.js";

const ETIQUETA = "instagram-render";

export interface DependenciasRender {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  renderizar?: Renderizador;
  /** Carpeta con fuentes y logos (public/instagram). Por defecto, la del bundle. */
  dirRecursos?: string;
  ahora?: () => Date;
  nuevoId?: () => string;
}

export async function manejarRender(request: Request, deps: DependenciasRender = {}): Promise<Response> {
  const t0 = performance.now();
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env: deps.env, fetch: deps.fetch });
  if ("motivo" in auth) {
    if (auth.estado >= 500) registro("error", ETIQUETA, "autorización", { motivo: auth.motivo });
    return jsonAuth(auth.estado, auth.motivo);
  }
  const s = auth.sesion;

  const cuerpo = await leerJson(request);
  if ("error" in cuerpo) return json(cuerpo.estado, { ok: false, error: cuerpo.error });
  const entrada = cuerpo.valor as { pieza?: unknown; id?: unknown; caption?: unknown } | null;
  if (!entrada || typeof entrada !== "object" || entrada.pieza === undefined) {
    return json(400, { ok: false, error: "Falta «pieza» en el cuerpo" });
  }
  if (entrada.id !== undefined && entrada.id !== null && !esUuid(entrada.id)) return json(400, { ok: false, error: "«id» no es un UUID" });
  if (entrada.caption !== undefined && typeof entrada.caption !== "string") return json(400, { ok: false, error: "«caption» tiene que ser texto" });

  const v = validarPieza(entrada.pieza);
  if ("problemas" in v) return json(422, { ok: false, error: "La pieza no es válida", problemas: v.problemas });
  const datos = v.datos;

  let existente: FilaPieza | null = null;
  const idPedido = typeof entrada.id === "string" ? entrada.id : null;
  try {
    if (idPedido) {
      existente = await leerPieza(s, idPedido);
      if (!existente) return json(404, { ok: false, error: "No existe esa pieza (o no tienes acceso)" });
      if (existente.estado === "publicada") {
        return json(409, { ok: false, error: "Esa pieza ya está publicada en Instagram; crea una nueva", permalink: existente.permalink });
      }
    }
  } catch (e) {
    registro("error", ETIQUETA, "leer pieza", e);
    return json(e instanceof ErrorSupabase && e.estado < 500 ? 502 : 500, { ok: false, error: sanear((e as Error).message) });
  }

  const { ancho, alto } = medidas(datos);
  // Fuentes y logos: los del panel (public/instagram, dentro del bundle de la
  // función y servidos desde disco a Chromium); fotos: bucket «instagram».
  const origen = new URL(request.url).origin;
  const html = construirDocumento(datos, { baseRecursos: baseRecursosPanel(origen), baseFotos: baseFotosPublica(s.sb.url) });
  const recursosLocales = { origen, prefijo: RUTA_RECURSOS_PANEL, dir: deps.dirRecursos ?? path.join(process.cwd(), "public", "instagram") };
  const renderizar = deps.renderizar ?? crearRenderizador(lanzarNavegador);
  let r: Awaited<ReturnType<Renderizador>>;
  try {
    r = await renderizar({ html, ancho, alto, codigoComprobar: CODIGO_COMPROBAR_MAQUETACION, codigoEsperar: CODIGO_ESPERAR_RECURSOS, fondo: fondoDeMarca(datos), recursosLocales });
  } catch (e) {
    if (e instanceof ErrorRender) {
      const titulo =
        e.tipo === "maquetacion" ? "La pieza no pasa las comprobaciones de maquetación" : e.tipo === "recursos" ? "Hay recursos de la pieza que no cargan" : "La imagen generada no es válida";
      return json(422, { ok: false, error: titulo, tipo: e.tipo, problemas: e.problemas });
    }
    registro("error", ETIQUETA, "render", e);
    return json(500, { ok: false, error: "No se pudo generar la imagen en el servidor", detalle: sanear((e as Error)?.message ?? e) });
  }

  const id = existente?.id ?? (deps.nuevoId ?? randomUUID)();
  // Al regenerar se conserva la ruta (mismo fichero); si no tenía, la del mes actual.
  const ruta = existente?.imagen_ruta || rutaJpeg(id, (deps.ahora ?? (() => new Date()))());
  const caption = typeof entrada.caption === "string" ? entrada.caption : undefined;
  try {
    await subirJpeg(s, ruta, r.jpg);
    const cambios: Partial<FilaPieza> = {
      marca: datos.marca,
      plantilla: datos.plantilla,
      formato: datos.formato,
      datos,
      estado: "generada",
      imagen_ruta: ruta,
      error: null,
      contenedor_id: null,
      ...(caption !== undefined ? { caption } : {}),
    };
    if (existente) await actualizarPieza(s, id, cambios);
    // creado_por lo pone el trigger (auth.uid()); no lo manda el cliente.
    else await insertarPieza(s, { id, ...cambios });
  } catch (e) {
    registro("error", ETIQUETA, "guardar", e);
    const estado = e instanceof ErrorSupabase && (e.estado === 401 || e.estado === 403) ? 403 : 500;
    return json(estado, { ok: false, error: sanear((e as Error).message) });
  }

  const url = urlPublica(s.sb, ruta);
  registro("info", ETIQUETA, "generada", {
    id,
    usuario: s.usuario,
    plantilla: datos.plantilla,
    formato: datos.formato,
    bytes: r.jpg.byteLength,
    calidad: r.calidad,
    ...r.tiempos,
    msTotal: Math.round(performance.now() - t0),
  });
  return json(200, {
    ok: true,
    id,
    estado: "generada",
    // ?v= para que el navegador no enseñe la versión anterior al regenerar.
    urlJpeg: `${url}?v=${Date.now()}`,
    imagenRuta: ruta,
    ancho: r.ancho,
    alto: r.alto,
    bytes: r.jpg.byteLength,
    calidad: r.calidad,
    avisos: r.avisos,
  });
}

/** Diagnóstico con sesión: ¿arranca Chromium y captura un lienzo? */
export async function manejarDiagnostico(request: Request, deps: DependenciasRender = {}): Promise<Response> {
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env: deps.env, fetch: deps.fetch });
  if ("motivo" in auth) return jsonAuth(auth.estado, auth.motivo);
  const renderizar = deps.renderizar ?? crearRenderizador(lanzarNavegador);
  const html = `<!doctype html><html><body style="margin:0"><main class="lienzo" style="width:320px;height:400px;background:#394147"></main></body></html>`;
  try {
    const r = await renderizar({ html, ancho: 320, alto: 400, codigoComprobar: "[]" });
    return json(200, { ok: true, plataforma: process.platform, node: process.versions.node, bytes: r.jpg.byteLength, tiempos: r.tiempos });
  } catch (e) {
    registro("error", ETIQUETA, "diagnóstico", e);
    return json(503, { ok: false, plataforma: process.platform, node: process.versions.node, error: sanear((e as Error)?.message ?? e) });
  }
}

export async function POST(request: Request): Promise<Response> {
  return manejarRender(request);
}

export async function GET(request: Request): Promise<Response> {
  return manejarDiagnostico(request);
}
