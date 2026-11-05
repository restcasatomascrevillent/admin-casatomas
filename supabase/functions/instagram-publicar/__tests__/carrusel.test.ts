// @vitest-environment node
/**
 * Carruseles en instagram-publicar y en el cliente de la Graph API (migración
 * 20261112000000, docs/instagram-carrusel.md). Sin red: Supabase, Meta y
 * Drive simulados.
 *
 *   · Cliente: un hijo por imagen (is_carousel_item, image_url, alt_text),
 *     espera FINISHED y luego el contenedor CAROUSEL con children y caption.
 *     Si un hijo falla, no se crea el carrusel ni se publica nada.
 *   · Publicar sin prueba previa (sin dryRun), con los textos alternativos
 *     de cada imagen; Drive con las N imágenes y borrado del bucket.
 *   · Doble publicación: media_publish una sola vez; si el carrusel anterior
 *     ya salió, se recupera sin crear otro; tiempo agotado → no se repite.
 *   · Programar directamente (programarPara) con el texto en la llamada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarPublicar, publicarConSesion } from "../publicar.ts";
import { ClienteGraph } from "../../_shared/instagram/cliente.ts";
import { ErrorInstagram } from "../../_shared/instagram/errores.ts";
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
  ID,
  peticion,
  resp,
  SB,
  type Llamada,
  type Manejador,
} from "../../_shared/instagram/__tests__/simulacion.ts";

const IG = ENV_META.IG_USER_ID;
const PADRE = "1790000000000900";
const MEDIA = "1800000000000009";
const T0 = Date.UTC(2026, 11, 5, 12, 0, 0);
const N = 6;
const ruta = (i: number) => `piezas/2026-11/${ID}-${String(i).padStart(2, "0")}.jpg`;
const ALTS = ["Ostras sobre hielo", "Bogavante vivo", "Navajas", "Percebes", "Zamburiñas", "Almejas"];
const FILA_CARRUSEL = {
  ...FILA_GENERADA,
  formato: "carrusel",
  tipo_medio: "carrusel",
  imagen_ruta: ruta(1),
  caption: "Llegó del Cantábrico #mariscos",
  diapositivas: Array.from({ length: N }, (_, i) => ({ foto: `drive:f${i + 1}`, plantilla: "ct-foto-titular", datos: {}, alt_text: ALTS[i], imagen_ruta: ruta(i + 1) })),
};

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
 * Meta simulada para carruseles, con estado: hijos 1790…01-06, padre PADRE.
 * `hijoFalla`: la imagen n (1…) da error al crearla; `hijoError`: su
 * contenedor acaba en ERROR. El padre pasa a PUBLISHED cuando media_publish
 * «llega» a Meta (aunque la respuesta se pierda).
 */
