// Pestaña «Análisis» (copiloto centrado en gráficas): las gráficas van al
// tablero como tarjetas fijas, tocar una la selecciona y la siguiente pregunta
// lleva su contexto; los chips preguntan sobre esa tarjeta; se pueden quitar.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const doble = vi.hoisted(() => {
  const rpc = vi.fn();
  const invoke = vi.fn();
  const inserts: { tabla: string; fila: Record<string, unknown> }[] = [];
  const respuestaTabla = (tabla: string, llamadas: string[], fila?: Record<string, unknown>) => {
    if (tabla === "chat_facturas_conversaciones" && llamadas.includes("insert"))
      return { id: "c1", session_id: "s1", titulo: "Nueva conversación", created_at: "", updated_at: "" };
    if (tabla === "chat_facturas_mensajes" && llamadas.includes("insert"))
      return { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...fila };
    return [];
  };
  const cadena = (tabla: string, llamadas: string[] = [], fila?: Record<string, unknown>): unknown =>
    new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            const res = { data: respuestaTabla(tabla, llamadas, fila), error: null };
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko);
          }
          return (...args: unknown[]) => {
            let f = fila;
            if (prop === "insert") {
              f = args[0] as Record<string, unknown>;
              inserts.push({ tabla, fila: f });
            }
            return cadena(tabla, [...llamadas, prop], f);
          };
        },
      },
    );
  const supabase = {
    from: (t: string) => cadena(t),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  };
  return { supabase, rpc, invoke, inserts };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: doble.supabase }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

import { ChatFacturas } from "../ChatFacturas";
import { useTableroGraficas } from "@/hooks/useTableroGraficas";

const SERIE = {
  producto: "Merluza",
  unidad: "kg",
  proveedores: ["Flope", "Pescados Paco"],
  puntos: [
    ["2026-08-01", 10.5, 0],
    ["2026-10-02", 12.9, 1],
  ],
  n: 2,
  min: 10.5,
  max: 12.9,
  ultimo: 12.9,
  variacion_pct: 22.9,
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ChatFacturas />, { wrapper: envoltorio });
}

const copiloto = () => screen.getByRole("complementary", { name: /copiloto/i });
const tablero = () => screen.getByRole("region", { name: /tablero de gráficas/i });

async function preguntar(texto: string) {
  fireEvent.change(screen.getByLabelText("Pregunta para el asistente"), { target: { value: texto } });
  fireEvent.click(screen.getByRole("button", { name: /enviar pregunta/i }));
}

/** Pide una gráfica a la IA y espera su tarjeta. */
async function conGraficaDeLaIa() {
  doble.invoke.mockResolvedValueOnce({
    data: {
      respuesta: "La merluza ha subido un 22,9 % desde agosto. Te dejo la gráfica debajo.",
      adjuntos: [{ tipo: "serie_precio", datos: SERIE }],
    },
    error: null,
  });
  montar();
  await preguntar("¿Cómo ha ido la merluza?");
  return screen.findByRole("region", { name: /evolución del precio · merluza/i });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  doble.rpc.mockReset();
  doble.invoke.mockReset();
  doble.inserts.length = 0;
});

describe("tablero vacío y copiloto", () => {
  it("el tablero explica qué hará y ofrece gráficas al instante; el copiloto, sugerencias", () => {
    montar();
    expect(within(tablero()).getByText(/aquí se quedan tus gráficas/i)).toBeInTheDocument();
    const atajos = within(tablero()).getByRole("list", { name: /gráficas al instante/i });
    expect(within(atajos).getByRole("button", { name: /gasto por mes/i })).toBeInTheDocument();
    expect(within(copiloto()).getByRole("list", { name: /sugerencias/i })).toBeInTheDocument();
  });

  it("la sugerencia de gráfica solo rellena la caja (falta el producto)", () => {
    montar();
    fireEvent.click(within(copiloto()).getByRole("button", { name: /gráfica del precio de/i }));
    expect(screen.getByLabelText("Pregunta para el asistente")).toHaveValue("Enséñame la gráfica del precio de ");
    expect(doble.invoke).not.toHaveBeenCalled();
  });

  it("un atajo del estado vacío crea la tarjeta al instante, sin IA", async () => {
    doble.rpc.mockResolvedValue({ data: { error: "rango invalido" }, error: null });
    montar();
    fireEvent.click(within(tablero()).getByRole("button", { name: /top proveedores/i }));
    const tarjeta = await screen.findByRole("region", { name: /top proveedores/i });
    expect(await within(tarjeta).findByRole("alert")).toHaveTextContent(/rango invalido/i);
    expect(doble.invoke).not.toHaveBeenCalled();
  });
});

