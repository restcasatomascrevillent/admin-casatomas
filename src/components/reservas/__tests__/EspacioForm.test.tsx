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
 *   - Nombre único (aviso cliente-side).
 *   - Capacidad máxima entre 1 y 500.
 *
 * Touza no admite reservas (decisión del dueño 2026-10-01): se retiran el
 * selector de negocio y el aviso al cambiar de negocio. Un espacio NUEVO se
 * guarda como de Casa Tomás (`caracteristicas.marca = 'casa_tomas'`, que el
 * trigger de aforo sigue leyendo); uno que se EDITA conserva su marca, y el
 * nombre solo tiene que ser único entre los espacios de su mismo negocio.
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

  // ── Sin negocio que elegir: siempre Casa Tomás ─────────────────────────────

  it("no hay selector de negocio ni se nombra ningún negocio", () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    expect(screen.queryByText("Negocio")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /negocio/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Touza|Casa Tomás/)).not.toBeInTheDocument();
  });

  it("un espacio nuevo se guarda SIEMPRE como de Casa Tomás", async () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    fireEvent.change(screen.getByPlaceholderText("Ej: Terraza, Sala Principal"), {
      target: { value: "Patio" },
    });
    fireEvent.click(screen.getByRole("button", { name: /crear espacio/i }));

    await waitFor(() => expect(mutateAsyncCrear).toHaveBeenCalledTimes(1));
    expect(mutateAsyncCrear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Patio", caracteristicas: { marca: "casa_tomas" } }),
    );
  });

  it("al editar conserva el resto de `caracteristicas` y escribe la marca de Casa Tomás", async () => {
    render(
      <EspacioForm
        open
        onOpenChange={vi.fn()}
        espacio={espacio("e-terraza", "Terraza", "casa_tomas", { caracteristicas: { privada: true } }) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /actualizar espacio/i }));

    await waitFor(() => expect(mutateAsyncActualizar).toHaveBeenCalledTimes(1));
    expect(mutateAsyncActualizar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e-terraza", caracteristicas: { privada: true, marca: "casa_tomas" } }),
    );
  });

  // Las pantallas solo dejan abrir aquí salas de Casa Tomás (Espacios.tsx y su enlace `?editar=`), pero si
  // llegara una de Touza, guardarla NO puede pasarla a Casa Tomás: el trigger de aforo suma por marca y sus
  // plazas pasarían a contar en el aforo de Casa Tomás.
  it("al editar una sala de Touza conserva su marca: guardar no la pasa a Casa Tomás", async () => {
    render(
      <EspacioForm
        open
        onOpenChange={vi.fn()}
        espacio={espacio("e-reservado", "El Reservado", "touza", { caracteristicas: { privada: true, marca: "touza" } }) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /actualizar espacio/i }));

    await waitFor(() => expect(mutateAsyncActualizar).toHaveBeenCalledTimes(1));
    expect(mutateAsyncActualizar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e-reservado", caracteristicas: { privada: true, marca: "touza" } }),
    );
  });

  it("el nombre se compara con los del MISMO negocio: la «Terraza» de Touza no choca con la de Casa Tomás", async () => {
    render(
      <EspacioForm
        open
        onOpenChange={vi.fn()}
        espacio={espacio("tz-terraza", "Terraza", "touza", { capacidad_maxima: 30 }) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /actualizar espacio/i }));

    await waitFor(() => expect(mutateAsyncActualizar).toHaveBeenCalledTimes(1));
    expect(mutateAsyncActualizar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tz-terraza", nombre: "Terraza", caracteristicas: { marca: "touza" } }),
    );
    expect(screen.queryByText(/ya existe un espacio llamado/i)).not.toBeInTheDocument();
  });

  // ── Nombre único (entre los espacios de Casa Tomás) ────────────────────────

  it("rechaza un nombre ya usado por otro espacio", async () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    fireEvent.change(screen.getByPlaceholderText("Ej: Terraza, Sala Principal"), {
      target: { value: "Salón" }, // ya existe en Casa Tomás
    });
    fireEvent.click(screen.getByRole("button", { name: /crear espacio/i }));

    await waitFor(() => {
      expect(screen.getByText(/ya existe un espacio llamado "Salón"\. Usa otro nombre/i)).toBeInTheDocument();
    });
    expect(mutateAsyncCrear).not.toHaveBeenCalled();
  });

  it("un nombre que solo usa una sala de Touza (no admite reservas) no cuenta como repetido", async () => {
    render(<EspacioForm open onOpenChange={vi.fn()} espacio={null} />);

    fireEvent.change(screen.getByPlaceholderText("Ej: Terraza, Sala Principal"), {
      target: { value: "El Reservado" }, // solo existe en Touza
    });
    fireEvent.click(screen.getByRole("button", { name: /crear espacio/i }));

    await waitFor(() => expect(mutateAsyncCrear).toHaveBeenCalledTimes(1));
    expect(mutateAsyncCrear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "El Reservado", caracteristicas: { marca: "casa_tomas" } }),
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

  // Touza no admite reservas (decisión del dueño 2026-10-01): se retira «avisa (sin bloquear) al cambiar el
  // negocio de un espacio existente»: ya no hay negocio que cambiar.
});
