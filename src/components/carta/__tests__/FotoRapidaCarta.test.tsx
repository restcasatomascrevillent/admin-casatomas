/**
 * Botón «Foto» de las tarjetas de la carta (ventana con la foto actual o «Sin
 * foto», «Guardar» y «Cambiar/Añadir foto») y el fallo «no deja subir fotos,
 * cuando las subo se me cierra»: el diálogo con la foto elegida no puede
 * cerrarse por un toque «fuera» (el que llega al volver del selector de fotos
 * o de la cámara del móvil, o un toque sobre un aviso).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Plato } from "@/hooks/usePlatos";

const mocks = vi.hoisted(() => ({
  actualizar: vi.fn(),
  subir: vi.fn(),
  borrar: vi.fn(),
}));

vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({
    toggleExpanded: { mutate: vi.fn(), isPending: false },
    toggleActivado: { mutate: vi.fn(), isPending: false },
    eliminarPlato: { mutate: vi.fn(), isPending: false },
    actualizarPlato: { mutate: vi.fn(), mutateAsync: mocks.actualizar, isPending: false },
    categorias: ["Entrantes"],
    unidades: ["Unidad"],
  }),
}));
vi.mock("../subirFotoCarta", async (original) => ({
  ...(await original<typeof import("../subirFotoCarta")>()),
  subirFotoCarta: mocks.subir,
}));
vi.mock("@/lib/storage-carta", () => ({ borrarFotoSiNoSeUsa: mocks.borrar }));
// Sin recorte en jsdom: la foto se queda como «original» (igual que si falla en el móvil).
vi.mock("../fotoCartaVino", async (original) => ({
  ...(await original<typeof import("../fotoCartaVino")>()),
  quitarFondo: vi.fn(async () => {
    throw Object.assign(new Error("sin token"), { codigo: "sin_token" });
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ListaPlatos } from "../ListaPlatos";
import { EditarPlatoModal } from "../EditarPlatoModal";

const URL_ANTIGUA = "https://x.supabase.co/storage/v1/object/public/platos/p1.jpg?t=1";
const plato = {
  id: "p1",
  nombre: "Croquetas",
  categoria: "Entrantes",
  precio_eur: 12,
  imagen_url: URL_ANTIGUA,
  activado: true,
  alergenos_oficiales: ["gluten"],
} as Plato;

let clicsInput: HTMLInputElement[] = [];

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  clicsInput = [];
  // jsdom no abre ningún selector: se anota a qué input se le hizo clic.
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    clicsInput.push(this);
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:foto"), revokeObjectURL: vi.fn() }));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
  mocks.subir.mockResolvedValue({
    url: "https://x.supabase.co/storage/v1/object/public/platos/p1.png?t=2",
    rutas: ["p1.png"],
    rutaPrincipal: "p1.png",
  });
  mocks.actualizar.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fotoNueva = () => new File(["foto"], "foto.png", { type: "image/png" });

async function elegirFoto(input: HTMLInputElement) {
  await act(async () => {
    fireEvent.change(input, { target: { files: [fotoNueva()] } });
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled());
}

/** Abre «Foto» en la tarjeta y pulsa «Cambiar foto» / «Añadir foto» (abre el selector). */
function abrirYPedirFoto(boton: "Cambiar foto" | "Añadir foto" = "Cambiar foto") {
  fireEvent.click(screen.getByRole("button", { name: "Foto" }));
  fireEvent.click(screen.getByRole("button", { name: boton }));
  return screen.getByTestId("foto-rapida-input") as HTMLInputElement;
}

