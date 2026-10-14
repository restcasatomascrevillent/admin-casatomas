import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FotoExpandidaToggle } from "../FotoExpandidaToggle";

describe("Expansión de fotos en la carta", () => {
  it.each([null, "", "   "])("bloquea un artículo sin foto (%s), incluso si tenía expanded activado", (imagenUrl) => {
    const onChange = vi.fn();
    render(<FotoExpandidaToggle nombre="Pulpo" imagenUrl={imagenUrl} expanded isPending={false} onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Foto expandida en carta web: Pulpo" });
    expect(control).toBeDisabled();
    expect(control).not.toBeChecked();
    expect(control).toHaveAccessibleDescription("Añade una foto para poder expandirla.");
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("permite expandir cuando se añade una foto y bloquea mientras se guarda", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FotoExpandidaToggle nombre="Albariño" imagenUrl={null} isPending={false} onChange={onChange} />);
    rerender(<FotoExpandidaToggle nombre="Albariño" imagenUrl="https://example.com/botella.jpg" isPending={false} onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Foto expandida en carta web: Albariño" });
    expect(control).toBeEnabled();
    expect(screen.queryByText("Añade una foto para poder expandirla.")).not.toBeInTheDocument();
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<FotoExpandidaToggle nombre="Albariño" imagenUrl="https://example.com/botella.jpg" expanded isPending onChange={onChange} />);
    expect(control).toBeDisabled();
    expect(control).toBeChecked();
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledOnce();
  });
});
