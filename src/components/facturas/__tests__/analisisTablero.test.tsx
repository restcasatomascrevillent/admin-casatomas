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
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-de-prueba" } } }) },
  };
  return { supabase, rpc, rpcs, invoke, inserts, estado };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: doble.supabase }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChatFacturas, type ChatFacturasRef } from "../ChatFacturas";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import { RESPUESTA } from "@/lib/facturas/__tests__/decisionRespuesta";

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

// Con «Editar» en Facturas (la IA y «Clasificar con IA»), salvo que se diga otra cosa (06/11/2026).
function montar(props: { onIrA?: (e: string) => void; activa?: boolean; conIa?: boolean; puedeEditar?: boolean } = {}, url = "/facturas?tab=chat") {
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
  const r = render(<ChatFacturas ref={ref} conIa puedeEditar {...props} />, { wrapper: envoltorio });
  return { ...r, ref };
}

const tablero = () => screen.getByRole("region", { name: "Tablero de compras" });
const panel = () => screen.getByRole("dialog", { name: "Pregúntale a la IA" });
const llamadasTablero = () => doble.rpc.mock.calls.filter((c) => c[0] === "tablero_compras").map((c) => c[1]);

async function preguntar(texto: string) {
  fireEvent.change(within(panel()).getByLabelText("Pregunta para el asistente"), { target: { value: texto } });
  fireEvent.click(within(panel()).getByRole("button", { name: /enviar pregunta/i }));
}

// El tablero de antes (06/11/2026), ya en la versión actual: lo que prueban estas pruebas.
const TABLERO_DE_ANTES = {
  v: 2,
  cifras: ["gasto", "abonos", "regalado", "por_revisar"],
  modulos: ["proveedores", "subidas", "familias", "fijos", "abonos", "locales"].map((id) => ({ id, tamano: "s" })),
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  window.localStorage.setItem("facturas-analisis-tablero", JSON.stringify(TABLERO_DE_ANTES));
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


/** Abre una vista del tablero (Análisis en una pantalla, 07/11/2026: una vista a la vez). */
function verVista(nombre: string) {
  fireEvent.click(within(screen.getByRole("group", { name: "Vista del análisis" })).getByRole("button", { name: nombre }));
}
/** Toca una de las cifras de la vista «Gasto» (las que elige «Personalizar») y devuelve su ventanita de información. */
async function infoDe(nombre: RegExp) {
  if (!screen.queryByLabelText("Más cifras del periodo")) verVista("Gasto");
  fireEvent.click(within(screen.getByLabelText("Más cifras del periodo")).getByRole("button", { name: nombre }));
  return screen.findByTestId("info-indicador");
}
/** Cierra la ventanita abierta. */
async function cerrarInfo() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("info-indicador")).not.toBeInTheDocument());
}

