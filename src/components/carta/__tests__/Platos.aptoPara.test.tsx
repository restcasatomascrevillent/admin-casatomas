import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlatoForm } from "../PlatoForm";
import { EditarPlatoModal } from "../EditarPlatoModal";
import type { Plato } from "@/hooks/usePlatos";

const mutaciones = vi.hoisted(() => ({ crear: vi.fn(), actualizar: vi.fn() }));
vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({
    crearPlato: { mutateAsync: mutaciones.crear, isPending: false },
    actualizarPlato: { mutateAsync: mutaciones.actualizar, isPending: false },
    categorias: ["POSTRES"],
    unidades: ["unidad", "Unidad"],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  mutaciones.crear.mockResolvedValue({ id: "nuevo" });
  mutaciones.actualizar.mockResolvedValue(undefined);
});

const fila = (dieta: string) => screen.getByTestId("apto-para").querySelector(`[data-dieta="${dieta}"]`) as HTMLElement;

describe("«Apto para» al crear y editar un plato", () => {
  it("al crear: se calcula en vivo con los alérgenos y las casillas", async () => {
    render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="POSTRES" />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Flan" } });
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:No · Faltan los alérgenos");
    fireEvent.click(screen.getByRole("button", { name: "Huevos" }));
    fireEvent.click(screen.getByRole("button", { name: "Lácteos" }));
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:Sí · Sin gluten declarado");
    expect(fila("lactosa")).toHaveTextContent("Sin lactosa:No · Lleva lácteos");
    expect(fila("vegetariano")).toHaveTextContent("Vegetarianos:No · Sin marcar");
    fireEvent.click(within(fila("vegetariano")).getByRole("checkbox", { name: "Vegetariano (sin carne, pescado ni marisco)" }));
    expect(fila("vegetariano")).toHaveTextContent("Vegetarianos:Sí · Marcado como vegetariano");
    fireEvent.click(screen.getByRole("button", { name: "Gluten" }));
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:No · Lleva gluten");
    fireEvent.click(within(fila("celiaquia")).getByRole("checkbox", { name: "Se puede hacer sin gluten" }));
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:Sí · Se puede hacer sin gluten");
    fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
    await waitFor(() => expect(mutaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Flan", sin_gluten_disponible: true, etiquetas_dieteticas: ["vegetariano"] }),
    ));
  });

  it("al editar: cuenta también los inferidos y la nota guardados", () => {
    const plato = {
      id: "p1", nombre: "Helado 2 und.", categoria: "POSTRES", precio_eur: 6, descripcion: "Dos bolas de helado",
      alergenos_oficiales: ["huevos"], alergenos_inferidos: ["lácteos"], alergenos_notas: "Para los alérgenos consultar al personal",
      etiquetas_dieteticas: ["vegetariano"],
    } as unknown as Plato;
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={plato} />);
    expect(fila("lactosa")).toHaveTextContent("Sin lactosa:No · Lleva lácteos");
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:No · La nota de alérgenos remite al personal");
    expect(within(fila("vegetariano")).getByRole("checkbox")).toBeChecked();
    expect(fila("vegetariano")).toHaveTextContent("Vegetarianos:No · Marcado, pero el texto dice «consultar»");
  });
});
