/**
 * Tests para src/components/reservas/EspacioForm.tsx
 *
 * Estrategia: se mockean los hooks de Supabase (`useEspaciosReserva`,
 * `useCrearEspacio`, `useActualizarEspacio`, `useMesas`) y `sonner`, igual que
 * en `GestionMesasEspacios.test.tsx`. La lógica pura de negocios
 * (`src/lib/reservas/negocios.ts`) y de cuadre (`src/lib/reservas/aforoMesas.ts`)
 * corre de verdad.
 *
 * Cubre el trabajo de "Mejorar el modal de espacio" (2026-09-26):
 *   - Selector de negocio obligatorio (nuevo campo `marca`).
 *   - Nombre único dentro del mismo negocio (aviso cliente-side).
 *   - Capacidad máxima entre 1 y 500.
 *   - Aviso al cambiar de negocio un espacio ya existente.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useEspaciosReserva");
vi.mock("@/hooks/useMesas");
vi.mock("sonner");

import { useEspaciosReserva, useCrearEspacio, useActualizarEspacio } from "@/hooks/useEspaciosReserva";
import { useMesas } from "@/hooks/useMesas";
import { EspacioForm } from "@/components/reservas/EspacioForm";

// Radix Select necesita estos dos métodos, que jsdom no implementa.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const espacio = (id: string, nombre: string, marca: string, overrides: Record<string, unknown> = {}) => ({
  id,
  nombre,
  descripcion: null,
  capacidad_maxima: 50,
  activa: true,
  caracteristicas: { marca },
  ...overrides,
});

const ESPACIOS_FIXTURE = [
  espacio("e-salon", "Salón", "casa_tomas"),
  espacio("e-terraza", "Terraza", "casa_tomas"),
  espacio("e-reservado", "El Reservado", "touza"),
];

const mutateAsyncCrear = vi.fn().mockResolvedValue({ id: "e-nuevo", nombre: "Patio" });
const mutateAsyncActualizar = vi.fn().mockResolvedValue({ id: "e-salon", nombre: "Salón" });

describe("EspacioForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsyncCrear.mockResolvedValue({ id: "e-nuevo", nombre: "Patio" });
    mutateAsyncActualizar.mockResolvedValue({ id: "e-salon", nombre: "Salón" });

    vi.mocked(useEspaciosReserva).mockReturnValue({ data: ESPACIOS_FIXTURE } as never);
    vi.mocked(useCrearEspacio).mockReturnValue({
      mutateAsync: mutateAsyncCrear,
      isPending: false,
    } as never);
    vi.mocked(useActualizarEspacio).mockReturnValue({
      mutateAsync: mutateAsyncActualizar,
      isPending: false,
    } as never);
    vi.mocked(useMesas).mockReturnValue({ data: [] } as never);
  });

  // ── Selector de negocio ────────────────────────────────────────────────────

  it("muestra el selector de negocio con Casa Tomás preseleccionado al crear", () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    expect(screen.getByText("Negocio")).toBeInTheDocument();
    // El combobox del negocio muestra la etiqueta del negocio por defecto.
    expect(screen.getByRole("combobox", { name: /negocio/i })).toHaveTextContent("Casa Tomás");
  });

  it("al editar, preselecciona el negocio actual del espacio (Touza)", () => {
    render(
      <EspacioForm
        open
        onOpenChange={vi.fn()}
        espacio={espacio("e-reservado", "El Reservado", "touza") as never}
      />,
    );

    expect(screen.getByRole("combobox", { name: /negocio/i })).toHaveTextContent("Touza");
  });

  // ── Nombre único dentro del mismo negocio ──────────────────────────────────

  it("rechaza un nombre ya usado por otro espacio del MISMO negocio", async () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    fireEvent.change(screen.getByPlaceholderText("Ej: Terraza, Sala Principal"), {
      target: { value: "Salón" }, // ya existe en casa_tomas, y casa_tomas es el negocio por defecto
    });
    fireEvent.click(screen.getByRole("button", { name: /crear espacio/i }));

    await waitFor(() => {
      expect(screen.getByText(/ya existe un espacio llamado "Salón" en Casa Tomás/i)).toBeInTheDocument();
    });
    expect(mutateAsyncCrear).not.toHaveBeenCalled();
  });

  it("permite el mismo nombre si el negocio elegido es distinto", async () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    // Cambiamos el negocio a Touza: "Salón" no existe en Touza.
    fireEvent.click(screen.getByRole("combobox", { name: /negocio/i }));
    fireEvent.click(await screen.findByRole("option", { name: /touza/i }));

    fireEvent.change(screen.getByPlaceholderText("Ej: Terraza, Sala Principal"), {
      target: { value: "Salón" },
    });
    fireEvent.click(screen.getByRole("button", { name: /crear espacio/i }));

    await waitFor(() => expect(mutateAsyncCrear).toHaveBeenCalledTimes(1));
    expect(mutateAsyncCrear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Salón", caracteristicas: { marca: "touza" } }),
    );
  });

  it("no marca como duplicado el propio nombre del espacio que se está editando", async () => {
    render(
      <EspacioForm
        open
        onOpenChange={vi.fn()}
        espacio={espacio("e-salon", "Salón", "casa_tomas") as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /actualizar espacio/i }));

    await waitFor(() => expect(mutateAsyncActualizar).toHaveBeenCalledTimes(1));
  });

  // ── Capacidad máxima 1-500 ──────────────────────────────────────────────────

  it("rechaza una capacidad mayor que 500", async () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    fireEvent.change(screen.getByPlaceholderText("Ej: Terraza, Sala Principal"), {
      target: { value: "Patio" },
    });
    fireEvent.change(screen.getByLabelText(/capacidad máxima/i), { target: { value: "501" } });
    fireEvent.click(screen.getByRole("button", { name: /crear espacio/i }));

    await waitFor(() => {
      expect(screen.getByText(/la capacidad máxima admitida es 500/i)).toBeInTheDocument();
    });
    expect(mutateAsyncCrear).not.toHaveBeenCalled();
  });

  // ── Aviso al cambiar de negocio en edición ─────────────────────────────────

  it("avisa (sin bloquear) al cambiar el negocio de un espacio existente", async () => {
    vi.mocked(useMesas).mockReturnValue({
      data: [{ id: "m-1", espacio_id: "e-salon", capacidad: 4, activa: true }],
    } as never);

    render(
      <EspacioForm
        open
        onOpenChange={vi.fn()}
        espacio={espacio("e-salon", "Salón", "casa_tomas") as never}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: /negocio/i }));
    fireEvent.click(await screen.findByRole("option", { name: /touza/i }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/mover/i);
    expect(aviso).toHaveTextContent(/1 mesa activa configurada/i);

    // El botón de guardar sigue habilitado: es un aviso, no un bloqueo.
    expect(screen.getByRole("button", { name: /actualizar espacio/i })).not.toBeDisabled();
  });
});
