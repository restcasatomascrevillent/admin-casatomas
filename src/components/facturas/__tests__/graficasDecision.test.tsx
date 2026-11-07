// Gráficas de decisión de Análisis (20261115100000): las cuatro tarjetas con
// datos de la maqueta. Subidas por € al mes, pestañas, abrir la factura,
// «Visto»/«Es normal» (solo con «Editar»), minigráficas con aviso y precio
// pactado, «Revisar unidades», familias frente a su media y ahorro.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn(async (_fn: string, _a?: Record<string, unknown>) => ({ data: { ok: true }, error: null as null | { code?: string; message?: string } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: (fn: string, a?: Record<string, unknown>) => rpc(fn, a),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no" } }) }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { normalizarDecision } from "@/lib/facturas/decision";
import { EdicionFacturasContext } from "@/components/facturas/analisis/edicionFacturas";
import { CambiosDePrecio, DondeAhorrar, FamiliasFrenteMedia, PreciosLoMasComprado } from "@/components/facturas/analisis/Decision";
import { RESPUESTA } from "@/lib/facturas/__tests__/decisionRespuesta";

const montar = (n: ReactNode, editar = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <EdicionFacturasContext.Provider value={editar}>{n}</EdicionFacturasContext.Provider>
    </QueryClientProvider>,
  );

const dec = () => normalizarDecision(RESPUESTA);

beforeEach(() => rpc.mockClear());

describe("¿Qué me están subiendo?", () => {
  it("ordena por € al mes, dice cuáles no avisan y cambia de pestaña", () => {
    montar(<CambiosDePrecio decision={dec()} onExplorar={vi.fn()} />);
    const t = screen.getByTestId("tarjeta-subidas");
    const filas = within(t).getAllByRole("listitem");
    expect(filas[0].textContent).toContain("Sube Percebe");
    expect(filas[0].textContent).toContain("62 € al mes");
    expect(filas[1].textContent).toContain("0,95 €/kg el 02/10 · antes 0,63 · +52 % · 2 € al mes");
    expect(filas[1].textContent).toContain("sin aviso");
    expect(within(t).getByText(/1 subida pequeña \(menos de 10 € al mes\)/)).toBeTruthy();

    fireEvent.click(within(t).getByRole("button", { name: "Más barato en otro (2)" }));
    expect(within(t).getByRole("button", { name: "Más barato en otro (2)" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(t).getAllByRole("button", { name: /No es lo mismo/ })).toHaveLength(2);
    expect(within(t).getByText(/Cetárea Angelmar → Casimiro Pérez/)).toBeTruthy();
    fireEvent.click(within(t).getByRole("button", { name: "Bajan (0)" }));
    expect(within(t).getByText(/Ninguna bajada/)).toBeTruthy();
  });

  it("«Ver factura» abre el original y «Ver en la gráfica» lleva al explorador", () => {
    const onExplorar = vi.fn();
    montar(<CambiosDePrecio decision={dec()} onExplorar={onExplorar} />);
    const t = screen.getByTestId("tarjeta-subidas");
    fireEvent.click(within(t).getAllByRole("button", { name: /Ver en la gráfica/ })[0]);
    expect(onExplorar).toHaveBeenCalledWith(expect.objectContaining({ medida: "precio", filtros: expect.objectContaining({ productos: ["PERCEBE GALLEGO G"], unidad: null }) }));
    fireEvent.click(within(t).getByRole("button", { name: /Ver factura/ }));
    const visor = screen.getByRole("dialog");
    expect(visor.textContent).toContain("260489");
    expect(visor.textContent).toContain("Cetárea Angelmar");
  });

  it("«Visto» y «Es normal» llaman a su RPC; sin «Editar» no salen", async () => {
    const { unmount } = montar(<CambiosDePrecio decision={dec()} onExplorar={vi.fn()} />);
    const t = screen.getByTestId("tarjeta-subidas");
    fireEvent.click(within(t).getAllByRole("button", { name: /Visto/ })[0]);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("facturas_alerta_visto", { p_id: "s1" }));
    fireEvent.click(within(t).getAllByRole("button", { name: /Es normal/ })[1]);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("facturas_alerta_es_normal", { p_id: "s2", p_dias: null }));
    unmount();
    montar(<CambiosDePrecio decision={dec()} onExplorar={vi.fn()} />, false);
    expect(screen.queryByRole("button", { name: /Visto/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Ver factura/ })).toHaveLength(1);
  });
});

describe("¿En qué se va el dinero?", () => {
  it("barra, raya de la media, chip de % y «Aviso» en lo que se sale", () => {
    const acciones = vi.fn(() => []);
    montar(<FamiliasFrenteMedia decision={dec()} acciones={acciones} sinClasificar={{ lineas: 3, importe: 500 }} onClasificar={vi.fn()} />);
    const t = screen.getByTestId("tarjeta-familias");
    expect(within(t).getByText(/la media de mayo–agosto/)).toBeTruthy();
    const congelados = t.querySelector('[data-aviso="true"]') as HTMLElement;
    expect(congelados.textContent).toContain("Congelados");
    expect(within(congelados).getByText("Aviso")).toBeTruthy();
    expect(within(congelados).getByText("+30 %")).toBeTruthy();
    expect(within(t).getByRole("button", { name: /Clasificar con IA/ })).toBeTruthy();
  });
});

describe("¿Cómo van los precios de lo que más compro?", () => {
  it("minigráfica con su precio y pactado; «Revisar unidades»; quitar el pacto", async () => {
    const onVer = vi.fn();
    montar(<PreciosLoMasComprado decision={dec()} onExplorar={vi.fn()} onVerDocumentos={onVer} />);
    const t = screen.getByTestId("tarjeta-precios-top");
    expect(within(t).getByText(/Pactado 203,98/)).toBeTruthy();
    expect(within(t).getByTestId("revisar-unidades").textContent).toMatch(/Jamón 5J mezcla compras por pieza \(519,17\s€\) y por kg \(45,00\s€\)/);
    fireEvent.click(within(t).getByRole("button", { name: /Cruzcampo barril 50 l/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ver sus facturas" }));
    expect(onVer).toHaveBeenCalledWith(expect.objectContaining({ clave: "c:1" }));
    fireEvent.click(within(t).getByRole("button", { name: /Cruzcampo barril 50 l/ }));
    fireEvent.click(screen.getByRole("button", { name: /Quitar el precio pactado/ }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("facturas_precio_pactado_quitar", { p_proveedor_id: 3, p_nombre_normalizado: "barril cruzcampo" }),
    );
  });
});

describe("¿Dónde puedo ahorrar?", () => {
  it("total en 90 días y una barra por producto", () => {
    montar(<DondeAhorrar decision={dec()} />);
    const t = screen.getByTestId("tarjeta-ahorro");
    expect(within(t).getAllByText(/219,00/).length).toBeGreaterThan(0);
    expect(within(t).getAllByRole("listitem")).toHaveLength(2);
    expect(within(t).getByText("Cetárea Angelmar → Casimiro Pérez")).toBeTruthy();
  });
});
