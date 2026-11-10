/**
 * RRSS (antes «Instagram»): cuatro pestañas (Instagram, Facebook, Subida de
 * fotos y Métricas, el panel global), la agencia solo ve Instagram, y
 * /instagram?… redirige a /rrss?red=instagram conservando los parámetros.
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

const roles = { cargando: false, agencia: false, restaurante: true };
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/instagram/encargos/useEncargos", () => ({ useRolesEncargos: () => roles }));
vi.mock("@/pages/Instagram", () => ({
  ContenidoInstagram: ({ onIrMetricas }: { onIrMetricas?: () => void }) => (
    <div>
      Contenido de Instagram
      <button type="button" onClick={onIrMetricas}>
        Ir a métricas
      </button>
    </div>
  ),
}));
vi.mock("@/components/rrss/metricas/MetricasRRSS", () => ({ MetricasRRSS: () => <div>Panel de métricas global</div> }));
vi.mock("@/components/rrss/facebook/FacebookRRSS", () => ({ FacebookRRSS: () => <div>Pestaña Facebook</div> }));
vi.mock("@/components/rrss/editor/EditorIA", () => ({ EditorIA: (p: { origen?: string }) => <div>Editor IA ({p.origen})</div> }));
vi.mock("@/components/rrss/ideas/IdeasGrabar", () => ({ IdeasGrabar: () => <div>Ideas para grabar</div> }));

import RRSS from "../RRSS";

function Donde() {
  const l = useLocation();
  return <output data-testid="donde">{l.pathname + l.search}</output>;
}

/** La misma redirección que App.tsx (RedirigirInstagram). */
function RedirigirInstagram() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("red", "instagram");
  return <Navigate to={`/rrss?${p.toString()}`} replace />;
}

function montar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/rrss" element={<><RRSS /><Donde /></>} />
        <Route path="/instagram" element={<RedirigirInstagram />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RRSS", () => {
  beforeEach(() => Object.assign(roles, { cargando: false, agencia: false, restaurante: true }));

  it("tiene las pestañas Instagram, Facebook, Subida de fotos y Métricas; Instagram por defecto", () => {
    montar("/rrss");
    expect(screen.getByRole("tab", { name: /Instagram/ })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: /Facebook/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Subida de fotos/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Métricas/ })).toBeInTheDocument();
    expect(screen.getByText("Contenido de Instagram")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "RRSS" })).toBeInTheDocument();
  });

  it("tiene una sola pestaña de Métricas para todas las redes (?red=metricas)", async () => {
    montar("/rrss?red=metricas");
    expect(screen.getByRole("tab", { name: /Métricas/ })).toHaveAttribute("data-state", "active");
    expect(await screen.findByText("Panel de métricas global")).toBeInTheDocument();
  });

  it("los enlaces antiguos a Instagram › Métricas abren RRSS › Métricas", async () => {
    montar("/instagram?tab=metricas");
    expect(screen.getByRole("tab", { name: /Métricas/ })).toHaveAttribute("data-state", "active");
    expect(await screen.findByText("Panel de métricas global")).toBeInTheDocument();
  });

  it("el enlace «Métricas» de Instagram lleva al panel global", async () => {
    montar("/rrss?red=instagram");
    fireEvent.click(screen.getByRole("button", { name: "Ir a métricas" }));
    expect(await screen.findByText("Panel de métricas global")).toBeInTheDocument();
    expect(screen.getByTestId("donde").textContent).toBe("/rrss?red=metricas");
  });

  it("?red=editor abre el editor IA y deja elegir «Dame ideas para grabar»", async () => {
    montar("/rrss?red=editor");
    expect(await screen.findByText("Editor IA (editor)")).toBeInTheDocument();
    expect(screen.getByText(/Editor IA de fotos y vídeos/)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Dame ideas para grabar/ }));
    expect(await screen.findByText("Ideas para grabar")).toBeInTheDocument();
  });

  it("cambiar de pestaña pone ?red= y quita los parámetros de Instagram", async () => {
    montar("/rrss?red=instagram&tab=encargos&encargo=abc");
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Facebook/ }));
    expect(await screen.findByText("Pestaña Facebook")).toBeInTheDocument();
    expect(screen.getByTestId("donde").textContent).toBe("/rrss?red=facebook");
  });

  it("la agencia (sin Marketing) solo ve Instagram, sin las otras pestañas", () => {
    Object.assign(roles, { agencia: true, restaurante: false });
    montar("/rrss?red=editor");
    expect(screen.queryByRole("tab", { name: /Facebook/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Subida de fotos/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Métricas/ })).toBeNull();
    expect(screen.getByText("Contenido de Instagram")).toBeInTheDocument();
  });

  it("/instagram?tab=encargos&encargo=… sigue funcionando: va a RRSS › Instagram con los mismos parámetros", () => {
    montar("/instagram?tab=encargos&encargo=e1");
    expect(screen.getByTestId("donde").textContent).toBe("/rrss?tab=encargos&encargo=e1&red=instagram");
    expect(screen.getByText("Contenido de Instagram")).toBeInTheDocument();
  });
});
