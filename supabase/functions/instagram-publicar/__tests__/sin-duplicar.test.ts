// @vitest-environment node
/**
 * A1 de la evaluación (05/11/2026): que una pieza NUNCA salga dos veces en
 * Instagram, y A4: que la publicación no empiece ni llame a media_publish si
 * no le da tiempo a terminar. Sin red: Supabase y Meta simulados.
 *
 *   · Tiempo agotado en media_publish (Meta sí lo publicó) → no hay segundo
 *     media_publish; se mira el contenedor y se cierra como publicada.
 *   · Error en media_publish con el contenedor aún FINISHED → error, sin
 *     reintento; al volver a pulsar «Publicar», si el contenedor ya salió, se
 *     recupera SIN crear otro contenedor ni publicar otra vez.
 *   · Drive falla → media_id ya estaba guardado ANTES de tocar Drive.
 *   · Publicado pero sin encontrar el medio → «publicada» con aviso; no se
 *     puede volver a publicar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVISO_PUBLICADA_SIN_ID, AVISO_SIN_DRIVE, MIN_PARA_EMPEZAR_MS, manejarPublicar } from "../publicar.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { olvidarTokenDrive } from "../../_shared/google-drive.ts";
import { olvidarCarpetasDrive } from "../../_shared/instagram/drive.ts";
import {
  depsRapidas,
  driveFalso,
  ENV_DRIVE,
  ENV_META,
  falso,
  FILA_GENERADA,
  GRAPH,
  peticion,
  resp,
  SB,
  type Manejador,
} from "../../_shared/instagram/__tests__/simulacion.ts";

const IG = ENV_META.IG_USER_ID;
const VIEJO = "1790000000000001";
const NUEVO = "1790000000000002";
const MEDIA = "1800000000000009";
const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);

beforeEach(() => {
  olvidarSecretos();
  olvidarTokenDrive();
  olvidarCarpetasDrive();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/**
 * Meta simulada con estado: el contenedor nuevo pasa a PUBLISHED cuando
 * media_publish «llega» a Meta (aunque la respuesta se pierda).
 */
