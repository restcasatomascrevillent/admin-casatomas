// «Al instante» bajo la gráfica de «Explorar» (06/11/2026, petición del dueño):
// los chips de antes del chat vuelven DEBAJO de la gráfica del explorador y, al
// pulsar uno, su resultado (sin IA, RPC `*_agente`) ocupa el hueco de la gráfica.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./dobleAnalisis")).doble.supabase }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));

import { doble, explorar, TABLERO } from "./dobleAnalisis";
import { ChatFacturas } from "../ChatFacturas";

function montar(props: { onIrA?: (e: string) => void } = {}, url = "/facturas?tab=chat") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ChatFacturas {...props} />, { wrapper: envoltorio });
}

const RANKING = {
  filas: [
    { proveedor: "EMBAJADORES MADRID", documentos: 9, importe: 101519.68 },
    { proveedor: "DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.", documentos: 23, importe: 59455.96 },
  ],
  total_filas: 243,
  truncado: true,
};
const CON_AVISOS = {
  filas: [
    {
      id: 2368, tipo: "factura", fecha: "2026-10-15", total: 1017.57, numero: "FVE2026110398", proveedor: "COOPERATIVA ELÉCTRICA",
      alertas: [{ codigo: "descuadre_linea", mensaje: "La línea de potencia P3 no cuadra." }],
    },
  ],
  total_filas: 1,
  truncado: false,
};

async function explorador() {
  const ex = await screen.findByRole("region", { name: "Explorar" });
  // La gráfica del explorador ya ha salido.
  await within(ex).findByText("308.808,70 €");
  return ex;
}
const fila = (ex: HTMLElement) => within(within(ex).getByTestId("al-instante")).getByRole("group");
const chip = (ex: HTMLElement, nombre: string) => within(fila(ex)).getByRole("button", { name: nombre });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  doble.reiniciar();
  doble.rpcs.tablero_compras = () => TABLERO;
  doble.rpcs.explorar_compras = explorar;
  doble.rpcs.ranking_agente = () => RANKING;
  doble.rpcs.filtrar_documentos_agente = (a) => (a.p_filtro === "con_alertas" ? CON_AVISOS : { filas: [], total_filas: 0, truncado: false });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 6, 12));
});

