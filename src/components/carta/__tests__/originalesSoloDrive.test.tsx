/**
 * «En Supabase no quiero guardar más que el sticker» (dueño, 08/11/2026).
 *
 *   - La subida de platos y vinos ya no escribe el original en el bucket.
 *   - «Cambiar fondo» lee el original de Google Drive (descargar_original);
 *     si no hay, el antiguo del bucket; si tampoco, el sticker, avisando.
 *   - Un original que ya vino de Drive no se vuelve a subir al guardar.
 *   - Vídeos: el original va a Drive; el bruto de pendientes/ se borra siempre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  upload: vi.fn(async (..._a: unknown[]) => ({ error: null })),
  remove: vi.fn(async (..._a: unknown[]) => ({ error: null })),
  download: vi.fn(async (..._a: unknown[]) => ({ data: new Blob(["bruto"], { type: "video/mp4" }), error: null })),
  list: vi.fn(async (..._a: unknown[]) => ({ data: [] as Array<{ name: string }>, error: null })),
  descargarOriginalCarta: vi.fn(),
  comprobarOriginalCarta: vi.fn(),
  subirOriginalVideoCarta: vi.fn(),
  subirOriginalCarta: vi.fn(),
  guardarOriginalCarta: vi.fn(async (..._a: unknown[]) => true),
}));
vi.mock("sonner", () => ({ toast: { warning: m.warning, error: m.error, success: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (...a: unknown[]) => m.upload(bucket, ...a),
        remove: (...a: unknown[]) => m.remove(bucket, ...a),
        download: (...a: unknown[]) => m.download(bucket, ...a),
        list: (...a: unknown[]) => m.list(bucket, ...a),
        getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${ruta}` } }),
      }),
    },
  },
}));
vi.mock("../originalCarta", async (original) => ({ ...(await original<typeof import("../originalCarta")>()), guardarOriginalCarta: m.guardarOriginalCarta }));
vi.mock("@/lib/validarFoto", async (original) => ({ ...(await original<typeof import("@/lib/validarFoto")>()), exigirFotoValida: vi.fn(async () => "image/jpeg") }));
vi.mock("@/components/marketing/instagram/api", () => ({
  descargarOriginalCarta: m.descargarOriginalCarta,
  comprobarOriginalCarta: m.comprobarOriginalCarta,
  subirOriginalVideoCarta: m.subirOriginalVideoCarta,
  subirOriginalCarta: m.subirOriginalCarta,
}));

import { subirFotoCarta } from "../subirFotoCarta";
import { BotonCambiarFondo } from "../recorte/BotonCambiarFondo";
import { trasGuardarFotoCarta } from "../recorte/avisoGuardadoSinFondo";
import { esOriginalDeDrive, marcarOriginalDeDrive, obtenerOriginalFoto } from "../originalDrive";
import { buscarOriginalVideo, conservarBrutoComoOriginal, descargarOriginalVideo, guardarOriginalVideo } from "../video/subirVideoPlato";
import type { FotoCarta } from "../recorte/useRecorteVino";

const ID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const URL_STICKER = `https://x.supabase.co/storage/v1/object/public/platos/${ID}-carta-jpg.webp?t=1`;
const foto = (nombre = "camara.jpg") => new File(["original-de-camara"], nombre, { type: "image/jpeg" });
const sticker = () => new File(["sticker"], "carta.webp", { type: "image/webp" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("subirFotoCarta: en Supabase solo el sticker", () => {
  it.each(["platos", "vinos"])("%s con fondo de carta: solo sube <id>-carta-<ext>.webp (el original va a Drive)", async (bucket) => {
    const r = await subirFotoCarta(bucket, ID, { original: foto(), compuesta: sticker() });
    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(m.upload.mock.calls[0][0]).toBe(bucket);
    expect(m.upload.mock.calls[0][1]).toBe(`${ID}-carta-jpg.webp`);
    expect(m.upload.mock.calls.some((c) => c[1] === `${ID}.jpg`)).toBe(false);
    expect(r.rutas).toEqual([`${ID}-carta-jpg.webp`]);
    expect(r.rutaPrincipal).toBe(`${ID}-carta-jpg.webp`);
    expect(r.url).toContain(`/public/${bucket}/${ID}-carta-jpg.webp?t=`);
  });

  it("«Usar foto original» (sin sticker): <id>.<ext> ES la foto de la web y se sube", async () => {
    const r = await subirFotoCarta("platos", ID, { original: foto("x.png"), compuesta: null });
    expect(m.upload.mock.calls.map((c) => c[1])).toEqual([`${ID}.png`]);
    expect(r.rutaPrincipal).toBe(`${ID}.png`);
  });

  it("bebidas y cócteles (aún sin original en Drive): siguen subiendo original + sticker", async () => {
    await subirFotoCarta("bebidas", ID, { original: foto(), compuesta: sticker() });
    expect(m.upload.mock.calls.map((c) => c[1])).toEqual([`${ID}.jpg`, `${ID}-carta-jpg.webp`]);
  });
});

function recorteSimulado(parcial: Partial<FotoCarta> = {}): FotoCarta {
  return { original: null, estado: { fase: "nada" }, iniciar: vi.fn(), setEleccion: vi.fn(), ...parcial } as unknown as FotoCarta;
}

describe("Cambiar fondo con el original de Drive", () => {
  it("pide el original a Drive (tabla e id) y recorta ESE, marcado como de Drive", async () => {
    const jpeg = new Blob(["jpeg-4000"], { type: "image/jpeg" });
    m.descargarOriginalCarta.mockResolvedValue(jpeg);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const recorte = recorteSimulado();
    render(<BotonCambiarFondo recorte={recorte} url={URL_STICKER} tabla="Platos" id={ID} />);
    fireEvent.click(screen.getByRole("button", { name: /Cambiar fondo/ }));
    await waitFor(() => expect(recorte.iniciar).toHaveBeenCalledTimes(1));
    expect(m.descargarOriginalCarta).toHaveBeenCalledWith({ tabla: "Platos", id: ID });
    const archivo = (recorte.iniciar as ReturnType<typeof vi.fn>).mock.calls[0][0] as File;
    expect(await archivo.text()).toBe("jpeg-4000");
    expect(esOriginalDeDrive(archivo)).toBe(true);
    // Ni el bucket ni el sticker: nada de fetch.
    expect(f).not.toHaveBeenCalled();
    expect(m.warning).not.toHaveBeenCalled();
  });

  it("sin original en Drive ni en el bucket: usa el sticker de la web y lo avisa", async () => {
    m.descargarOriginalCarta.mockResolvedValue(null);
    const pedidas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        pedidas.push(u);
        return u.includes("-carta-") ? { ok: true, blob: async () => new Blob(["sticker"], { type: "image/webp" }) } : { ok: false };
      }),
    );
    const recorte = recorteSimulado();
    render(<BotonCambiarFondo recorte={recorte} url={URL_STICKER} tabla="Platos" id={ID} />);
    fireEvent.click(screen.getByRole("button", { name: /Cambiar fondo/ }));
    await waitFor(() => expect(recorte.iniciar).toHaveBeenCalledTimes(1));
    // Primero el original antiguo del bucket (no existe), luego el sticker.
    expect(pedidas[0]).toBe(`https://x.supabase.co/storage/v1/object/public/platos/${ID}.jpg`);
    expect(await ((recorte.iniciar as ReturnType<typeof vi.fn>).mock.calls[0][0] as File).text()).toBe("sticker");
    expect(m.warning).toHaveBeenCalledWith(expect.stringMatching(/No hay original guardado/), expect.anything());
  });

  it("si Drive falla, prueba el original antiguo del bucket (transición) sin bloquear", async () => {
    m.descargarOriginalCarta.mockRejectedValue(new Error("Google Drive: sin conexión"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["antiguo"], { type: "image/jpeg" }) })));
    const r = await obtenerOriginalFoto("Platos", ID, URL_STICKER);
    expect(r.original?.origen).toBe("bucket");
    expect(r.errorDrive).toMatch(/sin conexión/);
    expect(esOriginalDeDrive(r.original?.archivo)).toBe(false);
  });

  it("un original de Drive de más de 5 MB se reduce para que quepa en la carta (y sigue marcado)", async () => {
    m.descargarOriginalCarta.mockResolvedValue(new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" }));
    const reducir = vi.fn(async () => new Blob(["pequena"], { type: "image/jpeg" }));
    const r = await obtenerOriginalFoto("Vinos", "v-1", null, { reducir });
    expect(reducir).toHaveBeenCalledTimes(1);
    expect(r.original?.archivo.size).toBe(7);
    expect(esOriginalDeDrive(r.original?.archivo)).toBe(true);
  });

  it("bebidas: no hay Drive, solo el bucket", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await obtenerOriginalFoto("Bebidas", ID, `https://x.supabase.co/storage/v1/object/public/bebidas/${ID}-carta-jpg.webp`);
    expect(m.descargarOriginalCarta).not.toHaveBeenCalled();
  });
});

describe("trasGuardarFotoCarta", () => {
  const base = { estado: { fase: "listo" }, tema: "crema", eleccion: "carta" } as unknown as Pick<FotoCarta, "estado" | "original" | "tema" | "eleccion">;

  it("una foto nueva: su original va a Drive", () => {
    const f = foto();
    trasGuardarFotoCarta({ ...base, original: f }, { tabla: "Platos", id: ID });
    expect(m.guardarOriginalCarta).toHaveBeenCalledWith("Platos", ID, f);
  });

  it("un original que ya salió de Drive no se vuelve a subir (no se recomprime)", () => {
    trasGuardarFotoCarta({ ...base, original: marcarOriginalDeDrive(foto()) }, { tabla: "Platos", id: ID });
    expect(m.guardarOriginalCarta).not.toHaveBeenCalled();
  });
});

describe("vídeo original en Drive", () => {
  it("guardarOriginalVideo: va a Drive, no al bucket, y quita los antiguos de videos-originales/", async () => {
    m.subirOriginalVideoCarta.mockResolvedValue({ driveId: "1x", nombre: `${ID}.mov`, bytes: 5, reemplazado: false });
    m.list.mockResolvedValueOnce({ data: [{ name: `${ID}.mp4` }], error: null });
    const ruta = await guardarOriginalVideo(ID, new File(["video"], "IMG_1.MOV", { type: "video/quicktime" }));
    expect(ruta).toBe(`drive:${ID}.mov`);
    expect(m.subirOriginalVideoCarta).toHaveBeenCalledWith(expect.objectContaining({ id: ID, nombre: `${ID}.mov` }));
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.remove).toHaveBeenCalledWith("platos", [`videos-originales/${ID}.mp4`]);
  });

  it("buscarOriginalVideo: primero Drive; si no, el antiguo del bucket", async () => {
    m.comprobarOriginalCarta.mockResolvedValueOnce({ nombre: `${ID}.webm` });
    expect(await buscarOriginalVideo(ID)).toBe(`drive:${ID}.webm`);
    m.comprobarOriginalCarta.mockResolvedValueOnce(null);
    m.list.mockResolvedValueOnce({ data: [{ name: `${ID}.mp4` }], error: null });
    expect(await buscarOriginalVideo(ID)).toBe(`videos-originales/${ID}.mp4`);
  });

  it("descargarOriginalVideo de Drive: File con la extensión (la usa la conversión)", async () => {
    m.descargarOriginalCarta.mockResolvedValue(new Blob(["v"], { type: "video/quicktime" }));
    const f = await descargarOriginalVideo(`drive:${ID}.mov`);
    expect(m.descargarOriginalCarta).toHaveBeenCalledWith({ tabla: "Platos", id: ID, tipo: "video" });
    expect(f.name).toBe(`${ID}.mov`);
    expect(m.download).not.toHaveBeenCalled();
  });

  it("conservarBrutoComoOriginal: sube el bruto a Drive y lo borra de pendientes/", async () => {
    m.subirOriginalVideoCarta.mockResolvedValue({});
    const r = await conservarBrutoComoOriginal("pendientes/abc.mp4", ID, new Blob(["v"], { type: "video/mp4" }));
    expect(r).toBe(`drive:${ID}.mp4`);
    expect(m.download).not.toHaveBeenCalled();
    expect(m.remove).toHaveBeenCalledWith("platos", ["pendientes/abc.mp4"]);
  });

  it("si Drive falla: avisa y borra el bruto igual (en Supabase solo el vídeo de la web)", async () => {
    m.subirOriginalVideoCarta.mockRejectedValue(new Error("Google Drive respondió 500"));
    const avisar = vi.fn();
    const r = await conservarBrutoComoOriginal("pendientes/abc.mp4", ID, undefined, avisar);
    expect(r).toBeNull();
    expect(avisar).toHaveBeenCalledWith(expect.stringMatching(/no se ha podido guardar en Google Drive/), expect.stringMatching(/500/));
    expect(m.remove).toHaveBeenCalledWith("platos", ["pendientes/abc.mp4"]);
  });
});
