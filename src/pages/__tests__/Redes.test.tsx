import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { esHuella, origenRrss, urlEmbebida } from "@/lib/redes";

// Redes (23/11/2026): abre rrss en un iframe aislado SIN pase en la dirección; solo cuando el
// propio iframe (y desde el origen de rrss) manda la huella de su secreto, el panel pide el pase
// al servidor y se lo entrega a él y a nadie más.

const h = vi.hoisted(() => ({
  pedidos: [] as unknown[],
  error: null as null | { context: Response },
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (_nombre: string, opciones: { body: unknown }) => {
        h.pedidos.push(opciones.body);
        return h.error ? { data: null, error: h.error } : { data: { pase: `pase.${h.pedidos.length}.firma` }, error: null };
      },
    },
  },
}));

const RRSS = "https://rrss.ejemplo.test";
const CNF = "b".repeat(43);

beforeEach(() => {
  h.pedidos = [];
  h.error = null;
  vi.stubEnv("VITE_RRSS_URL", RRSS);
});

/** El iframe de rrss «manda» un mensaje (en jsdom, simulando su ventana y su origen). */
function desdeIframe(iframe: HTMLIFrameElement, data: unknown, origin = RRSS) {
  const ventana = iframe.contentWindow!;
  const enviados: Array<{ data: unknown; origen: string }> = [];
  ventana.postMessage = ((d: unknown, o: string) => enviados.push({ data: d, origen: o })) as typeof ventana.postMessage;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: ventana }));
  });
  return enviados;
}

describe("Redes", () => {
  it("abre rrss sin nada en la dirección y sin dejarle mover el panel", async () => {
    const { default: Redes } = await import("../Redes");
    render(<Redes />);
    const iframe = (await screen.findByTestId("redes-iframe")) as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(`${RRSS}/embed`);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(h.pedidos).toEqual([]);
  });

  it("al pedirlo el iframe con su huella, pide el pase ligado a ella y se lo da solo a él", async () => {
    const { default: Redes } = await import("../Redes");
    render(<Redes />);
    const iframe = (await screen.findByTestId("redes-iframe")) as HTMLIFrameElement;
    const enviados = desdeIframe(iframe, { type: "rrss:hello", cnf: CNF });
    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(h.pedidos).toEqual([{ cnf: CNF }]);
    expect(enviados[0]).toEqual({ data: { type: "rrss:pass", pass: "pase.1.firma", cnf: CNF }, origen: RRSS });
  });

  it("no atiende mensajes de otro origen ni de otra ventana (B5), ni huellas mal formadas", async () => {
    const { default: Redes } = await import("../Redes");
    render(<Redes />);
    const iframe = (await screen.findByTestId("redes-iframe")) as HTMLIFrameElement;
    desdeIframe(iframe, { type: "rrss:hello", cnf: CNF }, "https://malo.test");
    desdeIframe(iframe, { type: "rrss:hello", cnf: "corta" });
    act(() => {
      // Otra ventana del mismo origen (otra pestaña de rrss): no es el iframe.
      window.dispatchEvent(new MessageEvent("message", { data: { type: "rrss:hello", cnf: CNF }, origin: RRSS, source: window }));
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.pedidos).toEqual([]);
  });

  it("si el servidor no da pase (sin permiso), se cierra rrss y se dice el motivo", async () => {
    h.error = { context: new Response(JSON.stringify({ error: "No tienes permiso para Redes." }), { status: 403 }) };
    const { default: Redes } = await import("../Redes");
    render(<Redes />);
    const iframe = (await screen.findByTestId("redes-iframe")) as HTMLIFrameElement;
    desdeIframe(iframe, { type: "rrss:hello", cnf: CNF });
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para Redes.");
    expect(screen.queryByTestId("redes-iframe")).toBeNull();
  });

  it("solo acepta una dirección https (o local) para rrss y huellas de 43 caracteres", () => {
    expect(origenRrss("https://rrss-omega.vercel.app/algo")).toBe("https://rrss-omega.vercel.app");
    expect(origenRrss("http://localhost:5173")).toBe("http://localhost:5173");
    expect(origenRrss("http://rrss.ejemplo.test")).toBeNull();
    expect(origenRrss("javascript:alert(1)")).toBeNull();
    expect(origenRrss("")).toBeNull();
    expect(urlEmbebida(RRSS)).toBe(`${RRSS}/embed`);
    expect(esHuella(CNF)).toBe(true);
    expect(esHuella("x")).toBe(false);
  });
});
