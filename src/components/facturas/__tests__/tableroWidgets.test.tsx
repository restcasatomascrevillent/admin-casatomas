// Facturas › Análisis (06/11/2026): tablero tipo widgets.
//   · rejilla «bento» y tamaños (pequeño/mediano/grande);
//   · «Personalizar»: activar, quitar, reordenar, tamaño, restablecer y
//     guardar (localStorage y `dashboard_config` por usuario);
//   · ampliar una tarjeta (también con teclado) → detalle en grande con
//     filtros, orden, CSV y «Ver documentos»;
//   · cifras que nunca se cortan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

const doble = vi.hoisted(() => {
  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (!rpcs[fn]) return { data: null, error: { code: "PGRST202", message: `no function ${fn}` } };
    return { data: rpcs[fn](args), error: null };
  });
  const estado = {
    sesion: null as null | { user: { id: string } },
    filaConfig: null as null | Record<string, unknown>,
    upserts: [] as { fila: Record<string, unknown>; opciones: unknown }[],
    lecturasConfig: [] as string[][],
  };
  const respuesta = (tabla: string, llamadas: string[]) => {
    if (tabla === "dashboard_config") return llamadas.includes("upsert") ? null : estado.filaConfig;
    if (tabla === "proveedores") return [{ id: 300, nombre: "PROVEEDOR 1, S.L." }, { id: 301, nombre: "BODEGAS ÁVILA, S.A." }, { id: 302, nombre: "PESCADOS PACO" }];
    if (tabla === "categorias_producto") return [{ id: 2, nombre: "Pescado y marisco" }];
    return [];
  };
  const cadena = (tabla: string, llamadas: string[] = []): unknown =>
    new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            if (tabla === "dashboard_config" && !llamadas.includes("upsert")) estado.lecturasConfig.push(llamadas);
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: respuesta(tabla, llamadas), error: null }).then(ok, ko);
          }
          return (...args: unknown[]) => {
            if (prop === "upsert") estado.upserts.push({ fila: args[0] as Record<string, unknown>, opciones: args[1] });
            return cadena(tabla, [...llamadas, prop, ...(prop === "eq" ? [String(args[0]), String(args[1])] : [])]);
          };
        },
      },
    );
  const supabase = {
    from: (t: string) => cadena(t),
    rpc: (...a: unknown[]) => rpc(...(a as [string, Record<string, unknown>])),
    functions: { invoke: vi.fn() },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    auth: { getSession: async () => ({ data: { session: estado.sesion } }) },
  };
  return { supabase, rpc, rpcs, estado };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: doble.supabase }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChatFacturas } from "../ChatFacturas";
import { Cifra } from "../analisis/Cifra";
import { formasImporte } from "@/lib/facturas/cifras";
import { CONFIG_TABLERO_POR_DEFECTO } from "@/lib/facturas/widgetsTablero";

const TABLERO = {
  periodo: { desde: "2026-01-01", hasta: "2026-12-31", hasta_efectivo: "2026-11-05", local: null, anterior: null },
  sin_datos: false,
  indicadores: {
    gasto: 1362491.57, variacion_pct: null, documentos: 1884, facturas: 1844, albaranes_sin_factura: 40, albaranes_sin_factura_importe: 14915.34,
    abonos: -14376.94, abonos_n: 43, regalado: 28204.41, regalado_valia: 107581.24, regalado_estimadas: 0, proveedores: 245, retencion_irpf: 0,
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
      { producto: "PAN DE CRISTAL", nombre_normalizado: "pan de cristal", unidad: "ud", proveedor_id: 276, proveedor: "Panaderia Garcia, S.L.", precio_inicio: 1.4, precio_fin: 2.05, variacion_pct: 46.5, compras_inicio: 3, compras_fin: 3, importe: 2851.8 },
      { producto: "MERLUZA", nombre_normalizado: "merluza", unidad: "kg", proveedor_id: 302, proveedor: "PESCADOS PACO", precio_inicio: 10, precio_fin: 12, variacion_pct: 20, compras_inicio: 3, compras_fin: 3, importe: 900 },
    ],
  },
  familias: { importe_total: 100000, lineas: 100, sin_clasificar: { lineas: 0, importe: 0 }, familias: [{ id: 2, familia: "Pescado y marisco", importe: 81614.84, lineas: 459 }] },
  fijos: { ventana: { desde: "2026-01-01", hasta: "2026-11-05", meses_con_datos: 9 }, total_medio_mes: 4400, proveedores: [{ id: 398, nombre: "ACCIONA GREEN, S.L.U.", medio_mes: 3611.03, meses: 9, meses_con_datos: 9, documentos: 11 }] },
  abonos: [{ id: 377, nombre: "DISTRIBUCIONES CATRAL, S.L.", importe: -5716.71, documentos: 5 }],
  locales: { casa_tomas: { gasto: 1333190.24, documentos: 1857 }, touza: { gasto: 29301.33, documentos: 27 }, meses: [] },
};

