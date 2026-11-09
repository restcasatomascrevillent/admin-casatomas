// @vitest-environment node
/**
 * instagram-drive · originales de la carta SOLO en Drive (08/11/2026), sin
 * red (Supabase y Google Drive simulados): descargar_original (foto y vídeo,
 * permiso «Editar» de la carta, sin original → 404 sinOriginal, comprobar sin
 * descargar, fichero fuera de su carpeta) y subir_original_video (subida
 * reanudable a marketing/carta/<marca>/videos/<id>.<ext>, reemplazo con el
 * mismo id, solo vídeos de verdad).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { manejarDrive, pareceVideo } from "../drive.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { esUrlSesionSubida, olvidarTokenDrive } from "../../_shared/google-drive.ts";
import { olvidarCarpetasDrive } from "../../_shared/instagram/drive.ts";
import { driveFalso, ENV_DRIVE, ENV_SB, falso, jpegDe, JWT, RAIZ_DRIVE, SB, TOKEN_GOOGLE, type Llamada } from "../../_shared/instagram/__tests__/simulacion.ts";

const ENV = { ...ENV_SB, ...ENV_DRIVE };
const PLATO = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VINO = "v-pidio-2021";
const SESION_SUBIDA = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=sesion123";
/** Cabecera mínima de un MP4 (caja «ftyp»). */
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 1, 2, 3, 4]);

type Fila = Record<string, unknown>;
const json = (estado: number, c: unknown) => new Response(JSON.stringify(c), { status: estado, headers: { "Content-Type": "application/json" } });

function entorno(o: { permisos?: Record<string, boolean>; originales?: Fila[]; ficha?: Fila | null; sinDrive?: boolean } = {}) {
  const d = driveFalso();
  const base = falso({ drive: d.m, listado: [] });
  const secciones: string[] = [];
  const sesiones: Array<{ metodo: string; meta: Record<string, unknown>; reemplazar?: string; tipo: string; largo: string }> = [];
  let abierta: (typeof sesiones)[number] | null = null;
  const ficha = o.ficha === undefined ? { id: PLATO, nombre: "Arroz meloso", restaurante: true, touza: false } : o.ficha;
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cab = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    base.llamadas.push({ url, metodo, cabeceras: cab, cuerpo: typeof init.body === "string" ? init.body : null, bruto: init.body } as Llamada);
    if (url === `${SB}/rest/v1/rpc/can_edit_section` || url === `${SB}/rest/v1/rpc/can_read_section`) {
      const seccion = JSON.parse(String(init.body))._section as string;
      secciones.push(`${url.endsWith("can_edit_section") ? "editar" : "leer"}:${seccion}`);
      return json(200, (o.permisos ?? { gestor_carta: true, marketing: false })[seccion] ?? false);
    }
    if (url.startsWith(`${SB}/rest/v1/Platos?`) || url.startsWith(`${SB}/rest/v1/Vinos?`)) return json(200, ficha ? [ficha] : []);
    if (url.startsWith(`${SB}/rest/v1/carta_fotos_originales`)) {
      const q = new URL(url).searchParams;
      const col = q.has("vino_id") ? "vino_id" : "plato_id";
      const valor = (q.get(col) ?? "").replace(/^eq\./, "");
      return json(200, (o.originales ?? []).filter((x) => x[col] === valor));
    }
    const u = new URL(url);
    if (u.hostname === "www.googleapis.com") {
      if (cab.authorization !== `Bearer ${TOKEN_GOOGLE}`) return json(401, { error: { message: "Invalid Credentials" } });
      // Búsqueda por nombre (vídeos de un plato).
      if (u.pathname === "/drive/v3/files" && metodo === "GET" && (u.searchParams.get("q") ?? "").includes("name contains")) {
        const q = u.searchParams.get("q") ?? "";
        const padre = /'([^']+)' in parents/.exec(q)?.[1] ?? "";
        const texto = /name contains '([^']+)'/.exec(q)?.[1] ?? "";
        return json(200, { files: [...d.ficheros.values()].filter((x) => x.parents?.includes(padre) && !x.trashed && x.name.includes(texto)).map(({ bytes: _b, ...x }) => x) });
      }
      // Subida reanudable: abrir sesión y mandar los bytes.
      if (u.searchParams.get("uploadType") === "resumable" && (metodo === "POST" || metodo === "PATCH") && u.pathname.startsWith("/upload/drive/v3/files")) {
        const reemplazar = /\/files\/([A-Za-z0-9_-]+)$/.exec(u.pathname)?.[1];
        abierta = { metodo, meta: JSON.parse(String(init.body)), reemplazar, tipo: cab["x-upload-content-type"], largo: cab["x-upload-content-length"] };
        sesiones.push(abierta);
        return new Response(null, { status: 200, headers: { Location: SESION_SUBIDA } });
      }
      if (url === SESION_SUBIDA && metodo === "PUT" && abierta) {
        const bytes = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
        const s = abierta;
        abierta = null;
        if (s.reemplazar) {
          const x = d.ficheros.get(s.reemplazar)!;
          Object.assign(x, { name: s.meta.name as string, mimeType: s.tipo, size: String(bytes.byteLength), bytes });
          return json(200, { id: x.id, name: x.name, mimeType: x.mimeType, parents: x.parents });
        }
        const id = `1Video${String(d.ficheros.size).padStart(22, "0")}`;
        d.ficheros.set(id, { id, name: s.meta.name as string, mimeType: s.tipo, parents: s.meta.parents as string[], size: String(bytes.byteLength), bytes });
        return json(200, { id, name: s.meta.name, mimeType: s.tipo, parents: s.meta.parents });
      }
    }
    return base.f(entrada, init);
  });
  return { f, d, secciones, sesiones, llamadas: base.llamadas };
}

