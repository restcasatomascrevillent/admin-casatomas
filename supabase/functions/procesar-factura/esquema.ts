// ============================================================================
//  esquema.ts · Contrato de la extraccion: forma estricta + cuadre aritmetico
// ----------------------------------------------------------------------------
//  Tres piezas, en el orden en que actuan sobre la respuesta del modelo:
//
//   1. DOCUMENTO_JSON_SCHEMA  -> se manda a OpenAI como
//      `response_format: { type: "json_schema", strict: true }`. Es la PRIMERA
//      red: con `strict` el modelo NO PUEDE devolver una forma distinta (ni
//      campos de mas, ni de menos, ni un numero donde toca un string). El
//      modo anterior, `{ type: "json_object" }`, solo garantizaba que el texto
//      fuese JSON parseable — nada sobre su contenido.
//
//   2. validarEstructura()    -> SEGUNDA red, ya sobre el JSON parseado. El
//      esquema estricto lo aplica OpenAI; si algun dia se cambia de modelo, se
//      desactiva el esquema o la API degrada, esto sigue estando. Falla
//      diciendo QUE CAMPO esta mal, en vez de dejar pasar un documento a medias.
//
//   3. comprobarCuadre()      -> TERCERA red, y la unica que mira si los
//      numeros tienen sentido ENTRE SI. Una factura lleva redundancia
//      aritmetica de serie (cantidad x precio = total de linea, suma de lineas
//      = subtotal, subtotal + iva = total). Esa redundancia es deteccion de
//      errores gratis que hasta ahora no se usaba en el momento de extraer.
//
//  POR QUE NO ZOD (se evaluo, se descarto a proposito)
//  ---------------------------------------------------
//  Zod 3.25.76 esta en package.json, pero es dependencia del FRONTEND. Este
//  fichero lo cargan dos runtimes distintos:
//    - Deno (Supabase Edge Functions), que resuelve por URL o `npm:`
//    - Node/vitest (los tests), que resuelve por node_modules
//  No hay un unico especificador que valga en los dos sin tocar configuracion
//  compartida (vitest.config.ts) o anadir un import map por funcion, y un
//  import map que no se aplique en el deploy deja la funcion sin arrancar.
//  `normalizacion.ts` ya tomo esta misma decision y la documenta en su
//  cabecera: sin imports, testeable en los dos lados. Se mantiene la
//  coherencia. La validacion que hace falta aqui cabe en unas decenas de
//  lineas sin dependencias.
//  Si algun dia se quiere Zod literal, el cambio es mecanico, pero hay que
//  verificar el import map en un deploy de preview ANTES de tocar produccion.
// ============================================================================

// ─── 1. Esquema estricto para OpenAI Structured Outputs ─────────────────────
//
//  Reglas del modo `strict: true` que este objeto respeta (saltarselas es un
//  400 de la API, no un fallo silencioso):
//   - TODAS las propiedades de cada objeto van en su `required`. Un campo
//     "opcional" se expresa como tipo union con null: ["number", "null"].
//   - `additionalProperties: false` en CADA objeto, incluidos los de dentro
//     del array.
//   - No se usan palabras clave no soportadas (pattern, format, minimum,
//     maximum, minItems, uniqueItems...). Todo eso lo comprueba
//     `validarEstructura` / `comprobarCuadre` aqui abajo, que si pueden.
//   - `description` SI esta soportado y es donde mas rinde: es instruccion
//     pegada al campo, no texto muerto.

