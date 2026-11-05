// @vitest-environment node
/**
 * Edge Function instagram-drive sin red: Supabase y Google Drive simulados.
 * Autorización (marketing), listar con metadatos de instagram_fotos, subir
 * (solo JPEG, medidas del propio fichero), miniatura y preparar (copia
 * tmp/<uuid> en el bucket + limpieza de > 24 h), que solo sirven ficheros de
 * la carpeta de la marca, y la trampa del alcance drive.file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarDrive } from "../drive.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { olvidarTokenDrive, ALCANCE_DRIVE_FILE } from "../../_shared/google-drive.ts";
import { olvidarCarpetasDrive } from "../../_shared/instagram/drive.ts";
import {
  driveFalso,
  ENV_DRIVE,
  ENV_SB,
  falso,
  jpegDe,
  JWT,
  REFRESH_GOOGLE,
  SB,
  SECRETO_GOOGLE,
  TOKEN_GOOGLE,
} from "../../_shared/instagram/__tests__/simulacion.ts";

const ENV = { ...ENV_SB, ...ENV_DRIVE };
const UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FOTO = "1FotoCasaTomas00000000001";
const AHORA = Date.UTC(2026, 10, 5, 12, 0, 0);
const deps = { nuevoId: () => UUID, ahora: () => AHORA };

const pedir = (cuerpo: unknown, auth: string | null = `Bearer ${JWT}`) =>
  new Request(`${SB}/functions/v1/instagram-drive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(cuerpo),
  });

beforeEach(() => {
  olvidarSecretos();
  olvidarTokenDrive();
  olvidarCarpetasDrive();
});
afterEach(() => vi.restoreAllMocks());

describe("Edge Function instagram-drive", () => {
  it("401 sin sesión y 403 sin Marketing, sin llamar a Google", async () => {
    const d = driveFalso();
    const a = falso({ drive: d.m });
    expect((await manejarDrive(pedir({ accion: "listar", marca: "touza" }, null), { env: ENV, fetch: a.f })).status).toBe(401);
    const b = falso({ permiso: false, drive: d.m });
    expect((await manejarDrive(pedir({ accion: "listar", marca: "touza" }), { env: ENV, fetch: b.f })).status).toBe(403);
    expect(d.peticionesToken).toHaveLength(0);
  });

  it("503 si faltan los secretos de Google, nombrándolos sin valores", async () => {
    const { f } = falso();
    const r = await manejarDrive(pedir({ accion: "listar", marca: "touza" }), { env: { ...ENV_SB, GOOGLE_CLIENT_SECRET: SECRETO_GOOGLE }, fetch: f });
    expect(r.status).toBe(503);
    const texto = await r.text();
    expect(JSON.parse(texto).faltan).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_MARKETING_FOLDER_ID"]);
    expect(JSON.parse(texto).comoArreglarlo).toMatch(/--project-ref sfonaclosuafvlhutkon/);
    expect(texto).not.toContain(SECRETO_GOOGLE);
  });

  it("listar: fotos de la carpeta de la marca (creándola si falta), con tipo y descripción de instagram_fotos; sin fila → tipo null", async () => {
    const d = driveFalso();
    d.ponerFoto("casa-tomas", { id: FOTO, imageMediaMetadata: { width: 2560, height: 1708, rotation: 1 }, thumbnailLink: "https://lh3.googleusercontent.com/x=s220" });
    d.ponerFoto("casa-tomas", { id: "1FotoSinFila0000000000002", mimeType: "image/heic", imageMediaMetadata: { width: 3024, height: 4032 } });
    d.ponerFoto("touza", { id: "1FotoDeTouza0000000000003" });
    const fila = { id: UUID, marca: "casa-tomas", drive_id: FOTO, ancho: 1708, alto: 2560, tipo: "plato", descripcion: " Chuleta " };
    const { f, llamadas } = falso({ drive: d.m, fotos: [fila] });
    const r = await manejarDrive(pedir({ accion: "listar", marca: "casa-tomas" }), { env: ENV, fetch: f });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, marca: "casa-tomas", alcance: "completo", avisos: [] });
    expect(j.fotos).toEqual([
      expect.objectContaining({ driveId: FOTO, ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Chuleta", filaId: UUID, problema: null }),
      expect.objectContaining({ driveId: "1FotoSinFila0000000000002", ancho: 3024, alto: 4032, tipo: null, filaId: null, problema: expect.stringMatching(/HEIC.*Subir foto/) }),
    ]);
    // instagram_fotos se lee con el JWT del usuario y filtrando por marca.
    const lectura = llamadas.find((l) => l.url.startsWith(`${SB}/rest/v1/instagram_fotos`))!;
    expect(lectura.url).toContain("marca=eq.casa-tomas");
    expect(lectura.cabeceras.authorization).toBe(`Bearer ${JWT}`);
  });

  it("listar con alcance drive.file avisa de que no salen las fotos arrastradas a mano", async () => {
    const d = driveFalso({ alcance: ALCANCE_DRIVE_FILE });
    const { f } = falso({ drive: d.m });
    const j = await (await manejarDrive(pedir({ accion: "listar", marca: "touza" }), { env: ENV, fetch: f })).json();
    expect(j.alcance).toBe("drive.file");
    expect(j.avisos.join(" ")).toMatch(/drive\.file.*arrastres a mano/);
  });

  it("drive.file con la carpeta «marketing» creada a mano (Drive no la ve): 502 que explica qué hacer", async () => {
    const d = driveFalso({ alcance: ALCANCE_DRIVE_FILE, raizVisible: false });
    const { f } = falso({ drive: d.m });
    const r = await manejarDrive(pedir({ accion: "listar", marca: "touza" }), { env: ENV, fetch: f });
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.comoArreglarlo).toMatch(/drive\.file.*creado ella.*https:\/\/www\.googleapis\.com\/auth\/drive.*GOOGLE_REFRESH_TOKEN/);
  });

  it("preparar: copia la foto a tmp/<uuid>.jpg con el JWT del usuario, devuelve su URL pública y borra las copias de > 24 h", async () => {
    const d = driveFalso();
    d.ponerFoto("touza", { id: FOTO, imageMediaMetadata: { width: 1708, height: 2560 }, bytes: jpegDe(1708, 2560) });
    const vieja = new Date(AHORA - 25 * 3600 * 1000).toISOString();
    const nueva = new Date(AHORA - 3600 * 1000).toISOString();
    const { f, llamadas } = falso({ drive: d.m, listado: [{ name: "vieja.jpg", created_at: vieja }, { name: "nueva.jpg", created_at: nueva }] });
    const r = await manejarDrive(pedir({ accion: "preparar", marca: "touza", id: FOTO }), { env: ENV, fetch: f, ...deps });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ok: true,
      ruta: `tmp/${UUID}.jpg`,
      url: `${SB}/storage/v1/object/public/instagram/tmp/${UUID}.jpg`,
      ancho: 1708,
      alto: 2560,
    });
    const subida = llamadas.find((l) => l.url === `${SB}/storage/v1/object/instagram/tmp/${UUID}.jpg`)!;
    expect(subida.metodo).toBe("POST");
    expect(subida.cabeceras["content-type"]).toBe("image/jpeg");
    expect(subida.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    const borrado = llamadas.find((l) => l.metodo === "DELETE")!;
    expect(JSON.parse(borrado.cuerpo!)).toEqual({ prefixes: ["tmp/vieja.jpg"] });
  });

  it("preparar y miniatura NO sirven ficheros fuera de la carpeta de la marca (aunque el token los vea)", async () => {
    const d = driveFalso();
    d.ponerFoto("touza", { id: FOTO });
    // Una factura que el token ve, fuera de marketing/instagram/fotos.
    d.ficheros.set("1FacturaSecreta0000000009", { id: "1FacturaSecreta0000000009", name: "factura.jpg", mimeType: "image/jpeg", parents: ["1OtraCarpeta000000000000"] });
    const { f, llamadas } = falso({ drive: d.m });
    for (const id of ["1FacturaSecreta0000000009"]) {
      expect((await manejarDrive(pedir({ accion: "preparar", marca: "touza", id }), { env: ENV, fetch: f, ...deps })).status).toBe(404);
    }
    // La de Touza no se sirve como de Casa Tomás.
    expect((await manejarDrive(pedir({ accion: "preparar", marca: "casa-tomas", id: FOTO }), { env: ENV, fetch: f, ...deps })).status).toBe(404);
    const mini = new Request(`${SB}/functions/v1/instagram-drive?accion=miniatura&marca=touza&id=1FacturaSecreta0000000009`, { headers: { Authorization: `Bearer ${JWT}` } });
    expect((await manejarDrive(mini, { env: ENV, fetch: f })).status).toBe(404);
    expect(llamadas.some((l) => l.url.includes("1FacturaSecreta0000000009?alt=media"))).toBe(false);
    expect(llamadas.some((l) => l.url.startsWith(`${SB}/storage/v1/object/instagram/tmp/`))).toBe(false);
    // Ids con forma rara: 400 sin preguntar a Drive.
    expect((await manejarDrive(pedir({ accion: "preparar", marca: "touza", id: "../x" }), { env: ENV, fetch: f })).status).toBe(400);
  });

  it("miniatura: devuelve los bytes (image/*) con CORS y caché privada", async () => {
    const d = driveFalso();
    d.ponerFoto("touza", { id: FOTO, thumbnailLink: "https://lh3.googleusercontent.com/drive-storage/abc=s220" });
    const { f, llamadas } = falso({ drive: d.m });
    const r = await manejarDrive(new Request(`${SB}/functions/v1/instagram-drive?accion=miniatura&marca=touza&id=${FOTO}`, { headers: { Authorization: `Bearer ${JWT}` } }), { env: ENV, fetch: f });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("cache-control")).toMatch(/private/);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(llamadas.some((l) => l.url === "https://lh3.googleusercontent.com/drive-storage/abc=s400")).toBe(true);
  });

  it("subir: JPEG a la carpeta de la marca con nombre legible, medidas del propio JPEG y fila en instagram_fotos", async () => {
    const d = driveFalso();
    const { f, llamadas } = falso({ drive: d.m });
    const form = new FormData();
    form.set("marca", "casa-tomas");
    form.set("tipo", "plato");
    form.set("descripcion", "  Chuleta de vaca ");
    form.set("archivo", new Blob([jpegDe(1708, 2560)], { type: "image/jpeg" }), "foto.jpg");
    const req = new Request(`${SB}/functions/v1/instagram-drive?accion=subir`, { method: "POST", headers: { Authorization: `Bearer ${JWT}` }, body: form });
    const r = await manejarDrive(req, { env: ENV, fetch: f, ...deps });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.foto).toMatchObject({ ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Chuleta de vaca", filaId: UUID });
    expect(d.subidas[0].meta.name).toBe("2026-11-05-chuleta-de-vaca-0a1b2c3d.jpg");
    const carpeta = d.ficheros.get(d.subidas[0].meta.parents[0])!;
    expect(carpeta.name).toBe("casa-tomas");
    const insert = llamadas.find((l) => l.url.startsWith(`${SB}/rest/v1/instagram_fotos`) && l.metodo === "POST")!;
    expect(JSON.parse(insert.cuerpo!)).toEqual({ id: UUID, marca: "casa-tomas", drive_id: j.foto.driveId, ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Chuleta de vaca", ruta: null });
    expect(insert.cabeceras.authorization).toBe(`Bearer ${JWT}`);
  });

  it("subir: rechaza lo que no es JPEG, lados de más de 2560 y tipos desconocidos", async () => {
    const { f } = falso({ drive: driveFalso().m });
    const enviar = async (campos: Record<string, string | Blob>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries({ marca: "touza", tipo: "coctel", descripcion: "", ...campos })) form.set(k, v);
      return (await manejarDrive(new Request(`${SB}/functions/v1/instagram-drive?accion=subir`, { method: "POST", headers: { Authorization: `Bearer ${JWT}` }, body: form }), { env: ENV, fetch: f, ...deps })).status;
    };
    expect(await enviar({ archivo: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }) })).toBe(415);
    expect(await enviar({ archivo: new Blob([jpegDe(4000, 3000)], { type: "image/jpeg" }) })).toBe(422);
    expect(await enviar({ archivo: new Blob([jpegDe(1000, 1000)]), tipo: "postre" })).toBe(400);
    expect(await enviar({ archivo: new Blob([jpegDe(1000, 1000)]), marca: "otra" })).toBe(400);
  });

  it("si la fila no se puede guardar, la foto sigue en Drive y se avisa", async () => {
    const d = driveFalso();
    const { f } = falso({ drive: d.m, insertarFoto: [400, { message: "column \"drive_id\" does not exist" }] });
    const form = new FormData();
    form.set("marca", "touza");
    form.set("tipo", "coctel");
    form.set("archivo", new Blob([jpegDe(1708, 2560)], { type: "image/jpeg" }));
    const j = await (await manejarDrive(new Request(`${SB}/functions/v1/instagram-drive?accion=subir`, { method: "POST", headers: { Authorization: `Bearer ${JWT}` }, body: form }), { env: ENV, fetch: f, ...deps })).json();
    expect(j.ok).toBe(true);
    expect(j.foto).toMatchObject({ tipo: null, filaId: null });
    expect(j.avisos[0]).toMatch(/está en Drive, pero no se pudieron guardar su tipo/);
  });

  it("nunca devuelve ni registra los secretos de Google", async () => {
    const salida: string[] = [];
    for (const nivel of ["log", "info", "warn", "error"] as const) vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => void salida.push(a.map(String).join(" ")));
    const d = driveFalso({ tokenFalla: true });
    const { f } = falso({ drive: d.m });
    const r = await manejarDrive(pedir({ accion: "listar", marca: "touza" }), { env: ENV, fetch: f });
    expect(r.status).toBe(502);
    const texto = (await r.text()) + salida.join("\n");
    for (const s of [SECRETO_GOOGLE, REFRESH_GOOGLE, TOKEN_GOOGLE, JWT]) expect(texto).not.toContain(s);
  });

  it("acción desconocida → 400; PUT → 405; OPTIONS → 204", async () => {
    const { f } = falso({ drive: driveFalso().m });
    expect((await manejarDrive(pedir({ accion: "borrarTodo" }), { env: ENV, fetch: f })).status).toBe(400);
    expect((await manejarDrive(new Request(`${SB}/functions/v1/instagram-drive`, { method: "PUT" }), { env: ENV, fetch: f })).status).toBe(405);
    expect((await manejarDrive(new Request(`${SB}/functions/v1/instagram-drive`, { method: "OPTIONS" }), { env: ENV, fetch: f })).status).toBe(204);
  });
});

describe("instagram-drive · preparar una foto de la carta (origen «carta»)", () => {
  const PLATO = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const URL_PLATO = `${SB}/storage/v1/object/public/platos/platos/chuleta.webp`;

  /** WebP mínimo (cabecera VP8X) de ancho×alto. */
  function webpDe(ancho: number, alto: number): Uint8Array {
    const b = new Uint8Array(40);
    b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    b.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
    b[16] = 10;
    const a = ancho - 1;
    const h = alto - 1;
    b.set([a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
    return b;
  }

  /** Supabase simulado + tabla "Platos" + bucket «platos». */
  function conCarta(fila: Record<string, unknown> | null, o: { tipo?: string; listado?: unknown[] } = {}) {
    const base = falso({ listado: o.listado ?? [] });
    const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
      const url = String(entrada);
      if (url.startsWith(`${SB}/rest/v1/Platos?`)) {
        base.llamadas.push({ url, metodo: "GET", cabeceras: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()), cuerpo: null, bruto: null } as never);
        return new Response(JSON.stringify(fila ? [fila] : []), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.startsWith(`${SB}/storage/v1/object/public/platos/`)) {
        base.llamadas.push({ url, metodo: "GET", cabeceras: {}, cuerpo: null, bruto: init } as never);
        return new Response(webpDe(1080, 1440) as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": o.tipo ?? "image/webp" } });
      }
      return base.f(entrada, init);
    });
    return { f, llamadas: base.llamadas };
  }
  const filaPlato = (o: Record<string, unknown> = {}) => ({ id: PLATO, imagen_url: URL_PLATO, activado: true, restaurante: true, touza: false, ...o });

  it("válido: lee el plato con el JWT, copia su WebP a tmp/<uuid>.webp y devuelve URL y medidas, sin secretos de Google", async () => {
    const vieja = new Date(AHORA - 25 * 3600 * 1000).toISOString();
    const { f, llamadas } = conCarta(filaPlato(), { listado: [{ name: "vieja.jpg", created_at: vieja }] });
    // Solo Supabase: la foto de la carta no pasa por Google Drive.
    const r = await manejarDrive(pedir({ accion: "preparar", origen: "carta", marca: "casa-tomas", platoId: PLATO }), { env: ENV_SB, fetch: f, ...deps });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ok: true,
      ruta: `tmp/${UUID}.webp`,
      url: `${SB}/storage/v1/object/public/instagram/tmp/${UUID}.webp`,
      ancho: 1080,
      alto: 1440,
    });
    const lectura = llamadas.find((l) => l.url.startsWith(`${SB}/rest/v1/Platos?`))!;
    expect(lectura.url).toContain(`id=eq.${PLATO}`);
    expect(lectura.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    const descarga = llamadas.find((l) => l.url.startsWith(`${SB}/storage/v1/object/public/platos/`))!;
    expect(descarga.url).toBe(URL_PLATO);
    expect((descarga.bruto as RequestInit).redirect).toBe("error");
    const subida = llamadas.find((l) => l.url === `${SB}/storage/v1/object/instagram/tmp/${UUID}.webp`)!;
    expect(subida.cabeceras["content-type"]).toBe("image/webp");
    expect(subida.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    // La limpieza de tmp/ de más de 24 h también corre aquí.
    expect(JSON.parse(llamadas.find((l) => l.metodo === "DELETE")!.cuerpo!)).toEqual({ prefixes: ["tmp/vieja.jpg"] });
  });

  it("URL ajena (otro host, otro proyecto, otro bucket, «..») → 400 sin descargar nada", async () => {
    for (const imagen_url of [
      "https://evil.example.com/storage/v1/object/public/platos/a.webp",
      "https://haqmmdfdzzatdnrrcgez.supabase.co/storage/v1/object/public/platos/a.webp",
      `${SB}.evil.com/storage/v1/object/public/platos/a.webp`,
      `${SB}/storage/v1/object/public/instagram/tmp/a.webp`,
      `${SB}/storage/v1/object/public/platos/%2e%2e/instagram/a.webp`,
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      const { f, llamadas } = conCarta(filaPlato({ imagen_url }));
      const r = await manejarDrive(pedir({ accion: "preparar", origen: "carta", marca: "casa-tomas", platoId: PLATO }), { env: ENV_SB, fetch: f, ...deps });
      expect(r.status, imagen_url).toBe(400);
      expect(llamadas.some((l) => !l.url.startsWith(SB) || l.url.includes("/object/public/") || l.url.includes("/object/instagram/")), imagen_url).toBe(false);
    }
  });

  it("plato de otra marca, inactivo o inexistente → 404; id o marca raros → 400; tipo no imagen → 422", async () => {
    const pedirCarta = (cuerpo: Record<string, unknown>, fila: Record<string, unknown> | null, tipo?: string) => {
      const { f } = conCarta(fila, { tipo });
      return manejarDrive(pedir({ accion: "preparar", origen: "carta", marca: "casa-tomas", platoId: PLATO, ...cuerpo }), { env: ENV_SB, fetch: f, ...deps }).then((r) => r.status);
    };
    expect(await pedirCarta({}, filaPlato({ restaurante: false, touza: true }))).toBe(404);
    expect(await pedirCarta({ marca: "touza" }, filaPlato())).toBe(404);
    expect(await pedirCarta({}, filaPlato({ activado: false }))).toBe(404);
    expect(await pedirCarta({}, null)).toBe(404);
    expect(await pedirCarta({ platoId: "a&select=*" }, filaPlato())).toBe(400);
    expect(await pedirCarta({ marca: "otra" }, filaPlato())).toBe(400);
    expect(await pedirCarta({}, filaPlato(), "image/svg+xml")).toBe(422);
  });
});

