import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { FormularioCambioContrasena } from "@/components/cuenta/FormularioCambioContrasena";

const ACTUAL = "Actual-secreta-123";
const NUEVA = "Nueva-secreta-456!";

/** Respuesta de error de la función tal como la devuelve supabase-js (FunctionsHttpError). */
const errorFuncion = (status: number, codigo: string, error: string) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify({ success: false, codigo, error }), { status, headers: { "Content-Type": "application/json" } }),
  }),
});

const campo = (nombre: string) => screen.getByLabelText(nombre, { selector: "input" }) as HTMLInputElement;
const escribir = (nombre: string, valor: string) => fireEvent.change(campo(nombre), { target: { value: valor } });
const rellenar = (actual = ACTUAL, nueva = NUEVA, repetir = nueva) => {
  escribir("Contraseña actual", actual);
  escribir("Nueva contraseña", nueva);
  escribir("Repite la nueva contraseña", repetir);
};
const enviar = () => fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
const regla = (texto: RegExp) => within(screen.getByRole("list", { name: "Requisitos de la nueva contraseña" })).getByText(texto).closest("li")!;

beforeEach(() => {
  h.invoke.mockReset();
  vi.mocked(toast.success).mockClear();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("FormularioCambioContrasena", () => {
  it("enseña los requisitos y los marca según se escribe", () => {
    render(<FormularioCambioContrasena />);
    expect(regla(/Al menos 10 caracteres/)).toHaveTextContent("pendiente");
    rellenar(ACTUAL, "corta", "corta");
    expect(regla(/Al menos 10 caracteres/)).toHaveTextContent("pendiente");
    expect(regla(/Las dos nuevas coinciden/)).toHaveTextContent("cumplido");
    escribir("Nueva contraseña", NUEVA);
    expect(regla(/Al menos 10 caracteres/)).toHaveTextContent("cumplido");
    expect(regla(/Las dos nuevas coinciden/)).toHaveTextContent("pendiente");
    expect(regla(/Recomendado/)).toHaveTextContent("cumplido");
    escribir("Nueva contraseña", "x".repeat(73));
    expect(regla(/Como mucho 72 caracteres/)).toHaveTextContent("pendiente");
  });

  it("no envía nada sin la contraseña actual, con una nueva corta, igual a la actual o sin coincidir", () => {
    render(<FormularioCambioContrasena />);
    enviar();
    expect(screen.getByText("Escribe tu contraseña actual.")).toBeInTheDocument();
    expect(campo("Contraseña actual")).toHaveAttribute("aria-invalid", "true");

    for (const [nueva, repetir] of [["corta", "corta"], [ACTUAL, ACTUAL], [NUEVA, `${NUEVA}x`]]) {
      rellenar(ACTUAL, nueva, repetir);
      enviar();
      expect(screen.getByRole("alert")).toHaveTextContent("Revisa los requisitos de la nueva contraseña.");
    }
    expect(regla(/Distinta de la contraseña actual/)).toHaveTextContent("cumplido");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("muestra y oculta cada contraseña con un botón accesible", () => {
    render(<FormularioCambioContrasena />);
    const boton = screen.getByRole("button", { name: "Mostrar contraseña actual" });
    expect(boton).toHaveAttribute("aria-pressed", "false");
    expect(campo("Contraseña actual")).toHaveAttribute("type", "password");
    fireEvent.click(boton);
    expect(campo("Contraseña actual")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña actual" })).toHaveAttribute("aria-pressed", "true");
    expect(campo("Nueva contraseña")).toHaveAttribute("type", "password");
    expect(campo("Contraseña actual")).toHaveAttribute("autocomplete", "current-password");
    expect(campo("Nueva contraseña")).toHaveAttribute("autocomplete", "new-password");
  });

  it("al cambiarla llama a la función, avisa, vacía los campos y lo comunica", async () => {
    h.invoke.mockResolvedValue({ data: { success: true }, error: null });
    const onCambiada = vi.fn();
    render(<FormularioCambioContrasena email="yo@casatomas.test" onCambiada={onCambiada} />);
    rellenar();
    enviar();
    await waitFor(() => expect(onCambiada).toHaveBeenCalledTimes(1));
    expect(h.invoke).toHaveBeenCalledWith("cambiar-mi-contrasena", { body: { actual: ACTUAL, nueva: NUEVA } });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Contraseña cambiada/));
    expect(screen.getByRole("status")).toHaveTextContent("Contraseña cambiada correctamente.");
    expect(campo("Contraseña actual").value).toBe("");
    expect(campo("Nueva contraseña").value).toBe("");
    expect(campo("Repite la nueva contraseña").value).toBe("");
  });

  it("contraseña actual incorrecta: el error va en su campo", async () => {
    h.invoke.mockResolvedValue(errorFuncion(400, "contrasena_actual_incorrecta", "La contraseña actual no es correcta."));
    render(<FormularioCambioContrasena />);
    rellenar();
    enviar();
    expect(await screen.findByText("La contraseña actual no es correcta.")).toBeInTheDocument();
    expect(campo("Contraseña actual")).toHaveAttribute("aria-invalid", "true");
    expect(campo("Contraseña actual")).toHaveAccessibleDescription("La contraseña actual no es correcta.");
  });

  it.each([
    [400, "misma_contrasena", "La nueva contraseña debe ser diferente de la actual.", "campo"],
    [400, "contrasena_corta", "La nueva contraseña debe tener al menos 10 caracteres.", "campo"],
    [429, "demasiados_intentos", "Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.", "aviso"],
    [503, "error_servicio", "No se pudo cambiar la contraseña. Inténtalo de nuevo en unos minutos.", "aviso"],
  ])("error %s %s: mensaje claro", async (status, codigo, mensaje, donde) => {
    h.invoke.mockResolvedValue(errorFuncion(status, codigo, mensaje));
    render(<FormularioCambioContrasena />);
    rellenar();
    enviar();
    if (donde === "aviso") expect(await screen.findByRole("alert")).toHaveTextContent(mensaje);
    else {
      expect(await screen.findByText(mensaje)).toBeInTheDocument();
      expect(campo("Nueva contraseña")).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("sesión caducada (la pasarela responde 401 sin código)", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("x"), { name: "FunctionsHttpError", context: new Response(JSON.stringify({ msg: "Invalid JWT" }), { status: 401 }) }),
    });
    render(<FormularioCambioContrasena />);
    rellenar();
    enviar();
    expect(await screen.findByRole("alert")).toHaveTextContent("Tu sesión ha caducado. Vuelve a iniciar sesión.");
  });

  it("nunca escribe las contraseñas en la consola ni en el navegador", async () => {
    const espias = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    render(<FormularioCambioContrasena email="yo@casatomas.test" />);
    // Sin conexión (el único camino que escribe en la consola), error de la función y éxito.
    h.invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error(`fallo con ${NUEVA}`), { name: "FunctionsFetchError" }) });
    rellenar();
    enviar();
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo conectar/);
    h.invoke.mockResolvedValueOnce(errorFuncion(400, "contrasena_actual_incorrecta", "La contraseña actual no es correcta."));
    enviar();
    await screen.findByText("La contraseña actual no es correcta.");
    h.invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    enviar();
    await screen.findByRole("status");
    const escrito = JSON.stringify([
      espias.map((e) => e.mock.calls),
      Object.entries(localStorage),
      Object.entries(sessionStorage),
      document.cookie,
    ]);
    expect(escrito).not.toContain(ACTUAL);
    expect(escrito).not.toContain(NUEVA);
  });
});