function metaCarrusel(o: { hijoFalla?: number; hijoError?: number; publish?: "ok" | "timeout"; padreAnterior?: string; medios?: Array<Record<string, unknown>> } = {}) {
  const estado: Record<string, string> = {};
  if (o.padreAnterior) estado[PADRE] = o.padreAnterior;
  const hijos: Array<Record<string, string>> = [];
  const padres: Array<Record<string, string>> = [];
  const cuenta = { publish: 0, buscar: 0 };
  const m: Manejador = (l: Llamada) => {
    const ruta = l.url.replace(GRAPH, "");
    if (ruta.startsWith(`/${IG}/content_publishing_limit`)) return resp(200, { data: [{ quota_usage: 2, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (ruta === `/${IG}/media` && l.metodo === "POST") {
      const p = Object.fromEntries(new URLSearchParams(l.cuerpo ?? ""));
      if (p.is_carousel_item === "true") {
        hijos.push(p);
        const n = hijos.length;
        if (o.hijoFalla === n) return resp(400, { error: { code: 9004, error_subcode: 2207052, message: "Media download has failed.", error_user_msg: "No se pudo descargar" } });
        const id = `17900000000000${String(n).padStart(2, "0")}`;
        estado[id] = o.hijoError === n ? "ERROR" : "FINISHED";
        return resp(200, { id });
      }
      padres.push(p);
      estado[PADRE] = "FINISHED";
      return resp(200, { id: PADRE });
    }
    const c = /^\/(\d+)\?fields=status_code/.exec(ruta)?.[1];
    if (c && l.metodo === "GET") return estado[c] ? resp(200, { id: c, status_code: estado[c], status: estado[c] === "ERROR" ? "Error: unsupported image" : undefined }) : resp(400, { error: { code: 100, message: "Unsupported get request" } });
    if (ruta === `/${IG}/media_publish` && l.metodo === "POST") {
      cuenta.publish++;
      estado[new URLSearchParams(l.cuerpo ?? "").get("creation_id")!] = "PUBLISHED";
      if (o.publish === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
      return resp(200, { id: MEDIA });
    }
    if (ruta.startsWith(`/${IG}/media?`) && l.metodo === "GET") {
      cuenta.buscar++;
      return resp(200, { data: o.medios ?? [] });
    }
    if (ruta.startsWith(`/${MEDIA}?`)) return resp(200, { permalink: "https://www.instagram.com/p/CARRUSEL/" });
    return undefined;
  };
  return { m, hijos, padres, cuenta, estado };
}

const cliente = (f: typeof fetch) =>
  new ClienteGraph({ token: ENV_META.IG_ACCESS_TOKEN, versionApi: "v26.0", igUserId: IG, fetch: f, dormir: async () => undefined, reintentos: 0 });

/** fetch que solo atiende a Meta (para probar el cliente suelto). */
function soloMeta(m: Manejador): typeof fetch {
  return (async (u: string | URL | Request, init: RequestInit = {}) => {
    const l: Llamada = { url: String(u), metodo: (init.method ?? "GET").toUpperCase(), cabeceras: {}, cuerpo: typeof init.body === "string" ? init.body : null };
    const r = await m(l);
    if (!r) throw new Error(`URL inesperada: ${l.metodo} ${l.url}`);
    return r;
  }) as typeof fetch;
}

describe("ClienteGraph.crearCarrusel", () => {
  it("un hijo por imagen (is_carousel_item, image_url, alt_text, sin caption) y después el CAROUSEL con children y caption", async () => {
    const mt = metaCarrusel();
    const urls = [1, 2, 3].map((i) => `${SB}/storage/v1/object/public/instagram/${ruta(i)}`);
    const r = await cliente(soloMeta(mt.m)).crearCarrusel(urls.map((u, i) => ({ imageUrl: u, altText: i === 1 ? undefined : ALTS[i] })), { caption: "Hola #mar" });
    expect(r).toEqual({ contenedorId: PADRE, hijos: ["1790000000000001", "1790000000000002", "1790000000000003"] });
    expect(mt.hijos).toEqual([
      { image_url: urls[0], is_carousel_item: "true", alt_text: ALTS[0] },
      { image_url: urls[1], is_carousel_item: "true" },
      { image_url: urls[2], is_carousel_item: "true", alt_text: ALTS[2] },
    ]);
    expect(mt.padres).toEqual([{ media_type: "CAROUSEL", children: r.hijos.join(","), caption: "Hola #mar" }]);
  });

  it("si falla un hijo, dice qué imagen y NO crea el carrusel", async () => {
    const mt = metaCarrusel({ hijoFalla: 2 });
    const urls = [1, 2, 3].map((i) => `${SB}/x/${i}.jpg`);
    const e = await cliente(soloMeta(mt.m)).crearCarrusel(urls.map((u) => ({ imageUrl: u })), { caption: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorInstagram);
    expect(e.message).toMatch(/^Imagen 2 del carrusel: /);
    expect(mt.hijos).toHaveLength(2);
    expect(mt.padres).toHaveLength(0);
  });

  it("si un hijo acaba en ERROR al procesarlo, tampoco crea el carrusel", async () => {
    const mt = metaCarrusel({ hijoError: 3 });
    const e = await cliente(soloMeta(mt.m)).crearCarrusel([1, 2, 3].map((i) => ({ imageUrl: `${SB}/x/${i}.jpg` }))).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorInstagram);
    expect(e.tipo).toBe("contenedor_error");
    expect(e.message).toMatch(/^Imagen 3 del carrusel/);
    expect(mt.padres).toHaveLength(0);
  });
});

describe("instagram-publicar: carrusel", () => {
  it("publica SIN prueba previa (sin dryRun): 6 hijos con su alt_text, CAROUSEL, media_publish una vez, Drive con las 6 y borra el bucket", async () => {
    const mt = metaCarrusel();
    const d = driveFalso();
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m, drive: d.m });
    const r = await manejarPublicar(peticion({ id: ID, fotosTmp: [`tmp/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}.jpg`] }), {
      env: { ...ENV_META, ...ENV_DRIVE },
      fetch: s.f,
      ahora: () => T0,
      ...depsRapidas,
    });
    const b = await r.json();
    expect(r.status, JSON.stringify(b)).toBe(200);
    expect(b).toMatchObject({ publicado: true, estado: "publicada", tipoMedio: "carrusel", mediaId: MEDIA, imagenEnBucket: false, permalink: "https://www.instagram.com/p/CARRUSEL/" });
    expect(mt.hijos.map((h) => h.alt_text)).toEqual(ALTS);
    expect(mt.hijos.map((h) => h.image_url)).toEqual([1, 2, 3, 4, 5, 6].map((i) => `${SB}/storage/v1/object/public/instagram/${ruta(i)}`));
    expect(mt.padres).toHaveLength(1);
    expect(mt.padres[0]).toMatchObject({ media_type: "CAROUSEL", caption: FILA_CARRUSEL.caption });
    expect(mt.padres[0].children.split(",")).toHaveLength(6);
    expect(mt.cuenta.publish).toBe(1);
    expect(b.driveIds).toHaveLength(6);
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA, contenedor_id: PADRE, drive_id: b.driveIds[0], drive_ids: b.driveIds, error: null });
    // HEAD de las 6 antes de crear nada.
    const heads = s.llamadas.filter((l) => l.metodo === "HEAD");
    expect(heads).toHaveLength(6);
    // Borra las 6 imágenes y la copia tmp/ (dos DELETE en bloque).
    const borrados = s.llamadas.filter((l) => l.metodo === "DELETE").map((l) => JSON.parse(l.cuerpo!).prefixes);
    expect(borrados[0]).toEqual([1, 2, 3, 4, 5, 6].map(ruta));
    expect(borrados[1]).toHaveLength(1);
  });

  it("textos alternativos en la llamada: van a Meta y se guardan en las diapositivas", async () => {
    const mt = metaCarrusel();
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m });
    const nuevos = ALTS.map((a) => `${a} en la barra`);
    const r = await manejarPublicar(peticion({ id: ID, altTexts: nuevos }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(mt.hijos.map((h) => h.alt_text)).toEqual(nuevos);
    expect((s.fila()!.diapositivas as Array<{ alt_text: string }>).map((x) => x.alt_text)).toEqual(nuevos);
    // Sin Drive: publicado, imágenes en el bucket, aviso.
    expect(String(s.fila()!.error)).toMatch(/^Publicada, pero no se pudo guardar en Google Drive/);
    expect(s.llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
  });

  it("422 si llegan menos textos alternativos que imágenes (sin tocar Meta)", async () => {
    const mt = metaCarrusel();
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: ID, altTexts: ALTS.slice(0, 3) }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(422);
    expect(mt.hijos).toHaveLength(0);
  });

  it("error en un hijo → no se publica nada y la pieza queda en «error» diciendo qué imagen", async () => {
    const mt = metaCarrusel({ hijoFalla: 4 });
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: ID }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(mt.padres).toHaveLength(0);
    expect(mt.cuenta.publish).toBe(0);
    expect(s.fila()).toMatchObject({ estado: "error", media_id: null });
    expect(String(s.fila()!.error)).toMatch(/Imagen 4 del carrusel/);
  });

  it("409 si el carrusel no tiene sus imágenes o se borraron", async () => {
    const s1 = falso({ fila: { ...FILA_CARRUSEL, diapositivas: null } });
    expect((await manejarPublicar(peticion({ id: ID }), { env: ENV_META, fetch: s1.f, ...depsRapidas })).status).toBe(409);
    const s2 = falso({ fila: { ...FILA_CARRUSEL, imagen_borrada_at: "2026-11-01T00:00:00Z" } });
    const r = await manejarPublicar(peticion({ id: ID }), { env: ENV_META, fetch: s2.f, ...depsRapidas });
    expect(r.status).toBe(409);
    expect((await r.json()).tipo).toBe("imagen_borrada");
  });

  it("dryRun sigue siendo una opción interna: crea el carrusel y NO publica", async () => {
    const mt = metaCarrusel();
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ estado: "prueba_ok", publicado: false });
    expect(mt.cuenta.publish).toBe(0);
    expect(s.fila()).toMatchObject({ estado: "prueba_ok", contenedor_id: PADRE });
  });
});

