import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { pedirIdeas, listarIdeas, guardarIdeas } = vi.hoisted(() => ({
  pedirIdeas: vi.fn(),
  listarIdeas: vi.fn(),
  guardarIdeas: vi.fn(),
}));

vi.mock("@/components/rrss/api", async () => {
  class ErrorRrss extends Error {
    tipo: string;
    constructor(m: string, tipo: string) {
      super(m);
      this.tipo = tipo;
    }
  }
  return {
    ErrorRrss,
    pedirIdeas,
    listarIdeas,
    guardarIdeas,
    ideaComoTexto: (i: { titulo: string }) => `TEXTO:${i.titulo}`,
  };
});
vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "p1", nombre: "Pulpo", categoria: "Raciones" }], error: null }).then(ok);
  return { supabase: { from: () => b } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IdeasGrabar } from "../IdeasGrabar";
import { ErrorRrss } from "@/components/rrss/api";
import { toast } from "sonner";

const idea = {
  titulo: "El vapor del pulpo",
  idea: "Primer plano del pulpo recién sacado",
  objetivo: "Reservas",
  formato: "reel",
  gancho: "Mira cómo humea",
  guion: ["Sale del caldero", "Se corta"],
  planos: [{ descripcion: "Pulpo en la mesa", duracion_s: 4, orientacion: "vertical", luz: "ventana lateral", encuadre: "cenital", movimiento: "plano fijo" }],
  duracion_total_s: 15,
  texto_pantalla: ["Pulpo a feira"],
  voz_en_off: null,
  material: ["Trípode pequeño"],
  copy: "Hoy toca pulpo",
  cta: "Reserva ya",
};

const elegirPlato = () => fireEvent.click(screen.getByRole("button", { name: /Un plato/ }));

beforeEach(() => {
  vi.clearAllMocks();
  listarIdeas.mockResolvedValue([]);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("IdeasGrabar", () => {
  it("no se puede pedir sin elegir qué promocionar", () => {
    render(<IdeasGrabar />);
    expect(screen.getByRole("button", { name: /Dame ideas/ })).toBeDisabled();
    elegirPlato();
    expect(screen.getByRole("button", { name: /Dame ideas/ })).toBeEnabled();
  });

  it("la petición lleva marca, canal, tipo, promocionar y material", async () => {
    pedirIdeas.mockResolvedValue({ id: "t1", ideas: [idea], preguntas: [], avisos: [] });
    render(<IdeasGrabar />);
    fireEvent.click(screen.getByRole("button", { name: "TOUZA" }));
    fireEvent.click(screen.getByRole("button", { name: "Facebook" }));
    fireEvent.change(screen.getByLabelText(/Formato preferido/), { target: { value: "reel" } });
    elegirPlato();
    fireEvent.change(screen.getByLabelText("Qué material tienes"), { target: { value: "solo el móvil" } });
    fireEvent.click(await screen.findByRole("button", { name: /Pulpo/ }));
    fireEvent.click(screen.getByRole("button", { name: /Dame ideas/ }));
    await waitFor(() => expect(pedirIdeas).toHaveBeenCalled());
    expect(pedirIdeas).toHaveBeenCalledWith({
      marca: "touza",
      canal: "facebook",
      tipo: "reel",
      promocionar: { tipo: "plato", platoId: "p1" },
      material: "solo el móvil",
    });
  });

  it("pinta gancho, planos, material y copy, y copiar guion usa ideaComoTexto", async () => {
    pedirIdeas.mockResolvedValue({ id: "t1", ideas: [idea], preguntas: [], avisos: ["Revisa los precios"] });
    render(<IdeasGrabar />);
    elegirPlato();
    fireEvent.click(screen.getByRole("button", { name: /Dame ideas/ }));
    expect(await screen.findByText("Mira cómo humea")).toBeInTheDocument();
    const plano = screen.getByTestId("plano");
    for (const t of [/Pulpo en la mesa/, /Vertical/, /ventana lateral/, /cenital/, /plano fijo/]) expect(within(plano).getByText(t)).toBeInTheDocument();
    expect(screen.getByText("Trípode pequeño")).toBeInTheDocument();
    expect(screen.getByText("Hoy toca pulpo")).toBeInTheDocument();
    expect(screen.getByText("Reserva ya")).toBeInTheDocument();
    expect(screen.getByText("Revisa los precios")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copiar guion" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("TEXTO:El vapor del pulpo"));
    expect(toast.success).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copiar texto de la publicación" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("Hoy toca pulpo\n\nReserva ya"));

    fireEvent.click(screen.getByRole("button", { name: /Guardar estas ideas/ }));
    await waitFor(() => expect(guardarIdeas).toHaveBeenCalledWith("t1", true));
  });

  it("muestra las preguntas de la IA", async () => {
    pedirIdeas.mockResolvedValue({ id: null, ideas: [idea], preguntas: ["¿Hay terraza?"], avisos: [] });
    render(<IdeasGrabar />);
    elegirPlato();
    fireEvent.click(screen.getByRole("button", { name: /Dame ideas/ }));
    expect(await screen.findByText("Para afinar, dime…")).toBeInTheDocument();
    expect(screen.getByText("¿Hay terraza?")).toBeInTheDocument();
  });

  it("error de cupo: mensaje sin botón de reintentar", async () => {
    pedirIdeas.mockRejectedValue(new ErrorRrss("Tope diario alcanzado", "cupo"));
    render(<IdeasGrabar />);
    elegirPlato();
    fireEvent.click(screen.getByRole("button", { name: /Dame ideas/ }));
    expect(await screen.findByText(/Tope diario alcanzado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it("otros errores ofrecen reintentar", async () => {
    pedirIdeas.mockRejectedValueOnce(new ErrorRrss("Fallo raro", "servidor"));
    render(<IdeasGrabar />);
    elegirPlato();
    fireEvent.click(screen.getByRole("button", { name: /Dame ideas/ }));
    expect(await screen.findByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });

  it("el historial recupera una tanda", async () => {
    listarIdeas.mockResolvedValue([
      { id: "h1", marca: "casa-tomas", canal: "instagram", tipo: null, objetivo: { que: "vino" }, propuestas: [idea], guardada: true, created_at: "2026-11-01T10:00:00Z" },
    ]);
    render(<IdeasGrabar />);
    fireEvent.click(screen.getByRole("button", { name: /Ideas anteriores/ }));
    expect(await screen.findByText("Guardada")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/un vino/));
    expect(await screen.findByText("Mira cómo humea")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ideas guardadas/ })).toBeDisabled();
  });
});
