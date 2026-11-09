// @vitest-environment node
/**
 * instagram-drive · originales de la carta, sin red (Supabase y Google Drive
 * simulados): subir_original (permiso de la carta, no el de Marketing;
 * carpeta marketing/carta/<marca>; nombre <plato>-<id>.jpg; reemplazo con el
 * mismo id de Drive; fila en carta_fotos_originales; fallos de Drive y de la
 * migración) y preparar con origen «carta»/«vino» usando el original.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { manejarDrive } from "../drive.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { olvidarTokenDrive } from "../../_shared/google-drive.ts";
import { olvidarCarpetasDrive } from "../../_shared/instagram/drive.ts";
import { driveFalso, ENV_DRIVE, ENV_SB, falso, jpegDe, JWT, RAIZ_DRIVE, SB, type Llamada } from "../../_shared/instagram/__tests__/simulacion.ts";

const ENV = { ...ENV_SB, ...ENV_DRIVE };
const UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const AHORA = Date.UTC(2026, 10, 8, 12, 0, 0);
const deps = { nuevoId: () => UUID, ahora: () => AHORA };
const PLATO = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VINO = "v-pidio-2021";
const URL_WEB = `${SB}/storage/v1/object/public/platos/${PLATO}-carta-jpg.webp`;

type Fila = Record<string, unknown>;

/** Supabase + Drive simulados, con "Platos"/"Vinos", carta_fotos_originales y permisos por sección. */
function entorno(o: {
  permisos?: Record<string, boolean>;
  ficha?: Fila | null;
  originales?: Fila[] | "sin_tabla";
  guardarFalla?: boolean;
  drive?: ReturnType<typeof driveFalso>;
} = {}) {
  const d = o.drive ?? driveFalso();
  const base = falso({ drive: d.m, listado: [] });
  const originales: Fila[] = o.originales === "sin_tabla" ? [] : [...(o.originales ?? [])];
  const guardados: Fila[] = [];
  const secciones: string[] = [];
  const ficha = o.ficha === undefined ? { id: PLATO, nombre: "Chuletón de vaca gallega", restaurante: true, touza: false, activado: true, imagen_url: URL_WEB } : o.ficha;
  const anotar = (url: string, init: RequestInit) =>
    base.llamadas.push({ url, metodo: (init.method ?? "GET").toUpperCase(), cabeceras: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()), cuerpo: typeof init.body === "string" ? init.body : null, bruto: init.body } as Llamada);
  const json = (estado: number, c: unknown) => new Response(JSON.stringify(c), { status: estado, headers: { "Content-Type": "application/json" } });

  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    if (url === `${SB}/rest/v1/rpc/can_edit_section` || url === `${SB}/rest/v1/rpc/can_read_section`) {
      anotar(url, init);
      const seccion = JSON.parse(String(init.body))._section as string;
      secciones.push(`${url.endsWith("can_edit_section") ? "editar" : "leer"}:${seccion}`);
      return json(200, (o.permisos ?? { gestor_carta: true, marketing: true })[seccion] ?? false);
    }
    if (url.startsWith(`${SB}/rest/v1/Platos?`) || url.startsWith(`${SB}/rest/v1/Vinos?`)) {
      anotar(url, init);
      return json(200, ficha ? [ficha] : []);
    }
    if (url.startsWith(`${SB}/rest/v1/carta_fotos_originales`)) {
      anotar(url, init);
      if (o.originales === "sin_tabla") return json(404, { code: "PGRST205", message: "Could not find the table 'public.carta_fotos_originales' in the schema cache" });
      if (metodo === "GET") {
        const q = new URL(url).searchParams;
        const col = q.has("vino_id") ? "vino_id" : "plato_id";
        const valor = (q.get(col) ?? "").replace(/^eq\./, "");
        return json(200, originales.filter((x) => x[col] === valor));
      }
      if (metodo === "POST") {
        if (o.guardarFalla) return json(403, { message: "new row violates row-level security policy" });
        const fila = JSON.parse(String(init.body)) as Fila;
        guardados.push(fila);
        const col = "vino_id" in fila ? "vino_id" : "plato_id";
        const i = originales.findIndex((x) => x[col] === fila[col]);
        if (i >= 0) originales[i] = { ...originales[i], ...fila };
        else originales.push(fila);
        return json(201, [fila]);
      }
    }
    // Drive: reemplazar contenido (PATCH multipart), que driveFalso no simula.
    const reemplazo = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/([A-Za-z0-9_-]+)\?/.exec(url);
    if (reemplazo && metodo === "PATCH") {
      anotar(url, init);
      const fic = d.ficheros.get(reemplazo[1]);
      if (!fic) return json(404, { error: { message: "File not found" } });
      const texto = new TextDecoder().decode(init.body as Uint8Array);
      const meta = JSON.parse(texto.split("\r\n\r\n")[1].split("\r\n--")[0]) as { name: string };
      fic.name = meta.name;
      fic.bytes = jpegDe(3000, 4000);
      return json(200, { id: fic.id, name: meta.name, mimeType: "image/jpeg", parents: fic.parents });
    }
    return base.f(entrada, init);
  });
  return { f, d, llamadas: base.llamadas, originales, guardados, secciones };
}

