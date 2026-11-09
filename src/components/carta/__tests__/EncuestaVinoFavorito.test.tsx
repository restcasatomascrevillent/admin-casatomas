import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EncuestaVinoFavorito } from "@/components/carta/EncuestaVinoFavorito";

const mock = vi.hoisted(() => ({
  cambiar: vi.fn(), vaciar: vi.fn(), guardar: vi.fn(), puede: true, activa: false,
  premio: "Una cena para dos", fin: "2099-12-31" as string | null, puedeAbrir: true,
}));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.puede, loading: false }) }));
vi.mock("@/hooks/useEncuestaVinos", async (original) => ({
  ...(await original<typeof import("@/hooks/useEncuestaVinos")>()),
  useEncuestaVinos: () => ({
    activa: mock.activa, premio: mock.premio, fin: mock.fin, puedeAbrir: mock.puedeAbrir,
    guardarPremioFecha: { mutate: mock.guardar, isPending: false },
    disponible: true, cargando: false, error: false,
    cambiarActiva: { mutate: mock.cambiar, isPending: false },
    vaciar: { mutate: mock.vaciar, isPending: false },
    votos: { isLoading: false, isError: false, data: [
      { id: "1", vino_id: "a", vino_nombre: "Mauro", nombre: "Ana", contacto: "ana@x.es", idioma: "es", created_at: "2026-11-04T10:00:00Z" },
      { id: "2", vino_id: "a", vino_nombre: "Mauro", nombre: "Luis", contacto: "600112233", idioma: "es", created_at: "2026-11-04T10:05:00Z" },
      { id: "3", vino_id: "b", vino_nombre: "Alión", nombre: "Marta", contacto: "marta@x.es", idioma: "fr", created_at: "2026-11-04T10:06:00Z" },
    ] },
  }),
}));

beforeEach(() => {
  mock.cambiar.mockClear(); mock.vaciar.mockClear(); mock.guardar.mockClear();
  mock.puede = true; mock.activa = false; mock.premio = "Una cena para dos"; mock.fin = "2099-12-31"; mock.puedeAbrir = true;
});

describe("Votación del vino favorito en el Gestor Web", () => {
  it("el interruptor abre y cierra la votación", () => {
    render(<EncuestaVinoFavorito />);
    fireEvent.click(screen.getByRole("switch", { name: /Vota tu vino favorito/ }));
    expect(mock.cambiar).toHaveBeenCalledWith(true);
  });
  it("con solo «Ver» (06/11/2026): se lee si está abierta, sin interruptor ni «Resultados» (nombres y contactos)", () => {
    mock.puede = false;
    mock.activa = true;
    const { rerender } = render(<EncuestaVinoFavorito />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resultados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vaciar" })).not.toBeInTheDocument();
    expect(screen.getByText(/Vota tu vino favorito/)).toBeInTheDocument();
    expect(screen.getByTestId("estado-votacion")).toHaveTextContent("Abierta en la web");
    mock.activa = false;
    rerender(<EncuestaVinoFavorito />);
    expect(screen.getByTestId("estado-votacion")).toHaveTextContent("Cerrada");
    expect(mock.cambiar).not.toHaveBeenCalled();
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
  });
  it("con «Editar» no sale la etiqueta de estado de solo lectura", () => {
    render(<EncuestaVinoFavorito />);
    expect(screen.queryByTestId("estado-votacion")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Vota tu vino favorito/ })).toBeEnabled();
  });
  it("sin premio o sin fecha el interruptor no se puede encender y se explica por qué", () => {
    mock.premio = "";
    mock.fin = null;
    mock.puedeAbrir = false;
    render(<EncuestaVinoFavorito />);
    const interruptor = screen.getByRole("switch", { name: /Vota tu vino favorito/ });
    expect(interruptor).toBeDisabled();
    expect(screen.getByTestId("ayuda-abrir")).toHaveTextContent(
      "Para abrir la votación, pon el premio y el último día para votar. Las bases legales de la web los muestran",
    );
    expect(interruptor).toHaveAttribute("aria-describedby", screen.getByTestId("ayuda-abrir").id);
  });
  it("con la fecha ya pasada tampoco se abre", () => {
    mock.fin = "2020-01-01";
    mock.puedeAbrir = false;
    render(<EncuestaVinoFavorito />);
    expect(screen.getByRole("switch", { name: /Vota tu vino favorito/ })).toBeDisabled();
    expect(screen.getByTestId("ayuda-abrir")).toBeInTheDocument();
  });
  it("abierta y con premio y fecha: se puede cerrar y los campos están bloqueados con su explicación", () => {
    mock.activa = true;
    render(<EncuestaVinoFavorito />);
    expect(screen.getByRole("switch", { name: /Vota tu vino favorito/ })).toBeEnabled();
    expect(screen.getByLabelText("Premio")).toBeDisabled();
    expect(screen.getByLabelText("Último día para votar")).toBeDisabled();
    expect(screen.getByTestId("aviso-cambiar")).toHaveTextContent("cierra antes la votación");
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });
  it("cerrada: los campos enseñan lo guardado, «Guardar» envía los cambios y avisa de los errores", () => {
    render(<EncuestaVinoFavorito />);
    const premio = screen.getByLabelText("Premio");
    const fin = screen.getByLabelText("Último día para votar");
    expect(premio).toHaveValue("Una cena para dos");
    expect(premio).toHaveAttribute("maxlength", "200");
    expect(fin).toHaveAttribute("type", "date");
    expect(fin).toHaveValue("2099-12-31");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    fireEvent.change(premio, { target: { value: "ab" } });
    expect(screen.getByRole("alert")).toHaveTextContent("al menos 3 letras");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    fireEvent.change(premio, { target: { value: "  Un jamón  " } });
    fireEvent.change(fin, { target: { value: "2099-06-30" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(mock.guardar).toHaveBeenCalledWith({ premio: "  Un jamón  ", fin: "2099-06-30" }, expect.any(Object));
  });
  it("con solo «Ver» se muestran el premio y la fecha en texto, sin campos", () => {
    mock.puede = false;
    render(<EncuestaVinoFavorito />);
    expect(screen.getByTestId("premio-fecha-lectura")).toHaveTextContent("Una cena para dos");
    expect(screen.getByTestId("premio-fecha-lectura")).toHaveTextContent("31/12/2099");
    expect(screen.queryByLabelText("Premio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
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
