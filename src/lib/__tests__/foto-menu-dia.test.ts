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
  validarFotoMenu,
} from "@/lib/foto-menu-dia";

const archivo = (tipo: string, bytes = 10, nombre = "FOTO.JPEG") =>
  new File([new Uint8Array(bytes)], nombre, { type: tipo });

beforeEach(() => {
  upload.mockReset();
  getPublicUrl.mockReset();
  from.mockClear();
});

describe("validarFotoMenu", () => {
  it("acepta JPG, PNG y WebP", () => {
    for (const tipo of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validarFotoMenu(archivo(tipo))).toBeNull();
    }
    expect(ACCEPT_FOTO_MENU).toBe("image/jpeg,image/png,image/webp");
  });

  it("rechaza lo que el navegador no pinta (HEIC) o no es imagen", () => {
    expect(validarFotoMenu(archivo("image/heic"))).toMatch(/JPG, PNG o WebP/);
    expect(validarFotoMenu(archivo("application/pdf"))).toMatch(/JPG, PNG o WebP/);
    expect(validarFotoMenu(archivo(""))).toMatch(/JPG, PNG o WebP/);
  });

  it("rechaza más de 5 MB", () => {
    expect(validarFotoMenu(archivo("image/jpeg", 5 * 1024 * 1024))).toBeNull();
    expect(validarFotoMenu(archivo("image/jpeg", 5 * 1024 * 1024 + 1))).toMatch(/máximo 5 MB/);
  });
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

  it("propaga el error de Storage", async () => {
    upload.mockResolvedValue({ error: new Error("new row violates row-level security policy") });
    await expect(subirFotoMenu(archivo("image/jpeg"))).rejects.toThrow(/row-level security/);
    expect(getPublicUrl).not.toHaveBeenCalled();
  });
});
