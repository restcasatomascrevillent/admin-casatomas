import { describe, expect, it } from "vitest";
import {
  compararExpansion,
  comprobarCuadre,
  conservarRecuentoFilas,
  contarCambiosNumericos,
  deducirImportes,
  DESCRIPCION_IVA_PCT,
  desgloseIvaPorLinea,
  DOCUMENTO_JSON_SCHEMA,
  describirProblemas,
  descuadresComoAlertas,
  leerImporteLiteral,
  MAX_CAMBIOS_RELECTURA,
  mensajeCorrectivo,
  retirarImportesNoImpresos,
  aplicarRecuentoVerificado,
  RECUENTO_FILAS_SCHEMA,
  type RecuentoFilas,
  tipoIvaLinea,
  toleranciaCabecera,
  validarEstructura,
  VERIFICACION_PIE_SCHEMA,
  type DocumentoExtraido,
  type LineaExtraida,
  type VerificacionPie,
} from "./esquema.ts";
import { normalizarDatos } from "./extraccion.ts";
import { PAGINA_JSON_SCHEMA, validarPagina } from "./pagina.ts";
import { LUGA_FILAS, LUGA_IVA, LUGA_SUMA, LUGA_TOTAL } from "./fixtures/luga-ml101511.ts";

// ============================================================================
//  esquema.test.ts
// ----------------------------------------------------------------------------
//  Los casos numericos NO son inventados: son los dos errores de extraccion
//  reales que hay hoy en produccion, sobre 5 documentos.
//
//   · Joselito, albaran 2509134 — 12 jamones a 9.316,67 EUR/ud = 111.800 EUR,
//     con el documento declarando 120.580 EUR. Un jamon gran reserva ronda
//     los 500-900 EUR.
//   · MR FRIOSAT — 489,74 + 101,59 = 591,33, pero el total leido es 585,33.
//
//  Con el pipeline de hoy (`response_format: { type: "json_object" }` y
//  `normalizarDatos` como unico filtro) los dos se guardan sin que nada los
//  pare: `json_object` solo garantiza que el texto sea JSON parseable, y
//  `normalizarDatos` unicamente exige `numero_documento`. Todo lo demas pasa.
// ============================================================================

/** Documento valido al que cada test le cambia lo justo. */
function doc(over: Partial<DocumentoExtraido> = {}): DocumentoExtraido {
  return {
    tipo: "factura",
    proveedor: "Proveedor SL",
    cif: "B12345678",
    numero_documento: "F-001",
    fecha: "2026-09-03",
    sin_importes: false,
    productos: [linea()],
    subtotal: 100,
    iva: 10,
    total: 110,
    observaciones: null,
    resumen: "Factura de prueba.",
    ...over,
  };
}

function linea(over: Partial<LineaExtraida> = {}): LineaExtraida {
  return {
    nombre: "Producto",
    cantidad: 10,
    unidad: "ud",
    peso_kg: null,
    base_precio: "por_unidad",
    precio_unitario: 10,
    total: 100,
    bonificada: false,
    ...over,
  };
}

const codigos = (d: DocumentoExtraido) => comprobarCuadre(d).map((x) => x.codigo).sort();

// ============================================================================
//  1. El esquema que se manda a OpenAI cumple las reglas de `strict: true`
// ----------------------------------------------------------------------------
//  Incumplirlas es un 400 de la API en cada subida, no un fallo silencioso,
//  asi que conviene que salte aqui y no en produccion.
// ============================================================================

describe("DOCUMENTO_JSON_SCHEMA — reglas de Structured Outputs estricto", () => {
  // Palabras clave que el modo estricto NO soporta. Si alguien anade una
  // "para afinar el esquema", la API rechaza la peticion entera.
  const NO_SOPORTADAS = [
    "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems",
    "minProperties", "maxProperties", "patternProperties", "propertyNames",
    "unevaluatedProperties", "unevaluatedItems", "contains", "default",
  ];

  /** Recorre todos los sub-esquemas de tipo objeto/array. */
  function recorrer(nodo: unknown, ruta: string, visita: (n: Record<string, unknown>, r: string) => void) {
    if (nodo === null || typeof nodo !== "object") return;
    const n = nodo as Record<string, unknown>;
    visita(n, ruta);
    if (n.properties && typeof n.properties === "object") {
      for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) {
        recorrer(v, `${ruta}.${k}`, visita);
      }
    }
    if (n.items) recorrer(n.items, `${ruta}[]`, visita);
  }

  it("declara strict: true y un nombre", () => {
    expect(DOCUMENTO_JSON_SCHEMA.strict).toBe(true);
    expect(DOCUMENTO_JSON_SCHEMA.name).toBeTruthy();
  });

  it("todo objeto lleva additionalProperties: false", () => {
    const fallos: string[] = [];
    recorrer(DOCUMENTO_JSON_SCHEMA.schema, "raiz", (n, r) => {
      if (n.type === "object" && n.additionalProperties !== false) fallos.push(r);
    });
    expect(fallos).toEqual([]);
  });

  it("todo objeto lista TODAS sus propiedades en required", () => {
    const fallos: string[] = [];
    recorrer(DOCUMENTO_JSON_SCHEMA.schema, "raiz", (n, r) => {
      if (n.type !== "object" || !n.properties) return;
      const props = Object.keys(n.properties as Record<string, unknown>).sort();
      const req = ([...((n.required as string[]) ?? [])]).sort();
      if (JSON.stringify(props) !== JSON.stringify(req)) {
        fallos.push(`${r}: properties=[${props}] required=[${req}]`);
      }
    });
    expect(fallos).toEqual([]);
  });

  it("no usa ninguna palabra clave no soportada en modo estricto", () => {
    const fallos: string[] = [];
    recorrer(DOCUMENTO_JSON_SCHEMA.schema, "raiz", (n, r) => {
      for (const k of NO_SOPORTADAS) if (k in n) fallos.push(`${r}.${k}`);
    });
    expect(fallos).toEqual([]);
  });

  it("los campos que pueden faltar son union con null, no ausentes", () => {
    const props = DOCUMENTO_JSON_SCHEMA.schema.properties as Record<string, { type: unknown }>;
    for (const campo of ["proveedor", "cif", "subtotal", "iva", "total", "observaciones"]) {
      expect(props[campo].type, campo).toContain("null");
    }
    // numero_documento puede faltar desde el 10/10/2026 (notas de entrega sin
    // número): se guarda con un provisional. tipo sigue siendo obligatorio.
    expect(props.numero_documento.type).toContain("null");
    expect(props.tipo.type).toBe("string");
  });

  it("pide base_precio, que es lo que separa precio por pieza de precio por kilo", () => {
    const items = (DOCUMENTO_JSON_SCHEMA.schema.properties.productos as unknown as {
      items: { properties: Record<string, { enum?: readonly string[] }> };
    }).items;
    expect(Object.keys(items.properties)).toContain("base_precio");
    expect(items.properties.base_precio.enum).toContain("por_kg");
  });
});

// ============================================================================
//  2. validarEstructura — la segunda red
// ----------------------------------------------------------------------------
//  Todo lo que sigue lo deja pasar el pipeline de hoy sin decir nada.
// ============================================================================

describe("validarEstructura — formas que hoy se cuelan", () => {
  it("acepta un documento bien formado", () => {
    const r = validarEstructura(doc());
    expect(r.ok).toBe(true);
    expect(r.problemas).toEqual([]);
  });

  it("rechaza importes que llegan como texto en formato espanol", () => {
    // Hoy esto pasa: `toNumber("585,33")` lo convierte y nadie se entera de
    // que el modelo no devolvio un numero. Con el esquema estricto el modelo
    // ya no puede mandarlo, y si lo mandase, aqui salta.
    const r = validarEstructura(doc({ total: "585,33" as unknown as number }));
    expect(r.ok).toBe(false);
    expect(describirProblemas(r.problemas)).toContain("total");
  });

  it("rechaza NaN e Infinity, que `typeof x === number` deja pasar", () => {
    expect(validarEstructura(doc({ total: NaN })).ok).toBe(false);
    expect(validarEstructura(doc({ subtotal: Infinity })).ok).toBe(false);
  });

  it("rechaza una fecha que no es YYYY-MM-DD y dice cual es", () => {
    const r = validarEstructura(doc({ fecha: "03/09/2026" }));
    expect(r.ok).toBe(false);
    expect(r.problemas.some((p) => p.campo === "fecha")).toBe(true);
  });

  it("ACEPTA fecha null: hay documentos reales sin fecha impresa", () => {
    // La factura 1-701405 de Insula Roma (38.jpg) no lleva ninguna fecha. Con
    // `fecha` obligatoria, el modelo se la inventaba: se le vio sacarla de una
    // nota a lapiz al margen ("Servir Agosto 25" -> 2025-08-25). Permitir null
    // es lo que evita esa invencion.
    expect(validarEstructura(doc({ fecha: null })).ok).toBe(true);
  });

  it("y avisa de que se va a guardar con la fecha de subida", () => {
    const d = comprobarCuadre(doc({ fecha: null }));
    expect(d.map((x) => x.codigo)).toContain("fecha_ausente");
  });

  it("un documento sin fecha Y sin precios avisa solo de la fecha", () => {
    // El `return` temprano de sin_importes no puede tragarse este aviso.
    const d = comprobarCuadre(doc({
      fecha: null, sin_importes: true,
      productos: [linea({ precio_unitario: null, total: null })],
      subtotal: null, iva: null, total: null,
    }));
    expect(d.map((x) => x.codigo)).toEqual(["fecha_ausente"]);
  });

  it("acepta numero_documento vacio o null (nota sin numero), pero no otro tipo", () => {
    expect(validarEstructura(doc({ numero_documento: "" })).ok).toBe(true);
    expect(validarEstructura(doc({ numero_documento: null })).ok).toBe(true);
    expect(validarEstructura(doc({ numero_documento: 76 as unknown as string })).ok).toBe(false);
  });

  it("rechaza un tipo que no es factura ni albaran", () => {
    // `normalizarDatos` hoy convierte CUALQUIER cosa desconocida en "factura"
    // en silencio (index.ts: `else tipo = "factura"`), asi que un albaran mal
    // clasificado se guarda como factura y entra en las sumas de gasto.
    const r = validarEstructura(doc({ tipo: "presupuesto" as unknown as "factura" }));
    expect(r.ok).toBe(false);
    expect(r.problemas.some((p) => p.campo === "tipo")).toBe(true);
  });

  it("senala la RUTA exacta de la linea que falla, no solo 'hay un error'", () => {
    const r = validarEstructura(doc({
      productos: [linea(), linea({ cantidad: "doce" as unknown as number }), linea()],
    }));
    expect(r.ok).toBe(false);
    expect(r.problemas.map((p) => p.campo)).toContain("productos[1].cantidad");
  });

  it("acumula TODOS los problemas, no se para en el primero", () => {
    const r = validarEstructura(doc({
      fecha: "ayer",
      total: "mucho" as unknown as number,
      productos: [linea({ base_precio: "por_pieza" as never }), linea({ bonificada: "si" as never })],
    }));
    expect(r.ok).toBe(false);
    expect(r.problemas.length).toBeGreaterThanOrEqual(4);
  });

  it("exige base_precio: sin el no se puede distinguir EUR/ud de EUR/kg", () => {
    const { base_precio: _omitido, ...sinBase } = linea();
    const r = validarEstructura(doc({ productos: [sinBase as LineaExtraida] }));
    expect(r.ok).toBe(false);
    expect(r.problemas.some((p) => p.campo === "productos[0].base_precio")).toBe(true);
  });

  it("rechaza lo que no es un objeto", () => {
    expect(validarEstructura(null).ok).toBe(false);
    expect(validarEstructura([]).ok).toBe(false);
    expect(validarEstructura("{}").ok).toBe(false);
  });
});