export const DOCUMENTO_JSON_SCHEMA = {
  name: "documento_comercial",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "tipo", "proveedor", "cif", "numero_documento", "fecha",
      "productos", "subtotal", "iva", "total", "observaciones", "resumen",
    ],
    properties: {
      tipo: {
        type: "string",
        enum: ["factura", "albaran"],
        description:
          "'albaran' si el documento dice Albaran, Nota de entrega o Delivery Note, AUNQUE lleve precios e IVA. 'factura' si dice Factura o Invoice.",
      },
      proveedor: {
        type: ["string", "null"],
        description: "Razon social de QUIEN EMITE el documento, no del cliente. null si no se ve.",
      },
      cif: {
        type: ["string", "null"],
        description: "CIF/NIF del proveedor emisor. null si no aparece.",
      },
      numero_documento: {
        type: "string",
        description: "Numero de factura o albaran, tal cual aparece impreso, con sus ceros y prefijos.",
      },
      fecha: {
        type: "string",
        description:
          "Fecha del documento en formato YYYY-MM-DD. OJO: en Espana se escribe DD/MM/AAAA, asi que 03/09/2026 es 2026-09-03, NO 2026-03-09.",
      },
      productos: {
        type: "array",
        description: "Una entrada por LINEA de la tabla de conceptos, en el orden del documento.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nombre", "cantidad", "unidad", "base_precio", "precio_unitario", "total", "bonificada"],
          properties: {
            nombre: { type: "string", description: "Descripcion del producto, sin codigos internos ni lote." },
            cantidad: {
              type: "number",
              description: "Cantidad facturada. Si la unidad es kg puede llevar decimales (p.ej. 7.35).",
            },
            unidad: {
              type: "string",
              description: "Unidad tal como la expresa el documento: ud, kg, l, caja, docena... Si no consta, 'ud'.",
            },
            base_precio: {
              type: "string",
              enum: ["por_unidad", "por_kg", "por_litro", "desconocida"],
              description:
                "A que se refiere precio_unitario. Es lo que evita confundir un precio POR KILO con el precio de una PIEZA: si la columna dice EUR/kg, es 'por_kg'. Debe cumplirse cantidad x precio_unitario = total.",
            },
            precio_unitario: {
              type: ["number", "null"],
              description:
                "Precio de UNA unidad de las indicadas en 'base_precio', NO el total de la linea. null si el documento no lo muestra.",
            },
            total: {
              type: ["number", "null"],
              description: "Importe total de esta linea, ya con su descuento aplicado. null si no se muestra.",
            },
            bonificada: {
              type: "boolean",
              description:
                "true si la linea es regalo / bonificacion / descuento del 100% (cantidad > 0 con importe 0). No elimines esas lineas.",
            },
          },
        },
      },
      subtotal: {
        type: ["number", "null"],
        description: "Base imponible, antes de IVA. null si el documento no la declara (habitual en albaranes).",
      },
      iva: {
        type: ["number", "null"],
        description: "Importe TOTAL de IVA en euros, no el porcentaje. Si ves '10%', pon el importe que corresponde, no 10.",
      },
      total: {
        type: ["number", "null"],
        description: "Total a pagar, IVA incluido. Debe cumplirse subtotal + iva = total.",
      },
      observaciones: {
        type: ["string", "null"],
        description: "Forma de pago, vencimientos, transportista, direccion de entrega. null si no hay nada relevante.",
      },
      resumen: {
        type: "string",
        description:
          "1-2 frases describiendo el documento: que tipo de genero, que proveedor, importe total y para que sirve. Se usa para busqueda semantica.",
      },
    },
  },
} as const;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type BasePrecio = "por_unidad" | "por_kg" | "por_litro" | "desconocida";

export interface LineaExtraida {
  nombre: string;
  cantidad: number;
  unidad: string;
  base_precio: BasePrecio;
  precio_unitario: number | null;
  total: number | null;
  bonificada: boolean;
}

export interface DocumentoExtraido {
  tipo: "factura" | "albaran";
  proveedor: string | null;
  cif: string | null;
  numero_documento: string;
  fecha: string;
  productos: LineaExtraida[];
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  observaciones: string | null;
  resumen: string | null;
}

/** Un campo que no cumple el contrato. `campo` es la RUTA, p.ej. "productos[3].cantidad". */
export interface Problema {
  campo: string;
  mensaje: string;
}

export type ResultadoValidacion =
  | { ok: true; datos: DocumentoExtraido; problemas: Problema[] }
  | { ok: false; datos: null; problemas: Problema[] };

// ─── 2. Validacion estructural ───────────────────────────────────────────────

const BASES_PRECIO: readonly string[] = ["por_unidad", "por_kg", "por_litro", "desconocida"];

/** `true` solo para numeros reales y finitos. Descarta NaN e Infinity, que
 *  `typeof x === "number"` deja pasar y que revientan cualquier aritmetica
 *  posterior (y llegan a Postgres como NaN en una columna NUMERIC). */
function esNumeroFinito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function esNumeroONull(v: unknown): v is number | null {
  return v === null || esNumeroFinito(v);
}