const NOMBRES = ["PROVEEDOR 1, S.L.", "BODEGAS ÁVILA, S.A.", "PESCADOS PACO", "ZUMOS ZETA, S.L."];
const explorar = (a: Record<string, unknown>) => {
  const tiempo = ["dia", "semana", "mes", "trimestre"].includes(String(a.p_agrupar));
  return {
    parametros: { desde: a.p_desde, hasta: a.p_hasta, medida: a.p_medida, agrupar: a.p_agrupar, desglose: a.p_desglose, por_lineas: false, solo_productos: false, unidad: null },
    sin_datos: false,
    total: { valor: 100000, documentos: 40, lineas: null, variacion_pct: null },
    anterior: null,
    unidades: null,
    series: [],
    puntos: tiempo
      ? TABLERO.meses.map((m) => ({ clave: m.mes, etiqueta: m.mes, id: null, valor: m.total, documentos: m.documentos, desglose: null }))
      : NOMBRES.map((n, i) => ({ clave: String(300 + i), etiqueta: n, id: 300 + i, valor: [60000, 25000, 10000, 5000][i], documentos: 10 - i, desglose: null })),
    resto: tiempo ? null : { entidades: 3, valor: 1200, documentos: 3 },
  };
};
const DOCUMENTOS = { cifra: 100000, documentos: 0, importe_total: 0, desplazamiento: 0, filas: [] };
const llamadas = (fn: string) => doble.rpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1]);

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/facturas?tab=chat"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ChatFacturas />, { wrapper: envoltorio });
}

const tablero = () => screen.getByRole("region", { name: "Tablero de compras" });
/** Módulos en el orden en que salen (data-modulo de cada celda de la rejilla). */
const ordenModulos = () => [...tablero().querySelectorAll<HTMLElement>("[data-modulo]")].map((e) => e.dataset.modulo);
const celda = (id: string) => tablero().querySelector<HTMLElement>(`[data-modulo="${id}"]`);

/** Lo que hace el navegador con un <button> al pulsar Intro o Espacio (jsdom no lo hace). */
function pulsar(el: HTMLElement, tecla: "Enter" | " ") {
  el.focus();
  const sigue = fireEvent.keyDown(el, { key: tecla });
  if (sigue && el.tagName === "BUTTON") {
    if (tecla === "Enter") fireEvent.click(el);
    else if (fireEvent.keyUp(el, { key: tecla })) fireEvent.click(el);
  }
}

