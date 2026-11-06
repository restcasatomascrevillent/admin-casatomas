// @vitest-environment node
/**
 * Cliente de Google Drive de las Edge Functions (_shared/google-drive.ts) con
 * fetch falso: token con secretos limpios (trim) y en memoria, alcance,
 * carpetas que se crean solo si faltan, listado, subida multipart, descarga,
 * miniaturas solo de googleusercontent.com y medidas de un JPEG. Sin red.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALCANCE_DRIVE_FILE,
  ClienteDrive,
  ErrorDrive,
  esIdDrive,
  limpiarConfigGoogle,
  medidasJpeg,
  olvidarTokenDrive,
  urlMiniatura,
} from "../google-drive.ts";
import { driveFalso, jpegDe, RAIZ_DRIVE, REFRESH_GOOGLE, SECRETO_GOOGLE, TOKEN_GOOGLE, type Llamada } from "../instagram/__tests__/simulacion.ts";

const CONFIG = { clientId: " 123-abc.apps.googleusercontent.com\n", clientSecret: `${SECRETO_GOOGLE}\n`, refreshToken: ` ${REFRESH_GOOGLE}` };

/** fetch que solo sabe hablar con el Drive simulado. */
function conDrive(d = driveFalso()) {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const l: Llamada = {
      url: String(entrada),
      metodo: (init.method ?? "GET").toUpperCase(),
      cabeceras: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()),
      cuerpo: typeof init.body === "string" ? init.body : null,
      bruto: init.body,
    };
    llamadas.push(l);
    const r = await d.m(l);
    if (!r) throw new Error(`URL inesperada: ${l.metodo} ${l.url}`);
    return r;
  }) as typeof fetch;
  return { d, f, llamadas };
}

beforeEach(() => olvidarTokenDrive());

describe("token", () => {
  it("limpia los secretos (salto de línea de fb30bd56), da el alcance y reutiliza el token hasta que caduca", async () => {
    const { d, f } = conDrive(driveFalso({ alcance: ALCANCE_DRIVE_FILE }));
    let t = 1_000_000;
    const c = new ClienteDrive({ config: CONFIG, fetch: f, ahora: () => t });
    expect(await c.token()).toEqual({ token: TOKEN_GOOGLE, alcances: [ALCANCE_DRIVE_FILE] });
    const cuerpo = new URLSearchParams(String(d.peticionesToken[0].bruto));
    expect(cuerpo.get("client_id")).toBe("123-abc.apps.googleusercontent.com");
    expect(cuerpo.get("client_secret")).toBe(SECRETO_GOOGLE);
    expect(cuerpo.get("refresh_token")).toBe(REFRESH_GOOGLE);
    expect(cuerpo.get("grant_type")).toBe("refresh_token");
    await c.token();
    expect(d.peticionesToken).toHaveLength(1);
    t += 3600 * 1000;
    await c.token();
    expect(d.peticionesToken).toHaveLength(2);
  });

  it("sin secretos: ErrorDrive «sin_config» sin llamar a Google; token rechazado: «token» sin el secreto en el mensaje", async () => {
    const { f, llamadas } = conDrive(driveFalso({ tokenFalla: true }));
    await expect(new ClienteDrive({ config: { clientId: "x" }, fetch: f }).token()).rejects.toMatchObject({ motivo: "sin_config" });
    expect(llamadas).toHaveLength(0);
    const e = (await new ClienteDrive({ config: CONFIG, fetch: f }).token().catch((x) => x)) as ErrorDrive;
    expect(e).toBeInstanceOf(ErrorDrive);
    expect(e.motivo).toBe("token");
    expect(e.message).toMatch(/invalid_client/);
    expect(e.message).not.toContain(SECRETO_GOOGLE);
    expect(e.message).not.toContain(REFRESH_GOOGLE);
  });

  it("registra los secretos y el token para taparlos", async () => {
    const vistos: string[] = [];
    const { f } = conDrive();
    await new ClienteDrive({ config: CONFIG, fetch: f, registrarSecreto: (v) => vistos.push(v) }).token();
    expect(vistos).toEqual(expect.arrayContaining([SECRETO_GOOGLE, REFRESH_GOOGLE, TOKEN_GOOGLE]));
  });
});

