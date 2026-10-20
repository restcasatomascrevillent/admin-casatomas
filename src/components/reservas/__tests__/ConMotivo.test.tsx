/**
 * ConMotivo: el `span` envolvente que hace visible el motivo de un botón
 * deshabilitado. Un `Button` deshabilitado lleva `pointer-events-none`, así que
 * su propio `title` no se ve; el `span` de fuera sí recibe el ratón.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { ConMotivo } from "@/components/reservas/ConMotivo";

describe("ConMotivo", () => {
  it("pone el motivo como `title` del envoltorio, donde sí llega el ratón", () => {
    render(
      <ConMotivo motivo="No tienes permiso para editar reservas">
        <Button disabled>Editar</Button>
      </ConMotivo>,
    );

    const boton = screen.getByRole("button", { name: "Editar" });
    expect(boton).toBeDisabled();
    expect(boton.parentElement).toHaveAttribute("title", "No tienes permiso para editar reservas");
  });

  it("sin motivo (el control está habilitado) no pone ningún `title`", () => {
    const { rerender } = render(
      <ConMotivo>
        <Button>Editar</Button>
      </ConMotivo>,
    );
    expect(screen.getByRole("button", { name: "Editar" }).parentElement).not.toHaveAttribute("title");

    rerender(
      <ConMotivo motivo={undefined}>
        <Button>Editar</Button>
      </ConMotivo>,
    );
    expect(screen.getByRole("button", { name: "Editar" }).parentElement).not.toHaveAttribute("title");

    rerender(
      <ConMotivo motivo="">
        <Button>Editar</Button>
      </ConMotivo>,
    );
    expect(screen.getByRole("button", { name: "Editar" }).parentElement).not.toHaveAttribute("title");
  });

  it("por defecto se comporta como el botón (en línea) y `className` lo recoloca (p. ej. a todo el ancho)", () => {
    const { rerender } = render(
      <ConMotivo motivo="x">
        <Button>Editar</Button>
      </ConMotivo>,
    );
    expect(screen.getByRole("button", { name: "Editar" }).parentElement).toHaveClass("inline-flex");

    rerender(
      <ConMotivo motivo="x" className="flex w-full">
        <Button>Editar</Button>
      </ConMotivo>,
    );
    const envoltorio = screen.getByRole("button", { name: "Editar" }).parentElement!;
    expect(envoltorio).toHaveClass("flex", "w-full");
    // `flex` sustituye a `inline-flex` (no se quedan los dos).
    expect(envoltorio).not.toHaveClass("inline-flex");
  });
});
