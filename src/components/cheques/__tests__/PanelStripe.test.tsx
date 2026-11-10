import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, functions: { invoke: mock.invoke } } }));
// Las gráficas no aportan nada aquí y recharts necesita medir el DOM.
vi.mock("recharts", () => {
  const Nada = () => null;
  return { ResponsiveContainer: Nada, BarChart: Nada, Bar: Nada, XAxis: Nada, YAxis: Nada, CartesianGrid: Nada, Tooltip: Nada };
});
import { PanelStripe } from "../PanelStripe";

const base = { pagos: 2, comision_incompleta: false, por_hora: [], por_dia: [] };
const texto = (euros: string) => new RegExp(`^${euros.replace(",", "\\,")}\\s€$`);

describe("Pestaña Stripe de Cheques", () => {
  beforeEach(() => {
    mock.rpc.mockReset();
    mock.invoke.mockResolvedValue({ data: { configurado: false }, error: null });
  });

  it("separa lo cobrado, lo que se lleva Stripe y la ganancia neta", async () => {
    mock.rpc.mockResolvedValue({ data: { ...base, bruto_eur: 152.8, valor_cheques_eur: 150, gastos_gestion_eur: 2.8, pagos_con_gastos: 2, comision_eur: 2.8, neto_eur: 150 }, error: null });
    render(<PanelStripe />);
    expect(await screen.findByText("Ganancia neta con cheques")).toBeTruthy();
    expect(screen.getByText(texto("152,80"))).toBeTruthy();
    expect(screen.getAllByText(texto("2,80"))).toHaveLength(2); // gastos cobrados y comisión
    expect(screen.getAllByText(texto("150,00"))).toHaveLength(2); // valor de los cheques y neto
    expect(screen.getByText("2 de 2 pagos")).toBeTruthy();
    expect(screen.getByText("Los gastos cubren la comisión")).toBeTruthy();
  });

  it("avisa cuando los gastos no cubren la comisión", async () => {
    mock.rpc.mockResolvedValue({ data: { ...base, bruto_eur: 100, valor_cheques_eur: 100, gastos_gestion_eur: 0, pagos_con_gastos: 0, comision_eur: 1.75, neto_eur: 98.25 }, error: null });
    render(<PanelStripe />);
    expect(await screen.findByText("La comisión no la cubren del todo los gastos")).toBeTruthy();
    expect(screen.getByText(/^-1,75\s€$/)).toBeTruthy();
  });

  it("con el RPC anterior a los gastos no enseña el desglose", async () => {
    mock.rpc.mockResolvedValue({ data: { ...base, bruto_eur: 100, comision_eur: 1.75, neto_eur: 98.25 }, error: null });
    render(<PanelStripe />);
    expect(await screen.findByText("Ganancia neta con cheques")).toBeTruthy();
    expect(screen.queryByText("Gastos de gestión cobrados")).toBeNull();
  });

  it("compara con el periodo anterior de la misma duración", async () => {
    mock.rpc.mockImplementation((_n: string, p: { p_desde: string; p_hasta: string }) => {
      // La primera llamada es la del rango elegido (termina hoy); la otra, la del periodo anterior.
      const actual = p.p_hasta >= new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      return Promise.resolve({ data: { ...base, pagos: actual ? 3 : 2, bruto_eur: actual ? 150 : 100, valor_cheques_eur: actual ? 150 : 100, gastos_gestion_eur: 0, pagos_con_gastos: 0, comision_eur: 2, neto_eur: 148 }, error: null });
    });
    render(<PanelStripe />);
    expect(await screen.findAllByText("+50 % vs. anterior")).toHaveLength(2); // pagos y cobrado
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });

  it("con la cuenta en producción y todo activo, recoge los pasos de activación", async () => {
    mock.invoke.mockResolvedValue({ data: { configurado: true, modo: "live", cobros_activos: true, payouts_activos: true, detalles_completos: true }, error: null });
    mock.rpc.mockResolvedValue({ data: { ...base, pagos: 0, bruto_eur: 0, comision_eur: 0, neto_eur: 0 }, error: null });
    render(<PanelStripe />);
    const desplegable = await screen.findByRole("button", { name: /Pasos de activación \(ya completados\)/ });
    expect(screen.queryByText("Pasos para pasar a producción")).toBeNull();
    expect(screen.queryByText("Activar la cuenta de Stripe")).toBeNull();
    fireEvent.click(desplegable);
    expect(screen.getByText("Activar la cuenta de Stripe")).toBeTruthy();
  });

  it("en modo de pruebas enseña los pasos para pasar a producción", async () => {
    mock.invoke.mockResolvedValue({ data: { configurado: true, modo: "test", cobros_activos: true, payouts_activos: false, detalles_completos: true }, error: null });
    mock.rpc.mockResolvedValue({ data: { ...base, pagos: 0, bruto_eur: 0, comision_eur: 0, neto_eur: 0 }, error: null });
    render(<PanelStripe />);
    expect(await screen.findByText("Pasos para pasar a producción")).toBeTruthy();
    expect(screen.getByText("Modo de pruebas")).toBeTruthy();
  });

  it("sin pagos lo dice y siempre ofrece generar el informe", async () => {
    mock.rpc.mockResolvedValue({ data: { ...base, pagos: 0, bruto_eur: 0, comision_eur: 0, neto_eur: 0 }, error: null });
    render(<PanelStripe />);
    expect(await screen.findByText(/Sin pagos por Stripe en este rango de fechas/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generar informe/ })).toBeTruthy();
  });

  it("las fechas al revés no consultan y avisan", async () => {
    mock.rpc.mockResolvedValue({ data: { ...base, bruto_eur: 0, comision_eur: 0, neto_eur: 0 }, error: null });
    render(<PanelStripe />);
    await screen.findByText("Ganancia neta con cheques");
    mock.rpc.mockClear();
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2099-01-01" } });
    expect(await screen.findByText("La fecha «desde» no puede ser posterior a «hasta».")).toBeTruthy();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
