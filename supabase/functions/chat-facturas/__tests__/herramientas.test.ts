/**
 * Tests de supabase/functions/chat-facturas/herramientas.ts (TS puro, sin
 * Deno): prompt, esquema de TOOLS, traduccion herramienta -> RPC y marcas
 * sobre el resultado. Origen: prueba del chatbot del 05/10/2026 (engram
 * `facturas/chatbot-prueba-2026-10`) y migracion 20261005100000.
 */
import { describe, it, expect } from "vitest";
import {
  AGRUPAR_FLEX,
  construirConsultaFlexible,
  esErrorCorregible,
  FILTROS_FLEX,
  marcarResultado,
  METRICAS_FLEX,
  prepararLlamada,
  recortar,
  systemPrompt,
  TOOLS,
} from "../herramientas.ts";

// deno-lint-ignore no-explicit-any
type Esquema = any;

/** Strict mode de OpenAI: todo objeto con additionalProperties:false y TODAS sus claves en required. */
function comprobarStrict(esquema: Esquema, ruta: string): void {
  const tipos = esquema && typeof esquema === "object" ? [esquema.type].flat() : [];
  if (tipos.includes("object")) {
    expect(esquema.additionalProperties, `${ruta}: additionalProperties`).toBe(false);
    expect([...esquema.required].sort(), `${ruta}: required`).toEqual(Object.keys(esquema.properties).sort());
    for (const [k, v] of Object.entries(esquema.properties)) comprobarStrict(v, `${ruta}.${k}`);
  }
  if (esquema?.items) comprobarStrict(esquema.items, `${ruta}[]`);
}

describe("TOOLS", () => {
  const nombres = TOOLS.map((t) => t.function.name);

  it("expone las herramientas precisas, la comodin y la semantica de respaldo", () => {
    expect(nombres).toEqual([
      "estadisticas_globales",
      "resumen_periodo",
      "ranking",
      "filtrar_documentos",
      "detalle_documento",
      "historial_precios",
      "buscar_productos",
      "buscar_facturas",
      "consulta_flexible",
    ]);
    // buscar_documentos sale: la sustituye filtrar_documentos (con sumas de todo lo filtrado).
    expect(nombres).not.toContain("buscar_documentos");
  });

  it("cumple strict mode en todos los niveles", () => {
    for (const t of TOOLS) {
      expect(t.function.strict).toBe(true);
      comprobarStrict(t.function.parameters, t.function.name);
    }
  });

  it("todas las herramientas tienen traduccion a RPC", () => {
    for (const n of nombres) {
      // Argumentos minimos validos para cada una.
      const args: Record<string, unknown> = {
        resumen_periodo: { desde: "2026-01-01", hasta: "2026-01-31" },
        ranking: { criterio: "precio_unitario" },
        detalle_documento: { id: 54, numero: null },
        historial_precios: { producto: "jamon" },
        buscar_productos: { consulta: "gambas" },
        buscar_facturas: { consulta: "pescado", tipo: null },
      }[n] as Record<string, unknown> ?? {};
      expect(() => prepararLlamada(n, args), n).not.toThrow();
    }
  });

  it("las listas blancas de consulta_flexible coinciden con el esquema", () => {
    const flex = TOOLS.find((t) => t.function.name === "consulta_flexible")!.function.parameters as Esquema;
    // Las metricas no van como enum (ahorro de tokens): la descripcion las nombra todas.
    for (const m of ["count_documentos", "count_lineas", "sum", "avg", "min", "max", "total", "subtotal", "iva",
                     "cantidad", "precio_unitario", "total_linea"]) {
      expect(flex.properties.metricas.description).toContain(m);
    }
    expect(METRICAS_FLEX).toHaveLength(26);
    expect(flex.properties.agrupar.items.enum).toEqual([...AGRUPAR_FLEX]);
    expect(Object.keys(flex.properties.filtros.properties)).toEqual([...FILTROS_FLEX]);
  });

  it("las descripciones son cortas (se envian en cada ronda)", () => {
    const tamano = JSON.stringify(TOOLS).length;
    expect(tamano).toBeLessThan(6_000);
    for (const t of TOOLS) expect(t.function.description.length, t.function.name).toBeLessThan(330);
  });
});

