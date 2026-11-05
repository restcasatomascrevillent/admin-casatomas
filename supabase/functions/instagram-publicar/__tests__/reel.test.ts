// @vitest-environment node
/**
 * Reels (fase 6) sin red: cliente de la Graph API con media_type=REELS
 * (fetch falso), instagram-publicar con un reel (HEAD del MP4, contenedor
 * REELS sin alt_text, espera corta → «procesando» + 202, cierre con el mismo
 * contenedor, reutilizar el contenedor de la prueba al publicar) y el
 * programador (aplazar un reel que Meta aún procesa y cerrar los
 * «procesando» del panel).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClienteGraph } from "../../_shared/instagram/cliente.ts";
import { manejarPublicar } from "../publicar.ts";
import { contenedorReutilizable, problemaReel, PROCESANDO_VIGENTE_MS } from "../reel.ts";
import { clasificar, ESPERA_MAX_REEL_MS, ESPERA_SIGUIENTE_PASADA_SEG } from "../../instagram-programador/programador.ts";
import { cerrarProcesando, CADUCIDAD_PROCESANDO_MS } from "../../instagram-programador/procesando.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { ENV_META, falso, FILA_GENERADA, GRAPH, ID, metaPublicacion, peticion, resp, SB, TOKEN_META, type Llamada } from "../../_shared/instagram/__tests__/simulacion.ts";
import type { FilaPieza, Sesion } from "../../_shared/instagram/supabase.ts";

const VIDEO = `reels/2026-11/${ID}-abcdef01.mp4`;
const PORTADA = `reels/2026-11/${ID}-abcdef01.jpg`;
const FILA_REEL = {
  ...FILA_GENERADA,
  plantilla: "del-mar",
  formato: "reel",
  tipo_medio: "reel",
  imagen_ruta: null,
  video_ruta: VIDEO,
  portada_ruta: PORTADA,
  duracion_s: 20.5,
  video_bytes: 18_000_000,
  caption: "Del mar a la mesa #casatomas",
};
const T0 = Date.parse("2026-11-09T10:00:00Z");

/** Reloj falso que avanza 5 s en cada consulta (para agotar la espera corta sin dormir). */
function relojQueAvanza(inicio = T0, paso = 5_000) {
  let t = inicio;
  return () => (t += paso);
}

/** Fetch de la simulación compartida + HEAD del cubo instagram-video. */
function conVideo(base: ReturnType<typeof falso>, o: { video?: [number, string, number?]; portada?: [number, string] } = {}) {
  const heads: string[] = [];
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    if (url.startsWith(`${SB}/storage/v1/object/public/instagram-video/`) && (init.method ?? "GET").toUpperCase() === "HEAD") {
      heads.push(url);
      const [estado, tipo, largo] = url.endsWith(".mp4") ? (o.video ?? [200, "video/mp4", 18_000_000]) : [...(o.portada ?? [200, "image/jpeg"]), 300_000];
      return new Response(null, { status: estado, headers: { "Content-Type": tipo, "Content-Length": String(largo ?? 1000) } });
    }
    return base.f(entrada, init);
  });
  return { ...base, f: f as unknown as typeof fetch, heads };
}