async function abrirPersonalizar() {
  fireEvent.click(screen.getByRole("button", { name: "Personalizar el tablero" }));
  return screen.findByRole("dialog", { name: "Personalizar el tablero" });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  for (const k of Object.keys(doble.rpcs)) delete doble.rpcs[k];
  doble.rpc.mockClear();
  doble.estado.sesion = null;
  doble.estado.filaConfig = null;
  doble.estado.upserts.length = 0;
  doble.estado.lecturasConfig.length = 0;
  toastMock.success.mockReset();
  toastMock.info.mockReset();
  doble.rpcs.tablero_compras = () => TABLERO;
  doble.rpcs.explorar_compras = explorar;
  doble.rpcs.documentos_de_cifra = () => DOCUMENTOS;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 5, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rejilla «bento» y tamaños", () => {
  it("por defecto: Explorar y detrás los 6 módulos pequeños, en una rejilla por el ancho del TABLERO", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    expect(ordenModulos()).toEqual(["proveedores", "subidas", "familias", "fijos", "abonos", "locales"]);
    const rejilla = screen.getByTestId("rejilla-modulos");
    // Container queries: la rejilla mira el ancho del tablero (que se estrecha con la IA), no el de la pantalla.
    expect(rejilla.className).toMatch(/@\[34rem\]\/tablero:grid-cols-2/);
    expect(rejilla.className).toMatch(/@\[60rem\]\/tablero:grid-cols-3/);
    expect(rejilla.className).toContain("[grid-auto-flow:row_dense]");
    expect(rejilla.closest(".\\@container\\/tablero")).not.toBeNull();
    expect(celda("proveedores")).toHaveAttribute("data-tamano", "s");
    expect(celda("proveedores")?.className).toContain("col-span-1");
    // Explorar va antes de la rejilla.
    const ex = screen.getByRole("region", { name: "Explorar" });
    expect(ex.compareDocumentPosition(rejilla) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("mediano = 2 columnas, grande = 3 (sin pasarse de las que hay); Explorar puede ir en medio", async () => {
    window.localStorage.setItem(
      "facturas-analisis-tablero",
      JSON.stringify({ cifras: ["gasto"], modulos: [{ id: "familias", tamano: "l" }, { id: "explorar" }, { id: "proveedores", tamano: "m" }, { id: "abonos", tamano: "s" }] }),
    );
    montar();
    await screen.findByText("1.362.491,57 €");
    expect(ordenModulos()).toEqual(["familias", "proveedores", "abonos"]);
    expect(celda("familias")?.className).toMatch(/col-span-1 .*@\[34rem\]\/tablero:col-span-2 .*@\[60rem\]\/tablero:col-span-3/);
    expect(celda("proveedores")?.className).toMatch(/col-span-1 .*@\[34rem\]\/tablero:col-span-2/);
    expect(celda("proveedores")?.className).not.toContain("col-span-3");
    // Dos rejillas: antes y después de Explorar.
    const [antes, despues] = screen.getAllByTestId("rejilla-modulos");
    const ex = screen.getByRole("region", { name: "Explorar" });
    expect(antes.compareDocumentPosition(ex) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ex.compareDocumentPosition(despues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Un módulo mediano enseña más filas (8): el de proveedores, los 7.
    const prov = within(tablero()).getByRole("region", { name: "Proveedores con más gasto" });
    expect(within(within(prov).getByRole("list", { name: "Proveedores por gasto" })).getAllByRole("button")).toHaveLength(7);
    // Solo la cifra elegida.
    expect(within(screen.getByLabelText("Indicadores del periodo")).getAllByRole("button")).toHaveLength(1);
  });
});

describe("Personalizar el tablero", () => {
  it("quitar, añadir, reordenar y cambiar el tamaño; nada se aplica hasta «Guardar»", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    const d = await abrirPersonalizar();
    const modulos = within(d).getByRole("list", { name: "Módulos, en orden" });
    // Quitar «Abonos por proveedor».
    fireEvent.click(within(modulos).getByRole("button", { name: "Quitar «Abonos por proveedor»" }));
    expect(within(modulos).queryByText("Abonos por proveedor")).not.toBeInTheDocument();
    // Añadir «Productos más comprados» y la cifra «Media al mes» desde el catálogo.
    fireEvent.click(within(d).getByRole("switch", { name: "Mostrar «Productos más comprados»" }));
    fireEvent.click(within(d).getByRole("switch", { name: "Mostrar «Media al mes»" }));
    // Subir «Lo que más ha subido» por encima de proveedores (con botones: también con teclado o dedo).
    pulsar(within(modulos).getByRole("button", { name: "Subir «Lo que más ha subido»" }), "Enter");
    // Tamaño mediano a «Gasto por familia».
    const tam = within(modulos).getByRole("group", { name: "Tamaño de «Gasto por familia»" });
    fireEvent.click(within(tam).getByRole("button", { name: /^Mediano/ }));
    expect(within(tam).getByRole("button", { name: /^Mediano/ })).toHaveAttribute("aria-pressed", "true");
    // Aún no ha cambiado el tablero.
    expect(ordenModulos()).toEqual(["proveedores", "subidas", "familias", "fijos", "abonos", "locales"]);

    fireEvent.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Personalizar el tablero" })).not.toBeInTheDocument());
    expect(ordenModulos()).toEqual(["subidas", "proveedores", "familias", "fijos", "locales", "productos"]);
    expect(celda("familias")).toHaveAttribute("data-tamano", "m");
    expect(within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Media al mes/ })).toBeInTheDocument();
    // El módulo nuevo pide sus datos (productos, base sin IVA).
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_medida: "base", p_agrupar: "producto" })));
    expect(await within(tablero()).findByRole("region", { name: "Productos más comprados" })).toBeInTheDocument();
    // Sin sesión se guarda en este navegador (y se dice).
    expect(toastMock.info).toHaveBeenCalledWith("Tablero guardado en este navegador", expect.anything());
    const guardada = JSON.parse(window.localStorage.getItem("facturas-analisis-tablero") ?? "null");
    expect(guardada.modulos.map((m: { id: string }) => m.id)).toEqual(["explorar", "subidas", "proveedores", "familias", "fijos", "locales", "productos"]);
  });

  it("se recuerda al volver; «Restablecer» deja el de siempre y «Cancelar» no cambia nada", async () => {
    window.localStorage.setItem("facturas-analisis-tablero", JSON.stringify({ cifras: ["abonos"], modulos: [{ id: "explorar" }, { id: "locales", tamano: "l" }] }));
    montar();
    await screen.findByText(/14\.376,94/);
    expect(ordenModulos()).toEqual(["locales"]);

    let d = await abrirPersonalizar();
    fireEvent.click(within(d).getByRole("button", { name: "Quitar «Casa Tomás y Touza»" }));
    fireEvent.click(within(d).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Personalizar el tablero" })).not.toBeInTheDocument());
    expect(ordenModulos()).toEqual(["locales"]);

    d = await abrirPersonalizar();
    fireEvent.click(within(d).getByRole("button", { name: "Restablecer el tablero de siempre" }));
    expect(within(d).getByRole("button", { name: "Restablecer el tablero de siempre" })).toBeDisabled();
    fireEvent.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(ordenModulos()).toEqual(["proveedores", "subidas", "familias", "fijos", "abonos", "locales"]));
    expect(within(screen.getByLabelText("Indicadores del periodo")).getAllByRole("button")).toHaveLength(4);
    expect(JSON.parse(window.localStorage.getItem("facturas-analisis-tablero") ?? "null")).toEqual(CONFIG_TABLERO_POR_DEFECTO);
  });

  it("«Explorar» se puede mover pero no quitar", async () => {
    montar();
    await screen.findByText("1.362.491,57 €");
    const d = await abrirPersonalizar();
    const modulos = within(d).getByRole("list", { name: "Módulos, en orden" });
    expect(within(modulos).queryByRole("button", { name: "Quitar «Explorar»" })).not.toBeInTheDocument();
    expect(within(modulos).queryByRole("group", { name: "Tamaño de «Explorar»" })).not.toBeInTheDocument();
    expect(within(d).queryByRole("switch", { name: "Mostrar «Explorar»" })).not.toBeInTheDocument();
    expect(within(modulos).getByRole("button", { name: "Arrastrar «Explorar»" })).toBeInTheDocument();
    fireEvent.click(within(modulos).getByRole("button", { name: "Bajar «Explorar»" }));
    fireEvent.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getAllByTestId("rejilla-modulos")).toHaveLength(2));
  });

  it("con sesión: lee y guarda la configuración del usuario en dashboard_config", async () => {
    doble.estado.sesion = { user: { id: "u-1" } };
    doble.estado.filaConfig = {
      widgets_activos: [{ tipo: "cifra", id: "documentos" }, { tipo: "modulo", id: "explorar", tamano: "l" }, { tipo: "modulo", id: "fijos", tamano: "m" }],
      orden_widgets: ["cifra:documentos", "modulo:explorar", "modulo:fijos"],
    };
    montar();
    await waitFor(() => expect(ordenModulos()).toEqual(["fijos"]));
    expect(celda("fijos")).toHaveAttribute("data-tamano", "m");
    expect(within(screen.getByLabelText("Indicadores del periodo")).getByRole("button", { name: /^Documentos1\.884/ })).toBeInTheDocument();
    // Solo SU fila: por usuario y vista.
    expect(doble.estado.lecturasConfig[0]).toEqual(expect.arrayContaining(["eq", "user_id", "u-1", "eq", "nombre_vista", "facturas_analisis"]));

    const d = await abrirPersonalizar();
    fireEvent.click(within(d).getByRole("switch", { name: "Mostrar «Abonos por proveedor»" }));
    fireEvent.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(doble.estado.upserts).toHaveLength(1));
    const { fila, opciones } = doble.estado.upserts[0];
    expect(opciones).toEqual({ onConflict: "user_id,nombre_vista" });
    expect(fila).toMatchObject({ user_id: "u-1", nombre_vista: "facturas_analisis" });
    expect(fila.orden_widgets).toEqual(["cifra:documentos", "modulo:explorar", "modulo:fijos", "modulo:abonos"]);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Tablero guardado en tu cuenta"));
    expect(JSON.parse(window.localStorage.getItem("facturas-analisis-tablero:u-1") ?? "null").modulos.at(-1)).toEqual({ id: "abonos", tamano: "s" });
  });
});

