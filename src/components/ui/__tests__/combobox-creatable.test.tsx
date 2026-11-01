import { beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComboboxCreatable, normalizarOpcion } from "../combobox-creatable";

const CATEGORIAS = ["Tinto", "Blanco", "Rosado", "Espumoso"];

function Prueba({ onChange }: { onChange: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <ComboboxCreatable
      value={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
      options={CATEGORIAS}
      placeholder="Tinto, Blanco, Espumoso…"
    />
  );
}

beforeAll(() => {
  // cmdk desplaza la fila resaltada a la vista; jsdom no lo implementa.
  Element.prototype.scrollIntoView = () => {};
});

const campo = () => document.querySelector<HTMLInputElement>("input[cmdk-input]")!;
const escribir = (texto: string) => fireEvent.change(campo(), { target: { value: texto } });
const enter = () => fireEvent.keyDown(campo(), { key: "Enter" });

function abrirYEscribir(texto: string) {
  const onChange = vi.fn();
  render(<Prueba onChange={onChange} />);
  fireEvent.click(screen.getByRole("combobox"));
  escribir(texto);
  return { onChange };
}

describe("ComboboxCreatable (Categoría del vino, QA F-43)", () => {
  it("normaliza acentos, mayúsculas y espacios", () => {
    expect(normalizarOpcion("  Tínto   de  Toro ")).toBe("tinto de toro");
  });

  it("Enter con texto que coincide elige la categoría existente, sin crear", () => {
    const { onChange } = abrirYEscribir("tin");
    enter();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Tinto");
  });

  it("la idéntica (sin acentos ni mayúsculas) no ofrece «Crear»", () => {
    const { onChange } = abrirYEscribir("ROSADO ");
    expect(screen.queryByText(/Crear «/)).toBeNull();
    enter();
    expect(onChange).toHaveBeenCalledWith("Rosado");
  });

  it("Enter sin coincidencias no crea: pide confirmación y crea al segundo Enter", () => {
    const { onChange } = abrirYEscribir("Generoso");
    expect(screen.getByText("Crear «Generoso»")).toBeInTheDocument();
    enter();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Pulsa Enter otra vez");
    enter();
    expect(onChange).toHaveBeenCalledWith("Generoso");
  });

  it("escribir otra cosa anula la confirmación pendiente", () => {
    const { onChange } = abrirYEscribir("Generoso");
    enter();
    escribir("Generosos");
    expect(screen.queryByRole("status")).toBeNull();
    enter();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tocar «Crear “X”» la crea al momento (acción explícita)", () => {
    const { onChange } = abrirYEscribir("  Dulce   natural ");
    fireEvent.click(screen.getByText("Crear «Dulce natural»"));
    expect(onChange).toHaveBeenCalledWith("Dulce natural");
  });
});
