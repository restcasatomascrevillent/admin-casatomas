import { render, screen } from "@testing-library/react";
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
});
