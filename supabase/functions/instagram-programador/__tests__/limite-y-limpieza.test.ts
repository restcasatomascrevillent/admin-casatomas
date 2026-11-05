// @vitest-environment node
/**
 * A4 (límite de tiempo global de la pasada del programador y de los reels
 * «procesando») y A5 (limpieza del cubo de vídeo) de la evaluación del
 * 05/11/2026. Sin red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clasificar,
  diasVideoPublicado,
  ejecutarPasada,
  LIMITE_PASADA_MS,
  manejarProgramador,
  MARGEN_CIERRE_MS,
  MIN_PARA_PUBLICAR_MS,
  sesionServicio,
  type FuncionPublicar,
} from "../programador.ts";
import { cerrarProcesando, MIN_PARA_PROCESANDO_MS } from "../procesando.ts";
import { CUBO_VIDEO, DIAS_VIDEO_PUBLICADO, limpiarBucket, limpiarVideo } from "../limpieza.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import type { DependenciasPublicar } from "../../instagram-publicar/publicar.ts";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const CLAVE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.claveServicio";
const SECRETO = "secreto-del-cron-de-instagram-0123456789";
const T0 = Date.parse("2026-11-10T09:00:00Z");
const PIEZA = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";

const resp = (estado: number, cuerpo: unknown) => new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  olvidarSecretos();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** Supabase mínimo: N programaciones vencidas, cerrar, una pieza y los reels «procesando». */
function supabase(o: { vencidas?: number; procesando?: number; rpcVideo?: [number, unknown] } = {}) {
  let quedan = o.vencidas ?? 0;
  const llamadas: Array<{ url: string; metodo: string; cuerpo: string | null }> = [];
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cuerpo = typeof init.body === "string" ? init.body : null;
    llamadas.push({ url, metodo, cuerpo });
    if (url === `${SB}/rest/v1/rpc/instagram_programador_reclamar`) {
      if (quedan <= 0) return resp(200, []);
      quedan--;
      return resp(200, [{ id: `p${quedan}`, pieza_id: PIEZA, marca: "touza", programada_para: new Date(T0 - 60_000).toISOString(), estado: "publicando", intentos: 0, contenedor_id: null, bloqueo_id: "b" }]);
    }
    if (url === `${SB}/rest/v1/rpc/instagram_programador_cerrar`) return resp(200, { estado: "publicada", intentos: 0 });
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas?id=eq.`)) return resp(200, [{ id: PIEZA, estado: "generada", media_id: null, contenedor_id: null, marca: "touza" }]);
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas?estado=eq.procesando`)) {
      return resp(200, Array.from({ length: o.procesando ?? 0 }, (_, i) => ({ id: `r${i}`, contenedor_id: "1790000000000001", procesando_accion: "publicar", procesando_desde: new Date(T0).toISOString() })));
    }
    if (url === `${SB}/rest/v1/rpc/instagram_piezas_reclamar_jpeg_caducados`) return resp(200, []);
    if (url === `${SB}/storage/v1/object/list/instagram`) return resp(200, []);
    if (url === `${SB}/rest/v1/rpc/instagram_video_reclamar_caducados`) return resp(...(o.rpcVideo ?? [200, []]));
    if (url === `${SB}/storage/v1/object/${CUBO_VIDEO}` && metodo === "DELETE") {
      return resp(200, (JSON.parse(cuerpo!).prefixes as string[]).map((name) => ({ name })));
    }
    throw new Error(`URL inesperada: ${metodo} ${url}`);
  });
  return { f, llamadas, s: sesionServicio(SB, CLAVE, f as unknown as typeof fetch) };
}

/** Núcleo de publicación falso que tarda `ms` (avanza el reloj) y apunta los límites que recibe. */
function publicarQueTarda(reloj: { t: number }, ms: number) {
  const limites: Array<number | undefined> = [];
  const publicar: FuncionPublicar = async (_s, _r, deps: DependenciasPublicar) => {
    limites.push(deps.limite);
    reloj.t += ms;
    return resp(200, { ok: true, publicado: true, mediaId: "1800000000000009", permalink: null });
  };
  return { publicar, limites };
}