// ============================================================================
//  3. comprobarCuadre — los DOS errores reales de produccion
// ============================================================================

// ============================================================================
//  EL CASO JOSELITO, BIEN ENTENDIDO
// ----------------------------------------------------------------------------
//  Durante meses se creyo que era "un x10 de OCR" (asi lo dejo escrito la
//  migracion 20260922120000). Al mirar el papel (albaran 2509134, foto 25.jpg)
//  resulta que no era eso en absoluto. El documento dice:
//
//    JAMON JOSELITO G.R. (2)           12,000      111,800
//    JAMON JOSELITO G.R. (1)            1,000        9,780
//    RAPPEL POR MARKETING Y ESCAPARATE -1,000
//
//  Son 12 piezas que pesan 111,800 kg y 1 pieza de 9,780 kg. Las columnas son
//  UNIDADES y KILOS. El albaran NO LLEVA NI UN PRECIO: ni euros por linea, ni
//  base, ni IVA, ni total.
//
//  Lo que se guardo: total 111.800,00 EUR y precio_unitario 9.316,67 EUR, que
//  es 111800/12 — un numero que no esta impreso en ninguna parte.
//
//  O sea, tres fallos encadenados:
//    1. la coma decimal leida como separador de miles (111,8 -> 111.800)
//    2. una columna de PESO interpretada como EUROS
//    3. un precio INVENTADO por division en un documento sin precios
//
//  Ninguno de los tres es un digito mal leido, asi que ninguno se arregla con
//  mas resolucion. Son de formato y de columnas: esquema y prompt.
// ============================================================================

describe("Joselito 2509134 — un albaran SIN PRECIOS leido como 111.800 EUR", () => {
  /** Lo que de verdad pone el papel. */
  const correcto = doc({
    tipo: "albaran",
    proveedor: "JOSELITO",
    numero_documento: "2509134",
    fecha: "2025-12-15",
    sin_importes: true,
    productos: [
      { nombre: "JAMON JOSELITO G.R. (2)", cantidad: 12, unidad: "ud", peso_kg: 111.8, base_precio: "desconocida", precio_unitario: null, total: null, bonificada: false },
      { nombre: "JAMON JOSELITO G.R. (1)", cantidad: 1, unidad: "ud", peso_kg: 9.78, base_precio: "desconocida", precio_unitario: null, total: null, bonificada: false },
      { nombre: "RAPPEL POR MARKETING Y ESCAPARATE", cantidad: -1, unidad: "ud", peso_kg: null, base_precio: "desconocida", precio_unitario: null, total: null, bonificada: false },
    ],
    subtotal: null, iva: null, total: null,
  });

  /** Lo que el sistema guardo de verdad en produccion. */
  const guardadoMal = doc({
    tipo: "albaran",
    proveedor: "JOSELITO",
    numero_documento: "2509134",
    sin_importes: true, // dice que no hay precios...
    productos: [
      { nombre: "JAMON JOSELITO G.R. (2)", cantidad: 12, unidad: "ud", peso_kg: null, base_precio: "por_unidad", precio_unitario: 9316.67, total: 111800, bonificada: false },
    ],
    subtotal: null, iva: null, total: 111800, // ...pero trae importes
  });

  it("la lectura CORRECTA se acepta: un albaran sin precios es valido", () => {
    const v = validarEstructura(correcto);
    expect(v.ok, describirProblemas(v.problemas)).toBe(true);
  });

  it("y no genera ni un solo aviso: no hay nada que cuadrar", () => {
    // Importante que sea cero. Un validador que protesta ante documentos
    // correctos se acaba ignorando.
    expect(comprobarCuadre(correcto)).toEqual([]);
  });

  it("el peso va a peso_kg y NUNCA a total", () => {
    expect(correcto.productos[0].peso_kg).toBe(111.8);
    expect(correcto.productos[0].total).toBeNull();
  });

  it("RECHAZA lo que se guardo: importes en un documento sin importes", () => {
    // Esta es la comprobacion que no existia. Un precio que no esta impreso
    // solo puede salir de un calculo inventado.
    const v = validarEstructura(guardadoMal);
    expect(v.ok).toBe(false);
    const texto = describirProblemas(v.problemas);
    expect(texto).toContain("sin_importes");
    expect(texto).toMatch(/inventado/i);
  });

  it("si ademas miente y dice que SI lleva precios, el cuadre lo caza igual", () => {
    // Cinturon y tirantes: aunque marcase sin_importes=false para colar los
    // numeros, 9.316,67 EUR/ud sigue siendo inverosimil y 111.800 EUR de
    // total tambien.
    const mintiendo = { ...guardadoMal, sin_importes: false };
    const codigos = comprobarCuadre(mintiendo).map((d) => d.codigo);
    expect(codigos).toContain("precio_unitario_extremo");
    expect(codigos).toContain("total_documento_extremo");
  });
});

describe("comprobarCuadre — Joselito interpretado como factura con precios", () => {
  // 12 jamones a 9.316,67 EUR/ud = 111.800,04 EUR de linea, con el albaran
  // declarando 120.580 EUR. La linea es internamente consistente
  // (cantidad x precio = total), que es justo por lo que el modelo la dio por
  // buena: la unica senal de que algo va mal es que NO CUADRA CON LA CABECERA
  // y que el precio unitario es inverosimil.
  const joselito = doc({
    tipo: "albaran",
    proveedor: "JOSELITO",
    numero_documento: "2509134",
    productos: [linea({
      nombre: "JAMON JOSELITO GRAN RESERVA",
      cantidad: 12,
      precio_unitario: 9316.67,
      total: 111800.04,
    })],
    subtotal: null,
    iva: null,
    total: 120580,
  });

  it("se detecta: hoy este documento se guarda sin que nada lo pare", () => {
    expect(comprobarCuadre(joselito).length).toBeGreaterThan(0);
  });

  it("marca el precio unitario como inverosimil, con severidad alta", () => {
    const d = comprobarCuadre(joselito).find((x) => x.codigo === "precio_unitario_extremo");
    expect(d).toBeDefined();
    expect(d!.severidad).toBe("alta");
    expect(d!.detalle.precio_unitario).toBe(9316.67);
  });

  it("detecta que las lineas no suman lo que declara el documento", () => {
    // 111.800,04 contra 120.580 -> 8.779,96 EUR de diferencia.
    const d = comprobarCuadre(joselito).find((x) => x.codigo === "descuadre_cabecera");
    expect(d).toBeDefined();
    expect(d!.detalle.suma_lineas).toBeCloseTo(111800.04, 2);
    expect(d!.detalle.referencia).toBeCloseTo(120580, 2);
  });

  it("marca el total del documento como desorbitado", () => {
    expect(codigos(joselito)).toContain("total_documento_extremo");
  });

  it("la linea en si NO se marca: cantidad x precio si cuadra con su total", () => {
    // Esto importa: el error no esta en la aritmetica de la linea, y decir lo
    // contrario mandaria al modelo a corregir donde no toca.
    expect(codigos(joselito)).not.toContain("descuadre_linea");
  });

  it("el mensaje correctivo apunta al precio unitario y no sugiere un valor", () => {
    const m = mensajeCorrectivo(comprobarCuadre(joselito));
    expect(m).toContain("9316.67");
    expect(m).toMatch(/NO inventes/i);
  });
});

describe("comprobarCuadre — caso real: MR FRIOSAT", () => {
  // 489,74 + 101,59 = 591,33, pero el total leido fue 585,33. Un digito mal.
  const friosat = doc({
    proveedor: "MR FRIOSAT",
    numero_documento: "FR-0001",
    productos: [linea({ nombre: "Genero congelado", cantidad: 1, precio_unitario: 489.74, total: 489.74 })],
    subtotal: 489.74,
    iva: 101.59,
    total: 585.33,
  });

  it("detecta que subtotal + IVA no da el total", () => {
    const d = comprobarCuadre(friosat).find((x) => x.codigo === "iva_incoherente");
    expect(d).toBeDefined();
    expect(d!.detalle.esperado).toBeCloseTo(591.33, 2);
    expect(d!.detalle.diferencia).toBeCloseTo(6.0, 2);
  });

  it("salta con MARGEN, no por los pelos como la tolerancia del 1% en SQL", () => {
    // `validar_cordura_factura` usa greatest(0.05, |total| * 0.01) = 5,85 EUR
    // para este documento. La diferencia real es 6,00: salta por 15 centimos.
    // Aqui la tolerancia es el redondeo de verdad posible (un centimo por
    // linea), asi que el margen es de casi 6 EUR en vez de 0,15.
    const d = comprobarCuadre(friosat).find((x) => x.codigo === "iva_incoherente")!;
    const toleranciaSql = Math.max(0.05, 585.33 * 0.01);
    expect(toleranciaSql).toBeCloseTo(5.8533, 3);
    expect(d.detalle.tolerancia as number).toBeLessThan(0.5);
  });

  it("un error de IVA que la tolerancia del 1% SI dejaria pasar, aqui salta", () => {
    // El agujero real del 1% relativo: en una factura de 5.000 EUR admite un
    // error de 50 EUR sin decir nada. `subtotal + iva = total` es aritmetica
    // exacta; no hay motivo para tanta holgura.
    const grande = doc({
      productos: [linea({ cantidad: 1, precio_unitario: 4132.23, total: 4132.23 })],
      subtotal: 4132.23,
      iva: 867.77,
      total: 4960.0, // deberia ser 5.000,00 -> 40 EUR de error
    });
    expect(Math.abs(5000 - 4960)).toBeLessThan(4960 * 0.01); // el 1% lo dejaria pasar
    expect(codigos(grande)).toContain("iva_incoherente");    // esto no
  });
});

// ============================================================================
//  4. Que NO se dispare donde no debe
// ----------------------------------------------------------------------------
//  Un validador que grita en documentos buenos se acaba ignorando, y entonces
//  no sirve para nada.
// ============================================================================

