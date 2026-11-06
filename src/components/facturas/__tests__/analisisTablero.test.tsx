// Facturas › Análisis (rediseño del 05/11/2026): tablero de gráficas fijas que
// sale hecho al abrir la pestaña (una llamada a `tablero_compras`) y el
// copiloto de IA plegado en un panel lateral.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef, type ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

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

const ubicacion = { actual: "", navegar: null as NavigateFunction | null };
function Ubicacion() {
  const l = useLocation();
  ubicacion.actual = l.search;
  ubicacion.navegar = useNavigate();
  return null;
}

/** explorar_compras de prueba: devuelve los meses de TABLERO (o 3 proveedores) con lo que se pidió. */
const explorar = (a: Record<string, unknown>) => {
  const tiempo = ["dia", "semana", "mes", "trimestre"].includes(String(a.p_agrupar));
  return {
    parametros: { desde: a.p_desde, hasta: a.p_hasta, hasta_efectivo: "2026-11-05", medida: a.p_medida, agrupar: a.p_agrupar, desglose: a.p_desglose, por_lineas: false, solo_productos: false, unidad: null },
    sin_datos: false,
    total: { valor: 308808.7, documentos: 431, lineas: null, variacion_pct: null },
    anterior: null,
    unidades: null,
    series: a.p_desglose === "local" ? [{ clave: "casa_tomas", etiqueta: "Casa Tomás", id: null, valor: 301517.08 }, { clave: "touza", etiqueta: "Touza", id: null, valor: 7291.62 }] : [],
    puntos: tiempo
      ? TABLERO.meses.map((m) => ({ clave: m.mes, etiqueta: m.mes, id: null, valor: m.total, documentos: m.documentos, desglose: a.p_desglose === "local" ? { casa_tomas: m.casa_tomas, touza: m.touza } : null }))
      : [300, 301, 302].map((id, i) => ({ clave: String(id), etiqueta: `PROVEEDOR ${i + 1}, S.L.`, id, valor: 9000 - i * 1000, documentos: 3, desglose: null })),
    resto: tiempo ? null : { entidades: 4, valor: 18000, documentos: 12 },
  };
};
const DOCUMENTOS = {
  cifra: 1362491.57,
  documentos: 2,
  importe_total: 1362491.57,
  desplazamiento: 0,
  filas: [
    { id: 11, fecha: "2026-07-03", proveedor: "EMBAJADORES MADRID", proveedor_id: 298, numero_documento: "F-77", tipo: "factura", local: "casa_tomas", total: 1000, importe_aportado: 1000, drive_url: "https://drive.google.com/file/d/1EhhlvBMUAhvrgKYiviZjBEpC6uqFC4Tr/view?usp=drivesdk", archivo_path: null },
    { id: 12, fecha: "2026-06-20", proveedor: "TOUZA PROVEEDOR SL", proveedor_id: 400, numero_documento: "A-5", tipo: "abono", local: "touza", total: -50, importe_aportado: -50, drive_url: null, archivo_path: null },
  ],
};
const llamadas = (fn: string) => doble.rpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1]);

function montar(props: { onIrA?: (e: string) => void; activa?: boolean } = {}, url = "/facturas?tab=chat") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ref = createRef<ChatFacturasRef>();
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Ubicacion />
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
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
  doble.rpcs.explorar_compras = explorar;
  doble.rpcs.documentos_de_cifra = () => DOCUMENTOS;
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
      "Explorar", "Proveedores con más gasto", "Lo que más ha subido",
      "Gasto por familia", "Gastos fijos al mes", "Abonos por proveedor", "Casa Tomás y Touza",
    ]) {
      expect(within(tablero()).getByRole("region", { name: titulo })).toBeInTheDocument();
    }
    expect(within(tablero()).getByRole("region", { name: "Proveedores con más gasto" })).toHaveAccessibleDescription(/Los que más: Proveedor 1 9\.000 €/);
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