describe("gráficas de la IA en el tablero", () => {
  it("la gráfica va al tablero con 1-2 frases de explicación y chips; el texto al copiloto", async () => {
    const tarjeta = await conGraficaDeLaIa();
    expect(within(tarjeta).getByTestId("grafico-serie-precio")).toBeInTheDocument();
    expect(within(tarjeta).getByText("La merluza ha subido un 22,9 % desde agosto.")).toBeInTheDocument();
    const chips = within(tarjeta).getByRole("group", { name: /pregúntale más/i });
    expect(within(chips).getByRole("button", { name: /por qué subió/i })).toBeInTheDocument();
    expect(within(copiloto()).getByText(/te dejo la gráfica debajo/i)).toBeInTheDocument();
    expect(within(copiloto()).getByRole("button", { name: /ver gráfica/i })).toBeInTheDocument();
  });

  it("tocar la tarjeta la selecciona y la siguiente pregunta lleva su contexto", async () => {
    const tarjeta = await conGraficaDeLaIa();
    fireEvent.click(within(tarjeta).getByText("La merluza ha subido un 22,9 % desde agosto."));
    expect(tarjeta).toHaveAttribute("aria-current", "true");
    expect(within(tarjeta).getByRole("button", { name: /seleccionada/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(copiloto()).getByText(/sobre:/i)).toHaveTextContent("Evolución del precio · Merluza");

    doble.invoke.mockResolvedValueOnce({ data: { respuesta: "Subió en octubre con Pescados Paco." }, error: null });
    await preguntar("¿Y en septiembre?");
    await within(copiloto()).findByText("Subió en octubre con Pescados Paco.");

    const mensaje = doble.invoke.mock.calls[1][1].body.mensaje as string;
    expect(mensaje).toMatch(/^¿Y en septiembre\?\n\n\[Sobre la gráfica seleccionada: /);
    expect(mensaje).toContain("«Merluza» (unidad kg)");
    // En el copiloto se ve la pregunta limpia con una etiqueta «sobre …».
    expect(within(copiloto()).getByText("¿Y en septiembre?")).toBeInTheDocument();
    expect(within(copiloto()).getByText(/sobre precio de merluza/i)).toBeInTheDocument();
  });

  it("los chips preguntan sobre su tarjeta (y la dejan seleccionada)", async () => {
    const tarjeta = await conGraficaDeLaIa();
    doble.invoke.mockResolvedValueOnce({ data: { respuesta: "Ok." }, error: null });
    fireEvent.click(within(tarjeta).getByRole("button", { name: /solo los últimos 3 meses/i }));
    await within(copiloto()).findByText("Ok.");
    const mensaje = doble.invoke.mock.calls[1][1].body.mensaje as string;
    expect(mensaje).toMatch(/^Enséñame la gráfica del precio de «Merluza» solo de los últimos 3 meses\./);
    expect(mensaje).toContain("[Sobre la gráfica seleccionada: ");
    expect(tarjeta).toHaveAttribute("aria-current", "true");
  });

  it("sin selección la pregunta va limpia; quitar la selección desde el copiloto", async () => {
    const tarjeta = await conGraficaDeLaIa();
    fireEvent.click(within(tarjeta).getByRole("button", { name: /^seleccionar/i }));
    fireEvent.click(within(copiloto()).getByRole("button", { name: /dejar de preguntar sobre esta gráfica/i }));
    expect(tarjeta).not.toHaveAttribute("aria-current");
    doble.invoke.mockResolvedValueOnce({ data: { respuesta: "Ok." }, error: null });
    await preguntar("¿Y el IVA?");
    await within(copiloto()).findByText("Ok.");
    expect(doble.invoke.mock.calls[1][1].body.mensaje).toBe("¿Y el IVA?");
  });

  it("quitar una gráfica de la IA la oculta y lo recuerda en este navegador", async () => {
    const tarjeta = await conGraficaDeLaIa();
    fireEvent.click(within(tarjeta).getByRole("button", { name: /quitar esta tarjeta/i }));
    expect(screen.queryByRole("region", { name: /evolución del precio · merluza/i })).not.toBeInTheDocument();
    expect(within(copiloto()).queryByRole("button", { name: /ver gráfica/i })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("facturas-tablero-ocultas:c1") ?? "[]")).toHaveLength(1);
    // El texto de la respuesta sigue en el copiloto.
    expect(within(copiloto()).getByText(/la merluza ha subido/i)).toBeInTheDocument();
  });

  it("«Limpiar» vacía el tablero", async () => {
    await conGraficaDeLaIa();
    fireEvent.click(screen.getByRole("button", { name: /quitar todas las gráficas del tablero/i }));
    expect(within(tablero()).getByText(/aquí se quedan tus gráficas/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /quitar todas las gráficas del tablero/i })).toBeDisabled();
  });
});

describe("useTableroGraficas", () => {
  it("las quitadas van por conversación y la selección se suelta al quitar la seleccionada", () => {
    const { result, rerender } = renderHook(({ conv }) => useTableroGraficas(conv), {
      initialProps: { conv: "c1" as string | null },
    });
    act(() => result.current.alternarSeleccion("a"));
    expect(result.current.seleccionadaId).toBe("a");
    act(() => result.current.ocultar(["a", "b"]));
    expect(result.current.seleccionadaId).toBeNull();
    expect([...result.current.ocultas]).toEqual(["a", "b"]);

    rerender({ conv: "c2" });
    expect(result.current.ocultas.size).toBe(0);
    rerender({ conv: "c1" });
    expect([...result.current.ocultas]).toEqual(["a", "b"]);
  });

  it("cambiar de conversación (null → id al crearla) no suelta la selección", () => {
    const { result, rerender } = renderHook(({ conv }) => useTableroGraficas(conv), {
      initialProps: { conv: null as string | null },
    });
    act(() => result.current.alternarSeleccion("r1"));
    rerender({ conv: "c1" });
    expect(result.current.seleccionadaId).toBe("r1");
    act(() => result.current.alternarSeleccion("r1"));
    expect(result.current.seleccionadaId).toBeNull();
  });

  it("localStorage roto o con basura no rompe el tablero", async () => {
    window.localStorage.setItem("facturas-tablero-ocultas:c9", "{no es json");
    const { result } = renderHook(() => useTableroGraficas("c9"));
    await waitFor(() => expect(result.current.ocultas.size).toBe(0));
  });
});
