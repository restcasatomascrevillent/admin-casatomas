// «Evolución de precio»: pregunta rápida (selector de producto → RPC
// serie_precios_agente → gráfica) y adjuntos del chatbot (se pintan bajo la
// burbuja, se guardan con el mensaje y se leen de BD al recargar).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const doble = vi.hoisted(() => {
  const rpc = vi.fn();
  const invoke = vi.fn();
  const inserts: { tabla: string; fila: Record<string, unknown> }[] = [];
  const estado = {
    /** Hace fallar los INSERT de mensajes que lleven `adjuntos` (columna sin crear). */
    columnaAdjuntosFalta: false,
    mensajesBd: [] as unknown[],
  };
  const respuestaTabla = (tabla: string, llamadas: string[], fila?: Record<string, unknown>) => {
    if (tabla === "productos_catalogo")
      return [
        { id: 1, nombre: "Merluza", unidad_habitual: "kg" },
        { id: 2, nombre: "Limón fino", unidad_habitual: "kg" },
      ];
    if (tabla === "chat_facturas_conversaciones" && llamadas.includes("insert"))
      return { id: "c1", session_id: "s1", titulo: "Nueva conversación", created_at: "", updated_at: "" };
    if (tabla === "chat_facturas_mensajes" && llamadas.includes("insert"))
      return { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...fila };
    if (tabla === "chat_facturas_mensajes") return estado.mensajesBd;
    return [];
  };
  const cadena = (tabla: string, llamadas: string[] = [], fila?: Record<string, unknown>): unknown =>
    new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            const falla =
              tabla === "chat_facturas_mensajes" &&
              llamadas.includes("insert") &&
              estado.columnaAdjuntosFalta &&
              !!fila &&
              "adjuntos" in fila;
            const res = falla
              ? { data: null, error: { code: "PGRST204", message: "Could not find the adjuntos column" } }
              : { data: respuestaTabla(tabla, llamadas, fila), error: null };
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
  return { supabase, rpc, invoke, inserts, estado };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: doble.supabase }));
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChatFacturas } from "../ChatFacturas";
import { useChatFacturas } from "@/hooks/useChatFacturas";

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
  qc.setQueryData(["facturas"], []);
  qc.setQueryData(["albaranes"], []);
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ChatFacturas />, { wrapper: envoltorio });
}

// «Al instante ▾» está plegado: se despliega la primera vez (y tras lanzar una pregunta se vuelve a plegar).
const barra = () => {
  if (!screen.queryByRole("group", { name: /al instante, sin ia/i })) {
    fireEvent.click(screen.getByRole("button", { name: /^al instante/i }));
  }
  return screen.getByRole("group", { name: /al instante, sin ia/i });
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  doble.rpc.mockReset();
  doble.invoke.mockReset();
  doble.inserts.length = 0;
  doble.estado.columnaAdjuntosFalta = false;
  doble.estado.mensajesBd = [];
  toastMock.error.mockReset();
});

describe("pregunta rápida «Evolución de precio»", () => {
  async function elegirMerluza(unidad?: string) {
    fireEvent.click(within(barra()).getByRole("button", { name: /evolución de precio/i }));
    fireEvent.click(await screen.findByRole("button", { name: /merluza/i }));
    if (unidad) fireEvent.change(screen.getByLabelText(/unidad/i), { target: { value: unidad } });
    fireEvent.click(screen.getByRole("button", { name: /ver evolución/i }));
  }

  it("busca en el catálogo, llama a serie_precios_agente y pinta la gráfica", async () => {
    doble.rpc.mockResolvedValue({ data: SERIE, error: null });
    montar();
    await elegirMerluza("kg");
    await screen.findByText(/evolución del precio · merluza/i);
    expect(doble.rpc).toHaveBeenCalledTimes(1);
    expect(doble.rpc).toHaveBeenCalledWith("serie_precios_agente", {
      p_texto: "Merluza",
      p_desde: null,
      p_hasta: null,
      p_unidad: "kg",
    });
    expect(screen.getByText("+22,9 %")).toBeInTheDocument();
    // Sin IA: ni invoca la Edge Function ni escribe en el historial.
    expect(doble.invoke).not.toHaveBeenCalled();
    expect(doble.inserts).toHaveLength(0);
  });

  it("el buscador filtra el catálogo y «Ver evolución» pide elegir antes", async () => {
    montar();
    fireEvent.click(within(barra()).getByRole("button", { name: /evolución de precio/i }));
    await screen.findByRole("button", { name: /merluza/i });
    expect(screen.getByRole("button", { name: /ver evolución/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "limon" } });
    expect(screen.queryByRole("button", { name: /merluza/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /limón fino/i })).toBeInTheDocument();
  });

  it("producto sin compras: mensaje de la RPC {sin_datos}", async () => {
    doble.rpc.mockResolvedValue({ data: { sin_datos: true, buscado: "Merluza" }, error: null });
    montar();
    await elegirMerluza();
    await screen.findByText(/no hay compras registradas de «merluza»/i);
  });

  it("la RPC aún no existe: «pendiente de actualizar la base de datos» y el botón se apaga", async () => {
    doble.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    montar();
    await elegirMerluza();
    await screen.findByText(/pendiente de actualizar la base de datos/i, { selector: "p" });
    await waitFor(() => expect(within(barra()).getByRole("button", { name: /evolución de precio/i })).toBeDisabled());
  });
});

