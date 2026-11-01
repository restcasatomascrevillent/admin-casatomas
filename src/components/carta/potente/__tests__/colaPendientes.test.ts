import { describe, expect, it, vi } from "vitest";
import {
  describirDispositivo,
  esErrorSinMigracion,
  extensionBruto,
  hayQueAvisar,
  MS_ABANDONADO,
  pendientesReclamables,
  reclamable,
  textoAviso,
  type TrabajoVideo,
} from "../colaPendientes";
import { procesarTrabajoRemoto } from "../procesarTrabajoRemoto";

const AHORA = Date.parse("2026-11-01T12:00:00Z");
const trabajo = (p: Partial<TrabajoVideo>): TrabajoVideo => ({
  id: "t1",
  plato_id: "p1",
  ruta_original: "pendientes/aaaaaaaa.mp4",
  tema: "cartulina",
  estado: "pendiente",
  creado_por: "u1",
  dispositivo_origen: "Chrome · Android",
  procesado_por: null,
  reclamado_en: null,
  intentos: 0,
  error: null,
  created_at: "2026-11-01T11:00:00Z",
  Platos: { nombre: "Arroz meloso" },
  ...p,
});

describe("cola de pendientes", () => {
  it("reclamable: pendientes y procesando abandonados (> 10 min), igual que la RPC", () => {
    expect(reclamable(trabajo({}), AHORA)).toBe(true);
    expect(reclamable(trabajo({ estado: "procesando", reclamado_en: new Date(AHORA - MS_ABANDONADO + 1000).toISOString() }), AHORA)).toBe(false);
    expect(reclamable(trabajo({ estado: "procesando", reclamado_en: new Date(AHORA - MS_ABANDONADO - 1000).toISOString() }), AHORA)).toBe(true);
    expect(reclamable(trabajo({ estado: "listo" }), AHORA)).toBe(false);
    expect(reclamable(trabajo({ estado: "procesando", reclamado_en: null }), AHORA)).toBe(false);
  });

  it("ordena del más antiguo al más nuevo y quita los no reclamables", () => {
    const lista = pendientesReclamables(
      [
        trabajo({ id: "b", created_at: "2026-11-01T11:30:00Z" }),
        trabajo({ id: "x", estado: "procesando", reclamado_en: new Date(AHORA - 1000).toISOString() }),
        trabajo({ id: "a", created_at: "2026-11-01T10:00:00Z" }),
      ],
      AHORA,
    );
    expect(lista.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("texto del aviso en singular, plural y con muchos platos", () => {
    expect(textoAviso([])).toBe("");
    expect(textoAviso([trabajo({})])).toBe("Hay 1 vídeo pendiente: Arroz meloso. ¿Procesarlo aquí?");
    expect(textoAviso([trabajo({}), trabajo({ id: "2", Platos: { nombre: "Chuletón" } })])).toBe(
      "Hay 2 vídeos pendientes: Arroz meloso, Chuletón. ¿Procesarlos aquí?",
    );
    const cinco = Array.from({ length: 5 }, (_, i) => trabajo({ id: String(i), Platos: i === 4 ? null : { nombre: `P${i}` } }));
    expect(textoAviso(cinco)).toBe("Hay 5 vídeos pendientes: P0, P1, P2 y 2 más. ¿Procesarlos aquí?");
  });

  it("vuelve a avisar solo si aparece uno que no se descartó con «Ahora no»", () => {
    const descartados = new Set(["a"]);
    expect(hayQueAvisar([{ id: "a" }], descartados)).toBe(false);
    expect(hayQueAvisar([{ id: "a" }, { id: "b" }], descartados)).toBe(true);
    expect(hayQueAvisar([], descartados)).toBe(false);
  });

  it("extensión del bruto por nombre o tipo (incluido .mov del iPhone)", () => {
    expect(extensionBruto({ name: "IMG_0001.MOV", type: "" })).toBe("mov");
    expect(extensionBruto({ name: "blob", type: "video/quicktime" })).toBe("mov");
    expect(extensionBruto({ name: "x.webm" })).toBe("webm");
    expect(extensionBruto({ name: "x.exe", type: "video/3gpp" })).toBe("3gp");
    expect(extensionBruto({})).toBe("mp4");
  });

  it("describe el dispositivo", () => {
    expect(describirDispositivo("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36")).toBe("Chrome · Android");
    expect(describirDispositivo("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iPhone");
    expect(describirDispositivo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36 Edg/130")).toBe("Edge · Windows");
  });

  it("reconoce la migración sin aplicar", () => {
    expect(esErrorSinMigracion({ code: "PGRST205", message: "Could not find the table 'public.trabajos_video' in the schema cache" })).toBe(true);
    expect(esErrorSinMigracion({ code: "PGRST202", message: "Could not find the function public.reclamar_trabajo_video" })).toBe(true);
    expect(esErrorSinMigracion({ code: "42501", message: "permission denied" })).toBe(false);
    expect(esErrorSinMigracion(null)).toBe(false);
  });
});

describe("procesarTrabajoRemoto", () => {
  const deps = () => ({
    reclamar: vi.fn(async () => trabajo({ estado: "procesando" })),
    descargar: vi.fn(async () => new Blob(["v"], { type: "video/mp4" })),
    terminar: vi.fn(async () => undefined),
    soltar: vi.fn(async () => undefined),
    borrar: vi.fn(async () => undefined),
    notificar: vi.fn(async () => ({ ok: true })),
    procesarYGuardar: vi.fn(async () => "https://x/p1-video.mp4?t=1"),
  });

  it("camino feliz: reclama, procesa, marca listo, borra el bruto y avisa", async () => {
    const d = deps();
    const r = await procesarTrabajoRemoto(trabajo({}), d);
    expect(r).toEqual({ estado: "listo", url: "https://x/p1-video.mp4?t=1" });
    expect(d.reclamar).toHaveBeenCalledWith("t1");
    expect(d.procesarYGuardar).toHaveBeenCalledWith(expect.objectContaining({ platoId: "p1", tema: "cartulina", nombrePlato: "Arroz meloso" }));
    expect(d.terminar).toHaveBeenCalledWith("t1", true);
    expect(d.borrar).toHaveBeenCalledWith("pendientes/aaaaaaaa.mp4");
    expect(d.notificar).toHaveBeenCalledWith("t1");
  });

  it("si otro dispositivo lo cogió, no hace nada más", async () => {
    const d = deps();
    d.reclamar.mockResolvedValueOnce(null as never);
    expect((await procesarTrabajoRemoto(trabajo({}), d)).estado).toBe("cogido");
    expect(d.descargar).not.toHaveBeenCalled();
  });

  it("si falla el procesado: marca error con el mensaje, avisa y conserva el bruto", async () => {
    const d = deps();
    d.procesarYGuardar.mockRejectedValueOnce(new Error("No se encontró el plato en el vídeo"));
    const r = await procesarTrabajoRemoto(trabajo({}), d);
    expect(r).toEqual({ estado: "error", mensaje: "No se encontró el plato en el vídeo" });
    expect(d.terminar).toHaveBeenCalledWith("t1", false, "No se encontró el plato en el vídeo");
    expect(d.notificar).toHaveBeenCalledWith("t1");
    expect(d.borrar).not.toHaveBeenCalled();
  });

  it("cancelado aquí: vuelve a pendiente y no avisa", async () => {
    const d = deps();
    d.procesarYGuardar.mockRejectedValueOnce(new DOMException("Cancelado", "AbortError"));
    expect((await procesarTrabajoRemoto(trabajo({}), d)).estado).toBe("cancelado");
    expect(d.soltar).toHaveBeenCalledWith("t1");
    expect(d.terminar).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });
});