describe("«Evolución de un producto»", () => {
  it("se elige el producto en la propia tarjeta, se guarda y su detalle es el precio por proveedor", async () => {
    doble.rpcs.buscar_productos_texto_agente = () => [{ producto: "MERLUZA" }, { producto: "MERLUZA DE PINCHO" }];
    window.localStorage.setItem("facturas-analisis-tablero", JSON.stringify({ cifras: ["gasto"], modulos: [{ id: "explorar" }, { id: "precio_producto", tamano: "m" }] }));
    montar();
    const tarjeta = await screen.findByRole("region", { name: "Evolución de un producto" });
    // Sin producto no hay nada que ampliar.
    expect(within(tarjeta).queryByRole("button", { name: /^Ampliar/ })).not.toBeInTheDocument();
    fireEvent.change(within(tarjeta).getByLabelText("Producto"), { target: { value: "merl" } });
    fireEvent.click(await within(tarjeta).findByRole("button", { name: "MERLUZA DE PINCHO" }));
    const conProducto = await screen.findByRole("region", { name: "Precio de Merluza de pincho" });
    await waitFor(() =>
      expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_medida: "precio", p_agrupar: "mes", p_desglose: "proveedor", p_filtros: { productos: ["MERLUZA DE PINCHO"] } })),
    );
    expect(JSON.parse(window.localStorage.getItem("facturas-analisis-tablero") ?? "null").modulos[1]).toEqual({ id: "precio_producto", tamano: "m", producto: "MERLUZA DE PINCHO" });
    fireEvent.click(within(conProducto).getByRole("button", { name: "Ampliar: Precio de Merluza de pincho" }));
    expect(await screen.findByRole("dialog", { name: "Precio de Merluza de pincho" })).toBeInTheDocument();
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_medida: "precio", p_top: 8, p_filtros: { productos: ["MERLUZA DE PINCHO"] } })));
  });
});