function esStringONull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/**
 * Comprueba que el JSON ya parseado cumple el contrato, y devuelve TODOS los
 * problemas encontrados (no solo el primero: si el modelo se ha equivocado en
 * cinco lineas, interesa verlas las cinco de una vez, no ir de una en una).
 *
 * No normaliza ni arregla nada: eso es trabajo de `normalizarDatos`. Aqui solo
 * se decide si el documento es apto para seguir.
 */
export function validarEstructura(raw: unknown): ResultadoValidacion {
  const problemas: Problema[] = [];
  const push = (campo: string, mensaje: string) => problemas.push({ campo, mensaje });

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      datos: null,
      problemas: [{ campo: "(raiz)", mensaje: "la respuesta no es un objeto JSON" }],
    };
  }
  const d = raw as Record<string, unknown>;

  // ── Cabecera ──
  if (d.tipo !== "factura" && d.tipo !== "albaran") {
    push("tipo", `debe ser "factura" o "albaran", llego ${JSON.stringify(d.tipo)}`);
  }
  // `numero_documento` es la clave real del documento (unique con proveedor) y
  // ademas la usa `verificar_duplicado_factura`: sin el, no hay nada que hacer.
  if (typeof d.numero_documento !== "string" || d.numero_documento.trim() === "") {
    push("numero_documento", "obligatorio y no puede venir vacio");
  }
  if (typeof d.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) {
    push("fecha", `se esperaba YYYY-MM-DD, llego ${JSON.stringify(d.fecha)}`);
  }
  if (!esStringONull(d.proveedor)) push("proveedor", "debe ser texto o null");
  if (!esStringONull(d.cif)) push("cif", "debe ser texto o null");
  if (!esStringONull(d.observaciones)) push("observaciones", "debe ser texto o null");
  if (!esStringONull(d.resumen ?? null)) push("resumen", "debe ser texto o null");

  for (const campo of ["subtotal", "iva", "total"] as const) {
    if (!esNumeroONull(d[campo])) {
      push(campo, `debe ser un numero o null, llego ${JSON.stringify(d[campo])}`);
    }
  }

  // ── Lineas ──
  if (!Array.isArray(d.productos)) {
    push("productos", "debe ser un array (vacio si el documento no lleva lineas)");
  } else {
    d.productos.forEach((p: unknown, i: number) => {
      const en = (c: string) => `productos[${i}].${c}`;
      if (p === null || typeof p !== "object" || Array.isArray(p)) {
        push(`productos[${i}]`, "cada linea debe ser un objeto");
        return;
      }
      const l = p as Record<string, unknown>;
      if (typeof l.nombre !== "string" || l.nombre.trim() === "") {
        push(en("nombre"), "obligatorio y no puede venir vacio");
      }
      if (!esNumeroFinito(l.cantidad)) {
        push(en("cantidad"), `debe ser un numero, llego ${JSON.stringify(l.cantidad)}`);
      }
      if (typeof l.unidad !== "string") push(en("unidad"), "debe ser texto");
      if (typeof l.base_precio !== "string" || !BASES_PRECIO.includes(l.base_precio)) {
        push(en("base_precio"), `debe ser uno de ${BASES_PRECIO.join(" | ")}, llego ${JSON.stringify(l.base_precio)}`);
      }
      if (!esNumeroONull(l.precio_unitario)) {
        push(en("precio_unitario"), `debe ser un numero o null, llego ${JSON.stringify(l.precio_unitario)}`);
      }
      if (!esNumeroONull(l.total)) {
        push(en("total"), `debe ser un numero o null, llego ${JSON.stringify(l.total)}`);
      }
      if (typeof l.bonificada !== "boolean") {
        push(en("bonificada"), `debe ser true o false, llego ${JSON.stringify(l.bonificada)}`);
      }
    });
  }

  if (problemas.length > 0) return { ok: false, datos: null, problemas };
  return { ok: true, datos: raw as unknown as DocumentoExtraido, problemas: [] };
}

/** Texto de una linea para el mensaje de error / el log. */
export function describirProblemas(problemas: Problema[]): string {
  return problemas.map((p) => `${p.campo}: ${p.mensaje}`).join("; ");
}

// ─── 3. Cuadre aritmetico ────────────────────────────────────────────────────

export type Severidad = "alta" | "media";

export interface Descuadre {
  codigo: string;
  severidad: Severidad;
  mensaje: string;
  detalle: Record<string, unknown>;
}

