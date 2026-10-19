import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  filas: [] as { id: string; imagen_url: string | null }[],
  errorConsulta: null as null | { message: string },
  borradas: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      let excluido = "";
      const consulta = {
        select: () => consulta,
        neq: (_c: string, v: string) => { excluido = v; return consulta; },
        like: () => consulta,
        then: (ok: (v: unknown) => unknown) => Promise.resolve(mock.errorConsulta
          ? { data: null, error: mock.errorConsulta }
          : { data: mock.filas.filter((f) => f.id !== excluido), error: null }).then(ok),
      };
      return consulta;
    },
    storage: { from: (bucket: string) => ({ remove: async (rutas: string[]) => { mock.borradas.push(...rutas.map((r) => `${bucket}/${r}`)); return { error: null }; } }) },
  },
}));

import { borrarFotoSiNoSeUsa, rutaEnBucket } from "@/lib/storage-carta";

const URL = "https://x.supabase.co/storage/v1/object/public";

describe("fotos de la carta en Storage", () => {
  beforeEach(() => { mock.filas = []; mock.errorConsulta = null; mock.borradas = []; vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {}); });

  it("extrae la ruta solo de URLs del bucket indicado", () => {
    expect(rutaEnBucket(`${URL}/vinos/a%20b.webp?t=1`, "vinos")).toBe("a b.webp");
    expect(rutaEnBucket(`${URL}/platos/a.webp`, "vinos")).toBeNull();
    expect(rutaEnBucket(null, "vinos")).toBeNull();
  });

  it("no borra si otra ficha usa la misma foto, aunque con otro ?t=", async () => {
    mock.filas = [{ id: "otra", imagen_url: `${URL}/vinos/a.webp?t=99` }];
    await borrarFotoSiNoSeUsa({ tabla: "Vinos", bucket: "vinos", ruta: "a.webp", excluirId: "esta" });
    expect(mock.borradas).toEqual([]);
  });

  it("no confunde un nombre que solo contiene al otro", async () => {
    mock.filas = [{ id: "otra", imagen_url: `${URL}/vinos/xa.webp` }];
    await borrarFotoSiNoSeUsa({ tabla: "Vinos", bucket: "vinos", ruta: "a.webp", excluirId: "esta" });
    expect(mock.borradas).toEqual(["vinos/a.webp"]);
  });

  it("ante un error al comprobar el uso, conserva la foto", async () => {
    mock.errorConsulta = { message: "sin red" };
    await borrarFotoSiNoSeUsa({ tabla: "Platos", bucket: "platos", ruta: "a.webp", excluirId: "esta" });
    expect(mock.borradas).toEqual([]);
  });
});
