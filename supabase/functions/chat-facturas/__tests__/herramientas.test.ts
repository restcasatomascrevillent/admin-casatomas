/**
 * Tests de supabase/functions/chat-facturas/herramientas.ts (TS puro, sin
 * Deno): prompt, esquema de TOOLS, traduccion herramienta -> RPC y marcas
 * sobre el resultado. Origen: prueba del chatbot del 05/10/2026 (engram
 * `facturas/chatbot-prueba-2026-10`) y migracion 20261005100000; tercera
 * prueba (06/10/2026) y migracion 20261006100000 (deducidos, conteos, IVA);
 * compras de un producto (07/10/2026, migracion 20261007150000); gasto por
 * categoria y subidas de precio (07/10/2026, migracion 20261007170000);
 * ronda 8 (08/10/2026, migracion 20261008120000): tipo de producto, unidades,
 * ficha de proveedor, IVA por tipo y grafica (adjuntos).
 */
import { describe, it, expect } from "vitest";
import {
  AGRUPAR_FLEX,
  anotarRuta,
  construirConsultaFlexible,
  esErrorCorregible,
  familiaDeBebida,
  FILTROS_FLEX,
  LIMITE_VOLUMEN_ENVASES,
  LIMITES,
  MAX_CHARS_VOLUMEN,
  NOTA_RESPUESTA_VOLUMEN,
  marcarResultado,
  sinAvisosDeImporte,
  METRICAS_FLEX,
  necesitaRespaldoSemantico,
  prepararLlamada,
  recortar,
  separarAdjunto,
  systemPrompt,
  tipoDeProducto,
  TOOLS,
} from "../herramientas.ts";

/**
 * Tope del prompt de sistema: 6.400 (antes 5.990). Sube ~370 caracteres el
 * 07/11/2026 (migracion 20261107100000) por las reglas que el dueño pidio tras
 * fallos reales en la demo: precio del litro en la 15, no preguntar «¿quieres
 * que consulte…?» (16), seguimiento con el mismo tema (17) y «ultimo mes» (18).
 * El prompt va en cache (≈5.600 de 8.200 tokens de entrada, 0,10 $/M en
 * gpt-4.1-mini): ~+90 tokens ≈ +0,00001 $ por ronda.
 */