describe("comprobarCuadre — documentos correctos no generan ruido", () => {
  it("una factura que cuadra no produce ningun descuadre", () => {
    expect(comprobarCuadre(doc())).toEqual([]);
  });

  it("un albaran sin importes (solo cantidades) no produce descuadres", () => {
    expect(comprobarCuadre(doc({
      tipo: "albaran",
      productos: [linea({ precio_unitario: null, total: null })],
      subtotal: null, iva: null, total: null,
    }))).toEqual([]);
  });

  it("una linea bonificada (regalo, total 0) no se marca como descuadre", () => {
    // Antes esto no se podia distinguir de un error: el prompt pedia un campo
    // `notas` en texto libre que `normalizarDatos` tiraba a la basura. Ahora
    // es un booleano del esquema.
    const d = doc({
      productos: [
        linea({ total: 100 }),
        linea({ nombre: "Regalo", cantidad: 2, precio_unitario: 5, total: 0, bonificada: true }),
      ],
      subtotal: 100, iva: 10, total: 110,
    });
    expect(codigos(d)).not.toContain("descuadre_linea");
  });

  it("un descuento de linea del 15% es normal y no salta", () => {
    const d = doc({
      productos: [linea({ cantidad: 10, precio_unitario: 10, total: 85 })],
      subtotal: 85, iva: 8.5, total: 93.5,
    });
    expect(codigos(d)).not.toContain("descuadre_linea");
  });

  it("el redondeo a centimos no dispara el cuadre del IVA", () => {
    const d = doc({ subtotal: 100.005, iva: 10.001, total: 110.0 });
    expect(codigos(d)).not.toContain("iva_incoherente");
  });

  it("un precio por kilo alto pero plausible no salta", () => {
    const d = doc({
      productos: [linea({ nombre: "Angulas", cantidad: 0.5, unidad: "kg", base_precio: "por_kg", precio_unitario: 900, total: 450 })],
      subtotal: 450, iva: 45, total: 495,
    });
    expect(comprobarCuadre(d)).toEqual([]);
  });
});

describe("comprobarCuadre — deteccion de linea descuadrada", () => {
  it("detecta que el total de linea no es cantidad x precio", () => {
    const d = doc({
      productos: [linea({ cantidad: 12, precio_unitario: 10, total: 1200 })], // deberia ser 120
      subtotal: 1200, iva: 120, total: 1320,
    });
    const x = comprobarCuadre(d).find((c) => c.codigo === "descuadre_linea");
    expect(x).toBeDefined();
    expect(x!.detalle.esperado).toBeCloseTo(120, 2);
    expect(x!.mensaje).toContain("Producto");
  });
});

// ============================================================================
//  5. Encaje con lo que ya existe
// ============================================================================

describe("contarCambiosNumericos — defensa contra el cuadre inventado", () => {
  // Hay medidas publicadas (ReceiptBench, 2026) de modelos que alteran precios
  // e inventan importes de IVA para forzar que las sumas cuadren. Como el
  // reintento le pide justamente que cuadre, hace falta distinguir "ha
  // corregido un digito" de "ha reescrito el documento".

  it("no ve cambios entre una lectura y ella misma", () => {
    expect(contarCambiosNumericos(doc(), doc()).total).toBe(0);
  });

  it("corregir un digito mal leido cuenta como UN cambio", () => {
    // El caso MR FRIOSAT resuelto bien: solo se toca el total.
    const antes = doc({ subtotal: 489.74, iva: 101.59, total: 585.33 });
    const despues = doc({ subtotal: 489.74, iva: 101.59, total: 591.33 });
    const c = contarCambiosNumericos(antes, despues);
    expect(c.total).toBe(1);
    expect(c.campos).toEqual(["total"]);
    expect(c.total).toBeLessThanOrEqual(MAX_CAMBIOS_RELECTURA);
  });

  it("un precio mal leido que arrastra su linea y el subtotal sigue siendo aceptable", () => {
    const antes = doc({
      productos: [linea({ cantidad: 12, precio_unitario: 9316.67, total: 111800.04 })],
      subtotal: 111800.04, iva: 11180, total: 122980.04,
    });
    const despues = doc({
      productos: [linea({ cantidad: 12, precio_unitario: 931.67, total: 11180.04 })],
      subtotal: 111800.04, iva: 11180, total: 122980.04,
    });
    expect(contarCambiosNumericos(antes, despues).total).toBeLessThanOrEqual(MAX_CAMBIOS_RELECTURA);
  });

  it("reescribir medio documento se detecta y supera el umbral", () => {
    const antes = doc({
      productos: [linea({ total: 100 }), linea({ total: 50, precio_unitario: 5 })],
      subtotal: 150, iva: 15, total: 165,
    });
    const despues = doc({
      productos: [
        linea({ cantidad: 11, precio_unitario: 11, total: 121 }),
        linea({ cantidad: 7, precio_unitario: 7, total: 49 }),
      ],
      subtotal: 170, iva: 17, total: 187,
    });
    expect(contarCambiosNumericos(antes, despues).total).toBeGreaterThan(MAX_CAMBIOS_RELECTURA);
  });

  it("cambiar el numero de lineas cuenta por si solo", () => {
    const c = contarCambiosNumericos(
      doc({ productos: [linea(), linea()] }),
      doc({ productos: [linea()] }),
    );
    expect(c.campos).toContain("productos.length");
  });

  it("no confunde el ruido de coma flotante con un cambio de lectura", () => {
    const c = contarCambiosNumericos(doc({ total: 110 }), doc({ total: 110.000000001 }));
    expect(c.total).toBe(0);
  });

  it("null -> numero SI es un cambio (rellenar un hueco que no se veia)", () => {
    expect(contarCambiosNumericos(doc({ iva: null }), doc({ iva: 10 })).campos).toContain("iva");
  });
});

describe("descuadresComoAlertas — mismo formato que validar_cordura_factura", () => {
  it("produce codigo/severidad/mensaje/detalle y marca el origen", () => {
    const alertas = descuadresComoAlertas(
      comprobarCuadre(doc({ subtotal: 100, iva: 10, total: 200 })),
      "pre-guardado",
    );
    expect(alertas.length).toBeGreaterThan(0);
    for (const a of alertas) {
      expect(a).toHaveProperty("codigo");
      expect(a).toHaveProperty("severidad");
      expect(a).toHaveProperty("mensaje");
      expect(a.detalle.origen).toBe("pre-guardado");
    }
  });

  it("usa los mismos codigos que la funcion SQL, para no inventar vocabulario", () => {
    // `validar_cordura_factura` (20260922130000) emite: descuadre_linea,
    // descuadre_cabecera, iva_incoherente, precio_unitario_extremo,
    // total_documento_extremo, total_documento_irrisorio,
    // precio_atipico_historico. Los cinco que se pueden comprobar sin tocar
    // la base de datos se llaman aqui igual.
    const DE_SQL = [
      "descuadre_linea", "descuadre_cabecera", "iva_incoherente",
      "precio_unitario_extremo", "total_documento_extremo",
    ];
    const emitidos = new Set<string>();
    for (const d of [
      doc({ productos: [linea({ cantidad: 12, precio_unitario: 10, total: 1200 })], subtotal: 1200, iva: 120, total: 1320 }),
      doc({ subtotal: 100, iva: 10, total: 200 }),
      doc({ productos: [linea({ precio_unitario: 99999, total: 99999, cantidad: 1 })], subtotal: 99999, iva: 0, total: 99999 }),
    ]) for (const x of comprobarCuadre(d)) emitidos.add(x.codigo);

    for (const c of emitidos) expect(DE_SQL).toContain(c);
  });
});

// ============================================================================
//  5. deducirImportes — recuperar un total que el documento no imprime
// ----------------------------------------------------------------------------
//  Caso real: factura F/25011959 de Salazones Garre (24/12/2025). Es una
//  FACTURA, trae tres lineas con importe leido, y en la foto el bloque de
//  totales se quedo FUERA DEL ENCUADRE. El modelo hizo lo correcto —no
//  inventar lo que no ve— y la fila quedo con subtotal, iva y total a NULL,
//  cuando antes valia 436,92.
//
//  Lo que estos tests fijan no es solo que 436,92 vuelva: es DONDE esta la
//  frontera. Deducir con aritmetica exacta en nuestro codigo y que el modelo
//  invente numeros para que le cuadren las sumas son cosas opuestas, y la
//  unica forma de que no se confundan es que las reglas esten escritas:
//   · nunca se pisa un valor leido,
//   · sin el tipo de IVA de cada linea, la suma de lineas es la BASE: va a
//     subtotal y el total se queda a null (06/10/2026, Luga: la base guardada
//     como total entraba en el gasto "IVA incluido" del chatbot),
//   · nunca se inventa un tipo de IVA,
//   · nunca se deduce sobre un albaran sin precios,
//   · nunca se deduce con una linea sin importe,
//   · y el umbral de `MAX_CAMBIOS_RELECTURA` sigue donde estaba.
// ============================================================================

/** Las tres lineas tal y como estan impresas en F/25011959. */
const lineasGarre = (): LineaExtraida[] => [
  linea({ nombre: "HUEVA DE MARUCA CALIDAD EXTRA", cantidad: 4.96, unidad: "kg", base_precio: "por_kg", precio_unitario: 42, total: 208.32 }),
  linea({ nombre: "HUEVA DE MUJOL SELECCION EXTRA", cantidad: 1.5, unidad: "kg", base_precio: "por_kg", precio_unitario: 70, total: 105 }),
  linea({ nombre: "BONITO ENTERO", cantidad: 10.3, unidad: "kg", base_precio: "por_kg", precio_unitario: 12, total: 123.6 }),
];

/** F/25011959 tal y como la lee hoy el modelo: lineas si, totales no. */
const garre = (over: Partial<DocumentoExtraido> = {}) =>
  doc({
    tipo: "factura",
    proveedor: "SALAZONES GARRE",
    cif: "B-73028474",
    numero_documento: "F/25011959",
    fecha: "2025-12-24",
    sin_importes: false,
    productos: lineasGarre(),
    subtotal: null,
    iva: null,
    total: null,
    ...over,
  });

/** Documento con `total` ausente y el bloque de totales leido a medias. La
 *  linea se construye cuadrando con el subtotal cuando lo hay, para que el
 *  unico dato en discusion sea que falta del bloque. */
const doTotalAusente = (over: { subtotal: number | null; iva: number | null }) => {
  const importe = over.subtotal ?? 436.92;
  return deducirImportes(
    doc({
      productos: [linea({ cantidad: 1, precio_unitario: importe, total: importe })],
      subtotal: over.subtotal,
      iva: over.iva,
      total: null,
    }),
  );
};

