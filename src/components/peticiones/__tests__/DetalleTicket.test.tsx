// Super Admin › Tickets: el análisis en tres bloques (con «Copiar»), sus estados (pendiente, analizando, error)
// y las acciones de la ficha (Aceptar, Marcar hecha, Descartar con motivo, Volver a analizar, Enviar a Linear).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Peticion } from "@/lib/peticiones";

const h = vi.hoisted(() => ({
  cambiar: vi.fn(),
  enAnalisis: vi.fn(),
  analizar: vi.fn(),
  enviar: vi.fn(),
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
  enviarALinear: h.enviar,
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
  h.enviar.mockResolvedValue({ ok: true, destino: "real", identificador: "CAS-1", url: "https://linear.app/ct/issue/CAS-1", repetido: false, aceptada: false });
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

  describe("Enviar a Linear", () => {
    const abrirYConfirmar = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar a Linear" }));
      expect(await screen.findByText("¿Enviar este ticket a Linear?")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("confirmar-enviar-linear"));
    };

    it("pide confirmación antes de enviar (y Cancelar no envía nada)", async () => {
      pintarDetalle();
      fireEvent.click(screen.getByRole("button", { name: "Enviar a Linear" }));
      expect(await screen.findByText(/El ticket pasará a «Aceptada»/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByText("¿Enviar este ticket a Linear?")).not.toBeInTheDocument());
      expect(h.enviar).not.toHaveBeenCalled();
    });

    it("al confirmar: «Enviando…» y aviso con el identificador y «Ver en Linear»", async () => {
      let terminar: (v: unknown) => void = () => {};
      h.enviar.mockReturnValue(new Promise((r) => { terminar = r; }));
      const abrir = vi.spyOn(window, "open").mockReturnValue(null);
      pintarDetalle();
      await abrirYConfirmar();
      await waitFor(() => expect(h.enviar).toHaveBeenCalledWith("t-1"));
      expect(screen.getByTestId("confirmar-enviar-linear")).toHaveTextContent("Enviando…");
      expect(screen.getByTestId("confirmar-enviar-linear")).toBeDisabled();
      terminar({ ok: true, destino: "real", identificador: "CAS-12", url: "https://linear.app/ct/issue/CAS-12/x", repetido: false, aceptada: true });
      await waitFor(() => expect(h.toastOk).toHaveBeenCalledWith("Enviado a Linear: CAS-12", expect.objectContaining({ description: "El ticket ha pasado a «Aceptada»." })));
      const opciones = h.toastOk.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
      expect(opciones.action.label).toBe("Ver en Linear");
      opciones.action.onClick();
      expect(abrir).toHaveBeenCalledWith("https://linear.app/ct/issue/CAS-12/x", "_blank", "noopener,noreferrer");
      await waitFor(() => expect(screen.queryByText("¿Enviar este ticket a Linear?")).not.toBeInTheDocument());
      abrir.mockRestore();
    });

    it("ya enviado: enseña «En Linear: CAS-12» con el enlace en vez del botón", () => {
      pintarDetalle({ linear_id: "CAS-12", linear_url: "https://linear.app/ct/issue/CAS-12/x", estado: "aceptada" });
      const enlace = screen.getByRole("link", { name: /En Linear: CAS-12/ });
      expect(enlace).toHaveAttribute("href", "https://linear.app/ct/issue/CAS-12/x");
      expect(enlace).toHaveAttribute("target", "_blank");
      expect(screen.queryByRole("button", { name: "Enviar a Linear" })).not.toBeInTheDocument();
    });

    it("modo prueba: lo dice claro (no se ha creado nada en Linear)", async () => {
      h.enviar.mockResolvedValue({ ok: true, destino: "prueba", identificador: "PRUEBA-3", url: null });
      pintarDetalle();
      await abrirYConfirmar();
      await waitFor(() => expect(h.toastOk).toHaveBeenCalledWith("Prueba hecha: guardado como PRUEBA-3", expect.objectContaining({ description: expect.stringMatching(/no se ha creado nada en Linear/) })));
    });

    it("si falla, el motivo legible que devuelve el servidor", async () => {
      const respuesta = new Response(JSON.stringify({ ok: false, error: "Elige el equipo en Logs › Configuración › Linear." }), { status: 409 });
      h.enviar.mockRejectedValue(Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: respuesta }));
      pintarDetalle();
      await abrirYConfirmar();
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Elige el equipo en Logs › Configuración › Linear."));
      expect(screen.getByRole("button", { name: "Enviar a Linear" })).not.toBeDisabled();
    });

    it("un fallo sin motivo (red) da una frase sencilla, no el error técnico", async () => {
      h.enviar.mockRejectedValue(new TypeError("Failed to fetch"));
      pintarDetalle();
      await abrirYConfirmar();
      await waitFor(() => expect(h.toastError).toHaveBeenCalled());
      expect(String(h.toastError.mock.calls[0][0])).not.toMatch(/Failed to fetch/);
    });

    it("mientras la IA analiza no se puede enviar", () => {
      pintarDetalle({ analisis_estado: "analizando" });
      expect(screen.getByTestId("enviar-linear")).toBeDisabled();
    });

    it("descartado: no aparece el botón", () => {
      pintarDetalle({ estado: "descartada", motivo_descarte: "No procede." });
      expect(screen.queryByTestId("enviar-linear")).not.toBeInTheDocument();
    });
  });

  it("con captura, la enseña con un enlace temporal", async () => {
    pintarDetalle({ captura_path: "u-1/abc.jpg" });
    expect(await screen.findByAltText("Captura que adjuntó")).toHaveAttribute("src", "https://ejemplo/captura.jpg");
    expect(h.urlCaptura).toHaveBeenCalledWith("u-1/abc.jpg");
  });
});
