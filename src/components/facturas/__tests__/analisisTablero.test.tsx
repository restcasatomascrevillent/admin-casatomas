// Facturas › Análisis (rediseño del 05/11/2026): tablero de gráficas fijas que
// sale hecho al abrir la pestaña (una llamada a `tablero_compras`) y el
// copiloto de IA plegado en un panel lateral.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef, type ReactNode } from "react";

const doble = vi.hoisted(() => {
  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (!rpcs[fn]) return { data: null, error: { code: "PGRST202", message: `no function ${fn}` } };
    try {
      return { data: rpcs[fn](args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  });
  const invoke = vi.fn();
  const inserts: { tabla: string; fila: Record<string, unknown> }[] = [];
  const estado = { columnaAdjuntosFalta: false, mensajesBd: [] as unknown[] };
  const respuestaTabla = (tabla: string, llamadas: string[], fila?: Record<string, unknown>) => {
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
            const falla = tabla === "chat_facturas_mensajes" && llamadas.includes("insert") && estado.columnaAdjuntosFalta && !!fila && "adjuntos" in fila;
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
    rpc: (...a: unknown[]) => rpc(...(a as [string, Record<string, unknown>])),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  };
  return { supabase, rpc, rpcs, invoke, inserts, estado };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: doble.supabase }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChatFacturas, type ChatFacturasRef } from "../ChatFacturas";
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

const TABLERO = {
  periodo: { desde: "2026-01-01", hasta: "2026-12-31", hasta_efectivo: "2026-11-05", local: null, anterior: { desde: "2025-01-01", hasta: "2025-11-05" } },
  sin_datos: false,
  indicadores: {
    gasto: 1362491.57, gasto_anterior: 1200000, documentos_anterior: 1700, variacion_pct: 13.5, documentos: 1884, facturas: 1844,
    albaranes_sin_factura: 40, albaranes_sin_factura_importe: 14915.34, sin_total: 3, abonos: -14376.94, abonos_n: 43,
    regalado: 28204.41, regalado_valia: 107581.24, regalado_lineas: 861, regalado_estimadas: 69, regalado_estimado_importe: 6231.06, proveedores: 245,
  },
  meses: [
    { mes: "2026-06", casa_tomas: 140517.85, touza: 2882.85, total: 143400.7, documentos: 194 },
    { mes: "2026-07", casa_tomas: 160999.23, touza: 4408.77, total: 165408, documentos: 237 },
  ],
  proveedores: Array.from({ length: 7 }, (_, i) => ({ id: 300 + i, nombre: `PROVEEDOR ${i + 1}, S.L.`, gasto: 9000 - i * 1000, pct: 9 - i, documentos: 3 })),
  subidas: {
    tramo_inicio: { desde: "2026-01-12", hasta: "2026-04-11" },
    tramo_fin: { desde: "2026-07-09", hasta: "2026-10-06" },
    comparados: 216,
    productos: [
      { producto: "PAN DE CRISTAL", nombre_normalizado: "pan de cristal", unidad: "ud", proveedor_id: 276, proveedor: "Panaderia Garcia, S.L.",
        precio_inicio: 1.4, precio_fin: 2.0512, variacion_pct: 46.5, compras_inicio: 3, compras_fin: 3, importe: 2851.8 },
    ],
  },
  familias: { importe_total: 1200548.07, lineas: 12321, sin_clasificar: { lineas: 10396, importe: 1019048.6 }, familias: [{ id: 2, familia: "Pescado y marisco", importe: 81614.84, lineas: 459 }] },
  fijos: { ventana: { desde: "2026-01-01", hasta: "2026-11-05", meses_con_datos: 9 }, total_medio_mes: 4400,
    proveedores: [{ id: 398, nombre: "ACCIONA GREEN ENERGY DEVELOPMENTS, S.L.U.", medio_mes: 3611.03, meses: 9, meses_con_datos: 9, documentos: 11 }] },
  abonos: [{ id: 377, nombre: "DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.", importe: -5716.71, documentos: 5 }],
  locales: { casa_tomas: { gasto: 1333190.24, documentos: 1857 }, touza: { gasto: 29301.33, documentos: 27 }, meses: [] },
};

function montar(props: { onIrA?: (e: string) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ref = createRef<ChatFacturasRef>();
  const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const r = render(<ChatFacturas ref={ref} {...props} />, { wrapper: envoltorio });
  return { ...r, ref };
}

const tablero = () => screen.getByRole("region", { name: "Tablero de compras" });
const panel = () => screen.getByRole("dialog", { name: "Pregúntale a la IA" });
const llamadasTablero = () => doble.rpc.mock.calls.filter((c) => c[0] === "tablero_compras").map((c) => c[1]);

async function preguntar(texto: string) {
  fireEvent.change(within(panel()).getByLabelText("Pregunta para el asistente"), { target: { value: texto } });
  fireEvent.click(within(panel()).getByRole("button", { name: /enviar pregunta/i }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  for (const k of Object.keys(doble.rpcs)) delete doble.rpcs[k];
  doble.rpc.mockClear();
  doble.invoke.mockReset();
  doble.inserts.length = 0;
  doble.estado.columnaAdjuntosFalta = false;
  doble.estado.mensajesBd = [];
  toastMock.error.mockReset();
  doble.rpcs.tablero_compras = () => TABLERO;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 5, 12));
});

describe("tablero: sale hecho al abrir la pestaña", () => {
  it("una sola llamada a tablero_compras con el año en curso y todos los locales", async () => {
    montar();
    expect(await screen.findByText("1.362.491,57 €")).toBeInTheDocument();
    expect(llamadasTablero()).toEqual([{ p_desde: "2026-01-01", p_hasta: "2026-12-31", p_local: null }]);
    expect(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Año 2026" })).toHaveAttribute("aria-pressed", "true");
  });

  it("4 indicadores: gasto (con meses y variación), abonos, regalado, por revisar", async () => {
    montar();
    const ind = await screen.findByLabelText("Indicadores del periodo");
    expect(ind).toHaveTextContent(/Gasto con IVA1\.362\.491,57\s€jun – jul 2026\s?· \+13,5 % frente a 1 ene 2025 – 5 nov 2025/);
    expect(ind).toHaveTextContent(/Abonos−14\.376,94\s€43 documentos/);
    expect(ind).toHaveTextContent(/Regalado y descuentos28\.204,41\s€lo que valía 107\.581,24\s€ · 69 estimados/);
    expect(ind).toHaveTextContent(/Por revisar40albaranes sin factura/);
  });

  it("todas las tarjetas, con título y resumen para lectores de pantalla", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    for (const titulo of [
      "Gasto por mes", "Proveedores con más gasto", "Lo que más ha subido", "Precio de un producto",
      "Gasto por familia", "Gastos fijos al mes", "Abonos por proveedor", "Casa Tomás y Touza",
    ]) {
      expect(within(tablero()).getByRole("region", { name: titulo })).toBeInTheDocument();
    }
    expect(within(tablero()).getByRole("region", { name: "Gasto por mes" })).toHaveAccessibleDescription(/El más alto, Julio 2026 con 165\.408 €/);
    // Nada del copiloto de antes en la pantalla principal.
    expect(screen.queryByRole("button", { name: /al instante/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^nuevo$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /limpiar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /historial/i })).not.toBeInTheDocument();
  });

  it("cambiar periodo y local vuelve a pedir el tablero con esas fechas", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Mes" }));
    await waitFor(() => expect(llamadasTablero()).toContainEqual({ p_desde: "2026-11-01", p_hasta: "2026-11-30", p_local: null }));
    fireEvent.click(within(screen.getByRole("group", { name: "Local" })).getByRole("button", { name: "Touza" }));
    await waitFor(() => expect(llamadasTablero()).toContainEqual({ p_desde: "2026-11-01", p_hasta: "2026-11-30", p_local: "touza" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Todo" }));
    await waitFor(() => expect(llamadasTablero()).toContainEqual({ p_desde: null, p_hasta: null, p_local: "touza" }));
  });

  it("proveedores: 5 a la vista y «Ver los 7»", async () => {
    montar();
    const tarjeta = await screen.findByRole("region", { name: "Proveedores con más gasto" });
    const lista = within(tarjeta).getByRole("list", { name: "Proveedores por gasto" });
    expect(within(lista).getAllByRole("button")).toHaveLength(5);
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Ver los 7" }));
    expect(within(lista).getAllByRole("button")).toHaveLength(7);
  });

  it("familias: avisa de las líneas sin clasificar y «Clasificar con IA» lleva a Productos", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    const tarjeta = await screen.findByRole("region", { name: "Gasto por familia" });
    expect(tarjeta).toHaveTextContent(/10\.396 líneas sin clasificar/);
    fireEvent.click(within(tarjeta).getByRole("button", { name: /clasificar con ia/i }));
    expect(onIrA).toHaveBeenCalledWith("?tab=compras&modo=productos");
  });
});

describe("tablero: enlaces", () => {
  it("tocar un mes abre Compras con ese mes; un proveedor, Compras › Proveedores con él", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    const meses = await screen.findByRole("list", { name: "Meses" });
    fireEvent.click(within(meses).getByRole("button", { name: /^Julio 2026: 165\.408,00\s€ con IVA/ }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=documentos&mes=2026-07");
    fireEvent.click(screen.getByRole("button", { name: /^PROVEEDOR 1, S\.L\.: 9\.000,00\s€/ }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=proveedores&prov=300");
    fireEvent.click(within(screen.getByRole("region", { name: "Abonos por proveedor" })).getByRole("button", { name: /CATRAL/ }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=proveedores&prov=377");
  });

  it("tocar un producto que sube lo abre en «Precio de un producto»", async () => {
    doble.rpcs.serie_precios_agente = () => SERIE;
    montar();
    const subidas = await screen.findByRole("region", { name: "Lo que más ha subido" });
    expect(subidas).toHaveTextContent(/mismo proveedor, 12 ene – 11 abr vs 9 jul – 6 oct/);
    fireEvent.click(within(subidas).getByRole("button", { name: /^PAN DE CRISTAL/ }));
    const precio = screen.getByRole("region", { name: "Precio de un producto" });
    expect(await within(precio).findByText("PAN DE CRISTAL")).toBeInTheDocument();
    await waitFor(() =>
      expect(doble.rpc).toHaveBeenCalledWith("serie_precios_agente", { p_texto: "PAN DE CRISTAL", p_desde: null, p_hasta: null, p_unidad: null }),
    );
    expect(await within(precio).findByTestId("cifras-serie-precio")).toBeInTheDocument();
  });

  it("buscador de «Precio de un producto»: productos comprados con ese nombre", async () => {
    doble.rpcs.buscar_productos_texto_agente = () => [
      { producto: "GAMBA ROJA" }, { producto: "gamba roja" }, { producto: "GAMBA BLANCA" },
    ];
    doble.rpcs.serie_precios_agente = () => SERIE;
    montar();
    const precio = await screen.findByRole("region", { name: "Precio de un producto" });
    fireEvent.change(within(precio).getByLabelText("Buscar producto para ver su precio"), { target: { value: "gamba" } });
    const lista = await within(precio).findByRole("list", { name: "Productos comprados" });
    await waitFor(() => expect(within(lista).getAllByRole("button").map((b) => b.textContent)).toEqual(["GAMBA ROJA", "GAMBA BLANCA"]));
    fireEvent.click(within(lista).getByRole("button", { name: "GAMBA BLANCA" }));
    expect(await within(precio).findByText("GAMBA BLANCA")).toBeInTheDocument();
  });
});

describe("tablero: carga, vacío y error", () => {
  it("esqueleto mientras carga", async () => {
    let soltar: (v: unknown) => void = () => {};
    doble.rpc.mockImplementationOnce(() => new Promise((r) => (soltar = r)) as never);
    montar();
    expect(screen.getByRole("status", { name: "Cargando el tablero" })).toBeInTheDocument();
    await act(async () => soltar({ data: TABLERO, error: null }));
    expect(await screen.findByText("1.362.491,57 €")).toBeInTheDocument();
  });

  it("sin documentos en el periodo: lo dice y ofrece ver todo", async () => {
    doble.rpcs.tablero_compras = (a) => (a.p_desde ? { sin_datos: true } : TABLERO);
    montar();
    expect(await screen.findByText(/No hay documentos en año 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver todo el histórico" }));
    expect(await screen.findByText("1.362.491,57 €")).toBeInTheDocument();
  });

  it("error con «Reintentar»; si falta la migración, lo dice", async () => {
    let falla = true;
    doble.rpcs.tablero_compras = () => {
      if (falla) throw new Error("timeout");
      return TABLERO;
    };
    montar();
    // El hook reintenta una vez antes de enseñar el error.
    const alerta = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(alerta).toHaveTextContent(/No se ha podido cargar el tablero\. timeout/);
    falla = false;
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("1.362.491,57 €")).toBeInTheDocument();
  });

  it("la RPC aún no existe: pide aplicar la migración", async () => {
    delete doble.rpcs.tablero_compras;
    montar();
    expect(await screen.findByRole("alert")).toHaveTextContent(/falta aplicar la migración 20261105150500_tablero_compras/);
  });
});

describe("copiloto plegado", () => {
  it("«Pregúntale a la IA» abre el panel con sugerencias sacadas del tablero", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    const sugerencias = within(panel()).getByRole("list", { name: "Sugerencias para empezar" });
    expect(within(sugerencias).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "¿Por qué subió el gasto en julio?",
      "Compara el precio de pan de cristal entre proveedores",
      "¿Qué le he comprado a Proveedor 1 este año?",
      "¿Ha subido lo que pago a Acciona Green Energy Developments?",
      "Enséñame la gráfica del precio de…",
    ]);
    // El tablero sigue a la vista (panel no modal) y se cierra con «Cerrar».
    expect(tablero()).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("una sugerencia pregunta a la IA y la respuesta sale en el panel", async () => {
    doble.invoke.mockResolvedValue({ data: { respuesta: "En julio subió por Embajadores." }, error: null });
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    fireEvent.click(within(panel()).getByRole("button", { name: "¿Por qué subió el gasto en julio?" }));
    expect(await within(panel()).findByText("En julio subió por Embajadores.")).toBeInTheDocument();
    expect(doble.invoke).toHaveBeenCalledWith("chat-facturas", expect.objectContaining({ body: expect.objectContaining({ mensaje: "¿Por qué subió el gasto en julio?" }) }));
  });

  it("la gráfica de la IA sale dentro del panel y «Fijar en el tablero» la deja al final (y se recuerda)", async () => {
    doble.invoke.mockResolvedValue({
      data: { respuesta: "La merluza ha subido un 22,9 %.", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] },
      error: null,
    });
    const { unmount } = montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    await preguntar("¿Cómo va la merluza?");
    expect(await within(panel()).findByRole("figure", { name: "Evolución del precio de Merluza" })).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Fijar en el tablero" }));
    expect(within(panel()).getByRole("button", { name: /fijada en el tablero/i })).toHaveAttribute("aria-pressed", "true");
    const fijadas = within(tablero()).getByRole("group", { name: "Gráficas fijadas desde la IA" });
    expect(within(fijadas).getByRole("region", { name: "Evolución del precio · Merluza" })).toBeInTheDocument();
    unmount();

    montar();
    await screen.findByText("1.362.491,57 €");
    const otraVez = within(tablero()).getByRole("group", { name: "Gráficas fijadas desde la IA" });
    fireEvent.click(within(otraVez).getByRole("button", { name: "Quitar del tablero: Evolución del precio · Merluza" }));
    expect(within(tablero()).queryByRole("group", { name: "Gráficas fijadas desde la IA" })).not.toBeInTheDocument();
  });

  it("el historial vive dentro del panel", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    fireEvent.click(within(panel()).getByRole("button", { name: /historial/i }));
    const historial = screen.getByRole("dialog", { name: "Historial" });
    expect(within(historial).getByRole("button", { name: /nueva/i })).toBeInTheDocument();
    fireEvent.click(within(historial).getByRole("button", { name: "Volver a la conversación" }));
    expect(panel()).toBeInTheDocument();
  });

  it("enviarConsulta (el «Preguntar a la IA» de Compras) abre el panel y pregunta", async () => {
    doble.invoke.mockResolvedValue({ data: { respuesta: "Es la factura de Catral." }, error: null });
    const { ref } = montar();
    await screen.findByText("1.362.491,57 €");
    act(() => ref.current?.enviarConsulta("Hola, quiero hacerte una consulta sobre la factura número F-1."));
    expect(await within(panel()).findByText("Es la factura de Catral.")).toBeInTheDocument();
  });
});

describe("adjuntos del chatbot (se guardan con el mensaje)", () => {
  async function conRespuesta(datos: Record<string, unknown>) {
    doble.invoke.mockResolvedValue({ data: datos, error: null });
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    await preguntar("¿Cómo ha evolucionado la merluza?");
    await within(panel()).findByText("Aquí tienes la evolución.");
  }

  it("la gráfica se guarda con la respuesta; el mensaje del usuario no lleva la clave", async () => {
    await conRespuesta({ respuesta: "Aquí tienes la evolución.", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] });
    const guardado = doble.inserts.find((i) => i.fila.rol === "assistant");
    expect(guardado?.fila.adjuntos).toEqual([{ tipo: "serie_precio", datos: expect.objectContaining({ producto: "Merluza" }) }]);
    expect(doble.inserts.find((i) => i.fila.rol === "user")?.fila).not.toHaveProperty("adjuntos");
  });

  it("si la columna adjuntos no existe, reintenta sin adjuntos y no avisa de fallo", async () => {
    doble.estado.columnaAdjuntosFalta = true;
    await conRespuesta({ respuesta: "Aquí tienes la evolución.", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] });
    await waitFor(() => expect(doble.inserts.filter((i) => i.fila.rol === "assistant")).toHaveLength(2));
    const delAsistente = doble.inserts.filter((i) => i.fila.rol === "assistant");
    expect(delAsistente[0].fila).toHaveProperty("adjuntos");
    expect(delAsistente[1].fila).not.toHaveProperty("adjuntos");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("al recargar la conversación, los adjuntos salen de la BD", async () => {
    doble.estado.mensajesBd = [
      { id: "m1", conversacion_id: "c1", rol: "user", contenido: "merluza", created_at: "2026-10-08T10:00:00Z", adjuntos: null },
      { id: "m2", conversacion_id: "c1", rol: "assistant", contenido: "Aquí tienes la evolución.", created_at: "2026-10-08T10:00:05Z", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] },
    ];
    const { result } = renderHook(() => useChatFacturas());
    await act(async () => {
      await result.current.seleccionarConversacion({ id: "c1", session_id: "s1", titulo: "t", created_at: "", updated_at: "" });
    });
    expect(result.current.mensajes[0].adjuntos).toEqual([]);
    expect(result.current.mensajes[1].adjuntos?.[0].tipo).toBe("serie_precio");
  });
});