describe("tablero: menús de las filas", () => {
  it("un proveedor ofrece ver sus documentos, abrirlo en Compras o llevarlo al explorador", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /^PROVEEDOR 1, S\.L\.: 9\.000,00\s€/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=proveedores&prov=300");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("region", { name: "Abonos por proveedor" })).getByRole("button", { name: /CATRAL/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=proveedores&prov=377");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^PROVEEDOR 2, S\.L\./ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver su gasto por mes" }));
    await waitFor(() =>
      expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_medida: "gasto", p_agrupar: "mes", p_filtros: { proveedores: [301] } })),
    );
  });

  it("un producto que sube se abre en el explorador con su precio por proveedor", async () => {
    montar();
    const subidas = await screen.findByRole("region", { name: "Lo que más ha subido" });
    expect(subidas).toHaveTextContent(/mismo proveedor, 12 ene – 11 abr vs 9 jul – 6 oct/);
    fireEvent.click(within(subidas).getByRole("button", { name: /^PAN DE CRISTAL/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver su precio en el explorador" }));
    await waitFor(() =>
      expect(llamadas("explorar_compras")).toContainEqual(
        expect.objectContaining({ p_medida: "precio", p_agrupar: "mes", p_desglose: "proveedor", p_filtros: { productos: ["PAN DE CRISTAL"], unidad: "ud" } }),
      ),
    );
  });
});

describe("explorador", () => {
  it("sale con el gasto por mes y local y cambia al instante al tocar la estantería", async () => {
    montar();
    const ex = await screen.findByRole("region", { name: "Explorar" });
    await waitFor(() =>
      expect(llamadas("explorar_compras")).toContainEqual({
        p_desde: "2026-01-01", p_hasta: "2026-12-31", p_medida: "gasto", p_agrupar: "mes", p_desglose: "local", p_filtros: {}, p_top: 10,
      }),
    );
    expect(await within(ex).findByText("308.808,70 €")).toBeInTheDocument();
    // Tabla accesible: una fila por mes y una columna por local.
    fireEvent.click(within(ex).getByRole("button", { name: /ver como tabla/i }));
    const tabla = within(ex).getByRole("table");
    expect(within(tabla).getByRole("columnheader", { name: /Touza/ })).toBeInTheDocument();
    expect(within(tabla).getByRole("button", { name: "Julio 2026" })).toBeInTheDocument();
    // Preset «Top proveedores».
    fireEvent.click(within(ex).getByRole("button", { name: "Top proveedores" }));
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_agrupar: "proveedor", p_desglose: null })));
    expect(await within(ex).findByText(/Y 4 más fuera de la gráfica/)).toBeInTheDocument();
  });

  it("tocar un mes: ver solo ese tramo (cambia el periodo de todo el tablero y la URL) o ver sus documentos", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    const ex = await screen.findByRole("region", { name: "Explorar" });
    fireEvent.click(await within(ex).findByRole("button", { name: /ver como tabla/i }));
    fireEvent.click(await within(ex).findByRole("button", { name: "Julio 2026" }));
    const punto = within(ex).getByRole("region", { name: "Punto elegido" });
    fireEvent.click(within(punto).getByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=documentos&mes=2026-07");
    fireEvent.click(within(punto).getByRole("button", { name: "Ver documentos" }));
    await waitFor(() =>
      expect(llamadas("documentos_de_cifra")).toContainEqual(expect.objectContaining({ p_medida: "gasto", p_agrupar: "mes", p_clave: "2026-07", p_desglose: "local" })),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("documentos-de-cifra")).not.toBeInTheDocument());
    // Sigue elegido tras cerrar los documentos.
    fireEvent.click(within(within(ex).getByRole("region", { name: "Punto elegido" })).getByRole("button", { name: "Ver solo este tramo" }));
    await waitFor(() => expect(llamadasTablero()).toContainEqual({ p_desde: "2026-07-01", p_hasta: "2026-07-31", p_local: null }));
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_agrupar: "dia", p_desde: "2026-07-01" })));
    await waitFor(() => expect(ubicacion.actual).toBe("?tab=chat&desde=2026-07-01&hasta=2026-07-31"));
  });

  it("«Fijar en el tablero» guarda la configuración y se recuerda", async () => {
    const { unmount } = montar();
    const ex = await screen.findByRole("region", { name: "Explorar" });
    fireEvent.click(within(ex).getByRole("button", { name: "Fijar en el tablero" }));
    expect(within(ex).getByRole("button", { name: "Fijada" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(window.localStorage.getItem("facturas-analisis-explorador-fijadas") ?? "[]")[0].config).toMatchObject({ medida: "gasto", agrupar: "mes", desglose: "local" });
    unmount();
    montar();
    const fijadas = await screen.findByRole("group", { name: "Gráficas fijadas" });
    expect(within(fijadas).getByRole("region", { name: "Gasto con IVA por mes, por local" })).toBeInTheDocument();
  });
});

