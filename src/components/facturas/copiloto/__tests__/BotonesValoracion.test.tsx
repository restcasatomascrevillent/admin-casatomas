import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BotonesValoracion } from "../PanelCopiloto";

describe("BotonesValoracion (👍/👎 de las respuestas del copiloto)", () => {
  it("👍 vota +1 sin pedir comentario", async () => {
    const onValorar = vi.fn().mockResolvedValue(true);
    render(<BotonesValoracion onValorar={onValorar} />);
    fireEvent.click(screen.getByRole("button", { name: "Buena respuesta" }));
    await waitFor(() => expect(onValorar).toHaveBeenCalledWith(1, undefined));
    expect(screen.queryByLabelText("¿Qué estaba mal?")).toBeNull();
  });

  it("👎 abre «¿Qué estaba mal?» (opcional) y envía -1 con el comentario", async () => {
    const onValorar = vi.fn().mockResolvedValue(true);
    render(<BotonesValoracion onValorar={onValorar} />);
    fireEvent.click(screen.getByRole("button", { name: "Mala respuesta" }));
    expect(onValorar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("¿Qué estaba mal?"), { target: { value: "No ha mirado Embajadores" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onValorar).toHaveBeenCalledWith(-1, "No ha mirado Embajadores"));
    await waitFor(() => expect(screen.queryByLabelText("¿Qué estaba mal?")).toBeNull());
  });

  it("ya votada: queda marcada y no se puede votar otra vez", () => {
    const onValorar = vi.fn();
    render(<BotonesValoracion valoracion={-1} onValorar={onValorar} />);
    const malo = screen.getByRole("button", { name: "Mala respuesta" });
    const bueno = screen.getByRole("button", { name: "Buena respuesta" });
    expect(malo).toHaveAttribute("aria-pressed", "true");
    expect(malo).toBeDisabled();
    expect(bueno).toBeDisabled();
    fireEvent.click(bueno);
    expect(onValorar).not.toHaveBeenCalled();
  });
});