function meta(o: {
  publish: "ok" | "timeout" | "500";
  /** ¿Meta lo publica aunque la respuesta falle? */
  publicaIgual?: boolean;
  viejo?: string;
  medios?: Array<{ id: string; caption?: string; timestamp?: string; permalink?: string }>;
  reloj?: { t: number };
  /** ms que avanza el reloj al crear el contenedor. */
  tardaContenedor?: number;
}) {
  const estado: Record<string, string> = { [VIEJO]: o.viejo ?? "FINISHED" };
  const cuenta = { media: 0, publish: 0, buscar: 0 };
  const m: Manejador = (l) => {
    const ruta = l.url.replace(GRAPH, "");
    if (ruta.startsWith(`/${IG}/content_publishing_limit`)) return resp(200, { data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (ruta === `/${IG}/media` && l.metodo === "POST") {
      cuenta.media++;
      estado[NUEVO] = "FINISHED";
      if (o.reloj && o.tardaContenedor) o.reloj.t += o.tardaContenedor;
      return resp(200, { id: NUEVO });
    }
    const c = /^\/(\d+)\?fields=status_code/.exec(ruta)?.[1];
    if (c && l.metodo === "GET") return estado[c] ? resp(200, { id: c, status_code: estado[c] }) : resp(400, { error: { code: 100, message: "Unsupported get request" } });
    if (ruta === `/${IG}/media_publish` && l.metodo === "POST") {
      cuenta.publish++;
      const creation = new URLSearchParams(l.cuerpo ?? "").get("creation_id")!;
      if (o.publish === "ok" || o.publicaIgual) estado[creation] = "PUBLISHED";
      if (o.publish === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
      if (o.publish === "500") return resp(500, { error: { code: 2, message: "Service temporarily unavailable", is_transient: true } });
      return resp(200, { id: MEDIA });
    }
    if (ruta.startsWith(`/${IG}/media?`) && l.metodo === "GET") {
      cuenta.buscar++;
      return resp(200, { data: o.medios ?? [] });
    }
    if (ruta.startsWith(`/${MEDIA}?`)) return resp(200, { permalink: "https://www.instagram.com/p/ABC123/" });
    return undefined;
  };
  return { m, cuenta, estado };
}

const MEDIO_PUBLICADO = { id: MEDIA, caption: FILA_GENERADA.caption, timestamp: new Date(T0).toISOString(), permalink: "https://www.instagram.com/p/ABC123/" };

describe("A1: tiempo agotado en media_publish", () => {
  it("Meta lo publicó: NO hay segundo media_publish y la pieza queda publicada con su media_id", async () => {
    const mt = meta({ publish: "timeout", publicaIgual: true, medios: [MEDIO_PUBLICADO] });
    const s = falso({ fila: { ...FILA_GENERADA }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b).toMatchObject({ publicado: true, recuperada: true, mediaId: MEDIA });
    expect(mt.cuenta.publish).toBe(1);
    expect(mt.cuenta.media).toBe(1);
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA, contenedor_id: NUEVO });
  });

  it("Meta no lo publicó (sigue FINISHED): error SIN reintentar, y el contenedor queda guardado", async () => {
    const mt = meta({ publish: "500" });
    const s = falso({ fila: { ...FILA_GENERADA }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(mt.cuenta.publish).toBe(1);
    expect(s.fila()).toMatchObject({ estado: "error", contenedor_id: NUEVO, media_id: null });
  });

  it("al volver a pulsar «Publicar», si el intento anterior sí salió, no se crea otro contenedor ni se publica otra vez", async () => {
    const mt = meta({ publish: "ok", viejo: "PUBLISHED", medios: [MEDIO_PUBLICADO] });
    const s = falso({ fila: { ...FILA_GENERADA, estado: "error", contenedor_id: VIEJO }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b).toMatchObject({ publicado: true, recuperada: true, mediaId: MEDIA });
    expect(mt.cuenta).toMatchObject({ media: 0, publish: 0 });
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA, contenedor_id: VIEJO });
  });

  it("si el anterior no salió (FINISHED de una prueba), se publica con normalidad una sola vez", async () => {
    const mt = meta({ publish: "ok", viejo: "FINISHED" });
    const s = falso({ fila: { ...FILA_GENERADA, estado: "prueba_ok", contenedor_id: VIEJO }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(mt.cuenta).toMatchObject({ media: 1, publish: 1 });
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA });
  });

  it("si no se puede comprobar el anterior por la red, no se arriesga a duplicar (502, nada creado)", async () => {
    const mt = meta({ publish: "ok" });
    const m: Manejador = (l) => (l.url.includes(`/${VIEJO}?`) ? Promise.reject(new TypeError("fetch failed")) : mt.m(l));
    const s = falso({ fila: { ...FILA_GENERADA, estado: "error", contenedor_id: VIEJO }, meta: m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(502);
    expect(mt.cuenta).toMatchObject({ media: 0, publish: 0 });
  });

  it("publicada pero sin encontrar el medio: queda «publicada» con aviso y ya no se puede volver a publicar", async () => {
    const mt = meta({ publish: "timeout", publicaIgual: true, medios: [] });
    const s = falso({ fila: { ...FILA_GENERADA }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect((await r.json()).mediaId).toBeNull();
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: null, error: AVISO_PUBLICADA_SIN_ID });
    const otra = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(otra.status).toBe(409);
    expect(mt.cuenta.publish).toBe(1);
  });
});

describe("A1: media_id guardado antes de Drive", () => {
  it("si Drive falla, media_id y «publicada» ya estaban guardados antes de la primera llamada a Google", async () => {
    const mt = meta({ publish: "ok" });
    const d = driveFalso({ subidaFalla: true });
    const s = falso({ fila: { ...FILA_GENERADA }, meta: mt.m, drive: d.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), { env: { ...ENV_META, ...ENV_DRIVE }, fetch: s.f, ahora: () => T0, ...depsRapidas });
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.driveId).toBeNull();
    const llamadas = s.f.mock.calls.map(([u, i]) => ({ url: String(u), metodo: ((i as RequestInit)?.method ?? "GET").toUpperCase(), cuerpo: (i as RequestInit)?.body }));
    const guardado = llamadas.findIndex((l) => l.metodo === "PATCH" && l.url.startsWith(`${SB}/rest/v1/instagram_piezas`) && String(l.cuerpo).includes(`"media_id":"${MEDIA}"`));
    const primeraGoogle = llamadas.findIndex((l) => /googleapis\.com/.test(l.url));
    expect(guardado).toBeGreaterThan(-1);
    expect(primeraGoogle).toBeGreaterThan(guardado);
    expect(JSON.parse(String(llamadas[guardado].cuerpo))).toMatchObject({ estado: "publicada", media_id: MEDIA });
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA });
    expect(String(s.fila()?.error)).toContain(AVISO_SIN_DRIVE);
    expect(mt.cuenta.publish).toBe(1);
  });
});

describe("A4: no empieza ni publica sin tiempo", () => {
  it("con menos de MIN_PARA_EMPEZAR_MS por delante: 503 «sin_tiempo» y ningún contenedor", async () => {
    const mt = meta({ publish: "ok" });
    const s = falso({ fila: { ...FILA_GENERADA }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), {
      env: ENV_META, fetch: s.f, ahora: () => T0, limite: T0 + MIN_PARA_EMPEZAR_MS - 1, ...depsRapidas,
    });
    expect(r.status).toBe(503);
    expect((await r.json()).tipo).toBe("sin_tiempo");
    expect(mt.cuenta).toMatchObject({ media: 0, publish: 0 });
  });

  it("si el contenedor tarda y ya no da tiempo, no llama a media_publish: 202 «sin_tiempo» con el contenedor para la siguiente", async () => {
    const reloj = { t: T0 };
    const mt = meta({ publish: "ok", reloj, tardaContenedor: 25_000 });
    const s = falso({ fila: { ...FILA_GENERADA }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: FILA_GENERADA.id, dryRun: false }), {
      env: ENV_META, fetch: s.f, ahora: () => reloj.t, limite: T0 + 50_000, ...depsRapidas,
    });
    const b = await r.json();
    expect(r.status).toBe(202);
    expect(b).toMatchObject({ tipo: "sin_tiempo", reintentar: { contenedorId: NUEVO } });
    expect(mt.cuenta).toMatchObject({ media: 1, publish: 0 });
  });
});