describe("periodo personalizado y URL", () => {
  it("un atajo cambia todo el tablero y queda en la URL", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByTestId("periodo-personalizado"));
    fireEvent.click(await screen.findByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(llamadasTablero()).toContainEqual({ p_desde: "2026-10-01", p_hasta: "2026-10-31", p_local: null }));
    await waitFor(() => expect(ubicacion.actual).toBe("?tab=chat&desde=2026-10-01&hasta=2026-10-31"));
    expect(screen.getByTestId("periodo-personalizado")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("periodo-personalizado")).toHaveTextContent("1 – 31 oct 2026");
  });

  it("abrir un enlace con fechas y local los aplica", async () => {
    montar({}, "/facturas?tab=chat&desde=2026-03-01&hasta=2026-04-15&local=touza");
    await waitFor(() => expect(llamadasTablero()[0]).toEqual({ p_desde: "2026-03-01", p_hasta: "2026-04-15", p_local: "touza" }));
    expect(within(screen.getByRole("group", { name: "Local" })).getByRole("button", { name: "Touza" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ver documentos de una cifra", () => {
  it("un indicador abre la lista de documentos (que cuadra) y un documento abre el visor con su PDF", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Gasto con IVA/ }));
    const hoja = await screen.findByTestId("documentos-de-cifra");
    await waitFor(() =>
      expect(llamadas("documentos_de_cifra")).toContainEqual(
        expect.objectContaining({ p_desde: "2026-01-01", p_hasta: "2026-12-31", p_medida: "gasto", p_clave: null, p_filtros: {}, p_limite: 50, p_desplazamiento: 0 }),
      ),
    );
    expect(await within(hoja).findByText("Cuadra con la cifra tocada")).toBeInTheDocument();
    const lista = within(hoja).getByRole("list", { name: "Documentos de la cifra" });
    expect(within(lista).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(lista).getByRole("button", { name: /^Factura F-77 de EMBAJADORES MADRID/ }));
    const visor = await screen.findByTestId("visor-documento");
    expect(within(visor).getByTitle(/^Original: Factura F-77/)).toHaveAttribute("src", "https://drive.google.com/file/d/1EhhlvBMUAhvrgKYiviZjBEpC6uqFC4Tr/preview");
    const drive = within(visor).getByRole("link", { name: /Abrir en Drive/ });
    expect(drive).toHaveAttribute("target", "_blank");
    expect(drive).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(visor).getByText("1 de 2")).toBeInTheDocument();
    fireEvent.click(within(visor).getByRole("button", { name: "Documento siguiente" }));
    expect(within(visor).getByText("2 de 2")).toBeInTheDocument();
    expect(within(visor).getByText(/No se guardó el original/)).toBeInTheDocument();
    fireEvent.click(within(visor).getByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=documentos&doc=12");
  });

  it("«Por revisar» pide solo los albaranes sin factura", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Por revisar/ }));
    await waitFor(() =>
      expect(llamadas("documentos_de_cifra")).toContainEqual(expect.objectContaining({ p_medida: "gasto", p_filtros: { tipos: ["albaran"] } })),
    );
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
    expect(await screen.findByText(/No hay documentos en este año/)).toBeInTheDocument();
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
    const fijadas = within(tablero()).getByRole("group", { name: "Gráficas fijadas" });
    expect(within(fijadas).getByRole("region", { name: "Evolución del precio · Merluza" })).toBeInTheDocument();
    unmount();

    montar();
    await screen.findByText("1.362.491,57 €");
    const otraVez = within(tablero()).getByRole("group", { name: "Gráficas fijadas" });
    fireEvent.click(within(otraVez).getByRole("button", { name: "Quitar del tablero: Evolución del precio · Merluza" }));
    expect(within(tablero()).queryByRole("group", { name: "Gráficas fijadas" })).not.toBeInTheDocument();
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

// ─── Arreglos de la QA del 05/11/2026 ───────────────────────────────────────