// Umbrales. Los que siguen son DELIBERADAMENTE los mismos que usa
// `validar_cordura_factura` en SQL (migracion 20260922130000), para que la
// comprobacion previa al guardado y la posterior no se contradigan: seria
// peor que no comprobar nada que el pre-guardado diga "bien" y el
// post-guardado "mal" sobre los mismos numeros.
const RATIO_LINEA_MAX = 1.02;   // total/(precio x cantidad) por encima => descuadre
const RATIO_LINEA_MIN = 0.40;   // por debajo => descuadre (un dto del 15% es normal)
const ABS_LINEA_MIN = 0.05;     // por debajo de 5 centimos de diferencia, da igual
const TOL_CABECERA_REL = 0.02;  // 2% ...
const TOL_CABECERA_ABS = 1.00;  // ... con suelo de 1 EUR
const PRECIO_UNITARIO_EXTREMO = 1000;
const TOTAL_DOCUMENTO_EXTREMO = 25000;

// El IVA es la UNICA excepcion, y a proposito. En SQL la tolerancia es
// `greatest(0.05, |total| * 0.01)` — un 1% RELATIVO. Eso es demasiado holgado:
// `subtotal + iva = total` es aritmetica exacta, no una estimacion, y lo unico
// que la justifica es el redondeo a centimos. Con el 1%, una factura de
// 5.000 EUR admite un error de 50 EUR sin decir nada.
//
// Caso real medido (MR FRIOSAT): 489,74 + 101,59 = 591,33, pero se leyo
// 585,33. Diferencia 6,00 EUR contra una tolerancia de 585,33 x 1% = 5,85.
// Salto por 15 centimos. Con 5 EUR de error en vez de 6 habria pasado en
// silencio. Aqui la tolerancia es un centimo por linea (el redondeo que de
// verdad puede acumularse) con suelo de 5 centimos.
const TOL_IVA_ABS = 0.05;
const TOL_IVA_POR_LINEA = 0.01;

const eur = (n: number) => `${n.toFixed(2)} EUR`;

/**
 * Comprueba que los numeros del documento cuadran entre si, ANTES de guardar.
 *
 * El objetivo NO es rechazar documentos: es detectar a tiempo que la lectura
 * es mala para poder pedirle al modelo que la repita (ver `mensajeCorrectivo`)
 * en vez de guardar un dato que ya sabemos malo y dejarselo a un humano.
 *
 * Devuelve la lista de descuadres, vacia si todo cuadra.
 */
