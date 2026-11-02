/**
 * Fotos que un móvil no pudo recortar → trabajo para un ordenador
 * (trabajos_recorte): creación (y sin migración = como antes), aviso del
 * ordenador, proceso remoto y la carga del push de notificar-video.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  insertar: vi.fn(),
  borrar: vi.fn(),
  invoke: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { warning: mocks.warning, loading: vi.fn(), success: vi.fn(), dismiss: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const borrarCadena = { eq: () => borrarCadena, then: (ok: (v: unknown) => void) => ok(mocks.borrar()) };
  return {
    supabase: {
      auth: { getUser: mocks.getUser },
      functions: { invoke: mocks.invoke },
      from: () => ({
        insert: (fila: unknown) => ({ select: () => ({ single: () => mocks.insertar(fila) }) }),
        delete: () => borrarCadena,
      }),
    },
  };
});

import { crearTrabajoRecorte, notificarRecorte, recortesReclamables, textoAvisoRecortes } from "../trabajosRecorte";
import { procesarTrabajoRecorte } from "../procesarTrabajoRecorte";
import { mandarRecorteAOrdenador } from "../../recorte/recorteEnOrdenador";
import { construirCargaRecorte, leerTipo, autorizarNotificacionRecorte } from "../../../../../supabase/functions/notificar-video/logica";
import type { DatosRecorte } from "../../recorte/recorteMovil";

const DATOS: DatosRecorte = { tabla: "Cocteles", registroId: "c1", nombre: "Negroni", rutaOriginal: "c1.jpg", tema: "carbon" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("crearTrabajoRecorte", () => {
  it("crea el trabajo con la tabla, la ficha, la ruta original y el fondo elegido, a nombre propio", async () => {
    mocks.insertar.mockResolvedValue({ data: { id: "t1" }, error: null });
    const r = await crearTrabajoRecorte(DATOS);
    expect(r).toEqual({ creado: true, trabajo: { id: "t1" } });
    expect(mocks.insertar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: "Cocteles", registro_id: "c1", ruta_original: "c1.jpg", tema: "carbon", creado_por: "u1", nombre: "Negroni" }),
    );
  });

  it("sin la migración aplicada no falla: dice sin_migracion", async () => {
    mocks.insertar.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.trabajos_recorte' in the schema cache" } });
    expect(await crearTrabajoRecorte(DATOS)).toEqual({ creado: false, motivo: "sin_migracion" });
  });

  it("si la ficha ya tenía uno pendiente, lo sustituye", async () => {
    mocks.insertar
      .mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } })
      .mockResolvedValueOnce({ data: { id: "t2" }, error: null });
    const r = await crearTrabajoRecorte(DATOS);
    expect(mocks.borrar).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ creado: true, trabajo: { id: "t2" } });
  });
});

describe("mandarRecorteAOrdenador (lo que hace el móvil cuando no puede)", () => {
  it("con trabajo creado avisa de que se recortará en un ordenador con el panel abierto y que le avisaremos", async () => {
    mocks.insertar.mockResolvedValue({ data: { id: "t1" }, error: null });
    await mandarRecorteAOrdenador(DATOS, "x");
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    const [titulo, op] = mocks.warning.mock.calls[0];
    expect(titulo).toMatch(/Guardado con la foto normal/);
    expect(op.description).toMatch(/se recortará en un ordenador con el panel abierto y te avisaremos/i);
  });

  it("sin la migración se comporta como antes: «Quitar fondo» desde un ordenador", async () => {
    mocks.insertar.mockResolvedValue({ data: null, error: { code: "42P01", message: 'relation "trabajos_recorte" does not exist' } });
    await mandarRecorteAOrdenador(DATOS, "Este móvil no ha podido quitarle el fondo.");
    expect(mocks.warning.mock.calls[0][1].description).toMatch(/Quitar fondo/);
  });
});

describe("cola del ordenador", () => {
  const t = (id: string, estado: string, created_at: string, reclamado_en: string | null = null) =>
    ({ id, estado, created_at, reclamado_en, nombre: id }) as never;

  it("coge pendientes y abandonados, del más antiguo al más nuevo", () => {
    const ahora = Date.parse("2026-11-02T12:00:00Z");
    const lista = recortesReclamables(
      [
        t("b", "pendiente", "2026-11-02T11:00:00Z"),
        t("a", "pendiente", "2026-11-02T10:00:00Z"),
        t("vivo", "procesando", "2026-11-02T09:00:00Z", "2026-11-02T11:58:00Z"),
        t("abandonado", "procesando", "2026-11-02T09:30:00Z", "2026-11-02T11:00:00Z"),
      ],
      ahora,
    );
    expect(lista.map((x: { id: string }) => x.id)).toEqual(["abandonado", "a", "b"]);
  });

  it("texto del aviso", () => {
    expect(textoAvisoRecortes([{ nombre: "Negroni" }])).toBe("Hay 1 foto pendiente de recortar: Negroni. ¿Recortarla aquí?");
    expect(textoAvisoRecortes([{ nombre: "A" }, { nombre: "B" }, { nombre: "C" }, { nombre: "D" }])).toBe(
      "Hay 4 fotos pendientes de recortar: A, B, C y 1 más. ¿Recortarlas aquí?",
    );
  });
});

describe("procesarTrabajoRecorte (en el ordenador)", () => {
  const fila = { id: "t1", tabla: "Vinos", registro_id: "v1", nombre: "Fondillón", ruta_original: "v1.jpeg", tema: "arena" } as never;

  it("reclama, recorta con el fondo elegido, marca listo y avisa al móvil", async () => {
    const deps = {
      reclamar: vi.fn(async () => fila),
      recortar: vi.fn(async () => "https://x/v1-carta-jpeg.webp"),
      terminar: vi.fn(async () => undefined),
      notificar: vi.fn(async () => ({ ok: true })),
      soltar: vi.fn(),
    };
    expect(await procesarTrabajoRecorte({ id: "t1" }, deps)).toEqual({ estado: "listo", url: "https://x/v1-carta-jpeg.webp" });
    expect(deps.recortar).toHaveBeenCalledWith({ tabla: "Vinos", registroId: "v1", nombre: "Fondillón", rutaOriginal: "v1.jpeg", tema: "arena" });
    expect(deps.terminar).toHaveBeenCalledWith("t1", true);
    expect(deps.notificar).toHaveBeenCalledWith("t1");
  });

  it("si otro ya lo cogió no hace nada", async () => {
    const recortar = vi.fn();
    expect(await procesarTrabajoRecorte({ id: "t1" }, { reclamar: vi.fn(async () => null), recortar })).toMatchObject({ estado: "cogido" });
    expect(recortar).not.toHaveBeenCalled();
  });

  it("si falla, marca error y avisa igualmente", async () => {
    const deps = {
      reclamar: vi.fn(async () => fila),
      recortar: vi.fn(async () => Promise.reject(new Error("No se encontró la botella en la foto"))),
      terminar: vi.fn(async () => undefined),
      notificar: vi.fn(async () => ({ ok: true })),
    };
    expect(await procesarTrabajoRecorte({ id: "t1" }, deps)).toEqual({ estado: "error", mensaje: "No se encontró la botella en la foto" });
    expect(deps.terminar).toHaveBeenCalledWith("t1", false, "No se encontró la botella en la foto");
    expect(deps.notificar).toHaveBeenCalled();
  });

  it("el push va a notificar-video con tipo «recorte»", async () => {
    mocks.invoke.mockResolvedValue({ data: { enviadas: 1 }, error: null });
    expect(await notificarRecorte("t1")).toEqual({ ok: true, enviadas: 1 });
    expect(mocks.invoke).toHaveBeenCalledWith("notificar-video", { body: { trabajo_id: "t1", tipo: "recorte" } });
  });
});

describe("notificar-video con tipo «recorte»", () => {
  const tr = { id: "t1", tabla: "Vinos", registro_id: "v1", nombre: "Fondillón", estado: "listo", error: null, creado_por: "movil", procesado_por: "pc" };

  it("lee el tipo (por defecto vídeo; otro valor no vale)", () => {
    expect(leerTipo({ trabajo_id: "x" })).toBe("video");
    expect(leerTipo({ tipo: "recorte" })).toBe("recorte");
    expect(leerTipo({ tipo: "otro" })).toBeNull();
  });

  it("solo quien lo procesó o lo creó, y terminado", () => {
    expect(autorizarNotificacionRecorte(tr, "pc")).toEqual({ ok: true });
    expect(autorizarNotificacionRecorte(tr, "otro")).toMatchObject({ ok: false, status: 403 });
    expect(autorizarNotificacionRecorte({ ...tr, estado: "procesando" }, "pc")).toMatchObject({ ok: false, status: 409 });
  });

  it("carga del push: lista con la foto o error con el motivo", () => {
    const ok = construirCargaRecorte(tr, "https://x/v1-carta-jpeg.webp");
    expect(ok).toMatchObject({ titulo: "Foto con fondo lista: Fondillón", estado: "listo", imagen: "https://x/v1-carta-jpeg.webp", url: "/gestion-web?tab=carta" });
    const ko = construirCargaRecorte({ ...tr, estado: "error", error: "No se encontró la botella" });
    expect(ko.titulo).toBe("No se pudo recortar la foto: Fondillón");
    expect(ko.cuerpo).toContain("La foto normal sigue guardada");
    expect(ko.imagen).toBeUndefined();
  });
});
