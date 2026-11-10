/**
 * «Subir albaranes» (10/11/2026, tipo de usuario «Albaranes»): hacer o elegir fotos, ver que se envían
 * y el estado de lo subido, sin nada de lo leído (sin importes).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Albaranes from "@/pages/Albaranes";
import type { DepsSubida } from "@/lib/facturas/albaranes";

const SUBIDAS = [
  { id: "t1", nombre_original: "albaran-carne.jpg", estado: "paginas", num_paginas: 1, created_at: new Date().toISOString(), terminado_at: null },
  { id: "t2", nombre_original: "albaran-pescado.jpg", estado: "completado", num_paginas: 1, created_at: new Date().toISOString(), terminado_at: null },
  { id: "t3", nombre_original: "repetido.jpg", estado: "duplicado", num_paginas: 1, created_at: "2026-11-05T10:00:00Z", terminado_at: null },
  { id: "t4", nombre_original: "borrosa.jpg", estado: "fallido", num_paginas: 1, created_at: "2026-11-05T09:00:00Z", terminado_at: null },
];

function montar(deps?: DepsSubida) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Albaranes deps={deps} />
    </QueryClientProvider>,
  );
}

const foto = (nombre: string, type = "image/jpeg") => new File([new Uint8Array(10)], nombre, { type });

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  h.rpc.mockResolvedValue({ data: SUBIDAS, error: null });
});

describe("Subir albaranes", () => {
  it("lista lo subido con su estado, desde albaranes_mis_subidas (nunca lee ocr_trabajos ni facturas)", async () => {
    montar();
    const filas = await screen.findAllByTestId("subida");
    expect(filas).toHaveLength(4);
    expect(within(filas[0]).getByText("Leyendo")).toBeInTheDocument();
    expect(within(filas[1]).getByText("Recibido")).toBeInTheDocument();
    expect(within(filas[2]).getByText("Ya estaba subido")).toBeInTheDocument();
    expect(within(filas[3]).getByText("No se pudo leer")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("albaranes_mis_subidas", { p_limite: 30 });
    expect(h.from).not.toHaveBeenCalled();
    // Ni rastro de importes.
    expect(screen.queryByText(/€|total|importe/i)).toBeNull();
  });

  it("tiene «Hacer foto» (cámara trasera) y «Elegir fotos o PDF» (varias)", async () => {
    montar();
    expect(screen.getByRole("button", { name: /Hacer foto/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Elegir fotos o PDF/ })).toBeInTheDocument();
    const camara = screen.getByTestId("input-camara");
    expect(camara).toHaveAttribute("capture", "environment");
    expect(camara).toHaveAttribute("accept", "image/*");
    expect(screen.getByTestId("input-galeria")).toHaveAttribute("multiple");
  });

  it("sube cada foto, una detrás de otra, y vuelve a pedir la lista", async () => {
    const deps: DepsSubida = {
      planificar: vi.fn(async () => ({ camino: "unico" }) as never),
      iniciarLargo: vi.fn(),
      iniciarUnico: vi.fn(async () => ({ trabajoId: "nuevo", numPiezas: 1 })),
    };
    montar(deps);
    await screen.findAllByTestId("subida");
    fireEvent.change(screen.getByTestId("input-galeria"), { target: { files: [foto("a.jpg"), foto("b.jpg")] } });
    await waitFor(() => expect(screen.getAllByText("Enviada")).toHaveLength(2));
    expect(deps.iniciarUnico).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2));
  });

  it("un fichero que no se puede leer no se sube y dice por qué", async () => {
    const deps: DepsSubida = { planificar: vi.fn(), iniciarLargo: vi.fn(), iniciarUnico: vi.fn() };
    montar(deps);
    await screen.findAllByTestId("subida");
    fireEvent.change(screen.getByTestId("input-galeria"), { target: { files: [foto("video.mp4", "video/mp4")] } });
    expect(await screen.findByText(/no es una foto/)).toBeInTheDocument();
    expect(deps.planificar).not.toHaveBeenCalled();
  });

  it("si la subida falla (sin permiso, sin red), lo enseña en esa foto", async () => {
    const deps: DepsSubida = {
      planificar: vi.fn(async () => ({ camino: "unico" }) as never),
      iniciarLargo: vi.fn(),
      iniciarUnico: vi.fn(async () => {
        throw new Error("Sin conexión: vuelve a intentarlo.");
      }),
    };
    montar(deps);
    await screen.findAllByTestId("subida");
    fireEvent.change(screen.getByTestId("input-camara"), { target: { files: [foto("a.jpg")] } });
    expect(await screen.findByText("Sin conexión: vuelve a intentarlo.")).toBeInTheDocument();
  });

  it("sin nada subido lo dice", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    montar();
    expect(await screen.findByText("Aún no has subido nada.")).toBeInTheDocument();
  });
});
