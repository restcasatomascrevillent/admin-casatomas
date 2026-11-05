/**
 * Facturas (rediseño del 08/10/2026): pestañas Compras | IA | Cargar. El gasto
 * de IA pasa a un texto pequeño junto a «IA» (abre el desglose); en «Cargar» se
 * queda el monitor de siempre. Los enlaces antiguos (`?tab=productos`,
 * `?tab=documentos`) llevan a Compras. La página mide el alto de la pantalla.
 *
 * Las pestañas de verdad (Compras, el chat, la subida) tienen sus propios tests;
 * aquí se sustituyen por marcadores y se comprueba dónde se colocan.
 */
import { forwardRef, type ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { FilaGastoIa } from "@/lib/facturas/gastoIa";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main style={{ paddingBottom: 24 }}>{children}</main>,
}));
vi.mock("@/components/facturas/compras/TabCompras", () => ({
  TabCompras: ({ modoPedido }: { modoPedido?: { modo: string; doc?: number; mes?: string; prov?: number } }) => (
    <p data-testid="compras">
      Compras · modo pedido: {modoPedido?.modo ?? "ninguno"}
      {modoPedido?.doc ? ` · doc ${modoPedido.doc}` : ""}
      {modoPedido?.mes ? ` · mes ${modoPedido.mes}` : ""}
      {modoPedido?.prov ? ` · prov ${modoPedido.prov}` : ""}
    </p>
  ),
}));
// El tablero de Análisis (con sus propios tests) se sustituye por un marcador con
// un botón que abre un enlace, como hacen sus meses y proveedores.
vi.mock("@/components/facturas/ChatFacturas", () => ({
  ChatFacturas: forwardRef(({ onIrA }: { onIrA?: (e: string) => void }, _ref) => (
    <div>
      <p>Contenido del chat</p>
      <button type="button" onClick={() => onIrA?.("?tab=compras&modo=documentos&mes=2026-07")}>
        Julio en Compras
      </button>
    </div>
  )),
}));
vi.mock("@/components/facturas/SubidaFacturas", () => ({ SubidaFacturas: () => <p>Contenido de la subida</p> }));
vi.mock("@/hooks/useListaCompras", () => ({
  useListaCompras: () => ({
    data: { cabeceras: [{ id: 1, proveedor: "Marta" }, { id: 2, proveedor: null }, { id: 3, proveedor: "Marta" }], completos: null },
  }),
}));
vi.mock("@/hooks/useChatFacturas", () => ({ useChatFacturas: () => ({ conversaciones: [] }) }));
// El contador de la pestaña Compras es un `count` de cabeceras (no descarga la lista): 2 facturas + 1 albarán.
vi.mock("@/hooks/useContadorDocumentos", () => ({ useContadorDocumentos: () => ({ data: 3 }) }));

const gasto: { filas: FilaGastoIa[] } = { filas: [] };
vi.mock("@/hooks/useGastoIa", () => ({
  useGastoIa: () => ({ data: gasto.filas, isLoading: false }),
  useGastoIaRealMes: () => ({ data: null, isLoading: false }),
  useTopeIaMes: () => ({ data: 5 }),
}));

vi.mock("@/hooks/useEstadisticasLectura", () => ({ useEstadisticasLectura: () => ({ data: null }) }));

const rol = { isAdmin: false };
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ role: null, isAdmin: rol.isAdmin, permissions: [], loading: false }) }));
vi.mock("@/components/facturas/ImportacionHistoricaDialog", () => ({
  ImportacionHistoricaDialog: ({ open }: { open: boolean }) => (open ? <p>Diálogo de importación histórica</p> : null),
}));

import Facturas from "@/pages/Facturas";

const fila = (over: Partial<FilaGastoIa>): FilaGastoIa => ({
  funcion: "chat-facturas", coste_usd: 0, filas: 1, llamadas: 1, unidades: 1, filas_sin_tarifa: 0, documentos_ocr: 0, ultima: null, ...over,
});

const original = { innerHeight: window.innerHeight };
function conLayout(alto: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: alto });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 24, bottom: 124, left: 0, right: 100, width: 100, height: 100, x: 0, y: 24, toJSON: () => ({}),
  } as DOMRect);
}
function montar(ruta = "/facturas") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Facturas />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: original.innerHeight });
  gasto.filas = [];
  rol.isAdmin = false;
});

describe("Facturas · importación histórica (solo administradores)", () => {
  it("un administrador ve el botón en Cargar y abre el diálogo", () => {
    rol.isAdmin = true;
    montar("/facturas?tab=cargar");
    fireEvent.click(screen.getByRole("button", { name: /Importación histórica/ }));
    expect(screen.getByText("Diálogo de importación histórica")).toBeInTheDocument();
  });
  it("quien no es administrador no lo ve", () => {
    montar("/facturas?tab=cargar");
    expect(screen.queryByRole("button", { name: /Importación histórica/ })).toBeNull();
  });
});

