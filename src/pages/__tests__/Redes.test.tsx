import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { origenRrss, urlEmbebida } from "@/lib/redes";

// Redes (23/11/2026): pide el pase al servidor, abre rrss en un iframe aislado con el pase en el
// fragmento y vuelve a pedirlo solo cuando rrss (y nadie más) avisa de que la sesión se perdió.

const h = vi.hoisted(() => ({ invocaciones: 0, error: null as null | { context: Response } }));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async () => {
        h.invocaciones++;
        return h.error ? { data: null, error: h.error } : { data: { pase: `pase.${h.invocaciones}.firma` }, error: null };
      },
    },
  },
}));

const RRSS = "https://rrss.ejemplo.test";

beforeEach(() => {
  h.invocaciones = 0;
  h.error = null;
  vi.stubEnv("VITE_RRSS_URL", RRSS);
});

describe("Redes", () => {
  it("abre rrss con el pase en el fragmento, sin dejarle mover el panel", async () => {
    const { default: Redes } = await import("../Redes");
    render(<Redes />);
    const iframe = await screen.findByTestId("redes-iframe");
    expect(iframe.getAttribute("src")).toBe(`${RRSS}/embed#pass=pase.1.firma`);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-top-navigation");
  });

  it("si rrss avisa de que la sesión se perdió, pide otro pase; un aviso de otro origen no hace nada", async () => {
    const { default: Redes } = await import("../Redes");
    render(<Redes />);
    await screen.findByTestId("redes-iframe");
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { origin: "https://malo.test", data: { type: "rrss:expired" } }));
    });
    expect(h.invocaciones).toBe(1);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { origin: RRSS, data: { type: "rrss:expired" } }));
    });
    await waitFor(() => expect(screen.getByTestId("redes-iframe").getAttribute("src")).toContain("pase.2.firma"));
  });

  it("sin permiso: enseña el motivo y no abre nada", async () => {
    h.error = { context: new Response(JSON.stringify({ error: "No tienes permiso para Redes." }), { status: 403 }) };
    const { default: Redes } = await import("../Redes");
    render(<Redes />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para Redes.");
    expect(screen.queryByTestId("redes-iframe")).toBeNull();
  });

  it("solo acepta una dirección https (o local) para rrss", () => {
    expect(origenRrss("https://rrss-omega.vercel.app/algo")).toBe("https://rrss-omega.vercel.app");
    expect(origenRrss("http://localhost:5173")).toBe("http://localhost:5173");
    expect(origenRrss("http://rrss.ejemplo.test")).toBeNull();
    expect(origenRrss("javascript:alert(1)")).toBeNull();
    expect(origenRrss("")).toBeNull();
    expect(urlEmbebida(RRSS, "a.b.c")).toBe(`${RRSS}/embed#pass=a.b.c`);
  });
});