describe("deducirImportes — Salazones Garre F/25011959 (totales fuera del encuadre)", () => {
  it("recupera los 436,92 sumando las tres lineas, como BASE", () => {
    const { datos, deduccion } = deducirImportes(garre());
    expect(datos.subtotal).toBe(436.92);
    expect(deduccion?.campo).toBe("subtotal");
    expect(deduccion?.valor).toBe(436.92);
    expect(deduccion?.metodo).toBe("base_sin_iva");
  });

  it("lo redondea a centimos: 208.32 + 105 + 123.6 da 436.92000000000004 en coma flotante", () => {
    // Sin redondear, ese numero llega tal cual a una columna NUMERIC(10,2).
    expect(208.32 + 105 + 123.6).not.toBe(436.92);
    expect(deducirImportes(garre()).datos.subtotal).toBe(436.92);
  });

  it("NO inventa el IVA: sin el tipo de cada linea, iva y TOTAL siguen a null", () => {
    // El tipo podria ser el 10% de alimentacion o el 21%, y no esta impreso en
    // ninguna parte. Y la base NO se presenta como total: el chatbot suma
    // `total` como IVA incluido (caso Luga 54, 06/10/2026).
    const { datos } = deducirImportes(garre());
    expect(datos.iva).toBeNull();
    expect(datos.total).toBeNull();
  });

  it("deja un aviso falta_iva que dice que es la BASE y que el total se deja vacio", () => {
    const { deduccion } = deducirImportes(garre());
    expect(deduccion?.alerta.codigo).toBe("falta_iva");
    expect(deduccion?.alerta.severidad).toBe("media");
    expect(deduccion?.alerta.mensaje).toMatch(/BASE/);
    expect(deduccion?.alerta.mensaje).toMatch(/falta el IVA/);
    expect(deduccion?.alerta.mensaje).toMatch(/VACIO/);
    expect(deduccion?.alerta.detalle.origen).toBe("deduccion");
    expect(deduccion?.alerta.detalle.num_lineas).toBe(3);
    expect(deduccion?.alerta.detalle.lineas_sin_tipo).toBe(3);
    expect(deduccion?.alerta.detalle.total).toBeNull();
  });

  it("no muta el documento de entrada", () => {
    const entrada = garre();
    deducirImportes(entrada);
    expect(entrada.total).toBeNull();
    expect(entrada.subtotal).toBeNull();
  });
});

describe("deducirImportes — lo que NO se toca", () => {
  it("un total LEIDO del papel no se recalcula aunque no cuadre con las lineas", () => {
    // Si el papel dice 500 y las lineas suman 436,92, el descuadre es un dato
    // y lo canta `comprobarCuadre`. Pisarlo con la suma seria exactamente el
    // comportamiento del que defiende `contarCambiosNumericos`.
    const leido = garre({ total: 500 });
    const { datos, deduccion } = deducirImportes(leido);
    expect(datos.total).toBe(500);
    expect(deduccion).toBeNull();
    expect(codigos(leido)).toContain("descuadre_cabecera");
  });

  it("un total leido de 0 (documento todo bonificado) tampoco se pisa", () => {
    const regalo = doc({
      productos: [linea({ total: 0, precio_unitario: 0, bonificada: true })],
      subtotal: null, iva: null, total: 0,
    });
    expect(deducirImportes(regalo).deduccion).toBeNull();
    expect(deducirImportes(regalo).datos.total).toBe(0);
  });

  it("el albaran de Joselito SIN PRECIOS se queda SIN TOTAL", () => {
    // El caso que no puede romperse: `sin_importes` significa que en el papel
    // no hay ni un euro. No hay nada que sumar, y un total ahi solo podria
    // salir de un calculo inventado — que es el bug original.
    const joselito = doc({
      tipo: "albaran",
      proveedor: "JOSELITO",
      numero_documento: "2509134",
      sin_importes: true,
      productos: [
        linea({ nombre: "JAMON JOSELITO G.R. (2)", cantidad: 12, peso_kg: 111.8, base_precio: "desconocida", precio_unitario: null, total: null }),
        linea({ nombre: "JAMON JOSELITO G.R. (1)", cantidad: 1, peso_kg: 9.78, base_precio: "desconocida", precio_unitario: null, total: null }),
      ],
      subtotal: null, iva: null, total: null,
    });
    const { datos, deduccion } = deducirImportes(joselito);
    expect(datos.total).toBeNull();
    expect(datos.subtotal).toBeNull();
    expect(datos.iva).toBeNull();
    expect(deduccion).toBeNull();
  });

  it("un albaran sin precios NO cuela ni aunque olvide marcar sin_importes", () => {
    // Cinturon y tirantes: si `sin_importes` viniese mal puesto, las lineas
    // siguen sin importe y la regla de 'todas las lineas con importe' corta.
    const sinMarca = doc({
      tipo: "albaran",
      sin_importes: false,
      productos: [linea({ precio_unitario: null, total: null }), linea({ precio_unitario: null, total: null })],
      subtotal: null, iva: null, total: null,
    });
    expect(deducirImportes(sinMarca).deduccion).toBeNull();
    expect(deducirImportes(sinMarca).datos.total).toBeNull();
  });

  it("basta con que UNA linea se quede sin importe para no deducir nada", () => {
    // La suma seria la de lo que se pudo leer, no la del documento. Darla por
    // total es presentar un numero incompleto como completo.
    const incompleto = garre({
      productos: [...lineasGarre().slice(0, 2), linea({ nombre: "BONITO ENTERO", precio_unitario: null, total: null })],
    });
    expect(deducirImportes(incompleto).deduccion).toBeNull();
    expect(deducirImportes(incompleto).datos.total).toBeNull();
  });

  it("un documento sin ninguna linea no da pie a deducir un total de cero", () => {
    const vacio = garre({ productos: [] });
    expect(deducirImportes(vacio).deduccion).toBeNull();
    expect(deducirImportes(vacio).datos.total).toBeNull();
  });
});

describe("deducirImportes — el bloque de totales a medias no se reconstruye", () => {
  it("con subtotal e IVA leidos y total ausente, total = subtotal + IVA", () => {
    // Aritmetica exacta sobre dos importes impresos: cero supuestos.
    const { datos, deduccion } = doTotalAusente({ subtotal: 489.74, iva: 101.59 });
    expect(datos.total).toBe(591.33);
    expect(deduccion?.metodo).toBe("subtotal_mas_iva");
    expect(deduccion?.alerta.detalle.metodo).toBe("subtotal_mas_iva");
  });

  it("con subtotal leido pero SIN IVA no se deduce: el tipo no esta impreso", () => {
    // Que el documento imprima la base significa que TIENE bloque de totales
    // y solo hemos leido un trozo. Completarlo seria reconstruirlo a ojo.
    const { datos, deduccion } = doTotalAusente({ subtotal: 436.92, iva: null });
    expect(datos.total).toBeNull();
    expect(deduccion).toBeNull();
  });

  it("con IVA leido pero SIN base tampoco se deduce", () => {
    const { datos, deduccion } = doTotalAusente({ subtotal: null, iva: 43.69 });
    expect(datos.total).toBeNull();
    expect(deduccion).toBeNull();
  });

  it("nunca escribe en subtotal ni en iva, tampoco por resta", () => {
    // Deducir `iva = total - subtotal` seria exacto, pero destruiria la
    // redundancia con la que `comprobarCuadre` detecta un total mal leido:
    // la comprobacion (c) pasaria siempre por construccion.
    const { datos } = doTotalAusente({ subtotal: 489.74, iva: 101.59 });
    expect(datos.subtotal).toBe(489.74);
    expect(datos.iva).toBe(101.59);
  });
});

describe("deducirImportes — no puede silenciar ninguna comprobacion", () => {
  it("solo rellena huecos, asi que `comprobarCuadre` ve lo mismo antes y despues", () => {
    // Un documento con descuadre real: el total leido no es la suma de lineas.
    const malo = garre({ total: 500 });
    const antes = comprobarCuadre(malo);
    const { datos } = deducirImportes(malo);
    expect(comprobarCuadre(datos)).toEqual(antes);
    expect(antes.map((d) => d.codigo)).toContain("descuadre_cabecera");
  });

  it("la referencia de `comprobarCuadre` sigue siendo el subtotal LEIDO", () => {
    // Si la deduccion escribiese la suma de lineas en `subtotal`, esta
    // comprobacion se compararia consigo misma y no detectaria nada.
    const conSubtotalMalo = garre({ subtotal: 500, iva: 50 });
    const { datos } = deducirImportes(conSubtotalMalo);
    expect(datos.subtotal).toBe(500);
    expect(comprobarCuadre(datos).map((d) => d.codigo)).toContain("descuadre_cabecera");
  });

  it("el umbral de la relectura sigue siendo 3: deducir no lo toca", () => {
    // La defensa contra el modelo que reescribe el documento para que cuadre
    // es independiente de esto y no se relaja.
    expect(MAX_CAMBIOS_RELECTURA).toBe(3);
  });

  it("una relectura que reescribe medio documento se sigue descartando", () => {
    const antes = garre();
    const recompuesto = garre({
      productos: [
        linea({ cantidad: 4.96, precio_unitario: 40, total: 198.4 }),
        linea({ cantidad: 1.5, precio_unitario: 65, total: 97.5 }),
        linea({ cantidad: 10.3, precio_unitario: 11, total: 113.3 }),
      ],
      subtotal: 409.2, iva: 40.92, total: 450.12,
    });
    expect(contarCambiosNumericos(antes, recompuesto).total).toBeGreaterThan(MAX_CAMBIOS_RELECTURA);
  });

  it("el aviso de la deduccion tiene el mismo formato que los de validar_cordura_factura", () => {
    // La UI y el chatbot no tienen que distinguir de donde vino cada alerta.
    const { deduccion } = deducirImportes(garre());
    expect(Object.keys(deduccion!.alerta).sort()).toEqual(["codigo", "detalle", "mensaje", "severidad"]);
    expect(["alta", "media"]).toContain(deduccion!.alerta.severidad);
  });
});


// ============================================================================
//  9. La tolerancia de cabecera, medida sobre los 19 documentos reales
// ----------------------------------------------------------------------------
//  Los numeros de estos tests NO son inventados. Salen de comparar la suma de
//  lineas del GROUND TRUTH humano (una lectura perfecta, hecha a mano) contra
//  el subtotal impreso, documento por documento:
//
//    · 17 de 19 cuadran EXACTO (diferencia 0,00 EUR).
//    · Campoluz AL2025/0009781: 6,00 EUR de diferencia LEGITIMA (canon de
//      punto verde, que esta en la base imponible pero no es una fila de la
//      tabla). Base 2.488,11 -> 0,241 %.
//    · Campoluz AL2025/0009780: 0,72 EUR por lo mismo. Base 262,78 -> 0,274 %.
//
//  Y el error que hay que cazar: en ese mismo 0009781 el sistema leyo una sola
//  botella de BRUGAL 1888 donde el papel pone dos, y la suma de lineas quedo
//  en 2.450,43 frente a 2.488,11 -> 37,68 EUR de agujero. Con el 2 % de antes
//  la tolerancia era 49,76 EUR y no saltaba NADA.
// ============================================================================

