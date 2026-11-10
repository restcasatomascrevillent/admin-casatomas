/**
 * «En Hoy se tiene que poder cambiar el número de personas también, intuitivamente» (10/11/2026): el número
 * de la fila es un botón que abre − / + y números rápidos; guarda `numero_comensales` como la edición, con
 * «Deshacer», el mensaje de aforo si la BD lo rechaza y un aviso si ya no caben en su mesa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  puedeEditar: true,
  updates: [] as Array<{ id: string; cambios: Record<string, unknown> }>,
  errorUpdate: null as null | { code?: string; message: string },
  filas: [{ id: "r1" }] as Array<{ id: string }>,
  capacidades: [] as number[],
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_s: string, tipo: string = "view") => ({ canAccess: tipo === "view" || h.puedeEditar, loading: false }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: { min_comensales_por_reserva: 1, max_comensales_por_reserva: 12 } }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      if (tabla === "reservas") {
        return {
          update: (cambios: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => ({
              select: async () => {
                h.updates.push({ id, cambios });
                return h.errorUpdate ? { data: null, error: h.errorUpdate } : { data: h.filas, error: null };
              },
            }),
          }),
        };
      }
      // asignaciones_mesa: las mesas de la reserva, con su capacidad.
      return {
        select: () => ({
          eq: async () => ({ data: h.capacidades.map((c) => ({ mesas: { capacidad: c } })), error: null }),
        }),
      };
    },
  },
}));

import { BotonPersonas } from "@/components/reservas/CambiarPersonas";
import { avisoNoCaben } from "@/hooks/useCambiarPersonas";

const RESERVA = { id: "r1", nombre: "Ana López", numero_comensales: 4 };

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BotonPersonas reserva={RESERVA} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.puedeEditar = true;
  h.updates = [];
  h.errorUpdate = null;
  h.filas = [{ id: "r1" }];
  h.capacidades = [];
  vi.clearAllMocks();
});

describe("Cambiar personas desde Hoy", () => {
  it("con solo «Ver» es el número de siempre, sin botón", () => {
    h.puedeEditar = false;
    montar();
    expect(screen.queryByTestId("boton-personas")).toBeNull();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("tocar el número abre el selector; un número rápido guarda al instante, con «Deshacer»", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Personas de Ana López: 4. Cambiar" }));
    const dialogo = screen.getByRole("dialog", { name: "¿Cuántas personas?" });
    expect(within(dialogo).getAllByRole("button", { pressed: false })).toHaveLength(11);
    fireEvent.click(within(dialogo).getByRole("button", { name: "6" }));
    await waitFor(() => expect(h.updates).toEqual([{ id: "r1", cambios: { numero_comensales: 6 } }]));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Ana López: 4 → 6 personas", expect.objectContaining({ action: expect.anything() })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // «Deshacer» vuelve a 4.
    const { action } = h.toast.success.mock.calls[0][1] as { action: { onClick: () => void } };
    action.onClick();
    await waitFor(() => expect(h.updates.at(-1)).toEqual({ id: "r1", cambios: { numero_comensales: 4 } }));
  });

  it("− / + cambian el número y «Guardar» lo escribe", async () => {
    montar();
    fireEvent.click(screen.getByTestId("boton-personas"));
    expect(screen.getByRole("button", { name: "Sin cambios" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Una persona menos" }));
    fireEvent.click(screen.getByRole("button", { name: "Una persona menos" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar 2 personas" }));
    await waitFor(() => expect(h.updates).toEqual([{ id: "r1", cambios: { numero_comensales: 2 } }]));
  });

  it("si el aforo no deja, enseña el mensaje y el selector sigue abierto", async () => {
    h.errorUpdate = { code: "23514", message: "Aforo superado" };
    montar();
    fireEvent.click(screen.getByTestId("boton-personas"));
    fireEvent.click(screen.getByRole("button", { name: "12" }));
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("No hay aforo suficiente en ese turno. Elige otra hora o reduce los comensales."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("sin filas (RLS) no dice «guardado»", async () => {
    h.filas = [];
    montar();
    fireEvent.click(screen.getByTestId("boton-personas"));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("No tienes permiso para editar esta reserva, o ya no existe."));
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("si ya tiene mesa y no caben, guarda pero avisa", async () => {
    h.capacidades = [4];
    montar();
    fireEvent.click(screen.getByTestId("boton-personas"));
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    await waitFor(() =>
      expect(h.toast.warning).toHaveBeenCalledWith(
        "Ana López: 4 → 7 personas",
        expect.objectContaining({ description: "Son 7 y su mesa es de 4: quizá haya que juntar mesas o cambiarla." }),
      ),
    );
    expect(h.updates).toHaveLength(1);
  });

  it("avisoNoCaben: solo si tiene mesa y se pasa", () => {
    expect(avisoNoCaben(5, 0)).toBeNull();
    expect(avisoNoCaben(4, 4)).toBeNull();
    expect(avisoNoCaben(5, null)).toBeNull();
    expect(avisoNoCaben(5, 4)).toMatch(/^Son 5 y su mesa es de 4/);
  });
});