describe("A4: límite global de la pasada", () => {
  it("no reclama otra programación si no quedan MIN_PARA_PUBLICAR_MS (y para en MAX_POR_PASADA)", async () => {
    const reloj = { t: T0 };
    const sb = supabase({ vencidas: 10 });
    const p = publicarQueTarda(reloj, 30_000);
    const r = await ejecutarPasada(sb.s, {}, { ahora: () => reloj.t, publicar: p.publicar, presupuestoPasadaMs: 10 * 60_000 });
    // 110 s de límite: 0 → 30 → 60 s; a los 60 s quedan 50 s < 75 s: no se reclama la tercera.
    expect(r).toHaveLength(Math.floor((LIMITE_PASADA_MS - MIN_PARA_PUBLICAR_MS) / 30_000) + 1);
    expect(r.length).toBeLessThan(3);
    expect(sb.llamadas.filter((l) => l.url.endsWith("instagram_programador_reclamar"))).toHaveLength(r.length);
  });

  it("con poco tiempo ni siquiera reclama (no deja nada a medias)", async () => {
    const sb = supabase({ vencidas: 2 });
    const p = publicarQueTarda({ t: T0 }, 0);
    const r = await ejecutarPasada(sb.s, {}, { ahora: () => T0, publicar: p.publicar, limite: T0 + MIN_PARA_PUBLICAR_MS - 1 });
    expect(r).toEqual([]);
    expect(sb.llamadas.some((l) => l.url.endsWith("instagram_programador_reclamar"))).toBe(false);
  });

  it("el núcleo recibe el límite menos el margen para cerrar la programación", async () => {
    const sb = supabase({ vencidas: 1 });
    const p = publicarQueTarda({ t: T0 }, 0);
    await ejecutarPasada(sb.s, {}, { ahora: () => T0, publicar: p.publicar });
    expect(p.limites).toEqual([T0 + LIMITE_PASADA_MS - MARGEN_CIERRE_MS]);
  });

  it("«sin_tiempo» se aplaza sin contar intento, con el contenedor si ya existía", () => {
    expect(clasificar(503, { tipo: "sin_tiempo" }, { intentos: 1 }, null)).toMatchObject({ resultado: "aplazar", contenedorId: null });
    expect(clasificar(202, { tipo: "sin_tiempo", reintentar: { contenedorId: "1790000000000002" } }, { intentos: 0 }, null))
      .toMatchObject({ resultado: "aplazar", contenedorId: "1790000000000002" });
  });

  it("publicada sin media_id encontrado (A1): error que no se reintenta", () => {
    expect(clasificar(200, { ok: true, publicado: true, mediaId: null }, { intentos: 0 }, null)).toMatchObject({ resultado: "error" });
  });

  it("si la pasada gastó el tiempo, los reels «procesando» se quedan para la siguiente (ni se leen)", async () => {
    const reloj = { t: T0 };
    const sb = supabase({ vencidas: 1, procesando: 2 });
    const p = publicarQueTarda(reloj, LIMITE_PASADA_MS - MIN_PARA_PROCESANDO_MS + 1);
    const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: CLAVE, INSTAGRAM_PROGRAMADOR_SECRET: SECRETO };
    const r = await manejarProgramador(
      new Request(`${SB}/functions/v1/instagram-programador`, { method: "POST", headers: { "x-webhook-secret": SECRETO }, body: "{}" }),
      { env, fetch: sb.f as unknown as typeof fetch, ahora: () => reloj.t, publicar: p.publicar },
    );
    const b = await r.json();
    expect(b).toMatchObject({ ok: true, procesadas: 1, procesandoAplazado: true });
    expect(sb.llamadas.some((l) => l.url.includes("estado=eq.procesando"))).toBe(false);
  });

  it("cerrarProcesando para en cuanto no queda MIN_PARA_PROCESANDO_MS", async () => {
    const reloj = { t: T0 };
    const sb = supabase({ procesando: 3 });
    const p = publicarQueTarda(reloj, 30_000);
    const r = await cerrarProcesando(sb.s, {}, { etiqueta: "x", ahora: () => reloj.t, publicar: p.publicar, limite: T0 + 70_000 });
    // 0 s: quedan 70 → uno (30 s); 30 s: quedan 40 < 50 → para.
    expect(r).toHaveLength(1);
    expect(p.limites).toEqual([T0 + 70_000]);
  });
});

