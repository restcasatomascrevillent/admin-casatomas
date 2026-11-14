// Super Admin › Tickets: el análisis en tres bloques (con «Copiar»), sus estados (pendiente, analizando, error)
// y las acciones de la ficha (Aceptar, Marcar hecha, Descartar con motivo, Volver a analizar, Linear desactivado).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Peticion } from "@/lib/peticiones";

const h = vi.hoisted(() => ({
  cambiar: vi.fn(),
  enAnalisis: vi.fn(),
  analizar: vi.fn(),
  urlCaptura: vi.fn(),
  toastOk: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "sa" } }) }));
vi.mock("@/lib/peticiones", () => ({
  cambiarEstadoPeticion: h.cambiar,
  marcarEnAnalisis: h.enAnalisis,
  pedirAnalisis: h.analizar,
  urlCaptura: h.urlCaptura,
  crearPeticion: vi.fn(),
  leerMisPeticiones: vi.fn(),
  leerTickets: vi.fn(),
}));

import { AnalisisTicket } from "../AnalisisTicket";
import { DetalleTicket } from "../DetalleTicket";

const ANALISIS = {
  resumen: "Que al guardar una reserva desde la tablet se guarde.",
  tipo: "error",
  tarea_propuesta: "Revisar el botón Guardar del formulario de reservas.",
  pasos: ["Reproducir en tablet", "Corregir el guardado"],
  modulos_afectados: ["Reservas"],
  repo: "panel",
  riesgo: { nivel: "alto", motivo: "Afecta a reservas de clientes." },
  toca_bd: true,
  criterios_aceptacion: ["La reserva aparece en la lista"],
  preguntas: ["¿Pasa con todas las reservas?"],
  prompt_ia: "## Contexto\nPanel de Casa Tomás.\n\n## Reglas del repositorio (obligatorias)\n- PR a staging",
};

const TICKET: Peticion = {
  id: "t-1", creado_por: "u-1", creado_por_nombre: "Ana Sala", creado_por_email: "ana@t",
  titulo: "No se guarda la reserva", prioridad: "alta", modulo: "reservas", descripcion: "Al pulsar Guardar no pasa nada.",
  captura_path: null, ruta: "/reservas?tab=hoy&id=9", dispositivo: "Mozilla/5.0 (iPad)", estado: "en_analisis", motivo_descarte: null,
  estado_cambiado_en: null, analisis: ANALISIS, analisis_estado: "hecho", analisis_error: null, analisis_modelo: "gpt-4.1-mini",
  analizado_en: "2026-11-13T10:01:00Z", linear_id: null, linear_url: null, created_at: "2026-11-13T10:00:00Z", updated_at: "2026-11-13T10:00:00Z",
};

function pintarDetalle(t: Partial<Peticion> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onCerrar = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <DetalleTicket peticion={{ ...TICKET, ...t }} onCerrar={onCerrar} />
    </QueryClientProvider>,
  );
  return { onCerrar };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.cambiar.mockResolvedValue(undefined);
  h.enAnalisis.mockResolvedValue(true);
  h.analizar.mockResolvedValue({ ok: true, analisis_estado: "hecho" });
  h.urlCaptura.mockResolvedValue("https://ejemplo/captura.jpg");
});

describe("AnalisisTicket", () => {
  it("tres bloques: qué quieren, tarea propuesta (cómo lo haría) y prompt para la IA", () => {
    render(<AnalisisTicket peticion={TICKET} onReanalizar={vi.fn()} reanalizando={false} />);
    expect(screen.getByRole("heading", { name: /Qué quieren/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Tarea propuesta \(cómo lo haría\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Prompt para la IA/ })).toBeInTheDocument();
    expect(screen.getByTestId("bloque-que-quieren")).toHaveTextContent(ANALISIS.resumen);
    expect(screen.getByTestId("bloque-que-quieren")).toHaveTextContent("¿Pasa con todas las reservas?");
    const tarea = screen.getByTestId("bloque-tarea");
    expect(tarea).toHaveTextContent("Reproducir en tablet");
    expect(tarea).toHaveTextContent("Panel (admin-casatomas)");
    expect(tarea).toHaveTextContent("Alto · Afecta a reservas de clientes.");
    expect(tarea).toHaveTextContent("Sí, hay que tocarla");
    expect(tarea).toHaveTextContent("La reserva aparece en la lista");
    expect(screen.getByTestId("prompt-ia").textContent).toBe(ANALISIS.prompt_ia);
  });

  it("«Copiar prompt» lo copia al portapapeles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<AnalisisTicket peticion={TICKET} onReanalizar={vi.fn()} reanalizando={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ANALISIS.prompt_ia));
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });

  it("pendiente o analizando: lo dice, sin bloques", () => {
    const { rerender } = render(<AnalisisTicket peticion={{ ...TICKET, analisis_estado: "pendiente", analisis: null }} onReanalizar={vi.fn()} reanalizando={false} />);
    expect(screen.getByTestId("analisis-en-curso")).toHaveTextContent(/Pendiente de analizar/);
    rerender(<AnalisisTicket peticion={TICKET} onReanalizar={vi.fn()} reanalizando />);
    expect(screen.getByTestId("analisis-en-curso")).toHaveTextContent(/está analizando/);
    expect(screen.queryByTestId("analisis-ticket")).not.toBeInTheDocument();
  });

  it("error: el motivo legible y «Volver a analizar»", () => {
    const onReanalizar = vi.fn();
    render(<AnalisisTicket peticion={{ ...TICKET, analisis_estado: "error", analisis: null, analisis_error: "La cuenta de OpenAI se ha quedado sin saldo" }} onReanalizar={onReanalizar} reanalizando={false} />);
    expect(screen.getByTestId("analisis-error")).toHaveTextContent("La cuenta de OpenAI se ha quedado sin saldo");
    fireEvent.click(screen.getByRole("button", { name: "Volver a analizar" }));
    expect(onReanalizar).toHaveBeenCalled();
  });
});

