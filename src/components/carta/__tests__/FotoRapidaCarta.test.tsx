/**
 * Botón «Foto» de las tarjetas de la carta y el fallo «no deja subir fotos,
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
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar foto" })).toBeEnabled());
}

describe("Tarjeta de plato", () => {
  it("enseña la categoría y los botones Foto, Editar y Eliminar", () => {
    render(<ListaPlatos platos={[plato]} />);
    expect(screen.getByTitle("Categoría: Entrantes")).toHaveTextContent("Entrantes");
    for (const nombre of ["Foto", "Editar", "Eliminar"]) {
      expect(screen.getByRole("button", { name: nombre })).toBeInTheDocument();
    }
  });

  it("«Foto» abre el selector en el mismo clic, sube la foto, guarda imagen_url y borra la antigua", async () => {
    render(<ListaPlatos platos={[plato]} />);
    // Las fotos empiezan ocultas en el panel.
    expect(screen.queryByAltText("Croquetas")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));

    const input = screen.getByTestId("foto-rapida-input") as HTMLInputElement;
    expect(clicsInput).toEqual([input]);
    expect(screen.getByRole("dialog", { name: "Foto de Croquetas" })).toBeInTheDocument();

    await elegirFoto(input);
    fireEvent.click(screen.getByRole("button", { name: "Guardar foto" }));

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

  it("con la foto elegida, un toque fuera del diálogo NO lo cierra ni pierde la foto", async () => {
    render(<ListaPlatos platos={[plato]} />);
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    await elegirFoto(screen.getByTestId("foto-rapida-input") as HTMLInputElement);

    // Radix registra el listener de «toque fuera» en el siguiente tick.
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    fireEvent.pointerDown(document.body);
    fireEvent.focusIn(document.body);

    expect(screen.getByRole("dialog", { name: "Foto de Croquetas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar foto" })).toBeEnabled();
  });

  it("si se cancela el selector sin elegir foto, el diálogo se cierra solo", async () => {
    render(<ListaPlatos platos={[plato]} />);
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      screen.getByTestId("foto-rapida-input").dispatchEvent(new Event("cancel"));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.subir).not.toHaveBeenCalled();
  });

  it("si la subida falla, el diálogo sigue abierto con la foto para reintentar", async () => {
    mocks.subir.mockRejectedValueOnce(new Error("sin red"));
    render(<ListaPlatos platos={[plato]} />);
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    await elegirFoto(screen.getByTestId("foto-rapida-input") as HTMLInputElement);
    fireEvent.click(screen.getByRole("button", { name: "Guardar foto" }));
    await waitFor(() => expect(mocks.subir).toHaveBeenCalled());
    expect(mocks.actualizar).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar foto" })).toBeEnabled());
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
