// Preguntas rápidas del chat de facturas (sin IA): cada botón llama a su RPC
// con los argumentos correctos, pinta el resultado (con sus avisos) y NUNCA
// llama a la Edge Function chat-facturas ni guarda nada en el historial.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ─── Doble de supabase ───────────────────────────────────────────────────────
const doble = vi.hoisted(() => {
  const rpc = vi.fn();
  const invoke = vi.fn();
  const inserts: { tabla: string; fila: unknown }[] = [];
  /** Filas de configuracion_facturas (vacía = migración sin aplicar). */
  const config = { filas: [] as unknown[] };
  const respuestaTabla = (tabla: string, llamadas: string[]) => {
    if (tabla === "configuracion_facturas") return config.filas;
    if (tabla === "chat_facturas_conversaciones" && llamadas.includes("insert"))
      return { id: "c1", session_id: "s1", titulo: "Nueva conversación", created_at: "", updated_at: "" };
    if (tabla === "chat_facturas_mensajes" && llamadas.includes("insert"))
      return { id: crypto.randomUUID(), created_at: new Date().toISOString() };
    return [];
  };
  const cadena = (tabla: string, llamadas: string[] = []): unknown =>
    new Proxy(
      {},
      {
        get(_o, prop: string) {
          if (prop === "then") {
            const res = { data: respuestaTabla(tabla, llamadas), error: null };
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko);
          }
          return (...args: unknown[]) => {
            if (prop === "insert") inserts.push({ tabla, fila: args[0] });
            return cadena(tabla, [...llamadas, prop]);
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
  return { supabase, rpc, invoke, inserts, config };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: doble.supabase }));
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChatFacturas } from "../ChatFacturas";
import {
  formatEuros,
  formatFechaEs,
  formatMesEs,
  rangoAnioActual,
  rangosGastoMes,
  rangoUltimos12Meses,
  ultimos12Meses,
} from "@/lib/facturas/preguntasRapidas";
import { LIMITE_DOCUMENTOS, LIMITE_PRODUCTOS, PREGUNTAS_RAPIDAS } from "../preguntas-rapidas/catalogo";
import type { Factura } from "@/hooks/useFacturas";

// ─── Datos de ejemplo (forma real de las RPC, 07/10/2026) ────────────────────
const RESUMEN_OCTUBRE = {
  periodo: { desde: "2026-10-01", hasta: "2026-10-31" },
  facturas: {
    n: 2,
    gasto: 1234.56,
    base: 1020.3,
    iva: 214.26,
    si_das_importes: {
      sin_total: { n: 1, docs: [{ id: 39, tipo: "factura", numero: "F / 25011959", proveedor: "Salazones Garre", fecha: "2026-10-02" }] },
      deducidos: { n: 1, docs: [{ id: 54, numero: "ML/101511", proveedor: "LUGA SABORES S.L.", fecha: "2026-10-03", iva_conocido: false }] },
    },
  },
  albaranes: { n: 1, valor: 315.66 },
  con_alertas: [
    { id: 52, numero: "1 - 701405", proveedor: "GRUPO INSULA ROMA S.L.", alertas: [{ codigo: "fecha_ausente", mensaje: "Sin fecha impresa" }] },
  ],
  proveedores: [{ proveedor: "Osborne", facturas: 1, gasto: 1234.56 }],
  total_proveedores: 1,
};
const RESUMEN_SEPTIEMBRE = {
  periodo: { desde: "2026-09-01", hasta: "2026-09-30" },
  facturas: { n: 1, gasto: 1000, base: 826.45, iva: 173.55 },
  albaranes: { n: 0, valor: 0 },
};
const ESTADISTICAS = {
  meses: [
    { mes: "2025-09", facturas: 3, gasto: 999.99 }, // fuera de la ventana de 12 meses
    { mes: "2025-12", facturas: 5, gasto: 10219.52, sin_total: 1, deducidos: 1, albaranes: 5 },
    { mes: "2026-09", facturas: 1, gasto: 15141.34, fecha_dudosa: 1 },
  ],
};
const RANKING_PROVEEDORES = {
  criterio: "Gasto por proveedor",
  orden: "desc",
  filas: [
    { proveedor: "GRUPO INSULA ROMA S.L.", documentos: 1, importe: 15141.34 },
    { proveedor: "Salazones Garre", documentos: 2, importe: 512.4, sin_total: 1 },
  ],
  total_filas: 2,
  truncado: false,
  documentos_sin_total: { n: 1, docs: [{ id: 39, numero: "F / 25011959", proveedor: "Salazones Garre", fecha: "2025-12-24" }] },
};
const RANKING_PRODUCTOS = {
  criterio: "Cantidad",
  orden: "desc",
  filas: [
    { producto: "LIMON FINO", cantidad: 53.5, unidad: "kg", veces: 1, importe: 61.53 },
    { producto: "EL PUNTIDO 2022", cantidad: 1200, unidad: "ud", veces: 3, importe: 1365.75 },
  ],
  total_filas: 2,
  truncado: false,
  servicios_excluidos: { n: 6, nombres: ["TRABAJOS"] },
};
const DOCS_CON_AVISOS = {
  criterio: "filtro=con_alertas",
  filas: [
    {
      id: 52,
      tipo: "factura",
      numero: "1 - 701405",
      proveedor: "GRUPO INSULA ROMA S.L.",
      fecha: "2026-09-28",
      total: 15141.34,
      fecha_dudosa: true,
      alertas: [{ codigo: "fecha_ausente", mensaje: "El documento no trae ninguna fecha impresa." }],
    },
    { id: 39, tipo: "factura", numero: "F / 25011959", proveedor: "Salazones Garre", fecha: "2025-12-24", sin_total: true },
  ],
  total_filas: 2,
  truncado: false,
  sumas: { facturas: { n: 2 } },
};

const GASTO_CATEGORIAS = {
  periodo: { desde: "2026-01-01", hasta: "2026-10-07" },
  total: { importe: 13292.4, lineas: 40, documentos: 12 },
  categorias: [
    { categoria: "Frutas y verduras", importe: 300, pct: 2.3, lineas: 5 },
    {
      categoria: "Bebidas",
      importe: 12792.4,
      pct: 96.2,
      lineas: 30,
      sub: [
        { categoria: "Vinos", importe: 12000, lineas: 20 },
        { categoria: "Refrescos y aguas", importe: 792.4, lineas: 10 },
      ],
    },
  ],
  sin_categoria: { importe: 200, lineas: 5 },
  sin_clasificar: { lineas: 3, importe: 436.92 },
  avisos: { sin_importe: 2, albaranes_ya_facturados: 4 },
  nota: "Importes de linea: base SIN IVA.",
};
const VARIACION_PRECIOS = {
  umbral_pct: 15,
  productos: [
    {
      producto: "Helado frambuesa",
      unidad: "ud",
      precio: 36,
      fecha: "2026-10-03",
      proveedor: "Racionalismo Dulce",
      variacion_pct: 12.5,
      ref_precio: 32,
      ref_compras: 1,
      ref_desde: "2026-06-01",
      pocas_compras: true,
      ref_antigua: true,
    },
    {
      producto: "Merluza",
      unidad: "kg",
      precio: 12.9,
      proveedor: "Flope",
      variacion_pct: 20,
      ref_precio: 10.75,
      ref_compras: 3,
      ref_proveedor: "Pescados Paco",
      cambio_proveedor: true,
    },
  ],
  total_productos: 2,
  comparados: 14,
  avisos: { sin_referencia: 30 },
};

function responderRpc(fn: string, args?: Record<string, unknown>) {
  switch (fn) {
    case "resumen_periodo_agente":
      return args?.p_desde === "2026-10-01" ? RESUMEN_OCTUBRE : RESUMEN_SEPTIEMBRE;
    case "estadisticas_globales_agente":
      return ESTADISTICAS;
    case "ranking_agente":
      return args?.p_criterio === "gasto_proveedor" ? RANKING_PROVEEDORES : RANKING_PRODUCTOS;
    case "filtrar_documentos_agente":
      return DOCS_CON_AVISOS;
    case "gasto_categorias_agente":
      return GASTO_CATEGORIAS;
    case "variacion_precios_agente":
      return VARIACION_PRECIOS;
    default:
      return { error: `RPC desconocida ${fn}` };
  }
}

// ─── Montaje ─────────────────────────────────────────────────────────────────
// 07/10/2026 12:00 en Madrid.
const AHORA = new Date("2026-10-07T10:00:00Z");

const FACTURA_52: Factura = {
  id: 52,
  tipo: "factura",
  numero_documento: "1 - 701405",
  proveedor: "GRUPO INSULA ROMA S.L.",
  cif: null,
  fecha: "2026-09-28",
  subtotal: 12513.5,
  iva: 2627.84,
  total: 15141.34,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  drive_url: null,
  archivo_path: null,
  alertas: [],
} as unknown as Factura;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["facturas"], [FACTURA_52]);
  qc.setQueryData(["albaranes"], []);
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ChatFacturas />, { wrapper: envoltorio });
}

