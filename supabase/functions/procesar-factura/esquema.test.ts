import { describe, expect, it } from "vitest";
import {
  comprobarCuadre,
  contarCambiosNumericos,
  DOCUMENTO_JSON_SCHEMA,
  describirProblemas,
  descuadresComoAlertas,
  MAX_CAMBIOS_RELECTURA,
  mensajeCorrectivo,
  validarEstructura,
  type DocumentoExtraido,
  type LineaExtraida,
} from "./esquema.ts";

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
    // Los que NO pueden faltar siguen siendo escalares obligatorios.
    expect(props.numero_documento.type).toBe("string");
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

  it("rechaza numero_documento vacio o ausente", () => {
    expect(validarEstructura(doc({ numero_documento: "" })).ok).toBe(false);
    expect(validarEstructura(doc({ numero_documento: undefined as unknown as string })).ok).toBe(false);
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

describe("comprobarCuadre — caso real: Joselito, albaran 2509134", () => {
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
