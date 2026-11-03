import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TarjetaCartaLateral, type FotoTarjeta } from "../TarjetaCartaLateral";

const FOTO_CARTA = "https://x.supabase.co/storage/v1/object/public/vinos/abc-carta-webp.webp?t=1";
const FOTO_ANTIGUA = "https://x.supabase.co/storage/v1/object/public/vinos/abc.jpg";

function tarjeta(foto: FotoTarjeta | null) {
  return render(
    <TarjetaCartaLateral
      foto={foto}
      categoria={<span>Tintos</span>}
      titulo={<h3>Viña Real</h3>}
      controlesFoto={<button type="button">Ocultar foto</button>}
      info={<p>19,90 €</p>}
      infoExtra={<p>Sulfitos</p>}
      controles={<button type="button" role="switch" aria-checked="true" aria-label="Despublicar de la web" />}
      acciones={<button type="button">Editar</button>}
    />,
  );
}

describe("TarjetaCartaLateral", () => {
  it("foto de carta: columna lateral 3:5 con object-cover, lazy y con width/height", () => {
    tarjeta({ url: FOTO_CARTA, alt: "Viña Real" });
    const marco = screen.getByTestId("foto-lateral");
    expect(marco).toHaveAttribute("data-foto", "carta");
    expect(marco.className).toContain("aspect-[3/5]");
    const img = screen.getByRole("img", { name: "Viña Real" });
    expect(img).toHaveAttribute("width", "900");
    expect(img).toHaveAttribute("height", "1200");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img.className).toContain("object-cover");
    expect(marco).toContainElement(img);
  });

  it("foto antigua: marco 3:4 con object-contain para verla entera", () => {
    tarjeta({ url: FOTO_ANTIGUA, alt: "Viña Real" });
    const marco = screen.getByTestId("foto-lateral");
    expect(marco).toHaveAttribute("data-foto", "antigua");
    expect(marco.className).toContain("aspect-[3/4]");
    expect(screen.getByRole("img", { name: "Viña Real" }).className).toContain("object-contain");
  });

  it("con foto el texto, los controles y las acciones siguen presentes y la foto va la primera", () => {
    tarjeta({ url: FOTO_CARTA, alt: "Viña Real" });
    expect(screen.getByRole("heading", { name: "Viña Real" })).toBeInTheDocument();
    for (const t of ["Tintos", "19,90 €", "Sulfitos"]) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Despublicar de la web" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar foto" })).toBeInTheDocument();
    const marco = screen.getByTestId("foto-lateral");
    const nombre = screen.getByRole("heading", { name: "Viña Real" });
    expect(marco.compareDocumentPosition(nombre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin foto (o con la foto oculta) no hay columna de foto ni hueco", () => {
    tarjeta(null);
    expect(screen.queryByTestId("foto-lateral")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Viña Real" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar foto" })).toBeInTheDocument();
  });

  it("si la foto no carga, vuelve a la tarjeta sin foto", () => {
    tarjeta({ url: FOTO_CARTA, alt: "Viña Real" });
    fireEvent.error(screen.getByRole("img", { name: "Viña Real" }));
    expect(screen.queryByTestId("foto-lateral")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Viña Real" })).toBeInTheDocument();
  });

  it("con onAbrir la foto es un botón con nombre accesible que la abre en grande", () => {
    const onAbrir = vi.fn();
    tarjeta({ url: FOTO_CARTA, alt: "Viña Real", onAbrir });
    const boton = screen.getByRole("button", { name: "Ver la foto de Viña Real en grande" });
    fireEvent.click(boton);
    expect(onAbrir).toHaveBeenCalledTimes(1);
    expect(boton).toContainElement(screen.getByRole("img", { name: "Viña Real" }));
  });

  it("sin onAbrir la foto no es un botón", () => {
    tarjeta({ url: FOTO_CARTA, alt: "Viña Real" });
    expect(screen.queryByRole("button", { name: /en grande/ })).not.toBeInTheDocument();
  });
});