describe("carpetas, ficheros y miniaturas", () => {
  it("asegurarRuta crea solo lo que falta y reutiliza lo que hay", async () => {
    const { d, f, llamadas } = conDrive();
    const c = new ClienteDrive({ config: CONFIG, fetch: f });
    const id = await c.asegurarRuta(RAIZ_DRIVE, ["instagram", "fotos", "touza"]);
    const creadas = llamadas.filter((l) => l.metodo === "POST" && l.url.startsWith("https://www.googleapis.com/drive/v3/files"));
    expect(creadas.map((l) => JSON.parse(l.cuerpo!).name)).toEqual(["instagram", "fotos", "touza"]);
    expect(d.ficheros.get(id)?.name).toBe("touza");
    llamadas.length = 0;
    expect(await c.asegurarRuta(RAIZ_DRIVE, ["instagram", "fotos", "touza"])).toBe(id);
    expect(llamadas.some((l) => l.metodo === "POST")).toBe(false);
    // Cada búsqueda lleva el token de Google, no otro.
    expect(llamadas.every((l) => l.cabeceras.authorization === `Bearer ${TOKEN_GOOGLE}`)).toBe(true);
  });

  it("buscarCarpeta escapa las comillas del nombre y rechaza ids de carpeta raros", async () => {
    const { f, llamadas } = conDrive();
    const c = new ClienteDrive({ config: CONFIG, fetch: f });
    await c.buscarCarpeta("L'Arxiu", RAIZ_DRIVE);
    expect(new URL(llamadas.at(-1)!.url).searchParams.get("q")).toContain("name='L\\'Arxiu'");
    await expect(c.buscarCarpeta("x", "abc' or '1'='1")).rejects.toBeInstanceOf(ErrorDrive);
  });

  it("sube en multipart (metadatos + bytes) y la descarga devuelve los bytes", async () => {
    const { d, f, llamadas } = conDrive();
    const c = new ClienteDrive({ config: CONFIG, fetch: f });
    const bytes = jpegDe(1080, 1350);
    const subido = await c.subir(RAIZ_DRIVE, "foto.jpg", "image/jpeg", bytes, "Descripción");
    const l = llamadas.find((x) => x.url.startsWith("https://www.googleapis.com/upload/"))!;
    expect(l.cabeceras["content-type"]).toMatch(/^multipart\/related; boundary=/);
    expect(d.subidas[0].meta).toMatchObject({ name: "foto.jpg", parents: [RAIZ_DRIVE], description: "Descripción" });
    d.ficheros.get(subido.id)!.bytes = bytes;
    expect((await c.descargar(subido.id)).bytes).toEqual(bytes);
  });

  it("metadatos: null si no existe (404) o si el id no es válido", async () => {
    const { f } = conDrive();
    const c = new ClienteDrive({ config: CONFIG, fetch: f });
    expect(await c.metadatos("1NoExiste000000000000000")).toBeNull();
    expect(await c.metadatos("../../etc")).toBeNull();
    expect((await c.metadatos(RAIZ_DRIVE))?.name).toBe("marketing");
  });

  it("listarImagenes pide solo imágenes de la carpeta, sin papelera", async () => {
    const d = driveFalso();
    const carpeta = d.ponerFoto("casa-tomas", { id: "1FotoA0000000000000000001" });
    d.ponerFoto("casa-tomas", { id: "1FotoB0000000000000000002", trashed: true });
    const { f, llamadas } = conDrive(d);
    const c = new ClienteDrive({ config: CONFIG, fetch: f });
    expect((await c.listarImagenes(carpeta)).map((x) => x.id)).toEqual(["1FotoA0000000000000000001"]);
    const q = new URL(llamadas.at(-1)!.url).searchParams.get("q");
    expect(q).toBe(`'${carpeta}' in parents and trashed=false and mimeType contains 'image/'`);
  });

  it("urlMiniatura: solo https de *.googleusercontent.com, con el tamaño pedido", () => {
    expect(urlMiniatura("https://lh3.googleusercontent.com/drive-storage/abc=s220", 400)).toBe("https://lh3.googleusercontent.com/drive-storage/abc=s400");
    expect(urlMiniatura("https://evil.example.com/abc=s220")).toBeNull();
    expect(urlMiniatura("https://googleusercontent.com.evil.com/x")).toBeNull();
    expect(urlMiniatura("http://lh3.googleusercontent.com/x")).toBeNull();
    expect(urlMiniatura("https://user:pw@lh3.googleusercontent.com/x")).toBeNull();
    expect(urlMiniatura(undefined)).toBeNull();
  });
});

describe("utilidades", () => {
  it("medidasJpeg lee el SOF; null si no es JPEG", () => {
    expect(medidasJpeg(jpegDe(1708, 2560))).toEqual({ ancho: 1708, alto: 2560 });
    expect(medidasJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(medidasJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
  });

  it("esIdDrive y limpiarConfigGoogle", () => {
    expect(esIdDrive("1AbC_d-EfGhIjKlMn")).toBe(true);
    expect(esIdDrive("abc' or 1=1")).toBe(false);
    expect(esIdDrive("corto")).toBe(false);
    expect(limpiarConfigGoogle({ clientId: " a\n", clientSecret: "b\r\n" })).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "" });
  });
});