describe("tablero: sale hecho al abrir la pestaña", () => {
  it("tablero_compras con el año en curso y, para la primera tarjeta, el mes en curso (13/11/2026); todos los locales", async () => {
    montar();
    expect(await screen.findByText("1.362.491,57 €")).toBeInTheDocument();
    await waitFor(() => expect(llamadasTablero()).toHaveLength(2));
    expect(llamadasTablero()).toEqual(
      expect.arrayContaining([
        { p_desde: "2026-01-01", p_hasta: "2026-12-31", p_local: null },
        { p_desde: "2026-11-01", p_hasta: "2026-11-30", p_local: null },
      ]),
    );
    expect(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Año 2026" })).toHaveAttribute("aria-pressed", "true");
  });

  it("4 cifras que también son navegación: pulsar una abre su vista y queda marcada; las demás cifras, en «Gasto»", async () => {
    montar();
    const ind = await screen.findByLabelText("Indicadores del periodo");
    // 13/11/2026: la primera tarjeta es el gasto del mes en curso y las facturas subidas (el doble responde lo mismo).
    await waitFor(() => expect(ind).toHaveTextContent(/Gasto de noviembre1\.362\.491,57\s€con IVA · 1\.844 facturas subidas/));
    expect(ind).toHaveTextContent(/Precios que han subido/);
    expect(ind).toHaveTextContent(/Puedes ahorrar/);
    expect(ind).toHaveTextContent(/Por revisar40albaranes sin factura/);
    const vistas = screen.getByRole("group", { name: "Vista del análisis" });
    // Por defecto, «Qué decidir hoy».
    expect(within(vistas).getByRole("button", { name: "Qué decidir hoy" })).toHaveAttribute("aria-pressed", "true");
    const gasto = within(ind).getByRole("button", { name: /^Gasto de noviembre/ });
    expect(gasto).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(gasto);
    expect(gasto).toHaveAttribute("aria-pressed", "true");
    expect(within(vistas).getByRole("button", { name: "Gasto" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(ubicacion.actual).toContain("vista=gasto"));
    expect(screen.getByTestId("franja-gasto")).toHaveTextContent(/jun – jul 2026\+13,5 % frente a 1 ene 2025 – 5 nov 2025/);
    // Las cifras que no son de navegación (las elige «Personalizar»), en «Gasto», sin repetir el gasto ni «Por revisar».
    const mas = screen.getByLabelText("Más cifras del periodo");
    expect(mas).toHaveTextContent(/Abonos−14\.376,94\s€/);
    expect(mas).toHaveTextContent(/Regalado y descuentos28\.204,41\s€/);
    expect(mas).not.toHaveTextContent(/Por revisar|Gasto con IVA/);
    let info = await infoDe(/^Abonos/);
    expect(info).toHaveTextContent("43 documentos");
    await cerrarInfo();
    info = await infoDe(/^Regalado y descuentos/);
    expect(info).toHaveTextContent(/lo que valía 107\.581,24\s€ · 69 estimados/);
    await cerrarInfo();
    fireEvent.click(within(ind).getByRole("button", { name: /^Por revisar/ }));
    expect(within(ind).getByRole("button", { name: /^Por revisar/ })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("region", { name: "Albaranes por revisar" })).toBeInTheDocument();
  });

  it("todas las tarjetas, con título y resumen para lectores de pantalla", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    // Una vista a la vez: cada módulo vive en la suya.
    const porVista: Record<string, string[]> = {
      Precios: ["Lo que más ha subido"],
      Gasto: ["Gasto por familia", "Gastos fijos al mes", "Abonos por proveedor"],
      Proveedores: ["Tus proveedores"],
    };
    for (const [vista, titulos] of Object.entries(porVista)) {
      verVista(vista);
      for (const titulo of titulos) expect(within(tablero()).getByRole("region", { name: titulo })).toBeInTheDocument();
      if (vista !== "Gasto") expect(within(tablero()).queryByRole("region", { name: "Gastos fijos al mes" })).not.toBeInTheDocument();
    }
    verVista("Proveedores");
    // La ficha del primero sale ya elegida.
    expect(await within(tablero()).findByRole("region", { name: "Proveedor 1" })).toBeInTheDocument();
    // Nada del copiloto de antes en la pantalla principal.
    // (El desplegable «Al instante» del chat; la vista «Explorar» se quitó el 08/11/2026.)
    expect(screen.queryByRole("button", { name: /^al instante$/i })).not.toBeInTheDocument();
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

  it("proveedores (09/11/2026): lista comparada con el anterior, ficha del elegido y reparto de locales en la franja", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    await screen.findByText("1.362.491,57 €");
    verVista("Proveedores");
    // Pide el periodo y el anterior equivalente (el anterior está cargado: 1.700 de 1.884 documentos).
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_desde: "2026-01-01", p_hasta: "2026-12-31", p_medida: "gasto", p_agrupar: "proveedor", p_top: 50 })));
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_desde: "2025-01-01", p_hasta: "2025-11-05", p_medida: "gasto", p_agrupar: "proveedor" })));
    const lista = await screen.findByRole("listbox", { name: "Proveedores: Todos" });
    expect(within(lista).getAllByRole("option")).toHaveLength(3);
    // Con comparación, los filtros de cambio.
    const filtros = screen.getByRole("group", { name: "Qué proveedores ver" });
    expect(within(filtros).getByRole("button", { name: "Gastas más (0)" })).toBeInTheDocument();
    expect(within(filtros).getByRole("button", { name: "Ya no compras (0)" })).toBeInTheDocument();
    expect(screen.getByTestId("franja-proveedores")).toHaveTextContent(/245 proveedores con compras/);
    expect(screen.getByTestId("franja-locales")).toHaveTextContent(/Casa Tomás 1\.333\.190 €/);
    // Elegir otro: su ficha, con cifras, y sus botones.
    fireEvent.click(within(lista).getByRole("option", { name: /Proveedor 2/ }));
    const ficha = await screen.findByRole("region", { name: "Proveedor 2" });
    expect(within(ficha).getByTestId("cifras-proveedor")).toHaveTextContent(/8\.000,00\s€/);
    expect(within(ficha).getByTestId("cifras-proveedor")).toHaveTextContent(/antes 8\.000 €/);
    fireEvent.click(within(ficha).getByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=proveedores&prov=301");
    fireEvent.click(within(ficha).getByRole("button", { name: "Ver documentos" }));
    await waitFor(() => expect(llamadas("documentos_de_cifra").length).toBeGreaterThan(0));
  });

  it("familias: avisa de las líneas sin clasificar y «Clasificar con IA» lleva a Productos", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    await screen.findByText("1.362.491,57 €");
    verVista("Gasto");
    const tarjeta = await screen.findByRole("region", { name: "Gasto por familia" });
    expect(tarjeta).toHaveTextContent(/10\.396 líneas sin clasificar/);
    fireEvent.click(within(tarjeta).getByRole("button", { name: /clasificar con ia/i }));
    expect(onIrA).toHaveBeenCalledWith("?tab=compras&modo=productos");
  });
});