describe("Tarjeta de plato", () => {
  it("enseña la categoría y los botones Foto, Editar y Eliminar", () => {
    render(<ListaPlatos platos={[plato]} />);
    expect(screen.getByTitle("Categoría: Entrantes")).toHaveTextContent("Entrantes");
    for (const nombre of ["Foto", "Editar", "Eliminar"]) {
      expect(screen.getByRole("button", { name: nombre })).toBeInTheDocument();
    }
  });

  it("«Foto» enseña la foto actual con «Guardar» y «Cambiar foto»; cambiarla la sube y borra la antigua", async () => {
    render(<ListaPlatos platos={[plato]} />);
    // Las fotos empiezan ocultas en el panel.
    expect(screen.queryByAltText("Croquetas")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));

    // Se abre la ventana (sin saltar a la galería) con la foto que tiene ahora.
    expect(screen.getByRole("dialog", { name: "Foto de Croquetas" })).toBeInTheDocument();
    expect(screen.getByAltText("Foto actual de Croquetas")).toHaveAttribute("src", URL_ANTIGUA);
    expect(clicsInput).toEqual([]);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar foto" }));
    const input = screen.getByTestId("foto-rapida-input") as HTMLInputElement;
    expect(clicsInput).toEqual([input]);

    await elegirFoto(input);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocks.actualizar).toHaveBeenCalledWith({
        id: "p1",
        imagen_url: "https://x.supabase.co/storage/v1/object/public/platos/p1.png?t=2",
      }),
    );
    expect(mocks.subir).toHaveBeenCalledWith("platos", "p1", { original: expect.any(File), compuesta: null });
    expect(mocks.borrar).toHaveBeenCalledWith({ tabla: "Platos", bucket: "platos", ruta: "p1.jpg", excluirId: "p1" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Y la tarjeta enseña la foto recién subida.
    expect(screen.getByAltText("Croquetas")).toBeInTheDocument();
  });

  it("sin foto: recuadro «Sin foto» y el botón dice «Añadir foto»", async () => {
    render(<ListaPlatos platos={[{ ...plato, imagen_url: null } as Plato]} />);
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    expect(screen.getByRole("img", { name: "Sin foto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cambiar foto" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Añadir foto" }));
    await elegirFoto(screen.getByTestId("foto-rapida-input") as HTMLInputElement);
    // Con una foto ya elegida, el botón pasa a «Cambiar foto».
    expect(screen.getByRole("button", { name: "Cambiar foto" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalled());
    expect(mocks.borrar).not.toHaveBeenCalled();
  });

  it("con la foto elegida, un toque fuera del diálogo NO lo cierra ni pierde la foto", async () => {
    render(<ListaPlatos platos={[plato]} />);
    await elegirFoto(abrirYPedirFoto());

    // Radix registra el listener de «toque fuera» en el siguiente tick.
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    fireEvent.pointerDown(document.body);
    fireEvent.focusIn(document.body);

    expect(screen.getByRole("dialog", { name: "Foto de Croquetas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("«Eliminar foto» pide confirmación, quita la foto (y la foto expandida) y borra el fichero", async () => {
    render(<ListaPlatos platos={[{ ...plato, expanded: true } as Plato]} />);
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar foto" }));
    // Primero confirma: aún no ha tocado nada.
    expect(mocks.actualizar).not.toHaveBeenCalled();
    expect(screen.getByText("¿Eliminar la foto? Se quitará de la carta y de la web.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar" }));

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledWith({ id: "p1", imagen_url: null, expanded: false }));
    await waitFor(() =>
      expect(mocks.borrar).toHaveBeenCalledWith({ tabla: "Platos", bucket: "platos", ruta: "p1.jpg", excluirId: "p1" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.subir).not.toHaveBeenCalled();
  });

  it("«Cancelar» en la confirmación no borra nada; sin foto no hay «Eliminar foto»", async () => {
    const { unmount } = render(<ListaPlatos platos={[plato]} />);
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar foto" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Eliminar foto" })).toBeInTheDocument();
    expect(mocks.actualizar).not.toHaveBeenCalled();
    unmount();

    render(<ListaPlatos platos={[{ ...plato, imagen_url: null } as Plato]} />);
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    expect(screen.queryByRole("button", { name: "Eliminar foto" })).not.toBeInTheDocument();
  });

  it("si se cancela la galería sin elegir foto, la ventana sigue abierta con la foto actual", async () => {
    render(<ListaPlatos platos={[plato]} />);
    const input = abrirYPedirFoto();
    await act(async () => {
      input.dispatchEvent(new Event("cancel"));
    });
    expect(screen.getByRole("dialog", { name: "Foto de Croquetas" })).toBeInTheDocument();
    expect(screen.getByAltText("Foto actual de Croquetas")).toBeInTheDocument();
    expect(mocks.subir).not.toHaveBeenCalled();
  });

  it("si la subida falla, el diálogo sigue abierto con la foto para reintentar", async () => {
    mocks.subir.mockRejectedValueOnce(new Error("sin red"));
    render(<ListaPlatos platos={[plato]} />);
    await elegirFoto(abrirYPedirFoto());
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocks.subir).toHaveBeenCalled());
    expect(mocks.actualizar).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled());
    expect(screen.getByRole("dialog", { name: "Foto de Croquetas" })).toBeInTheDocument();
  });
});

describe("Formulario de edición con foto", () => {
  it("un toque fuera no cierra «Editar plato» (control: un diálogo normal sí se cierra)", async () => {
    // Control: sin la protección, Radix cierra el diálogo con un toque fuera.
    const cierraNormal = vi.fn();
    const { unmount } = render(
      <Dialog open onOpenChange={cierraNormal}>
        <DialogContent>
          <DialogTitle>Normal</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    fireEvent.pointerDown(document.body);
    expect(cierraNormal).toHaveBeenCalledWith(false);
    unmount();

    const onOpenChange = vi.fn();
    render(<EditarPlatoModal open onOpenChange={onOpenChange} plato={plato} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    fireEvent.pointerDown(document.body);
    fireEvent.focusIn(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Editar Plato" })).toBeInTheDocument();
  });
});
