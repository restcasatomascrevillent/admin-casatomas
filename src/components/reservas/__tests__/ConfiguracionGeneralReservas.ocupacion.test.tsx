/**
 * Ajuste «Tiempo de ocupación de mesa» de Reservas → Configuración (05/10/2026).
 *
 * Reutiliza las columnas `estancia_comida_minutos` / `estancia_cena_minutos` (las de la estancia
 * del modo servicio): ahora deciden también cuándo una mesa se puede dar a otra reserva. Aquí se
 * comprueba que el panel las enseña con ese nombre, con lo que tiene la base de datos, y que
 * guardarlas las manda tal cual.
 *
 * Desde el 04/11/2026 viven en el chip «Servicio» (`parte="servicio"`), con el margen de retraso y la
 * asignación; las reglas de antelación, límites y requisitos, en «Reglas».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  guardar: vi.fn(),
  /** «Puede editar» en «Reservas · Configuración» (04/11/2026). */
  puedeEditar: true,
}));

vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: h.config, isLoading: false }),
  useActualizarConfiguracionReservas: () => ({ mutateAsync: h.guardar, isPending: false }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useMesas", () => ({ useMesas: () => ({ data: [] }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (seccion: string, tipo: string = "view") => ({
    canAccess: seccion === "reservas_configuracion" && (tipo === "view" || h.puedeEditar),
    loading: false,
  }),
}));

import { ConfiguracionGeneralReservas } from "@/components/reservas/ConfiguracionGeneralReservas";

const CONFIG = {
  id: "c1",
  minutos_corte_antes_servicio: 60,
  max_reservas_por_telefono_dia: 2,
  max_reservas_por_email_dia: 2,
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

beforeEach(() => {
  h.puedeEditar = true;
  h.config = { ...CONFIG };
  h.guardar.mockReset();
  h.guardar.mockImplementation(async (valores: Record<string, unknown>) => valores);
});

const seccion = () => screen.getByTestId("ajuste-ocupacion-mesa");

describe("Configuración · Tiempo de ocupación de mesa", () => {
  it("se llama así, explica para qué sirve y enseña los minutos guardados (comida y cena)", () => {
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    expect(within(seccion()).getByText("Tiempo de ocupación de mesa")).toBeInTheDocument();
    expect(within(seccion()).getByText(/varias reservas del día si no se pisan/i)).toBeInTheDocument();
    expect(within(seccion()).getByLabelText(/Ocupación de mesa · Comida/)).toHaveValue(105);
    expect(within(seccion()).getByLabelText(/Ocupación de mesa · Cena/)).toHaveValue(120);
    // El margen de retraso sigue en su sitio (modo servicio), fuera de esta sección.
    expect(within(seccion()).queryByLabelText(/Margen antes de marcar retraso/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Margen antes de marcar retraso/)).toHaveValue(15);
  });

  it("sin el dato en la base de datos, cae en los valores por defecto (105 / 120)", () => {
    h.config = { ...CONFIG, estancia_comida_minutos: null, estancia_cena_minutos: undefined };
    render(<ConfiguracionGeneralReservas parte="servicio" />);
    expect(within(seccion()).getByLabelText(/Ocupación de mesa · Comida/)).toHaveValue(105);
    expect(within(seccion()).getByLabelText(/Ocupación de mesa · Cena/)).toHaveValue(120);
  });

  it("guardar manda los minutos nuevos en las columnas de siempre", async () => {
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    fireEvent.change(within(seccion()).getByLabelText(/Ocupación de mesa · Comida/), { target: { value: "90" } });
    fireEvent.change(within(seccion()).getByLabelText(/Ocupación de mesa · Cena/), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(h.guardar).toHaveBeenCalledTimes(1));
    expect(h.guardar.mock.calls[0][0]).toMatchObject({ estancia_comida_minutos: 90, estancia_cena_minutos: 150 });
  });

  it("no deja guardar menos de 15 minutos ni más de 480 (el CHECK de la base de datos)", async () => {
    render(<ConfiguracionGeneralReservas parte="servicio" />);

    fireEvent.change(within(seccion()).getByLabelText(/Ocupación de mesa · Cena/), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await new Promise((r) => setTimeout(r, 50));
    expect(h.guardar).not.toHaveBeenCalled();
  });
});

// 04/11/2026: la pestaña Configuración tiene permiso propio («Reservas · Configuración»). Con «Ver» se
// consultan las reglas; guardarlas pide «Puede editar», igual que la RLS de configuracion_reservas.
describe("Configuración · reglas en solo lectura sin «Puede editar»", () => {
  it("con solo «Ver»: se ven los valores, los campos están apagados y no hay botón de guardar (en los dos chips)", () => {
    h.puedeEditar = false;
    const { unmount } = render(<ConfiguracionGeneralReservas parte="servicio" />);

    const comida = within(seccion()).getByLabelText(/Ocupación de mesa · Comida/);
    expect(comida).toHaveValue(105);
    expect(comida).toBeDisabled();
    // «Servicio» ya no tiene interruptores (11/11/2026: fuera «Avisar en la campana»).
    for (const interruptor of screen.queryAllByRole("switch")) expect(interruptor).toBeDisabled();
    expect(screen.queryByRole("button", { name: /guardar/i })).not.toBeInTheDocument();
    unmount();

    render(<ConfiguracionGeneralReservas parte="reglas" />);
    expect(screen.getByLabelText(/Máximo de días de antelación/)).toHaveValue(60);
    expect(screen.getByLabelText(/Máximo de días de antelación/)).toBeDisabled();
    for (const interruptor of screen.getAllByRole("switch")) expect(interruptor).toBeDisabled();
    expect(screen.queryByRole("button", { name: /guardar/i })).not.toBeInTheDocument();
  });

  it("con «Puede editar»: campos activos y botón de guardar (en los dos chips)", () => {
    const { unmount } = render(<ConfiguracionGeneralReservas parte="servicio" />);

    expect(within(seccion()).getByLabelText(/Ocupación de mesa · Comida/)).toBeEnabled();
    expect(screen.queryAllByRole("switch").every((s) => !(s as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole("button", { name: /guardar/i })).toBeEnabled();
    unmount();

    render(<ConfiguracionGeneralReservas parte="reglas" />);
    expect(screen.getByLabelText(/Máximo de días de antelación/)).toBeEnabled();
    expect(screen.getAllByRole("switch").every((s) => !(s as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole("button", { name: /guardar/i })).toBeEnabled();
  });
});
