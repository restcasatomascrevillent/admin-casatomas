import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULOS_PANEL, valorInterruptor } from "@/lib/modulosPanel";

const h = vi.hoisted(() => ({
  toggles: [] as Array<{ section_key: string; label: string; enabled: boolean; updated_at?: string | null }>,
  loading: false,
  setEnabled: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({
  useAdminFeatureToggles: () => ({
    toggles: h.toggles,
    loading: h.loading,
    // Igual que el hook de verdad: sin fila, activado (o lo que valga el módulo del que hereda).
    isEnabled: (k: string) => valorInterruptor(k, h.toggles),
    setEnabled: h.setEnabled,
    refetch: h.refetch,
  }),
}));

import SuperAdminPanel from "@/pages/SuperAdminPanel";

beforeEach(() => {
  h.loading = false;
  h.setEnabled.mockReset().mockResolvedValue(true);
  h.refetch.mockReset().mockResolvedValue(undefined);
  // Las 7 filas de producción (14/11/2026), ordenadas por etiqueta como las devuelve la BD; Facturas apagado.
  h.toggles = [
    { section_key: "cheques", label: "Cheques regalo", enabled: true, updated_at: "2026-10-06T18:28:48Z" },
    { section_key: "facturas", label: "Facturas", enabled: false, updated_at: "2026-11-02T10:00:00Z" },
    { section_key: "gestion_web", label: "Gestor Web", enabled: true },
    { section_key: "marketing", label: "Newsletter", enabled: true },
    { section_key: "reservas", label: "Reservas", enabled: true },
    { section_key: "tienda", label: "Tienda", enabled: true },
    { section_key: "usuarios", label: "Usuarios", enabled: true },
    // Una fila que ya no es de ningún módulo no sale (no controla nada).
    { section_key: "espacios", label: "Espacios", enabled: true },
  ];
});

const tarjetas = () => screen.getAllByTestId(/^funcionalidad-/).map((li) => li.getAttribute("data-testid")!.replace("funcionalidad-", ""));

describe("Control del Panel", () => {
  it("enseña TODOS los módulos del catálogo, agrupados y en el orden del menú, tengan fila o no", () => {
    render(<SuperAdminPanel />);
    expect(screen.getByRole("heading", { level: 1, name: "Control del Panel" })).toBeInTheDocument();
    expect(tarjetas()).toEqual(MODULOS_PANEL.map((m) => m.clave));
    expect(tarjetas()).toEqual([
      "dashboard", "reservas",
      "gestion_web", "marketing", "rrss", "cheques", "tienda",
      "facturas", "albaranes", "usuarios",
      "peticiones", "ayuda", "avisos", "mi_cuenta",
    ]);
    expect(screen.queryByTestId("funcionalidad-espacios")).toBeNull();
    // Grupos con su título; cada lista se llama como su grupo.
    const grupos = { "Día a día": ["dashboard", "reservas"], "Web y clientes": ["gestion_web", "marketing", "rrss", "cheques", "tienda"], "Compras y equipo": ["facturas", "albaranes", "usuarios"], "Ayuda y cuenta": ["peticiones", "ayuda", "avisos", "mi_cuenta"] };
    for (const [titulo, claves] of Object.entries(grupos)) {
      const lista = screen.getByRole("list", { name: titulo });
      expect(within(lista).getAllByRole("listitem").map((li) => li.getAttribute("data-testid"))).toEqual(claves.map((c) => `funcionalidad-${c}`));
    }
  });

  it("resumen: activados de los que se pueden apagar, desactivados y último cambio", () => {
    render(<SuperAdminPanel />);
    const resumen = screen.getByTestId("resumen-control");
    // 10 se pueden apagar; Facturas apagado (Subir albaranes hereda de Facturas mientras no tenga fila).
    expect(within(resumen).getByText("Activados").nextSibling).toHaveTextContent("8de 10");
    expect(within(resumen).getByText("Desactivados").nextSibling).toHaveTextContent("2");
    expect(within(resumen).getByText("Último cambio")).toBeInTheDocument();
  });

  it("sin fila, el módulo sale «Activado»; cada tarjeta lleva su descripción y su estado", () => {
    render(<SuperAdminPanel />);
    const peticiones = screen.getByTestId("funcionalidad-peticiones");
    expect(peticiones).toHaveAttribute("data-activa", "true");
    expect(within(peticiones).getByText("Activado · lo ve el equipo")).toBeInTheDocument();
    expect(within(peticiones).getByText(/Reportar errores, pedir mejoras/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Nueva petición" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "RRSS" })).toBeChecked();

    const facturas = screen.getByTestId("funcionalidad-facturas");
    expect(facturas).toHaveAttribute("data-activa", "false");
    const interruptor = screen.getByRole("switch", { name: "Facturas" });
    expect(interruptor).not.toBeChecked();
    expect(interruptor).toHaveAccessibleDescription("Desactivado · oculto para el equipo");
    expect(within(facturas).getByText(/^Último cambio /)).toBeInTheDocument();
    // Sin fila no hay «Último cambio».
    expect(within(peticiones).queryByText(/^Último cambio /)).toBeNull();
    expect(within(screen.getByTestId("funcionalidad-reservas")).getByText(/Libro de reservas/)).toBeInTheDocument();
  });

  it("Subir albaranes empieza como Facturas (si estaba apagado, sigue apagado) y tiene su propio interruptor", () => {
    render(<SuperAdminPanel />);
    expect(screen.getByRole("switch", { name: "Subir albaranes" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Subir albaranes" }));
    return waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("albaranes", "Subir albaranes", true));
  });

  it("Dashboard, Ayuda, Avisos y Mi cuenta: «Siempre activo», sin interruptor y con el porqué", () => {
    render(<SuperAdminPanel />);
    for (const clave of ["dashboard", "ayuda", "avisos", "mi_cuenta"]) {
      const tarjeta = screen.getByTestId(`funcionalidad-${clave}`);
      expect(within(tarjeta).queryByRole("switch")).toBeNull();
      expect(within(tarjeta).getByText("Siempre activo")).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("funcionalidad-dashboard")).getByText(/portada del panel/)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(10);
  });

  it("el interruptor y el nombre cambian el módulo (la fila se crea al primer cambio)", async () => {
    render(<SuperAdminPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "Facturas" }));
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("facturas", "Facturas", true));
    fireEvent.click(screen.getByText("Reservas", { selector: "label" }));
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("reservas", "Reservas", false));
    // RRSS y Nueva petición no tienen fila: se guardan con su clave nueva.
    fireEvent.click(screen.getByRole("switch", { name: "RRSS" }));
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("rrss", "RRSS", false));
    fireEvent.click(screen.getByRole("switch", { name: "Nueva petición" }));
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("peticiones", "Nueva petición", false));
  });

  it("mientras guarda, el interruptor no se puede volver a pulsar", async () => {
    let terminar: (v: boolean) => void = () => {};
    h.setEnabled.mockImplementation(() => new Promise<boolean>((r) => { terminar = r; }));
    render(<SuperAdminPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "Usuarios" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Usuarios" })).toBeDisabled());
    expect(screen.getByLabelText("Guardando")).toBeInTheDocument();
    terminar(true);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Usuarios" })).toBeEnabled());
  });

  it("al abrirse vuelve a leer los interruptores; mientras carga, lo dice", () => {
    h.loading = true;
    const { rerender } = render(<SuperAdminPanel />);
    expect(h.refetch).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando los módulos…");
    expect(screen.queryByTestId("resumen-control")).toBeNull();
    h.loading = false;
    h.toggles = [];
    rerender(<SuperAdminPanel />);
    // Sin ninguna fila (BD vacía): todos activados.
    expect(within(screen.getByTestId("resumen-control")).getByText("Activados").nextSibling).toHaveTextContent("10de 10");
    expect(screen.getAllByRole("switch").every((s) => s.getAttribute("aria-checked") === "true")).toBe(true);
  });
});
