// informes-mensuales: autenticación, validación, carpeta del mes y que volver a subir no duplica.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { carpetaDelMes, crearManejador, nombreValido, rutaInformes, type ConfigInformesDrive } from "../manejador.ts";

const PDF_B64 = btoa("%PDF-1.4\n%prueba\n");
const PADRE = "carpetaPadre_123456";

let ficheros: { id: string; name: string; parent: string }[];
let rutas: { raiz: string; tramos: readonly string[] }[];
const drive = {
  configurado: true,
  asegurarRuta: vi.fn(async (raiz: string, tramos: readonly string[]) => {
    rutas.push({ raiz, tramos });
    return `carpeta_${tramos.join("_").replace(/[^A-Za-z0-9_-]/g, "")}`;
  }),
  buscarEnCarpeta: vi.fn(async (carpeta: string, texto: string) => ficheros.filter((f) => f.parent === carpeta && f.name.includes(texto)).map((f) => ({ ...f, mimeType: "application/pdf" }))),
  subir: vi.fn(async (carpeta: string, nombre: string) => {
    const f = { id: `fichero_${ficheros.length + 1}_abcdef`, name: nombre, parent: carpeta };
    ficheros.push(f);
    return { ...f, mimeType: "application/pdf" };
  }),
  reemplazar: vi.fn(async (id: string, nombre: string) => ({ id, name: nombre, mimeType: "application/pdf" })),
};

const autorizado = async () => ({ ok: true as const, userId: "u1", email: null });
const cfg = (o: Partial<ConfigInformesDrive> = {}): ConfigInformesDrive =>
  ({ autorizar: autorizado, drive, carpetaPadre: PADRE, produccion: true, ...o }) as ConfigInformesDrive;
const peticion = (cuerpo: unknown) =>
  new Request("http://localhost/informes-mensuales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
const CUERPO = { accion: "subir", mes: "2026-11", nombre: "Informe-trafico-web-2026-11.pdf", pdf_b64: PDF_B64 };

beforeEach(() => {
  ficheros = [];
  rutas = [];
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("informes-mensuales · reglas", () => {
  it("carpeta del mes como las de las facturas", () => {
    expect(carpetaDelMes("2026-11")).toBe("2026-11 Noviembre");
    expect(carpetaDelMes("2026-01")).toBe("2026-01 Enero");
    expect(carpetaDelMes("2026-13")).toBeNull();
    expect(carpetaDelMes("../x")).toBeNull();
  });
  it("nombres de PDF sin rutas", () => {
    expect(nombreValido("Recibo-R-2026-004.pdf")).toBe(true);
    expect(nombreValido("Informe de cheques regalo (2026-11).pdf")).toBe(true);
    expect(nombreValido("../secreto.pdf")).toBe(false);
    expect(nombreValido("a/b.pdf")).toBe(false);
    expect(nombreValido("informe.exe")).toBe(false);
  });
  it("ruta: carpeta propia si existe; si no, «Informes mensuales» (o «(demo)») dentro de la de facturas", () => {
    expect(rutaInformes({ carpetaInformes: "propia_1234567", carpetaPadre: PADRE, produccion: true }, "2026-11")).toEqual({ raiz: "propia_1234567", tramos: ["2026-11 Noviembre"] });
    expect(rutaInformes({ carpetaPadre: PADRE, produccion: true }, "2026-11")).toEqual({ raiz: PADRE, tramos: ["Informes mensuales", "2026-11 Noviembre"] });
    expect(rutaInformes({ carpetaPadre: PADRE, produccion: false }, "2026-11")?.tramos[0]).toBe("Informes mensuales (demo)");
    expect(rutaInformes({ produccion: true }, "2026-11")).toBeNull();
  });
});

describe("informes-mensuales · manejador", () => {
  it("sin super admin responde lo que diga la autorización y no toca Drive", async () => {
    const r = await crearManejador(cfg({ autorizar: async () => ({ ok: false, status: 403, response: new Response("no", { status: 403 }) }) }))(peticion(CUERPO));
    expect(r.status).toBe(403);
    expect(drive.subir).not.toHaveBeenCalled();
  });

  it("valida acción, mes, nombre y que sea un PDF", async () => {
    const h = crearManejador(cfg());
    expect((await h(peticion({ ...CUERPO, accion: "borrar" }))).status).toBe(400);
    expect((await h(peticion({ ...CUERPO, mes: "noviembre" }))).status).toBe(400);
    expect((await h(peticion({ ...CUERPO, nombre: "../x.pdf" }))).status).toBe(400);
    expect((await h(peticion({ ...CUERPO, pdf_b64: btoa("<html>") }))).status).toBe(400);
    expect(drive.subir).not.toHaveBeenCalled();
  });

  it("sin Drive configurado: 503", async () => {
    expect((await crearManejador(cfg({ drive: { ...drive, configurado: false } }))(peticion(CUERPO))).status).toBe(503);
    expect((await crearManejador(cfg({ carpetaPadre: "" }))(peticion(CUERPO))).status).toBe(503);
  });

  it("sube a la carpeta del mes y, la segunda vez, cambia el mismo fichero (mismo enlace)", async () => {
    const h = crearManejador(cfg());
    const r1 = await (await h(peticion(CUERPO))).json();
    expect(r1).toMatchObject({ ok: true, reemplazado: false, url: `https://drive.google.com/file/d/${r1.id}/view` });
    expect(r1.carpeta_url).toBe(`https://drive.google.com/drive/folders/${r1.carpeta_id}`);
    expect(rutas[0]).toEqual({ raiz: PADRE, tramos: ["Informes mensuales", "2026-11 Noviembre"] });
    const r2 = await (await h(peticion(CUERPO))).json();
    expect(r2).toMatchObject({ ok: true, reemplazado: true, id: r1.id });
    expect(drive.subir).toHaveBeenCalledTimes(1);
    expect(drive.reemplazar).toHaveBeenCalledTimes(1);
  });

  it("un fallo de Drive se devuelve como 502 con el motivo", async () => {
    const h = crearManejador(cfg({ drive: { ...drive, asegurarRuta: vi.fn(async () => Promise.reject(new Error("Google Drive respondió 403"))) } }));
    const r = await h(peticion(CUERPO));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/403/);
  });
});
