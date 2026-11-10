/**
 * «Subir albaranes» (10/11/2026): validación de ficheros, camino de subida y estados que ve quien sube.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { claseEstado, hayLeyendo, leerMisSubidas, problemaFichero, subirAlbaran, TEXTO_ESTADO, type DepsSubida } from "@/lib/facturas/albaranes";

const fichero = (nombre: string, type: string, size = 1000) => {
  const f = new File([new Uint8Array(1)], nombre, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("problemaFichero", () => {
  it("admite fotos JPG, PNG, WebP y PDF", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) expect(problemaFichero(fichero("a", t)), t).toBeNull();
  });
  it("rechaza lo que la lectura no admite (HEIC, vídeo, documentos)", () => {
    expect(problemaFichero(fichero("a.heic", "image/heic"))).toMatch(/no es una foto/);
    expect(problemaFichero(fichero("a.mp4", "video/mp4"))).toMatch(/no es una foto/);
  });
  it("rechaza más de 10 MB y ficheros vacíos", () => {
    expect(problemaFichero(fichero("a.jpg", "image/jpeg", 11 * 1024 * 1024))).toMatch(/10 MB/);
    expect(problemaFichero(fichero("a.jpg", "image/jpeg", 0))).toMatch(/vacío/);
  });
});

describe("subirAlbaran", () => {
  const deps = (camino: "unico" | "largo"): DepsSubida => ({
    planificar: vi.fn(async () => (camino === "unico" ? { camino: "unico" } : { camino: "largo", origen: "pdf", piezas: [], paginasDocumento: 3 }) as never),
    iniciarLargo: vi.fn(async () => ({ trabajoId: "t-largo", numPiezas: 3 })),
    iniciarUnico: vi.fn(async () => ({ trabajoId: "t-unico", numPiezas: 1 })),
  });

  it("una foto normal va de una pieza", async () => {
    const d = deps("unico");
    expect(await subirAlbaran(fichero("a.jpg", "image/jpeg"), d)).toEqual({ trabajoId: "t-unico", numPiezas: 1 });
    expect(d.iniciarLargo).not.toHaveBeenCalled();
  });

  it("un PDF de varias páginas se trocea como en Cargar", async () => {
    const d = deps("largo");
    expect((await subirAlbaran(fichero("a.pdf", "application/pdf"), d)).trabajoId).toBe("t-largo");
    expect(d.iniciarUnico).not.toHaveBeenCalled();
  });

  it("un fichero no admitido no se sube", async () => {
    const d = deps("unico");
    await expect(subirAlbaran(fichero("a.heic", "image/heic"), d)).rejects.toThrow(/no es una foto/);
    expect(d.planificar).not.toHaveBeenCalled();
  });
});

describe("estados", () => {
  it("traduce los del trabajo de lectura a lo que ve quien sube", () => {
    expect(["pendiente", "pagina1", "paginas", "consolidando"].map(claseEstado)).toEqual(["leyendo", "leyendo", "leyendo", "leyendo"]);
    expect(claseEstado("completado")).toBe("recibido");
    expect(claseEstado("duplicado")).toBe("repetido");
    expect(claseEstado("fallido")).toBe("fallido");
    expect(claseEstado("cancelado")).toBe("cancelado");
    expect(TEXTO_ESTADO.repetido.etiqueta).toBe("Ya estaba subido");
  });
  it("sigue refrescando mientras haya alguno leyéndose", () => {
    expect(hayLeyendo([{ estado: "completado" }, { estado: "paginas" }])).toBe(true);
    expect(hayLeyendo([{ estado: "completado" }, { estado: "fallido" }])).toBe(false);
  });
});

describe("leerMisSubidas", () => {
  it("pide a albaranes_mis_subidas (nunca a ocr_trabajos, que lleva lo leído)", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: [{ id: "t1", nombre_original: "a.jpg", estado: "completado" }], error: null } as never);
    expect(await leerMisSubidas(10)).toEqual([{ id: "t1", nombre_original: "a.jpg", estado: "completado" }]);
    expect(supabase.rpc).toHaveBeenCalledWith("albaranes_mis_subidas", { p_limite: 10 });
  });
  it("si la BD lo rechaza, lanza", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: "Sin permiso para subir fotos de albaranes" } } as never);
    await expect(leerMisSubidas()).rejects.toThrow(/Sin permiso/);
  });
});
