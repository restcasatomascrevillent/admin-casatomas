/**
 * RRSS (antes «Instagram»): tres pestañas, la agencia solo ve Instagram, y
 * /instagram?… redirige a /rrss?red=instagram conservando los parámetros.
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

const roles = { cargando: false, agencia: false, restaurante: true };
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/instagram/encargos/useEncargos", () => ({ useRolesEncargos: () => roles }));
vi.mock("@/pages/Instagram", () => ({ ContenidoInstagram: () => <div>Contenido de Instagram</div> }));
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

  it("tiene las pestañas Instagram, Facebook y Subida de fotos; Instagram por defecto", () => {
    montar("/rrss");
    expect(screen.getByRole("tab", { name: /Instagram/ })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: /Facebook/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Subida de fotos/ })).toBeInTheDocument();
    expect(screen.getByText("Contenido de Instagram")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "RRSS" })).toBeInTheDocument();
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
    expect(screen.getByText("Contenido de Instagram")).toBeInTheDocument();
  });

  it("/instagram?tab=encargos&encargo=… sigue funcionando: va a RRSS › Instagram con los mismos parámetros", () => {
    montar("/instagram?tab=encargos&encargo=e1");
    expect(screen.getByTestId("donde").textContent).toBe("/rrss?tab=encargos&encargo=e1&red=instagram");
    expect(screen.getByText("Contenido de Instagram")).toBeInTheDocument();
  });
});