describe("toleranciaCabecera — suelo, porcentaje y TECHO", () => {
  it("tolera el canon de punto verde de Campoluz (6,00 EUR sobre 2.488,11)", () => {
    expect(toleranciaCabecera(2488.11)).toBeGreaterThan(6.0);
  });

  it("caza la botella de BRUGAL que faltaba (37,68 EUR sobre 2.488,11)", () => {
    expect(toleranciaCabecera(2488.11)).toBeLessThan(37.68);
  });

  it("el 2 % de antes SI dejaba pasar esa botella", () => {
    // La prueba de que el cambio hacia falta, no de que el numero nuevo sea magico.
    expect(2488.11 * 0.02).toBeGreaterThan(37.68);
  });

  it("tolera el canon del albaran pequeno (0,72 EUR sobre 262,78)", () => {
    expect(toleranciaCabecera(262.78)).toBeGreaterThan(0.72);
  });

  it("el TECHO impide que la tolerancia crezca con el documento", () => {
    // Es la pieza que faltaba: una tolerancia relativa pura convierte cada
    // factura grande en un sitio donde caben botellas enteras.
    expect(toleranciaCabecera(12513.5)).toBe(15);
    expect(toleranciaCabecera(1e6)).toBe(15);
    expect(12513.5 * 0.02).toBeGreaterThan(200); // lo que toleraba antes
  });

  it("nunca baja del suelo (0,50 EUR desde el 10/10/2026), ni en documentos de dos euros", () => {
    expect(toleranciaCabecera(1)).toBe(0.5);
    expect(toleranciaCabecera(0)).toBe(0.5);
  });

  it("los cargos fijos del pie (embalaje 1,82, portes 1,60, RGA 1,97) ya no caben en la tolerancia", () => {
    // 385 N. y Valero: lineas 316,23 frente a base 318,05; 366 Altamira 199,57/201,17; 341 Luga 317,51/319,48.
    for (const [suma, base] of [[316.23, 318.05], [199.57, 201.17], [317.51, 319.48], [87.0, 88.82], [214.34, 216.16]]) {
      expect(Math.abs(base - suma)).toBeGreaterThan(toleranciaCabecera(base));
    }
    // El canon de Campoluz 0009780 (0,72 sobre ~263) sigue dentro.
    expect(0.72).toBeLessThan(toleranciaCabecera(262.78));
  });

  it("es monotona: mas documento, nunca menos tolerancia", () => {
    let previa = 0;
    for (const ref of [0, 10, 100, 262.78, 1000, 2488.11, 5000, 12513.5, 1e6]) {
      const t = toleranciaCabecera(ref);
      expect(t).toBeGreaterThanOrEqual(previa);
      previa = t;
    }
  });

  it("sobre el documento real: 19 lineas que suman 2.450,43 frente a 2.488,11 -> descuadre", () => {
    const campoluz = doc({
      tipo: "albaran",
      proveedor: "BODEGA CAMPOLUZ, S.L.",
      numero_documento: "AL2025/0009781",
      productos: [linea({ cantidad: 1, precio_unitario: 2450.43, total: 2450.43 })],
      subtotal: 2488.11, iva: 522.5, total: 3010.61,
    });
    const d = comprobarCuadre(campoluz).find((x) => x.codigo === "descuadre_cabecera");
    expect(d).toBeDefined();
    expect(d!.detalle.tolerancia).toBeLessThan(37.68);
  });

  it("y con la lectura buena (2.482,11) NO hay descuadre", () => {
    const campoluz = doc({
      tipo: "albaran",
      productos: [linea({ cantidad: 1, precio_unitario: 2482.11, total: 2482.11 })],
      subtotal: 2488.11, iva: 522.5, total: 3010.61,
    });
    expect(codigos(campoluz)).not.toContain("descuadre_cabecera");
  });
});

// ============================================================================
//  10. Lectura incompleta: contar las filas es lo unico que delata el colapso
// ----------------------------------------------------------------------------
//  Factura ML/101511 de Luga Sabores: 54 filas impresas (una factura mensual
//  que agrupa 6 albaranes, con NATOP, MAYONESA o ESPINAS repetidos tres y
//  cuatro veces), y la extraccion devolvia 11 — exactamente el numero de
//  productos DISTINTOS, con CERO nombres repetidos. Aritmeticamente no se
//  nota: las 11 lineas cuadran entre si.
// ============================================================================

describe("comprobarCuadre — lectura incompleta", () => {
  const luga = (over: Partial<DocumentoExtraido> = {}) => doc({
    proveedor: "LUGA SABORES S.L.",
    numero_documento: "ML/101511",
    productos: [linea({ nombre: "NATOP", cantidad: 1, precio_unitario: 10, total: 10 })],
    subtotal: null, iva: null, total: null,
    filas_tabla: 54,
    continua_en_otra_pagina: false,
    ...over,
  });

  it("salta si el papel tiene 54 filas y se han extraido 11", () => {
    const d = comprobarCuadre(luga({
      productos: Array.from({ length: 11 }, () => linea({ total: 10, precio_unitario: 10, cantidad: 1 })),
    })).find((x) => x.codigo === "lineas_incompletas");
    expect(d).toBeDefined();
    expect(d!.severidad).toBe("alta");
    expect(d!.detalle.filas_impresas).toBe(54);
    expect(d!.detalle.lineas_extraidas).toBe(11);
    expect(d!.detalle.diferencia).toBe(43);
  });

  it("no salta cuando el recuento cuadra", () => {
    expect(codigos(luga({
      filas_tabla: 1,
    }))).not.toContain("lineas_incompletas");
  });

  it("tambien salta si SOBRAN lineas (una fila partida en dos)", () => {
    const d = comprobarCuadre(luga({
      filas_tabla: 1,
      productos: [linea({ total: 10 }), linea({ total: 10 })],
      subtotal: 20,
    })).find((x) => x.codigo === "lineas_incompletas");
    expect(d).toBeDefined();
    expect(d!.severidad).toBe("media"); // sobrar es menos grave que faltar
  });

  it("un albaran SIN PRECIOS tambien se cuenta: no llevar euros no es no llevar filas", () => {
    const sinPrecios = doc({
      sin_importes: true,
      filas_tabla: 12,
      productos: [linea({ precio_unitario: null, total: null })],
      subtotal: null, iva: null, total: null,
    });
    expect(codigos(sinPrecios)).toContain("lineas_incompletas");
  });

  it("una tabla vacia salta siempre, aunque no haya recuento", () => {
    const d = comprobarCuadre(luga({ productos: [], filas_tabla: null, subtotal: null }))
      .find((x) => x.codigo === "sin_lineas");
    expect(d).toBeDefined();
    expect(d!.severidad).toBe("alta");
  });

  it("si el modelo no ha podido contar, se dice: la lectura se queda sin red", () => {
    expect(codigos(luga({ filas_tabla: null }))).toContain("recuento_filas_ausente");
  });

  it("un documento sin el campo (respuesta antigua) no genera ruido", () => {
    const antiguo = doc({ subtotal: 100, iva: 10, total: 110 });
    delete (antiguo as Record<string, unknown>).filas_tabla;
    const c = codigos(antiguo);
    expect(c).not.toContain("lineas_incompletas");
    expect(c).not.toContain("recuento_filas_ausente");
  });
});

// ============================================================================
//  11. La cita: un importe que no se puede citar no se ha leido
// ----------------------------------------------------------------------------
//  Factura 40295280 de Osborne, foto cortada por abajo: el papel imprime BASE
//  342,10 y cuota 34,21, y la fila del TOTAL queda fuera del encuadre. Se
//  guardaba total = 376,31 marcado como LEIDO y sin una sola alerta.
// ============================================================================

describe("leerImporteLiteral — leer la cita sin volverse loco con el formato", () => {
  it("formato espanol", () => {
    expect(leerImporteLiteral("2.488,11")).toBe(2488.11);
    expect(leerImporteLiteral("342,10 EUR")).toBe(342.1);
    expect(leerImporteLiteral("3.010,61EUR")).toBe(3010.61);
  });
  it("formato anglosajon", () => {
    expect(leerImporteLiteral("1,130.47")).toBe(1130.47);
  });
  it("varias cuotas de IVA citadas juntas se suman", () => {
    expect(leerImporteLiteral("12,30 + 45,10")).toBe(57.4);
  });
  it("lo que no es un importe devuelve null", () => {
    expect(leerImporteLiteral("")).toBeNull();
    expect(leerImporteLiteral("TOTAL")).toBeNull();
  });
});

describe("retirarImportesNoImpresos — el numero sin cita se retira", () => {
  const osborne = (over: Partial<DocumentoExtraido> = {}) => doc({
    proveedor: "Osborne",
    numero_documento: "40295280",
    productos: [linea({ cantidad: 2, precio_unitario: 171.05, total: 342.1 })],
    subtotal: 342.1, subtotal_literal: "342,10 EUR",
    iva: 34.21, iva_literal: "34,21 EUR",
    total: 376.31, total_literal: null,
    filas_tabla: 1,
    ...over,
  });

  it("retira el total que el modelo no puede citar", () => {
    const { datos, retiradas } = retirarImportesNoImpresos(osborne());
    expect(datos.total).toBeNull();
    expect(retiradas).toHaveLength(1);
    expect(retiradas[0].campo).toBe("total");
    expect(retiradas[0].valor).toBe(376.31);
    expect(retiradas[0].alerta.codigo).toBe("importe_no_impreso");
    expect(retiradas[0].alerta.severidad).toBe("alta");
  });

  it("y despues la deduccion lo repone CALCULADO, que es lo honesto", () => {
    // Retirar no pierde el dato: lo cambia de sitio. 376,31 vuelve, pero como
    // `deducido` y con su aviso, que es justo la diferencia que el dueno tiene
    // que poder ver de un vistazo.
    const { datos } = retirarImportesNoImpresos(osborne());
    const { datos: final, deduccion } = deducirImportes(datos);
    expect(final.total).toBe(376.31);
    expect(deduccion?.metodo).toBe("subtotal_mas_iva");
    expect(deduccion?.alerta.codigo).toBe("total_deducido");
  });

  it("no toca lo que SI esta citado", () => {
    const { datos, retiradas } = retirarImportesNoImpresos(osborne({ total_literal: "376,31 EUR" }));
    expect(datos.total).toBe(376.31);
    expect(retiradas).toHaveLength(0);
  });

  it("avisa si el numero y su propia cita no dicen lo mismo", () => {
    const { datos, discordancias } = retirarImportesNoImpresos(
      osborne({ total: 37631, total_literal: "376,31 EUR" }),
    );
    expect(datos.total).toBe(37631); // no se retira: no se sabe cual esta mal
    expect(discordancias).toHaveLength(1);
    expect(discordancias[0].codigo).toBe("importe_literal_discordante");
  });

  it("una respuesta SIN citas (modelo distinto, payload antiguo) no retira nada", () => {
    const antiguo = doc({ subtotal: 100, iva: 10, total: 110 });
    delete (antiguo as Record<string, unknown>).total_literal;
    delete (antiguo as Record<string, unknown>).subtotal_literal;
    delete (antiguo as Record<string, unknown>).iva_literal;
    const { datos, retiradas } = retirarImportesNoImpresos(antiguo);
    expect(datos.total).toBe(110);
    expect(retiradas).toHaveLength(0);
  });

  it("no muta el documento de entrada", () => {
    const entrada = osborne();
    retirarImportesNoImpresos(entrada);
    expect(entrada.total).toBe(376.31);
  });
});

