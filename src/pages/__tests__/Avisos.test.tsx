import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const h = vi.hoisted(() => ({
  filas: [] as Array<Record<string, unknown>>,
  llamadas: [] as Array<{ op: string; args: unknown[] }>,
  rango: [] as number[][],
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "order", "eq", "in", "not"]) {
        b[op] = (...args: unknown[]) => (h.llamadas.push({ op, args }), b);
      }
      b.update = (...args: unknown[]) => (h.llamadas.push({ op: "update", args }), b);
      b.range = (a: number, z: number) => {
        h.rango.push([a, z]);
        return Promise.resolve({ data: h.filas.slice(a, z + 1), error: null });
      };
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok);
      return b;
    },
  },
}));

import Avisos from "../Avisos";

const ahora = new Date();
const aviso = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `n${i}`,
  tipo: "sistema",
  titulo: `Aviso ${i}`,
  mensaje: null,
  referencia_id: null,
  referencia_tipo: null,
  leida: false,
  created_at: ahora.toISOString(),
  ...extra,
});

function Ubicacion() {
  const l = useLocation();
  return <p data-testid="ruta">{l.pathname + l.search}</p>;
}
const montar = () =>
  render(
    <MemoryRouter initialEntries={["/avisos"]}>
      <Routes>
        <Route path="/avisos" element={<Avisos />} />
        <Route path="*" element={<Ubicacion />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  h.llamadas = [];
  h.rango = [];
  h.filas = [];
});

describe("Avisos", () => {
  it("agrupa por día, muestra Hoy y marca como leído", async () => {
    h.filas = [aviso(1), aviso(2, { created_at: new Date(ahora.getTime() - 3 * 86_400_000).toISOString() })];
    montar();
    expect(await screen.findByText("Aviso 1")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Hoy" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar como leído: Aviso 1" }));
    await waitFor(() => expect(h.llamadas.some((c) => c.op === "update")).toBe(true));
    expect(screen.queryByRole("button", { name: "Marcar como leído: Aviso 1" })).toBeNull();
  });

  it("marcar todos como leídos actualiza solo las no leídas", async () => {
    h.filas = [aviso(1), aviso(2)];
    montar();
    await screen.findByText("Aviso 1");
    fireEvent.click(screen.getByRole("button", { name: /Marcar todos como leídos/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Marcar todos como leídos/ })).toBeDisabled());
    expect(h.llamadas).toContainEqual({ op: "eq", args: ["leida", false] });
  });

  it("filtra por tipo con chips y pagina con «Cargar más»", async () => {
    h.filas = Array.from({ length: 31 }, (_, i) => aviso(i));
    montar();
    await screen.findByText("Aviso 0");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Aviso 30");
    expect(h.rango).toEqual([[0, 29], [30, 59]]);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Facturas" }));
    await waitFor(() =>
      expect(h.llamadas).toContainEqual({ op: "in", args: ["tipo", ["facturas_subida", "subida_precio"]] }),
    );
  });

  it("al abrir un aviso con origen navega a él", async () => {
    h.filas = [aviso(1, { tipo: "facturas_subida", referencia_tipo: "facturas_cargar" })];
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Aviso 1 (abrir)" }));
    expect(await screen.findByTestId("ruta")).toHaveTextContent("/facturas?tab=cargar");
  });
});
