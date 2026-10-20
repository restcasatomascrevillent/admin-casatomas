/**
 * El editor de reservas se abre ENCIMA del detalle de una llamada (dos diálogos
 * apilados) y, con cambios sin guardar, Esc pregunta antes de descartarlos (una
 * tercera capa). Radix solo entrega Esc a la capa de más arriba: aquí se
 * comprueba con los tres componentes REALES (detalle de llamada, el hook de
 * edición y el diálogo del editor) que cada Esc cierra una sola capa y que el
 * detalle de la llamada no se cierra por el camino. Solo el formulario está
 * sustituido: lo único que hace falta de él es decir «hay cambios sin guardar».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fila = {
  id: "res-1",
  nombre: "Ana López",
  telefono: "+34612345678",
  email: null,
  fecha: "2026-10-10",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  notas_cliente: null,
  espacio_id: null,
  marca: "casa_tomas",
  canal: "telefono",
  importante: false,
  en_blacklist: false,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () => Promise.resolve({ data: fila, error: null });
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: { onCambiosSinGuardar?: (hay: boolean) => void }) => (
    <button type="button" onClick={() => props.onCambiosSinGuardar?.(true)}>
      simular cambios sin guardar
    </button>
  ),
}));

import { TelefoniaCallDetailDialog } from "@/components/telefonia/TelefoniaCallDetailDialog";

const llamada = {
  id: "call-1",
  started_at: "2026-10-10T13:00:00",
  caller_number: "+34612345678",
  call_type: "bot" as const,
  status: "ended",
  duration_seconds: 95,
  summary: "El cliente reservó mesa para 4.",
  reserva_id: "res-1",
};

const escape = () => fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
const detalleAbierto = () => screen.queryByRole("heading", { name: /Detalle de llamada/, hidden: true });
const editorAbierto = () => screen.queryByRole("heading", { name: "Editar reserva", hidden: true });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("editor de reservas sobre el detalle de una llamada · Esc cierra una sola capa", () => {
  it("con cambios sin guardar: Esc pregunta; Esc otra vez cierra solo la pregunta; «Descartar» cierra solo el editor; el detalle sigue hasta su propio Esc", async () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TelefoniaCallDetailDialog call={llamada} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Editar reserva/ }));
    fireEvent.click(await screen.findByRole("button", { name: "simular cambios sin guardar" }));
    expect(editorAbierto()).toBeInTheDocument();
    expect(detalleAbierto()).toBeInTheDocument();

    // 1ª capa: la pregunta. Esc no cierra el editor ni el detalle: pregunta.
    escape();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(editorAbierto()).toBeInTheDocument();
    expect(detalleAbierto()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Esc sobre la pregunta: se cierra ELLA y nada más.
    escape();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(editorAbierto()).toBeInTheDocument();
    expect(detalleAbierto()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Esc con el editor arriba: vuelve a preguntar. «Descartar» cierra el editor; el detalle sigue.
    escape();
    fireEvent.click(await screen.findByRole("button", { name: "Descartar cambios" }));
    await waitFor(() => expect(editorAbierto()).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(detalleAbierto()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Ya solo queda el detalle de la llamada: ahora Esc lo cierra a él.
    escape();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("sin cambios sin guardar: Esc cierra el editor a la primera y el detalle de la llamada se queda", async () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TelefoniaCallDetailDialog call={llamada} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Editar reserva/ }));
    await screen.findByRole("button", { name: "simular cambios sin guardar" });

    escape();

    await waitFor(() => expect(editorAbierto()).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(detalleAbierto()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
