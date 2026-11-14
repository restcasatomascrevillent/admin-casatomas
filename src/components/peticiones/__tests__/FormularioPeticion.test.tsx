// «Nueva petición»: validación, módulo propuesto según la página, envío (con la ruta y la prioridad), análisis
// lanzado en segundo plano después de guardar, captura opcional y error del tope diario.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  crear: vi.fn(),
  analizar: vi.fn(),
  toastOk: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));
vi.mock("@/lib/peticiones", () => ({
  crearPeticion: h.crear,
  pedirAnalisis: h.analizar,
  leerMisPeticiones: vi.fn(),
  leerTickets: vi.fn(),
  cambiarEstadoPeticion: vi.fn(),
  marcarEnAnalisis: vi.fn(),
}));

import { FormularioPeticion } from "../FormularioPeticion";
import { validarPeticion } from "../utilidades";

function pintar(ruta: string | null = "/reservas?tab=hoy", onEnviada = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FormularioPeticion ruta={ruta} onEnviada={onEnviada} />
    </QueryClientProvider>,
  );
  return { onEnviada };
}
const titulo = () => screen.getByLabelText("Título");
const descripcion = () => screen.getByLabelText("Descripción");
const modulo = () => screen.getByLabelText("Módulo afectado") as HTMLSelectElement;
const enviar = () => fireEvent.click(screen.getByRole("button", { name: "Enviar petición" }));

beforeEach(() => {
  vi.clearAllMocks();
  h.crear.mockResolvedValue({ id: "p-1", titulo: "x" });
  h.analizar.mockResolvedValue({ ok: true });
});

describe("FormularioPeticion", () => {
  it("propone el módulo de la página en la que estaba y dice que se guarda esa página (sin parámetros)", () => {
    pintar("/gestion-web?tab=carta&plato=12");
    expect(modulo().value).toBe("carta");
    expect(screen.getByText("/gestion-web")).toBeInTheDocument();
  });

  it("sin rellenar no envía: avisa de cada campo", () => {
    pintar("/ayuda");
    enviar();
    expect(screen.getByText("Escribe un título corto.")).toBeInTheDocument();
    expect(screen.getByText("Cuéntanos qué pasa o qué necesitas.")).toBeInTheDocument();
    expect(screen.getByText(/Elige a qué parte del panel afecta/)).toBeInTheDocument();
    expect(titulo()).toHaveAttribute("aria-invalid", "true");
    expect(h.crear).not.toHaveBeenCalled();
  });

  it("controles de 48 px (móvil y tablet)", () => {
    pintar();
    expect(titulo().className).toMatch(/h-12/);
    expect(modulo().className).toMatch(/h-12/);
    expect(screen.getByRole("radio", { name: "Urgente" }).className).toMatch(/h-12/);
    expect(screen.getByRole("button", { name: "Enviar petición" }).className).toMatch(/h-12/);
  });

  it("envía título, prioridad, módulo, descripción y la página; después lanza el análisis y vacía el formulario", async () => {
    const { onEnviada } = pintar();
    fireEvent.change(titulo(), { target: { value: "  No puedo cambiar la hora  " } });
    fireEvent.click(screen.getByRole("radio", { name: "Urgente" }));
    expect(screen.getByRole("radio", { name: "Urgente" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/le llega un aviso al responsable/)).toBeInTheDocument();
    fireEvent.change(descripcion(), { target: { value: "Al cambiar la hora de una reserva de hoy sale un error." } });
    enviar();
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1));
    expect(h.crear).toHaveBeenCalledWith(
      { titulo: "  No puedo cambiar la hora  ", prioridad: "urgente", modulo: "reservas", descripcion: "Al cambiar la hora de una reserva de hoy sale un error.", captura: null, ruta: "/reservas?tab=hoy" },
      "u-1",
    );
    await waitFor(() => expect(h.analizar).toHaveBeenCalledWith("p-1"));
    expect(onEnviada).toHaveBeenCalledWith(expect.objectContaining({ id: "p-1" }));
    expect(h.toastOk).toHaveBeenCalled();
    expect((titulo() as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("radio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
  });

  it("captura opcional: se añade, se ve su nombre y se puede quitar", async () => {
    pintar();
    const fichero = new File(["x"], "pantalla.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fichero] } });
    expect(screen.getByText("pantalla.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(screen.queryByText("pantalla.png")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir captura" })).toBeInTheDocument();
  });

  it("si la base de datos rechaza (tope diario), enseña su mensaje y no vacía el formulario", async () => {
    h.crear.mockRejectedValue({ code: "P0001", message: "Has enviado 20 peticiones en las últimas 24 horas. Espera un poco antes de mandar otra." });
    pintar();
    fireEvent.change(titulo(), { target: { value: "Otra petición" } });
    fireEvent.change(descripcion(), { target: { value: "Una descripción suficiente." } });
    enviar();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/Has enviado 20 peticiones/)));
    expect(h.analizar).not.toHaveBeenCalled();
    expect((titulo() as HTMLInputElement).value).toBe("Otra petición");
  });
});

describe("validarPeticion", () => {
  const base = { titulo: "Título bueno", modulo: "otro", descripcion: "Descripción suficiente" };
  it("los mismos límites que la base de datos", () => {
    expect(validarPeticion(base)).toEqual({});
    expect(validarPeticion({ ...base, titulo: "ab" }).titulo).toMatch(/al menos 3/);
    expect(validarPeticion({ ...base, titulo: "x".repeat(121) }).titulo).toMatch(/Máximo 120/);
    expect(validarPeticion({ ...base, descripcion: "corta" }).descripcion).toMatch(/al menos 10/);
    expect(validarPeticion({ ...base, descripcion: "x".repeat(4001) }).descripcion).toMatch(/Máximo 4000/);
    expect(validarPeticion({ ...base, captura: new File(["x"], "a.pdf", { type: "application/pdf" }) }).captura).toMatch(/imagen/);
  });
});