describe("retirarImportesNoImpresos — la segunda mirada al pie", () => {
  const verif = (over: Partial<VerificacionPie> = {}): VerificacionPie => ({
    ultimo_texto_visible: "34,21 EUR",
    fila_total_impresa: false,
    total_citado: null,
    base_imponible_citada: "342,10 EUR",
    cuota_iva_citada: "34,21 EUR",
    motivo: "la fila del TOTAL queda por debajo del borde de la imagen",
    ...over,
  });
  const osborne = (over: Partial<DocumentoExtraido> = {}) => doc({
    productos: [linea({ cantidad: 2, precio_unitario: 171.05, total: 342.1 })],
    subtotal: 342.1, subtotal_literal: "342,10 EUR",
    iva: 34.21, iva_literal: "34,21 EUR",
    total: 376.31, total_literal: "376,31 EUR",
    filas_tabla: 1,
    ...over,
  });

  it("retira el total aunque el modelo se haya inventado tambien la cita", () => {
    // Es el caso medido: 1 de cada 3 lecturas fabricaba numero Y cita. La
    // segunda mirada, que solo mira el pie, acierta 3 de 3.
    const { datos, retiradas } = retirarImportesNoImpresos(osborne(), verif());
    expect(datos.total).toBeNull();
    expect(retiradas[0].alerta.detalle.origen).toBe("verificacion_pie");
    expect(retiradas[0].alerta.mensaje).toMatch(/34,21 EUR/); // lo ultimo que se ve
  });

  it("si el verificador SI ve la fila del total, no se retira nada", () => {
    const { datos, retiradas } = retirarImportesNoImpresos(
      osborne(), verif({ fila_total_impresa: true, total_citado: "376,31 EUR" }),
    );
    expect(datos.total).toBe(376.31);
    expect(retiradas).toHaveLength(0);
  });

  it("dos lecturas que discrepan se avisan, pero no se pisan", () => {
    const { datos, discordancias } = retirarImportesNoImpresos(
      osborne(), verif({ fila_total_impresa: true, total_citado: "376,37 EUR" }),
    );
    expect(datos.total).toBe(376.31);
    expect(discordancias.map((d) => d.codigo)).toContain("importe_discordante_verificador");
  });

  it("sin verificacion (la llamada fallo) el documento sigue su camino", () => {
    const { datos, retiradas } = retirarImportesNoImpresos(osborne(), null);
    expect(datos.total).toBe(376.31);
    expect(retiradas).toHaveLength(0);
  });

  it("un albaran sin precios no se verifica ni se toca", () => {
    const joselito = doc({
      sin_importes: true,
      productos: [linea({ precio_unitario: null, total: null })],
      subtotal: null, iva: null, total: null,
    });
    const { datos, retiradas } = retirarImportesNoImpresos(joselito, verif());
    expect(datos.total).toBeNull();
    expect(retiradas).toHaveLength(0);
  });

  it("el esquema del verificador cumple las reglas de strict", () => {
    const e = VERIFICACION_PIE_SCHEMA.schema;
    expect(e.additionalProperties).toBe(false);
    expect([...e.required].sort()).toEqual(Object.keys(e.properties).sort());
  });
});

// ============================================================================
//  12. No deducir sobre una lectura incompleta
// ----------------------------------------------------------------------------
//  En la ML/101511 de Luga se guardo total = 1.772,82 EUR marcado como
//  `deducido` cuando el documento vale 3.787,53: la suma de las 11 lineas que
//  se habian leido de las 54 impresas. Un numero con pinta de calculado y con
//  el 47 % del valor real es PEOR que el NULL que habia antes.
// ============================================================================

describe("deducirImportes — no se deduce sobre una lectura incompleta", () => {
  const luga = (over: Partial<DocumentoExtraido> = {}) => doc({
    proveedor: "LUGA SABORES S.L.",
    numero_documento: "ML/101511",
    productos: [
      linea({ nombre: "NATOP", cantidad: 1, precio_unitario: 1000, total: 1000 }),
      linea({ nombre: "MAYONESA", cantidad: 1, precio_unitario: 772.82, total: 772.82 }),
    ],
    subtotal: null, iva: null, total: null,
    filas_tabla: 2,
    continua_en_otra_pagina: false,
    ...over,
  });

  it("con el recuento cuadrado, la suma de lineas SIGUE deduciendose (como base)", () => {
    const { datos, deduccion } = deducirImportes(luga());
    expect(datos.subtotal).toBe(1772.82);
    expect(datos.total).toBeNull();
    expect(deduccion?.metodo).toBe("base_sin_iva");
  });

  it("si faltan filas, tampoco se deduce la BASE ni el IVA aunque las lineas traigan tipo", () => {
    const conIva = luga({
      filas_tabla: 54,
      productos: [
        linea({ nombre: "NATOP", cantidad: 1, precio_unitario: 1000, total: 1000, iva_pct: 10 }),
        linea({ nombre: "MAYONESA", cantidad: 1, precio_unitario: 772.82, total: 772.82, iva_pct: 10 }),
      ],
    });
    const { datos, deduccion } = deducirImportes(conIva);
    expect(deduccion?.metodo).toBe("no_deducible");
    expect([datos.subtotal, datos.iva, datos.total]).toEqual([null, null, null]);
  });

  it("si faltan filas, NO se deduce: el total se queda vacio", () => {
    const { datos, deduccion } = deducirImportes(luga({ filas_tabla: 54 }));
    expect(datos.total).toBeNull();
    expect(deduccion?.metodo).toBe("no_deducible");
    expect(deduccion?.alerta.codigo).toBe("total_no_deducible");
    expect(deduccion?.alerta.severidad).toBe("alta");
    expect(deduccion?.alerta.detalle.suma_lineas_parcial).toBe(1772.82);
  });

  it("si el documento continua en otra pagina, tampoco", () => {
    const { datos, deduccion } = deducirImportes(luga({ continua_en_otra_pagina: true }));
    expect(datos.total).toBeNull();
    expect(deduccion?.metodo).toBe("no_deducible");
  });

  it("si no se han podido contar las filas, tampoco", () => {
    const { datos, deduccion } = deducirImportes(luga({ filas_tabla: null }));
    expect(datos.total).toBeNull();
    expect(deduccion?.metodo).toBe("no_deducible");
  });

  it("el aviso dice CUANTO seria la suma parcial, para poder contrastarla", () => {
    const { deduccion } = deducirImportes(luga({ filas_tabla: 54 }));
    expect(deduccion?.alerta.mensaje).toMatch(/1772\.82|1\.772,82|1772,82/);
    expect(deduccion?.alerta.detalle.filas_tabla).toBe(54);
  });

  it("la deduccion base + IVA NO se toca: no depende de las lineas", () => {
    // Es el caso Osborne, y es aritmetica exacta sobre dos importes impresos.
    const osborne = luga({ subtotal: 342.1, iva: 34.21, filas_tabla: 54 });
    const { datos, deduccion } = deducirImportes(osborne);
    expect(datos.total).toBe(376.31);
    expect(deduccion?.metodo).toBe("subtotal_mas_iva");
  });

  it("una respuesta sin los campos nuevos deduce como siempre", () => {
    const antiguo = luga();
    delete (antiguo as Record<string, unknown>).filas_tabla;
    delete (antiguo as Record<string, unknown>).continua_en_otra_pagina;
    expect(deducirImportes(antiguo).datos.subtotal).toBe(1772.82);
    expect(deducirImportes(antiguo).datos.total).toBeNull();
  });
});

// ============================================================================
//  13. Anadir filas que faltaban NO es reescribir el documento
// ----------------------------------------------------------------------------
//  `contarCambiosNumericos` cuenta cualquier cambio, y meter 43 filas en medio
//  desplaza todos los indices: la relectura BUENA se descartaba por el mismo
//  umbral que defiende de las malas.
// ============================================================================

describe("compararExpansion — completar frente a recomponer", () => {
  // Las filas repetidas van INTERCALADAS, como en el papel: la segunda NATOP
  // no va al final, va justo debajo de la primera. Eso es lo que desplaza
  // todos los indices de golpe y lo que hacia que el umbral de tres cambios
  // descartase la relectura buena.
  const l = (nombre: string, importe: number) =>
    linea({ nombre, total: importe, precio_unitario: importe, cantidad: 1 });
  const corta = doc({
    productos: [l("NATOP", 100), l("MAYONESA", 30), l("ESPINAS", 50)],
    subtotal: null, iva: null, total: null,
  });
  const larga = doc({
    productos: [
      l("NATOP", 100), l("NATOP", 250),
      l("MAYONESA", 30), l("MAYONESA", 45),
      l("ESPINAS", 50), l("ESPINAS", 70),
    ],
    subtotal: null, iva: null, total: null,
  });

  it("anadir lineas conservando las de antes es una EXPANSION", () => {
    const e = compararExpansion(corta, larga);
    expect(e.esExpansion).toBe(true);
    expect(e.lineasAntes).toBe(3);
    expect(e.lineasDespues).toBe(6);
    expect(e.importesPerdidos).toBe(0);
  });

  it("y el umbral de tres cambios la habria descartado", () => {
    expect(contarCambiosNumericos(corta, larga).total).toBeGreaterThan(MAX_CAMBIOS_RELECTURA);
  });

  it("si se pierde un importe que ya estaba leido, NO es expansion", () => {
    const cambiada = doc({
      productos: [
        l("NATOP", 120), l("NATOP", 250),        // 100 -> 120: importe tocado
        l("MAYONESA", 30), l("MAYONESA", 45),
        l("ESPINAS", 50), l("ESPINAS", 70),
      ],
      subtotal: null, iva: null, total: null,
    });
    const e = compararExpansion(corta, cambiada);
    expect(e.esExpansion).toBe(false);
    expect(e.importesPerdidos).toBe(1);
  });

  it("si de paso cambia un importe del pie, NO es expansion", () => {
    const e = compararExpansion(corta, doc({ ...larga, subtotal: 380 }));
    expect(e.esExpansion).toBe(false);
    expect(e.cambiosCabecera).toEqual(["subtotal"]);
  });

  it("quitar lineas nunca es una expansion", () => {
    expect(compararExpansion(larga, corta).esExpansion).toBe(false);
  });
});

describe("conservarRecuentoFilas — el recuento no se puede bajar", () => {
  it("una relectura que baja el recuento para callar el aviso no lo consigue", () => {
    // Si bajar `filas_tabla` hasta el numero de lineas escritas hiciese callar
    // `lineas_incompletas`, el recuento dejaria de ser una comprobacion y
    // pasaria a ser un objetivo.
    const primera = doc({ filas_tabla: 54, productos: [linea()] });
    const segunda = doc({ filas_tabla: 1, productos: [linea()] });
    expect(conservarRecuentoFilas(primera, segunda).filas_tabla).toBe(54);
    expect(codigos(conservarRecuentoFilas(primera, segunda))).toContain("lineas_incompletas");
  });

  it("subirlo si: son filas que antes no se habian contado", () => {
    const primera = doc({ filas_tabla: 10, productos: [linea()] });
    const segunda = doc({ filas_tabla: 54, productos: [linea()] });
    expect(conservarRecuentoFilas(primera, segunda).filas_tabla).toBe(54);
  });

  it("sin recuento en la primera, manda la segunda", () => {
    const primera = doc({ filas_tabla: null, productos: [linea()] });
    const segunda = doc({ filas_tabla: 3, productos: [linea()] });
    expect(conservarRecuentoFilas(primera, segunda).filas_tabla).toBe(3);
  });
});