describe("detalle en grande de un módulo", () => {
  it("se abre con el teclado desde la cabecera de la tarjeta y, al cerrar, el foco vuelve a ella", async () => {
    montar();
    const tarjeta = await screen.findByRole("region", { name: "Proveedores con más gasto" });
    const ampliar = within(tarjeta).getByRole("button", { name: "Ampliar: Proveedores con más gasto" });
    expect(ampliar.tagName).toBe("BUTTON");
    expect(ampliar).toHaveAttribute("aria-haspopup", "dialog");
    pulsar(ampliar, " ");
    const dialogo = await screen.findByRole("dialog", { name: "Proveedores con más gasto" });
    expect(dialogo).toHaveAccessibleDescription(/1 ene – 31 dic 2026 · los dos locales · con IVA/);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Proveedores con más gasto" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(ampliar);
  });

  it("proveedores: tabla ordenable y filtros (periodo, local, IVA, buscador, importe, proveedor), CSV y documentos", async () => {
    montar();
    const tarjeta = await screen.findByRole("region", { name: "Proveedores con más gasto" });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Ampliar: Proveedores con más gasto" }));
    const d = await screen.findByRole("dialog", { name: "Proveedores con más gasto" });
    // Pide los 50 primeros, con IVA, con el periodo y el local del tablero.
    await waitFor(() =>
      expect(llamadas("explorar_compras")).toContainEqual({ p_desde: "2026-01-01", p_hasta: "2026-12-31", p_medida: "gasto", p_agrupar: "proveedor", p_desglose: null, p_filtros: {}, p_top: 50 }),
    );
    const tabla = await within(d).findByRole("table");
    const nombres = () => within(tabla).getAllByRole("rowheader").map((r) => r.textContent);
    expect(nombres()).toEqual(["Proveedor 1", "Bodegas Ávila", "Pescados Paco", "Zumos Zeta"]);
    expect(d).toHaveTextContent(/se ven las 4 primeras; 3 más suman 1\.200,00\s€/);

    // Ordenar por nombre (aria-sort).
    fireEvent.click(within(tabla).getByRole("button", { name: /^Proveedor/ }));
    expect(within(tabla).getByRole("columnheader", { name: /^Proveedor/ })).toHaveAttribute("aria-sort", "ascending");
    expect(nombres()).toEqual(["Bodegas Ávila", "Pescados Paco", "Proveedor 1", "Zumos Zeta"]);
    fireEvent.click(within(tabla).getByRole("button", { name: /^Gasto con IVA/ }));
    expect(within(tabla).getByRole("columnheader", { name: /^Gasto con IVA/ })).toHaveAttribute("aria-sort", "descending");
    expect(nombres()[0]).toBe("Proveedor 1");

    // Buscador sin tildes.
    fireEvent.change(within(d).getByRole("searchbox", { name: "Buscar proveedor" }), { target: { value: "avila" } });
    expect(nombres()).toEqual(["Bodegas Ávila"]);
    fireEvent.change(within(d).getByRole("searchbox", { name: "Buscar proveedor" }), { target: { value: "" } });

    // Rango de importe.
    fireEvent.click(within(d).getByRole("button", { name: "Filtrar por importe" }));
    const rango = await screen.findByRole("dialog", { name: "Rango de importe" });
    fireEvent.change(within(rango).getByLabelText("Desde"), { target: { value: "10.000" } });
    expect(nombres()).toEqual(["Proveedor 1", "Bodegas Ávila", "Pescados Paco"]);
    fireEvent.keyDown(rango, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rango de importe" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Proveedores con más gasto" })).toBeInTheDocument();
    expect(within(d).getByRole("list", { name: "Filtros aplicados" })).toHaveTextContent(/Importe desde 10\.000,00\s€/);

    // Sin IVA, Touza y el mes: nueva consulta.
    fireEvent.click(within(within(d).getByRole("group", { name: "IVA" })).getByRole("button", { name: "Sin IVA" }));
    fireEvent.click(within(within(d).getByRole("group", { name: "Local" })).getByRole("button", { name: "Touza" }));
    fireEvent.click(within(within(d).getByRole("group", { name: "Periodo" })).getByRole("button", { name: "Mes" }));
    await waitFor(() =>
      expect(llamadas("explorar_compras")).toContainEqual(
        expect.objectContaining({ p_desde: "2026-11-01", p_hasta: "2026-11-30", p_medida: "base", p_agrupar: "proveedor", p_filtros: { local: "touza" } }),
      ),
    );
    // El tablero sigue con lo suyo (el detalle no cambia el periodo de fuera).
    const [barra] = screen.getAllByRole("group", { name: "Periodo", hidden: true });
    expect(d.contains(barra)).toBe(false);
    expect(within(barra).getByRole("button", { name: "Año 2026", hidden: true })).toHaveAttribute("aria-pressed", "true");

    // Proveedor (en la RPC).
    fireEvent.click(within(d).getByRole("button", { name: "Filtrar por proveedor" }));
    const lista = await screen.findByRole("list", { name: "Proveedores" });
    fireEvent.click(await within(lista).findByRole("checkbox", { name: "Pescados Paco" }));
    expect(within(lista).getByRole("checkbox", { name: "Pescados Paco" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(llamadas("explorar_compras")).toContainEqual(expect.objectContaining({ p_filtros: { local: "touza", proveedores: [302] } })));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    // CSV con lo que se ve.
    const blobs: Blob[] = [];
    const crear = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:x";
    });
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(within(d).getByRole("button", { name: "Exportar CSV" }));
    expect(clic).toHaveBeenCalled();
    const csv = await blobs[0].text();
    expect(csv).toContain("# Proveedores con más gasto · 1 – 30 nov 2026 · Touza");
    expect(csv).toContain("Proveedor;Base sin IVA;% del total;Documentos");
    expect(csv).not.toContain("ZUMOS ZETA");
    clic.mockRestore();

    // «Ver documentos» de todo lo filtrado.
    fireEvent.click(within(d).getByRole("button", { name: "Ver documentos" }));
    await waitFor(() =>
      expect(llamadas("documentos_de_cifra")).toContainEqual(expect.objectContaining({ p_desde: "2026-11-01", p_medida: "base", p_filtros: { proveedores: [302], local: "touza" } })),
    );
  });

  it("lo que más ha subido: filas del tablero, buscador y proveedor en el navegador", async () => {
    montar();
    const tarjeta = await screen.findByRole("region", { name: "Lo que más ha subido" });
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Ampliar: Lo que más ha subido" }));
    const d = await screen.findByRole("dialog", { name: "Lo que más ha subido" });
    const tabla = await within(d).findByRole("table");
    expect(within(tabla).getAllByRole("rowheader").map((r) => r.textContent)).toEqual(["PAN DE CRISTAL", "MERLUZA"]);
    expect(within(tabla).getAllByRole("row")[1]).toHaveTextContent(/\+46,5 %/);
    fireEvent.change(within(d).getByRole("searchbox"), { target: { value: "paco" } });
    expect(within(tabla).getAllByRole("rowheader").map((r) => r.textContent)).toEqual(["MERLUZA"]);
    fireEvent.change(within(d).getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(within(d).getByRole("button", { name: "Filtrar por proveedor" }));
    fireEvent.click(await within(await screen.findByRole("list", { name: "Proveedores" })).findByRole("checkbox", { name: "Pescados Paco" }));
    await waitFor(() => expect(within(tabla).getAllByRole("rowheader").map((r) => r.textContent)).toEqual(["MERLUZA"]));
    // Sin explorar_compras: los datos son los del tablero.
    expect(llamadas("explorar_compras").some((a) => a.p_top === 50)).toBe(false);
  });
});