const formulario = (campos: Record<string, string | Blob>, auth: string | null = `Bearer ${JWT}`) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return new Request(`${SB}/functions/v1/instagram-drive?accion=subir_original`, { method: "POST", headers: auth ? { Authorization: auth } : {}, body: fd });
};
const jpeg = (ancho: number, alto: number) => new Blob([jpegDe(ancho, alto) as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
const pedirPreparar = (cuerpo: unknown) =>
  new Request(`${SB}/functions/v1/instagram-drive`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` }, body: JSON.stringify(cuerpo) });

/** Id de la carpeta marketing/carta/<marca> en el Drive falso (o undefined). */
function carpetaDe(d: ReturnType<typeof driveFalso>, marca: string): string | undefined {
  const hijos = (padre: string, nombre: string) => [...d.ficheros.values()].find((x) => x.name === nombre && x.parents?.includes(padre))?.id;
  const carta = hijos(RAIZ_DRIVE, "carta");
  return carta ? hijos(carta, marca) : undefined;
}

beforeEach(() => {
  olvidarSecretos();
  olvidarTokenDrive();
  olvidarCarpetasDrive();
});

describe("instagram-drive · subir_original", () => {
  it("sube el JPEG a marketing/carta/casa-tomas/<plato>-<id>.jpg y anota el id de Drive en carta_fotos_originales", async () => {
    const e = entorno();
    const r = await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(4000, 3000) }), { env: ENV, fetch: e.f, ...deps });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, tabla: "Platos", id: PLATO, marca: "casa-tomas", nombre: `chuleton-de-vaca-gallega-${PLATO}.jpg`, ancho: 4000, alto: 3000, reemplazado: false });
    // En la carpeta de la carta de la marca (creada si faltaba), no en instagram/fotos.
    const carpeta = carpetaDe(e.d, "casa-tomas");
    expect(carpeta).toBeTruthy();
    expect(e.d.subidas).toHaveLength(1);
    expect(e.d.subidas[0].meta).toMatchObject({ name: `chuleton-de-vaca-gallega-${PLATO}.jpg`, parents: [carpeta] });
    expect(e.guardados).toEqual([{ plato_id: PLATO, drive_id: j.driveId, marca: "casa-tomas", nombre: j.nombre, ancho: 4000, alto: 3000, bytes: jpegDe(4000, 3000).byteLength }]);
    // Upsert por plato_id, con el JWT del usuario (decide la RLS), nunca service_role.
    const post = e.llamadas.find((l) => l.metodo === "POST" && l.url.startsWith(`${SB}/rest/v1/carta_fotos_originales`))!;
    expect(post.url).toContain("on_conflict=plato_id");
    expect(post.cabeceras.prefer).toContain("resolution=merge-duplicates");
    expect(post.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    // El permiso que se mira es «Editar» de la carta, no el de Marketing.
    expect(e.secciones).toEqual(["editar:gestor_carta"]);
  });

  it("vino de Touza: carpeta marketing/carta/touza y upsert por vino_id", async () => {
    const e = entorno({ ficha: { id: VINO, nombre: "Pidio", restaurante: false, touza: true } });
    const r = await manejarDrive(formulario({ tabla: "Vinos", id: VINO, archivo: jpeg(900, 1200) }), { env: ENV, fetch: e.f, ...deps });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ marca: "touza", nombre: `pidio-${VINO}.jpg` });
    expect(e.d.subidas[0].meta.parents).toEqual([carpetaDe(e.d, "touza")]);
    expect(e.llamadas.find((l) => l.url.startsWith(`${SB}/rest/v1/Vinos?`))).toBeTruthy();
    expect(e.llamadas.find((l) => l.metodo === "POST" && l.url.includes("carta_fotos_originales"))!.url).toContain("on_conflict=vino_id");
  });

  it("si el plato ya tenía original en esa carpeta, REEMPLAZA su contenido (mismo id de Drive)", async () => {
    const e = entorno();
    const primero = await (await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(4000, 3000) }), { env: ENV, fetch: e.f, ...deps })).json();
    const r = await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(3000, 4000) }), { env: ENV, fetch: e.f, ...deps });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ driveId: primero.driveId, reemplazado: true, ancho: 3000, alto: 4000 });
    expect(e.d.subidas).toHaveLength(1); // ningún fichero nuevo
    expect(e.llamadas.some((l) => l.metodo === "PATCH" && l.url.startsWith(`https://www.googleapis.com/upload/drive/v3/files/${primero.driveId}?`))).toBe(true);
    expect(e.originales).toHaveLength(1);
    expect(e.originales[0]).toMatchObject({ drive_id: primero.driveId, ancho: 3000, alto: 4000 });
  });

  it("permisos: 401 sin sesión; 403 sin «Editar» en la carta aunque tenga Marketing; sin tocar Google", async () => {
    const a = entorno();
    expect((await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(10, 10) }, null), { env: ENV, fetch: a.f, ...deps })).status).toBe(401);
    const b = entorno({ permisos: { marketing: true, gestor_carta: false } });
    const r = await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(10, 10) }), { env: ENV, fetch: b.f, ...deps });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/editar la carta/);
    expect(b.d.peticionesToken).toHaveLength(0);
    expect(b.guardados).toHaveLength(0);
  });

  it("valida: tabla, id, JPEG y lado ≤ 4000", async () => {
    const e = entorno();
    const estado = async (c: Record<string, string | Blob>) => (await manejarDrive(formulario(c), { env: ENV, fetch: e.f, ...deps })).status;
    expect(await estado({ tabla: "Cocteles", id: PLATO, archivo: jpeg(10, 10) })).toBe(400);
    expect(await estado({ tabla: "Platos", id: "../x", archivo: jpeg(10, 10) })).toBe(400);
    expect(await estado({ tabla: "Platos", id: PLATO, archivo: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }) })).toBe(415);
    expect(await estado({ tabla: "Platos", id: PLATO, archivo: jpeg(4001, 3000) })).toBe(422);
    expect(e.d.subidas).toHaveLength(0);
  });

  it("404 si la ficha no existe; 503 si falta la migración (sin subir nada a Drive)", async () => {
    const a = entorno({ ficha: null });
    expect((await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(10, 10) }), { env: ENV, fetch: a.f, ...deps })).status).toBe(404);
    const b = entorno({ originales: "sin_tabla" });
    const r = await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(10, 10) }), { env: ENV, fetch: b.f, ...deps });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("20261117100000_carta_fotos_originales");
    expect(b.d.subidas).toHaveLength(0);
  });

  it("fallo de Drive: 502 con el motivo y no anota nada (el panel avisa sin bloquear)", async () => {
    const e = entorno({ drive: driveFalso({ subidaFalla: true }) });
    const r = await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(4000, 3000) }), { env: ENV, fetch: e.f, ...deps });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/Google Drive/);
    expect(e.guardados).toHaveLength(0);
  });

  it("503 si faltan los secretos de Google; 500 si Drive va pero la fila no se puede anotar", async () => {
    const a = entorno();
    expect((await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(10, 10) }), { env: ENV_SB, fetch: a.f, ...deps })).status).toBe(503);
    const b = entorno({ guardarFalla: true });
    const r = await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(10, 10) }), { env: ENV, fetch: b.f, ...deps });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/está en Drive, pero no se pudo anotar/);
  });
});