describe("con solo «Ver» en Facturas (06/11/2026): se consulta, sin IA y sin lo que cambia datos", () => {
  it("el tablero sale entero pero sin «Pregúntale a la IA» ni su panel, y no pide el historial del chat", async () => {
    const desde = vi.spyOn(doble.supabase, "from");
    montar({ conIa: false, puedeEditar: false });
    await screen.findByText("1.362.491,57 €");
    expect(screen.queryByRole("button", { name: /pregúntale a la ia/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Pregúntale a la IA" })).not.toBeInTheDocument();
    // «Personalizar» su propia vista sí (se guarda por usuario).
    expect(screen.getByRole("button", { name: "Personalizar el tablero" })).toBeInTheDocument();
    expect(desde.mock.calls.some(([t]) => t === "chat_facturas_conversaciones")).toBe(false);
    desde.mockRestore();
  });

  it("(contraste) con «Editar» sí sale la IA y se pide el historial", async () => {
    const desde = vi.spyOn(doble.supabase, "from");
    montar();
    await screen.findByText("1.362.491,57 €");
    expect(screen.getByRole("button", { name: /pregúntale a la ia/i })).toBeInTheDocument();
    await waitFor(() => expect(desde.mock.calls.some(([t]) => t === "chat_facturas_conversaciones")).toBe(true));
    desde.mockRestore();
  });

  it("«Clasificar con IA» no sale (avisa igual de las líneas sin clasificar)", async () => {
    montar({ conIa: false, puedeEditar: false });
    await screen.findByText("1.362.491,57 €");
    verVista("Gasto");
    const tarjeta = await screen.findByRole("region", { name: "Gasto por familia" });
    expect(tarjeta).toHaveTextContent(/10\.396 líneas sin clasificar/);
    expect(within(tarjeta).queryByRole("button", { name: /clasificar con ia/i })).not.toBeInTheDocument();
  });

  it("el «Preguntar a la IA» de Compras (enviarConsulta) no hace nada", async () => {
    const { ref } = montar({ conIa: false, puedeEditar: false });
    await screen.findByText("1.362.491,57 €");
    act(() => ref.current?.enviarConsulta("¿Y esta factura?"));
    expect(screen.queryByRole("dialog", { name: "Pregúntale a la IA" })).not.toBeInTheDocument();
  });
});

describe("tablero: menús de las filas", () => {
  it("un proveedor ofrece ver sus documentos, abrirlo en Compras", async () => {
    const onIrA = vi.fn();
    montar({ onIrA });
    await screen.findByText("1.362.491,57 €");
    verVista("Proveedores");
    fireEvent.click(await screen.findByRole("option", { name: /Proveedor 1/ }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Proveedor 1" })).getByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=proveedores&prov=300");
    verVista("Gasto");
    fireEvent.click(within(screen.getByRole("region", { name: "Abonos por proveedor" })).getByRole("button", { name: /CATRAL/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=proveedores&prov=377");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    verVista("Proveedores");
    fireEvent.click(await screen.findByRole("option", { name: /Proveedor 2/ }));
    expect(within(await screen.findByRole("region", { name: "Proveedor 2" })).getByRole("button", { name: "Ver documentos" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ver su gasto por mes/ })).not.toBeInTheDocument();
  });

  it("un producto que sube ya no ofrece llevarlo al explorador (quitado el 08/11/2026)", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    verVista("Precios");
    const subidas = await screen.findByRole("region", { name: "Lo que más ha subido" });
    expect(subidas).toHaveTextContent(/mismo proveedor, 12 ene – 11 abr vs 9 jul – 6 oct/);
    fireEvent.click(within(subidas).getByRole("button", { name: /^PAN DE CRISTAL/ }));
    expect(screen.queryByRole("button", { name: /explorador/ })).not.toBeInTheDocument();
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
    // El original de Drive lo sirve facturas-original (sin sesión de Google): se simula la función.
    const pedidas: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init: RequestInit = {}) => {
        pedidas.push({ url: String(u), auth: new Headers(init.headers).get("authorization") });
        return new Response("%PDF-1.4", { status: 200, headers: { "Content-Type": "application/pdf" } });
      }),
    );
    URL.createObjectURL = vi.fn(() => "blob:original-f77");
    URL.revokeObjectURL = vi.fn();
    const onIrA = vi.fn();
    montar({ onIrA });
    await screen.findByText("1.362.491,57 €");
    verVista("Gasto");
    fireEvent.click(screen.getByRole("button", { name: "Ver los documentos del gasto" }));
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
    expect(await within(visor).findByTitle(/^Original: Factura F-77/)).toHaveAttribute("src", "blob:original-f77");
    expect(pedidas).toEqual([{ url: expect.stringMatching(/\/functions\/v1\/facturas-original\?id=11$/), auth: "Bearer jwt-de-prueba" }]);
    const drive = within(visor).getByRole("link", { name: /Abrir en Drive/ });
    expect(drive).toHaveAttribute("target", "_blank");
    expect(drive).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(visor).getByText("1 de 2")).toBeInTheDocument();
    fireEvent.click(within(visor).getByRole("button", { name: "Documento siguiente" }));
    expect(within(visor).getByText("2 de 2")).toBeInTheDocument();
    expect(within(visor).getByText(/No se guardó el original/)).toBeInTheDocument();
    fireEvent.click(within(visor).getByRole("button", { name: "Abrir en Compras" }));
    expect(onIrA).toHaveBeenLastCalledWith("?tab=compras&modo=documentos&doc=12");
    vi.unstubAllGlobals();
  });

  it("«Por revisar» abre su vista con solo los albaranes sin factura", async () => {
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
    await waitFor(() => expect(llamadasTablero()).toContainEqual({ p_desde: null, p_hasta: null, p_local: null }));
    expect(await screen.findByLabelText("Indicadores del periodo")).toHaveTextContent(/Por revisar40albaranes sin factura/);
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
    // Las gráficas fijadas salen bajo «Qué decidir hoy».
    verVista("Qué decidir hoy");
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
    verVista("Gasto");
    const t = tablero();
    expect(t).toHaveClass("relative", "overflow-y-auto");
    const ocultos = [...t.querySelectorAll<HTMLElement>(".sr-only")];
    expect(ocultos.length).toBeGreaterThan(2);
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
    rerender(<ChatFacturas ref={ref} activa={false} conIa puedeEditar />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(<ChatFacturas ref={ref} activa conIa puedeEditar />);
    expect(await screen.findByRole("dialog", { name: "Pregúntale a la IA" })).toBeInTheDocument();
  });

  it("con el copiloto abierto el contenido le deja sitio a la derecha (≥ lg) y el botón IA va en la barra, con el local", async () => {
    const { container } = montar();
    await screen.findByText("1.362.491,57 €");
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).not.toContain("lg:pr-[360px]");
    const boton = screen.getByRole("button", { name: /pregúntale a la ia/i });
    const barra = screen.getByTestId("barra-analisis");
    expect(barra).toContainElement(boton);
    expect(barra).toContainElement(screen.getByRole("group", { name: "Local" }));
    expect(barra).toContainElement(screen.getByRole("button", { name: "Personalizar el tablero" }));
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
      verVista("Proveedores");
      fireEvent.click(screen.getByTestId("periodo-personalizado"));
      fireEvent.click(await screen.findByRole("button", { name: "Año pasado" }));
      const ind = screen.getByLabelText("Indicadores del periodo");
      await waitFor(() => expect(ind).toHaveAttribute("aria-busy", "true"));
      expect(ind).toHaveClass("opacity-60");
      for (const b of within(ind).getAllByRole("button")) expect(b).toBeDisabled();
      // Las filas de las tarjetas, desactivadas.
      expect(screen.getByRole("option", { name: /Proveedor 1/ })).toBeDisabled();
      await act(async () => soltar({ data: TABLERO, error: null }));
      await waitFor(() => expect(within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Gasto de noviembre/ })).toBeEnabled());
    } finally {
      doble.rpc.mockImplementation(original);
    }
  });

  it("gastos fijos: «Ver documentos» pide solo los meses de su media (desde_media/hasta_media)", async () => {
    doble.rpcs.tablero_compras = () => ({
      ...TABLERO,
      fijos: { ...TABLERO.fijos, proveedores: [{ ...TABLERO.fijos.proveedores[0], desde_media: "2026-02-01", hasta_media: "2026-10-31" }] },
    });
    montar();
    await screen.findByText("1.362.491,57 €");
    verVista("Gasto");
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
    verVista("Gasto");
    const cifra = within(screen.getByLabelText("Más cifras del periodo")).getByRole("button", { name: /^Abonos/ });
    cifra.focus();
    fireEvent.click(cifra);
    fireEvent.click(within(await screen.findByTestId("info-indicador")).getByRole("button", { name: "Ver documentos" }));
    await screen.findByTestId("documentos-de-cifra");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("documentos-de-cifra")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(cifra);
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

  it("el gasto no cambia; «Gasto» dice lo retenido, el coste real, el mes incompleto y que la variación no es fiable", async () => {
    montar();
    const ind = await screen.findByLabelText("Indicadores del periodo");
    await waitFor(() => expect(ind).toHaveTextContent(/Gasto de noviembre1\.362\.491,57\s€/));
    // Marca de aviso en la cifra (el doble marca un mes incompleto también en la consulta del mes en curso).
    const gasto = within(ind).getByRole("button", { name: /^Gasto de noviembre/ });
    expect(gasto).toHaveAccessibleName(/con avisos/);
    fireEvent.click(gasto);
    const franja = screen.getByTestId("franja-gasto");
    expect(within(franja).getByTestId("nota-retencion-irpf")).toHaveTextContent(/^incluye −5\.920,09\s€ de IRPF retenido; coste real 1\.368\.411,66\s€$/);
    expect(within(franja).getByTestId("nota-meses-incompletos")).toHaveTextContent("Julio 2026 está incompleto: faltan facturas por subir");
    expect(franja).toHaveTextContent(/\+13,5 % frente a 1 ene 2025 – 5 nov 2025 \(no fiable\)/);
  });

  it("sin retención ni meses incompletos no sale ninguna nota", async () => {
    doble.rpcs.tablero_compras = () => TABLERO;
    doble.rpcs.explorar_compras = explorar;
    montar();
    const ind = await screen.findByLabelText("Indicadores del periodo");
    expect(within(ind).getByRole("button", { name: /^Gasto de noviembre/ })).not.toHaveAccessibleName(/con avisos/);
    verVista("Gasto");
    const franja = screen.getByTestId("franja-gasto");
    expect(within(franja).queryByTestId("nota-retencion-irpf")).toBeNull();
    expect(within(franja).queryByTestId("nota-meses-incompletos")).toBeNull();
    expect(franja).not.toHaveTextContent(/no fiable/);
  });
});

// ─── Análisis en UNA pantalla (07/11/2026): barra única, cifras-navegación y vistas ──

describe("Análisis en una pantalla: vistas con las gráficas de decisión", () => {
  beforeEach(() => {
    doble.rpcs.facturas_decision = () => RESPUESTA;
    // El tablero por defecto (con «Lo más comprado» y «Gasto por mes»).
    window.localStorage.removeItem("facturas-analisis-tablero");
  });

  it("barra única: periodo (con «Elegir fechas» como icono), local, «Personalizar» como icono y la IA, juntos", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    const barra = screen.getByTestId("barra-analisis");
    expect(within(barra).getByRole("group", { name: "Periodo" })).toBeInTheDocument();
    const fechas = within(barra).getByRole("button", { name: "Elegir fechas" });
    expect(fechas).toHaveAttribute("title", "Elegir fechas");
    expect(fechas).not.toHaveTextContent(/Personalizado/);
    expect(within(barra).getByRole("group", { name: "Local" })).toBeInTheDocument();
    expect(within(barra).getByRole("button", { name: "Personalizar el tablero" })).not.toHaveTextContent(/Personalizar/);
    expect(within(barra).getByRole("button", { name: /pregúntale a la ia/i })).toBeInTheDocument();
    // Ya no hay «Añadir o quitar módulos» al final del tablero (el icono de la barra sale también en el móvil).
    expect(screen.queryByRole("button", { name: /añadir o quitar módulos/i })).not.toBeInTheDocument();
  });

  it("«Qué decidir hoy» (por defecto): las 5 que más dinero mueven, con sus botones; «Ver precio» abre «Precios» con esa subida", async () => {
    montar();
    const lista5 = await screen.findByRole("list", { name: "Decisiones, de más a menos dinero" });
    expect(screen.getByTestId("caja-decidir")).toContainElement(lista5);
    const filas = within(lista5).getAllByRole("listitem");
    expect(filas.map((f) => f.dataset.decision)).toEqual(["familia", "sube", "mejor", "mejor", "sube"]);
    expect(filas[0]).toHaveTextContent(/Congelados gasta un 30 % más de lo normal/);
    expect(filas[0]).toHaveTextContent("+428 €");
    expect(filas[1]).toHaveTextContent(/PERCEBE GALLEGO G ha subido un 29 %.*\+62 €\/mes/);
    expect(filas[2]).toHaveTextContent(/Berberecho: Casimiro Pérez te lo deja 6,50 €\/kg más barato.*−117 € \/ 90 días/);
    expect(within(filas[0]).getByRole("button", { name: "Ver qué se compró" })).toBeInTheDocument();
    expect(within(filas[2]).getByRole("button", { name: "Comparar facturas" })).toBeInTheDocument();
    expect(within(filas[2]).getByRole("button", { name: "No es lo mismo" })).toBeInTheDocument();
    fireEvent.click(within(filas[1]).getByRole("button", { name: "Ver precio" }));
    const vistas = screen.getByRole("group", { name: "Vista del análisis" });
    expect(within(vistas).getByRole("button", { name: "Precios" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Precios que han subido/ })).toHaveAttribute("aria-pressed", "true");
    const lista = screen.getByRole("listbox", { name: /^Precios: Suben/ });
    expect(within(lista).getByRole("option", { selected: true })).toHaveTextContent(/PERCEBE GALLEGO G/);
    const detalle = screen.getByTestId("caja-precio-detalle");
    expect(within(detalle).getByRole("heading", { name: "PERCEBE GALLEGO G" })).toBeInTheDocument();
    expect(within(detalle).getByRole("button", { name: "Ver factura" })).toBeInTheDocument();
    expect(within(detalle).getByRole("button", { name: "Visto" })).toBeInTheDocument();
    expect(within(detalle).getByRole("button", { name: "Es normal" })).toBeInTheDocument();
    // La gráfica del elegido pide su precio por mes, de ESE producto.
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_medida: "precio", p_agrupar: "mes", p_filtros: { productos: ["PERCEBE GALLEGO G"] } })));
    // Otro de la lista cambia el detalle.
    fireEvent.click(within(lista).getByRole("option", { name: /MELON PIEL SAPO/ }));
    expect(within(screen.getByTestId("caja-precio-detalle")).getByRole("heading", { name: "MELON PIEL SAPO" })).toBeInTheDocument();
    // «Lo más comprado»: la gráfica sale de los datos de la RPC, con la raya del precio pactado y la acción de quitarlo.
    fireEvent.click(screen.getByRole("button", { name: "Lo más comprado" }));
    const det = screen.getByTestId("caja-precio-detalle");
    expect(within(det).getByRole("heading", { name: "Cruzcampo barril 50 l" })).toBeInTheDocument();
    expect(within(det).getByTestId("raya-referencia")).toBeInTheDocument();
    expect(within(det).getByRole("button", { name: "Quitar precio pactado" })).toBeInTheDocument();
  });

  it("«Precios» con un solo mes de compras: una frase con el precio, sin ejes vacíos", async () => {
    doble.rpcs.facturas_decision = () => ({
      ...RESPUESTA,
      top: [{ ...RESPUESTA.top[0], meses: [{ mes: "2026-08", precio: null }, { mes: "2026-09", precio: 203.98 }], pactado: null }],
    });
    montar();
    const lista5 = await screen.findByRole("list", { name: "Decisiones, de más a menos dinero" });
    fireEvent.click(within(within(lista5).getAllByRole("listitem")[1]).getByRole("button", { name: "Ver precio" }));
    fireEvent.click(screen.getByRole("button", { name: "Lo más comprado" }));
    const det = screen.getByTestId("caja-precio-detalle");
    expect(within(det).getByTestId("precio-un-solo-mes")).toHaveTextContent(/Solo 1 mes con compras: 203,98 €\/barril en septiembre 2026 en Catral\. Sin IVA/);
    expect(within(det).queryByRole("img")).not.toBeInTheDocument();
    expect(within(det).queryByText(/€ por barril, sin IVA/)).not.toBeInTheDocument();
  });

  it("«Puedes ahorrar» abre «Ahorro»: dos barras (ahora / más barato), el −18 % y la frase con lo que compraste", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    const cifra = within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Puedes ahorrar/ });
    await waitFor(() => expect(cifra).toBeEnabled());
    expect(cifra).toHaveTextContent(/219,00\s€cada 90 días · 2 productos/);
    fireEvent.click(cifra);
    expect(cifra).toHaveAttribute("aria-pressed", "true");
    const [berberecho] = screen.getAllByTestId("fila-ahorro");
    expect(berberecho).toHaveTextContent(/Ahora: Cetárea Angelmar.*35,50 €\/kg/);
    expect(berberecho).toHaveTextContent(/Más barato: Casimiro Pérez.*29,00 €\/kg/);
    expect(berberecho).toHaveTextContent("−18 %");
    expect(within(berberecho).getByTestId("frase-ahorro")).toHaveTextContent("Compraste 18 kg en 90 días. A 29,00 € en lugar de 35,50 € habrías pagado 117 € menos.");
    for (const b of ["Comparar las dos facturas", "No es el mismo producto", "Visto"]) expect(within(berberecho).getByRole("button", { name: b })).toBeInTheDocument();
    await waitFor(() => expect(ubicacion.actual).toContain("vista=ahorro"));
    expect(window.localStorage.getItem("facturas-analisis-vista")).toBe("ahorro");
  });

  it("con solo «Ver»: se ve todo, sin los botones que cambian datos", async () => {
    montar({ conIa: false, puedeEditar: false }, "/facturas?tab=chat&vista=ahorro");
    const [fila] = await screen.findAllByTestId("fila-ahorro");
    expect(within(fila).getByRole("button", { name: "Comparar las dos facturas" })).toBeInTheDocument();
    expect(within(fila).queryByRole("button", { name: "Visto" })).not.toBeInTheDocument();
    expect(within(fila).queryByRole("button", { name: "No es el mismo producto" })).not.toBeInTheDocument();
  });

  it("un enlace con ?vista= abre esa vista; «Por revisar» enseña los albaranes y los demás avisos", async () => {
    montar({}, "/facturas?tab=chat&vista=revisar");
    expect(await screen.findByRole("region", { name: "Albaranes por revisar" })).toBeInTheDocument();
    const avisos = await screen.findByTestId("caja-avisos");
    expect(within(avisos).getByTestId("aviso-por-revisar")).toHaveTextContent(/Proveedor nuevo/);
    expect(within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Por revisar/ })).toHaveAccessibleName(/1 con aviso/);
  });

  it("petición del dueño: una subida con la compra anterior más barata (doc_otro) da «Comparar facturas» y abre las dos, la anterior primero", async () => {
    const [s1, ...resto] = RESPUESTA.cambios.sube;
    const anterior = { id: 70, fecha: "2026-09-12", proveedor: "Cetárea Angelmar", numero: "260401", tipo: "factura", local: "casa_tomas", total: 700, drive_url: "https://drive.google.com/file/d/ant/view", archivo_path: null };
    doble.rpcs.facturas_decision = () => ({ ...RESPUESTA, cambios: { ...RESPUESTA.cambios, sube: [{ ...s1, doc_otro: anterior }, ...resto] } });
    montar();
    const lista5 = await screen.findByRole("list", { name: "Decisiones, de más a menos dinero" });
    const fila = within(lista5).getAllByRole("listitem")[1];
    expect(fila).toHaveTextContent(/PERCEBE GALLEGO G ha subido/);
    expect(within(fila).queryByRole("button", { name: "Ver factura" })).not.toBeInTheDocument();
    fireEvent.click(within(fila).getByRole("button", { name: "Comparar facturas" }));
    const visor = await screen.findByTestId("visor-documento");
    expect(within(visor).getByText("1 de 2")).toBeInTheDocument();
    expect(within(visor).getByTitle(/^Factura 260401/)).toBeInTheDocument();
  });

  it("bug del dueño: con «Año» sin meses anteriores, «¿En qué se va el dinero?» compara el último mes completo y lo explica", async () => {
    doble.rpcs.facturas_decision = () => ({
      ...RESPUESTA,
      periodo: { ...RESPUESTA.periodo, desde: "2026-01-01", hasta: "2026-12-31", meses_equivalentes: 10, comparado: { modo: "ultimo_mes", desde: "2026-09-01", hasta: "2026-09-30" } },
      referencia: { meses: ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"], desde: "2026-03-01", hasta: "2026-08-31" },
    });
    montar({}, "/facturas?tab=chat&vista=gasto");
    const tarjeta = await screen.findByRole("region", { name: "¿En qué se va el dinero?" });
    expect(tarjeta).toHaveTextContent(/Barra: septiembre, el último mes completo \(no hay meses anteriores al periodo\); raya: media de marzo–agosto/);
    expect(tarjeta).not.toHaveTextContent(/aún no hay meses completos/);
    // «Ver documentos» de una familia pide los de ese mes, no los del año.
    fireEvent.click(within(tarjeta).getByRole("button", { name: /^Congelados/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver documentos" }));
    await waitFor(() => expect(llamadas("documentos_de_cifra")).toContainEqual(expect.objectContaining({ p_desde: "2026-09-01", p_hasta: "2026-09-30", p_agrupar: "familia", p_clave: "8" })));
  });
});