/** Carpeta (creándola) dentro de `padre`. */
function carpeta(d: ReturnType<typeof driveFalso>, nombre: string, padre: string): string {
  const hay = [...d.ficheros.values()].find((x) => x.name === nombre && x.parents?.includes(padre));
  if (hay) return hay.id;
  const id = `1Carpeta${nombre.replace(/[^a-z]/gi, "")}${String(d.ficheros.size).padStart(16, "0")}`;
  d.ficheros.set(id, { id, name: nombre, mimeType: "application/vnd.google-apps.folder", parents: [padre] });
  return id;
}
const carpetaCarta = (d: ReturnType<typeof driveFalso>, marca: string) => carpeta(d, marca, carpeta(d, "carta", RAIZ_DRIVE));
const carpetaVideos = (d: ReturnType<typeof driveFalso>, marca: string) => carpeta(d, "videos", carpetaCarta(d, marca));

const pedir = (cuerpo: unknown, opts: { query?: boolean; auth?: string | null } = {}) =>
  new Request(`${SB}/functions/v1/instagram-drive${opts.query === false ? "" : "?accion=descargar_original"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.auth === null ? {} : { Authorization: opts.auth ?? `Bearer ${JWT}` }) },
    body: JSON.stringify(cuerpo),
  });
const subirVideo = (campos: Record<string, string | Blob>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return new Request(`${SB}/functions/v1/instagram-drive?accion=subir_original_video`, { method: "POST", headers: { Authorization: `Bearer ${JWT}` }, body: fd });
};

beforeEach(() => {
  olvidarSecretos();
  olvidarTokenDrive();
  olvidarCarpetasDrive();
});

describe("instagram-drive · descargar_original (foto)", () => {
  it("devuelve los bytes del JPEG de Drive con el permiso «Editar» de la carta (sin Marketing)", async () => {
    const id = "1OriginalDrive0000000000000001";
    const jpeg = jpegDe(4000, 3000);
    const e = entorno({ originales: [{ plato_id: PLATO, drive_id: id, marca: "casa-tomas", nombre: "x.jpg", ancho: 4000, alto: 3000, bytes: jpeg.byteLength }] });
    e.d.ficheros.set(id, { id, name: `arroz-${PLATO}.jpg`, mimeType: "image/jpeg", size: String(jpeg.byteLength), parents: [carpetaCarta(e.d, "casa-tomas")], bytes: jpeg });
    const r = await manejarDrive(pedir({ tabla: "Platos", id: PLATO }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(jpeg);
    expect(e.secciones).toEqual(["editar:gestor_carta"]);
  });

  it("también con `accion` en el cuerpo JSON (sin ?accion=)", async () => {
    const e = entorno({ originales: [{ vino_id: VINO, drive_id: "1OriginalVino00000000000000001", marca: "touza", nombre: "v.jpg", ancho: 900, alto: 1200, bytes: 29 }] });
    const jpeg = jpegDe(900, 1200);
    e.d.ficheros.set("1OriginalVino00000000000000001", { id: "1OriginalVino00000000000000001", name: "v.jpg", mimeType: "image/jpeg", size: String(jpeg.byteLength), parents: [carpetaCarta(e.d, "touza")], bytes: jpeg });
    const r = await manejarDrive(pedir({ accion: "descargar_original", tabla: "Vinos", id: VINO }, { query: false }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(jpeg);
    expect(e.secciones).toEqual(["editar:gestor_carta"]);
  });

  it("comprobar: solo JSON con tamaño y medidas, sin descargar", async () => {
    const id = "1OriginalDrive0000000000000002";
    const e = entorno({ originales: [{ plato_id: PLATO, drive_id: id, marca: "casa-tomas", nombre: "x.jpg", ancho: 4000, alto: 3000, bytes: 123 }] });
    e.d.ficheros.set(id, { id, name: "x.jpg", mimeType: "image/jpeg", size: "123", parents: [carpetaCarta(e.d, "casa-tomas")], imageMediaMetadata: { width: 4000, height: 3000 } } as never);
    const r = await manejarDrive(pedir({ tabla: "Platos", id: PLATO, comprobar: true }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, tipo: "foto", driveId: id, bytes: 123, ancho: 4000, alto: 3000, marca: "casa-tomas" });
    expect(e.llamadas.some((l) => l.url.includes("alt=media"))).toBe(false);
  });

  it("sin original: 404 con sinOriginal (el panel usa el sticker y avisa)", async () => {
    const e = entorno();
    const r = await manejarDrive(pedir({ tabla: "Platos", id: PLATO }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ ok: false, sinOriginal: true });
  });

  it("un fichero anotado que NO está en marketing/carta/<marca> no se sirve", async () => {
    const id = "1FacturaPrivada000000000000001";
    const e = entorno({ originales: [{ plato_id: PLATO, drive_id: id, marca: "casa-tomas", nombre: "x.jpg", ancho: 1, alto: 1, bytes: 1 }] });
    e.d.ficheros.set(id, { id, name: "factura.jpg", mimeType: "image/jpeg", size: "29", parents: ["1OtraCarpeta0000000000000001"], bytes: jpegDe(10, 10) });
    const r = await manejarDrive(pedir({ tabla: "Platos", id: PLATO }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(404);
    expect(e.llamadas.some((l) => l.url.includes(`${id}?alt=media`))).toBe(false);
  });

  it("sin «Editar» en la carta: 403 (Marketing no basta)", async () => {
    const e = entorno({ permisos: { gestor_carta: false, marketing: true } });
    const r = await manejarDrive(pedir({ tabla: "Platos", id: PLATO }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Editar» en la carta/);
  });

  it("sin sesión: 401; datos malos: 400; sin secretos de Google: 503", async () => {
    const e = entorno();
    expect((await manejarDrive(pedir({ tabla: "Platos", id: PLATO }, { auth: null }), { env: ENV, fetch: e.f })).status).toBe(401);
    expect((await manejarDrive(pedir({ tabla: "Bebidas", id: PLATO }), { env: ENV, fetch: e.f })).status).toBe(400);
    expect((await manejarDrive(pedir({ tabla: "Platos", id: "../x" }), { env: ENV, fetch: e.f })).status).toBe(400);
    expect((await manejarDrive(pedir({ tabla: "Vinos", id: VINO, tipo: "video" }), { env: ENV, fetch: e.f })).status).toBe(400);
    expect((await manejarDrive(pedir({ tabla: "Platos", id: PLATO }), { env: ENV_SB, fetch: e.f })).status).toBe(503);
  });
});

describe("instagram-drive · vídeo original", () => {
  it("subir_original_video: subida reanudable a marketing/carta/casa-tomas/videos/<id>.mp4", async () => {
    const e = entorno();
    const r = await manejarDrive(subirVideo({ tabla: "Platos", id: PLATO, archivo: new File([MP4], "bruto.mp4", { type: "video/mp4" }) }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, id: PLATO, marca: "casa-tomas", nombre: `${PLATO}.mp4`, bytes: MP4.byteLength, reemplazado: false });
    expect(e.sesiones).toHaveLength(1);
    expect(e.sesiones[0]).toMatchObject({ metodo: "POST", tipo: "video/mp4", largo: String(MP4.byteLength), meta: { name: `${PLATO}.mp4`, parents: [carpetaVideos(e.d, "casa-tomas")] } });
    expect(e.d.ficheros.get(j.driveId)?.bytes).toEqual(MP4);
    expect(e.secciones).toEqual(["editar:gestor_carta"]);

    // Otra vez (otro formato): reemplaza el MISMO fichero de Drive.
    const r2 = await manejarDrive(subirVideo({ id: PLATO, archivo: new File([MP4], "otro.mov", { type: "video/quicktime" }) }), { env: ENV, fetch: e.f });
    const j2 = await r2.json();
    expect(j2).toMatchObject({ ok: true, driveId: j.driveId, nombre: `${PLATO}.mov`, reemplazado: true });
    expect(e.sesiones[1]).toMatchObject({ metodo: "PATCH", reemplazar: j.driveId, tipo: "video/quicktime" });

    // Y se puede comprobar y descargar.
    const c = await manejarDrive(pedir({ tabla: "Platos", id: PLATO, tipo: "video", comprobar: true }), { env: ENV, fetch: e.f });
    expect(await c.json()).toMatchObject({ ok: true, tipo: "video", driveId: j.driveId, nombre: `${PLATO}.mov`, mimeType: "video/quicktime", bytes: MP4.byteLength });
    const b = await manejarDrive(pedir({ tabla: "Platos", id: PLATO, tipo: "video" }), { env: ENV, fetch: e.f });
    expect(b.status).toBe(200);
    expect(b.headers.get("content-type")).toBe("video/quicktime");
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(MP4);
  });

  it("vídeo de un plato de Touza: carpeta marketing/carta/touza/videos", async () => {
    const e = entorno({ ficha: { id: PLATO, nombre: "Tapa", restaurante: false, touza: true } });
    const r = await manejarDrive(subirVideo({ id: PLATO, archivo: new File([MP4], "v.mp4", { type: "video/mp4" }) }), { env: ENV, fetch: e.f });
    expect(await r.json()).toMatchObject({ ok: true, marca: "touza" });
    expect(e.sesiones[0].meta.parents).toEqual([carpetaVideos(e.d, "touza")]);
  });

  it("rechaza lo que no es un vídeo (aunque se llame .mp4) y sin «Editar» en la carta", async () => {
    const e = entorno();
    const r = await manejarDrive(subirVideo({ id: PLATO, archivo: new File([jpegDe(10, 10) as Uint8Array<ArrayBuffer>], "falso.mp4", { type: "video/mp4" }) }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(415);
    expect(e.sesiones).toHaveLength(0);
    const sin = entorno({ permisos: { gestor_carta: false, marketing: true } });
    expect((await manejarDrive(subirVideo({ id: PLATO, archivo: new File([MP4], "v.mp4") }), { env: ENV, fetch: sin.f })).status).toBe(403);
  });

  it("sin vídeo original en Drive: 404 sinOriginal", async () => {
    const e = entorno();
    const r = await manejarDrive(pedir({ tabla: "Platos", id: PLATO, tipo: "video" }), { env: ENV, fetch: e.f });
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ sinOriginal: true });
  });
});

describe("utilidades", () => {
  it("pareceVideo: ftyp (mp4/mov) y EBML (webm/mkv), no JPEG", () => {
    expect(pareceVideo(MP4)).toBe(true);
    expect(pareceVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe(true);
    expect(pareceVideo(jpegDe(1, 1))).toBe(false);
  });

  it("esUrlSesionSubida: solo https://www.googleapis.com/upload/drive/v3/files…", () => {
    expect(esUrlSesionSubida(SESION_SUBIDA)).toBe(true);
    expect(esUrlSesionSubida("https://evil.example/upload/drive/v3/files")).toBe(false);
    expect(esUrlSesionSubida("http://www.googleapis.com/upload/drive/v3/files")).toBe(false);
    expect(esUrlSesionSubida("https://www.googleapis.com/drive/v3/files")).toBe(false);
  });
});