describe("instagram-publicar: carrusel sin doble publicación", () => {
  it("tiempo agotado en media_publish (Meta sí lo publicó): NO hay segundo media_publish y queda publicado", async () => {
    const mt = metaCarrusel({ publish: "timeout", medios: [{ id: MEDIA, caption: FILA_CARRUSEL.caption, timestamp: new Date(T0).toISOString(), permalink: "https://www.instagram.com/p/CARRUSEL/" }] });
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: ID }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b).toMatchObject({ publicado: true, recuperada: true, mediaId: MEDIA });
    expect(mt.cuenta.publish).toBe(1);
    expect(mt.padres).toHaveLength(1);
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA, contenedor_id: PADRE });
  });

  it("al volver a pulsar «Publicar», si el carrusel anterior ya salió, no crea hijos ni otro carrusel ni publica otra vez", async () => {
    const mt = metaCarrusel({ padreAnterior: "PUBLISHED", medios: [{ id: MEDIA, caption: FILA_CARRUSEL.caption, timestamp: new Date(T0).toISOString() }] });
    const s = falso({ fila: { ...FILA_CARRUSEL, estado: "error", contenedor_id: PADRE }, meta: mt.m });
    const r = await manejarPublicar(peticion({ id: ID }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ publicado: true, recuperada: true, mediaId: MEDIA });
    expect(mt.hijos).toHaveLength(0);
    expect(mt.padres).toHaveLength(0);
    expect(mt.cuenta.publish).toBe(0);
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA });
  });

  it("media_id se guarda ANTES de tocar Drive", async () => {
    const mt = metaCarrusel();
    const d = driveFalso({ subidaFalla: true });
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m, drive: d.m });
    const r = await manejarPublicar(peticion({ id: ID }), { env: { ...ENV_META, ...ENV_DRIVE }, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    const guardado = s.llamadas.findIndex((l) => l.metodo === "PATCH" && String(l.cuerpo).includes(`"media_id":"${MEDIA}"`));
    const primeraGoogle = s.llamadas.findIndex((l) => /googleapis\.com/.test(l.url));
    expect(guardado).toBeGreaterThan(-1);
    expect(primeraGoogle).toBeGreaterThan(guardado);
    expect(s.llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
  });

  it("el programador publica un carrusel programado con el cuerpo de siempre ({ id, dryRun: false })", async () => {
    const mt = metaCarrusel();
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m });
    const sesion = { usuario: "programador", token: "clave-de-servicio", sb: { url: SB, clave: "clave-de-servicio" }, fetch: s.f as unknown as typeof fetch };
    const r = await publicarConSesion(sesion, peticion({ id: ID, dryRun: false }), { origen: "programador", env: ENV_META, fetch: s.f as unknown as typeof fetch, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(mt.hijos.map((h) => h.alt_text)).toEqual(ALTS);
    expect(mt.cuenta.publish).toBe(1);
    expect(s.fila()).toMatchObject({ estado: "publicada", media_id: MEDIA });
  });

  it("409 «publicacion_en_curso» si otra petición tiene el cerrojo (no toca Meta)", async () => {
    const mt = metaCarrusel();
    const s = falso({ fila: { ...FILA_CARRUSEL }, meta: mt.m, reserva: [200, { ok: false, motivo: "en_curso" }] });
    const r = await manejarPublicar(peticion({ id: ID }), { env: ENV_META, fetch: s.f, ahora: () => T0, ...depsRapidas });
    expect(r.status).toBe(409);
    expect((await r.json()).tipo).toBe("publicacion_en_curso");
    expect(mt.hijos).toHaveLength(0);
  });
});