export function comprobarCuadre(datos: DocumentoExtraido): Descuadre[] {
  const out: Descuadre[] = [];
  const lineas = datos.productos ?? [];

  // ── a) cantidad x precio_unitario = total de linea ──
  //    Se compara por RATIO, no por diferencia: un descuento de linea del 15%
  //    es normal y no debe dar la alarma. Las bonificadas (total 0 con
  //    cantidad > 0) se saltan: ahi el descuadre es el comportamiento correcto
  //    y para eso el modelo marca ahora `bonificada`.
  lineas.forEach((l, i) => {
    if (l.bonificada) return;
    if (!esNumeroFinito(l.precio_unitario) || !esNumeroFinito(l.total)) return;
    if (l.precio_unitario <= 0 || l.cantidad <= 0 || l.total <= 0) return;
    const esperado = l.precio_unitario * l.cantidad;
    if (Math.abs(esperado - l.total) <= ABS_LINEA_MIN) return;
    const ratio = l.total / esperado;
    if (ratio > RATIO_LINEA_MAX || ratio < RATIO_LINEA_MIN) {
      out.push({
        codigo: "descuadre_linea",
        severidad: "media",
        mensaje:
          `Linea ${i + 1} ("${l.nombre}"): ${l.cantidad} x ${eur(l.precio_unitario)} = ` +
          `${eur(esperado)}, pero el total de la linea dice ${eur(l.total)}.`,
        detalle: {
          indice: i, nombre: l.nombre, cantidad: l.cantidad,
          precio_unitario: l.precio_unitario, total: l.total,
          esperado: Number(esperado.toFixed(2)), ratio: Number(ratio.toFixed(4)),
        },
      });
    }
  });

  // ── b) suma de lineas = subtotal (o total si no hay subtotal) ──
  const totalesLinea = lineas.map((l) => l.total).filter(esNumeroFinito);
  const referencia = esNumeroFinito(datos.subtotal)
    ? datos.subtotal
    : (esNumeroFinito(datos.total) ? datos.total : null);
  if (totalesLinea.length > 0 && referencia !== null && referencia !== 0) {
    const suma = totalesLinea.reduce((a, b) => a + b, 0);
    const tol = Math.max(TOL_CABECERA_ABS, Math.abs(referencia) * TOL_CABECERA_REL);
    if (Math.abs(suma - referencia) > tol) {
      out.push({
        codigo: "descuadre_cabecera",
        severidad: "media",
        mensaje:
          `La suma de las ${totalesLinea.length} lineas es ${eur(suma)}, pero el documento declara ` +
          `${esNumeroFinito(datos.subtotal) ? "subtotal" : "total"} ${eur(referencia)}.`,
        detalle: {
          suma_lineas: Number(suma.toFixed(2)),
          referencia: Number(referencia.toFixed(2)),
          campo_referencia: esNumeroFinito(datos.subtotal) ? "subtotal" : "total",
          tolerancia: Number(tol.toFixed(2)),
          num_lineas: totalesLinea.length,
        },
      });
    }
  }

  // ── c) subtotal + iva = total ──
  if (esNumeroFinito(datos.subtotal) && esNumeroFinito(datos.iva) && esNumeroFinito(datos.total)) {
    const esperado = datos.subtotal + datos.iva;
    const tol = Math.max(TOL_IVA_ABS, Math.max(lineas.length, 1) * TOL_IVA_POR_LINEA);
    if (Math.abs(esperado - datos.total) > tol) {
      out.push({
        codigo: "iva_incoherente",
        severidad: "media",
        mensaje:
          `subtotal ${eur(datos.subtotal)} + IVA ${eur(datos.iva)} = ${eur(esperado)}, ` +
          `pero el total leido es ${eur(datos.total)}.`,
        detalle: {
          subtotal: datos.subtotal, iva: datos.iva, total: datos.total,
          esperado: Number(esperado.toFixed(2)),
          diferencia: Number((esperado - datos.total).toFixed(2)),
          tolerancia: Number(tol.toFixed(2)),
        },
      });
    }
  }

  // ── d) plausibilidad: precio unitario desorbitado ──
  //    Es la red del caso Joselito (12 jamones a 9.316,67 EUR/ud). No prueba
  //    que este mal, pero en un restaurante un precio unitario de cuatro
  //    cifras es casi siempre un total de linea colado en la columna del
  //    precio, o un factor x10 de lectura.
  lineas.forEach((l, i) => {
    if (esNumeroFinito(l.precio_unitario) && l.precio_unitario > PRECIO_UNITARIO_EXTREMO) {
      out.push({
        codigo: "precio_unitario_extremo",
        severidad: "alta",
        mensaje:
          `Linea ${i + 1} ("${l.nombre}"): precio unitario ${eur(l.precio_unitario)}, ` +
          `por encima de ${eur(PRECIO_UNITARIO_EXTREMO)}. Revisa si es el total de la linea, ` +
          `un precio por kilo, o un error de lectura.`,
        detalle: {
          indice: i, nombre: l.nombre, precio_unitario: l.precio_unitario,
          base_precio: l.base_precio, umbral: PRECIO_UNITARIO_EXTREMO,
        },
      });
    }
  });

  // ── e) plausibilidad: total del documento desorbitado ──
  if (esNumeroFinito(datos.total) && datos.total > TOTAL_DOCUMENTO_EXTREMO) {
    out.push({
      codigo: "total_documento_extremo",
      severidad: "alta",
      mensaje:
        `Total del documento ${eur(datos.total)}, por encima de ${eur(TOTAL_DOCUMENTO_EXTREMO)}. ` +
        `Comprueba que no sobra un digito ni se ha confundido el separador de miles con el decimal.`,
      detalle: { total: datos.total, umbral: TOTAL_DOCUMENTO_EXTREMO },
    });
  }

  return out;
}

/**
 * Construye el mensaje correctivo que se le devuelve al modelo para que
 * REPITA la lectura de los numeros que no cuadran.
 *
 * Es deliberadamente concreto (le dice que numero leyo y por que no cuadra) y
 * deliberadamente NO le sugiere un valor: si se le da el numero que "deberia"
 * salir, lo escribe sin volver a mirar la imagen, y entonces el cuadre se
 * cumple pero el dato sigue siendo inventado. Lo que se quiere es que vuelva
 * a mirar los pixeles.
 */