describe("systemPrompt", () => {
  const p = systemPrompt("2026-10-05");

  it("lleva la fecha de hoy", () => {
    expect(p).toContain("Hoy es 2026-10-05");
  });

  it("precios de linea SIN IVA; solo los documentos llevan IVA", () => {
    expect(p).toMatch(/precio_unitario y el importe de una LINEA de producto van SIN IVA/);
    expect(p).toMatch(/total\/gasto\/valor de un DOCUMENTO llevan IVA incluido/);
  });

  it("documentos sin total => cifra parcial y citarlos", () => {
    expect(p).toMatch(/documentos_sin_total.*PARCIAL/s);
    expect(p).toMatch(/cita esos documentos/);
  });

  it("numero de documento solo si aparece literal", () => {
    expect(p).toMatch(/Cita un numero de documento solo si aparece literal/);
  });

  it("no hay relacion albaran-factura", () => {
    expect(p).toMatch(/No hay ninguna relacion guardada entre albaranes y facturas/);
  });

  it("ambito: solo compras; lo demas se rechaza con amabilidad", () => {
    expect(p).toMatch(/Solo respondes sobre sus facturas, albaranes/);
    expect(p).toMatch(/dilo con amabilidad/);
  });

  it("cada mes: meses con su año, sin rellenar ni suponer", () => {
    expect(p).toMatch(/estadisticas_globales\.meses/);
    expect(p).toMatch(/no rellenes meses vacios ni supongas el año/);
  });

  it("fecha dudosa y alertas con su mensaje", () => {
    expect(p).toMatch(/fecha_dudosa": su fecha es la de subida/);
    expect(p).toMatch(/"alertas": explica su "mensaje"/);
  });

  it("ya no pide etiquetar 'IVA incluido' a cualquier importe ni citar documento en cada cifra", () => {
    expect(p).not.toMatch(/1\.234,56€ IVA incluido/);
    expect(p).not.toMatch(/nombra el documento del que sale/);
  });

  it("es mas corto que el anterior (≈ 7.300 caracteres)", () => {
    expect(p.length).toBeLessThan(4_200);
  });
});

describe("prepararLlamada", () => {
  it("resumen_periodo exige las dos fechas validas y en orden", () => {
    expect(prepararLlamada("resumen_periodo", { desde: "2026-01-01", hasta: "2026-01-31" })).toEqual({
      tipo: "rpc", rpc: "resumen_periodo_agente", params: { p_desde: "2026-01-01", p_hasta: "2026-01-31" }, limite: null,
    });
    expect(() => prepararLlamada("resumen_periodo", { desde: "2026-01", hasta: "2026-01-31" })).toThrow(/fecha valida/);
    expect(() => prepararLlamada("resumen_periodo", { desde: "2026-02-30", hasta: "2026-03-01" })).toThrow(/calendario/);
    expect(() => prepararLlamada("resumen_periodo", { desde: "2026-02-01", hasta: "2026-01-01" })).toThrow(/rango/);
    expect(() => prepararLlamada("resumen_periodo", {})).toThrow(/obligatorio/);
  });

  it("ranking pasa criterio, tipo normalizado y nulls para lo no indicado", () => {
    expect(prepararLlamada("ranking", {
      criterio: "precio_unitario", tipo: "facturas", limite: 5, desde: null, hasta: null, orden: null, incluir_servicios: null,
    })).toEqual({
      tipo: "rpc",
      rpc: "ranking_agente",
      params: {
        p_criterio: "precio_unitario", p_tipo: "factura", p_limite: 5, p_desde: null, p_hasta: null,
        p_orden: null, p_incluir_servicios: null,
      },
      limite: null,
    });
    expect(() => prepararLlamada("ranking", { criterio: null })).toThrow(/criterio/);
    expect(() => prepararLlamada("ranking", { criterio: "cantidad", desde: "enero" })).toThrow(/fecha/);
  });

  it("filtrar_documentos: por defecto 'todos'; texto, tipo y fechas", () => {
    const ll = prepararLlamada("filtrar_documentos", {
      filtro: null, texto: " Osborne ", tipo: "albaranes", desde: "2026-01-01", hasta: null, orden: null, limite: null,
    });
    expect(ll).toMatchObject({
      rpc: "filtrar_documentos_agente",
      params: { p_filtro: "todos", p_texto: "Osborne", p_tipo: "albaran", p_desde: "2026-01-01", p_hasta: null },
    });
  });

  it("detalle_documento necesita id o numero", () => {
    expect(prepararLlamada("detalle_documento", { id: null, numero: "ML/101511" })).toMatchObject({
      rpc: "detalle_documento_agente", params: { p_id: null, p_numero: "ML/101511" },
    });
    expect(() => prepararLlamada("detalle_documento", { id: null, numero: " " })).toThrow(/parametro/);
  });

  it("buscar_productos prueba primero la busqueda exacta (sin embedding)", () => {
    const ll = prepararLlamada("buscar_productos", { consulta: "Johnnie Walker Black" });
    expect(ll.tipo).toBe("semantica");
    if (ll.tipo !== "semantica") return;
    expect(ll.textoPrimero).toEqual({
      rpc: "buscar_productos_texto_agente",
      params: { p_texto: "Johnnie Walker Black", p_limite: 12 },
    });
    expect(ll.rpc).toBe("buscar_productos_agente");
  });

  it("buscar_facturas sigue siendo semantica pura", () => {
    const ll = prepararLlamada("buscar_facturas", { consulta: "pescado", tipo: "albaran" });
    expect(ll).toMatchObject({ tipo: "semantica", rpc: "buscar_facturas_agente", params: { limite: 8, p_tipo: "albaran" } });
    expect("textoPrimero" in ll && ll.textoPrimero).toBeFalsy();
  });

  it("consulta_flexible quita los null y valida fechas", () => {
    const ll = prepararLlamada("consulta_flexible", {
      fuente: "documentos",
      metricas: ["sum_total"],
      agrupar: ["proveedor", "mes"],
      filtros: {
        desde: "2025-01-01", hasta: "2025-12-31", proveedor: null, tipo: "factura", numero: null, producto: null,
        con_total: null, verificada: null, con_alertas: null, excluir_servicios: null, importe_min: null, importe_max: null,
      },
      orden_por: null,
      orden_dir: null,
      limite: null,
    });
    expect(ll).toEqual({
      tipo: "rpc",
      rpc: "consulta_flexible_agente",
      params: {
        p: {
          fuente: "documentos",
          metricas: ["sum_total"],
          agrupar: ["proveedor", "mes"],
          filtros: { desde: "2025-01-01", hasta: "2025-12-31", tipo: "factura" },
        },
      },
      limite: null,
    });
    expect(() => construirConsultaFlexible({ filtros: { desde: "2025-13-01" } })).toThrow(/fecha/);
    expect(() => construirConsultaFlexible({ filtros: { desde: "2025-02-01", hasta: "2025-01-01" } })).toThrow(/rango/);
  });

  it("consulta_flexible no filtra nombres: la lista blanca esta en SQL", () => {
    // Lo que no valida el esquema de OpenAI llega tal cual a la RPC, que lo rechaza.
    const ll = prepararLlamada("consulta_flexible", { agrupar: ["proveedor; drop table facturas"], metricas: [] });
    expect(ll).toMatchObject({ params: { p: { agrupar: ["proveedor; drop table facturas"] } } });
  });

  it("herramienta desconocida (incluida la antigua buscar_documentos)", () => {
    expect(() => prepararLlamada("buscar_documentos", {})).toThrow(/desconocida/);
  });

  it("los errores de argumentos son corregibles; los de BD no", () => {
    expect(esErrorCorregible('El parametro "desde" no es una fecha valida')).toBe(true);
    expect(esErrorCorregible('Falta el parametro "criterio".')).toBe(true);
    expect(esErrorCorregible("connection refused")).toBe(false);
  });
});

describe("marcarResultado", () => {
  it("array vacio => aviso de sin coincidencias", () => {
    expect(marcarResultado("buscar_productos", [], 12)).toMatchObject({ resultados: [], truncado: false });
  });

  it("array al tope => truncado", () => {
    const filas = Array.from({ length: 8 }, (_, i) => ({ id: i }));
    expect(marcarResultado("buscar_facturas", filas, 8)).toMatchObject({ truncado: true });
  });

  it("filas vacias de una RPC nueva => sin_datos", () => {
    const r = marcarResultado("ranking", { criterio: "x", filas: [], total_filas: 0, truncado: false }, null) as Record<string, unknown>;
    expect(r.sin_datos).toBe(true);
    expect(r.aviso_vacio).toMatch(/no hay datos/);
  });

  it("documentos_sin_total => aviso de cifra parcial (fallo 1 de la prueba)", () => {
    const r = marcarResultado("resumen_periodo", {
      facturas: { n: 6, gasto: 8172.21, sin_total: 1 },
      documentos_sin_total: { n: 1, docs: [{ id: 54, numero: "ML/101511" }] },
    }, null) as Record<string, unknown>;
    expect(r.aviso_parcial).toMatch(/CIFRA PARCIAL: 1 documento/);
  });

  it("filtrar_documentos sin lista pero con sumas.sin_total => tambien parcial", () => {
    const r = marcarResultado("filtrar_documentos", {
      filas: [{ id: 54, sin_total: true }], total_filas: 1,
      sumas: { facturas: { n: 1, total: 0, sin_total: 1 } },
    }, null) as Record<string, unknown>;
    expect(r.aviso_parcial).toMatch(/1 documento/);
  });

  it("errores pasan tal cual", () => {
    expect(marcarResultado("consulta_flexible", { error: "Metrica no permitida" }, null)).toEqual({ error: "Metrica no permitida" });
  });

  it("recortar corta y marca el fragmento", () => {
    expect(recortar("x".repeat(7000))).toMatch(/FRAGMENTO/);
    expect(recortar("corto")).toBe("corto");
  });
});