describe("A5: limpieza del cubo de vídeo", () => {
  const VIDEO = `reels/2026-09/${PIEZA}-00000001.mp4`;
  it("borra por Storage lo que devuelve la RPC, solo reels/ y sin repetidos", async () => {
    const sb = supabase({
      rpcVideo: [200, [
        { ruta: VIDEO, motivo: "publicada" },
        { ruta: VIDEO.replace(".mp4", ".jpg"), motivo: "publicada" },
        { ruta: VIDEO, motivo: "huerfano" },
        { ruta: "audio/x.mp3", motivo: "huerfano" },
        { ruta: "reels/../piezas/x.mp4", motivo: "huerfano" },
      ]],
    });
    const r = await limpiarVideo(sb.s, { diasVideoPublicado: 45 });
    expect(r).toMatchObject({ marcados: 2, borrados: 2 });
    const rpc = sb.llamadas.find((l) => l.url.endsWith("instagram_video_reclamar_caducados"))!;
    expect(JSON.parse(rpc.cuerpo!)).toMatchObject({ p_dias: 45, p_gracia_horas: 24 });
    const borrar = sb.llamadas.find((l) => l.metodo === "DELETE")!;
    expect(borrar.url).toBe(`${SB}/storage/v1/object/${CUBO_VIDEO}`);
    expect(JSON.parse(borrar.cuerpo!).prefixes).toEqual([VIDEO, VIDEO.replace(".mp4", ".jpg")]);
  });

  it("sin la migración avisa y no rompe la limpieza de JPEG", async () => {
    const sb = supabase({ rpcVideo: [404, { code: "PGRST202", message: "Could not find the function" }] });
    const r = await limpiarBucket(sb.s, () => T0);
    expect(r).toMatchObject({ videoMarcados: 0, videoBorrados: 0, jpegMarcados: 0 });
    expect(r.avisos.join(" ")).toMatch(/20261111000000/);
  });

  it("la acción «limpiar» del programador usa INSTAGRAM_DIAS_VIDEO_PUBLICADO (30 por defecto, 1-365)", async () => {
    expect(diasVideoPublicado({})).toBe(DIAS_VIDEO_PUBLICADO);
    expect(diasVideoPublicado({ INSTAGRAM_DIAS_VIDEO_PUBLICADO: "60" })).toBe(60);
    expect(diasVideoPublicado({ INSTAGRAM_DIAS_VIDEO_PUBLICADO: "0" })).toBe(DIAS_VIDEO_PUBLICADO);
    expect(diasVideoPublicado({ INSTAGRAM_DIAS_VIDEO_PUBLICADO: "9999" })).toBe(DIAS_VIDEO_PUBLICADO);
    const sb = supabase({ rpcVideo: [200, [{ ruta: VIDEO, motivo: "huerfano" }]] });
    const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: CLAVE, INSTAGRAM_PROGRAMADOR_SECRET: SECRETO, INSTAGRAM_DIAS_VIDEO_PUBLICADO: "15" };
    const r = await manejarProgramador(
      new Request(`${SB}/functions/v1/instagram-programador`, { method: "POST", headers: { "x-webhook-secret": SECRETO }, body: JSON.stringify({ accion: "limpiar" }) }),
      { env, fetch: sb.f as unknown as typeof fetch, ahora: () => T0 },
    );
    expect(await r.json()).toMatchObject({ ok: true, videoMarcados: 1, videoBorrados: 1 });
    expect(JSON.parse(sb.llamadas.find((l) => l.url.endsWith("instagram_video_reclamar_caducados"))!.cuerpo!).p_dias).toBe(15);
  });
});
