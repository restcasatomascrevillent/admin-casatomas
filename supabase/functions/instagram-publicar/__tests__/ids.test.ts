// @vitest-environment node
/**
 * Contrato del panel (Crear de escritorio y móvil, 05/11/2026): cada imagen se
 * genera con una llamada al render (una pieza suelta) y se publica o programa
 * con `ids` (1 = post o story; 2–10 = carrusel). El servidor junta las piezas
 * en UNA pieza carrusel (ensamblar.ts) con id determinista. Sin red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarPublicar } from "../publicar.ts";
import { idCarrusel } from "../ensamblar.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { depsRapidas, ENV_META, falso, GRAPH, peticion, resp, SB, type Llamada, type Manejador } from "../../_shared/instagram/__tests__/simulacion.ts";

const IG = ENV_META.IG_USER_ID;
const PADRE = "1790000000000900";
const MEDIA = "1800000000000009";
const T0 = Date.UTC(2026, 11, 5, 12, 0, 0);
const IDS = ["a1111111-1111-4111-8111-111111111111", "a2222222-2222-4222-8222-222222222222", "a3333333-3333-4333-8333-333333333333"];
const pieza = (id: string, i: number, extra: Record<string, unknown> = {}) => ({
  id,
  marca: "casa-tomas",
  plantilla: "ct-foto-titular",
  formato: "post",
  tipo_medio: "imagen",
  datos: { marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: `subida:${id}`, titular: `Producto ${i}` },
  caption: i === 1 ? "Del Cantábrico #mariscos" : null,
  alt_text: `Alt guardado ${i}`,
  estado: "generada",
  imagen_ruta: `piezas/2026-12/${id}.jpg`,
  contenedor_id: null,
  media_id: null,
  permalink: null,
  error: null,
  creado_por: "usuario-1",
  ...extra,
});

beforeEach(() => {
  olvidarSecretos();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** Meta mínima para carruseles y posts. */
