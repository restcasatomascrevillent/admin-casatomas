// subir-original-drive: autenticación, idempotencia (no duplica en Drive) y
// error de Drive. Google Drive simulado con fetch en memoria.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _olvidarTokenDrive } from "../procesar-factura/archivo.ts";
import { crearManejador } from "./manejador.ts";

const DRIVE = { clientId: "id", clientSecret: "s", refreshToken: "r", parentFolder: "raiz" };
const PDF_B64 = btoa("%PDF-1.4\n%prueba\n");

// ─── Drive simulado: carpetas por nombre, ficheros por carpeta ──────────────
let driveCaido = false;
let ficheros: { id: string; name: string; parent: string }[] = [];
let subidas = 0;
function fetchDrive(url: string, init?: RequestInit): Promise<Response> {
  const json = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status }));
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "tk", expires_in: 3600 });
  if (driveCaido) return json({ error: "backendError" }, 500);
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) {
    const q = decodeURIComponent(url);
    const nombre = /name='((?:\\'|[^'])*)'/.exec(q)?.[1]?.replace(/\\'/g, "'") ?? "";
    if (q.includes("mimeType='application/vnd.google-apps.folder'")) return json({ files: [{ id: `carpeta:${nombre}` }] });
    const padre = /'([^']+)' in parents/.exec(q)?.[1];
    return json({
      files: ficheros.filter((f) => f.name === nombre && f.parent === padre).map((f) => ({ id: f.id, webViewLink: `https://drive.google.com/file/d/${f.id}/view` })),
    });
  }
  if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
    subidas++;
    const cuerpo = new TextDecoder().decode(init?.body as Uint8Array);
    const meta = JSON.parse(/\{"name".*?\]\}/.exec(cuerpo)![0]);
    const id = `f${ficheros.length + 1}`;
    ficheros.push({ id, name: meta.name, parent: meta.parents[0] });
    return json({ id, webViewLink: `https://drive.google.com/file/d/${id}/view` });
  }
  return json({ error: `no simulado: ${url}` }, 404);
}

const peticion = (cuerpo: unknown, token: string | null = "secreto") =>
  new Request("http://localhost/subir-original-drive", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token === null ? {} : { "x-subida-token": token }) },
    body: JSON.stringify(cuerpo),
  });

const CUERPO = { pdf_b64: PDF_B64, nombre_pdf: "2025-03-14 A-1 (R1).pdf", fecha: "2025-03-14", proveedor: "CETAREA ANGELMAR S.L." };

beforeEach(() => {
  _olvidarTokenDrive();
  driveCaido = false;
  ficheros = [];
  subidas = 0;
  vi.stubGlobal("fetch", vi.fn(fetchDrive));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("subir-original-drive", () => {
  it("sin el secreto SUBIDA_DRIVE_TOKEN responde 503 (falla cerrado)", async () => {
    const r = await crearManejador({ token: undefined, drive: DRIVE })(peticion(CUERPO));
    expect(r.status).toBe(503);
    expect(subidas).toBe(0);
  });

  it("sin cabecera o con token incorrecto responde 401", async () => {
    const h = crearManejador({ token: "secreto", drive: DRIVE });
    expect((await h(peticion(CUERPO, null))).status).toBe(401);
    expect((await h(peticion(CUERPO, "secretx"))).status).toBe(401);
    expect(subidas).toBe(0);
  });

  it("sube a proveedor › mes y devuelve el enlace", async () => {
    const r = await crearManejador({ token: "secreto", drive: DRIVE })(peticion(CUERPO));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, drive_url: "https://drive.google.com/file/d/f1/view", ya_estaba: false });
    expect(ficheros[0]).toMatchObject({ name: CUERPO.nombre_pdf, parent: "carpeta:2025-03 Marzo" });
  });

  it("idempotente: si ya está en esa carpeta devuelve su enlace sin volver a subir", async () => {
    const h = crearManejador({ token: "secreto", drive: DRIVE });
    await h(peticion(CUERPO));
    _olvidarTokenDrive(); // otra instancia: sin cachés
    const r2 = await h(peticion(CUERPO));
    expect(await r2.json()).toEqual({ ok: true, drive_url: "https://drive.google.com/file/d/f1/view", ya_estaba: true });
    expect(subidas).toBe(1);
  });

  it("si Drive falla responde 502 con el error", async () => {
    driveCaido = true;
    const r = await crearManejador({ token: "secreto", drive: DRIVE })(peticion(CUERPO));
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/500/);
  });

  it("rechaza lo que no es un PDF", async () => {
    const r = await crearManejador({ token: "secreto", drive: DRIVE })(peticion({ ...CUERPO, pdf_b64: btoa("hola") }));
    expect(r.status).toBe(400);
  });
});
