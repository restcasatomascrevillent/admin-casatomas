/**
 * Tests de supabase/functions/chat-facturas/herramientas.ts (TS puro, sin
 * Deno): prompt, esquema de TOOLS, traduccion herramienta -> RPC y marcas
 * sobre el resultado. Origen: prueba del chatbot del 05/10/2026 (engram
 * `facturas/chatbot-prueba-2026-10`) y migracion 20261005100000; tercera
 * prueba (06/10/2026) y migracion 20261006100000 (deducidos, conteos, IVA).
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
    for (const m of ["count_documentos", "count_con_total", "count_lineas", "sum", "avg", "min", "max", "total", "subtotal", "iva",
                     "cantidad", "precio_unitario", "total_linea"]) {
      expect(flex.properties.metricas.description).toContain(m);
    }
    expect(METRICAS_FLEX).toHaveLength(27);
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

  it("documentos sin total => cifra parcial y citarlos, solo del tipo y solo con importes", () => {
    expect(p).toMatch(/documentos_sin_total.*PARCIAL/s);
    expect(p).toMatch(/cita esos documentos/);
    expect(p).toMatch(/del tipo del que hablas \(facturas o albaranes\)/);
    expect(p).toMatch(/nunca digas que la cifra es completa/);
  });

  it("totales deducidos: decirlo, base SIN IVA si iva_conocido=false, nunca 'IVA incluido' (prueba 3: q20, q01, n1)", () => {
    expect(p).toMatch(/total_origen "deducido"/);
    expect(p).toMatch(/total calculado desde las lineas, no leido: dilo/);
    expect(p).toMatch(/si iva_conocido=false es la base SIN IVA y el real sera mayor/);
    expect(p).toMatch(/nunca digas "IVA incluido" de un deducido/);
    expect(p).toMatch(/IVA incluido salvo los deducidos/);
    expect(p).toMatch(/si_das_importes/);
  });

  it("IVA: los documentos sin IVA no estan en la suma (prueba 3: q22)", () => {
    expect(p).toMatch(/sin_iva: su IVA no esta en la suma de IVA/);
  });

  it("conteos: solo numeros, sin importes ni avisos (prueba 3: q04, q12, q13)", () => {
    expect(p).toMatch(/Pregunta de cuantos: solo los numeros pedidos; sin importes ni avisos de parcial/);
    const filtrar = TOOLS.find((t) => t.function.name === "filtrar_documentos")!.function;
    expect(filtrar.description).toMatch(/los demas filtros solo cuentan/);
  });

  it("lineas SIN IVA salvo nota contraria (prueba 3: q21)", () => {
    expect(p).toMatch(/van SIN IVA salvo nota contraria/);
  });

  it("medias y cruces: consulta_flexible, nunca calcular a mano (prueba 2: ticket medio)", () => {
    expect(p).toMatch(/consulta_flexible: medias, ticket medio y cruces "por X y por Y"/);
    expect(p).toMatch(/las dos agrupaciones a la vez/);
    expect(p).toMatch(/Nunca calcules tu sumas, medias ni divisiones/);
    expect(p).toMatch(/n_con_\*/);
  });

  it("historial con varios proveedores: comparativa, no subida (prueba 2: portes)", () => {
    expect(p).toMatch(/comparativa_entre_proveedores.*NO hay subida ni bajada/s);
  });

  it("rankings por cantidad: criterio con palabras y primero de cada unidad (prueba 2: q09)", () => {
    expect(p).toMatch(/por cantidad total en kg/);
    expect(p).toMatch(/primero_por_unidad/);
  });

  it("numero de documento solo si aparece literal", () => {
    expect(p).toMatch(/Cita un numero de documento solo si aparece literal/);
  });

  it("no hay relacion albaran-factura: no se puede saber, sin llamar herramientas (prueba 2: q19)", () => {
    expect(p).toMatch(/No hay ninguna relacion guardada entre albaranes y facturas/);
    expect(p).toMatch(/SIN llamar herramientas/);
    expect(p).toMatch(/"sin_total" NO significa sin factura/);
    const filtrar = TOOLS.find((t) => t.function.name === "filtrar_documentos")!.function;
    expect(filtrar.description).toMatch(/sin_total = sin importe leido; NO significa sin factura/);
    // El modelo no puede pedir un filtro "sin_factura": el enum no lo tiene.
    const enumFiltro = (filtrar.parameters as Esquema).properties.filtro.enum as string[];
    expect(enumFiltro.some((f) => /factur|albar|pag/.test(f))).toBe(false);
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
    expect(p).toMatch(/"fecha_dudosa"\/"fechas_dudosas": la fecha es la de subida/);
    expect(p).toMatch(/dia de la semana/);
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

  it("documentos_sin_total de primer nivel => aviso de cifra parcial (fallo 1 de la prueba)", () => {
    const r = marcarResultado("resumen_periodo", {
      facturas: { n: 6, gasto: 8172.21, sin_total: 1 },
      documentos_sin_total: { n: 1, docs: [{ id: 54, numero: "ML/101511" }] },
    }, null) as Record<string, unknown>;
    expect(r.aviso_parcial).toMatch(/no es completo: 1 sin total \(no suman\)/);
  });

  it("deducidos y sin IVA de primer nivel tambien avisan, y el aviso va delante (prueba 3: n1, q22)", () => {
    const r = marcarResultado("consulta_flexible", {
      criterio: "sum_total de documentos por proveedor, mes",
      filas: [{ proveedor: "Salazones Garre", mes: "2025-12", sum_total: null, sin_total: 1 }],
      total_filas: 1,
      documentos_sin_total: { n: 1, docs: [{ id: 39, numero: "F / 25011959" }] },
      documentos_deducidos: { n: 1, docs: [{ id: 54, numero: "ML/101511", iva_conocido: false }] },
      documentos_sin_iva: { n: 1, docs: [{ id: 54, numero: "ML/101511" }] },
    }, null) as Record<string, unknown>;
    expect(Object.keys(r)[0]).toBe("aviso_parcial");
    expect(r.aviso_parcial).toMatch(/1 sin total \(no suman\); 1 con total deducido de las lineas; 1 sin IVA/);
    const d = marcarResultado("ranking", {
      criterio: "x", filas: [{ proveedor: "LUGA", importe: 3787.53, deducidos: 1 }], total_filas: 1,
      documentos_deducidos: { n: 1, docs: [{ id: 54 }] },
    }, null) as Record<string, unknown>;
    expect(d.aviso_parcial).toMatch(/1 con total deducido/);
    expect(d.aviso_parcial).not.toMatch(/sin total/);
  });

  it("conteo sin bloques de importe => sin aviso (prueba 3: q04)", () => {
    const c = marcarResultado("consulta_flexible", {
      criterio: "count_documentos de documentos por tipo",
      filas: [{ tipo: "factura", count_documentos: 12 }, { tipo: "albaran", count_documentos: 7 }], total_filas: 2,
    }, null) as Record<string, unknown>;
    expect(c.aviso_parcial).toBeUndefined();
    const f = marcarResultado("filtrar_documentos", {
      criterio: "filtro=sin_verificar; solo conteo", filas: [{ id: 52 }], total_filas: 12, truncado: true,
      sumas: { facturas: { n: 12 } },
    }, null) as Record<string, unknown>;
    expect(f.aviso_parcial).toBeUndefined();
  });

  it("sin aviso global de parcial cuando sin_total va dentro de su tipo o en sumas (prueba 2: ruido)", () => {
    // filtrar_documentos con las filas a la vista: las propias filas dicen sin_total.
    const f = marcarResultado("filtrar_documentos", {
      filas: [{ id: 54, sin_total: true }], total_filas: 1,
      sumas: { facturas: { n: 1, total: 0, sin_total: 1 } },
    }, null) as Record<string, unknown>;
    expect(f.aviso_parcial).toBeUndefined();
    // estadisticas/resumen: avisos dentro de facturas/albaranes.si_das_importes.
    const e = marcarResultado("estadisticas_globales", {
      facturas: { n: 12, gasto: 35342.72, si_das_importes: { sin_total: { n: 1, docs: [] }, deducidos: { n: 1, docs: [] } } },
      albaranes: { n: 7, valor: 6413.42, si_das_importes: { sin_total: { n: 1, docs: [] } } },
    }, null) as Record<string, unknown>;
    expect(e.aviso_parcial).toBeUndefined();
  });

  it("errores pasan tal cual", () => {
    expect(marcarResultado("consulta_flexible", { error: "Metrica no permitida" }, null)).toEqual({ error: "Metrica no permitida" });
  });

  it("recortar corta y marca el fragmento", () => {
    expect(recortar("x".repeat(7000))).toMatch(/FRAGMENTO/);
    expect(recortar("corto")).toBe("corto");
  });
});