const LIMITE_PROMPT = 6_450; // + regla 19 «como_leer» (margenes_carta y alertas_precio, 16/11/2026)

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
      "compras_producto",
      "gasto_por_categoria",
      "variacion_precios",
      "ficha_proveedor",
      "albaranes_sin_factura",
      "grafico_precio",
      "volumen_comprado",
      "buscar_productos",
      "buscar_facturas",
      "margenes_carta",
      "alertas_precio",
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
        compras_producto: { producto: "centollo" },
        ficha_proveedor: { proveedor: "luga" },
        albaranes_sin_factura: { proveedor: "luga" },
        grafico_precio: { producto: "jamon" },
        volumen_comprado: { categoria: "cerveza" },
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
    expect(METRICAS_FLEX).toHaveLength(29); // + sum_retencion_irpf, count_con_retencion (07/11/2026)
    expect(flex.properties.agrupar.items.enum).toEqual([...AGRUPAR_FLEX]);
    expect(Object.keys(flex.properties.filtros.properties)).toEqual([...FILTROS_FLEX]);
  });

  it("las descripciones son cortas (se envian en cada ronda)", () => {
    const tamano = JSON.stringify(TOOLS).length;
    // 5.997 antes de compras_producto (07/10/2026); la nueva suma ~920 (~230 tokens por ronda).
    // 6.918 antes de gasto_por_categoria + variacion_precios (07/10/2026): 8.180 con ellas
    // (+1.262, ~315 tokens por ronda; strict mode obliga a declarar sus 11 parametros).
    // 8.628 con los parametros por defecto (08/10/2026: fechas y tipo null salvo que el usuario
    // los diga, +448 ~ 110 tokens por ronda; el modelo ponia "este año" y tipo=factura).
    // 9.626 con la ronda 8 (08/10/2026: ficha_proveedor, grafico_precio y unidad/categoria;
    // +998 ~ 250 tokens por ronda).
    // 10.376 con volumen_comprado (06/11/2026: litros/kilos de cerveza, vino, agua…; +756,
    // ~190 tokens por ronda; el prompt no crece: la pista va en la descripcion).
    // 10.550 con bebidas (13/11/2026: formatos, botellas y orden envases en volumen_comprado;
    // +174, ~45 tokens por ronda).
    // 11.9xx con margenes_carta y alertas_precio (16/11/2026: margenes de la carta y avisos de
    // Analisis; +1.310, ~330 tokens por ronda; las pautas de lectura van en "como_leer" del resultado).
    expect(tamano).toBeLessThan(11_950); // + IRPF (07/11/2026)
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
    expect(p).toMatch(/Pregunta de cuantos o de UN documento \(la ultima factura\): solo lo pedido; sin avisos de parcial/);
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
    expect(p).toMatch(/Rankings: di el criterio con tus palabras/);
    expect(p).toMatch(/primero_por_unidad/);
  });

  it("numero de documento solo si aparece literal", () => {
    expect(p).toMatch(/Cita un numero de documento solo si aparece literal/);
  });

  it("albaranes sin factura: herramienta propia (ronda 9; antes «no se puede saber», prueba 2: q19)", () => {
    expect(p).toMatch(/Albaran facturado = su factura cita su numero \(no se cuenta dos veces\)/);
    expect(p).toMatch(/"sin factura"\/"sin facturar"\/pendientes: albaranes_sin_factura/);
    expect(p).not.toMatch(/SIN llamar herramientas/);
    expect(p).not.toMatch(/con los datos no se puede saber/);
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

  it("compras de un producto: compras_producto, unidad, periodo, variantes y albaranes (07/10/2026)", () => {
    expect(p).toMatch(/compras_producto: cuanto se compro de UN producto, a quien y a que precio medio/);
    expect(p).toMatch(/12\. compras_producto: di unidad, periodo y variantes contadas \(productos_coincidentes\); nunca sumes unidades distintas/);
    expect(p).toMatch(/"aproximada": avisa de que no es el nombre exacto/);
    expect(p).toMatch(/sin_datos: dilo y da ultimo_dato \(fecha, cantidad, proveedor\) si viene; con sugerencias pregunta si es alguna/);
    expect(p).toMatch(/una_compra: solo hubo una, no hay evolucion/);
    expect(p).not.toMatch(/incluye_albaranes/);
    const d = TOOLS.find((t) => t.function.name === "compras_producto")!.function.description;
    expect(d).toMatch(/cuanto, a quien y a que precio/);
    expect(d).toMatch(/centollo=centolla/);
    expect(d).toMatch(/Sin periodo en la pregunta: desde\/hasta null = todo el historico/);
    expect(d).not.toMatch(/este año =/);
  });

  it("gasto por categoria y subidas de precio: periodo, sin IVA, sin clasificar, cambio de proveedor (07/10/2026)", () => {
    expect(p).toMatch(/gasto_por_categoria: gasto en vinos, marisco, limpieza\.\.\. o reparto por categorias/);
    expect(p).toMatch(/variacion_precios: que ha subido o bajado de precio/);
    expect(p).toMatch(/13\. gasto_por_categoria: di periodo, base SIN IVA y sin_clasificar/);
    expect(p).toMatch(/cambio_proveedor = otro proveedor, no subida del mismo: dilo/);
    expect(p).toMatch(/pocas_compras\/ref_antigua: comparacion debil/);
    const g = TOOLS.find((t) => t.function.name === "gasto_por_categoria")!.function;
    expect(g.description).toMatch(/categoria null/);
    expect((g.parameters as Esquema).properties.agrupar.enum).toEqual(["mes", "proveedor", null]);
    const v = TOOLS.find((t) => t.function.name === "variacion_precios")!.function;
    expect((v.parameters as Esquema).properties.sentido.enum).toEqual(["subidas", "bajadas", "ambas", null]);
  });

  it("parametros por defecto: periodo y tipo null salvo que el usuario los diga (prueba del 07/10)", () => {
    expect(p).toMatch(/solo si el usuario dice un periodo; si no, desde\/hasta null = todo el historico/);
    expect(p).toMatch(/"que X compro mas" con X categoria \(licor, vino\): sus top_productos/);
    expect(p).toMatch(/"Sin X" \(sin las cajas\): repite con excluir=X/);
    expect(p).toMatch(/Por meses: solo los meses que trae la herramienta/);
    expect(p).toMatch(/sin_comparar: da su ultima compra/);
    for (const nombre of ["compras_producto", "gasto_por_categoria", "variacion_precios"]) {
      const props = (TOOLS.find((t) => t.function.name === nombre)!.function.parameters as Esquema).properties;
      expect(props.desde.description, nombre).toMatch(/null salvo periodo dicho por el usuario/);
      expect(props.hasta.description, nombre).toMatch(/null salvo periodo dicho por el usuario/);
      if (props.tipo) expect(props.tipo.description, nombre).toMatch(/null \(ambos\) salvo que diga facturas o albaranes; 'cajas' no es tipo/);
    }
  });

  it("es mas corto que el anterior (≈ 7.300 caracteres)", () => {
    // 4.045 antes de compras_producto (07/10/2026); su linea y la regla 12 suman ~500.
    // 4.547 antes de gasto_por_categoria/variacion_precios: sus dos lineas y la regla 13
    // suman 416 (~105 tokens por ronda).
    // 4.963 antes de los parametros por defecto (08/10/2026): periodo/tipo null, "que X compro
    // mas", excluir, ultimo_dato, una_compra y sin_comparar suman 385 (~100 tokens por ronda).
    // 5.348 antes de la ronda 8 (08/10/2026): reparto facturas/albaranes, grafica, ficha,
    // IVA por tipo y unidades distintas suman 384 (~95 tokens por ronda).
    // 5.727 antes de bebidas (13/11/2026): la linea de volumen_comprado y la regla 15 suman 256
    // (~65 tokens por ronda); la guia de redaccion va en el resultado (nota_respuesta).
    expect(p.length).toBeLessThanOrEqual(LIMITE_PROMPT);
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

  it("compras_producto: texto, periodo, tipo, orden y excluir; embedding solo de respaldo", () => {
    const ll = prepararLlamada("compras_producto", {
      producto: " centollo ", desde: "2026-01-01", hasta: "2026-10-07", tipo: "albaranes", orden: "precio", excluir: "caja",
    });
    expect(ll).toEqual({
      tipo: "rpc",
      rpc: "compras_producto_agente",
      params: {
        p_texto: "centollo", p_desde: "2026-01-01", p_hasta: "2026-10-07", p_tipo: "albaran",
        p_limite: LIMITES.compras_producto, p_orden: "precio", p_excluir: "caja",
      },
      limite: null,
      respaldoSemantico: { consulta: "centollo", param: "p_embedding" },
    });
    // strict mode manda null en lo no indicado: ambos tipos, todo el historico.
    const min = prepararLlamada("compras_producto", { producto: "nata", desde: null, hasta: null, tipo: null, orden: null, excluir: null });
    expect(min).toMatchObject({ params: { p_texto: "nata", p_desde: null, p_hasta: null, p_tipo: null, p_orden: null, p_excluir: null } });
    expect(prepararLlamada("compras_producto", { producto: "nata", tipo: "ambos" })).toMatchObject({ params: { p_tipo: null } });
  });

  it("compras_producto: errores corregibles (producto, fechas, rango)", () => {
    for (const args of [{ producto: "  " }, { producto: "nata", desde: "2026-13-01" }, { producto: "nata", desde: "2026-03-01", hasta: "2026-01-01" }]) {
      let msg = "";
      try { prepararLlamada("compras_producto", args); } catch (e) { msg = (e as Error).message; }
      expect(msg, JSON.stringify(args)).not.toBe("");
      expect(esErrorCorregible(msg), msg).toBe(true);
    }
  });

  it("compras_producto: el embedding solo se pide si el texto no casa con nada", () => {
    expect(necesitaRespaldoSemantico({ buscado: "bogavante", coincidencia: "ninguna", sin_datos: true })).toBe(true);
    // Ya con embedding, con coincidencias o con el producto fuera del periodo: no.
    expect(necesitaRespaldoSemantico({ coincidencia: "semantica", sugerencias: ["Buey de mar"] })).toBe(false);
    expect(necesitaRespaldoSemantico({ coincidencia: "raiz", total: { importe: 279.3 } })).toBe(false);
    expect(necesitaRespaldoSemantico({ sin_datos: true, fuera_del_filtro: { ultima: "2025-12-29" } })).toBe(false);
    expect(necesitaRespaldoSemantico({ error: "tipo debe ser factura" })).toBe(false);
    expect(necesitaRespaldoSemantico(null)).toBe(false);
    expect(necesitaRespaldoSemantico([])).toBe(false);
  });

  it("solo compras_producto lleva respaldo semantico entre las rpc", () => {
    const conRespaldo = TOOLS.map((t) => t.function.name).filter((n) => {
      const args: Record<string, unknown> = {
        resumen_periodo: { desde: "2026-01-01", hasta: "2026-01-31" },
        ranking: { criterio: "cantidad" },
        detalle_documento: { id: 1 },
        historial_precios: { producto: "jamon" },
        compras_producto: { producto: "jamon" },
        ficha_proveedor: { proveedor: "luga" },
        albaranes_sin_factura: { proveedor: "luga" },
        grafico_precio: { producto: "jamon" },
        volumen_comprado: { categoria: "cerveza" },
        buscar_productos: { consulta: "jamon" },
        buscar_facturas: { consulta: "jamon" },
      }[n] as Record<string, unknown> ?? {};
      const ll = prepararLlamada(n, args);
      return ll.tipo === "rpc" && ll.respaldoSemantico !== undefined;
    });
    expect(conRespaldo).toEqual(["compras_producto"]);
  });

  it("gasto_por_categoria: categoria, periodo, tipo y cruce; todo null = reparto de todas", () => {
    expect(prepararLlamada("gasto_por_categoria", {
      categoria: " vinos ", desde: "2026-01-01", hasta: "2026-10-07", tipo: "facturas", agrupar: "mes",
    })).toEqual({
      tipo: "rpc",
      rpc: "gasto_categorias_agente",
      params: { p_categoria: "vinos", p_desde: "2026-01-01", p_hasta: "2026-10-07", p_tipo: "factura", p_agrupar: "mes" },
      limite: null,
    });
    expect(prepararLlamada("gasto_por_categoria", { categoria: null, desde: null, hasta: null, tipo: null, agrupar: null }))
      .toMatchObject({ params: { p_categoria: null, p_desde: null, p_hasta: null, p_tipo: null, p_agrupar: null } });
    for (const args of [{ desde: "2026-13-01" }, { desde: "2026-03-01", hasta: "2026-01-01" }]) {
      let msg = "";
      try { prepararLlamada("gasto_por_categoria", args); } catch (e) { msg = (e as Error).message; }
      expect(esErrorCorregible(msg), msg).toBe(true);
    }
  });

  it("variacion_precios: umbral numerico, sentido, categoria o producto y tope de filas", () => {
    expect(prepararLlamada("variacion_precios", {
      desde: null, hasta: "2026-10-07", umbral_pct: 5, categoria: "pescado", producto: null, sentido: "bajadas",
    })).toEqual({
      tipo: "rpc",
      rpc: "variacion_precios_agente",
      params: {
        p_desde: null, p_hasta: "2026-10-07", p_umbral_pct: 5, p_categoria: "pescado", p_producto: null,
        p_limite: LIMITES.variacion_precios, p_sentido: "bajadas",
      },
      limite: null,
    });
    // Un umbral que no es numero no pasa (la RPC usa su 10 por defecto).
    expect(prepararLlamada("variacion_precios", { umbral_pct: "10%", producto: " merluza " }))
      .toMatchObject({ params: { p_umbral_pct: null, p_producto: "merluza" } });
    expect(() => prepararLlamada("variacion_precios", { desde: "ayer" })).toThrow(/fecha/);
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

  it("conteo o UN documento => sin avisos de importe de otros documentos (prueba del 07/10: q04, q05)", () => {
    expect(sinAvisosDeImporte("¿Cuántas facturas y cuántos albaranes tengo registrados?")).toBe(true);
    expect(sinAvisosDeImporte("¿Cuál es la última factura que tengo y cuánto suma?")).toBe(true);
    expect(sinAvisosDeImporte("¿Cuántos proveedores tengo?")).toBe(true);
    expect(sinAvisosDeImporte("¿Cuánto he gastado cada mes?")).toBe(false);
    expect(sinAvisosDeImporte("¿Cuántas facturas hay y cuánto suman?")).toBe(false);
    expect(sinAvisosDeImporte("Dame las últimas facturas")).toBe(false);
    expect(sinAvisosDeImporte(undefined)).toBe(false);

    const est = {
      facturas: { n: 12, gasto: 35342.72, si_das_importes: { sin_total: { n: 1, docs: [] } } },
      albaranes: { n: 8, valor: 6413.42, si_das_importes: { sin_total: { n: 1, docs: [] } } },
    };
    const e = marcarResultado("estadisticas_globales", est, null, "¿Cuántas facturas y cuántos albaranes tengo?") as Record<string, any>;
    expect(e.facturas).toEqual({ n: 12, gasto: 35342.72 });
    expect(e.albaranes.si_das_importes).toBeUndefined();
    // Con importes, se quedan.
    const g = marcarResultado("estadisticas_globales", est, null, "¿Cuánto he gastado?") as Record<string, any>;
    expect(g.facturas.si_das_importes).toBeDefined();

    const filtrar = {
      filas: [{ id: 52, numero: "1 - 701405", total: 15141.34 }], total_filas: 12, truncado: true,
      sumas: { facturas: { n: 12, total: 35342.72, sin_total: 1, deducidos: 1 } },
      documentos_sin_total: { n: 1, docs: [{ id: 39 }] },
      documentos_deducidos: { n: 1, docs: [{ id: 54 }] },
    };
    const f = marcarResultado("filtrar_documentos", filtrar, null, "¿Cuál es la última factura que tengo y cuánto suma?") as Record<string, any>;
    expect(f.aviso_parcial).toBeUndefined();
    expect(f.documentos_sin_total).toBeUndefined();
    expect(f.sumas).toEqual({ facturas: { n: 12 } });
    expect(f.filas[0].total).toBe(15141.34);
    const t = marcarResultado("filtrar_documentos", filtrar, null, "¿Cuánto suman las facturas de diciembre?") as Record<string, any>;
    expect(t.aviso_parcial).toMatch(/1 sin total/);
  });

  it("compras_producto sin datos => aviso de vacio, conserva sugerencias y fuera_del_filtro", () => {
    const r = marcarResultado("compras_producto", {
      buscado: "centollo", sin_datos: true, fuera_del_filtro: { lineas: 1, ultima: "2025-12-29" }, sugerencias: ["Centolla hembra"],
    }, null) as Record<string, unknown>;
    expect(r.aviso_vacio).toMatch(/no hay datos/);
    expect(r.fuera_del_filtro).toEqual({ lineas: 1, ultima: "2025-12-29" });
    expect(r.sugerencias).toEqual(["Centolla hembra"]);
  });

  it("compras_producto con datos pasa sin avisos de documento", () => {
    const data = { buscado: "nata", coincidencia: "exacta", total: { importe: 497.3, lineas: 5 }, por_unidad: [{ unidad: "kg", cantidad: 120 }] };
    expect(marcarResultado("compras_producto", data, null)).toEqual(data);
  });

  it("gasto_por_categoria sin datos => aviso de vacio y conserva la ultima compra", () => {
    const r = marcarResultado("gasto_por_categoria", { categoria: "Vinos", sin_datos: true, ultima_compra: "2026-09-28" }, null) as Record<string, unknown>;
    expect(r.aviso_vacio).toMatch(/no hay datos/);
    expect(r.ultima_compra).toBe("2026-09-28");
  });

  it("variacion_precios sin subidas pero con productos comparados NO es 'no hay datos'", () => {
    const data = { sentido: "subidas", umbral_pct: 10, productos: [], total_productos: 0, comparados: 3 };
    expect(marcarResultado("variacion_precios", data, null)).toEqual(data);
  });

  it("errores pasan tal cual", () => {
    expect(marcarResultado("consulta_flexible", { error: "Metrica no permitida" }, null)).toEqual({ error: "Metrica no permitida" });
  });

  it("recortar corta y marca el fragmento", () => {
    expect(recortar("x".repeat(7000))).toMatch(/FRAGMENTO/);
    expect(recortar("corto")).toBe("corto");
  });
});

describe("ronda 8 (08/10/2026, migracion 20261008120000)", () => {
  const p = systemPrompt("2026-10-08");

  it("productos y categorias: facturas + albaranes salvo que el usuario diga otra cosa (marisco 39,80 en vez de 1.353,85)", () => {
    expect(p).not.toMatch(/Albaran = entrega, NO es gasto: nunca lo sumes/);
    expect(p).toMatch(/Productos y categorias: cuentan facturas \+ albaranes sin factura \(tipo null\) salvo que pidan solo uno/);
    expect(p).toMatch(/en_facturas\/en_albaranes_sin_factura, da ese reparto/);
    // El modelo mando tipo=factura sin que el usuario lo dijera: se ignora.
    expect(tipoDeProducto("factura", "¿cuanto hemos gastado en marisco?")).toBeNull();
    expect(tipoDeProducto("factura", "¿y solo en facturas?")).toBe("factura");
    expect(tipoDeProducto("albaranes", "marisco en albaranes")).toBe("albaran");
    expect(tipoDeProducto("factura")).toBe("factura");
    expect(prepararLlamada("gasto_por_categoria", { categoria: "marisco", tipo: "factura" }, "gasto en marisco"))
      .toMatchObject({ params: { p_tipo: null } });
    expect(prepararLlamada("compras_producto", { producto: "jamon", tipo: "factura" }, "cuanto jamon compramos"))
      .toMatchObject({ params: { p_tipo: null } });
    // En documentos el tipo sigue siendo del modelo.
    expect(prepararLlamada("ranking", { criterio: "importe_documento", tipo: "factura" }, "la mas cara"))
      .toMatchObject({ params: { p_tipo: "factura" } });
  });

  it("unidades distintas: no comparar, cada proveedor en su unidad", () => {
    expect(p).toMatch(/lista TODOS los proveedores, cada uno con su precio en SU unidad/);
    expect(p).toMatch(/Osborne la caja a 519,40 €; Luga el kilo a 20,50 €/);
  });

  it("unidad y categoria solo se mandan si vienen (compatibles con las RPC de antes)", () => {
    const sin = prepararLlamada("compras_producto", { producto: "nata", unidad: null });
    expect(sin.tipo === "rpc" && "p_unidad" in sin.params).toBe(false);
    expect(prepararLlamada("compras_producto", { producto: "nata", unidad: "kg" })).toMatchObject({ params: { p_unidad: "kg" } });
    expect(prepararLlamada("ranking", { criterio: "precio_unitario", unidad: "caja", categoria: "vinos" }))
      .toMatchObject({ params: { p_unidad: "caja", p_categoria: "vinos" } });
    const r = prepararLlamada("ranking", { criterio: "precio_unitario", unidad: null, categoria: null });
    expect(r.tipo === "rpc" && ("p_unidad" in r.params || "p_categoria" in r.params)).toBe(false);
  });

  it("ficha_proveedor y grafico_precio", () => {
    expect(prepararLlamada("ficha_proveedor", { proveedor: " Luga " })).toEqual({
      tipo: "rpc", rpc: "ficha_proveedor_agente", params: { p_texto: "Luga" }, limite: null,
    });
    expect(() => prepararLlamada("ficha_proveedor", { proveedor: "" })).toThrow(/parametro/);
    expect(prepararLlamada("grafico_precio", { producto: "jamon", desde: null, hasta: "2026-10-08", unidad: "kg" })).toEqual({
      tipo: "rpc",
      rpc: "serie_precios_agente",
      params: { p_texto: "jamon", p_desde: null, p_hasta: "2026-10-08", p_unidad: "kg" },
      limite: null,
    });
    expect(() => prepararLlamada("grafico_precio", { producto: "jamon", desde: "ayer" })).toThrow(/fecha/);
    expect(p).toMatch(/grafico_precio: grafica, evolucion/);
    expect(p).toMatch(/ficha_proveedor: todo de UN proveedor/);
    expect(p).toMatch(/IVA por tipo \(gestoria\): agrupar iva_pct/);
    expect(AGRUPAR_FLEX).toContain("iva_pct");
  });

  it("separarAdjunto: la serie va a la UI y el modelo solo ve el resumen", () => {
    const serie = {
      producto: "Jamón", unidad: "kg", proveedores: ["Joselito", "Luga"],
      puntos: [["2025-12-10", 55.8, 0], ["2025-12-31", 20.5, 1]], n: 2, min: 20.5, max: 55.8, ultimo: 20.5, variacion_pct: null,
    };
    const { data, adjunto } = separarAdjunto("grafico_precio", serie);
    expect(adjunto).toEqual({ tipo: "serie_precio", datos: serie });
    expect(data).toEqual({
      producto: "Jamón", unidad: "kg", n: 2, min: 20.5, max: 55.8, ultimo: 20.5, variacion_pct: null,
      proveedores: ["Joselito", "Luga"], grafico_adjunto: true,
    });
    expect(JSON.stringify(data)).not.toContain("puntos");
    // Sin datos, error u otra herramienta: sin adjunto y el resultado intacto.
    const vacio = { sin_datos: true, buscado: "caviar" };
    expect(separarAdjunto("grafico_precio", vacio)).toEqual({ data: vacio, adjunto: null });
    expect(separarAdjunto("grafico_precio", { error: "x" }).adjunto).toBeNull();
    expect(separarAdjunto("historial_precios", serie)).toEqual({ data: serie, adjunto: null });
    expect(marcarResultado("grafico_precio", { ...vacio }, null)).toMatchObject({ sin_datos: true, aviso_vacio: expect.any(String) });
  });

  it("separarAdjunto: el modelo ve de dónde viene el precio convertido (caja de 10 kg → €/kg)", () => {
    const serie = {
      producto: "Jamón", unidad: "kg", proveedores: ["Osborne"], puntos: [["2026-01-15", 51.94, 0]],
      n: 1, min: 51.94, max: 51.94, ultimo: 51.94, variacion_pct: null, convertido_desde: "caja de 10 kg",
    };
    const { data } = separarAdjunto("grafico_precio", serie);
    expect(data).toMatchObject({ unidad: "kg", convertido_desde: "caja de 10 kg", grafico_adjunto: true });
  });

  it("el prompt manda decir «te dejo la gráfica debajo» sin preguntar, y citar el precio convertido", () => {
    const p = systemPrompt("2026-10-08");
    expect(p).toMatch(/con grafico_adjunto di «te dejo la grafica debajo», sin preguntar/);
    expect(p).toMatch(/Con precio_comparable o convertido_desde, usalo y di «convertido desde caja de 10 kg»/);
    expect(p.length).toBeLessThanOrEqual(LIMITE_PROMPT); // 5.730 + bebidas (13/11) + asociacion (07/11/2026)
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(11_950); // 9.620 + volumen_comprado (06/11/2026) + bebidas (13/11/2026) + IRPF (07/11/2026) + margenes_carta y alertas_precio (16/11/2026)
  });
});

describe("ronda 9 (10/10/2026, migracion 20261010170000)", () => {
  const p = systemPrompt("2026-10-10");

  it("albaranes_sin_factura: traduccion a su RPC (proveedor y fechas opcionales)", () => {
    expect(prepararLlamada("albaranes_sin_factura", { proveedor: " Narejos ", desde: null, hasta: "2026-10-31" })).toEqual({
      tipo: "rpc",
      rpc: "albaranes_sin_factura_agente",
      params: { p_proveedor: "Narejos", p_desde: null, p_hasta: "2026-10-31" },
      limite: null,
    });
    expect(prepararLlamada("albaranes_sin_factura", { proveedor: null, desde: null, hasta: null })).toMatchObject({
      params: { p_proveedor: null, p_desde: null, p_hasta: null },
    });
    expect(() => prepararLlamada("albaranes_sin_factura", { desde: "ayer" })).toThrow(/fecha/);
    expect(() => prepararLlamada("albaranes_sin_factura", { desde: "2026-10-31", hasta: "2026-10-01" })).toThrow(/rango/i);
    const t = TOOLS.find((x) => x.function.name === "albaranes_sin_factura")!.function;
    expect(Object.keys((t.parameters as Esquema).properties)).toEqual(["proveedor", "desde", "hasta"]);
    // Su resultado vacio («Ninguno: todos estan facturados») no se marca como «no hay datos».
    expect(marcarResultado("albaranes_sin_factura", { albaranes_sin_factura: 0, nota: "Ninguno" }, null)).toEqual({
      albaranes_sin_factura: 0, nota: "Ninguno",
    });
  });

  it("variantes con precios distintos: cada una con su precio, no una media", () => {
    expect(p).toMatch(/Con por_variante da cada variante con su precio, no una media/);
    expect(p).toMatch(/si "variantes_distintas" > 1 da cada una \(por_variante\)/);
  });

  it("tamaños: el prompt y TOOLS no crecen respecto a la ronda 8 (5.728 y 9.620 caracteres)", () => {
    expect(p.length).toBeLessThanOrEqual(LIMITE_PROMPT); // 5.730 + bebidas (13/11) + asociacion (07/11/2026)
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(11_950); // 9.620 + volumen_comprado (06/11/2026) + bebidas (13/11/2026) + IRPF (07/11/2026) + margenes_carta y alertas_precio (16/11/2026)
  });
});

describe("volumen_comprado (06/11/2026, migracion 20261106400000)", () => {
  it("traduce categoria/producto, periodo y unidad a volumen_comprado_agente", () => {
    expect(prepararLlamada("volumen_comprado", { categoria: "cerveza", producto: null, desde: "2026-01-01", hasta: "2026-12-31", unidad: null })).toEqual({
      tipo: "rpc",
      rpc: "volumen_comprado_agente",
      params: {
        p_texto: null, p_categoria: "cerveza", p_desde: "2026-01-01", p_hasta: "2026-12-31", p_medida: null,
        p_limite: null, p_orden: null,
      },
      limite: null,
      maxChars: MAX_CHARS_VOLUMEN,
      notaRespuesta: NOTA_RESPUESTA_VOLUMEN,
    });
    expect(prepararLlamada("volumen_comprado", { categoria: "vino", producto: " tinto ", desde: null, hasta: null, unidad: "l" })).toMatchObject({
      params: { p_texto: "tinto", p_categoria: "vino", p_medida: "l" },
    });
    expect(prepararLlamada("volumen_comprado", { categoria: null, producto: "gamba", desde: null, hasta: null, unidad: "litros" })).toMatchObject({
      params: { p_texto: "gamba", p_medida: null },
    });
  });

  it("sin categoria ni producto o con fechas malas: error corregible", () => {
    let msg = "";
    try { prepararLlamada("volumen_comprado", { categoria: null, producto: null }); } catch (e) { msg = (e as Error).message; }
    expect(esErrorCorregible(msg)).toBe(true);
    expect(() => prepararLlamada("volumen_comprado", { categoria: "cerveza", desde: "2026-12-31", hasta: "2026-01-01" })).toThrow(/rango/i);
  });

  it("la descripcion cubre litros, cuantas cervezas, barriles y lineas sin convertir", () => {
    const t = TOOLS.find((x) => x.function.name === "volumen_comprado")!.function;
    expect(t.description).toMatch(/litros de cerveza/);
    expect(t.description).toMatch(/cuantos barriles/);
    expect(t.description).toMatch(/lineas_sin_convertir/);
    expect(Object.keys((t.parameters as Esquema).properties)).toEqual(["categoria", "producto", "desde", "hasta", "unidad", "orden"]);
    expect(systemPrompt("2026-11-06").length).toBeLessThanOrEqual(LIMITE_PROMPT);
  });
});

describe("bebidas por familia (13/11/2026, migracion 20261113100000)", () => {
  it("reconoce la familia y no un producto concreto", () => {
    expect(familiaDeBebida("cerveza")).toBe("cerveza");
    expect(familiaDeBebida("Cervezas")).toBe("cerveza");
    expect(familiaDeBebida("la bebida cerveza")).toBe("cerveza");
    expect(familiaDeBebida("cerveza bebida")).toBe("cerveza");
    expect(familiaDeBebida("los vinos")).toBe("vino");
    expect(familiaDeBebida("licores")).toBe("licor");
    expect(familiaDeBebida("refrescos")).toBe("refresco");
    expect(familiaDeBebida("bebidas")).toBe("bebida");
    expect(familiaDeBebida("mostaza de cerveza")).toBeNull();
    expect(familiaDeBebida("vino blanco")).toBeNull();
    expect(familiaDeBebida("heineken")).toBeNull();
    expect(familiaDeBebida("agua")).toBeNull();
    expect(familiaDeBebida("cava")).toBeNull();
    expect(familiaDeBebida("cerveza y vino")).toBeNull();
    expect(familiaDeBebida(null)).toBeNull();
  });

  it("«¿tenemos cerveza?» por buscar_productos va a volumen_comprado por categoria (salia la mostaza de cerveza)", () => {
    const ll = prepararLlamada("buscar_productos", { consulta: "cerveza" });
    expect(ll).toMatchObject({
      tipo: "rpc", rpc: "volumen_comprado_agente",
      params: { p_categoria: "cerveza", p_texto: null, p_desde: null, p_hasta: null, p_limite: 15 },
      maxChars: MAX_CHARS_VOLUMEN,
    });
    expect(ll.tipo === "rpc" && ll.nota).toMatch(/mostaza de cerveza/);
    expect(prepararLlamada("buscar_productos", { consulta: "la bebida cerveza" })).toMatchObject({ rpc: "volumen_comprado_agente" });
    // Un producto concreto sigue por texto.
    expect(prepararLlamada("buscar_productos", { consulta: "mostaza de cerveza" })).toMatchObject({ tipo: "semantica", rpc: "buscar_productos_agente" });
  });

  it("compras_producto de una familia va a volumen_comprado con su periodo", () => {
    expect(prepararLlamada("compras_producto", { producto: "cerveza", desde: "2026-01-01", hasta: "2026-12-31" })).toMatchObject({
      rpc: "volumen_comprado_agente",
      params: { p_categoria: "cerveza", p_desde: "2026-01-01", p_hasta: "2026-12-31" },
    });
    expect(prepararLlamada("compras_producto", { producto: "heineken" })).toMatchObject({ rpc: "compras_producto_agente" });
  });

  it("«botellas por vino» por ranking cantidad va a volumen_comprado ordenado por envases (salia «4 botellas y 99 cajas»)", () => {
    expect(prepararLlamada("ranking", { criterio: "cantidad", categoria: "vino", desde: "2026-01-01", hasta: "2026-12-31", limite: null })).toMatchObject({
      rpc: "volumen_comprado_agente",
      params: { p_categoria: "vino", p_orden: "envases", p_limite: LIMITE_VOLUMEN_ENVASES, p_desde: "2026-01-01" },
    });
    expect(prepararLlamada("ranking", { criterio: "cantidad", categoria: "vinos", limite: 10 })).toMatchObject({ params: { p_limite: 10 } });
    // Otros criterios y categorias que no son bebidas, como siempre.
    expect(prepararLlamada("ranking", { criterio: "importe_linea", categoria: "vino" })).toMatchObject({ rpc: "ranking_agente" });
    expect(prepararLlamada("ranking", { criterio: "cantidad", categoria: "marisco" })).toMatchObject({ rpc: "ranking_agente" });
  });

  it("volumen_comprado: orden envases lista 25; «cerveza» como producto es la categoria", () => {
    expect(prepararLlamada("volumen_comprado", { categoria: "vino", producto: null, orden: "envases" })).toMatchObject({
      params: { p_orden: "envases", p_limite: LIMITE_VOLUMEN_ENVASES },
    });
    expect(prepararLlamada("volumen_comprado", { categoria: null, producto: "la bebida cerveza" })).toMatchObject({
      params: { p_categoria: "cerveza", p_texto: null },
    });
    expect(prepararLlamada("volumen_comprado", { categoria: null, producto: "aceite" })).toMatchObject({
      params: { p_categoria: null, p_texto: "aceite" },
    });
  });

  it("el resultado lleva delante nota_ruta y nota_respuesta (botellas, no cajas sueltas)", () => {
    const ll = prepararLlamada("buscar_productos", { consulta: "cerveza" });
    const d = anotarRuta(ll, { total: 20520.88, envases: 22736 });
    expect(Object.keys(d).slice(0, 2)).toEqual(["nota_ruta", "nota_respuesta"]);
    expect(d.nota_respuesta).toMatch(/598 botellas \(99 cajas de 6 y 4 sueltas\)/);
    expect(d.nota_respuesta).toMatch(/nunca «4 botellas y 99 cajas»/);
    expect(d.nota_respuesta).toMatch(/por_envase\.formato/);
    // Sin desvio solo la guia; otras herramientas, nada.
    expect(Object.keys(anotarRuta(prepararLlamada("volumen_comprado", { categoria: "vino" }), { total: 1 }))[0]).toBe("nota_respuesta");
    expect(anotarRuta(prepararLlamada("estadisticas_globales", {}), { a: 1 })).toEqual({ a: 1 });
    expect(anotarRuta(ll, [1, 2])).toEqual([1, 2]);
  });

  it("recortar respeta el tope de volumen_comprado (30 vinos ≈ 9.200 caracteres)", () => {
    const s = "x".repeat(9_200);
    expect(recortar(s)).toMatch(/RESULTADO CORTADO a 6000/);
    expect(recortar(s, MAX_CHARS_VOLUMEN)).toBe(s);
  });

  it("el prompt manda las bebidas a volumen_comprado y la lista la nombra", () => {
    const p = systemPrompt("2026-11-13");
    expect(p).toMatch(/- volumen_comprado: familias \(regla 15\)/);
    expect(p).toMatch(/15\. Familias \(cerveza, vino, marisco…\), precio del litro\/kilo y comparativas: volumen_comprado con categoria \(botellas: orden envases\)/);
    expect(p).toMatch(/Nunca buscar_productos ni historial_precios/);
  });
});

describe("IRPF (07/11/2026, migracion 20261107610000)", () => {
  it("las herramientas dicen dónde está la retención", () => {
    const desc = (n: string) => JSON.stringify(TOOLS.find((t) => t.function.name === n)!.function);
    expect(desc("resumen_periodo")).toMatch(/IRPF\/retencion: retencion_irpf/);
    expect(desc("consulta_flexible")).toMatch(/sum_retencion_irpf, count_con_retencion/);
    expect(METRICAS_FLEX).toContain("sum_retencion_irpf");
    expect(METRICAS_FLEX).toContain("count_con_retencion");
    expect(systemPrompt("2026-11-07")).toMatch(/IRPF\/retencion: su retencion_irpf/);
  });
});

describe("margenes_carta y alertas_precio (16/11/2026, migracion 20261116100000)", () => {
  it("margenes_carta va a margenes_carta_agente con sus parametros", () => {
    const ll = prepararLlamada("margenes_carta", { texto: " carabinero ", vista: "peso", solo_problemas: null });
    expect(ll).toMatchObject({
      tipo: "rpc",
      rpc: "margenes_carta_agente",
      params: { p_texto: "carabinero", p_vista: "peso", p_solo_problemas: false, p_limite: 12 },
    });
    const todas = prepararLlamada("margenes_carta", { texto: null, vista: null, solo_problemas: true });
    expect(todas).toMatchObject({ params: { p_vista: null, p_solo_problemas: true, p_limite: 5 }, maxChars: 9000 });
  });

  it("margenes_carta rechaza una vista desconocida", () => {
    expect(() => prepararLlamada("margenes_carta", { texto: null, vista: "postres", solo_problemas: true })).toThrow(/vista/);
  });

  it("alertas_precio: todos los tipos con pocas filas; un tipo con mas", () => {
    const todos = prepararLlamada("alertas_precio", { tipo: null, producto: null, local: null, desde: null, hasta: null });
    expect(todos).toMatchObject({ rpc: "alertas_precio_agente", params: { p_tipo: null, p_local: null, p_limite: 4 } });
    const sube = prepararLlamada("alertas_precio", { tipo: "sube", producto: "percebe", local: "touza", desde: "2026-10-01", hasta: "2026-10-31" });
    expect(sube).toMatchObject({
      params: { p_tipo: "sube", p_producto: "percebe", p_local: "touza", p_desde: "2026-10-01", p_hasta: "2026-10-31", p_limite: 12 },
    });
  });

  it("alertas_precio valida tipo y fechas", () => {
    expect(() => prepararLlamada("alertas_precio", { tipo: "raro", producto: null, local: null, desde: null, hasta: null })).toThrow(/tipo/);
    expect(() => prepararLlamada("alertas_precio", { tipo: null, producto: null, local: null, desde: "2026-13-01", hasta: null })).toThrow(/fecha/);
  });

  it("el prompt manda seguir como_leer", () => {
    expect(systemPrompt("2026-11-16")).toMatch(/como_leer/);
  });
});