describe("QA 05/11/2026: página, URL y pestañas", () => {
  it("el tablero es `relative`: los resúmenes `sr-only` (absolute) no alargan la página", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    await within(tablero()).findByText("308.808,70 €");
    const t = tablero();
    expect(t).toHaveClass("relative", "overflow-y-auto");
    const ocultos = [...t.querySelectorAll<HTMLElement>(".sr-only")];
    expect(ocultos.length).toBeGreaterThan(5);
    // Cada uno tiene un antepasado posicionado DENTRO del tablero (el propio tablero cuenta).
    for (const el of ocultos) {
      const posicionado = el.parentElement?.closest(".relative");
      expect(posicionado && t.contains(posicionado)).toBe(true);
    }
  });

  it("ir a Compras no le reescribe el periodo en la URL (F21) y «Atrás» vuelve al mismo periodo", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    // Al montar no se toca la URL.
    expect(ubicacion.actual).toBe("?tab=chat");
    fireEvent.click(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Mes" }));
    await waitFor(() => expect(ubicacion.actual).toBe("?tab=chat&desde=2026-11-01&hasta=2026-11-30"));
    act(() => ubicacion.navegar?.("/facturas?tab=compras&modo=documentos&mes=2026-07"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(ubicacion.actual).toBe("?tab=compras&modo=documentos&mes=2026-07");
    act(() => ubicacion.navegar?.(-1));
    await waitFor(() => expect(ubicacion.actual).toBe("?tab=chat&desde=2026-11-01&hasta=2026-11-30"));
    expect(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Mes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("montada en otra pestaña (activa=false) el copiloto se esconde y, al volver, sigue abierto", async () => {
    const { rerender, ref } = montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    expect(panel()).toBeInTheDocument();
    rerender(<ChatFacturas ref={ref} activa={false} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(<ChatFacturas ref={ref} activa />);
    expect(await screen.findByRole("dialog", { name: "Pregúntale a la IA" })).toBeInTheDocument();
  });

  it("con el copiloto abierto el contenido le deja sitio a la derecha (≥ lg) y el botón IA va junto al local", async () => {
    const { container } = montar();
    await screen.findByText("1.362.491,57 €");
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).not.toContain("lg:pr-[360px]");
    const boton = screen.getByRole("button", { name: /pregúntale a la ia/i });
    expect(boton.parentElement).toBe(screen.getByRole("group", { name: "Local" }).parentElement);
    fireEvent.click(boton);
    expect(raiz.className).toContain("lg:pr-[360px]");
  });
});

describe("QA 05/11/2026: cifras de otro periodo, tramos y documentos", () => {
  it("mientras llega otro periodo las cifras viejas se atenúan y no se pueden tocar", async () => {
    const original = doble.rpc.getMockImplementation()!;
    let soltar: (v: unknown) => void = () => {};
    doble.rpc.mockImplementation(((fn: string, args: Record<string, unknown> = {}) =>
      fn === "tablero_compras" && args.p_desde === "2025-01-01" ? new Promise((r) => (soltar = r)) : original(fn, args)) as typeof original);
    try {
      montar();
      await screen.findByText("1.362.491,57 €");
      fireEvent.click(screen.getByTestId("periodo-personalizado"));
      fireEvent.click(await screen.findByRole("button", { name: "Año pasado" }));
      const ind = screen.getByLabelText("Indicadores del periodo");
      await waitFor(() => expect(ind).toHaveAttribute("aria-busy", "true"));
      expect(ind).toHaveClass("opacity-60");
      expect(within(ind).queryAllByRole("button")).toHaveLength(0);
      // Las filas de las tarjetas, desactivadas.
      expect(screen.getByRole("button", { name: /^PROVEEDOR 1, S\.L\.: 9\.000,00\s€/ })).toBeDisabled();
      await act(async () => soltar({ data: TABLERO, error: null }));
      await waitFor(() => expect(within(screen.getByLabelText("Indicadores del periodo")).getAllByRole("button")).toHaveLength(4));
    } finally {
      doble.rpc.mockImplementation(original);
    }
  });

  it("«Ver solo este tramo» se puede deshacer con «Volver al año 2026» (periodo y eje de antes)", async () => {
    montar();
    const ex = await screen.findByRole("region", { name: "Explorar" });
    fireEvent.click(await within(ex).findByRole("button", { name: /ver como tabla/i }));
    fireEvent.click(await within(ex).findByRole("button", { name: "Julio 2026" }));
    fireEvent.click(within(within(ex).getByRole("region", { name: "Punto elegido" })).getByRole("button", { name: "Ver solo este tramo" }));
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_agrupar: "dia", p_desde: "2026-07-01" })));
    fireEvent.click(await within(ex).findByRole("button", { name: "Volver al año 2026" }));
    await waitFor(() => expect(ubicacion.actual).toBe("?tab=chat&desde=2026-01-01&hasta=2026-12-31"));
    expect(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Año 2026" })).toHaveAttribute("aria-pressed", "true");
    // El eje vuelve a «Mes» (la gráfica del año ya estaba en caché: no hace falta pedirla otra vez).
    await waitFor(() => expect(within(ex).getByRole("combobox", { name: "Agrupar por" })).toHaveTextContent("Mes"));
    expect(within(ex).queryByRole("button", { name: /^Volver/ })).not.toBeInTheDocument();
  });

  it("«Abrir en Compras» de un mes conserva el local elegido", async () => {
    const onIrA = vi.fn();
    montar({ onIrA }, "/facturas?tab=chat&local=touza");
    const ex = await screen.findByRole("region", { name: "Explorar" });
    fireEvent.click(await within(ex).findByRole("button", { name: /ver como tabla/i }));
    fireEvent.click(await within(ex).findByRole("button", { name: "Julio 2026" }));
    fireEvent.click(within(within(ex).getByRole("region", { name: "Punto elegido" })).getByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=documentos&mes=2026-07&local=touza");
  });

  it("gastos fijos: «Ver documentos» pide solo los meses de su media (desde_media/hasta_media)", async () => {
    doble.rpcs.tablero_compras = () => ({
      ...TABLERO,
      fijos: { ...TABLERO.fijos, proveedores: [{ ...TABLERO.fijos.proveedores[0], desde_media: "2026-02-01", hasta_media: "2026-10-31" }] },
    });
    montar();
    const fijos = await screen.findByRole("region", { name: "Gastos fijos al mes" });
    fireEvent.click(within(fijos).getByRole("button", { name: /^ACCIONA GREEN/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver documentos" }));
    await waitFor(() =>
      expect(llamadas("documentos_de_cifra")).toContainEqual(
        expect.objectContaining({ p_desde: "2026-02-01", p_hasta: "2026-10-31", p_filtros: { proveedores: [398], tipos: ["factura"] } }),
      ),
    );
    expect(await screen.findByTestId("documentos-de-cifra")).toHaveTextContent(/media de 9 meses/);
  });

  it("al cerrar «Ver documentos», el foco vuelve a la cifra que se tocó", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    const cifra = within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Gasto con IVA/ });
    cifra.focus();
    fireEvent.click(cifra);
    await screen.findByTestId("documentos-de-cifra");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("documentos-de-cifra")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(cifra);
  });

  it("la 9.ª gráfica fijada avisa de que se quita la más antigua", async () => {
    const ocho = Array.from({ length: 8 }, (_, i) => ({
      id: `f${i}`,
      titulo: `Fijada ${i}`,
      config: { medida: "gasto", agrupar: "proveedor", desglose: null, grafica: "auto", top: i + 1, filtros: {} },
      fijadaEn: "",
    }));
    window.localStorage.setItem("facturas-analisis-explorador-fijadas", JSON.stringify(ocho));
    montar();
    const ex = await screen.findByRole("region", { name: "Explorar" });
    fireEvent.click(within(ex).getByRole("button", { name: "Fijar en el tablero" }));
    expect(within(ex).getByRole("status")).toHaveTextContent(/Caben 8 gráficas fijadas/);
    expect(JSON.parse(window.localStorage.getItem("facturas-analisis-explorador-fijadas") ?? "[]")).toHaveLength(8);
  });
});

describe("QA 05/11/2026: copiloto", () => {
  it("las tablas markdown de la IA se ven como tabla (GFM), no en crudo", async () => {
    doble.invoke.mockResolvedValue({
      data: { respuesta: "Estos son:\n\n| Proveedor | Gasto |\n| --- | ---: |\n| Catral | 1.200 € |\n| Flope | 900 € |" },
      error: null,
    });
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    await preguntar("¿Quién me vende más?");
    const tabla = await within(panel()).findByRole("table");
    expect(within(tabla).getByRole("columnheader", { name: "Proveedor" })).toBeInTheDocument();
    expect(within(tabla).getByRole("cell", { name: "Catral" })).toBeInTheDocument();
    expect(within(panel()).queryByText(/\| --- \|/)).not.toBeInTheDocument();
  });

  it("con «Todo» las sugerencias llevan el año del mes", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Todo" }));
    await waitFor(() => expect(llamadasTablero()).toContainEqual({ p_desde: null, p_hasta: null, p_local: null }));
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    expect(within(panel()).getByRole("button", { name: "¿Por qué subió el gasto en julio de 2026?" })).toBeInTheDocument();
  });

  it("no usa scrollIntoView (movía la página): el hilo se desplaza por dentro", async () => {
    doble.invoke.mockResolvedValue({ data: { respuesta: "Hecho." }, error: null });
    montar();
    await screen.findByText("1.362.491,57 €");
    fireEvent.click(screen.getByRole("button", { name: /pregúntale a la ia/i }));
    await preguntar("Hola");
    await within(panel()).findByText("Hecho.");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("tablero: retención de IRPF y meses incompletos (06/11/2026)", () => {
  const AVISO = "La comparación incluye meses incompletos (07/2026): faltan facturas por subir y la variación no es fiable.";
  beforeEach(() => {
    doble.rpcs.tablero_compras = () => ({
      ...TABLERO,
      indicadores: { ...TABLERO.indicadores, retencion_irpf: 5920.09, retencion_irpf_documentos: 42, meses_incompletos: 1, variacion_aviso: AVISO },
      meses: TABLERO.meses.map((m) => ({ ...m, incompleto: m.mes === "2026-07" })),
      meses_incompletos: [{ mes: "2026-07", documentos: 237, referencia: 600, motivo: "reciente" }],
    });
    doble.rpcs.explorar_compras = (a) => {
      const ex = explorar(a);
      return {
        ...ex,
        total: { ...ex.total, variacion_pct: -40, variacion_aviso: AVISO },
        anterior: { desde: "2025-01-01", hasta: "2025-11-05", valor: 500000, documentos: 400 },
        meses_incompletos: ["2026-07"],
        puntos: ex.puntos.map((p) => ({ ...p, incompleto: p.clave === "2026-07" })),
      };
    };
  });

  it("«Gasto con IVA» no cambia y dice lo retenido, el coste real, el mes incompleto y que la variación no es fiable", async () => {
    montar();
    const ind = await screen.findByLabelText("Indicadores del periodo");
    expect(ind).toHaveTextContent(/Gasto con IVA1\.362\.491,57\s€/);
    expect(within(ind).getByTestId("nota-retencion-irpf")).toHaveTextContent(/^incluye −5\.920,09\s€ de IRPF retenido; coste real 1\.368\.411,66\s€$/);
    expect(within(ind).getByTestId("nota-meses-incompletos")).toHaveTextContent("Julio 2026 está incompleto: faltan facturas por subir");
    expect(ind).toHaveTextContent(/\+13,5 % frente a 1 ene 2025 – 5 nov 2025 \(no fiable\)/);
  });

  it("la gráfica del explorador explica la trama del mes incompleto y la variación avisa", async () => {
    montar();
    const ex = await screen.findByRole("region", { name: "Explorar" });
    expect(await within(ex).findByTestId("leyenda-mes-incompleto")).toHaveTextContent("Mes incompleto: faltan facturas por subir");
    expect(within(ex).getByTestId("variacion-no-fiable")).toHaveAttribute("title", AVISO);
  });

  it("sin retención ni meses incompletos no sale ninguna nota", async () => {
    doble.rpcs.tablero_compras = () => TABLERO;
    doble.rpcs.explorar_compras = explorar;
    montar();
    const ind = await screen.findByLabelText("Indicadores del periodo");
    expect(within(ind).queryByTestId("nota-retencion-irpf")).toBeNull();
    expect(within(ind).queryByTestId("nota-meses-incompletos")).toBeNull();
    expect(ind).not.toHaveTextContent(/no fiable/);
    const ex = await screen.findByRole("region", { name: "Explorar" });
    await within(ex).findByText("308.808,70 €");
    expect(within(ex).queryByTestId("leyenda-mes-incompleto")).toBeNull();
  });
});