const barra = () => screen.getByRole("group", { name: /al instante, sin ia/i });
const boton = (nombre: RegExp) => within(barra()).getByRole("button", { name: nombre });

beforeEach(() => {
  // jsdom no implementa scrollIntoView (ChatArea baja al último mensaje).
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  doble.rpc.mockReset();
  doble.rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => ({
    data: responderRpc(fn, args),
    error: null,
  }));
  doble.invoke.mockReset();
  doble.invoke.mockResolvedValue({ data: { respuesta: "Respuesta de la IA" }, error: null });
  doble.inserts.length = 0;
  doble.config.filas = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Fechas y formato ────────────────────────────────────────────────────────
describe("fechas en Europe/Madrid", () => {
  it("mes actual y anterior a partir del día de Madrid, no del UTC", () => {
    // 31/10 23:30 UTC = 1/11 00:30 en Madrid (CET).
    const r = rangosGastoMes(new Date("2026-10-31T23:30:00Z"));
    expect(r.actual).toMatchObject({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(r.anterior).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-31" });
  });

  it("cruce de año y horario de verano", () => {
    const enero = rangosGastoMes(new Date("2025-12-31T23:30:00Z"));
    expect(enero.actual).toMatchObject({ desde: "2026-01-01", hasta: "2026-01-31" });
    expect(enero.anterior).toMatchObject({ desde: "2025-12-01", hasta: "2025-12-31" });
    // 30/06 22:30 UTC = 1/07 00:30 en Madrid (CEST, +2).
    expect(rangosGastoMes(new Date("2026-06-30T22:30:00Z")).actual.desde).toBe("2026-07-01");
    // Febrero bisiesto.
    expect(rangosGastoMes(new Date("2028-03-10T10:00:00Z")).anterior.hasta).toBe("2028-02-29");
  });

  it("año y últimos 12 meses", () => {
    expect(rangoAnioActual(new Date("2025-12-31T23:30:00Z"))).toMatchObject({ desde: "2026-01-01", hasta: "2026-12-31" });
    const meses = ultimos12Meses(AHORA);
    expect(meses).toHaveLength(12);
    expect(meses[0]).toBe("2025-11");
    expect(meses[11]).toBe("2026-10");
    expect(rangoUltimos12Meses(AHORA)).toEqual({ desde: "2025-11-01", hasta: "2026-10-31" });
  });

  it("formato es-ES de importes, fechas y meses", () => {
    expect(formatEuros(1234.56)).toBe("1.234,56 €");
    expect(formatEuros(15141.3)).toBe("15.141,30 €");
    expect(formatEuros(-0.004)).toBe("0,00 €");
    expect(formatEuros(-1234567.891)).toBe("-1.234.567,89 €");
    expect(formatFechaEs("2026-10-03")).toBe("03/10/2026");
    expect(formatMesEs("2026-10")).toBe("octubre 2026");
    expect(formatMesEs("2025-09", true)).toBe("sep 2025");
  });
});

// ─── Botones → RPC ───────────────────────────────────────────────────────────
describe("cada botón llama a su RPC con sus argumentos", () => {
  it("Gasto este mes: resumen_periodo_agente del mes actual y del anterior", async () => {
    montar();
    fireEvent.click(boton(/gasto este mes/i));
    await screen.findByText(/diferencia en facturas/i);
    expect(doble.rpc).toHaveBeenCalledTimes(2);
    expect(doble.rpc).toHaveBeenCalledWith("resumen_periodo_agente", { p_desde: "2026-10-01", p_hasta: "2026-10-31" });
    expect(doble.rpc).toHaveBeenCalledWith("resumen_periodo_agente", { p_desde: "2026-09-01", p_hasta: "2026-09-30" });
  });

  it("Gasto por mes: estadisticas_globales_agente sin argumentos", async () => {
    montar();
    fireEvent.click(boton(/gasto por mes/i));
    await screen.findByText(/total 12 meses/i);
    expect(doble.rpc).toHaveBeenCalledTimes(1);
    expect(doble.rpc).toHaveBeenCalledWith("estadisticas_globales_agente", undefined);
  });

  it("Top proveedores: ranking_agente gasto_proveedor de este año", async () => {
    montar();
    fireEvent.click(boton(/top proveedores/i));
    await screen.findByText("GRUPO INSULA ROMA S.L.");
    expect(doble.rpc).toHaveBeenCalledWith("ranking_agente", {
      p_criterio: "gasto_proveedor",
      p_tipo: "factura",
      p_limite: 10,
      p_desde: "2026-01-01",
      p_hasta: "2026-12-31",
      p_orden: "desc",
    });
  });

  it("Productos más comprados: ranking_agente cantidad sin servicios, últimos 12 meses", async () => {
    montar();
    fireEvent.click(boton(/productos más comprados/i));
    await screen.findByText("LIMON FINO");
    expect(doble.rpc).toHaveBeenCalledWith("ranking_agente", {
      p_criterio: "cantidad",
      p_limite: LIMITE_PRODUCTOS,
      p_desde: "2025-11-01",
      p_hasta: "2026-10-31",
      p_orden: "desc",
      p_incluir_servicios: false,
    });
  });

  it.each([
    [/por revisar/i, "sin_verificar"],
    [/con avisos/i, "con_alertas"],
    [/sin total/i, "sin_total"],
  ])("%s: filtrar_documentos_agente con filtro %s", async (nombre, filtro) => {
    montar();
    fireEvent.click(boton(nombre));
    await screen.findByText(/2 documentos/);
    expect(doble.rpc).toHaveBeenCalledWith("filtrar_documentos_agente", {
      p_filtro: filtro,
      p_orden: "fecha_desc",
      p_limite: LIMITE_DOCUMENTOS,
    });
  });

  it("Gasto por categoría: gasto_categorias_agente del 1 de enero a hoy", async () => {
    montar();
    fireEvent.click(boton(/gasto por categoría/i));
    await screen.findByText("Bebidas");
    expect(doble.rpc).toHaveBeenCalledWith("gasto_categorias_agente", {
      p_categoria: null,
      p_desde: "2026-01-01",
      p_hasta: "2026-10-07",
      p_tipo: null,
      p_agrupar: null,
    });
  });

  it("Qué ha subido de precio: variacion_precios_agente con el umbral de configuracion_facturas", async () => {
    doble.config.filas = [{ umbral_subida_precio_pct: 15 }];
    montar();
    fireEvent.click(boton(/qué ha subido de precio/i));
    await screen.findByText("Merluza");
    expect(doble.rpc).toHaveBeenCalledWith("variacion_precios_agente", {
      p_desde: null,
      p_hasta: null,
      p_umbral_pct: 15,
      p_categoria: null,
      p_producto: null,
      p_limite: 10,
      p_sentido: "subidas",
    });
  });

  it("Qué ha subido de precio: sin configuración legible usa el 10 %", async () => {
    montar();
    fireEvent.click(boton(/qué ha subido de precio/i));
    await screen.findByText("Merluza");
    expect(doble.rpc).toHaveBeenCalledWith("variacion_precios_agente", expect.objectContaining({ p_umbral_pct: 10 }));
  });

  it("si la RPC aún no existe (migración sin aplicar), lo dice y apaga el botón", async () => {
    doble.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    montar();
    fireEvent.click(boton(/gasto por categoría/i));
    const tarjeta = await screen.findByRole("region", { name: /gasto por categoría/i });
    expect(
      await within(tarjeta).findByText(/pendiente de actualizar la base de datos/i),
    ).toBeInTheDocument();
    expect(within(tarjeta).queryByRole("alert")).not.toBeInTheDocument();
    const b = boton(/gasto por categoría/i);
    expect(b).toBeDisabled();
    expect(b).toHaveTextContent(/pendiente/i);
    // El resto sigue funcionando.
    expect(boton(/top proveedores/i)).toBeEnabled();
  });

  it("42883 (función inexistente en Postgres) también cuenta como no disponible", async () => {
    doble.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function does not exist" } });
    montar();
    fireEvent.click(boton(/qué ha subido de precio/i));
    expect(await screen.findByText(/pendiente de actualizar la base de datos/i)).toBeInTheDocument();
  });

  it("el catálogo es una lista: cada entrada activa tiene consulta y pintado", () => {
    expect(PREGUNTAS_RAPIDAS).toHaveLength(10);
    for (const p of PREGUNTAS_RAPIDAS) {
      if (p.proximamente) continue;
      expect(typeof p.consultar).toBe("function");
      expect(p.Resultado).toBeTruthy();
      expect(p.rpc).toMatch(/_agente$/);
    }
  });
});

// ─── Pintado con datos y avisos ──────────────────────────────────────────────
// (getByText normaliza el espacio duro de «1.234,56 €» a un espacio normal.)
describe("pintado del resultado", () => {
  it("Gasto este mes: importes es-ES, comparación y avisos de cifra parcial", async () => {
    montar();
    fireEvent.click(boton(/gasto este mes/i));
    const tarjeta = await screen.findByRole("region", { name: /gasto este mes/i });
    await within(tarjeta).findByText(/diferencia en facturas/i);
    const t = within(tarjeta);
    expect(t.getByText("Octubre 2026")).toBeInTheDocument();
    expect(t.getByText("Septiembre 2026")).toBeInTheDocument();
    expect(t.getAllByText("1.234,56 €").length).toBeGreaterThan(0);
    expect(t.getByText("+234,56 €")).toBeInTheDocument();
    expect(t.getByText(/\+23,5 %/)).toBeInTheDocument();
    expect(t.getByText(/cifra parcial: 1 factura sin total/i)).toBeInTheDocument();
    expect(t.getByText(/1 sin IVA: el importe real es mayor/i)).toBeInTheDocument();
    expect(t.getByText(/1 documento con fecha dudosa/i)).toBeInTheDocument();
    expect(t.getByText(/al instante, sin IA/i)).toBeInTheDocument();
  });

  it("Gasto por mes: 12 meses con año, huecos como «sin documentos» y fuera de ventana excluido", async () => {
    montar();
    fireEvent.click(boton(/gasto por mes/i));
    const tarjeta = await screen.findByRole("region", { name: /gasto por mes/i });
    const t = within(await within(tarjeta).findByRole("table"));
    expect(t.getAllByRole("row")).toHaveLength(1 + 12 + 1); // cabecera + 12 meses + total
    expect(t.getByText("Dic 2025")).toBeInTheDocument();
    expect(t.queryByText("Sep 2025")).not.toBeInTheDocument();
    expect(t.getAllByText(/sin documentos cargados/i)).toHaveLength(10);
    expect(t.getByText("25.360,86 €")).toBeInTheDocument(); // 10219,52 + 15141,34
    expect(t.getByText(/1 sin total · 1 deducido/)).toBeInTheDocument();
  });

  it("Top proveedores: filas y aviso de documentos sin total", async () => {
    montar();
    fireEvent.click(boton(/top proveedores/i));
    const tarjeta = await screen.findByRole("region", { name: /top proveedores/i });
    const t = within(tarjeta);
    await t.findByText("15.141,34 €");
    expect(t.getByText(/cifra parcial: 1 factura sin total/i)).toBeInTheDocument();
  });

  it("Productos: agrupados por unidad y aviso de servicios excluidos", async () => {
    montar();
    fireEvent.click(boton(/productos más comprados/i));
    const tarjeta = await screen.findByRole("region", { name: /productos más comprados/i });
    const t = within(tarjeta);
    await t.findByText(/por kg/i);
    expect(t.getByText(/por ud/i)).toBeInTheDocument();
    expect(t.getByText("53,5 kg")).toBeInTheDocument();
    expect(t.getByText("1.200 ud")).toBeInTheDocument();
    expect(t.getByText(/no cuenta 6 líneas de servicio/i)).toBeInTheDocument();
  });

  it("Con avisos: mensajes de la alerta, fecha dudosa, sin total y abrir el documento", async () => {
    montar();
    fireEvent.click(boton(/con avisos/i));
    const tarjeta = await screen.findByRole("region", { name: /con avisos/i });
    const t = within(tarjeta);
    await t.findByText(/no trae ninguna fecha impresa/i);
    expect(t.getByText(/fecha dudosa/i)).toBeInTheDocument();
    expect(t.getByText("sin total")).toBeInTheDocument();
    // El 39 no está en la caché de la página: avisa en vez de fallar.
    fireEvent.click(t.getByRole("button", { name: /abrir la factura F \/ 25011959/i }));
    expect(toastMock.info).toHaveBeenCalled();
    // El 52 sí: abre el mismo diálogo de edición que la pestaña Documentos.
    fireEvent.click(t.getByRole("button", { name: /abrir la factura 1 - 701405/i }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/1 - 701405/);
  });

  it("Gasto por categoría: total base sin IVA, madres por importe, subcategorías y avisos", async () => {
    montar();
    fireEvent.click(boton(/gasto por categoría/i));
    const tarjeta = await screen.findByRole("region", { name: /gasto por categoría/i });
    const t = within(tarjeta);
    await t.findByText("Bebidas");
    expect(t.getByText("13.292,40 €")).toBeInTheDocument();
    expect(t.getByText(/^base sin IVA · Del 01\/01\/2026 al 07\/10\/2026/i)).toBeInTheDocument();
    // Ordenadas por importe: Bebidas antes que Frutas y verduras.
    const nombres = t.getAllByTitle(/^(Bebidas|Frutas y verduras)$/).map((e) => e.getAttribute("title"));
    expect(nombres).toEqual(["Bebidas", "Frutas y verduras"]);
    expect(t.getByText("Vinos")).toBeInTheDocument();
    expect(t.getByText("12.000,00 €")).toBeInTheDocument();
    expect(t.getByText(/productos sin categoría/i)).toBeInTheDocument();
    expect(t.getByText(/3 líneas aún sin clasificar \(436,92 €\)/i)).toBeInTheDocument();
    expect(t.getByText(/2 líneas sin importe/i)).toBeInTheDocument();
    expect(t.getByText(/4 líneas de albarán ya facturadas/i)).toBeInTheDocument();
  });

  it("Qué ha subido de precio: variación, precios €/unidad, marcas y productos sin referencia", async () => {
    montar();
    fireEvent.click(boton(/qué ha subido de precio/i));
    const tarjeta = await screen.findByRole("region", { name: /qué ha subido de precio/i });
    const t = within(tarjeta);
    await t.findByText("Helado frambuesa");
    expect(t.getByText("+12,5 %")).toBeInTheDocument();
    expect(t.getByText(/32,00 €\/ud → 36,00 €\/ud/)).toBeInTheDocument();
    expect(t.getByText(/10,75 €\/kg → 12,90 €\/kg/)).toBeInTheDocument();
    expect(t.getByText(/cambio de proveedor \(antes Pescados Paco\), no es una subida real/i)).toBeInTheDocument();
    expect(t.getByText(/referencia de una sola compra · referencia antigua/i)).toBeInTheDocument();
    expect(t.getByText(/30 productos con una sola compra/i)).toBeInTheDocument();
    expect(t.getByText(/más del 15 %/)).toBeInTheDocument();
  });

  it("Qué ha subido de precio: sin subidas dice «Nada ha subido más del X %»", async () => {
    doble.rpc.mockResolvedValue({
      data: { umbral_pct: 10, productos: [], comparados: 14, avisos: { sin_referencia: 3 } },
      error: null,
    });
    montar();
    fireEvent.click(boton(/qué ha subido de precio/i));
    expect(await screen.findByText(/nada ha subido más del 10 % \(14 productos comparados\)/i)).toBeInTheDocument();
    expect(screen.getByText(/3 productos con una sola compra/i)).toBeInTheDocument();
  });

  it("si la RPC contesta {error}, la tarjeta lo dice", async () => {
    doble.rpc.mockResolvedValue({ data: { error: "Rango invalido" }, error: null });
    montar();
    fireEvent.click(boton(/top proveedores/i));
    expect(await screen.findByRole("alert")).toHaveTextContent(/rango invalido/i);
  });

  it("la tarjeta se puede quitar", async () => {
    montar();
    fireEvent.click(boton(/top proveedores/i));
    const tarjeta = await screen.findByRole("region", { name: /top proveedores/i });
    fireEvent.click(within(tarjeta).getByRole("button", { name: /quitar esta respuesta/i }));
    expect(screen.queryByRole("region", { name: /top proveedores/i })).not.toBeInTheDocument();
  });
});

// ─── Sin IA y sin contexto ───────────────────────────────────────────────────
describe("no gasta IA", () => {
  it("pulsar todos los botones no llama a chat-facturas ni guarda mensajes", async () => {
    montar();
    for (const p of PREGUNTAS_RAPIDAS.filter((q) => !q.proximamente)) {
      fireEvent.click(boton(new RegExp(`^${p.etiqueta}`, "i")));
    }
    await waitFor(() => expect(screen.queryAllByRole("status")).toHaveLength(0));
    expect(doble.invoke).not.toHaveBeenCalled();
    expect(doble.inserts).toEqual([]);
  });

  it("la siguiente pregunta libre a la IA no lleva los datos de la respuesta rápida", async () => {
    montar();
    fireEvent.click(boton(/gasto este mes/i));
    await screen.findByText(/diferencia en facturas/i);

    fireEvent.change(screen.getByLabelText(/pregunta para el asistente/i), { target: { value: "¿Y el IVA?" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar pregunta/i }));
    await screen.findByText("Respuesta de la IA");

    expect(doble.invoke).toHaveBeenCalledTimes(1);
    expect(doble.invoke).toHaveBeenCalledWith("chat-facturas", { body: { mensaje: "¿Y el IVA?", session_id: "s1" } });
    // Solo se guardan la pregunta y la respuesta de la IA, nada de la tarjeta.
    const guardados = doble.inserts.filter((i) => i.tabla === "chat_facturas_mensajes").map((i) => i.fila as { contenido: string });
    expect(guardados.map((g) => g.contenido)).toEqual(["¿Y el IVA?", "Respuesta de la IA"]);
    // La tarjeta sigue en pantalla (no se borra al crearse la conversación).
    expect(screen.getByRole("region", { name: /gasto este mes/i })).toBeInTheDocument();
  });
});