describe("cifras que nunca se cortan", () => {
  const original = {
    RO: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
    canvas: HTMLCanvasElement.prototype.getContext,
    ancho: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  };
  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original.RO;
    HTMLCanvasElement.prototype.getContext = original.canvas;
    if (original.ancho) Object.defineProperty(HTMLElement.prototype, "clientWidth", original.ancho);
  });

  /** Sitio de `ancho` px y una letra de 10 px por carácter. */
  function conSitio(ancho: number) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    HTMLCanvasElement.prototype.getContext = (() => ({ font: "", measureText: (t: string) => ({ width: t.length * 10 }) })) as never;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => ancho });
  }

  it("si cabe, la cifra entera y nada más", () => {
    conSitio(400);
    const { container } = render(<Cifra formas={formasImporte(1362491.57)} />);
    expect(container.textContent).toBe("1.362.491,57 €");
    expect(container.firstElementChild).not.toHaveAttribute("title");
  });

  it("si no cabe, sin céntimos; si tampoco, «1,36 M €»: la completa en el globo y para el lector de pantalla", () => {
    conSitio(120);
    const { container, unmount } = render(<Cifra formas={formasImporte(1362491.57)} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.querySelector("[aria-hidden='true']")?.textContent).toBe("1.362.492 €");
    expect(el).toHaveAttribute("title", "1.362.491,57 €");
    expect(el.querySelector(".sr-only")?.textContent).toBe("1.362.491,57 €");
    unmount();

    conSitio(90);
    const r = render(<Cifra formas={formasImporte(1362491.57)} />);
    const el2 = r.container.firstElementChild as HTMLElement;
    expect(el2.querySelector("[aria-hidden='true']")?.textContent).toBe("1,36 M €");
    expect(el2).toHaveAttribute("data-cifra-abreviada", "true");
    // Nunca se corta con «…».
    expect(el2.className).not.toContain("truncate");
  });

  it("los indicadores del tablero usan esas cifras (y siguen siendo botones con su nombre)", async () => {
    conSitio(90);
    montar();
    const ind = await screen.findByLabelText("Indicadores del periodo");
    const gasto = await within(ind).findByRole("button", { name: /^Gasto con IVA.*1\.362\.491,57\s€/ });
    await waitFor(() => expect(gasto.querySelector("[title]")).toHaveAttribute("title", "1.362.491,57 €"));
    act(() => undefined);
  });
});