describe("instagram-publicar: programar sin prueba previa", () => {
  /** falso() + la RPC instagram_programar. */
  function conProgramar(fila: Record<string, unknown>, rpc: [number, unknown] = [200, { ok: true, accion: "programada", programacion: { id: "p1" }, conflictos: [] }]) {
    const base = falso({ fila });
    const llamadasRpc: Array<{ cabeceras: Record<string, string>; cuerpo: Record<string, unknown> }> = [];
    const f = vi.fn(async (u: string | URL | Request, init: RequestInit = {}) => {
      if (String(u) === `${SB}/rest/v1/rpc/instagram_programar`) {
        llamadasRpc.push({ cabeceras: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()), cuerpo: JSON.parse(String(init.body)) });
        return resp(...rpc);
      }
      return base.f(u, init);
    });
    return { f, llamadasRpc, base };
  }
  const PARA = "2026-12-24T10:00:00.000Z";

  it("valida, comprueba las 6 imágenes y llama a instagram_programar con el JWT del usuario y el texto en la llamada", async () => {
    const p = conProgramar({ ...FILA_CARRUSEL });
    const r = await manejarPublicar(peticion({ id: ID, programarPara: PARA, caption: "Nochebuena #mariscos", altTexts: ALTS }), { env: ENV_META, fetch: p.f as unknown as typeof fetch, ...depsRapidas });
    const b = await r.json();
    expect(r.status, JSON.stringify(b)).toBe(200);
    expect(b).toMatchObject({ ok: true, programado: true, programacion: { id: "p1" } });
    expect(p.llamadasRpc).toHaveLength(1);
    expect(p.llamadasRpc[0].cabeceras.authorization).toMatch(/^Bearer eyJ/);
    expect(p.llamadasRpc[0].cuerpo).toEqual({ p_pieza_id: ID, p_para: PARA, p_confirmar_conflicto: false, p_caption: "Nochebuena #mariscos", p_alt_texts: ALTS });
    expect(p.base.llamadas.filter((l) => l.metodo === "HEAD")).toHaveLength(6);
    // No reserva el cerrojo de publicación ni toca Meta.
    expect(p.base.llamadas.some((l) => l.url.includes("graph.facebook.com") || l.url.includes("reservar_publicacion"))).toBe(false);
  });

  it("un post: p_alt_text (no p_alt_texts); sin texto en la llamada, no lo manda (usa el guardado)", async () => {
    const p = conProgramar({ ...FILA_GENERADA });
    expect((await manejarPublicar(peticion({ id: ID, programarPara: PARA, altText: "Barra de Touza" }), { env: ENV_META, fetch: p.f as unknown as typeof fetch })).status).toBe(200);
    expect(p.llamadasRpc[0].cuerpo).toEqual({ p_pieza_id: ID, p_para: PARA, p_confirmar_conflicto: false, p_alt_text: "Barra de Touza" });
  });

  it("texto no válido (31 hashtags) → 422 sin llamar a la RPC", async () => {
    const p = conProgramar({ ...FILA_CARRUSEL });
    const caption = Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ");
    expect((await manejarPublicar(peticion({ id: ID, programarPara: PARA, caption }), { env: ENV_META, fetch: p.f as unknown as typeof fetch })).status).toBe(422);
    expect(p.llamadasRpc).toHaveLength(0);
  });

  it("conflicto con otra programada → 200 requiereConfirmacion (como la RPC); error de la RPC → 422 con su mensaje", async () => {
    const c = conProgramar({ ...FILA_CARRUSEL }, [200, { ok: false, requiereConfirmacion: true, conflictos: [{ id: "x" }] }]);
    const r = await manejarPublicar(peticion({ id: ID, programarPara: PARA }), { env: ENV_META, fetch: c.f as unknown as typeof fetch });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ requiereConfirmacion: true, conflictos: [{ id: "x" }] });
    const e = conProgramar({ ...FILA_CARRUSEL }, [400, { code: "22023", message: "Hay que programarla con al menos 10 minutos de margen" }]);
    const r2 = await manejarPublicar(peticion({ id: ID, programarPara: PARA }), { env: ENV_META, fetch: e.f as unknown as typeof fetch });
    expect(r2.status).toBe(422);
    expect((await r2.json()).error).toMatch(/10 minutos/);
  });
});
