/**
 * Tests para src/components/ErrorBoundary.tsx
 *
 * Verifican que una excepción durante el render no deja la pantalla en blanco,
 * que "Reintentar" vuelve a montar los hijos y que el boundary se resetea al
 * cambiar de ruta (resetKey).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ErrorBoundary, RouteErrorBoundary } from "@/components/ErrorBoundary";

const Explota = ({ fallar }: { fallar: boolean }) => {
  if (fallar) throw new Error("Invalid time value");
  return <p>Contenido correcto</p>;
};

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React registra el error por su cuenta además de nuestro console.error
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renderiza los hijos cuando no hay error", () => {
    render(
      <ErrorBoundary>
        <Explota fallar={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Contenido correcto")).toBeInTheDocument();
  });

  it("muestra el fallback con el mensaje del error en vez de una pantalla en blanco", () => {
    render(
      <ErrorBoundary>
        <Explota fallar />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Esta sección no se ha podido cargar")).toBeInTheDocument();
    expect(screen.getByText("Invalid time value")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recargar página/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Volver al inicio/i })).toBeInTheDocument();
  });

  it("loguea el error en la consola", () => {
    render(
      <ErrorBoundary contexto="/reservas">
        <Explota fallar />
      </ErrorBoundary>,
    );

    const llamadas = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas.some((args: unknown[]) => String(args[0]).includes("[ErrorBoundary] [/reservas]"))).toBe(true);
  });

  it("«Reintentar» vuelve a montar los hijos", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Explota fallar />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Invalid time value")).toBeInTheDocument();

    // El fallo ya no se reproduce (p. ej. los datos se han refrescado)
    rerender(
      <ErrorBoundary>
        <Explota fallar={false} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(screen.getByText("Contenido correcto")).toBeInTheDocument();
  });

  it("se resetea al cambiar resetKey, para poder navegar a otra sección", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/facturas">
        <Explota fallar />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Invalid time value")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/reservas">
        <Explota fallar={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Contenido correcto")).toBeInTheDocument();
    expect(screen.queryByText("Invalid time value")).not.toBeInTheDocument();
  });
});

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captura el error dentro del router y muestra el fallback", () => {
    render(
      <MemoryRouter initialEntries={["/facturas"]}>
        <RouteErrorBoundary>
          <Explota fallar />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText("Esta sección no se ha podido cargar")).toBeInTheDocument();
    expect(screen.getByText("Invalid time value")).toBeInTheDocument();
  });
});