const cuerpoMedia = (llamadas: Llamada[]) => new URLSearchParams(llamadas.find((l) => l.url === `${GRAPH}/${ENV_META.IG_USER_ID}/media`)!.cuerpo!);

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("ClienteGraph.crearContenedor con reels", () => {
  it("manda media_type=REELS, video_url, cover_url, share_to_feed y caption; nunca alt_text", async () => {
    const cuerpos: URLSearchParams[] = [];
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      cuerpos.push(new URLSearchParams(String(init?.body)));
      return resp(200, { id: "1790000000000001" });
    });
    const c = new ClienteGraph({ token: TOKEN_META, igUserId: "17841400000000001", fetch: f });
    const id = await c.crearContenedor({ tipo: "reel", videoUrl: "https://x/v.mp4", coverUrl: "https://x/p.jpg", thumbOffsetMs: 1500, caption: "Hola", altText: "no", shareToFeed: true });
    expect(id).toBe("1790000000000001");
    expect(Object.fromEntries(cuerpos[0])).toEqual({ media_type: "REELS", video_url: "https://x/v.mp4", share_to_feed: "true", caption: "Hola", cover_url: "https://x/p.jpg" });
    // Sin portada: thumb_offset (cover_url manda sobre thumb_offset, según Meta).
    await c.crearContenedor({ tipo: "reel", videoUrl: "https://x/v.mp4", thumbOffsetMs: 2000.4, shareToFeed: false });
    expect(Object.fromEntries(cuerpos[1])).toEqual({ media_type: "REELS", video_url: "https://x/v.mp4", share_to_feed: "false", thumb_offset: "2000" });
    await expect(c.crearContenedor({ tipo: "reel" })).rejects.toThrow(/videoUrl/);
    // Las imágenes siguen igual.
    await c.crearContenedor({ tipo: "post", imageUrl: "https://x/i.jpg", caption: "c", altText: "a" });
    expect(Object.fromEntries(cuerpos[2])).toEqual({ image_url: "https://x/i.jpg", caption: "c", alt_text: "a" });
  });
});

