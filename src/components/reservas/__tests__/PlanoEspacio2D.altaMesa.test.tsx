/**
 * Alta de una mesa desde la vista de reservas (`PlanoEspacio2D`, botón «Mesa»).
 *
 * EL FALLO QUE CUBRE: `handleAddMesa` insertaba `pos_x: 50, pos_y: 50`. Las
 * columnas van en METROS, así que la mesa nacía a 50 m (fuera de una sala de
 * 12×8) y el editor de plano no la dibujaba. Se comprueba qué le llega a
 * `useCrearMesa().mutateAsync`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => {
  const construirBuilder = () => {
    const b: any = {};
    const seguir = () => b;
    for (const m of ["select", "neq", "order", "in", "is", "limit", "single", "eq"]) b[m] = seguir;
    b.then = (ok: any, mal?: any) => Promise.resolve({ data: [], error: null }).then(ok, mal);
    return b;
  };
  return {
    supabaseDoble: { from: () => construirBuilder(), rpc: async () => ({ data: [], error: null }) },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabaseDoble }));
vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/usePlanosEspacio");
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import { useMesas, useCrearMesa, useActualizarMesasSilent, useEliminarMesa } from "@/hooks/useMesas";
import { usePlanoEspacio } from "@/hooks/usePlanosEspacio";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";

const ESPACIO = "e-salon";

const mesa = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  espacio_id: ESPACIO,
  nombre,
  capacidad: 4,
  forma: "rectangular",
  ancho: 80,
  alto: 80,
  pos_x: 0.3,
  pos_y: 0.3,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...extra,
});

function montar(mesas: unknown[], plano = { ancho_metros: 12, alto_metros: 8 }) {
  const mutateAsync = vi.fn().mockResolvedValue({});
  vi.mocked(useMesas).mockReturnValue({ data: mesas, isLoading: false } as never);
  vi.mocked(usePlanoEspacio).mockReturnValue({
    data: { pixels_per_meter: 50, ...plano, configuracion: { elementos: [] } },
  } as never);
  vi.mocked(useCrearMesa).mockReturnValue({ mutateAsync, isPending: false } as never);
  vi.mocked(useActualizarMesasSilent).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
  vi.mocked(useEliminarMesa).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/reservas?fecha=2026-09-26&turno=comida"]}>
        <PlanoEspacio2D espacioId={ESPACIO} espacioNombre="Salón" onBack={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { mutateAsync };
}

async function darDeAlta(nombre: string) {
  fireEvent.click(await screen.findByRole("button", { name: /^Mesa$/ }));
  fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: nombre } });
  fireEvent.click(screen.getByRole("button", { name: /Crear mesa/ }));
}

describe("PlanoEspacio2D · alta de mesa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("coloca la mesa DENTRO del plano, en metros (no en 50, 50)", async () => {
    const { mutateAsync } = montar([mesa("m1", "1")]);
    await darDeAlta("7");

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const alta = mutateAsync.mock.calls[0][0];
    expect(alta).toMatchObject({ espacio_id: ESPACIO, nombre: "7" });
    expect(alta.pos_x).toBeGreaterThanOrEqual(0);
    expect(alta.pos_y).toBeGreaterThanOrEqual(0);
    expect(alta.pos_x + alta.ancho / 100).toBeLessThanOrEqual(12);
    expect(alta.pos_y + alta.alto / 100).toBeLessThanOrEqual(8);
    expect([alta.pos_x, alta.pos_y]).not.toEqual([50, 50]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("no cae encima de una mesa que ya está en el primer hueco", async () => {
    const { mutateAsync } = montar([mesa("m1", "1", { pos_x: 0.3, pos_y: 0.3 })]);
    await darDeAlta("7");

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const alta = mutateAsync.mock.calls[0][0];
    expect([alta.pos_x, alta.pos_y]).not.toEqual([0.3, 0.3]);
  });

  it("si no cabe en ningún sitio usa (1 m, 1 m) y avisa", async () => {
    const { mutateAsync } = montar([mesa("m1", "1", { pos_x: 0.1, pos_y: 0.1 })], {
      ancho_metros: 1,
      alto_metros: 1,
    });
    await darDeAlta("7");

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const alta = mutateAsync.mock.calls[0][0];
    expect([alta.pos_x, alta.pos_y]).toEqual([1, 1]);
    expect(toast.warning).toHaveBeenCalled();
  });
});