describe("Facturas · pestañas", () => {
  it("son tres: Análisis · Compras · Cargar, y se entra en Análisis (ya no hay Documentos ni Productos)", () => {
    montar();
    const pestanas = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(pestanas.map((p) => p.textContent?.replace(/\d+$/, "").trim())).toEqual(["Análisis", "Compras", "Cargar"]);
    expect(screen.getByRole("tab", { name: /^Análisis/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Contenido del chat")).toBeInTheDocument();
    // Compras no se monta hasta que se visita: entrar por Análisis no descarga su lista.
    expect(screen.queryByTestId("compras")).not.toBeInTheDocument();
    for (const p of pestanas) expect(p.className).toContain("min-h-11");
  });

  it("los enlaces antiguos llevan a Compras: ?tab=productos en el modo Productos", () => {
    montar("/facturas?tab=productos");
    expect(screen.getByRole("tab", { name: /^Compras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: productos");
  });

  it("enlace profundo del «Ver» de Cargar: ?tab=compras&modo=documentos&doc=7 abre ese documento", () => {
    montar("/facturas?tab=compras&modo=documentos&doc=7");
    expect(screen.getByRole("tab", { name: /^Compras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: documentos · doc 7");
  });

  it("un doc= que no es un número válido se ignora", () => {
    montar("/facturas?tab=compras&doc=abc");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: ninguno");
  });

  it("enlaces del tablero de Análisis: &mes= abre Documentos de ese mes; &prov= ese proveedor", () => {
    montar("/facturas?tab=compras&modo=documentos&mes=2026-07");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: documentos · mes 2026-07");
    cleanup();
    montar("/facturas?tab=compras&modo=proveedores&prov=298");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: proveedores · prov 298");
    cleanup();
    // Sin modo, el parámetro lo deduce; un mes o un proveedor mal escrito se ignora.
    montar("/facturas?tab=compras&prov=12");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: proveedores · prov 12");
    cleanup();
    montar("/facturas?tab=compras&mes=2026-13&prov=x");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: ninguno");
  });

  it("tocar un mes del tablero lleva de Análisis a Compras con ese mes", () => {
    montar("/facturas?tab=chat");
    expect(screen.getByRole("tab", { name: /^Análisis/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Julio en Compras" }));
    expect(screen.getByRole("tab", { name: /^Compras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: documentos · mes 2026-07");
  });

  it("?tab=documentos también lleva a Compras", () => {
    montar("/facturas?tab=documentos");
    expect(screen.getByRole("tab", { name: /^Compras/ })).toHaveAttribute("aria-selected", "true");
  });

  it("?tab=cargar abre Cargar, con su monitor de gasto como estaba", () => {
    montar("/facturas?tab=cargar");
    expect(screen.getByRole("tab", { name: /^Cargar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Contenido de la subida")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-gasto-ia-ocr")).toBeInTheDocument();
  });

  it("?tab=compras entra en Compras; un enlace a Compras sin ?tab= (?doc=) también", () => {
    montar("/facturas?tab=compras");
    expect(screen.getByRole("tab", { name: /^Compras/ })).toHaveAttribute("aria-selected", "true");
    cleanup();
    montar("/facturas?modo=documentos&doc=7");
    expect(screen.getByRole("tab", { name: /^Compras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: documentos · doc 7");
  });

  it("Compras sigue montada al ir a Análisis (la búsqueda y la ficha abierta no se pierden)", () => {
    montar("/facturas?tab=compras");
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Análisis/ }), { button: 0 });
    expect(screen.getByRole("tab", { name: /^Análisis/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Contenido del chat")).toBeInTheDocument();
    expect(screen.getByTestId("compras")).toBeInTheDocument();
  });
});

describe("Facturas · gasto de IA a la derecha de la barra de pestañas", () => {
  it("texto pequeño con lo gastado este mes y, al tocarlo, el desglose", () => {
    gasto.filas = [
      fila({ funcion: "chat-facturas", coste_usd: 0.2, unidades: 20 }),
      fila({ funcion: "clasificar-productos", coste_usd: 0.04, unidades: 2 }),
    ];
    montar();
    const texto = screen.getByTestId("gasto-ia-pestana");
    // Solo lo que cuesta el chatbot (0,2 USD x 0,92); la clasificación es del OCR.
    expect(texto).toHaveTextContent("0,18 € este mes (est.)");
    expect(texto.className).toContain("min-h-11"); // objetivo táctil
    // Está en la barra de pestañas, al extremo derecho y fuera del tablist
    // (no es una pestaña más)…
    expect(within(screen.getByRole("tablist")).queryByTestId("gasto-ia-pestana")).not.toBeInTheDocument();
    expect(texto.className).toContain("ml-auto");
    expect(texto.closest("[data-testid=pestanas-pagina]")).toBe(screen.getByRole("tablist").closest("[data-testid=pestanas-pagina]"));
    // …y la línea fija de antes ya no ocupa sitio encima del chat.
    expect(screen.queryByTestId("monitor-gasto-ia-chat")).not.toBeInTheDocument();

    fireEvent.click(texto);
    // El desglose de la pestaña IA es solo el del chatbot.
    expect(screen.getByText("Chatbot de facturas")).toBeInTheDocument();
    expect(screen.queryByText("Clasificación de productos")).not.toBeInTheDocument();
    expect(screen.queryByText("Lectura de facturas (OCR)")).not.toBeInTheDocument();
    expect(screen.getByText(/1 USD ≈ 0,92 EUR/)).toBeInTheDocument();
  });

  it("sin datos no inventa cifras", () => {
    montar();
    expect(screen.getByTestId("gasto-ia-pestana")).toHaveTextContent("sin datos");
  });
});

describe("Facturas · sin scroll de página", () => {
  it("la página mide justo lo que queda de ventana y la pestaña reparte ese alto por dentro", () => {
    conLayout(800);
    montar("/facturas?tab=compras");
    const raiz = screen.getByRole("tablist").closest("[style*='height']") as HTMLElement;
    // 800 − 24 (posición del bloque) − 24 (relleno inferior del <main>)
    expect(raiz.style.height).toBe("752px");
    expect(raiz).toHaveClass("flex", "flex-col");
    const panel = screen.getByTestId("compras").parentElement as HTMLElement;
    expect(panel).toHaveClass("h-full");
  });
});
