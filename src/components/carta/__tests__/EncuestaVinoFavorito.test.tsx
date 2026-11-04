import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EncuestaVinoFavorito } from "@/components/carta/EncuestaVinoFavorito";

const mock = vi.hoisted(() => ({ cambiar: vi.fn(), vaciar: vi.fn(), puede: true, activa: false }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.puede, loading: false }) }));
vi.mock("@/hooks/useEncuestaVinos", async (original) => ({
  ...(await original<typeof import("@/hooks/useEncuestaVinos")>()),
  useEncuestaVinos: () => ({
    activa: mock.activa, disponible: true, cargando: false, error: false,
    cambiarActiva: { mutate: mock.cambiar, isPending: false },
    vaciar: { mutate: mock.vaciar, isPending: false },
    votos: { isLoading: false, isError: false, data: [
      { id: "1", vino_id: "a", vino_nombre: "Mauro", nombre: "Ana", contacto: "ana@x.es", idioma: "es", created_at: "2026-11-04T10:00:00Z" },
      { id: "2", vino_id: "a", vino_nombre: "Mauro", nombre: "Luis", contacto: "600112233", idioma: "es", created_at: "2026-11-04T10:05:00Z" },
      { id: "3", vino_id: "b", vino_nombre: "Alión", nombre: "Marta", contacto: "marta@x.es", idioma: "fr", created_at: "2026-11-04T10:06:00Z" },
    ] },
  }),
}));

beforeEach(() => { mock.cambiar.mockClear(); mock.vaciar.mockClear(); mock.puede = true; mock.activa = false; });

describe("Votación del vino favorito en el Gestor Web", () => {
  it("el interruptor abre y cierra la votación", () => {
    render(<EncuestaVinoFavorito />);
    fireEvent.click(screen.getByRole("switch", { name: /Vota tu vino favorito/ }));
    expect(mock.cambiar).toHaveBeenCalledWith(true);
  });
  it("sin permiso de edición no se puede cambiar", () => {
    mock.puede = false;
    render(<EncuestaVinoFavorito />);
    expect(screen.getByRole("switch", { name: /Vota tu vino favorito/ })).toBeDisabled();
  });
  it("resultados: ranking, sorteo y vaciar con confirmación", () => {
    render(<EncuestaVinoFavorito />);
    fireEvent.click(screen.getByRole("button", { name: "Resultados" }));
    const ranking = screen.getByRole("list", { name: "Votos por vino" });
    expect(within(ranking).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1.Mauro2", "2.Alión1"]);
    fireEvent.click(screen.getByRole("button", { name: "Sortear ganador" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Ganador: (Ana|Luis|Marta)/);
    fireEvent.click(screen.getByRole("button", { name: "Vaciar" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Vaciar" }));
    expect(mock.vaciar).toHaveBeenCalled();
  });
});
