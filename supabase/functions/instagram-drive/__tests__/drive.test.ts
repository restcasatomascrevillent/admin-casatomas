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
