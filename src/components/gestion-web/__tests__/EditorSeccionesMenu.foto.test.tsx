// Foto de los platos «A mano» del menú del día. Antes el hueco era un adorno
// gris sin acción: un plato escrito a mano (p. ej. «polla en vinagre») no podía
// llevar foto nunca. Los de la carta siguen con la foto de la carta, intocable.

import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/foto-menu-dia", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/foto-menu-dia")>();
  return { ...real, subirFotoMenu: vi.fn() };
});

import { toast } from "sonner";
import { subirFotoMenu } from "@/lib/foto-menu-dia";
import { EditorSeccionesMenu } from "@/components/gestion-web/EditorSeccionesMenu";
import { itemDesdePlato, itemLibre, type ItemMenu, type SeccionMenu } from "@/lib/menu-dia";

type Secciones = Record<SeccionMenu, ItemMenu[]>;

const URL_SUBIDA = "https://x.supabase.co/storage/v1/object/public/novedades/menu-dia/1-abc.jpg";

let ultimo: Secciones;

function Harness({ inicial }: { inicial: Secciones }) {
  const [secciones, setSecciones] = useState(inicial);
  ultimo = secciones;
  return (
    <EditorSeccionesMenu
      secciones={secciones}
      onChange={setSecciones}
      platos={[]}
      platosPorId={new Map()}
      cargandoPlatos={false}
    />
  );
}

const con = (primero: ItemMenu[]): Secciones => ({ primero, segundo: [], postre: [] });

/** Con la firma JPG en los primeros bytes (aceptarFoto mira el tipo real). */
const foto = (tipo = "image/jpeg", bytes = 1024, cabecera = [0xff, 0xd8, 0xff, 0xe0]) => {
  const datos = new Uint8Array(bytes);
  datos.set(cabecera);
  return new File([datos], "foto.jpg", { type: tipo });
};

const elegir = (file: File) =>
  fireEvent.change(screen.getByTestId("input-foto-plato"), { target: { files: [file] } });

beforeEach(() => {
  vi.mocked(subirFotoMenu).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EditorSeccionesMenu — foto de un plato «A mano»", () => {
  it("el hueco vacío es un botón accesible que sube la foto y la pinta", async () => {
    let resolver!: (url: string) => void;
    vi.mocked(subirFotoMenu).mockReturnValue(new Promise((ok) => (resolver = ok)));
    render(<Harness inicial={con([itemLibre("polla en vinagre")])} />);

    const boton = screen.getByRole("button", { name: "Subir foto de polla en vinagre" });
    expect(boton.tagName).toBe("BUTTON"); // nativo: Tab + Enter/Espacio sin más

    const archivo = foto();
    elegir(archivo);

    // Mientras sube: spinner y botón bloqueado.
    const subiendo = await screen.findByRole("button", { name: "Subiendo foto de polla en vinagre" });
    expect(subiendo).toBeDisabled();
    expect(subirFotoMenu).toHaveBeenCalledWith(archivo);

    await act(async () => resolver(URL_SUBIDA));

    const conFoto = await screen.findByRole("button", { name: "Cambiar o quitar la foto de polla en vinagre" });
    expect(conFoto.querySelector("img")).toHaveAttribute("src", URL_SUBIDA);
    expect(ultimo.primero[0]).toMatchObject({ imagenUrl: URL_SUBIDA, imagenPosicionY: null, origen: "libre" });
  });

  it("rechaza lo que no es una foto sin llegar a subirlo", async () => {
    render(<Harness inicial={con([itemLibre("polla en vinagre")])} />);
    elegir(foto("application/pdf", 1024, [0x25, 0x50, 0x44, 0x46]));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/JPG, PNG o WebP/), expect.anything()),
    );
    expect(subirFotoMenu).not.toHaveBeenCalled();
  });

  it("rechaza texto renombrado a .jpg aunque diga image/jpeg", async () => {
    render(<Harness inicial={con([itemLibre("polla en vinagre")])} />);
    elegir(new File(["hola, esto es texto"], "foto.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no es una foto válida/), expect.anything()),
    );
    expect(subirFotoMenu).not.toHaveBeenCalled();
  });

  it("rechaza una foto demasiado pesada", async () => {
    render(<Harness inicial={con([itemLibre("polla en vinagre")])} />);
    elegir(foto("image/jpeg", 6 * 1024 * 1024));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/máximo son 5 MB/), expect.anything()),
    );
    expect(subirFotoMenu).not.toHaveBeenCalled();
  });

  it("si Storage falla avisa en español y el hueco sigue listo para reintentar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(subirFotoMenu).mockRejectedValue(new Error("403"));
    render(<Harness inicial={con([itemLibre("polla en vinagre")])} />);

    elegir(foto());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No se pudo subir la foto. Inténtalo de nuevo.", expect.anything()),
    );
    expect(screen.getByRole("button", { name: "Subir foto de polla en vinagre" })).toBeEnabled();
    expect(ultimo.primero[0].imagenUrl).toBeNull();
  });

  it("con foto: se puede quitar desde el menú (con teclado)", async () => {
    const item = { ...itemLibre("polla en vinagre"), imagenUrl: URL_SUBIDA, imagenPosicionY: 30 };
    render(<Harness inicial={con([item])} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Cambiar o quitar la foto de polla en vinagre" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Quitar foto" }));

    const subir = await screen.findByRole("button", { name: "Subir foto de polla en vinagre" });
    expect(ultimo.primero[0]).toMatchObject({ imagenUrl: null, imagenPosicionY: null });
    // El botón cambia, pero el foco no se pierde en <body>.
    await waitFor(() => expect(subir).toHaveFocus());
  });

  it("con foto: «Cambiar foto» abre el selector de archivos", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const item = { ...itemLibre("polla en vinagre"), imagenUrl: URL_SUBIDA };
    render(<Harness inicial={con([item])} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /cambiar o quitar la foto/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cambiar foto" }));

    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("no pisa lo que se edite mientras la foto sube", async () => {
    let resolver!: (url: string) => void;
    vi.mocked(subirFotoMenu).mockReturnValue(new Promise((ok) => (resolver = ok)));
    render(<Harness inicial={con([itemLibre("polla")])} />);

    elegir(foto());
    await waitFor(() => expect(subirFotoMenu).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("Nombre del plato"), { target: { value: "polla en vinagre" } });
    await act(async () => resolver(URL_SUBIDA));

    expect(ultimo.primero[0]).toMatchObject({ nombre: "polla en vinagre", imagenUrl: URL_SUBIDA });
  });

  it("los platos de la carta conservan su foto y no ofrecen subir otra", () => {
    const deCarta = itemDesdePlato({ id: "p1", nombre: "Pulpo á feira", imagen_url: "https://x/platos/p1.jpg" });
    render(<Harness inicial={con([deCarta])} />);

    const seccion = screen.getByTestId("seccion-menu-primero");
    expect(within(seccion).queryByRole("button", { name: /foto/i })).toBeNull();
    expect(screen.queryByTestId("input-foto-plato")).toBeNull();
    expect(seccion.querySelector("img")).toHaveAttribute("src", "https://x/platos/p1.jpg");
  });
});