function meta(o: { hijoFalla?: boolean } = {}) {
  const estado: Record<string, string> = {};
  const hijos: Array<Record<string, string>> = [];
  const padres: Array<Record<string, string>> = [];
  let publish = 0;
  const m: Manejador = (l: Llamada) => {
    const ruta = l.url.replace(GRAPH, "");
    if (ruta.startsWith(`/${IG}/content_publishing_limit`)) return resp(200, { data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (ruta === `/${IG}/media` && l.metodo === "POST") {
      const p = Object.fromEntries(new URLSearchParams(l.cuerpo ?? ""));
      if (p.is_carousel_item === "true") {
        hijos.push(p);
        if (o.hijoFalla && hijos.length === 2) return resp(400, { error: { code: 9004, error_subcode: 2207052, message: "Media download has failed." } });
        const id = `17900000000000${String(hijos.length).padStart(2, "0")}`;
        estado[id] = "FINISHED";
        return resp(200, { id });
      }
      padres.push(p);
      estado[PADRE] = "FINISHED";
      return resp(200, { id: PADRE });
    }
    const c = /^\/(\d+)\?fields=status_code/.exec(ruta)?.[1];
    if (c && l.metodo === "GET") return estado[c] ? resp(200, { id: c, status_code: estado[c] }) : resp(400, { error: { code: 100, message: "Unsupported get request" } });
    if (ruta === `/${IG}/media_publish` && l.metodo === "POST") {
      publish++;
      return resp(200, { id: MEDIA });
    }
    if (ruta.startsWith(`/${MEDIA}?`)) return resp(200, { permalink: "https://www.instagram.com/p/X/" });
    return undefined;
  };
  return { m, hijos, padres, publish: () => publish };
}

/** Supabase con VARIAS piezas, copia en Storage, borrado de filas y RPC de programar. */
function bd(piezas: Array<Record<string, unknown>>, m?: Manejador, o: { programadas?: string[] } = {}) {
  const base = falso({ fila: null, meta: m });
  const filas = new Map<string, Record<string, unknown>>(piezas.map((p) => [p.id as string, { ...p }]));
  const copias: Array<{ sourceKey: string; destinationKey: string }> = [];
  const rpc: Array<Record<string, unknown>> = [];
  const borradas: string[] = [];
  const f = vi.fn(async (u: string | URL | Request, init: RequestInit = {}) => {
    const url = String(u);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cuerpo = typeof init.body === "string" ? init.body : null;
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas`)) {
      const q = new URL(url).searchParams;
      const id = q.get("id") ?? "";
      if (metodo === "GET") {
        const f = filas.get(id.replace(/^eq\./, ""));
        return resp(200, f ? [f] : []);
      }
      if (metodo === "POST") {
        const nueva = JSON.parse(cuerpo!) as Record<string, unknown>;
        filas.set(nueva.id as string, { contenedor_id: null, media_id: null, permalink: null, error: null, alt_text: null, ...nueva });
        return new Response(null, { status: 201 });
      }
      if (metodo === "PATCH") {
        const k = id.replace(/^eq\./, "");
        const f = { ...filas.get(k), ...JSON.parse(cuerpo!) };
        filas.set(k, f);
        return resp(200, [f]);
      }
      if (metodo === "DELETE") {
        for (const k of /^in\.\((.*)\)$/.exec(id)?.[1].split(",") ?? []) {
          borradas.push(k);
          filas.delete(k);
        }
        return new Response(null, { status: 204 });
      }
    }
    if (url.startsWith(`${SB}/rest/v1/instagram_programaciones`)) {
      const ids = /pieza_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(url))?.[1].split(",") ?? [];
      return resp(200, ids.filter((x) => o.programadas?.includes(x)).map((x) => ({ pieza_id: x })));
    }
    if (url === `${SB}/storage/v1/object/copy` && metodo === "POST") {
      copias.push(JSON.parse(cuerpo!));
      return resp(200, { Key: "instagram/x" });
    }
    if (url === `${SB}/rest/v1/rpc/instagram_programar`) {
      rpc.push(JSON.parse(cuerpo!));
      return resp(200, { ok: true, accion: "programada", programacion: { id: "p1", programada_para: "2026-12-24T10:00:00+00:00" }, conflictos: [] });
    }
    return base.f(u, init);
  });
  return { f: f as unknown as typeof fetch, filas, copias, rpc, borradas, llamadas: base.llamadas };
}

describe("idCarrusel", () => {
  it("es determinista, depende del orden y tiene forma de UUID", async () => {
    const a = await idCarrusel(IDS);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await idCarrusel([...IDS])).toBe(a);
    expect(await idCarrusel([IDS[1], IDS[0], IDS[2]])).not.toBe(a);
  });
});

describe("instagram-publicar con «ids» (contrato del panel)", () => {
  it("3 piezas sueltas → UN carrusel: copia los JPEG, crea la fila, borra las sueltas y publica sin prueba", async () => {
    const mt = meta();
    const b = bd(IDS.map((id, i) => pieza(id, i + 1)), mt.m);
    const alts = ["Ostras", "Bogavante", "Navajas"];
    const r = await manejarPublicar(peticion({ directo: true, dryRun: false, ids: IDS, caption: "Hoy #mariscos", altTexts: alts }), { env: ENV_META, fetch: b.f, ahora: () => T0, ...depsRapidas });
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    const cid = await idCarrusel(IDS);
    expect(j).toMatchObject({ id: cid, publicado: true, estado: "publicada", tipoMedio: "carrusel", mediaId: MEDIA });
    const rutas = [1, 2, 3].map((n) => `piezas/2026-12/${cid}-0${n}.jpg`);
    expect(b.copias).toEqual(IDS.map((id, i) => ({ bucketId: "instagram", sourceKey: `piezas/2026-12/${id}.jpg`, destinationKey: rutas[i] })));
    expect(mt.hijos.map((h) => [h.image_url.replace(`${SB}/storage/v1/object/public/instagram/`, ""), h.alt_text])).toEqual(rutas.map((x, i) => [x, alts[i]]));
    expect(mt.padres[0]).toMatchObject({ media_type: "CAROUSEL", caption: "Hoy #mariscos" });
    expect(mt.publish()).toBe(1);
    const c = b.filas.get(cid)!;
    expect(c).toMatchObject({ formato: "carrusel", tipo_medio: "carrusel", estado: "publicada", media_id: MEDIA, imagen_ruta: rutas[0] });
    expect((c.diapositivas as Array<Record<string, unknown>>).map((d) => [d.foto, d.imagen_ruta, d.alt_text])).toEqual(IDS.map((id, i) => [`subida:${id}`, rutas[i], alts[i]]));
    expect(b.borradas).toEqual(IDS);
    expect(IDS.some((id) => b.filas.has(id))).toBe(false);
  });

  it("si Meta falla, reintentar con los mismos «ids» usa el MISMO carrusel (sin copiar ni crear otro)", async () => {
    const mt1 = meta({ hijoFalla: true });
    const b = bd(IDS.map((id, i) => pieza(id, i + 1)), mt1.m);
    const r1 = await manejarPublicar(peticion({ ids: IDS }), { env: ENV_META, fetch: b.f, ahora: () => T0, ...depsRapidas });
    expect(r1.status).toBeGreaterThanOrEqual(400);
    const cid = await idCarrusel(IDS);
    expect(b.filas.get(cid)).toMatchObject({ estado: "error" });
    expect(mt1.publish()).toBe(0);
    const copias = b.copias.length;
    // Segundo intento: otra Meta que sí funciona, mismas filas.
    const mt2 = meta();
    const b2f = bd([...b.filas.values()], mt2.m);
    const r2 = await manejarPublicar(peticion({ ids: IDS }), { env: ENV_META, fetch: b2f.f, ahora: () => T0, ...depsRapidas });
    expect(r2.status).toBe(200);
    expect((await r2.json()).id).toBe(cid);
    expect(b2f.copias).toHaveLength(0);
    expect(copias).toBe(3);
    expect(mt2.publish()).toBe(1);
  });

  it("422 si alguna no es una imagen de feed o es de otra marca; 409 si alguna está programada (sin tocar nada)", async () => {
    const b = bd([pieza(IDS[0], 1), pieza(IDS[1], 2, { formato: "story" }), pieza(IDS[2], 3, { marca: "touza" })]);
    const r = await manejarPublicar(peticion({ ids: IDS }), { env: ENV_META, fetch: b.f, ...depsRapidas });
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.problemas.join(" ")).toMatch(/Imagen 2.*story/);
    expect(j.problemas.join(" ")).toMatch(/Imagen 3.*otra marca/);
    expect(b.copias).toHaveLength(0);
    const p = bd(IDS.map((id, i) => pieza(id, i + 1)), undefined, { programadas: [IDS[2]] });
    const r2 = await manejarPublicar(peticion({ ids: IDS }), { env: ENV_META, fetch: p.f, ...depsRapidas });
    expect(r2.status).toBe(409);
    expect(p.copias).toHaveLength(0);
  });

  it("1 id = esa pieza (post), sin montar nada", async () => {
    const mt = meta();
    const b = bd([pieza(IDS[0], 1)], mt.m);
    const r = await manejarPublicar(peticion({ directo: true, ids: [IDS[0]], caption: "Hola", altTexts: undefined }), { env: ENV_META, fetch: b.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: IDS[0], estado: "publicada" });
    expect(b.copias).toHaveLength(0);
    expect(mt.hijos).toHaveLength(0);
  });

  it("alias del móvil: carrusel: { ids, altTexts }", async () => {
    const mt = meta();
    const b = bd(IDS.map((id, i) => pieza(id, i + 1)), mt.m);
    const r = await manejarPublicar(peticion({ carrusel: { grupo: "g1", ids: IDS, altTexts: ["a", "b", "c"] }, dryRun: false }), { env: ENV_META, fetch: b.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(mt.hijos.map((h) => h.alt_text)).toEqual(["a", "b", "c"]);
  });

  it("accion «programar» con ids: monta el carrusel y llama a instagram_programar con SU id y el texto", async () => {
    const b = bd(IDS.map((id, i) => pieza(id, i + 1)));
    const r = await manejarPublicar(
      peticion({ accion: "programar", ids: IDS, caption: "Nochebuena", altTexts: ["a", "b", "c"], programarPara: "2026-12-24T10:00:00.000Z", confirmarConflicto: false }),
      { env: ENV_META, fetch: b.f, ahora: () => T0, ...depsRapidas },
    );
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    const cid = await idCarrusel(IDS);
    expect(j).toMatchObject({ ok: true, id: cid, programado: true, programacion: { id: "p1", programada_para: "2026-12-24T10:00:00+00:00" } });
    expect(b.rpc).toEqual([{ p_pieza_id: cid, p_para: "2026-12-24T10:00:00.000Z", p_confirmar_conflicto: false, p_caption: "Nochebuena", p_alt_texts: ["a", "b", "c"] }]);
  });

  it("400 con «ids» mal formados o con «id» e «ids» distintos", async () => {
    const b = bd([]);
    expect((await manejarPublicar(peticion({ ids: [] }), { env: ENV_META, fetch: b.f })).status).toBe(400);
    expect((await manejarPublicar(peticion({ ids: ["x"] }), { env: ENV_META, fetch: b.f })).status).toBe(400);
    expect((await manejarPublicar(peticion({ ids: Array(11).fill(IDS[0]) }), { env: ENV_META, fetch: b.f })).status).toBe(400);
    expect((await manejarPublicar(peticion({ id: IDS[0], ids: IDS }), { env: ENV_META, fetch: b.f })).status).toBe(400);
    expect((await manejarPublicar(peticion({ accion: "programar", ids: IDS }), { env: ENV_META, fetch: b.f })).status).toBe(400);
  });
});
