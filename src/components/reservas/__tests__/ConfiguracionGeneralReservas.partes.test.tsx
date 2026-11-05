/**
 * Reservas › Configuración, en chips (04/11/2026, petición del dueño: «pon subpestañas porque el scroll es
 * eterno»). La tarjeta «Reglas Generales de Reservas» se repartió en dos chips, «Reglas» y «Servicio», que
 * son dos partes del MISMO formulario (`parte`): una fila de `configuracion_reservas` que se guarda entera.
 *
 * Aquí: cada chip enseña solo lo suyo; guardar desde uno manda lo del otro tal como vino de la base de datos
 * (no lo pisa), y si lo que no valida está en el otro chip, se dice en cuál corregirlo en vez de no hacer
 * nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  guardar: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: h.config, isLoading: false }),
  useActualizarConfiguracionReservas: () => ({ mutateAsync: h.guardar, isPending: false }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({ data: [{ id: "sala-1", nombre: "Comedor", activa: true }] }),
}));
vi.mock("@/hooks/useMesas", () => ({
  useMesas: () => ({ data: [{ id: "mesa-1", nombre: "1", espacio_id: "sala-1" }] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.toastError, warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import { ConfiguracionGeneralReservas } from "@/components/reservas/ConfiguracionGeneralReservas";

const CONFIG = {
  id: "c1",
  minutos_corte_antes_servicio: 60,
  max_reservas_por_telefono_dia: 2,
  max_reservas_por_email_dia: 3,
  max_comensales_por_reserva: 12,
  min_comensales_por_reserva: 1,
  dias_max_antelacion: 60,
  telefono_obligatorio: true,
  email_obligatorio: false,
  auto_confirmar: false,
  estancia_comida_minutos: 105,
  estancia_cena_minutos: 120,
  retraso_gracia_minutos: 15,
  asignacion_ventana_horas: 48,
  asignacion_aviso_activo: true,
  asignacion_espacios_excluidos: [],
  asignacion_mesas_excluidas: [],
};

/** Lo que se ve en cada chip, por el texto de su sección o de su campo. */
const DE_REGLAS = [
  "Tiempo y disponibilidad",
  "Límites por contacto y comensales",
  "Requisitos y comportamiento",
  "Teléfono obligatorio",
  "Auto-confirmar reservas",
];
const DE_SERVICIO = [
  "Tiempo de ocupación de mesa",
  "Modo servicio (plano en vivo)",
  "Asignación interna de salas y mesas",
  "Avisar en la campana",
];

beforeEach(() => {
  h.config = { ...CONFIG };
  h.guardar.mockReset();
  h.guardar.mockImplementation(async (valores: Record<string, unknown>) => valores);
  h.toastError.mockReset();
});

const guardar = () => fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
/** «Resaltar reservas de las próximas … horas». Por su nombre: su etiqueta apunta al envoltorio, no al input. */
const campoVentana = () => document.querySelector<HTMLInputElement>('input[name="asignacion_ventana_horas"]')!;

describe("Configuración · cada chip enseña solo su parte", () => {
  it("«Reglas»: antelación, límites, comensales y requisitos; nada de servicio ni asignación", () => {
    render(<ConfiguracionGeneralReservas parte="reglas" />);

    expect(screen.getByText("Reglas de reservas")).toBeInTheDocument();
    for (const texto of DE_REGLAS) expect(screen.getByText(texto)).toBeInTheDocument();
    for (const texto of DE_SERVICIO) expect(screen.queryByText(texto)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Máximo de días de antelación/)).toHaveValue(60);
  });

  it("«Servicio»: ocupación de mesa, retraso y asignación; nada de las reglas", () => {
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    expect(screen.getByText("Servicio y asignación")).toBeInTheDocument();
    for (const texto of DE_SERVICIO) expect(screen.getByText(texto)).toBeInTheDocument();
    for (const texto of DE_REGLAS) expect(screen.queryByText(texto)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Margen antes de marcar retraso/)).toHaveValue(15);
  });

  it("las mesas por espacio ya no van aquí: tienen su chip «Mesas»", () => {
    render(<ConfiguracionGeneralReservas parte="servicio" />);
    expect(screen.queryByText("Mesas y aforo por espacio")).not.toBeInTheDocument();
  });
});

