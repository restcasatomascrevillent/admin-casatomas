import { beforeEach, describe, expect, it, vi } from "vitest";

const { upload, getPublicUrl, from } = vi.hoisted(() => {
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  const from = vi.fn(() => ({ upload, getPublicUrl }));
  return { upload, getPublicUrl, from };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from } } }));

import {
  ACCEPT_FOTO_MENU,
  BUCKET_FOTOS_MENU,
  rutaFotoMenu,
  subirFotoMenu,
} from "@/lib/foto-menu-dia";

const FIRMAS: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
};

/** Archivo con la firma real del tipo (validarFoto mira los primeros bytes). */
const archivo = (tipo: string, bytes = 16, nombre = "FOTO.JPEG") => {
  const datos = new Uint8Array(Math.max(bytes, 16));
  datos.set(FIRMAS[tipo] ?? []);
  return new File([datos], nombre, { type: tipo });
};

beforeEach(() => {
  upload.mockReset();
  getPublicUrl.mockReset();
  from.mockClear();
});

it("el accept del input solo ofrece JPG, PNG y WebP", () => {
  expect(ACCEPT_FOTO_MENU).toBe("image/jpeg,image/png,image/webp");
});

describe("rutaFotoMenu", () => {
  it("va a la carpeta menu-dia con extensión sacada del tipo, no del nombre", () => {
    expect(rutaFotoMenu(archivo("image/jpeg"), 1700000000000, 0.5)).toBe("menu-dia/1700000000000-i.jpg");
    expect(rutaFotoMenu(archivo("image/webp", 10, "sin-extension"), 1, 0.25)).toBe("menu-dia/1-9.webp");
  });

  it("no repite ruta entre dos subidas", () => {
    expect(rutaFotoMenu(archivo("image/png"))).not.toBe(rutaFotoMenu(archivo("image/png")));
  });
});

describe("subirFotoMenu", () => {
  it("sube al bucket novedades y devuelve la URL pública", async () => {
    upload.mockResolvedValue({ error: null });
    getPublicUrl.mockImplementation((ruta: string) => ({ data: { publicUrl: `https://x/${ruta}` } }));
    const file = archivo("image/png");

    const url = await subirFotoMenu(file);

    expect(BUCKET_FOTOS_MENU).toBe("novedades");
    expect(from).toHaveBeenCalledWith("novedades");
    const [ruta, enviado, opciones] = upload.mock.calls[0];
    expect(ruta).toMatch(/^menu-dia\/\d+-[a-z0-9]+\.png$/);
    expect(enviado).toBe(file);
    expect(opciones).toEqual({ contentType: "image/png" });
    expect(url).toBe(`https://x/${ruta}`);
  });

  it("usa el tipo real del archivo, no el que dice el navegador", async () => {
    upload.mockResolvedValue({ error: null });
    getPublicUrl.mockImplementation((ruta: string) => ({ data: { publicUrl: `https://x/${ruta}` } }));
    const pngDisfrazado = new File([new Uint8Array([...FIRMAS["image/png"], 0, 0, 0, 0])], "foto.jpg", { type: "image/jpeg" });
    await subirFotoMenu(pngDisfrazado);
    const [ruta, , opciones] = upload.mock.calls[0];
    expect(ruta).toMatch(/\.png$/);
    expect(opciones).toEqual({ contentType: "image/png" });
  });

  it("no sube lo que no es una foto aunque diga image/jpeg", async () => {
    const texto = new File(["esto es texto"], "foto.jpg", { type: "image/jpeg" });
    await expect(subirFotoMenu(texto)).rejects.toThrow(/JPG, PNG o WebP/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("propaga el error de Storage", async () => {
    upload.mockResolvedValue({ error: new Error("new row violates row-level security policy") });
    await expect(subirFotoMenu(archivo("image/jpeg"))).rejects.toThrow(/row-level security/);
    expect(getPublicUrl).not.toHaveBeenCalled();
  });
});