export function mensajeCorrectivo(descuadres: Descuadre[]): string {
  const lista = descuadres.map((d) => `- ${d.mensaje}`).join("\n");
  return (
    `Tu extraccion anterior no cuadra aritmeticamente:\n${lista}\n\n` +
    `Vuelve a MIRAR LA IMAGEN del documento y corrige SOLO los digitos que hayas leido mal. ` +
    `Los confundibles son 3/8, 5/6, 1/7, 0/9 y 6/0, y el separador de miles "." con el decimal ",". ` +
    `Comprueba tambien si un numero que has puesto como precio unitario es en realidad el total ` +
    `de la linea, o un precio por kilo.\n\n` +
    `NO inventes valores para forzar el cuadre. Si tras mirarlo de nuevo el documento sigue sin ` +
    `cuadrar porque asi esta impreso, devuelve lo que pone realmente. ` +
    `Devuelve el documento COMPLETO otra vez, con el mismo formato.`
  );
}

/**
 * Cuenta cuantos valores NUMERICOS cambian entre dos lecturas del mismo
 * documento, y devuelve cuales.
 *
 * POR QUE EXISTE ESTO
 * -------------------
 * Pedirle al modelo que "vuelva a mirar porque no cuadra" tiene un riesgo
 * documentado: hay medidas publicadas (ReceiptBench, 2026) de modelos que
 * ALTERAN precios de linea e INVENTAN importes de IVA para hacer que las
 * sumas cuadren. Es decir, el propio criterio con el que se detecta el error
 * es el que el modelo aprende a satisfacer, si hace falta falseando datos.
 *
 * La defensa no es dejar de comprobar la aritmetica —seguiria siendo la unica
 * senal disponible— sino mirar COMO cambia la segunda lectura:
 *
 *  - Corregir de verdad un digito mal leido cambia UNO o DOS numeros.
 *  - Recomponer el documento para que cuadre cambia MUCHOS.
 *
 * Asi que una relectura que reescribe medio documento es sospechosa aunque
 * cuadre perfectamente, y se descarta. Mejor un documento con un aviso que un
 * documento limpio e inventado.
 */
export function contarCambiosNumericos(
  antes: DocumentoExtraido,
  despues: DocumentoExtraido,
): { total: number; campos: string[] } {
  const campos: string[] = [];
  const cmp = (campo: string, a: unknown, b: unknown) => {
    const na = esNumeroFinito(a) ? a : null;
    const nb = esNumeroFinito(b) ? b : null;
    if (na === null && nb === null) return;
    // Se comparan a dos decimales: un 110 frente a un 110.00000001 no es un
    // cambio de lectura, es coma flotante.
    if (na === null || nb === null || Math.abs(na - nb) > 0.005) campos.push(campo);
  };

  cmp("subtotal", antes.subtotal, despues.subtotal);
  cmp("iva", antes.iva, despues.iva);
  cmp("total", antes.total, despues.total);

  // Si cambia el numero de lineas, ya es una reescritura por si sola.
  const n = Math.max(antes.productos?.length ?? 0, despues.productos?.length ?? 0);
  if ((antes.productos?.length ?? 0) !== (despues.productos?.length ?? 0)) {
    campos.push("productos.length");
  }
  for (let i = 0; i < n; i++) {
    const a = antes.productos?.[i];
    const b = despues.productos?.[i];
    if (!a || !b) continue;
    cmp(`productos[${i}].cantidad`, a.cantidad, b.cantidad);
    cmp(`productos[${i}].precio_unitario`, a.precio_unitario, b.precio_unitario);
    cmp(`productos[${i}].total`, a.total, b.total);
  }

  return { total: campos.length, campos };
}

/** Por encima de esto, una relectura deja de parecer la correccion de un
 *  digito y empieza a parecer una recomposicion del documento. Tres permite
 *  el caso legitimo mas habitual: un precio unitario mal leido arrastra el
 *  total de su linea y el subtotal. */
export const MAX_CAMBIOS_RELECTURA = 3;

/** Descuadres -> filas para `facturas.alertas_validacion`, mismo formato que
 *  devuelve `validar_cordura_factura` en SQL para que la UI y el chatbot no
 *  tengan que distinguir de donde vino cada alerta. */
export function descuadresComoAlertas(descuadres: Descuadre[], origen: string) {
  return descuadres.map((d) => ({
    codigo: d.codigo,
    severidad: d.severidad,
    mensaje: d.mensaje,
    detalle: { ...d.detalle, origen },
  }));
}