describe("Configuración · guardar desde un chip no pisa el otro", () => {
  it("desde «Reglas» se manda lo cambiado y lo de «Servicio» tal como vino de la base de datos", async () => {
    h.config = { ...CONFIG, estancia_cena_minutos: 150, asignacion_ventana_horas: 24, asignacion_aviso_activo: false };
    render(<ConfiguracionGeneralReservas parte="reglas" />);

    fireEvent.change(screen.getByLabelText(/Máximo de días de antelación/), { target: { value: "90" } });
    guardar();

    await waitFor(() => expect(h.guardar).toHaveBeenCalledTimes(1));
    expect(h.guardar.mock.calls[0][0]).toMatchObject({
      dias_max_antelacion: 90,
      estancia_comida_minutos: 105,
      estancia_cena_minutos: 150,
      retraso_gracia_minutos: 15,
      asignacion_ventana_horas: 24,
      asignacion_aviso_activo: false,
      asignacion_espacios_excluidos: [],
      asignacion_mesas_excluidas: [],
    });
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("desde «Servicio» se manda lo cambiado y lo de «Reglas» tal como vino de la base de datos", async () => {
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    fireEvent.change(screen.getByLabelText(/Margen antes de marcar retraso/), { target: { value: "20" } });
    guardar();

    await waitFor(() => expect(h.guardar).toHaveBeenCalledTimes(1));
    expect(h.guardar.mock.calls[0][0]).toMatchObject({
      retraso_gracia_minutos: 20,
      minutos_corte_antes_servicio: 60,
      dias_max_antelacion: 60,
      max_reservas_por_telefono_dia: 2,
      max_reservas_por_email_dia: 3,
      min_comensales_por_reserva: 1,
      max_comensales_por_reserva: 12,
      telefono_obligatorio: true,
      email_obligatorio: false,
      auto_confirmar: false,
    });
  });
});

describe("Configuración · si no valida, se dice dónde corregirlo", () => {
  it("un dato mal en «Servicio» (que desde «Reglas» no se ve): no se guarda y el aviso dice «Servicio»", async () => {
    // Una mesa usable en una sala que no lo es: lo rechaza el esquema de asignación.
    h.config = { ...CONFIG, asignacion_espacios_excluidos: ["sala-1"], asignacion_mesas_excluidas: [] };
    render(<ConfiguracionGeneralReservas parte="reglas" />);

    guardar();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.guardar).not.toHaveBeenCalled();
    const [titulo, opciones] = h.toastError.mock.calls[0];
    expect(titulo).toBe("No se ha guardado");
    expect(opciones.description).toBe("Hay un dato que corregir en «Servicio».");
  });

  it("un dato mal en «Reglas» (que desde «Servicio» no se ve): el aviso dice «Reglas»", async () => {
    h.config = { ...CONFIG, dias_max_antelacion: 900 };
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    guardar();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.guardar).not.toHaveBeenCalled();
    expect(h.toastError.mock.calls[0][1].description).toBe("Hay un dato que corregir en «Reglas».");
  });

  // Un número fuera de rango en un campo A LA VISTA ya lo para el navegador (min/max del input) antes de
  // llegar aquí; lo que llega es lo que solo comprueba el esquema, como la ventana vacía.
  it("un dato mal en el chip que se ve: no se guarda, y se dice que está marcado en rojo", async () => {
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    fireEvent.change(campoVentana(), { target: { value: "" } });
    guardar();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.guardar).not.toHaveBeenCalled();
    expect(h.toastError.mock.calls[0][1].description).toBe("Revisa los datos marcados en rojo.");
  });

  it("mal en los dos: dice el otro chip y que aquí hay otro", async () => {
    h.config = { ...CONFIG, dias_max_antelacion: 900 };
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    fireEvent.change(campoVentana(), { target: { value: "" } });
    guardar();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.guardar).not.toHaveBeenCalled();
    expect(h.toastError.mock.calls[0][1].description).toBe(
      "Hay un dato que corregir en «Reglas», y otro aquí, marcado en rojo.",
    );
  });
});