describe("instagram-publicar con un reel", () => {
  it("prueba: HEAD del MP4 y de la portada, contenedor REELS y prueba_ok sin media_publish", async () => {
    const { m, orden } = metaPublicacion({ estados: ["FINISHED"] });
    const s = conVideo(falso({ fila: FILA_REEL, meta: m }));
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true, altText: "Texto alternativo" }), { env: ENV_META, fetch: s.f, dormir: async () => undefined });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ estado: "prueba_ok", tipoMedio: "reel", publicado: false });
    expect(j.avisos.join(" ")).toMatch(/no admiten texto alternativo/);
    expect(orden).toEqual(["cuota", "media", "estado:FINISHED"]);
    expect(s.heads).toEqual([`${SB}/storage/v1/object/public/instagram-video/${VIDEO}`, `${SB}/storage/v1/object/public/instagram-video/${PORTADA}`]);
    const cuerpo = cuerpoMedia(s.llamadas);
    expect(cuerpo.get("media_type")).toBe("REELS");
    expect(cuerpo.get("video_url")).toBe(`${SB}/storage/v1/object/public/instagram-video/${VIDEO}`);
    expect(cuerpo.get("cover_url")).toBe(`${SB}/storage/v1/object/public/instagram-video/${PORTADA}`);
    expect(cuerpo.get("share_to_feed")).toBe("true");
    expect(cuerpo.get("caption")).toBe(FILA_REEL.caption);
    expect(cuerpo.has("alt_text")).toBe(false);
    expect(cuerpo.has("image_url")).toBe(false);
    expect(s.fila()).toMatchObject({ estado: "prueba_ok", contenedor_id: "1790000000000001" });
  });

  it("si Meta no termina enseguida: 202, pieza «procesando» con su acción, y el mismo contenedor la cierra", async () => {
    const { m, orden } = metaPublicacion({ estados: ["IN_PROGRESS"] });
    const s = conVideo(falso({ fila: FILA_REEL, meta: m }));
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: s.f, dormir: async () => undefined, ahora: relojQueAvanza() });
    expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({ estado: "en_proceso", procesando: true, tipoMedio: "reel", reintentar: { contenedorId: "1790000000000001", dryRun: false } });
    expect(s.fila()).toMatchObject({ estado: "procesando", procesando_accion: "publicar", contenedor_id: "1790000000000001" });
    expect(orden).not.toContain("publish");

    // Otra prueba sin contenedor mientras procesa: 409 (no crea otro contenedor).
    const fila = s.fila() as FilaPieza;
    const s2 = conVideo(falso({ fila: { ...fila, procesando_desde: new Date(T0).toISOString() }, meta: metaPublicacion().m }));
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: s2.f, ahora: () => T0 + 60_000 });
    expect(r2.status).toBe(409);
    expect(await r2.json()).toMatchObject({ tipo: "procesando" });

    // «Comprobar ahora» (o el cron): misma petición con el contenedor → publica.
    const meta3 = metaPublicacion({ estados: ["FINISHED"] });
    const s3 = conVideo(falso({ fila: { ...fila, procesando_desde: new Date(T0).toISOString() }, meta: meta3.m }));
    const r3 = await manejarPublicar(peticion({ id: ID, dryRun: false, contenedorId: "1790000000000001" }), { env: ENV_META, fetch: s3.f, dormir: async () => undefined });
    expect(r3.status).toBe(200);
    expect(await r3.json()).toMatchObject({ estado: "publicada", mediaId: "1800000000000009", videoEnCubo: true });
    expect(meta3.orden).toEqual(["cuota", "estado:FINISHED", "publish", "permalink"]);
    expect(s3.heads).toEqual([]);
  });

  it("publicar tras una prueba correcta reutiliza el contenedor si el texto es el mismo", async () => {
    const fila = { ...FILA_REEL, estado: "prueba_ok", contenedor_id: "1790000000000001", updated_at: new Date(T0).toISOString() };
    const meta = metaPublicacion({ estados: ["FINISHED"] });
    const s = conVideo(falso({ fila, meta: meta.m }));
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: s.f, dormir: async () => undefined, ahora: () => T0 + 3_600_000 });
    expect(await r.json()).toMatchObject({ estado: "publicada", contenedorReutilizado: true });
    expect(meta.orden).toEqual(["cuota", "estado:FINISHED", "publish", "permalink"]);
    // Con otro texto, contenedor nuevo.
    const meta2 = metaPublicacion({ estados: ["FINISHED"] });
    const s2 = conVideo(falso({ fila, meta: meta2.m }));
    await manejarPublicar(peticion({ id: ID, dryRun: false, caption: "Otro" }), { env: ENV_META, fetch: s2.f, dormir: async () => undefined, ahora: () => T0 + 3_600_000 });
    expect(meta2.orden).toContain("media");
  });

  it("sin vídeo → 409; MP4 que no se puede descargar → 422 sin gastar cuota; portada rota → primer fotograma", async () => {
    const meta = metaPublicacion();
    const sinVideo = conVideo(falso({ fila: { ...FILA_REEL, video_ruta: null }, meta: meta.m }));
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: sinVideo.f });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ tipo: "sin_video" });

    const roto = conVideo(falso({ fila: FILA_REEL, meta: meta.m }), { video: [404, "application/json"] });
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: roto.f });
    expect(r2.status).toBe(422);
    expect(meta.orden).toEqual([]);

    const meta3 = metaPublicacion();
    const sinPortada = conVideo(falso({ fila: FILA_REEL, meta: meta3.m }), { portada: [404, "text/html"] });
    const r3 = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: sinPortada.f, dormir: async () => undefined });
    const j3 = await r3.json();
    expect(j3.avisos.join(" ")).toMatch(/primer fotograma/);
    const cuerpo = cuerpoMedia(sinPortada.llamadas);
    expect(cuerpo.has("cover_url")).toBe(false);
    expect(cuerpo.get("thumb_offset")).toBe("0");
  });

  it("reglas puras: «procesando» vigente y contenedor reutilizable", () => {
    const f = { ...FILA_REEL, estado: "procesando", procesando_desde: new Date(T0).toISOString(), contenedor_id: "1" } as unknown as FilaPieza;
    expect(problemaReel(f, null, T0 + 1000)).toMatchObject({ tipo: "procesando" });
    expect(problemaReel(f, "1", T0 + 1000)).toBeNull();
    expect(problemaReel(f, null, T0 + PROCESANDO_VIGENTE_MS + 1)).toBeNull();
    const p = { ...FILA_REEL, estado: "prueba_ok", contenedor_id: "17", updated_at: new Date(T0).toISOString() } as unknown as FilaPieza;
    expect(contenedorReutilizable(p, FILA_REEL.caption, T0 + 1000)).toBe("17");
    expect(contenedorReutilizable(p, "otro", T0 + 1000)).toBeNull();
    expect(contenedorReutilizable(p, FILA_REEL.caption, T0 + 24 * 3_600_000)).toBeNull();
  });
});

