/**
 * Hoy en móvil: la fila de cada reserva, pensada para el camarero (07/11/2026). En grande: hora, nombre y
 * personas; la mesa con el lenguaje del servicio («Prevista: Mesa 3» / «En mesa 3» / «Sin mesa»), el estado
 * y las notas. Botón directo «Sentar · Mesa 3» (no abre la ficha); sin permiso de edición no hay botón.
 * El teléfono (15/10/2026, petición del dueño) sigue en la fila como icono «Llamar» de 44 px (desde 375 px).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client");

import { FilaReservaMovil } from "@/components/reservas/movil/VistaHoyMovil";
import { enlaceTelefono, telefonoLegible } from "@/lib/reservas/telefono";

const reserva = (extra: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    nombre: "Ana López",
    hora: "21:00:00",
    numero_comensales: 4,
    estado: "confirmada",
    espacio_id: "s1",
    telefono: "+34618190432",
    ...extra,
  }) as never;

describe("FilaReservaMovil", () => {
  it("por llegar con mesa: «Prevista: Mesa 3» y «Sentar · Mesa 3» sin abrir la ficha", () => {
    const onAbrir = vi.fn();
    const onSentar = vi.fn();
    render(
      <ul>
        <FilaReservaMovil reserva={reserva()} nombresMesa={["3"]} terminada={false} onAbrir={onAbrir} onSentar={onSentar} />
      </ul>,
    );
    expect(screen.getByText("Prevista: Mesa 3")).toBeInTheDocument();
    expect(screen.getByText("21:00")).toHaveClass("text-lg");
    expect(screen.getByText("Ana López")).toHaveClass("text-lg", "font-semibold");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Ana López en mesa 3" }));
    expect(onSentar).toHaveBeenCalledTimes(1);
    expect(onAbrir).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^21:00 Ana López, 4 personas/ }));
    expect(onAbrir).toHaveBeenCalledTimes(1);
  });

  it("teléfono: icono de 44 px con tel: que no abre la ficha (desde 375 px); sin teléfono, nada", () => {
    const onAbrir = vi.fn();
    const { unmount } = render(
      <ul>
        <FilaReservaMovil reserva={reserva()} nombresMesa={["3"]} terminada={false} onAbrir={onAbrir} />
      </ul>,
    );
    const enlace = screen.getByRole("link", { name: "Llamar a Ana López" });
    expect(enlace).toHaveAttribute("href", "tel:+34618190432");
    expect(enlace).toHaveAttribute("title", "618 19 04 32");
    expect(enlace).toHaveClass("h-11", "w-11", "pointer-events-auto", "min-[375px]:inline-flex");
    fireEvent.click(enlace);
    expect(onAbrir).not.toHaveBeenCalled();
    unmount();
    render(
      <ul>
        <FilaReservaMovil reserva={reserva({ telefono: "  " })} nombresMesa={["3"]} terminada={false} onAbrir={vi.fn()} />
      </ul>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("con la mesa prevista ocupada por alguien sentado, el botón dice «Sentar» (elegir mesa)", () => {
    render(
      <ul>
        <FilaReservaMovil reserva={reserva()} nombresMesa={["3"]} terminada={false} onAbrir={vi.fn()} onSentar={vi.fn()} mesaPrevistaOcupada />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Sentar a Ana López: elegir mesa" })).toHaveTextContent(/^Sentar$/);
  });

  it("sin mesa: «Sin mesa» y «Sentar» (elige mesa en la ficha)", () => {
    render(
      <ul>
        <FilaReservaMovil reserva={reserva()} nombresMesa={[]} terminada={false} onAbrir={vi.fn()} onSentar={vi.fn()} />
      </ul>,
    );
    expect(screen.getByText("Sin mesa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sentar a Ana López: elegir mesa" })).toHaveTextContent("Sentar");
  });

  it("sentada: «En mesa 9» y sin botón; las notas se ven con su icono", () => {
    render(
      <ul>
        <FilaReservaMovil
          reserva={reserva({ estado: "completada", notas_cliente: "Trona" })}
          nombresMesa={["9"]}
          terminada
          onAbrir={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByText("En mesa 9")).toBeInTheDocument();
    expect(screen.getByText("Trona")).toBeInTheDocument();
    expect(screen.getByLabelText("Notas del cliente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sentar/ })).toBeNull();
  });

  it("solo «Ver» (sin onSentar): ningún botón de sentar", () => {
    render(
      <ul>
        <FilaReservaMovil reserva={reserva()} nombresMesa={["3"]} terminada={false} tarde onAbrir={vi.fn()} />
      </ul>,
    );
    expect(screen.queryByRole("button", { name: /Sentar/ })).toBeNull();
    expect(screen.getByText("Tarde")).toBeInTheDocument();
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