describe("Al instante: la fila de chips", () => {
  it("bajo la gráfica, sin título, solo los que NO están ya en los presets de arriba, sin pulsar y con su explicación", async () => {
    montar();
    const ex = await explorador();
    const botones = within(fila(ex)).getAllByRole("button");
    expect(botones.map((b) => b.textContent)).toEqual([
      "Gasto este mes",
      "Productos más comprados",
      "Por revisar",
      "Con avisos",
      "Sin total",
      "Qué ha subido de precio",
    ]);
    // Sin duplicados de los presets (06/11/2026, dueño: «estás duplicando los botones»).
    for (const repetido of ["Gasto por mes", "Top proveedores", "Gasto por categoría", "Evolución de precio"]) {
      expect(within(fila(ex)).queryByRole("button", { name: repetido })).not.toBeInTheDocument();
    }
    // Sin el rótulo «Al instante · sin IA, ocupa el sitio de la gráfica».
    expect(within(ex).queryByText(/sin IA, ocupa el sitio/)).not.toBeInTheDocument();
    expect(fila(ex)).toHaveAccessibleName("Más consultas");
    expect(botones.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(chip(ex, "Con avisos")).toHaveAccessibleDescription("Documentos con avisos de lectura o de importes.");
    // Debajo de la gráfica (en el orden del documento).
    const grafica = within(ex).getByRole("img");
    expect(grafica.compareDocumentPosition(fila(ex)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Objetivo táctil de 44 px con el dedo.
    expect(chip(ex, "Con avisos").className).toContain("pointer-coarse:min-h-11");
  });
});

describe("Al instante: pulsar sustituye la gráfica y volver la restaura", () => {
  it("«Con avisos» pide sus documentos del periodo y ocupa el hueco de la gráfica; «Volver al explorador» la devuelve", async () => {
    montar();
    const ex = await explorador();
    fireEvent.click(chip(ex, "Con avisos"));
    expect(chip(ex, "Con avisos")).toHaveAttribute("aria-pressed", "true");
    const resultado = await within(ex).findByTestId("resultado-al-instante");
    expect(within(resultado).getByRole("heading", { name: "Con avisos" })).toBeInTheDocument();
    expect(resultado).toHaveTextContent("1 ene – 31 dic 2026");
    expect(resultado).not.toHaveTextContent(/al instante, sin IA/i);
    expect(await within(resultado).findByText("La línea de potencia P3 no cuadra.")).toBeInTheDocument();
    expect(doble.llamadas("filtrar_documentos_agente")).toContainEqual(expect.objectContaining({ p_filtro: "con_alertas", p_desde: "2026-01-01", p_hasta: "2026-12-31" }));
    // La gráfica del explorador (y sus totales) ya no están: el resultado ocupa su sitio.
    expect(within(ex).queryByText("308.808,70 €")).not.toBeInTheDocument();

    fireEvent.click(within(resultado).getByRole("button", { name: "Volver al explorador" }));
    expect(within(ex).queryByTestId("resultado-al-instante")).not.toBeInTheDocument();
    expect(within(ex).getByText("308.808,70 €")).toBeInTheDocument();
    expect(chip(ex, "Con avisos")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(chip(ex, "Con avisos")).toHaveFocus());
  });

  it("pulsar otra vez el chip activo también vuelve; pulsar otro lo cambia", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    const ex = await explorador();
    fireEvent.click(chip(ex, "Con avisos"));
    const resultado = await within(ex).findByTestId("resultado-al-instante");
    expect(await within(resultado).findByText("La línea de potencia P3 no cuadra.")).toBeInTheDocument();
    expect(doble.llamadas("filtrar_documentos_agente")).toContainEqual(expect.objectContaining({ p_filtro: "con_alertas", p_desde: "2026-01-01" }));
    fireEvent.click(within(resultado).getByRole("button", { name: "Abrir la factura FVE2026110398 en Compras" }));
    expect(onIrA).toHaveBeenCalledWith("?tab=compras&modo=documentos&doc=2368");

    fireEvent.click(chip(ex, "Por revisar"));
    expect(chip(ex, "Con avisos")).toHaveAttribute("aria-pressed", "false");
    expect(await within(ex).findByText("No hay documentos por revisar en este periodo.")).toBeInTheDocument();

    fireEvent.click(chip(ex, "Por revisar"));
    expect(within(ex).queryByTestId("resultado-al-instante")).not.toBeInTheDocument();
    expect(within(ex).getByText("308.808,70 €")).toBeInTheDocument();
  });

  it("respeta el periodo de arriba (vuelve a consultar al cambiarlo) y avisa de que no separa por local", async () => {
    montar();
    const ex = await explorador();
    fireEvent.click(chip(ex, "Con avisos"));
    await within(ex).findByText("La línea de potencia P3 no cuadra.");
    fireEvent.click(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Mes" }));
    await waitFor(() => expect(doble.llamadas("filtrar_documentos_agente")).toContainEqual(expect.objectContaining({ p_filtro: "con_alertas", p_desde: "2026-11-01", p_hasta: "2026-11-30" })));
    expect(within(ex).getByTestId("resultado-al-instante")).toBeInTheDocument();
    expect(within(ex).queryByTestId("al-instante-sin-local")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Local" })).getByRole("button", { name: "Touza" }));
    expect(await within(ex).findByTestId("al-instante-sin-local")).toHaveTextContent("no separa Casa Tomás y Touza");
  });

  it("tocar la estantería (un preset) vuelve a la gráfica del explorador", async () => {
    montar();
    const ex = await explorador();
    fireEvent.click(chip(ex, "Con avisos"));
    await within(ex).findByTestId("resultado-al-instante");
    fireEvent.click(within(within(ex).getByRole("group", { name: "Gráficas rápidas" })).getByRole("button", { name: "Por familia" }));
    await waitFor(() => expect(within(ex).queryByTestId("resultado-al-instante")).not.toBeInTheDocument());
    expect(chip(ex, "Con avisos")).toHaveAttribute("aria-pressed", "false");
  });
});
