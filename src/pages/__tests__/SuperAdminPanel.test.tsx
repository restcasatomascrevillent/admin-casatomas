import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  toggles: [] as Array<{ section_key: string; label: string; enabled: boolean; updated_at?: string | null }>,
  loading: false,
  setEnabled: vi.fn(),
}));
vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({
  useAdminFeatureToggles: () => ({
    toggles: h.toggles,
    loading: h.loading,
    isEnabled: (k: string) => h.toggles.find((t) => t.section_key === k)?.enabled ?? true,
    setEnabled: h.setEnabled,
  }),
}));

import SuperAdminPanel from "@/pages/SuperAdminPanel";

beforeEach(() => {
  h.loading = false;
  h.setEnabled.mockReset().mockResolvedValue(true);
  // Llegan ordenadas por etiqueta, como las devuelve la BD.
  h.toggles = [
    { section_key: "cheques", label: "Cheques regalo", enabled: true, updated_at: "2026-10-06T18:28:48Z" },
    { section_key: "facturas", label: "Facturas", enabled: false, updated_at: "2026-11-02T10:00:00Z" },
    { section_key: "gestion_web", label: "Gestor Web", enabled: true },
    { section_key: "marketing", label: "Newsletter", enabled: true },
    { section_key: "reservas", label: "Reservas", enabled: true },
    { section_key: "usuarios", label: "Usuarios", enabled: true },
    { section_key: "nueva_cosa", label: "Algo nuevo", enabled: true },
  ];
});

describe("Control del Panel", () => {
  it("cabecera, resumen y una tarjeta por funcionalidad en el orden del menú", () => {
    render(<SuperAdminPanel />);
    expect(screen.getByRole("heading", { level: 1, name: "Control del Panel" })).toBeInTheDocument();
    const resumen = screen.getByTestId("resumen-control");
    expect(within(resumen).getByText("Activas").nextSibling).toHaveTextContent("6de 7");
    expect(within(resumen).getByText("Desactivadas").nextSibling).toHaveTextContent("1");
    const lista = screen.getByRole("list", { name: "Funcionalidades del Admin Panel" });
    expect(within(lista).getAllByRole("listitem").map((li) => li.getAttribute("data-testid"))).toEqual([
      "funcionalidad-reservas", "funcionalidad-gestion_web", "funcionalidad-marketing",
      "funcionalidad-cheques", "funcionalidad-facturas", "funcionalidad-usuarios", "funcionalidad-nueva_cosa",
    ]);
  });

  it("cada tarjeta dice su estado con texto y color, y el interruptor lo describe", () => {
    render(<SuperAdminPanel />);
    const facturas = screen.getByTestId("funcionalidad-facturas");
    expect(facturas).toHaveAttribute("data-activa", "false");
    expect(within(facturas).getByText("Desactivada · oculta para todos")).toBeInTheDocument();
    const interruptor = screen.getByRole("switch", { name: "Facturas" });
    expect(interruptor).not.toBeChecked();
    expect(interruptor).toHaveAccessibleDescription("Desactivada · oculta para todos");
    expect(screen.getByRole("switch", { name: "Reservas" })).toBeChecked();
    expect(within(screen.getByTestId("funcionalidad-reservas")).getByText(/Libro de reservas/)).toBeInTheDocument();
    expect(within(facturas).getByText(/^Cambiada /)).toBeInTheDocument();
  });

  it("el interruptor y la etiqueta cambian la funcionalidad, igual que antes", async () => {
    render(<SuperAdminPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "Facturas" }));
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("facturas", "Facturas", true));
    fireEvent.click(screen.getByText("Reservas", { selector: "label" }));
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("reservas", "Reservas", false));
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

  it("cargando y sin funcionalidades", () => {
    h.loading = true;
    const { rerender } = render(<SuperAdminPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando las funcionalidades…");
    expect(screen.queryByTestId("resumen-control")).toBeNull();
    h.loading = false;
    h.toggles = [];
    rerender(<SuperAdminPanel />);
    expect(screen.getByText(/No hay funcionalidades configurables/)).toBeInTheDocument();
  });
});