describe("instagram-drive · preparar con el original de la carta", () => {
  it("si el plato tiene original, copia ESE JPEG (tamaño completo) a tmp/ y devuelve sus medidas", async () => {
    const e = entorno();
    await manejarDrive(formulario({ tabla: "Platos", id: PLATO, archivo: jpeg(4000, 3000) }), { env: ENV, fetch: e.f, ...deps });
    const fichero = [...e.d.ficheros.values()].find((x) => x.name?.endsWith(`-${PLATO}.jpg`))!;
    fichero.bytes = jpegDe(4000, 3000);
    const r = await manejarDrive(pedirPreparar({ accion: "preparar", origen: "carta", marca: "casa-tomas", platoId: PLATO }), { env: ENV, fetch: e.f, ...deps });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ruta: `tmp/${UUID}.jpg`, url: `${SB}/storage/v1/object/public/instagram/tmp/${UUID}.jpg`, ancho: 4000, alto: 3000, original: true });
    // Se descarga de Drive, no del bucket «platos».
    expect(e.llamadas.some((l) => l.url.includes(`/drive/v3/files/${fichero.id}?alt=media`))).toBe(true);
    expect(e.llamadas.some((l) => l.url.startsWith(`${SB}/storage/v1/object/public/platos/`))).toBe(false);
    const subida = e.llamadas.find((l) => l.url === `${SB}/storage/v1/object/instagram/tmp/${UUID}.jpg`)!;
    expect(subida.cabeceras["content-type"]).toBe("image/jpeg");
  });

  it("sin original: la versión web, como antes (original: false)", async () => {
    const e = entorno();
    const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
      if (String(entrada).startsWith(`${SB}/storage/v1/object/public/platos/`)) {
        return new Response(jpegDe(1200, 900) as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "image/jpeg" } });
      }
      return e.f(entrada, init);
    });
    const r = await manejarDrive(pedirPreparar({ accion: "preparar", origen: "carta", marca: "casa-tomas", platoId: PLATO }), { env: ENV, fetch: f, ...deps });
    expect(await r.json()).toMatchObject({ ok: true, ancho: 1200, alto: 900, original: false });
    expect(r.status).toBe(200);
  });

  it("original fuera de la carpeta de la carta (o borrado): no se usa; versión web con aviso", async () => {
    const e = entorno({ originales: [{ plato_id: PLATO, drive_id: "1FacturaSecreta000000000001", marca: "casa-tomas", nombre: "x.jpg", ancho: 4000, alto: 3000, bytes: 10 }] });
    e.d.ficheros.set("1FacturaSecreta000000000001", { id: "1FacturaSecreta000000000001", name: "factura.jpg", mimeType: "image/jpeg", parents: ["1OtraCarpeta0000000000001"], bytes: jpegDe(4000, 3000) });
    const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
      if (String(entrada).startsWith(`${SB}/storage/v1/object/public/platos/`)) {
        return new Response(jpegDe(1200, 900) as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "image/jpeg" } });
      }
      return e.f(entrada, init);
    });
    const r = await manejarDrive(pedirPreparar({ accion: "preparar", origen: "carta", marca: "casa-tomas", platoId: PLATO }), { env: ENV, fetch: f, ...deps });
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, ancho: 1200, alto: 900, original: false });
    expect(j.aviso).toMatch(/original de Drive/);
    expect(e.llamadas.some((l) => l.url.includes("1FacturaSecreta000000000001?alt=media"))).toBe(false);
  });

  it("vino con original: también lo usa (origen «vino»)", async () => {
    const e = entorno({ ficha: { id: VINO, nombre: "Pidio", restaurante: true, touza: false, activado: true, imagen_url: `${SB}/storage/v1/object/public/vinos/${VINO}.webp` } });
    await manejarDrive(formulario({ tabla: "Vinos", id: VINO, archivo: jpeg(1800, 2400) }), { env: ENV, fetch: e.f, ...deps });
    const fichero = [...e.d.ficheros.values()].find((x) => x.name === `pidio-${VINO}.jpg`)!;
    fichero.bytes = jpegDe(1800, 2400);
    const r = await manejarDrive(pedirPreparar({ accion: "preparar", origen: "vino", marca: "casa-tomas", vinoId: VINO }), { env: ENV, fetch: e.f, ...deps });
    expect(await r.json()).toMatchObject({ ok: true, ancho: 1800, alto: 2400, original: true });
  });
});
