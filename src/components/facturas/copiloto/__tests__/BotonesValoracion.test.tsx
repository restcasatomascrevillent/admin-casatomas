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

import { MOTIVOS_SIN_DATOS, PreguntaSinDatos } from "../PanelCopiloto";
import { trazaDeAdjuntos, trazaDeRespuesta } from "@/hooks/useChatFacturas";

describe("respuestas «no hay datos» y fallos (17/11/2026)", () => {
  it("«¿Debería haber datos?»: un toque guarda un 👎 con el motivo", async () => {
    const onValorar = vi.fn().mockResolvedValue(true);
    render(<PreguntaSinDatos onValorar={onValorar} />);
    expect(screen.getByText("¿Debería haber datos?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: MOTIVOS_SIN_DATOS[0] }));
    await waitFor(() => expect(onValorar).toHaveBeenCalledWith(-1, `Sin datos: ${MOTIVOS_SIN_DATOS[0]}`));
  });

  it("la respuesta de la función marca el aviso: error (incidencia o success false) o sin_datos", () => {
    expect(trazaDeRespuesta({ success: true, traza: { herramientas: [] }, modelo: "m" })?.aviso).toBeUndefined();
    expect(trazaDeRespuesta({ success: true, traza: { herramientas: [] }, sin_datos: true })?.aviso).toBe("sin_datos");
    expect(trazaDeRespuesta({ success: true, traza: { herramientas: [] }, incidencia: "herramienta_fallida" })?.aviso).toBe("error");
    // Un error del handler no trae traza: el aviso se conserva igualmente.
    expect(trazaDeRespuesta({ success: false, respuesta: "…", incidencia: "tiempo_agotado" })).toEqual({ modelo: null, herramientas: [], aviso: "error" });
    expect(trazaDeRespuesta(null)).toBeUndefined();
  });

  it("el aviso se guarda con la respuesta y se recupera al recargar", () => {
    expect(trazaDeAdjuntos([{ tipo: "contexto", datos: { modelo: "m", herramientas: [], aviso: "sin_datos" } }])?.aviso).toBe("sin_datos");
    expect(trazaDeAdjuntos([{ tipo: "contexto", datos: { modelo: "m", herramientas: [], aviso: "otro" } }])?.aviso).toBeUndefined();
  });
});