describe("DetalleTicket", () => {
  it("enseña lo que escribió, quién, desde dónde (sin parámetros) y el análisis", () => {
    pintarDetalle();
    expect(screen.getByText("No se guarda la reserva")).toBeInTheDocument();
    expect(screen.getByText("Al pulsar Guardar no pasa nada.")).toBeInTheDocument();
    expect(screen.getByText(/Ana Sala · ana@t/)).toBeInTheDocument();
    expect(screen.getByText("/reservas")).toBeInTheDocument();
    expect(screen.getByTitle("Mozilla/5.0 (iPad)")).toHaveTextContent("tablet");
    expect(screen.getByTestId("analisis-ticket")).toBeInTheDocument();
  });

  it("al abrir una «Recibida» pendiente: pasa a «En análisis» y lanza el análisis (sin forzar)", async () => {
    pintarDetalle({ estado: "nueva", analisis_estado: "pendiente", analisis: null });
    await waitFor(() => expect(h.enAnalisis).toHaveBeenCalledWith("t-1"));
    await waitFor(() => expect(h.analizar).toHaveBeenCalledWith("t-1", false));
  });

  it("una ya analizada no se vuelve a analizar al abrirla", async () => {
    pintarDetalle();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.analizar).not.toHaveBeenCalled();
    expect(h.enAnalisis).not.toHaveBeenCalled();
  });

  it("Aceptar y Marcar hecha cambian el estado", async () => {
    pintarDetalle();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    await waitFor(() => expect(h.cambiar).toHaveBeenCalledWith("t-1", "aceptada", undefined));
    fireEvent.click(screen.getByRole("button", { name: "Marcar hecha" }));
    await waitFor(() => expect(h.cambiar).toHaveBeenCalledWith("t-1", "hecha", undefined));
  });

  it("Descartar pide un motivo (lo verá quien la envió) y no deja sin él", async () => {
    pintarDetalle();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.getByText(/Este motivo lo verá quien la envió/)).toBeInTheDocument();
    const confirmar = screen.getAllByRole("button", { name: "Descartar" }).at(-1)!;
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Ya se puede hacer en Configuración." } });
    expect(confirmar).not.toBeDisabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(h.cambiar).toHaveBeenCalledWith("t-1", "descartada", "Ya se puede hacer en Configuración."));
  });

  it("«Volver a analizar» fuerza el análisis", async () => {
    pintarDetalle();
    fireEvent.click(screen.getByRole("button", { name: "Volver a analizar" }));
    await waitFor(() => expect(h.analizar).toHaveBeenCalledWith("t-1", true));
    await waitFor(() => expect(h.toastOk).toHaveBeenCalledWith("Análisis actualizado"));
  });

  it("«Enviar a Linear» está, pero desactivado (se conecta más adelante)", () => {
    pintarDetalle();
    expect(screen.getByTestId("enviar-linear")).toBeDisabled();
  });

  it("con captura, la enseña con un enlace temporal", async () => {
    pintarDetalle({ captura_path: "u-1/abc.jpg" });
    expect(await screen.findByAltText("Captura que adjuntó")).toHaveAttribute("src", "https://ejemplo/captura.jpg");
    expect(h.urlCaptura).toHaveBeenCalledWith("u-1/abc.jpg");
  });
});