describe("adjuntos del chatbot", () => {
  async function preguntar() {
    montar();
    const caja = screen.getByLabelText("Pregunta para el asistente");
    fireEvent.change(caja, { target: { value: "¿Cómo ha evolucionado la merluza?" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar pregunta/i }));
    await screen.findByText("Aquí tienes la evolución.");
  }

  it("pinta la gráfica bajo la burbuja y la guarda con el mensaje", async () => {
    doble.invoke.mockResolvedValue({
      data: { respuesta: "Aquí tienes la evolución.", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] },
      error: null,
    });
    await preguntar();
    await screen.findByText(/evolución del precio · merluza/i);
    const guardado = doble.inserts.find((i) => i.fila.rol === "assistant");
    expect(guardado?.fila.adjuntos).toEqual([
      { tipo: "serie_precio", datos: expect.objectContaining({ producto: "Merluza" }) },
    ]);
    // El mensaje del usuario no lleva la clave.
    expect(doble.inserts.find((i) => i.fila.rol === "user")?.fila).not.toHaveProperty("adjuntos");
  });

  it("si la columna adjuntos no existe, reintenta sin adjuntos y no avisa de fallo", async () => {
    doble.estado.columnaAdjuntosFalta = true;
    doble.invoke.mockResolvedValue({
      data: { respuesta: "Aquí tienes la evolución.", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] },
      error: null,
    });
    await preguntar();
    await screen.findByText(/evolución del precio · merluza/i);
    const delAsistente = doble.inserts.filter((i) => i.fila.rol === "assistant");
    expect(delAsistente).toHaveLength(2);
    expect(delAsistente[0].fila).toHaveProperty("adjuntos");
    expect(delAsistente[1].fila).not.toHaveProperty("adjuntos");
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.queryByText(/sin guardar/i)).not.toBeInTheDocument();
  });

  it("respuesta sin adjuntos: no pinta nada ni manda la columna", async () => {
    doble.invoke.mockResolvedValue({ data: { respuesta: "Aquí tienes la evolución." }, error: null });
    await preguntar();
    expect(screen.queryByTestId("grafico-serie-precio")).not.toBeInTheDocument();
    expect(doble.inserts.find((i) => i.fila.rol === "assistant")?.fila).not.toHaveProperty("adjuntos");
  });

  it("al recargar la conversación, los adjuntos salen de la BD", async () => {
    doble.estado.mensajesBd = [
      { id: "m1", conversacion_id: "c1", rol: "user", contenido: "merluza", created_at: "2026-10-08T10:00:00Z", adjuntos: null },
      {
        id: "m2",
        conversacion_id: "c1",
        rol: "assistant",
        contenido: "Aquí tienes la evolución.",
        created_at: "2026-10-08T10:00:05Z",
        adjuntos: [{ tipo: "serie_precio", datos: SERIE }],
      },
    ];
    const { result } = renderHook(() => useChatFacturas());
    await act(async () => {
      await result.current.seleccionarConversacion({ id: "c1", session_id: "s1", titulo: "t", created_at: "", updated_at: "" });
    });
    expect(result.current.mensajes[0].adjuntos).toEqual([]);
    expect(result.current.mensajes[1].adjuntos).toHaveLength(1);
    expect(result.current.mensajes[1].adjuntos?.[0].tipo).toBe("serie_precio");
  });
});
