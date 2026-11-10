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
const interruptor = (nombre: string) => screen.getByRole("switch", { name: nombre });

const flan = {
  id: "p1", nombre: "Flan", categoria: "POSTRES", precio_eur: 5, descripcion: "Flan de huevo",
  alergenos_oficiales: ["huevos", "lácteos"], alergenos_inferidos: null, alergenos_notas: null,
  etiquetas_dieteticas: null, sin_gluten_disponible: false, apto_celiacos: null, apto_sin_lactosa: null,
} as unknown as Plato;

describe("«Apto para» al crear y editar un plato", () => {
  it("tiene los cuatro interruptores que pidió el dueño", () => {
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={flan} />);
    for (const nombre of ["Se puede hacer para celíacos", "Apto para celíacos", "Apto para vegetarianos", "Apto sin lactosa"])
      expect(interruptor(nombre)).not.toBeDisabled();
  });

  it("al crear: se calcula en vivo con los alérgenos y los interruptores", async () => {
    render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="POSTRES" />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Flan" } });
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:No · Faltan los alérgenos");
    fireEvent.click(screen.getByRole("button", { name: "Huevos" }));
    fireEvent.click(screen.getByRole("button", { name: "Lácteos" }));
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:Sí · Sin gluten declarado");
    expect(interruptor("Apto para celíacos")).toBeChecked();
    expect(fila("lactosa")).toHaveTextContent("Sin lactosa:No · Lleva lácteos");
    expect(interruptor("Apto sin lactosa")).not.toBeChecked();
    expect(fila("vegetariano")).toHaveTextContent("Vegetarianos:No · Sin marcar");
    fireEvent.click(within(fila("vegetariano")).getByRole("switch", { name: "Apto para vegetarianos" }));
    expect(fila("vegetariano")).toHaveTextContent("Vegetarianos:Sí · Marcado como vegetariano");
    fireEvent.click(screen.getByRole("button", { name: "Gluten" }));
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:No · Lleva gluten");
    fireEvent.click(interruptor("Se puede hacer para celíacos"));
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:Sí · Se puede hacer sin gluten");
    fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
    await waitFor(() => expect(mutaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Flan", sin_gluten_disponible: true, etiquetas_dieteticas: ["vegetariano"] }),
    ));
    // En automático no se mandan las columnas a mano.
    expect(mutaciones.crear.mock.calls[0][0]).not.toHaveProperty("apto_celiacos");
    expect(mutaciones.crear.mock.calls[0][0]).not.toHaveProperty("apto_sin_lactosa");
  });

  it("al crear: se puede decidir a mano «Apto sin lactosa»", async () => {
    render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="POSTRES" />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Flan vegetal" } });
    fireEvent.click(screen.getByRole("button", { name: "Lácteos" }));
    fireEvent.click(interruptor("Apto sin lactosa"));
    expect(fila("lactosa")).toHaveTextContent("Sin lactosa:Sí · Marcado a mano");
    fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
    await waitFor(() => expect(mutaciones.crear).toHaveBeenCalledWith(expect.objectContaining({ apto_sin_lactosa: true })));
    expect(mutaciones.crear.mock.calls[0][0]).not.toHaveProperty("apto_celiacos");
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
    expect(within(fila("vegetariano")).getByRole("switch")).toBeChecked();
    expect(fila("vegetariano")).toHaveTextContent("Vegetarianos:No · Marcado, pero el texto dice «consultar»");
  });

  it("al editar: decide a mano celíacos y sin lactosa y solo manda lo que cambia", async () => {
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={flan} />);
    expect(fila("celiaquia")).toHaveTextContent("Automático, según los alérgenos.");
    fireEvent.click(interruptor("Apto para celíacos")); // Sí (auto) → No a mano
    expect(fila("celiaquia")).toHaveTextContent("Celíacos:No · Desmarcado a mano");
    expect(fila("celiaquia")).toHaveTextContent("Decidido a mano.");
    fireEvent.click(interruptor("Apto sin lactosa")); // No (auto) → Sí a mano
    expect(fila("lactosa")).toHaveTextContent("Sin lactosa:Sí · Marcado a mano");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mutaciones.actualizar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", apto_celiacos: false, apto_sin_lactosa: true }),
    ));
  });

  it("al editar: recupera lo decidido a mano y «Volver a automático» lo deja en NULL", async () => {
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={{ ...flan, apto_sin_lactosa: true }} />);
    expect(interruptor("Apto sin lactosa")).toBeChecked();
    expect(fila("lactosa")).toHaveTextContent("Sin lactosa:Sí · Marcado a mano");
    fireEvent.click(within(fila("lactosa")).getByRole("button", { name: "Volver a automático" }));
    expect(fila("lactosa")).toHaveTextContent("Sin lactosa:No · Lleva lácteos");
    expect(interruptor("Apto sin lactosa")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mutaciones.actualizar).toHaveBeenCalled());
    const enviado = mutaciones.actualizar.mock.calls[0][0];
    expect(enviado.apto_sin_lactosa).toBeNull();
    expect(enviado).not.toHaveProperty("apto_celiacos");
  });

  it("al editar: si pulsar deja el mismo valor que los alérgenos, sigue en automático", async () => {
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={flan} />);
    fireEvent.click(interruptor("Apto para celíacos"));
    fireEvent.click(interruptor("Apto para celíacos"));
    expect(fila("celiaquia")).toHaveTextContent("Automático, según los alérgenos.");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mutaciones.actualizar).toHaveBeenCalled());
    expect(mutaciones.actualizar.mock.calls[0][0]).not.toHaveProperty("apto_celiacos");
  });

  it("sin la migración aplicada, los dos interruptores a mano no se pueden cambiar y el plato se guarda igual", async () => {
    const { apto_celiacos: _a, apto_sin_lactosa: _b, ...sinColumnas } = flan as Plato & Record<string, unknown>;
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={sinColumnas as Plato} />);
    expect(interruptor("Apto para celíacos")).toBeDisabled();
    expect(interruptor("Apto sin lactosa")).toBeDisabled();
    expect(interruptor("Apto para vegetarianos")).not.toBeDisabled();
    expect(fila("lactosa")).toHaveTextContent("falta preparar la base de datos");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mutaciones.actualizar).toHaveBeenCalled());
    expect(mutaciones.actualizar.mock.calls[0][0]).not.toHaveProperty("apto_celiacos");
    expect(mutaciones.actualizar.mock.calls[0][0]).not.toHaveProperty("apto_sin_lactosa");
  });
});