describe("instagram-drive · preparar la foto de un vino de la carta (origen «vino»)", () => {
  const VINO = "8ae1eafd-7999-4180-93dc-362364091af0";
  const URL_VINO = `${SB}/storage/v1/object/public/vinos/combe-carta.webp`;
  const WEBP = (() => {
    const b = new Uint8Array(40);
    b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    b.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
    b[16] = 10;
    b.set([0x37, 0x04, 0, 0x9f, 0x05, 0], 24); // 1080×1440
    return b;
  })();

  function conVinos(fila: Record<string, unknown> | null) {
    const base = falso({ listado: [] });
    const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
      const url = String(entrada);
      if (url.startsWith(`${SB}/rest/v1/Vinos?`)) {
        base.llamadas.push({ url, metodo: "GET", cabeceras: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()), cuerpo: null, bruto: null } as never);
        return new Response(JSON.stringify(fila ? [fila] : []), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.startsWith(`${SB}/storage/v1/object/public/vinos/`)) {
        base.llamadas.push({ url, metodo: "GET", cabeceras: {}, cuerpo: null, bruto: init } as never);
        return new Response(WEBP as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "image/webp" } });
      }
      return base.f(entrada, init);
    });
    return { f, llamadas: base.llamadas };
  }
  const filaVino = (o: Record<string, unknown> = {}) => ({ id: VINO, imagen_url: URL_VINO, activado: true, restaurante: true, touza: false, ...o });
  const pedirVino = (cuerpo: Record<string, unknown> = {}) =>
    pedir({ accion: "preparar", origen: "vino", marca: "casa-tomas", vinoId: VINO, ...cuerpo });

  it("válido: lee el vino con el JWT, copia su foto del bucket «vinos» a tmp/ y devuelve URL y medidas", async () => {
    const { f, llamadas } = conVinos(filaVino());
    const r = await manejarDrive(pedirVino(), { env: ENV_SB, fetch: f, ...deps });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ruta: `tmp/${UUID}.webp`, url: `${SB}/storage/v1/object/public/instagram/tmp/${UUID}.webp`, ancho: 1080, alto: 1440 });
    const lectura = llamadas.find((l) => l.url.startsWith(`${SB}/rest/v1/Vinos?`))!;
    expect(lectura.url).toContain(`id=eq.${VINO}`);
    expect(lectura.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    expect(llamadas.find((l) => l.url.startsWith(`${SB}/storage/v1/object/public/vinos/`))!.url).toBe(URL_VINO);
  });

  it("foto fuera del bucket «vinos» → 400; vino de otra marca o inactivo → 404; id raro → 400", async () => {
    for (const imagen_url of [`${SB}/storage/v1/object/public/platos/a.webp`, "https://evil.example.com/storage/v1/object/public/vinos/a.webp"]) {
      const { f, llamadas } = conVinos(filaVino({ imagen_url }));
      expect((await manejarDrive(pedirVino(), { env: ENV_SB, fetch: f, ...deps })).status, imagen_url).toBe(400);
      expect(llamadas.some((l) => l.url.includes("/object/public/"))).toBe(false);
    }
    expect((await manejarDrive(pedirVino(), { env: ENV_SB, fetch: conVinos(filaVino({ restaurante: false })).f, ...deps })).status).toBe(404);
    expect((await manejarDrive(pedirVino(), { env: ENV_SB, fetch: conVinos(filaVino({ activado: false })).f, ...deps })).status).toBe(404);
    expect((await manejarDrive(pedirVino({ vinoId: "a&select=*" }), { env: ENV_SB, fetch: conVinos(filaVino()).f, ...deps })).status).toBe(400);
  });
});