// ============================================================================
//  14. El esquema NO le pide al modelo que calcule nada
// ----------------------------------------------------------------------------
//  El fallo de raiz: la descripcion del campo `total` decia "Debe cumplirse
//  subtotal + iva = total" — pegada al campo que el modelo tiene que rellenar,
//  y ganaba sobre el prompt, que decia lo contrario. Cada vez que se le pide
//  un cuadre, se le esta pidiendo que invente el numero que falta.
// ============================================================================

describe("DOCUMENTO_JSON_SCHEMA — ninguna descripcion pide calcular", () => {
  const descripciones = (nodo: unknown, ruta = "schema"): [string, string][] => {
    if (nodo === null || typeof nodo !== "object") return [];
    const o = nodo as Record<string, unknown>;
    const out: [string, string][] = [];
    if (typeof o.description === "string") out.push([ruta, o.description]);
    for (const [k, v] of Object.entries(o)) {
      if (k === "description") continue;
      out.push(...descripciones(v, `${ruta}.${k}`));
    }
    return out;
  };

  it("ninguna dice 'debe cumplirse'", () => {
    const malas = descripciones(DOCUMENTO_JSON_SCHEMA.schema)
      .filter(([, d]) => /debe cumplirse/i.test(d));
    expect(malas).toEqual([]);
  });

  it("los tres importes del pie exigen que el numero venga del papel", () => {
    const props = DOCUMENTO_JSON_SCHEMA.schema.properties as Record<string, { description?: string }>;
    for (const campo of ["subtotal", "iva", "total"]) {
      expect(props[campo].description ?? "").toMatch(/null|IMPRES/i);
    }
  });

  it("las CITAS se generan antes que sus numeros", () => {
    // No es cosmetica: el modelo escribe en el orden del esquema, y con el
    // literal del total al final ya tiene la suma en su contexto.
    const req = [...DOCUMENTO_JSON_SCHEMA.schema.required] as string[];
    expect(req.indexOf("total_literal")).toBeLessThan(req.indexOf("total"));
    expect(req.indexOf("subtotal_literal")).toBeLessThan(req.indexOf("subtotal"));
    expect(req.indexOf("iva_literal")).toBeLessThan(req.indexOf("iva"));
  });

  it("el recuento de filas se pide ANTES de la tabla", () => {
    const req = [...DOCUMENTO_JSON_SCHEMA.schema.required] as string[];
    expect(req.indexOf("filas_tabla")).toBeLessThan(req.indexOf("productos"));
  });

  it("la tabla prohibe agrupar filas repetidas", () => {
    const p = DOCUMENTO_JSON_SCHEMA.schema.properties.productos as { description: string };
    expect(p.description).toMatch(/no las agrupes/i);
    expect(p.description).toMatch(/CADA FILA IMPRESA/i);
  });
});

// ============================================================================
//  El contador de filas (bloque 3d). Los numeros son los MEDIDOS sobre
//  31.jpg (factura mensual ML/101511 de Luga, 54 filas impresas): el extractor
//  devolvio 10 filas diciendo `filas_tabla: 10`, y el contador estrecho conto
//  54, 55 y 54 en tres pasadas.
// ============================================================================
describe("aplicarRecuentoVerificado", () => {
  const lineas = (n: number) =>
    Array.from({ length: n }, (_, i) => linea({ nombre: `Articulo ${i}`, total: 10 }));

  it("sube filas_tabla cuando el contador ve mas filas y avisa (caso Luga 54 vs 10)", () => {
    const d = doc({
      subtotal: null, iva: null, total: null,
      productos: lineas(10), filas_tabla: 10,
    });
    const { datos, alerta } = aplicarRecuentoVerificado(d, { filas_tabla: 54, filas_por_bloque: [36, 18] });
    expect(datos.filas_tabla).toBe(54);
    expect(alerta?.codigo).toBe("recuento_filas_discordante");
    expect(alerta?.severidad).toBe("alta");
    expect(alerta?.detalle.filas_contadas).toBe(54);
    expect(alerta?.detalle.lineas_extraidas).toBe(10);
  });

  it("ese recuento hace que NO se deduzca ningun total de la suma de lineas", () => {
    const d = doc({ subtotal: null, iva: null, total: null, productos: lineas(10), filas_tabla: 10 });
    // sin contador: la suma parcial se guarda como base deducida
    const sinContador = deducirImportes(d);
    expect(sinContador.deduccion?.metodo).toBe("base_sin_iva");
    expect(sinContador.datos.subtotal).toBe(100);
    // con contador: se retira la deduccion entera
    const { datos } = aplicarRecuentoVerificado(d, { filas_tabla: 54 });
    const conContador = deducirImportes(datos);
    expect(conContador.deduccion?.metodo).toBe("no_deducible");
    expect(conContador.datos.total).toBeNull();
    expect(conContador.deduccion?.alerta.codigo).toBe("total_no_deducible");
  });

  it("no avisa cuando el contador confirma las filas extraidas (caso Salazones, 3 de 3)", () => {
    const d = doc({ subtotal: null, iva: null, total: null, productos: lineas(3), filas_tabla: 3 });
    const { datos, alerta } = aplicarRecuentoVerificado(d, { filas_tabla: 3 });
    expect(alerta).toBeNull();
    expect(datos.filas_tabla).toBe(3);
    expect(deducirImportes(datos).deduccion?.metodo).toBe("base_sin_iva");
  });

  it("NUNCA baja el recuento: si el contador ve menos, manda el mas alto", () => {
    const d = doc({ productos: lineas(5), filas_tabla: 54 });
    const { datos, alerta } = aplicarRecuentoVerificado(d, { filas_tabla: 5 });
    expect(datos.filas_tabla).toBe(54);
    expect(alerta).toBeNull();   // 5 <= 5 emitidas: el contador no aporta nada
  });

  it("rellena filas_tabla cuando el extractor dice que no ha podido contar", () => {
    const d = doc({ subtotal: null, iva: null, total: null, productos: lineas(8), filas_tabla: null });
    const { datos, alerta } = aplicarRecuentoVerificado(d, { filas_tabla: 54 });
    expect(datos.filas_tabla).toBe(54);
    expect(alerta?.codigo).toBe("recuento_filas_discordante");
  });

  it("fail-open: sin recuento util no toca nada (el contador es una mejora, no un requisito)", () => {
    const d = doc({ filas_tabla: 7, productos: lineas(7) });
    for (const r of [null, undefined, { filas_tabla: null } as RecuentoFilas, { filas_tabla: 0 }]) {
      const { datos, alerta } = aplicarRecuentoVerificado(d, r);
      expect(datos.filas_tabla).toBe(7);
      expect(alerta).toBeNull();
    }
  });

  it("el esquema del contador es estricto y pide contar por bloques", () => {
    expect(RECUENTO_FILAS_SCHEMA.strict).toBe(true);
    expect(RECUENTO_FILAS_SCHEMA.schema.additionalProperties).toBe(false);
    expect([...RECUENTO_FILAS_SCHEMA.schema.required]).toEqual(
      Object.keys(RECUENTO_FILAS_SCHEMA.schema.properties),
    );
    const b = RECUENTO_FILAS_SCHEMA.schema.properties.filas_por_bloque as { description: string };
    expect(b.description).toMatch(/bloque|albaran|pagina/i);
  });
});

// ============================================================================
//  La cita del extractor puede fallar sobre un importe que SI esta impreso.
//  Medido en la factura M-2508464 de Joselito: total 3.126,57 impreso en el
//  papel, `total_literal` a null, y el sistema lo retiraba para volver a
//  calcularlo identico y marcarlo 'deducido'. Si la segunda lectura del pie
//  cita ese mismo importe, hay dos lecturas independientes de acuerdo.
// ============================================================================
describe("retirarImportesNoImpresos + confirmacion del verificador", () => {
  const pie = (over: Partial<VerificacionPie> = {}): VerificacionPie => ({
    fila_total_impresa: true,
    total_citado: "3.126,57",
    base_imponible_citada: "2.842,34",
    cuota_iva_citada: "284,23",
    ...over,
  });

  it("NO retira un total sin cita si la segunda lectura del pie cita el mismo numero", () => {
    const d = doc({ subtotal: 2842.34, iva: 284.23, total: 3126.57, total_literal: null,
                    subtotal_literal: "2.842,34", iva_literal: "284,23" });
    const { datos, retiradas } = retirarImportesNoImpresos(d, pie());
    expect(datos.total).toBe(3126.57);
    expect(retiradas).toHaveLength(0);
  });

  it("SI lo retira si la segunda lectura cita OTRO numero", () => {
    const d = doc({ subtotal: 2842.34, iva: 284.23, total: 3126.57, total_literal: null });
    const { datos, retiradas } = retirarImportesNoImpresos(d, pie({ total_citado: "3.000,00" }));
    expect(datos.total).toBeNull();
    expect(retiradas.map((r) => r.campo)).toEqual(["total"]);
  });

  it("SI lo retira si el verificador dice que la fila del total no esta impresa (caso Osborne)", () => {
    const d = doc({ subtotal: 342.1, iva: 34.21, total: 376.31, total_literal: null });
    const { datos, retiradas } = retirarImportesNoImpresos(
      d, pie({ fila_total_impresa: false, total_citado: "376,31" }),
    );
    expect(datos.total).toBeNull();
    expect(retiradas.map((r) => r.campo)).toEqual(["total"]);
  });

  it("SI lo retira cuando no hay segunda lectura: una sola lectura sin cita no prueba nada", () => {
    const d = doc({ subtotal: 2842.34, iva: 284.23, total: 3126.57, total_literal: null });
    const { datos, retiradas } = retirarImportesNoImpresos(d, null);
    expect(datos.total).toBeNull();
    expect(retiradas.map((r) => r.campo)).toEqual(["total"]);
  });

  it("la confirmacion vale igual para la base y para la cuota de IVA", () => {
    const d = doc({ subtotal: 2842.34, iva: 284.23, total: 3126.57,
                    subtotal_literal: null, iva_literal: null, total_literal: "3.126,57" });
    const { datos, retiradas } = retirarImportesNoImpresos(d, pie());
    expect(datos.subtotal).toBe(2842.34);
    expect(datos.iva).toBe(284.23);
    expect(retiradas).toHaveLength(0);
  });
});

