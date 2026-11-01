import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SeccionVideoPlato } from "../video/SeccionVideoPlato";
import type { VideoPlato } from "../video/useVideoPlato";

vi.mock("../video/subirVideoPlato", () => ({ buscarOriginalVideo: vi.fn(async () => "videos-originales/p1.mp4") }));

const video = {
  platoId: "p1",
  estado: { fase: "nada" },
  disponible: { ok: true, formato: { mime: "video/mp4", ext: "mp4", contentType: "video/mp4" } },
  quitar: false,
  setQuitar: vi.fn(),
  generar: vi.fn(),
  cambiarFondo: vi.fn(() => true),
  reintentar: vi.fn(),
  puedeReintentar: false,
  cancelar: vi.fn(),
  limpiar: vi.fn(),
  guardar: vi.fn(),
  procesando: false,
  pendiente: false,
} as unknown as VideoPlato;

describe("SeccionVideoPlato · fondo del vídeo hacia fuera («Mandar a un dispositivo potente»)", () => {
  it("avisa del fondo REAL del vídeo guardado y luego del que se toca, no del de la foto", () => {
    const onTemaChange = vi.fn();
    render(
      <SeccionVideoPlato
        video={video}
        urlGuardada="https://x/storage/v1/object/public/platos/p1-video.mp4?t=1&fondo=carbon"
        columnaDisponible
        temaFoto="arena"
        onTemaChange={onTemaChange}
      />,
    );
    expect(onTemaChange).toHaveBeenLastCalledWith("carbon");
    expect(screen.getByRole("button", { name: /Fondo Carbón cálido/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Fondo Champán/ }));
    expect(onTemaChange).toHaveBeenLastCalledWith("champan");
  });

  it("sin vídeo propone el fondo de la foto", () => {
    const onTemaChange = vi.fn();
    render(<SeccionVideoPlato video={video} columnaDisponible temaFoto="marfil" onTemaChange={onTemaChange} />);
    expect(onTemaChange).toHaveBeenLastCalledWith("marfil");
  });
});
