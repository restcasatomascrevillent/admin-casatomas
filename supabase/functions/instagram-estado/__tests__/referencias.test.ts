// @vitest-environment node
/**
 * instagram-estado, acción «referencias»: últimas publicaciones y stories
 * activas de la cuenta de la marca, sin red y sin devolver el token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarEstado } from "../estado.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { depsRapidas, ENV_META, falso, GRAPH, JWT, peticion, resp, TOKEN_META, type Manejador } from "../../_shared/instagram/__tests__/simulacion.ts";

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

const IG = ENV_META.IG_USER_ID;

const MEDIA = [
  { id: "1", media_type: "IMAGE", media_product_type: "FEED", media_url: "https://cdn/1.jpg", permalink: "https://instagram.com/p/1", caption: "Chuletón", timestamp: "2026-11-10T12:00:00+0000", username: "oficiososia" },
  { id: "2", media_type: "VIDEO", media_product_type: "REELS", media_url: "https://cdn/2.mp4", thumbnail_url: "https://cdn/2.jpg", permalink: "https://instagram.com/reel/2", timestamp: "2026-11-09T12:00:00+0000" },
  { id: "3", media_type: "CAROUSEL_ALBUM", media_url: "https://cdn/3.jpg", permalink: "https://instagram.com/p/3", caption: "Tapas", timestamp: "2026-11-08T12:00:00+0000" },
  { id: "4", media_type: "VIDEO", media_product_type: "FEED", media_url: "https://cdn/4.mp4", thumbnail_url: "https://cdn/4.jpg", timestamp: "2026-11-07T12:00:00+0000" },
];
const STORIES = [{ id: "9", media_type: "IMAGE", media_url: "https://cdn/9.jpg", permalink: "https://instagram.com/stories/9", timestamp: "2026-11-12T08:00:00+0000" }];

const meta = (o: { storiesError?: boolean; mediaError?: boolean } = {}): Manejador => (l) => {
  const ruta = l.url.replace(GRAPH, "");
  if (ruta.startsWith(`/${IG}/media?`)) {
    expect(l.cabeceras.authorization).toBe(`Bearer ${TOKEN_META}`);
    expect(l.url).not.toContain(TOKEN_META);
    if (o.mediaError) return resp(400, { error: { message: `Invalid OAuth access token ${TOKEN_META}`, type: "OAuthException", code: 190 } });
    return resp(200, { data: MEDIA });
  }
  if (ruta.startsWith(`/${IG}/stories?`)) {
    if (o.storiesError) return resp(403, { error: { message: "(#10) Application does not have permission for this action", type: "OAuthException", code: 10 } });
    return resp(200, { data: STORIES });
  }
  return undefined;
};

const pedir = (cuerpo: unknown, env: Record<string, string> = ENV_META, m: Manejador = meta(), extra: { permiso?: boolean } = {}, auth: string | null = `Bearer ${JWT}`) => {
  const s = falso({ meta: m, permiso: extra.permiso });
  return { s, r: manejarEstado(peticion(cuerpo, auth), { env, fetch: s.f, ...depsRapidas }) };
};

describe("instagram-estado · acción «referencias»", () => {
  it("devuelve publicaciones y stories con los tipos traducidos y sin el token", async () => {
    const { r } = pedir({ accion: "referencias", marca: "casa-tomas" });
    const res = await r;
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain(TOKEN_META);
    const j = JSON.parse(texto);
    expect(j).toMatchObject({ ok: true, marca: "casa-tomas", cuenta: { igUserId: IG, username: "oficiososia" }, avisos: [] });
    expect(j.publicaciones.map((p: { tipo: string }) => p.tipo)).toEqual(["imagen", "reel", "carrusel", "reel"]);
    expect(j.publicaciones[0]).toEqual({ id: "1", tipo: "imagen", mediaUrl: "https://cdn/1.jpg", miniaturaUrl: "https://cdn/1.jpg", permalink: "https://instagram.com/p/1", caption: "Chuletón", fecha: "2026-11-10T12:00:00+0000" });
    expect(j.publicaciones[1].miniaturaUrl).toBe("https://cdn/2.jpg");
    expect(j.stories).toEqual([expect.objectContaining({ id: "9", tipo: "story", miniaturaUrl: "https://cdn/9.jpg" })]);
  });

  it("sin marca usa casa-tomas; marca desconocida → 400", async () => {
    expect(await (await pedir({ accion: "referencias" }).r).json()).toMatchObject({ ok: true, marca: "casa-tomas" });
    expect((await pedir({ accion: "referencias", marca: "otra" }).r).status).toBe(400);
  });

  it("401 sin sesión y 403 sin Marketing (sin llamar a Meta)", async () => {
    const m = vi.fn(() => undefined);
    expect((await pedir({ accion: "referencias" }, ENV_META, m, {}, null).r).status).toBe(401);
    expect((await pedir({ accion: "referencias" }, ENV_META, m, { permiso: false }).r).status).toBe(403);
    expect(m).not.toHaveBeenCalled();
  });

  it("stories con error de permisos → lista vacía + aviso, las publicaciones siguen", async () => {
    const j = await (await pedir({ accion: "referencias" }, ENV_META, meta({ storiesError: true })).r).json();
    expect(j.ok).toBe(true);
    expect(j.stories).toEqual([]);
    expect(j.publicaciones).toHaveLength(4);
    expect(j.avisos.join(" ")).toMatch(/stories/);
  });

  it("error de Meta en las publicaciones → 502 traducido, sin el token", async () => {
    const res = await pedir({ accion: "referencias" }, ENV_META, meta({ mediaError: true })).r;
    expect(res.status).toBe(502);
    const texto = await res.text();
    expect(texto).not.toContain(TOKEN_META);
    const j = JSON.parse(texto);
    expect(j).toMatchObject({ ok: false, tipo: "token" });
    expect(j.comoArreglarlo).toBeTruthy();
  });

  it("producción sin IG_*_CASA_TOMAS → 503 con «cómo arreglarlo» y sin llamar a Meta", async () => {
    const m = vi.fn(() => undefined);
    const res = await pedir({ accion: "referencias" }, { ...ENV_META, INSTAGRAM_ENTORNO: "produccion" }, m).r;
    expect(res.status).toBe(503);
    const texto = await res.text();
    expect(texto).not.toContain(TOKEN_META);
    const j = JSON.parse(texto);
    expect(j.faltan).toEqual(expect.arrayContaining(["IG_USER_ID_CASA_TOMAS", "IG_ACCESS_TOKEN_CASA_TOMAS"]));
    expect(j.comoArreglarlo.join(" ")).toMatch(/IG_USER_ID_CASA_TOMAS/);
    expect(m).not.toHaveBeenCalled();
  });

  it("un POST sin «accion» sigue siendo la comprobación de siempre", async () => {
    const s = falso({ meta: () => resp(400, { error: { message: "Invalid", code: 100 } }) });
    const j = await (await manejarEstado(peticion({}), { env: ENV_META, fetch: s.f, ...depsRapidas })).json();
    expect(j).toHaveProperty("variables");
    expect(j).not.toHaveProperty("publicaciones");
  });
});
