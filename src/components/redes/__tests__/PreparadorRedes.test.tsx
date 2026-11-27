import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

// Iframe oculto de Redes (26/11/2026): tras mandar las tapas a rrss, se abre rrss fuera de la
// pantalla para que prepare la historia; recibe el pase igual que la página Redes (solo su
// iframe y el origen de rrss) y se cierra cuando rrss avisa de que ha terminado.

const h = vi.hoisted(() => ({ pedidos: [] as unknown[], redes: true }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (_n: string, o: { body: unknown }) => {
        h.pedidos.push(o.body);
        return { data: { pase: "pase.firmado" }, error: null };
      },
    },
  },
}));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: h.redes, loading: false }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const RRSS = "https://rrss.ejemplo.test";
const CNF = "c".repeat(43);

beforeEach(() => {
  h.pedidos = [];
  h.redes = true;
  vi.stubEnv("VITE_RRSS_URL", RRSS);
});

function desde(iframe: HTMLIFrameElement, data: unknown, origin = RRSS) {
  const ventana = iframe.contentWindow!;
  const enviados: unknown[] = [];
  ventana.postMessage = ((d: unknown) => enviados.push(d)) as typeof ventana.postMessage;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: ventana }));
  });
  return enviados;
}

describe("PreparadorRedes", () => {
  it("se abre al mandar las tapas, da el pase solo a su iframe y se cierra al terminar", async () => {
    const { PreparadorRedes } = await import("../PreparadorRedes");
    const { EVENTO_PREPARAR_REDES } = await import("@/lib/redesTapas");
    render(<PreparadorRedes />);
    expect(screen.queryByTestId("redes-preparador")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(EVENTO_PREPARAR_REDES));
    });
    const iframe = (await screen.findByTestId("redes-preparador")) as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(`${RRSS}/embed`);
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    // Otro origen: nada.
    desde(iframe, { type: "rrss:hello", cnf: CNF }, "https://malo.test");
    expect(h.pedidos).toEqual([]);
    const enviados = desde(iframe, { type: "rrss:hello", cnf: CNF });
    await vi.waitFor(() => expect(enviados).toEqual([{ type: "rrss:pass", pass: "pase.firmado", cnf: CNF }]));
    expect(h.pedidos).toEqual([{ cnf: CNF }]);
    desde(iframe, { type: "rrss:menus-done", ready: 1, failed: 0 });
    expect(screen.queryByTestId("redes-preparador")).toBeNull();
  });

  it("sin «Redes» › «Puede editar» no se abre", async () => {
    h.redes = false;
    const { PreparadorRedes } = await import("../PreparadorRedes");
    const { EVENTO_PREPARAR_REDES } = await import("@/lib/redesTapas");
    render(<PreparadorRedes />);
    act(() => {
      window.dispatchEvent(new Event(EVENTO_PREPARAR_REDES));
    });
    expect(screen.queryByTestId("redes-preparador")).toBeNull();
  });
});
