/**
 * Hoy en móvil: el teléfono del cliente en cada reserva (15/10/2026, petición del dueño: «en la vista
 * móvil de Hoy hay que añadir el teléfono»). Se ve legible («618 19 04 32»), es un enlace `tel:` para
 * llamar con un toque (44 px de alto) y no abre el panel de la reserva; sin teléfono, nada.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client");

import { FilaReservaMovil } from "@/components/reservas/movil/VistaHoyMovil";
import { enlaceTelefono, telefonoLegible } from "@/lib/reservas/telefono";

const reserva = (telefono: string | null) => ({
  id: "r1",
  nombre: "Ana López",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: "s1",
  telefono,
});

const montar = (telefono: string | null, onAbrir = vi.fn()) =>
  render(
    <ul>
      <FilaReservaMovil reserva={reserva(telefono)} nombresMesa={["3"]} terminada={false} onAbrir={onAbrir} />
    </ul>,
  );

describe("FilaReservaMovil — teléfono", () => {
  it("enseña el teléfono legible como enlace tel: de 44 px, y pulsarlo no abre la reserva", () => {
    const onAbrir = vi.fn();
    montar("+34618190432", onAbrir);

    const enlace = screen.getByRole("link", { name: /Llamar a Ana López/ });
    expect(enlace).toHaveAttribute("href", "tel:+34618190432");
    expect(enlace).toHaveTextContent("618 19 04 32");
    expect(enlace).toHaveClass("min-h-11", "pointer-events-auto");
    fireEvent.click(enlace);
    expect(onAbrir).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Ana López/ }));
    expect(onAbrir).toHaveBeenCalledTimes(1);
  });

  it("sin teléfono no sale nada", () => {
    montar(null);
    expect(screen.queryByRole("link")).toBeNull();
    montar("   ");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("telefonoLegible / enlaceTelefono", () => {
  it("formatea españoles en grupos y deja los extranjeros con +", () => {
    expect(telefonoLegible("+34618190432")).toBe("618 19 04 32");
    expect(telefonoLegible("618190432")).toBe("618 19 04 32");
    expect(telefonoLegible("0034 618 190 432")).toBe("618 19 04 32");
    expect(telefonoLegible("+447700900123")).toBe("+447700900123");
    expect(telefonoLegible(null)).toBeNull();
    expect(enlaceTelefono("618 190 432")).toBe("tel:+34618190432");
    expect(enlaceTelefono("")).toBeNull();
  });
});
