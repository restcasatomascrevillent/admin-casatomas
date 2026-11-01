import { describe, expect, it, vi } from "vitest";
import { archivoDesdeBruto, EsperasCola, procesarConCola } from "../esperasCola";

describe("puente con la cola de vídeo de la app", () => {
  it("resuelve con «listo», rechaza con «fallo» y aborta con «cancelado»", async () => {
    const e = new EsperasCola();
    const a = e.esperar("a");
    const b = e.esperar("b");
    const c = e.esperar("c");
    e.actualizar([{ id: "a", estado: "procesando" }]);
    expect(e.pendientes).toBe(3);
    e.actualizar([
      { id: "a", estado: "listo" },
      { id: "b", estado: "fallo", mensaje: "Sin plato" },
      { id: "c", estado: "cancelado" },
    ]);
    await expect(a).resolves.toBeUndefined();
    await expect(b).rejects.toThrow("Sin plato");
    await expect(c).rejects.toMatchObject({ name: "AbortError" });
    expect(e.pendientes).toBe(0);
  });

  it("procesarConCola encola el bruto como File y devuelve la URL nueva", async () => {
    const e = new EsperasCola();
    const encolar = vi.fn((_n: unknown) => "q1");
    const leerUrl = vi.fn().mockResolvedValueOnce("vieja").mockResolvedValueOnce("nueva");
    const p = procesarConCola(encolar, e, leerUrl)({
      platoId: "p1", nombrePlato: "Arroz", bruto: new Blob(["x"], { type: "video/quicktime" }), tema: "cartulina",
    });
    await vi.waitFor(() => expect(encolar).toHaveBeenCalled());
    const arg = encolar.mock.calls[0][0] as { archivo: File; urlActual: string | null };
    expect(arg.archivo.name).toBe("remoto-p1.mov");
    expect(arg.urlActual).toBe("vieja");
    e.actualizar([{ id: "q1", estado: "listo" }]);
    await expect(p).resolves.toBe("nueva");
  });

  it("sin cola montada (id vacío) falla en vez de quedarse esperando", async () => {
    const p = procesarConCola(() => "", new EsperasCola(), async () => null)({ platoId: "p", nombrePlato: "", bruto: new Blob(["x"]), tema: "cartulina" });
    await expect(p).rejects.toThrow(/cola/);
  });

  it("nombre del fichero según el tipo", () => {
    expect(archivoDesdeBruto(new Blob([""], { type: "video/webm" }), "x").name).toBe("remoto-x.webm");
    expect(archivoDesdeBruto(new Blob([""]), "x").type).toBe("video/mp4");
  });
});