describe("VERIFICACION_PIE_SCHEMA: lo que decide es ver los digitos, no la etiqueta", () => {
  const d = VERIFICACION_PIE_SCHEMA.schema.properties.fila_total_impresa as { description: string };

  it("dice explicitamente que el importe final puede llevar otra etiqueta o ninguna", () => {
    // Medido: en la factura M-2508464 de Joselito el verificador contestaba false
    // porque la cifra final (3.126,57) estaba rotulada SUBTOTAL, y el propio
    // verificador la citaba en `ultimo_texto_visible`. Ver la cifra es verla.
    expect(d.description).toMatch(/SUBTOTAL/);
    expect(d.description).toMatch(/sin\s+etiqueta/i);
    expect(d.description).toMatch(/aunque su etiqueta no diga la palabra TOTAL/i);
  });

  it("mantiene la regla contraria: base + cuota de IVA NO es ver el total", () => {
    expect(d.description).toMatch(/cuota de IVA NO es ver el total/i);
    expect(d.description).toMatch(/si tendrias que calcularlos, es false/i);
  });
});

// ============================================================================
//  14. El total CON IVA se deduce si cada linea trae su tipo (06/10/2026)
// ----------------------------------------------------------------------------
//  Luga ML/101511 (factura 54): la captura no llega al pie, pero la tabla trae
//  una columna «IVA» por fila (10 % casi todo; 4 % PICOS Sin Gluten y
//  ROSQUILLA). Se guardaba total = 3.787,53, que es la BASE, y el chatbot lo
//  sumaba como "IVA incluido". Con el tipo de cada linea el total es exacto:
//  10 % de 3.725,10 = 372,51; 4 % de 62,43 = 2,50; total 4.162,54.
// ============================================================================

describe("deducirImportes — IVA por linea (Luga ML/101511)", () => {
  const lugaCompleta = (over: Partial<DocumentoExtraido> = {}) => doc({
    proveedor: "LUGA SABORES S.L.",
    numero_documento: "ML/101511",
    productos: LUGA_FILAS.map((f) => linea({
      nombre: f.nombre, cantidad: f.cantidad, peso_kg: f.peso_kg,
      base_precio: "desconocida",
      precio_unitario: f.precio_unitario, total: f.total, iva_pct: f.iva_pct,
    })),
    subtotal: null, iva: null, total: null,
    filas_tabla: 54,
    continua_en_otra_pagina: false,
    ...over,
  });

  it("IVA mixto 10 % / 4 %: base 3.787,53 + IVA 375,01 = 4.162,54, marcado deducido", () => {
    const { datos, deduccion } = deducirImportes(lugaCompleta());
    expect(datos.subtotal).toBe(LUGA_SUMA);
    expect(datos.iva).toBe(LUGA_IVA);
    expect(datos.total).toBe(LUGA_TOTAL);
    expect(deduccion?.campo).toBe("total");
    expect(deduccion?.metodo).toBe("iva_por_linea");
    expect(deduccion?.valor).toBe(LUGA_TOTAL);
  });

  it("el desglose agrupa por tipo y redondea UNA cuota por tipo", () => {
    const { deduccion } = deducirImportes(lugaCompleta());
    expect(deduccion?.alerta.detalle.desglose).toEqual([
      { tipo: 10, base: 3725.1, cuota: 372.51, lineas: 49 },
      { tipo: 4, base: 62.43, cuota: 2.5, lineas: 5 },
    ]);
  });

  it("el aviso es total_deducido, dice que sale del IVA de cada linea y sin recargo", () => {
    const { deduccion } = deducirImportes(lugaCompleta());
    expect(deduccion?.alerta.codigo).toBe("total_deducido");
    expect(deduccion?.alerta.severidad).toBe("media");
    expect(deduccion?.alerta.mensaje).toMatch(/deducido con el IVA de cada/);
    expect(deduccion?.alerta.mensaje).toMatch(/recargo de\s+equivalencia/);
    expect(deduccion?.alerta.mensaje).toMatch(/4162\.54/);
    expect(deduccion?.alerta.detalle).toMatchObject({
      metodo: "iva_por_linea", subtotal: 3787.53, iva: 375.01, total: 4162.54,
    });
  });

  it("lo deducido cuadra solo: comprobarCuadre no ve descuadre de cabecera ni de IVA", () => {
    const { datos } = deducirImportes(lugaCompleta());
    const cods = comprobarCuadre(datos).map((d) => d.codigo);
    expect(cods).not.toContain("descuadre_cabecera");
    expect(cods).not.toContain("iva_incoherente");
  });

  it("redondeo por tipo, no por linea: 3 x 0,15 al 4 % es 0,02 (no 0,03)", () => {
    const tres = doc({
      productos: [0, 1, 2].map(() => linea({ cantidad: 1, precio_unitario: 0.15, total: 0.15, iva_pct: 4 })),
      subtotal: null, iva: null, total: null, filas_tabla: 3,
    });
    const { datos } = deducirImportes(tres);
    expect(datos.subtotal).toBe(0.45);
    expect(datos.iva).toBe(0.02);
    expect(datos.total).toBe(0.47);
  });

  it("basta UNA linea con importe sin tipo para no inventar IVA: base si, total no", () => {
    const productos = lugaCompleta().productos.map((l, i) => (i === 7 ? { ...l, iva_pct: null } : l));
    const { datos, deduccion } = deducirImportes(lugaCompleta({ productos }));
    expect(deduccion?.metodo).toBe("base_sin_iva");
    expect(deduccion?.alerta.codigo).toBe("falta_iva");
    expect(deduccion?.alerta.detalle.lineas_sin_tipo).toBe(1);
    expect(datos.subtotal).toBe(LUGA_SUMA);
    expect(datos.iva).toBeNull();
    expect(datos.total).toBeNull();
  });

  it("una linea bonificada (0 EUR) sin tipo no impide deducir: no aporta IVA", () => {
    const d = doc({
      productos: [
        linea({ cantidad: 1, precio_unitario: 100, total: 100, iva_pct: 10 }),
        linea({ nombre: "Regalo", cantidad: 2, precio_unitario: 0, total: 0, bonificada: true, iva_pct: null }),
      ],
      subtotal: null, iva: null, total: null, filas_tabla: 2,
    });
    const { datos, deduccion } = deducirImportes(d);
    expect(deduccion?.metodo).toBe("iva_por_linea");
    expect(datos.total).toBe(110);
  });

  it("un tipo fuera de rango (110, -10) cuenta como sin tipo", () => {
    const d = doc({
      productos: [linea({ total: 100, iva_pct: 110 }), linea({ total: 50, iva_pct: -10 })],
      subtotal: null, iva: null, total: null, filas_tabla: 2,
    });
    const { datos, deduccion } = deducirImportes(d);
    expect(deduccion?.metodo).toBe("base_sin_iva");
    expect(deduccion?.alerta.detalle.lineas_sin_tipo).toBe(2);
    expect(datos.total).toBeNull();
  });

  it("lectura incompleta (faltan filas / continua / sin recuento) -> no se deduce nada", () => {
    const casos: Partial<DocumentoExtraido>[] = [
      { filas_tabla: 60 }, { continua_en_otra_pagina: true }, { filas_tabla: null },
    ];
    for (const over of casos) {
      const { datos, deduccion } = deducirImportes(lugaCompleta(over));
      expect(deduccion?.metodo).toBe("no_deducible");
      expect(deduccion?.alerta.codigo).toBe("total_no_deducible");
      expect([datos.subtotal, datos.iva, datos.total]).toEqual([null, null, null]);
    }
  });

  it("un pie LEIDO manda: ni total, ni base, ni IVA se recalculan con los tipos de linea", () => {
    const leido = deducirImportes(lugaCompleta({ total: 4000, total_literal: "4,000.00" }));
    expect(leido.deduccion).toBeNull();
    expect(leido.datos.total).toBe(4000);
    expect(leido.datos.subtotal).toBeNull();
    // Medio pie leido (solo base): regla C, no se completa con los tipos.
    const medio = deducirImportes(lugaCompleta({ subtotal: 3787.53 }));
    expect(medio.deduccion).toBeNull();
    expect(medio.datos.iva).toBeNull();
    expect(medio.datos.total).toBeNull();
  });

  it("desgloseIvaPorLinea trabaja en centimos y cuenta las lineas sin tipo", () => {
    const d = desgloseIvaPorLinea([
      linea({ total: 0.1, iva_pct: 21 }), linea({ total: 0.2, iva_pct: 21 }), linea({ total: 5, iva_pct: null }),
    ]);
    expect(d.base).toBe(5.3);
    expect(d.tramos).toEqual([{ tipo: 21, base: 0.3, cuota: 0.06, lineas: 2 }]);
    expect(d.cuota).toBe(0.06);
    expect(d.lineas_sin_tipo).toBe(1);
  });

  it("tipoIvaLinea: porcentajes 0..30 a dos decimales; lo demas es null", () => {
    expect([10, 4, 21, 0, 7.5, 5].map(tipoIvaLinea)).toEqual([10, 4, 21, 0, 7.5, 5]);
    expect([null, undefined, NaN, 110, -1, "10", 30.01].map(tipoIvaLinea))
      .toEqual([null, null, null, null, null, null, null]);
  });
});

describe("iva_pct en los esquemas y en el guardado", () => {
  it("el esquema de un documento lo exige en cada linea (strict) y explica el ejemplo de Luga", () => {
    const items = DOCUMENTO_JSON_SCHEMA.schema.properties.productos.items;
    expect(items.required).toContain("iva_pct");
    expect(Object.keys(items.properties).sort()).toEqual([...items.required].sort());
    expect(items.properties.iva_pct.type).toEqual(["number", "null"]);
    expect(DESCRIPCION_IVA_PCT).toMatch(/Luga/);
    expect(DESCRIPCION_IVA_PCT).toMatch(/Dto%/);
  });

  it("el esquema de una pieza tambien", () => {
    const items = PAGINA_JSON_SCHEMA.schema.properties.lineas.items;
    expect(items.required).toContain("iva_pct");
    expect(Object.keys(items.properties).sort()).toEqual([...items.required].sort());
  });

  it("validarEstructura acepta una respuesta antigua sin iva_pct y rechaza un texto", () => {
    expect(validarEstructura(doc()).ok).toBe(true);
    const malo = doc({ productos: [{ ...linea(), iva_pct: "10%" as unknown as number }] });
    const v = validarEstructura(malo);
    expect(v.ok).toBe(false);
    expect(v.problemas.map((p) => p.campo)).toContain("productos[0].iva_pct");
  });

  it("validarPagina lo lee, lo deja en null si falta y si esta fuera de rango", () => {
    const base = {
      nombre: "X", cantidad: 1, unidad: "ud", peso_kg: null, base_precio: "por_unidad",
      precio_unitario: 1, total: 1, bonificada: false,
    };
    const v = validarPagina({ lineas: [{ ...base, iva_pct: 10 }, { ...base }, { ...base, iva_pct: 99 }] });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.datos.lineas.map((l) => l.iva_pct)).toEqual([10, null, null]);
    expect(validarPagina({ lineas: [{ ...base, iva_pct: "10" }] }).ok).toBe(false);
  });

  it("normalizarDatos lo conserva por linea (va a productos_factura.iva_pct)", () => {
    const n = normalizarDatos(doc({ productos: [linea({ iva_pct: 4 }), linea({ iva_pct: null }), linea()] }));
    expect(n.productos.map((p: { iva_pct: number | null }) => p.iva_pct)).toEqual([4, null, null]);
  });
});
