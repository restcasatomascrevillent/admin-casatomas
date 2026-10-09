/**
 * Facturas › Compras (rediseño del 08/10/2026): UN buscador, selector
 * Documentos · Productos · Proveedores con contador por modo, chips por modo,
 * lista compacta + ficha, y saltos entre fichas (producto → documento → producto).
 *
 * Con un doble de Supabase propio (los documentos se filtran por `tipo`, las
 * líneas de un producto por `producto_id`) y 3 proveedores, 5 documentos y
 * 3 productos sacados de la misma compra de merluza.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const base = vi.hoisted(() => {
  type Filtro = { metodo: string; args: unknown[] };
  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) =>
    rpcs[fn] ? { data: rpcs[fn](args), error: null } : { data: null, error: { code: "PGRST202", message: `no function ${fn}` } },
  );
  let tablas: (tabla: string, f: Filtro[]) => unknown = () => [];
  const from = (tabla: string) => {
    const filtros: Filtro[] = [];
    const cadena: Record<string, unknown> = new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            const res = { data: tablas(tabla, filtros), error: null };
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko);
          }
          if (prop === "single" || prop === "maybeSingle") {
            return async () => {
              const d = tablas(tabla, filtros);
              return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: null };
            };
          }
          return (...args: unknown[]) => {
            filtros.push({ metodo: prop, args });
            return cadena;
          };
        },
      },
    );
    return cadena;
  };
  return {
    supabase: { rpc, from, functions: { invoke: vi.fn() }, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } },
    rpc,
    rpcs,
    fijarTablas(f: typeof tablas) {
      tablas = f;
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: base.supabase }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import { TabCompras } from "../compras/TabCompras";

// ─── Datos ───────────────────────────────────────────────────────────────────
const linea = (id: number, nombre: string, productoId: number | null, canonico: string | null) => ({
  id, nombre, precio_unitario: "30.00", cantidad: "3.000", unidad: "kg", total: "90.00", producto_id: productoId,
  productos_catalogo: canonico ? { nombre: canonico, categoria_id: 4 } : null,
});
const documento = (id: number, tipo: string, numero: string, proveedor: string, fecha: string, extra: Record<string, unknown> = {}) => ({
  id, tipo, numero_documento: numero, proveedor, proveedor_normalizado: null, cif: null, fecha, facturado_en_id: null,
  subtotal: "90.00", iva: "9.00", total: "99.00", total_origen: "leido", observaciones: null, drive_url: null, archivo_path: null,
  alertas_validacion: [], procesado_en: null, created_at: null, verificada: false, productos_factura: [], ...extra,
});

const DOCS = [
  documento(1, "factura", "F-100", "PESCADOS MARTA, S.L.", "2026-09-01", {
    productos_factura: [linea(101, "MERLUZA PINCHO 3KG", 10, "Merluza de pincho")],
  }),
  documento(2, "factura", "F-101", "BODEGA CAMPOLUZ, S.L.", "2026-09-05", {
    verificada: true,
    alertas_validacion: [{ codigo: "iva_incoherente", severidad: "alta", mensaje: "El IVA no cuadra" }],
    productos_factura: [linea(102, "Vino tinto crianza", 12, "Vino tinto crianza")],
  }),
  documento(3, "albaran", "A-1", "Pescados Marta", "2026-10-01", {
    productos_factura: [linea(103, "Merluza del cantábrico", 11, "Merluza del Cantábrico")],
  }),
  documento(4, "albaran", "A-2", "BODEGA CAMPOLUZ, S.L.", "2026-09-04", { verificada: true, facturado_en_id: 2 }),
  documento(5, "albaran", "A-3", "PESCADOS MARTA, S.L.", "2026-08-30", {
    facturado_en_id: 1,
    productos_factura: [linea(104, "Merluza", 10, "Merluza de pincho")],
  }),
];

const CATEGORIAS = [
  { id: 4, clave: "pescado", nombre: "Pescado y marisco", descripcion: null, padre_id: null, orden: 1, activa: true },
  { id: 5, clave: "bebidas", nombre: "Bebidas", descripcion: null, padre_id: null, orden: 2, activa: true },
];

const resumen = (id: number, nombre: string, cat: number, gasto: string, proveedores: string[]) => ({
  producto_id: id, nombre, categoria_id: cat, origen: "manual", unidad_habitual: "kg", compras: 2, documentos: 2,
  cantidades: { kg: "6.000" }, gasto, lineas_sin_importe: 0, ultimo_precio: "30.00", ultima_fecha: "2026-10-01", proveedores,
});
const RESUMEN = [
  resumen(10, "Merluza de pincho", 4, "180.00", ["PESCADOS MARTA, S.L."]),
  resumen(11, "Merluza del Cantábrico", 4, "90.00", ["Pescados Marta"]),
  resumen(12, "Vino tinto crianza", 5, "60.00", ["BODEGA CAMPOLUZ, S.L."]),
];

const prov = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, nombre_comercial: null, cif: null, activo: true, origen: "carga_inicial", documentos: 2, facturas: 1, albaranes: 1,
  total_facturas: "99.00", total_albaranes: "99.00", ultima_fecha: "2026-10-01", variantes: [nombre], alias: [], cifs_extra: [], ...extra,
});
const PROVEEDORES = [
  prov(1, "Pescados Marta S.L.", { variantes: ["PESCADOS MARTA, S.L.", "Pescados Marta"], documentos: 3 }),
  prov(2, "Bodega Campoluz", { variantes: ["BODEGA CAMPOLUZ, S.L."] }),
  prov(3, "Hielos del Norte", { documentos: 0, facturas: 0, albaranes: 0, variantes: ["Hielos del Norte"] }),
];

const SERIE = {
  producto: "Merluza de pincho", unidad: "kg", proveedores: ["Pescados Marta"],
  puntos: [["2026-08-30", 28, 0], ["2026-09-01", 30, 0]], n: 2, min: 28, max: 30, ultimo: 30, variacion_pct: 7.1,
};

function prepararBase() {
  for (const k of Object.keys(base.rpcs)) delete base.rpcs[k];
  base.rpc.mockClear();
  base.rpcs.productos_resumen = () => RESUMEN;
  base.rpcs.productos_gasto_por_categoria = () => [];
  base.rpcs.proveedores_listado = () => PROVEEDORES;
  base.rpcs.serie_precios_agente = () => SERIE;
  base.rpcs.variacion_precios_agente = () => ({ productos: [{ producto: "Merluza de pincho", variacion_pct: 25 }] });
  base.rpcs.ficha_proveedor_agente = () => ({
    proveedor: "Pescados Marta S.L.", docs: 3, primera: "2026-08-30", ultima: "2026-10-01", intervalo_medio_dias: 9, gasto: "600.5",
    top_productos: [{ producto: "Merluza de pincho", unidad: "kg", ultimo_precio: 30, ultima_fecha: "2026-10-01" }],
  });
  base.fijarTablas((tabla, f) => {
    const eq = (col: string) => f.find((x) => x.metodo === "eq" && x.args[0] === col)?.args[1];
    if (tabla === "facturas") return DOCS.filter((d) => d.tipo === eq("tipo"));
    if (tabla === "categorias_producto") return CATEGORIAS;
    if (tabla === "configuracion_facturas") return [{ umbral_subida_precio_pct: 10, avisos_subida_precio: true }];
    if (tabla === "productos_factura" && eq("producto_id") === 10) {
      return [
        { id: 101, nombre: "MERLUZA PINCHO 3KG", cantidad: "3.000", unidad: "kg", precio_unitario: "30.00", total: "90.00", producto_id: 10, factura_id: 1,
          facturas: { fecha: "2026-09-01", proveedor: "PESCADOS MARTA, S.L.", numero_documento: "F-100", tipo: "factura" } },
        { id: 104, nombre: "Merluza", cantidad: "3.000", unidad: "kg", precio_unitario: "28.00", total: "84.00", producto_id: 10, factura_id: 5,
          facturas: { fecha: "2026-08-30", proveedor: "PESCADOS MARTA, S.L.", numero_documento: "A-3", tipo: "albaran" } },
      ];
    }
    return [];
  });
}

function montar(onPreguntarIA = vi.fn(), modoPedido?: { modo: "documentos" | "productos" | "proveedores"; clave: string; doc?: number }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <div style={{ height: 800 }}>
        <TabCompras onPreguntarIA={onPreguntarIA} modoPedido={modoPedido} />
      </div>
    </QueryClientProvider>,
  );
  return onPreguntarIA;
}

const buscador = () => screen.getByLabelText("Buscar en compras");
const selector = () => screen.getByRole("group", { name: "Qué mirar" });
const modo = (nombre: RegExp) => within(selector()).getByRole("button", { name: nombre });
const cuenta = (nombre: RegExp) => modo(nombre).querySelector("span")?.textContent;
const listaDocs = () => screen.getByRole("list", { name: "Documentos" });
const numerosVisibles = () =>
  within(listaDocs())
    .getAllByRole("button")
    .map((b) => b.querySelector("[data-numero]")?.textContent);

beforeEach(() => {
  prepararBase();
});

describe("Compras · buscador único y selector con contadores", () => {
  it("«merluza»: 3 documentos · 2 productos · 1 proveedor, y el modo no cambia", async () => {
    montar();
    await screen.findByText("F-100");
    expect(modo(/^Documentos/)).toHaveAttribute("aria-pressed", "true");
    expect(cuenta(/^Documentos/)).toBe("5"); // sin texto: el total de cada modo
    fireEvent.change(buscador(), { target: { value: "merluza" } });
    await waitFor(() => expect(cuenta(/^Documentos/)).toBe("3"));
    expect(cuenta(/^Productos/)).toBe("2");
    expect(cuenta(/^Proveedores/)).toBe("1");
    expect(modo(/^Documentos/)).toHaveAttribute("aria-pressed", "true");
    // Los botones del selector miden 44 px de alto como mínimo.
    expect(modo(/^Productos/).className).toContain("min-h-11");
  });

  it("el mismo texto filtra la lista del modo que estés mirando", async () => {
    montar();
    await screen.findByText("F-100");
    fireEvent.change(buscador(), { target: { value: "merluza" } });
    await waitFor(() => expect(within(listaDocs()).getAllByRole("button")).toHaveLength(3));
    expect(within(listaDocs()).queryByText("F-101")).not.toBeInTheDocument();

    fireEvent.click(modo(/^Productos/));
    const lista = await screen.findByTestId("lista-productos");
    expect(within(lista).getByText("Merluza de pincho")).toBeInTheDocument();
    expect(within(lista).getByText("Merluza del Cantábrico")).toBeInTheDocument();
    expect(within(lista).queryByText("Vino tinto crianza")).not.toBeInTheDocument();
    // No hay un segundo buscador dentro de Productos.
    expect(screen.queryByLabelText("Buscar producto")).not.toBeInTheDocument();

    fireEvent.click(modo(/^Proveedores/));
    const provs = await screen.findByTestId("lista-proveedores-compras");
    expect(within(provs).getAllByRole("button")).toHaveLength(1);
    expect(within(provs).getByText("Pescados Marta S.L.")).toBeInTheDocument();
  });

  it("el botón de borrar la búsqueda la vacía", async () => {
    montar();
    await screen.findByText("F-100");
    fireEvent.change(buscador(), { target: { value: "zzz" } });
    expect(await screen.findByText("Ningún documento coincide")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Borrar la búsqueda" }));
    expect(await screen.findByText("F-100")).toBeInTheDocument();
    expect(buscador()).toHaveValue("");
  });
});

describe("Compras · enlace profundo a un documento (?doc=)", () => {
  it("abre la ficha del documento pedido, sin «Volver», aunque haya filtros que lo escondan", async () => {
    montar(vi.fn(), { modo: "documentos", clave: "k1", doc: 2 });
    expect(await screen.findByRole("heading", { name: "F-101" })).toBeInTheDocument();
    expect(modo(/^Documentos/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^Volver a/ })).not.toBeInTheDocument();
    expect(within(listaDocs()).getByText("F-101").closest("button")).toHaveAttribute("aria-current", "true");
  });

  it("deja a la vista la fila abierta (nearest) solo al llegar por el enlace o por un salto, no al hacer clic en la lista", async () => {
    const desplazar = vi.fn();
    Element.prototype.scrollIntoView = desplazar;
    montar(vi.fn(), { modo: "documentos", clave: "k3", doc: 2 });
    await screen.findByRole("heading", { name: "F-101" });
    await waitFor(() => expect(desplazar).toHaveBeenCalledTimes(1));
    expect(desplazar).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" }));
    expect(desplazar.mock.contexts[0]).toBe(within(listaDocs()).getByText("F-101").closest("button"));

    desplazar.mockClear();
    fireEvent.click(within(listaDocs()).getByText("F-100"));
    await screen.findByRole("heading", { name: "F-100" });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(desplazar).not.toHaveBeenCalled();
  });

  it("un documento que no existe no rompe nada", async () => {
    montar(vi.fn(), { modo: "documentos", clave: "k2", doc: 999 });
    expect(await screen.findByText("F-100")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "F-100" })).not.toBeInTheDocument();
  });
});

describe("Compras · chips por modo", () => {
  const chips = (nombre: string) => screen.getByRole("toolbar", { name: nombre });

  it("Documentos: Todo · Facturas · Albaranes · Albaranes sin factura · Con avisos · Sin revisar", async () => {
    montar();
    await screen.findByText("F-100");
    const barra = chips("Filtrar documentos");
    expect(within(barra).getAllByRole("button").map((b) => b.textContent?.replace(/\d+$/, "").trim())).toEqual([
      "Todo", "Facturas", "Albaranes", "Albaranes sin factura", "Con avisos", "Sin revisar",
    ]);
    // Chips compactos (32 px) con zona táctil de 44: contenedor h-11 y toque ampliado.
    expect(barra.className).toContain("h-11");
    for (const b of within(barra).getAllByRole("button")) {
      expect(b.className).toContain("h-8");
      expect(b.className).toContain("before:-inset-y-1.5");
    }

    fireEvent.click(within(barra).getByRole("button", { name: /^Albaranes sin factura/ }));
    expect(within(listaDocs()).getAllByRole("button")).toHaveLength(1);
    expect(within(listaDocs()).getByText("A-1")).toBeInTheDocument(); // A-2 y A-3 ya están facturados

    fireEvent.click(within(barra).getByRole("button", { name: /^Con avisos/ }));
    expect(within(listaDocs()).getAllByRole("button")).toHaveLength(1);
    expect(within(listaDocs()).getByText("F-101")).toBeInTheDocument();

    fireEvent.click(within(barra).getByRole("button", { name: /^Sin revisar/ }));
    expect(within(listaDocs()).queryByText("F-101")).not.toBeInTheDocument();
    expect(within(listaDocs()).getByText("F-100")).toBeInTheDocument();

    fireEvent.click(within(barra).getByRole("button", { name: /^Facturas/ }));
    expect(within(listaDocs()).getAllByRole("button")).toHaveLength(2);
    expect(numerosVisibles()).toEqual(["F-101", "F-100"]);
  });

  it("los chips cuentan lo que hay para el texto buscado", async () => {
    montar();
    await screen.findByText("F-100");
    fireEvent.change(buscador(), { target: { value: "merluza" } });
    const barra = chips("Filtrar documentos");
    await waitFor(() => expect(within(barra).getByRole("button", { name: /^Albaranes sin factura/ }).textContent).toMatch(/1$/));
    expect(within(barra).getByRole("button", { name: /^Con avisos/ }).textContent).toMatch(/0$/);
  });

  it("Productos: las categorías de siempre y «Subieron de precio»", async () => {
    montar();
    fireEvent.click(modo(/^Productos/));
    const lista = await screen.findByTestId("lista-productos");
    await within(lista).findByText("Merluza de pincho");
    const subieron = await screen.findByRole("button", { name: /Subieron de precio/ });
    expect(subieron.className).toContain("before:-inset-y-1.5"); // zona táctil de 44 px
    expect(subieron.className).toContain("h-8"); // una sola línea
    expect(subieron.textContent).toMatch(/1 producto/);
    fireEvent.click(subieron);
    await waitFor(() => expect(within(lista).queryByText("Vino tinto crianza")).not.toBeInTheDocument());
    expect(within(lista).getByText("Merluza de pincho")).toBeInTheDocument();
    expect(within(lista).queryByText("Merluza del Cantábrico")).not.toBeInTheDocument();
    expect(base.rpc).toHaveBeenCalledWith("variacion_precios_agente", expect.objectContaining({ p_sentido: "subidas", p_umbral_pct: 10 }));
    fireEvent.click(subieron);
    await within(lista).findByText("Vino tinto crianza");
  });

  it("Productos conserva sus herramientas: filtros, categorías, avisos de precio", async () => {
    montar();
    fireEvent.click(modo(/^Productos/));
    await screen.findByTestId("lista-productos");
    expect(screen.getByRole("button", { name: /Filtros/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Categorías/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Avisos de subida de precio" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    expect(await screen.findByLabelText("Periodo")).toBeInTheDocument();
    expect(screen.getByLabelText("Ordenar por")).toBeInTheDocument();
  });

  it("Proveedores: Todos · Con albaranes sin factura, y «Gestionar» abre el diálogo de siempre", async () => {
    montar();
    fireEvent.click(modo(/^Proveedores/));
    const provs = await screen.findByTestId("lista-proveedores-compras");
    expect(within(provs).getAllByRole("button")).toHaveLength(3);
    const barra = chips("Filtrar proveedores");
    fireEvent.click(within(barra).getByRole("button", { name: /^Con albaranes sin factura/ }));
    expect(within(provs).getAllByRole("button")).toHaveLength(1);
    expect(within(provs).getByText(/1 albarán sin factura/)).toBeInTheDocument();

    fireEvent.click(within(barra).getByRole("button", { name: /Gestionar/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByLabelText("Buscar proveedor")).toBeInTheDocument();
  });
});

describe("Compras · filas planas", () => {
  it("cada documento muestra una sola insignia (avisos > sin revisar > sin factura); el resto, en el tooltip", async () => {
    montar();
    await screen.findByText("F-100");
    const fila = (num: string) => within(listaDocs()).getByText(num).closest("button") as HTMLElement;
    // F-101: con avisos (y revisada) → solo «1 aviso».
    expect(fila("F-101")).toHaveTextContent("1 aviso");
    expect(fila("F-101")).not.toHaveTextContent("Sin revisar");
    // A-1: sin revisar y sin factura → solo «Sin revisar +1», con las dos en el tooltip.
    expect(fila("A-1")).toHaveTextContent("Sin revisar");
    expect(fila("A-1")).toHaveTextContent("+1");
    expect(fila("A-1")).not.toHaveTextContent("Sin factura");
    expect(fila("A-1")).toHaveAttribute("title", "Sin revisar · Sin factura");
    // El tipo va junto al número.
    expect(fila("F-100")).toHaveTextContent("F-100 · Factura");
  });

  it("la ficha tiene cabecera fija con «← Lista» y el nombre del elemento", async () => {
    montar();
    fireEvent.click(await screen.findByText("F-100"));
    const cabecera = await screen.findByTestId("cabecera-ficha");
    expect(within(cabecera).getByRole("button", { name: /Lista/ })).toBeInTheDocument();
    expect(cabecera).toHaveTextContent("F-100");
    fireEvent.click(within(cabecera).getByRole("button", { name: /Lista/ }));
    await waitFor(() => expect(screen.queryByTestId("ficha-compras")).not.toBeInTheDocument());
  });
});

describe("Compras · fichas", () => {
  it("documento: sus datos, los botones de siempre y sus líneas con enlace al producto", async () => {
    const onIA = montar();
    fireEvent.click(await screen.findByText("F-100"));
    const ficha = await screen.findByTestId("ficha-compras");
    expect(within(ficha).getByRole("heading", { name: "F-100" })).toBeInTheDocument();
    expect(within(ficha).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(ficha).getByRole("button", { name: /Ver original|original/ })).toBeDisabled(); // sin escaneo guardado
    expect(within(ficha).getByRole("button", { name: /Sin revisar/ })).toBeInTheDocument();
    fireEvent.click(within(ficha).getByRole("button", { name: /Preguntar a la IA/ }));
    expect(onIA).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "factura");
    expect(within(ficha).getByRole("button", { name: "Ver el producto Merluza de pincho" })).toBeInTheDocument();

    fireEvent.click(within(ficha).getByRole("button", { name: "Editar" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("albarán sin factura lo dice; albarán facturado enlaza con su factura", async () => {
    montar();
    fireEvent.click(await screen.findByText("A-1"));
    expect(await screen.findByText("Sin factura todavía")).toBeInTheDocument();
    fireEvent.click(screen.getByText("A-2"));
    const enlace = await screen.findByRole("button", { name: /Recogido en la factura F-101/ });
    fireEvent.click(enlace);
    expect(await screen.findByRole("heading", { name: "F-101" })).toBeInTheDocument();
  });

  it("producto → gráfica de precio y documentos donde aparece; al tocar uno salta y se puede volver", async () => {
    montar();
    fireEvent.click(modo(/^Productos/));
    const lista = await screen.findByTestId("lista-productos");
    fireEvent.click(await within(lista).findByText("Merluza de pincho"));

    const ficha = await screen.findByTestId("ficha-compras");
    expect(await within(ficha).findByRole("heading", { name: /Merluza de pincho/ })).toBeInTheDocument();
    expect(await within(ficha).findByRole("figure", { name: /evolución del precio de merluza de pincho/i })).toBeInTheDocument();
    expect(base.rpc).toHaveBeenCalledWith("serie_precios_agente", expect.objectContaining({ p_texto: "Merluza de pincho" }));
    expect(within(ficha).getByRole("button", { name: /Editar producto/ })).toBeInTheDocument();

    fireEvent.click(await within(ficha).findByRole("button", { name: "Abrir la factura F-100" }));
    expect(await screen.findByRole("heading", { name: "F-100" })).toBeInTheDocument();
    expect(modo(/^Documentos/)).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Volver a «Merluza de pincho»/ }));
    expect(await screen.findByRole("heading", { name: /Merluza de pincho/ })).toBeInTheDocument();
    expect(modo(/^Productos/)).toHaveAttribute("aria-pressed", "true");
  });

  it("de la línea de un documento al producto", async () => {
    montar();
    fireEvent.click(await screen.findByText("F-100"));
    fireEvent.click(await screen.findByRole("button", { name: "Ver el producto Merluza de pincho" }));
    expect(await screen.findByRole("figure", { name: /evolución del precio de merluza de pincho/i })).toBeInTheDocument();
    expect(modo(/^Productos/)).toHaveAttribute("aria-pressed", "true");
  });

  it("proveedor: ficha_proveedor_agente (qué le compras, cada cuánto, último pedido) y sus acciones", async () => {
    montar();
    fireEvent.click(modo(/^Proveedores/));
    const provs = await screen.findByTestId("lista-proveedores-compras");
    fireEvent.click(within(provs).getByText("Pescados Marta S.L."));
    const ficha = await screen.findByTestId("ficha-compras");
    expect(await within(ficha).findByText("Pide cada semana")).toBeInTheDocument();
    expect(base.rpc).toHaveBeenCalledWith("ficha_proveedor_agente", { p_texto: "Pescados Marta S.L." });
    expect(within(ficha).getByText("01/10/2026")).toBeInTheDocument();
    expect(within(ficha).getByRole("button", { name: "Ver el producto Merluza de pincho" })).toBeInTheDocument();
    expect(within(ficha).getByText(/Llega como/)).toHaveTextContent("PESCADOS MARTA, S.L.");
    // Las acciones de siempre sobre proveedores.
    expect(within(ficha).getByRole("button", { name: /Editar datos/ })).toBeInTheDocument();
    fireEvent.click(within(ficha).getByRole("button", { name: /Fusionar con otro proveedor/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("checkbox", { name: "Seleccionar Pescados Marta S.L." })).toBeChecked();
  });

  it("proveedor → documento y de ahí al proveedor otra vez", async () => {
    montar();
    fireEvent.click(await screen.findByText("F-100"));
    fireEvent.click(await within(screen.getByTestId("ficha-compras")).findByRole("button", { name: /PESCADOS MARTA, S\.L\./ }));
    expect(await screen.findByRole("heading", { name: /Pescados Marta S\.L\./ })).toBeInTheDocument();
    expect(modo(/^Proveedores/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(screen.getByTestId("ficha-compras")).getByRole("button", { name: "Abrir la factura F-100" }));
    expect(await screen.findByRole("heading", { name: "F-100" })).toBeInTheDocument();
  });
});