describe("programador con reels", () => {
  it("un reel que Meta aún procesa se aplaza sin contar intento durante la primera hora", () => {
    const p = { intentos: 1, programada_para: new Date(T0).toISOString() };
    const c = { tipoMedio: "reel", reintentar: { contenedorId: "1790000000000001" } };
    expect(clasificar(202, c, p, null, T0 + 10 * 60_000)).toMatchObject({ resultado: "aplazar", contenedorId: "1790000000000001", esperaSeg: ESPERA_SIGUIENTE_PASADA_SEG });
    expect(clasificar(202, c, p, null, T0 + ESPERA_MAX_REEL_MS + 1)).toMatchObject({ resultado: "reintentar", contenedorId: "1790000000000001" });
    // Las imágenes, como siempre.
    expect(clasificar(202, { reintentar: { contenedorId: "9" } }, p, null, T0)).toMatchObject({ resultado: "reintentar" });
  });

  it("cerrarProcesando repite la prueba o la publicación con su contenedor y da por caducados los de más de 24 h", async () => {
    const filas = [
      { id: "p1", contenedor_id: "111", procesando_accion: "prueba", procesando_desde: new Date(T0).toISOString() },
      { id: "p2", contenedor_id: "222", procesando_accion: "publicar", procesando_desde: new Date(T0).toISOString() },
      { id: "p3", contenedor_id: "333", procesando_accion: "prueba", procesando_desde: new Date(T0 - CADUCIDAD_PROCESANDO_MS - 1).toISOString() },
    ];
    const patches: Array<{ url: string; cuerpo: unknown }> = [];
    const f = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("estado=eq.procesando&procesando_accion=in.(prueba,publicar)")) return resp(200, filas);
      if (init.method === "PATCH") {
        patches.push({ url, cuerpo: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      }
      throw new Error(`URL inesperada ${url}`);
    });
    const s: Sesion = { usuario: "programador", token: "clave", sb: { url: SB, clave: "clave" }, fetch: f as unknown as typeof fetch };
    const cuerpos: unknown[] = [];
    const publicar = vi.fn(async (_s: Sesion, req: Request) => {
      const c = (await req.json()) as { id: string };
      cuerpos.push(c);
      return c.id === "p1" ? resp(200, { estado: "prueba_ok" }) : resp(202, { estado: "en_proceso", mensaje: "sigue" });
    });
    const r = await cerrarProcesando(s, ENV_META, { etiqueta: "instagram-programador", publicar, ahora: () => T0 + 60_000 });
    expect(cuerpos).toEqual([
      { id: "p1", dryRun: true, contenedorId: "111" },
      { id: "p2", dryRun: false, contenedorId: "222" },
    ]);
    expect(r.map((x) => [x.piezaId, x.resultado])).toEqual([["p1", "prueba_ok"], ["p2", "sigue_procesando"], ["p3", "error"]]);
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toContain("id=eq.p3");
    expect(patches[0].cuerpo).toMatchObject({ estado: "error" });
  });

  it("sin la migración (400 de PostgREST) no hace nada ni falla", async () => {
    const f = vi.fn(async () => resp(400, { message: "column instagram_piezas.procesando_accion does not exist" }));
    const s: Sesion = { usuario: "programador", token: "clave", sb: { url: SB, clave: "clave" }, fetch: f as unknown as typeof fetch };
    expect(await cerrarProcesando(s, ENV_META, { etiqueta: "instagram-programador" })).toEqual([]);
  });
});
