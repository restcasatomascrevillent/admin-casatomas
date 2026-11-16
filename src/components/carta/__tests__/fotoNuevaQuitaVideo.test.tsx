/**
 * «He subido una foto y sigue saliendo el vídeo» (16/11/2026): manda lo último
 * que se sube en el panel. Una foto NUEVA en un plato con vídeo quita el vídeo
 * anterior (la web enseña el vídeo siempre que hay `video_url`), salvo que
 * haya otro vídeo en camino.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Plato } from "@/hooks/usePlatos";

const mocks = vi.hoisted(() => ({
  actualizar: vi.fn(),
  refrescar: vi.fn(),
  subir: vi.fn(),
  quitarVideo: vi.fn(),
  quitarPorFoto: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({
    toggleExpanded: { mutate: vi.fn(), isPending: false },
    toggleActivado: { mutate: vi.fn(), isPending: false },
    eliminarPlato: { mutate: vi.fn(), isPending: false },
    actualizarPlato: { mutate: vi.fn(), mutateAsync: mocks.actualizar, isPending: false },
    refrescarPlatos: mocks.refrescar,
    categorias: ["Entrantes"],
    unidades: ["Unidad"],
  }),
}));
vi.mock("../subirFotoCarta", async (original) => ({
  ...(await original<typeof import("../subirFotoCarta")>()),
  subirFotoCarta: mocks.subir,
}));
vi.mock("../video/subirVideoPlato", () => ({
  quitarVideoPlato: mocks.quitarVideo,
  quitarVideoPorFotoNueva: mocks.quitarPorFoto,
  buscarOriginalVideo: vi.fn(async () => null),
}));
vi.mock("@/lib/storage-carta", () => ({ borrarFotoSiNoSeUsa: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: mocks.info } }));

import { ListaPlatos } from "../ListaPlatos";
import { SeccionVideoPlato } from "../video/SeccionVideoPlato";
import { useVideoPlato, type VideoPlato } from "../video/useVideoPlato";
import { ColaVideosContext, type ContextoColaVideos } from "../video/useColaVideos";
import type { TrabajoVideo } from "../video/colaVideos";
import {
  AVISO_FOTO_NUEVA_QUITA_VIDEO,
  fotoNuevaQuitaVideo,
  MENSAJE_VIDEO_QUITADO_POR_FOTO,
} from "../video/fotoNuevaQuitaVideo";

const URL_VIDEO = "https://x.supabase.co/storage/v1/object/public/platos/p1-video.mp4?t=1&fondo=cartulina";
const plato = {
  id: "p1",
  nombre: "Setas de temporada",
  categoria: "Entrantes",
  precio_eur: 14.5,
  imagen_url: "https://x.supabase.co/storage/v1/object/public/platos/p1.jpg?t=1",
  video_url: URL_VIDEO,
  activado: true,
  alergenos_oficiales: ["huevos"],
} as Plato;

const cola = (trabajos: Partial<TrabajoVideo>[] = []): ContextoColaVideos => ({
  trabajos: trabajos as TrabajoVideo[],
  encolar: vi.fn(() => "t1"),
  cancelar: vi.fn(),
  reintentar: vi.fn(),
  disponible: true,
});

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:foto"), revokeObjectURL: vi.fn() }));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
  mocks.subir.mockResolvedValue({
    url: "https://x.supabase.co/storage/v1/object/public/platos/p1.png?t=2",
    rutas: ["p1.png"],
    rutaPrincipal: "p1.png",
  });
  mocks.actualizar.mockResolvedValue(undefined);
  mocks.quitarVideo.mockResolvedValue(undefined);
  mocks.quitarPorFoto.mockResolvedValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fotoNuevaQuitaVideo", () => {
  it("foto nueva + vídeo guardado + ningún vídeo en camino → se quita", () => {
    expect(fotoNuevaQuitaVideo({ fotoNueva: true, urlVideo: URL_VIDEO, videoEnCamino: false })).toBe(true);
  });
  it("no se quita sin foto nueva, sin vídeo o con un vídeo en camino", () => {
    expect(fotoNuevaQuitaVideo({ fotoNueva: false, urlVideo: URL_VIDEO, videoEnCamino: false })).toBe(false);
    expect(fotoNuevaQuitaVideo({ fotoNueva: true, urlVideo: null, videoEnCamino: false })).toBe(false);
    expect(fotoNuevaQuitaVideo({ fotoNueva: true, urlVideo: URL_VIDEO, videoEnCamino: true })).toBe(false);
  });
});

describe("Ficha del plato (useVideoPlato.guardar)", () => {
  const montar = (contexto: ContextoColaVideos) =>
    renderHook(() => useVideoPlato(plato), {
      wrapper: ({ children }) => <ColaVideosContext.Provider value={contexto}>{children}</ColaVideosContext.Provider>,
    });

  it("al guardar con foto nueva quita el vídeo anterior", async () => {
    const { result } = montar(cola());
    let cambio = false;
    await act(async () => {
      cambio = await result.current.guardar("p1", URL_VIDEO, plato.nombre, { fotoNueva: true });
    });
    expect(mocks.quitarPorFoto).toHaveBeenCalledWith("p1", URL_VIDEO);
    expect(cambio).toBe(true);
  });

  it("sin foto nueva (p. ej. solo otro fondo) el vídeo se queda", async () => {
    const { result } = montar(cola());
    await act(async () => {
      expect(await result.current.guardar("p1", URL_VIDEO, plato.nombre, { fotoNueva: false })).toBe(false);
      expect(await result.current.guardar("p1", URL_VIDEO)).toBe(false);
    });
    expect(mocks.quitarPorFoto).not.toHaveBeenCalled();
    expect(mocks.quitarVideo).not.toHaveBeenCalled();
  });

  it("si en la misma ficha se elige un vídeo nuevo, la foto nueva no lo quita", async () => {
    const { result } = montar(cola());
    act(() => result.current.generar(new File(["v"], "v.mp4", { type: "video/mp4" }), "cartulina"));
    expect(result.current.videoEnCamino).toBe(true);
    await act(async () => {
      expect(await result.current.guardar("p1", URL_VIDEO, plato.nombre, { fotoNueva: true })).toBe(false);
    });
    expect(mocks.quitarPorFoto).not.toHaveBeenCalled();
  });

  it("con un vídeo del plato todavía en la cola tampoco se quita", async () => {
    const { result } = montar(cola([{ id: "t9", platoId: "p1", estado: "procesando", progreso: null }]));
    expect(result.current.videoEnCamino).toBe(true);
    await act(async () => {
      expect(await result.current.guardar("p1", URL_VIDEO, plato.nombre, { fotoNueva: true })).toBe(false);
    });
    expect(mocks.quitarPorFoto).not.toHaveBeenCalled();
  });
});

describe("Sección «Vídeo del plato»", () => {
  const video = {
    platoId: "p1",
    estado: { fase: "nada" },
    disponible: { ok: true, formato: { mime: "video/mp4", ext: "mp4", contentType: "video/mp4" } },
    quitar: false,
    setQuitar: vi.fn(),
  } as unknown as VideoPlato;

  it("avisa de que el vídeo se quitará al guardar la foto nueva", () => {
    const { rerender } = render(
      <SeccionVideoPlato video={video} urlGuardada={URL_VIDEO} columnaDisponible temaFoto="cartulina" fondoCambiado seQuitaPorFoto />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(AVISO_FOTO_NUEVA_QUITA_VIDEO);
    rerender(<SeccionVideoPlato video={video} urlGuardada={URL_VIDEO} columnaDisponible temaFoto="cartulina" fondoCambiado />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(/El vídeo mantiene su fondo/)).toBeInTheDocument();
  });
});

describe("Botón «Foto» de la tarjeta de un plato con vídeo", () => {
  const fichero = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "foto.png", { type: "image/png" });

  async function cambiarFoto() {
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    await act(async () => {
      fireEvent.change(screen.getByTestId("foto-rapida-input"), { target: { files: [fichero()] } });
    });
    fireEvent.click(await screen.findByRole("button", { name: /Usar foto original/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled());
  }

  it("avisa antes de guardar y, al guardar, quita el vídeo anterior", async () => {
    render(<ListaPlatos platos={[plato]} />);
    await cambiarFoto();
    expect(screen.getByRole("status")).toHaveTextContent(AVISO_FOTO_NUEVA_QUITA_VIDEO);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mocks.quitarPorFoto).toHaveBeenCalledWith("p1", URL_VIDEO));
    expect(mocks.actualizar).toHaveBeenCalledWith({
      id: "p1",
      imagen_url: "https://x.supabase.co/storage/v1/object/public/platos/p1.png?t=2",
    });
    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith(MENSAJE_VIDEO_QUITADO_POR_FOTO));
    expect(mocks.refrescar).toHaveBeenCalled();
  });

  it("un plato sin vídeo ni avisa ni quita nada", async () => {
    render(<ListaPlatos platos={[{ ...plato, video_url: null } as Plato]} />);
    await cambiarFoto();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.quitarPorFoto).not.toHaveBeenCalled();
  });

  it("con un vídeo del plato en la cola, la foto nueva no lo quita", async () => {
    render(
      <ColaVideosContext.Provider value={cola([{ id: "t9", platoId: "p1", estado: "esperando", progreso: null }])}>
        <ListaPlatos platos={[plato]} />
      </ColaVideosContext.Provider>,
    );
    await cambiarFoto();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.quitarPorFoto).not.toHaveBeenCalled();
  });
});
