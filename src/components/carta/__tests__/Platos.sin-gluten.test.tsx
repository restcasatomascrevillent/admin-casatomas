import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlatoForm } from "../PlatoForm";
import { EditarPlatoModal } from "../EditarPlatoModal";
import type { Plato } from "@/hooks/usePlatos";

const mutaciones = vi.hoisted(() => ({ crear: vi.fn(), actualizar: vi.fn() }));
vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({
    crearPlato: { mutateAsync: mutaciones.crear, isPending: false },
    actualizarPlato: { mutateAsync: mutaciones.actualizar, isPending: false },
    categorias: ["SNACK"],
    unidades: ["unidad", "Unidad", "UD", "100g", "100 g", "kg"],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});
const plato = {
  id: "p1",
  nombre: "Croquetas",
  categoria: "SNACK",
  precio_eur: 12,
  descripcion: "Croquetas de jamón",
  alergenos_oficiales: ["gluten"],
  sin_gluten_disponible: true,
} as Plato;

beforeEach(() => {
  vi.clearAllMocks();
  mutaciones.crear.mockResolvedValue({ id: "p2" });
  mutaciones.actualizar.mockResolvedValue(undefined);
});

describe("«Se puede hacer para celíacos» al crear y editar platos", () => {
  const interruptor = () => screen.getByRole("switch", { name: "Se puede hacer para celíacos" });

  it("está siempre visible al crear y se guarda tal cual", async () => {
    render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="SNACK" />);
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Croquetas" },
    });
    // Sin gluten marcado también se puede cambiar (10/11/2026, dueño: «que sea modificable»).
    expect(interruptor()).not.toBeDisabled();
    expect(interruptor()).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Gluten" }));
    fireEvent.click(interruptor());
    expect(interruptor()).toBeChecked();
    // Quitar el gluten ya no lo apaga solo.
    fireEvent.click(screen.getByRole("button", { name: "Gluten" }));
    expect(interruptor()).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Gluten" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
    await waitFor(() =>
      expect(mutaciones.crear).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: "Croquetas",
          sin_gluten_disponible: true,
        }),
      ),
    );
  });

  it("recupera lo guardado y permite quitarlo sin borrar el alérgeno gluten", async () => {
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={plato} />);
    await waitFor(() => expect(interruptor()).toBeChecked());
    fireEvent.click(interruptor());
    expect(interruptor()).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() =>
      expect(mutaciones.actualizar).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "p1",
          sin_gluten_disponible: false,
          alergenos_oficiales: ["gluten"],
        }),
      ),
    );
  });
});

it("ofrece una sola Unidad y guarda el precio por la cantidad de gramos elegida", async () => {
  render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="SNACK" />);
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "  Jamón  " },
  });
  fireEvent.keyDown(screen.getByLabelText("Unidad"), { key: "ArrowDown" });
  expect(
    screen.getAllByRole("option", { name: "Unidad" }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("option", { name: "Gramos" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Sin alérgenos declarados" }),
  );
  fireEvent.change(screen.getByLabelText("Cantidad de gramos"), {
    target: { value: "150" },
  });
  fireEvent.change(screen.getByLabelText("Precio (€)"), {
    target: { value: "12" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
  await waitFor(() =>
    expect(mutaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: "Jamón",
        precio_eur: 12,
        unidad: "150 g",
      }),
    ),
  );
});

it("edita un peso antiguo y rechaza cero gramos, conservando su cantidad al reabrir", async () => {
  render(
    <EditarPlatoModal
      open
      onOpenChange={vi.fn()}
      plato={{ ...plato, unidad: "150gramos" }}
    />,
  );
  expect(screen.getByLabelText("Cantidad de gramos")).toHaveValue(150);
  fireEvent.change(screen.getByLabelText("Cantidad de gramos"), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  fireEvent.submit(
    screen.getByRole("button", { name: "Guardar cambios" }).closest("form")!,
  );
  await screen.findByText(
    "Indica una cantidad de gramos entera y mayor que cero",
  );
  expect(mutaciones.actualizar).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Cantidad de gramos"), {
    target: { value: "200" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(mutaciones.actualizar).toHaveBeenCalledWith(
      expect.objectContaining({ unidad: "200 g" }),
    ),
  );
});

it("rechaza nombres en blanco y no obliga a rellenar la información opcional", async () => {
  render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="SNACK" />);
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
  await screen.findByText("El nombre es obligatorio");
  expect(mutaciones.crear).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "Sopa" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Sin alérgenos declarados" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
  await waitFor(() =>
    expect(mutaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Sopa", unidad: "Unidad" }),
    ),
  );
});

it("no convierte un precio vacío en un plato gratuito", async () => {
  render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="SNACK" />);
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "Sopa" },
  });
  fireEvent.change(screen.getByLabelText("Precio (€)"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
  await screen.findByText("Indica un precio válido");
  expect(mutaciones.crear).not.toHaveBeenCalled();
});

it("exige una declaración al crear y guarda una confirmación expresa sin alérgenos", async () => {
  render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="SNACK" />);
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "Arroz" },
  });
  expect(
    screen.getByRole("button", { name: "Gluten" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Selecciona los alérgenos",
  );
  expect(mutaciones.crear).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Sin alérgenos declarados" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar Plato" }));
  await waitFor(() =>
    expect(mutaciones.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        alergenos_oficiales: ["sin alérgenos declarados"],
      }),
    ),
  );
});

it("un plato antiguo sin datos debe confirmarse, y sin alérgenos es excluyente", async () => {
  render(
    <EditarPlatoModal
      open
      onOpenChange={vi.fn()}
      plato={{ ...plato, alergenos_oficiales: null }}
    />,
  );
  const ninguno = screen.getByRole("button", {
    name: "Sin alérgenos declarados",
  });
  expect(ninguno).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByRole("alert");
  expect(mutaciones.actualizar).not.toHaveBeenCalled();
  fireEvent.click(ninguno);
  fireEvent.click(screen.getByRole("button", { name: "Gluten" }));
  expect(ninguno).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(mutaciones.actualizar).toHaveBeenCalledWith(
      expect.objectContaining({ alergenos_oficiales: ["gluten"] }),
    ),
  );
});

it("recupera la declaración sin alérgenos al volver a editar", () => {
  render(
    <EditarPlatoModal
      open
      onOpenChange={vi.fn()}
      plato={{ ...plato, alergenos_oficiales: ["sin alérgenos declarados"] }}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Sin alérgenos declarados" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.queryByRole("button", { name: "Quitar sin alérgenos declarados" }),
  ).not.toBeInTheDocument();
});
