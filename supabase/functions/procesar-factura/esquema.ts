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

// Unica dependencia: otro modulo puro del mismo directorio (sin red ni Deno).
import { resolverMagnitud } from "./magnitudes.ts";

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

/** Descripcion del tipo de IVA de una linea. La comparten el esquema de un
 *  documento (aqui) y el de una pieza (pagina.ts): es el dato que permite
 *  deducir el total con IVA cuando el pie no se ve (Luga ML/101511, ver
 *  `deducirImportes`). */
export const DESCRIPCION_IVA_PCT =
  "El TIPO de IVA de ESTA linea, en porcentaje, SOLO si la tabla trae una columna con el tipo de cada " +
  "fila (cabecera 'IVA', '% IVA', 'T. IVA', 'Tipo'). Copia el numero tal cual: 10 para 10 %, 4 para 4 %, " +
  "21 para 21 %, 0 si pone 0 o 'Exento'. Ejemplo (Luga): 'PICOS Sin Gluten ... 18.07 | 4' -> 4; " +
  "'NATOP ... 99.46 | 10' -> 10. Es un PORCENTAJE, no euros: no confundas esa columna con 'Dto%' ni con " +
  "'% R.E.'. null si no hay columna de tipo por linea, si en vez del porcentaje trae un codigo (1, 2, A) " +
  "o si no se lee. NO lo deduzcas por el tipo de producto.";

export const DOCUMENTO_JSON_SCHEMA = {
  name: "documento_comercial",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "total_literal", "subtotal_literal", "iva_literal",
      "tipo", "proveedor", "cif", "cliente", "numero_documento", "pagina", "fecha", "sin_importes",
      "continua_en_otra_pagina", "filas_tabla", "productos",
      "subtotal", "iva", "total", "observaciones", "resumen",
    ],
    properties: {
      // ── LAS CITAS VAN LAS PRIMERAS, Y ESO NO ES COSMETICA ──
      //  El modelo escribe los campos en el orden de este objeto. Con el
      //  literal del total al final, cuando llega a el ya ha escrito la base
      //  y la cuota de IVA: la suma esta en su contexto y la copia como si
      //  la hubiera leido (factura 40295280 de Osborne, con la fila del TOTAL
      //  cortada fuera del encuadre). Poniendolo el PRIMERO, para escribir
      //  algo aqui tiene que ir a buscarlo a la imagen: todavia no hay ningun
      //  numero que sumar.
      total_literal: {
        type: ["string", "null"],
        description:
          "ESTO ES LO PRIMERO QUE ESCRIBES, y se contesta MIRANDO EL PIE DE LA IMAGEN, antes de extraer " +
          "nada mas. Baja hasta el borde inferior de la foto y busca la fila del TOTAL A PAGAR (TOTAL, " +
          "TOTAL FACTURA, TOTAL ALBARAN, IMPORTE A PAGAR). Si esa fila esta ahi, copia sus caracteres " +
          "tal cual ('3.010,61EUR', '376,31'). Si NO esta —porque la foto corta el documento por abajo, " +
          "porque la tapa una sombra o un dedo, o porque el papel simplemente no lleva total— escribe " +
          "null. Muchos documentos acaban en la fila de la BASE IMPONIBLE y la CUOTA DE IVA sin que el " +
          "TOTAL llegue a verse: en ese caso esto es null, y no vale poner la suma de los dos.",
      },
      subtotal_literal: {
        type: ["string", "null"],
        description:
          "LA CITA de la base imponible: copia los caracteres tal como estan impresos en la imagen, con " +
          "su coma, sus puntos y su moneda si la lleva ('2.488,11', '342,10 EUR'). Si no ves ese importe " +
          "impreso, va null. NO transcribas aqui un numero que hayas calculado.",
      },
      iva_literal: {
        type: ["string", "null"],
        description:
          "LA CITA de la cuota de IVA EN EUROS: copia los caracteres impresos ('34,21 EUR', '522,50'). " +
          "NO el porcentaje: '10,00 %' no es una cita valida de la cuota. Si el documento solo imprime el " +
          "porcentaje y en ninguna parte el importe en euros, va null. Si hay varias cuotas impresas, " +
          "copialas todas separadas por ' + ' ('12,30 + 45,10').",
      },
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
        description: "CIF/NIF del proveedor emisor (miralo tambien en el margen vertical y en el pie). null si no aparece.",
      },
      cliente: {
        type: ["string", "null"],
        description: "Destinatario/cliente tal como aparece (nombre y CIF). null si no consta.",
      },
      numero_documento: {
        type: ["string", "null"],
        description:
          "Numero de factura o albaran tal cual, con sus ceros y prefijos. null si la casilla esta en blanco: " +
          "NUNCA lo saques de un telefono, CIF, fecha, ano, lote o codigo de cliente.",
      },
      pagina: {
        type: "object",
        additionalProperties: false,
        required: ["actual", "total"],
        description: "Paginacion impresa ('PAGINA N. 1/2', 'Pag. 2 de 2', 'Hoja 1/2'). null en los dos si no la pone.",
        properties: {
          actual: { type: ["integer", "null"] },
          total: { type: ["integer", "null"] },
        },
      },
      fecha: {
        type: ["string", "null"],
        description:
          "Fecha del documento en formato YYYY-MM-DD. OJO: en Espana se escribe DD/MM/AAAA, asi que 03/09/2026 es 2026-09-03, NO 2026-03-09. Usa la fecha de emision o entrega IMPRESA. Si el documento no trae ninguna fecha impresa, devuelve null: no la deduzcas de un vencimiento, de una nota a mano ni de un numero de serie.",
      },
      sin_importes: {
        type: "boolean",
        description:
          "true si el documento NO LLEVA NINGUN PRECIO EN EUROS. Es el caso normal de muchos albaranes de entrega: solo traen cantidades y pesos. Si es true, todos los precio_unitario, total, subtotal, iva y total del documento deben ser null. NUNCA calcules un precio dividiendo ni multiplicando: si no esta impreso, no existe.",
      },
      continua_en_otra_pagina: {
        type: "boolean",
        description:
          "true si el documento tiene mas contenido del que se ve: lo dice el propio papel ('Pag. 1 de 2', " +
          "'Hoja 1/2', 'continua', 'sigue'), o la tabla de conceptos llega al borde de la imagen sin " +
          "cerrarse, o falta el pie de totales que la plantilla deberia traer. false si se ve el " +
          "documento entero de principio a fin.",
      },
      filas_tabla: {
        type: ["integer", "null"],
        description:
          "Cuantas FILAS DE CONCEPTO hay impresas en la tabla: cuentalas UNA A UNA sobre la imagen antes " +
          "de extraerlas, incluidas las repetidas, las bonificadas y las de importe 0. Es un recuento de " +
          "lo que se ve en el PAPEL, no de lo que vas a escribir en 'productos': si el papel trae 54 " +
          "filas, aqui va 54 aunque te parezcan muchas. null solo si la tabla se corta y no puedes " +
          "contarlas con seguridad — y ojo, poner null aqui NO te exime de extraer las filas: extrae " +
          "TODAS las que consigas leer. Una lista incompleta con su aviso sirve; una lista vacia no " +
          "sirve para nada.",
      },
      productos: {
        type: "array",
        description:
          "Una entrada por CADA FILA IMPRESA de la tabla de conceptos, en el orden del documento, " +
          "incluidas las filas repetidas y las de importe 0. Si el mismo producto aparece en varias " +
          "filas, emite UNA ENTRADA POR CADA FILA: no las agrupes, no sumes sus cantidades y no " +
          "descartes ninguna por parecer duplicada. Una factura mensual que junta varios albaranes " +
          "repite los mismos productos muchas veces, con importes distintos, y todas esas filas cuentan. " +
          "Si la imagen es mala, extrae LO QUE CONSIGAS LEER: una lista incompleta es util y queda " +
          "avisada; una lista vacia no vale para nada y tambien queda avisada.",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "nombre", "cantidad", "unidad", "peso_kg", "base_precio", "precio_unitario", "total", "iva_pct", "bonificada",
            "albaran_ref",
          ],
          properties: {
            nombre: {
              type: "string",
              description:
                "Descripcion del producto, sin codigos internos ni lote. PUEDE REPETIRSE: dos filas " +
                "con el mismo nombre son dos lineas distintas del documento, no la misma linea.",
            },
            cantidad: {
              type: "number",
              description:
                "La columna de UNIDADES/BULTOS tal como esta impresa (Uds, Cant., Bultos, Cajas): piezas, " +
                "cajas, botellas. Si el documento NO trae columna de unidades y solo trae los kilos o litros " +
                "de la linea, aqui van esos kilos/litros (con decimales).",
            },
            unidad: {
              type: "string",
              description:
                "Unidad de 'cantidad': 'ud' para unidades, piezas o bultos; 'kg' o 'l' si 'cantidad' son kilos o " +
                "litros; 'caja', 'docena'... si el documento lo dice asi. Si no consta, 'ud'.",
            },
            peso_kg: {
              type: ["number", "null"],
              description:
                "Kilos (o litros) de la linea, SOLO si el documento trae una columna de peso o volumen APARTE " +
                "de la de unidades (Kilos, Kg, Peso, Neto, Litros). Copiala aunque el precio sea por unidad. " +
                "Muchos albaranes y facturas de alimentacion traen las dos: 12 uds que pesan 24,00 kg. Ese " +
                "numero es un PESO, no euros: no lo pongas nunca en 'total'. null si no hay esa columna.",
            },
            base_precio: {
              type: "string",
              enum: ["por_unidad", "por_kg", "por_litro", "desconocida"],
              description:
                "A que magnitud se refiere precio_unitario: 'por_kg' si el precio multiplica los KILOS, " +
                "'por_litro' si multiplica los litros, 'por_unidad' si multiplica las unidades. Si hay columna " +
                "de unidades y de kilos, decidelo con la aritmetica de la fila: si Uds x Precio no da el " +
                "Importe pero Kilos x Precio si (12 uds, 24,00 kg, 4,14 -> 99,46 = 24 x 4,14), es 'por_kg'. " +
                "Describe lo que pone el documento; no cambies ningun numero para que la multiplicacion cuadre.",
            },
            precio_unitario: {
              type: ["number", "null"],
              description:
                "Precio de UNA unidad de las indicadas en 'base_precio' TAL COMO ESTA IMPRESO, NO el total " +
                "de la linea. null si el documento no lo imprime: no lo calcules dividiendo el total entre " +
                "la cantidad.",
            },
            total: {
              type: ["number", "null"],
              description:
                "Importe total de esta linea TAL COMO ESTA IMPRESO, ya con su descuento aplicado. COPIALO " +
                "del papel: no lo recalcules como cantidad x precio_unitario, ni siquiera si la " +
                "multiplicacion no cuadra — muchos proveedores imprimen el precio unitario redondeado y " +
                "el importe impreso es el bueno. null si el documento no lo muestra.",
            },
            iva_pct: {
              type: ["number", "null"],
              description: DESCRIPCION_IVA_PCT,
            },
            bonificada: {
              type: "boolean",
              description:
                "true si la linea es regalo / bonificacion / descuento del 100% (cantidad > 0 con importe 0). No elimines esas lineas.",
            },
            albaran_ref: {
              type: ["string", "null"],
              description: "Nº del albaran al que pertenece la fila (cabecera 'Albaran X' encima, columna o cita). null si no consta.",
            },
          },
        },
      },
      subtotal: {
        type: ["number", "null"],
        description:
          "El mismo importe de 'subtotal_literal', ya en numero (punto decimal, sin separador de miles). " +
          "Si 'subtotal_literal' es null, esto tambien es null: no la calcules sumando las lineas.",
      },
      iva: {
        type: ["number", "null"],
        description:
          "El importe de IVA en euros que corresponde a 'iva_literal', en numero. Si hay varias cuotas " +
          "impresas, la suma de las que has citado. Si 'iva_literal' es null, esto tambien es null: no lo " +
          "calcules aplicando el porcentaje a la base.",
      },
      total: {
        type: ["number", "null"],
        description:
          "El mismo importe de 'total_literal', ya en numero. Si 'total_literal' es null, esto es null " +
          "OBLIGATORIAMENTE: NO lo calcules como subtotal + iva ni sumando las lineas. Que falte el total " +
          "es un dato correcto y se completa despues dejando constancia; un total calculado se guarda " +
          "como si lo hubieras leido y ya nadie lo cuestiona.",
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
  peso_kg: number | null;
  base_precio: BasePrecio;
  precio_unitario: number | null;
  total: number | null;
  /** Tipo de IVA de la linea en % (10, 4, 21, 0), si el documento lo imprime
   *  por fila. Opcional en el tipo por lo mismo que `filas_tabla`: payloads
   *  antiguos y piezas guardadas antes del 06/10/2026 no lo traen. */
  iva_pct?: number | null;
  bonificada: boolean;
  /** Albaran al que pertenece la fila (facturas que agrupan albaranes). */
  albaran_ref?: string | null;
}

export interface DocumentoExtraido {
  tipo: "factura" | "albaran";
  proveedor: string | null;
  cif: string | null;
  /** Destinatario impreso (nombre y CIF). Opcional: payloads antiguos no lo traen. */
  cliente?: string | null;
  /** null si el papel no trae numero: se guarda con uno provisional (calidad.ts). */
  numero_documento: string | null;
  /** Paginacion impresa («PÁGINA Nº 1/2»). Opcional como los de abajo. */
  pagina?: { actual: number | null; total: number | null } | null;
  fecha: string | null;
  /** El documento no lleva ningun importe en euros (albaran de entrega). */
  sin_importes: boolean;
  // Los tres que siguen son OBSERVACIONES SOBRE LA IMAGEN, no datos del
  // documento: sirven para saber si la lectura esta completa. Son opcionales
  // en el tipo a proposito — el esquema estricto obliga al modelo a mandarlos,
  // pero el codigo tiene que seguir funcionando con una respuesta que no los
  // traiga (esquema desactivado, modelo distinto, payload antiguo de un test).
  /** El documento tiene mas contenido del que se ve (varias paginas, tabla cortada). */
  continua_en_otra_pagina?: boolean;
  /** Filas de concepto CONTADAS SOBRE EL PAPEL. Es la referencia contra la que
   *  se compara `productos.length` para detectar lineas colapsadas. */
  filas_tabla?: number | null;
  productos: LineaExtraida[];
  // Cada importe del pie viaja con su CITA: los caracteres tal como estan
  // impresos. Un numero sin cita no se ha leido, se ha calculado. Opcionales
  // en el tipo por lo mismo que los de arriba: el codigo tiene que seguir
  // funcionando con una respuesta que no los traiga.
  subtotal_literal?: string | null;
  subtotal: number | null;
  iva_literal?: string | null;
  iva: number | null;
  total_literal?: string | null;
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
  // `numero_documento` puede faltar (10/10/2026): una nota de entrega sin
  // numero (Narejos, Aceites Crevillente) se perdia entera por «obligatorio».
  // Ahora se guarda con un numero provisional y su aviso (calidad.ts). Lo que
  // no vale es otro tipo.
  if (d.numero_documento !== null && d.numero_documento !== undefined && typeof d.numero_documento !== "string") {
    push("numero_documento", `debe ser texto o null, llego ${JSON.stringify(d.numero_documento)}`);
  }
  if (d.cliente !== undefined && !esStringONull(d.cliente)) push("cliente", "debe ser texto o null");
  if (d.pagina !== undefined && d.pagina !== null && (typeof d.pagina !== "object" || Array.isArray(d.pagina))) {
    push("pagina", `debe ser un objeto {actual, total} o null, llego ${JSON.stringify(d.pagina)}`);
  }
  // `fecha` puede ser null a proposito. Hay documentos reales sin ninguna
  // fecha impresa (la factura 1-701405 de Insula Roma es uno), y exigir un
  // string obliga al modelo a INVENTARSELA: se vio sacarla de una nota a
  // lapiz al margen. Mas vale un hueco, que luego se rellena con la fecha de
  // subida dejando constancia, que una fecha falsa que nadie va a cuestionar.
  if (d.fecha !== null && (typeof d.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha))) {
    push("fecha", `se esperaba YYYY-MM-DD o null, llego ${JSON.stringify(d.fecha)}`);
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

  if (typeof d.sin_importes !== "boolean") {
    push("sin_importes", `debe ser true o false, llego ${JSON.stringify(d.sin_importes)}`);
  }

  // Las tres observaciones sobre la imagen. Se validan SI VIENEN: el esquema
  // estricto las exige, pero esta funcion es la red de debajo y tiene que
  // tragar una respuesta sin ellas en vez de tirar el documento entero.
  if (d.continua_en_otra_pagina !== undefined && typeof d.continua_en_otra_pagina !== "boolean") {
    push("continua_en_otra_pagina", `debe ser true o false, llego ${JSON.stringify(d.continua_en_otra_pagina)}`);
  }
  for (const campo of ["subtotal_literal", "iva_literal", "total_literal"] as const) {
    if (d[campo] !== undefined && !esStringONull(d[campo])) {
      push(campo, `debe ser texto o null, llego ${JSON.stringify(d[campo])}`);
    }
  }
  if (d.filas_tabla !== undefined && !esNumeroONull(d.filas_tabla)) {
    push("filas_tabla", `debe ser un numero o null, llego ${JSON.stringify(d.filas_tabla)}`);
  }

  // Un documento declarado SIN IMPORTES no puede traer importes. Si los trae,
  // o la marca esta mal o los numeros estan inventados — y el caso real es el
  // segundo: el albaran 2509134 de Joselito no lleva ni un precio y el
  // sistema guardo 111.800 EUR de total y 9.316,67 EUR/ud, que salio de
  // dividir. Esto lo corta de raiz.
  if (d.sin_importes === true) {
    const conImporte: string[] = [];
    for (const campo of ["subtotal", "iva", "total"] as const) {
      if (esNumeroFinito(d[campo])) conImporte.push(campo);
    }
    if (Array.isArray(d.productos)) {
      d.productos.forEach((p: unknown, i: number) => {
        const l = (p ?? {}) as Record<string, unknown>;
        if (esNumeroFinito(l.precio_unitario)) conImporte.push(`productos[${i}].precio_unitario`);
        if (esNumeroFinito(l.total)) conImporte.push(`productos[${i}].total`);
      });
    }
    if (conImporte.length > 0) {
      push(
        "sin_importes",
        `el documento se declara sin importes pero trae ${conImporte.length} valor(es) en euros ` +
        `(${conImporte.slice(0, 5).join(", ")}${conImporte.length > 5 ? "..." : ""}). ` +
        `Si el papel no lleva precios, no pueden salir de ningun sitio que no sea un calculo inventado`,
      );
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
      if (!esNumeroONull(l.peso_kg)) {
        push(en("peso_kg"), `debe ser un numero o null, llego ${JSON.stringify(l.peso_kg)}`);
      }
      if (typeof l.base_precio !== "string" || !BASES_PRECIO.includes(l.base_precio)) {
        push(en("base_precio"), `debe ser uno de ${BASES_PRECIO.join(" | ")}, llego ${JSON.stringify(l.base_precio)}`);
      }
      if (!esNumeroONull(l.precio_unitario)) {
        push(en("precio_unitario"), `debe ser un numero o null, llego ${JSON.stringify(l.precio_unitario)}`);
      }
      if (!esNumeroONull(l.total)) {
        push(en("total"), `debe ser un numero o null, llego ${JSON.stringify(l.total)}`);
      }
      // Se valida SI VIENE (respuestas antiguas no lo traen). Un tipo fuera de
      // rango no tumba el documento: `tipoIvaLinea` lo deja en null despues.
      if (l.iva_pct !== undefined && !esNumeroONull(l.iva_pct)) {
        push(en("iva_pct"), `debe ser un numero o null, llego ${JSON.stringify(l.iva_pct)}`);
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
// Tolerancia de `suma de lineas = subtotal`. El 2 % relativo que habia aqui
// fallaba justo donde mas duele: el 2 % de 2.488,11 EUR son 49,76 EUR, asi que
// en el albaran AL2025/0009781 de Campoluz se colo una botella entera de BRUGAL
// (2 x 34,05 leidas como 1 x 34,05) sin un solo aviso. Una tolerancia
// puramente relativa crece con el documento, y los documentos grandes son
// precisamente los que mas caro salen.
//
// LOS NUMEROS DE ABAJO ESTAN MEDIDOS sobre los 19 documentos reales de la base,
// comparando la suma de lineas del GROUND TRUTH humano (lectura perfecta)
// contra el subtotal impreso:
//
//   · 17 de 19 cuadran EXACTO: diferencia 0,00 EUR.
//   · Campoluz AL2025/0009781: 6,00 EUR de diferencia legitima (2.482,11 de
//     lineas frente a 2.488,11 de base imponible). No es un error de lectura:
//     es el canon de PUNTO VERDE, que entra en la base imponible pero no es
//     una fila de la tabla de productos. 0,241 % de la base.
//   · Campoluz AL2025/0009780: 0,72 EUR por lo mismo. 0,274 % de la base.
//
// Asi que hay que absorber un canon del orden del 0,25 % y cazar el agujero de
// 37,68 EUR de la botella. De ahi los tres numeros:
//
//   REL 0,5 %  -> el doble del canon medido. En Campoluz da 12,44 EUR:
//                 tolera los 6,00 legitimos y caza los 37,68 de la botella.
//   ABS 2 EUR  -> suelo, para que en documentos pequenos el canon (0,72 EUR en
//                 el 0009780) no dispare un aviso falso.
//   MAX 15 EUR -> TECHO, y es la pieza que faltaba. A partir de 3.000 EUR de
//                 base el porcentaje deja de crecer. En la factura mas grande
//                 del lote (12.513,50 EUR) la tolerancia pasa de 49,76 EUR
//                 (con el 2 % antiguo) a 15,00 EUR fijos.
//
// Con estos tres valores NINGUNO de los 19 documentos da aviso falso y el
// agujero de Campoluz salta.
//
// SUELO BAJADO A 0,50 EUR (10/10/2026, revision de 48 fotos de octubre). Con
// 2 EUR pasaban sin aviso los cargos fijos del pie que no se extraian como
// linea: embalaje 1,82 (Nicolas y Valero, x5), portes 1,60 (Altamira), RGA
// 1,97 (Luga). Ahora el prompt pide esos cargos como lineas (y entonces cuadra
// exacto) y, si no salen, el aviso salta. El 0,72 de Campoluz 0009780 sigue
// dentro (0,5 % de ~263 = 1,31). Mismo cambio en validar_cordura_factura
// (migracion 20261010160000).
const TOL_CABECERA_REL = 0.005;  // 0,5 % ...
const TOL_CABECERA_ABS = 0.50;   // ... con suelo de 0,50 EUR ...
const TOL_CABECERA_MAX = 15.00;  // ... y TECHO de 15 EUR, para que no crezca
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

/** Tolerancia de `suma de lineas = subtotal`: relativa con SUELO y TECHO.
 *  El techo es lo que la diferencia de la de antes: una tolerancia relativa
 *  pura convierte cada documento grande en un sitio donde caben botellas. */
export function toleranciaCabecera(referencia: number): number {
  return Math.min(
    TOL_CABECERA_MAX,
    Math.max(TOL_CABECERA_ABS, Math.abs(referencia) * TOL_CABECERA_REL),
  );
}

const eur = (n: number) => `${n.toFixed(2)} EUR`;

/** Redondeo a centimos. `208.32 + 105 + 123.6` da 436.92000000000004 en coma
 *  flotante, y eso llegaria tal cual a una columna NUMERIC(10,2). */
const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Fila de `facturas.alertas_validacion`: mismo formato que devuelve
 *  `validar_cordura_factura` en SQL. */
export interface AlertaValidacion {
  codigo: string;
  severidad: Severidad;
  mensaje: string;
  detalle: Record<string, unknown>;
}

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

  // Sin fecha impresa: se guardara con la de subida (la columna es NOT NULL),
  // asi que tiene que quedar dicho. Una fecha inventada en contabilidad no la
  // cuestiona nadie despues.
  if (datos.fecha === null) {
    out.push({
      codigo: "fecha_ausente",
      severidad: "media",
      mensaje:
        "El documento no trae ninguna fecha impresa. Se guarda con la fecha de subida: " +
        "confirmala contra el original antes de darla por buena.",
      detalle: { numero_documento: datos.numero_documento },
    });
  }

  // ── LECTURA COMPLETA ──
  //
  //  El fallo mas caro que se ha medido en este sistema no es un digito mal
  //  leido: es el modelo COLAPSANDO las filas repetidas. La factura mensual
  //  ML/101511 de Luga Sabores junta 6 albaranes, tiene 54 filas impresas y el
  //  modelo devolvia 11 — exactamente el numero de productos DISTINTOS, con
  //  cero nombres repetidos en la salida. Aritmeticamente no se nota: las 11
  //  lineas que devuelve cuadran entre si. Lo unico que lo delata es contar.
  //
  //  Por eso el modelo cuenta ahora las filas SOBRE EL PAPEL (`filas_tabla`),
  //  antes de escribirlas, y aqui se compara ese recuento con lo que ha
  //  emitido. Es la misma idea que el resto del fichero: el modelo lee,
  //  nosotros comprobamos.
  const nEmitidas = lineas.length;

  //  Ni una sola linea. Pasa cuando la foto es mala y el modelo se rinde en
  //  vez de extraer lo que se lee: una lista vacia con un aviso no vale menos
  //  que una lista vacia sin el, pero la factura sin lineas no sirve para
  //  nada y eso hay que decirlo alto.
  if (nEmitidas === 0) {
    out.push({
      codigo: "sin_lineas",
      severidad: "alta",
      mensaje:
        `No se ha extraido ninguna linea de concepto. Un documento comercial sin lineas no es utilizable: ` +
        `o la imagen no permite leer la tabla, o la lectura se ha rendido. Vuelve a subir el documento ` +
        `con mejor resolucion, o en dos fotos si son dos paginas.`,
      detalle: {
        filas_tabla: datos.filas_tabla ?? null,
        continua_en_otra_pagina: datos.continua_en_otra_pagina ?? null,
      },
    });
  }

  //  El recuento no se ha podido hacer: se pierde la unica senal que detecta
  //  las filas colapsadas, asi que la lectura queda sin red.
  if (datos.filas_tabla === null && nEmitidas > 0) {
    out.push({
      codigo: "recuento_filas_ausente",
      severidad: "media",
      mensaje:
        `No se han podido contar las filas impresas de la tabla, asi que no hay forma de saber si las ` +
        `${nEmitidas} lineas extraidas son todas las del documento. Contrastalo con el papel, sobre todo ` +
        `si es una factura mensual que agrupa varios albaranes.`,
      detalle: { lineas_extraidas: nEmitidas },
    });
  }

  if (esNumeroFinito(datos.filas_tabla) && datos.filas_tabla > 0 && nEmitidas > 0) {
    const impresas = Math.round(datos.filas_tabla);
    if (impresas !== nEmitidas) {
      const faltan = impresas - nEmitidas;
      out.push({
        codigo: "lineas_incompletas",
        severidad: faltan > 0 ? "alta" : "media",
        mensaje: faltan > 0
          ? `El documento tiene ${impresas} filas de concepto impresas, pero solo se han extraido ` +
            `${nEmitidas}: faltan ${faltan}. Cuando un mismo producto aparece en varias filas (una ` +
            `factura mensual que agrupa albaranes), hay que emitir una linea por CADA fila impresa.`
          : `Se han extraido ${nEmitidas} lineas pero el documento solo tiene ${impresas} filas ` +
            `impresas: hay ${-faltan} de mas (una fila partida en dos, o una cabecera leida como linea).`,
        detalle: {
          filas_impresas: impresas, lineas_extraidas: nEmitidas, diferencia: faltan,
          continua_en_otra_pagina: datos.continua_en_otra_pagina ?? null,
        },
      });
    }
  }

  // Un albaran de entrega sin precios es CORRECTO, no un documento a medias:
  // Joselito y Guillen son asi. No hay nada que cuadrar y no debe salir ni un
  // aviso, o se acabaria ignorando el resto. Que los importes esten de verdad
  // vacios ya lo ha exigido `validarEstructura`.
  if (datos.sin_importes) return out;

  // ── a) cantidad x precio_unitario = total de linea ──
  //    Se compara por RATIO, no por diferencia: un descuento de linea del 15%
  //    es normal y no debe dar la alarma. Las bonificadas (total 0 con
  //    cantidad > 0) se saltan: ahi el descuadre es el comportamiento correcto
  //    y para eso el modelo marca ahora `bonificada`.
  lineas.forEach((l, i) => {
    if (l.bonificada) return;
    if (!esNumeroFinito(l.precio_unitario) || !esNumeroFinito(l.total)) return;
    if (l.precio_unitario <= 0 || l.cantidad <= 0 || l.total <= 0) return;
    // Línea al peso con columna de kilos aparte (Luga: 12 uds · 24 kg · 4,14 →
    // 99,46): la cuadra el peso y se guardará por kilos (magnitudes.ts). No es
    // un descuadre ni motivo de relectura.
    const regla = resolverMagnitud(l).regla;
    if (regla === "peso_cuadra" || regla === "peso_con_descuento") return;
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
    const tol = toleranciaCabecera(referencia);
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

/** Resultado de comparar dos lecturas cuando la segunda trae MAS lineas. */
export interface Expansion {
  /** La segunda lectura solo ANADE: conserva todos los importes de linea de la
   *  primera, no toca los importes del pie, y trae mas filas. */
  esExpansion: boolean;
  lineasAntes: number;
  lineasDespues: number;
  /** Importes de linea de la primera lectura que ya no aparecen en la segunda. */
  importesPerdidos: number;
  /** Campos del pie (subtotal/iva/total) que han cambiado de valor. */
  cambiosCabecera: string[];
}

/**
 * Distingue ANADIR LINEAS QUE FALTABAN de REESCRIBIR EL DOCUMENTO.
 *
 * `contarCambiosNumericos` + `MAX_CAMBIOS_RELECTURA` existen para que el modelo
 * no altere valores ya leidos y fuerce el cuadre. Pero cuentan cualquier
 * cambio, incluido el desplazamiento de indices que produce insertar una fila:
 * si la primera lectura colapso 54 filas en 11 y la segunda las devuelve
 * completas, eso son decenas de "cambios" y la relectura BUENA se descartaba.
 *
 * Una expansion es otra cosa, y se reconoce sin ambiguedad: todos los importes
 * de linea de la primera lectura siguen ahi (en el multiset, no por posicion),
 * ninguno de los tres importes del pie ha cambiado, y hay mas lineas que
 * antes. No se ha corregido nada: se ha completado. Eso se acepta.
 */
export function compararExpansion(
  antes: DocumentoExtraido,
  despues: DocumentoExtraido,
): Expansion {
  const clave = (l: LineaExtraida) => (esNumeroFinito(l.total) ? l.total.toFixed(2) : "sin_importe");
  const bolsa = new Map<string, number>();
  for (const l of despues.productos ?? []) {
    const k = clave(l);
    bolsa.set(k, (bolsa.get(k) ?? 0) + 1);
  }
  let importesPerdidos = 0;
  for (const l of antes.productos ?? []) {
    const k = clave(l);
    const n = bolsa.get(k) ?? 0;
    if (n > 0) bolsa.set(k, n - 1);
    else importesPerdidos++;
  }

  const cambiosCabecera: string[] = [];
  for (const c of ["subtotal", "iva", "total"] as const) {
    const a = esNumeroFinito(antes[c]) ? antes[c] : null;
    const b = esNumeroFinito(despues[c]) ? despues[c] : null;
    if (a === null && b === null) continue;
    if (a === null || b === null || Math.abs(a - b) > 0.005) cambiosCabecera.push(c);
  }

  const lineasAntes = antes.productos?.length ?? 0;
  const lineasDespues = despues.productos?.length ?? 0;
  return {
    esExpansion: lineasDespues > lineasAntes && importesPerdidos === 0 && cambiosCabecera.length === 0,
    lineasAntes,
    lineasDespues,
    importesPerdidos,
    cambiosCabecera,
  };
}

/**
 * `filas_tabla` es el recuento de filas que el modelo hace SOBRE EL PAPEL, y
 * es lo unico que delata que ha colapsado lineas repetidas. Eso lo convierte
 * en un objetivo: bajar el recuento hasta el numero de lineas que ha escrito
 * hace callar el aviso sin extraer ni una fila mas.
 *
 * Asi que el recuento NO PUEDE BAJAR entre lecturas del mismo documento: se
 * queda el mas alto de los dos. Subirlo si: eso significa que al mirar otra
 * vez ha visto filas que antes no habia contado, y entonces el aviso tiene que
 * seguir saltando.
 */
export function conservarRecuentoFilas(
  primera: DocumentoExtraido,
  elegida: DocumentoExtraido,
): DocumentoExtraido {
  const a = esNumeroFinito(primera.filas_tabla) ? primera.filas_tabla : null;
  const b = esNumeroFinito(elegida.filas_tabla) ? elegida.filas_tabla : null;
  if (a === null) return elegida;
  if (b !== null && b >= a) return elegida;
  return { ...elegida, filas_tabla: a };
}

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


// ─── 3b. La cita: un importe del pie que no se puede citar, no se ha leido ──
//
//  EL CASO QUE LO MOTIVA. Factura 40295280 de Osborne (foto de la pantalla de
//  un PDF, cortada por abajo). El papel imprime BASE I.V.A. 342,10 y cuota
//  34,21; la fila del TOTAL queda por debajo del borde de la imagen. El
//  sistema guardaba total = 376,31 (= 342,10 + 34,21) marcado como LEIDO y sin
//  una sola alerta. Determinista: 5 de 5 ejecuciones.
//
//  QUE NO FUNCIONO, Y POR QUE
//  --------------------------
//  Primero se intento por instruccion: quitar del esquema la frase "debe
//  cumplirse subtotal + iva = total" y escribir en el prompt, con todas las
//  letras, que un total cortado va a null. El modelo siguio devolviendo
//  376,31. Tampoco basto preguntarle si veia el bloque de totales: contesto
//  que SI, y tenia razon — la fila de la BASE se ve, la del TOTAL no. La
//  pregunta era demasiado gruesa para el recorte real.
//
//  LO QUE SI SE PUEDE COMPROBAR
//  ----------------------------
//  Un modelo puede rellenar un hueco numerico sin darse cuenta de que lo esta
//  calculando. Lo que no puede es CITAR unos caracteres que no estan en la
//  imagen y que ademas encajen con el numero que ha puesto. Asi que cada
//  importe del pie viaja con su literal —los caracteres tal como estan
//  impresos— y aqui se comprueban dos cosas que NO requieren ver la imagen:
//
//    1. Hay numero pero no hay cita  -> el numero no salio del papel. Se
//       RETIRA (se pone a null) y se deja constancia.
//    2. Hay numero y hay cita, pero al leer la cita sale otro numero -> uno de
//       los dos esta mal. No se retira nada (la cita puede traer texto que
//       este parser no entienda), pero se avisa.
//
//  Retirar no es perder el dato: despues corre `deducirImportes`, que con la
//  base y el IVA impresos vuelve a poner 376,31 — pero marcado `deducido` y
//  con su aviso. La diferencia entre las dos cosas es justo la que el dueno
//  tiene que poder ver.

/** Lee un importe escrito como lo imprime un documento espanol (o anglosajon).
 *  Devuelve null si no hay nada reconocible. Deliberadamente tolerante: su
 *  trabajo es confirmar una cita, no rechazarla por llevar "EUR" detras. */
export function leerImporteLiteral(texto: string): number | null {
  // Varias cuotas de IVA citadas como "12,30 + 45,10": se suman.
  if (texto.includes("+")) {
    const partes = texto.split("+").map((t) => leerImporteLiteral(t));
    if (partes.some((p) => p === null)) return null;
    return redondear2((partes as number[]).reduce((a, b) => a + b, 0));
  }
  const limpio = apostrofoDecimal(texto).replace(/[^0-9.,-]/g, "");
  if (!/[0-9]/.test(limpio)) return null;
  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");
  let normal: string;
  if (ultimaComa === -1 && ultimoPunto === -1) {
    normal = limpio;
  } else if (ultimaComa > ultimoPunto) {
    // La coma esta mas a la derecha: es el decimal (formato espanol).
    normal = limpio.replace(/\./g, "").replace(",", ".");
  } else {
    normal = limpio.replace(/,/g, "");
  }
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Manuscritos y talonarios escriben la coma decimal como apostrofo: «51'00»,
 *  «134'97», «1'20». Antes se quitaba y salia 5100 / 13497 (5 avisos falsos
 *  del verificador en las facturas 354 y 384). Seguido de 1-2 cifras es coma
 *  decimal; seguido de 3 («1'234,56», estilo suizo) es de miles y se quita. */
export function apostrofoDecimal(texto: string): string {
  return texto.replace(/['’‘´`](\d{1,2})(?!\d)/g, ",$1").replace(/['’‘´`]/g, "");
}

/** Diferencia maxima entre el numero y su cita antes de avisar. Un centimo. */
const TOL_LITERAL = 0.011;

/** La cita que la segunda lectura del pie da para cada importe. */
function citaDelVerificador(
  v: VerificacionPie,
  campo: "subtotal" | "iva" | "total",
): string | null {
  // Si el verificador dice que la fila del total NO esta impresa, su propia
  // cita del total no vale como confirmacion de nada.
  if (campo === "total") return v.fila_total_impresa === false ? null : (v.total_citado ?? null);
  if (campo === "subtotal") return v.base_imponible_citada ?? null;
  return v.cuota_iva_citada ?? null;
}

export interface Retirada {
  campo: "subtotal" | "iva" | "total";
  valor: number;
  alerta: AlertaValidacion;
}

/**
 * Comprueba las citas de subtotal, iva y total, y RETIRA los importes que el
 * modelo no ha podido citar.
 *
 * Devuelve siempre un documento nuevo. Si el modelo no manda los literales
 * (esquema desactivado, modelo distinto, payload antiguo) no retira nada: la
 * ausencia de la cita solo cuenta como prueba cuando el campo viene, y por eso
 * se distingue `undefined` de `null`.
 */
export function retirarImportesNoImpresos(
  datos: DocumentoExtraido,
  verificacion?: VerificacionPie | null,
): {
  datos: DocumentoExtraido;
  retiradas: Retirada[];
  discordancias: AlertaValidacion[];
} {
  const retiradas: Retirada[] = [];
  const discordancias: AlertaValidacion[] = [];
  const salida: DocumentoExtraido = { ...datos };
  const literales = {
    subtotal: datos.subtotal_literal,
    iva: datos.iva_literal,
    total: datos.total_literal,
  } as const;
  const nombre = {
    subtotal: "la base imponible",
    iva: "la cuota de IVA",
    total: "el total a pagar",
  } as const;

  for (const campo of ["subtotal", "iva", "total"] as const) {
    const valor = datos[campo];
    const lit = literales[campo];
    if (lit === undefined) continue;           // el modelo no manda citas
    if (!esNumeroFinito(valor)) continue;      // no hay nada que comprobar

    if (lit === null || lit.trim() === "") {
      //  ...salvo que la SEGUNDA lectura del pie cite ese mismo importe. Si dos
      //  lecturas independientes coinciden en los caracteres, el numero SI
      //  estaba impreso: lo que ha fallado es la cita del extractor, no el
      //  dato. Retirarlo aqui degradaba a 'deducido' totales bien leidos —
      //  medido en la factura M-2508464 de Joselito, cuyo total 3.126,57 esta
      //  impreso y se retiraba para volver a calcularlo identico.
      //  Esto NO puede fabricar nada: exige que otra llamada, que no ha visto
      //  la respuesta del extractor, escriba los mismos caracteres.
      const citaAparte = verificacion && !datos.sin_importes
        ? citaDelVerificador(verificacion, campo)
        : null;
      const confirmado = citaAparte !== null ? leerImporteLiteral(citaAparte) : null;
      if (confirmado !== null && Math.abs(confirmado - valor) <= TOL_LITERAL) {
        continue;
      }
      salida[campo] = null;
      retiradas.push({
        campo,
        valor,
        alerta: {
          codigo: "importe_no_impreso",
          severidad: "alta",
          mensaje:
            `Se ha retirado ${nombre[campo]} (${eur(valor)}): la extraccion trae el numero pero NO puede ` +
            `citar los caracteres impresos en la imagen, asi que no se ha leido del papel — se ha ` +
            `calculado. El campo se guarda vacio; si es deducible a partir de importes que SI estan ` +
            `impresos, se rellenara aparte y quedara marcado como deducido.`,
          detalle: { campo, valor_retirado: valor, literal: lit, origen: "cita" },
        },
      });
      continue;
    }

    const leido = leerImporteLiteral(lit);
    if (leido !== null && Math.abs(leido - valor) > TOL_LITERAL) {
      discordancias.push({
        codigo: "importe_literal_discordante",
        severidad: "media",
        mensaje:
          `En ${nombre[campo]} el numero (${eur(valor)}) no coincide con lo que dice su propia cita ` +
          `("${lit}" = ${eur(leido)}). Uno de los dos esta mal leido: el sospechoso habitual es el punto ` +
          `de miles confundido con la coma decimal.`,
        detalle: { campo, valor, literal: lit, literal_leido: leido, origen: "cita" },
      });
    }
  }

  // ── La segunda mirada (ver bloque 3c) ──
  if (verificacion && !datos.sin_importes) {
    // (1) El verificador dice que la fila del total NO esta impresa. Manda el
    //     verificador: es la unica de las dos lecturas que ha mirado esa fila
    //     a proposito, sin un documento entero que completar alrededor.
    if (verificacion.fila_total_impresa === false && esNumeroFinito(salida.total)) {
      const valor = salida.total;
      salida.total = null;
      retiradas.push({
        campo: "total",
        valor,
        alerta: {
          codigo: "importe_no_impreso",
          severidad: "alta",
          mensaje:
            `Se ha retirado el total a pagar (${eur(valor)}): una segunda lectura, hecha mirando SOLO el ` +
            `pie del documento, dice que esa fila NO esta impresa en la imagen` +
            (verificacion.ultimo_texto_visible
              ? ` (lo ultimo que se ve es "${verificacion.ultimo_texto_visible}")`
              : "") +
            `. El numero no se ha leido del papel. Si es deducible a partir de importes que SI estan ` +
            `impresos, se rellenara aparte y quedara marcado como deducido.`,
          detalle: {
            campo: "total",
            valor_retirado: valor,
            origen: "verificacion_pie",
            ultimo_texto_visible: verificacion.ultimo_texto_visible ?? null,
            motivo: verificacion.motivo ?? null,
          },
        },
      });
    }

    // (2) Las dos lecturas citan el mismo importe y no dicen lo mismo. No se
    //     retira nada: ninguna de las dos es autoridad sobre la otra, pero que
    //     discrepen es exactamente lo que hay que mirar a mano.
    const pares = [
      ["total", verificacion.total_citado, "el total a pagar"],
      ["subtotal", verificacion.base_imponible_citada, "la base imponible"],
      ["iva", verificacion.cuota_iva_citada, "la cuota de IVA"],
    ] as const;
    for (const [campo, citado, nombreCampo] of pares) {
      const valor = salida[campo];
      if (!esNumeroFinito(valor) || !citado) continue;
      const leido = leerImporteLiteral(citado);
      if (leido === null || Math.abs(leido - valor) <= TOL_LITERAL) continue;
      discordancias.push({
        codigo: "importe_discordante_verificador",
        severidad: "media",
        mensaje:
          `Dos lecturas independientes de la misma imagen no coinciden en ${nombreCampo}: la extraccion ` +
          `dice ${eur(valor)} y la segunda lectura del pie cita "${citado}" (${eur(leido)}). Una de las ` +
          `dos ha leido mal un digito o ha confundido el punto de miles con la coma decimal.`,
        detalle: { campo, valor_extraccion: valor, citado, citado_leido: leido, origen: "verificacion_pie" },
      });
    }
  }

  return { datos: salida, retiradas, discordancias };
}


// ─── 3c. La segunda mirada: un verificador que SOLO mira el pie ─────────────
//
//  POR QUE HACE FALTA UNA SEGUNDA LLAMADA
//  --------------------------------------
//  Con la cita del total puesta la primera del esquema, la factura 40295280 de
//  Osborne pasa de fabricar el total SIEMPRE a fabricarlo 1 de cada 3 veces.
//  Mejor, pero 1 de cada 3 sigue siendo un numero inventado entrando en la
//  contabilidad, y ninguna comprobacion aritmetica puede cazarlo: 376,31 es
//  exactamente 342,10 + 34,21, igual que en cualquier factura correcta.
//
//  Lo que se midio es que la MISMA pregunta, hecha SOLA, se acierta siempre.
//  Un modelo que esta extrayendo diecisiete campos de un documento entero
//  completa el pie que le falta casi sin darse cuenta; un modelo al que solo
//  se le pregunta "¿esta impresa la fila del TOTAL?" va a mirar los pixeles y
//  contesta que no. Medido: 3 de 3 aciertos en el documento recortado (27) y
//  4 de 4 en documentos completos (21 x2, 24, 30), con las citas correctas.
//
//  Cuesta unos 0,003 USD y unos diez segundos por documento. Es la comprobacion
//  mas barata del sistema y es la unica que separa "lo he leido" de "me lo he
//  encontrado sumando".
//
//  QUE PUEDE Y QUE NO PUEDE DECIDIR EL VERIFICADOR
//  ----------------------------------------------
//   · El TOTAL lo decide: trae un booleano explicito sobre esa fila, y si dice
//     que no esta impresa, el total se retira. Lo que quede deducible se
//     deducira despues, marcado como deducido, que es lo honesto.
//   · La BASE y la CUOTA no las decide: solo las cita. Si su cita y el numero
//     extraido no coinciden, se avisa, pero no se retira nada — son dos
//     lecturas independientes y ninguna de las dos es autoridad sobre la otra.

/** Respuesta del verificador de pie. Todos los campos pueden faltar: si la
 *  llamada falla, el documento sigue su camino sin verificar. */
export interface VerificacionPie {
  ultimo_texto_visible?: string;
  fila_total_impresa: boolean;
  total_citado: string | null;
  base_imponible_citada: string | null;
  cuota_iva_citada: string | null;
  motivo?: string;
}

/** Esquema estricto del verificador. Mismas reglas que el grande. */
export const VERIFICACION_PIE_SCHEMA = {
  name: "verificacion_pie",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "ultimo_texto_visible", "fila_total_impresa", "total_citado",
      "base_imponible_citada", "cuota_iva_citada", "motivo",
    ],
    properties: {
      ultimo_texto_visible: {
        type: "string",
        description:
          "Copia literal del ULTIMO texto legible de la parte inferior de la imagen, sea el que sea: " +
          "una fila de la tabla, un texto legal, la barra de un visor de PDF. Escribelo antes de " +
          "contestar lo demas: obliga a mirar donde acaba de verdad la foto.",
      },
      fila_total_impresa: {
        type: "boolean",
        description:
          "true si ves, CON SUS DIGITOS, el IMPORTE FINAL del documento. Lo que decide es si puedes " +
          "LEER la cifra, no como se llame la fila: segun la plantilla aparece como TOTAL, TOTAL " +
          "FACTURA, TOTAL ALBARAN, IMPORTE A PAGAR, SUMA TOTAL, LIQUIDO, SUBTOTAL, o recuadrada sin " +
          "etiqueta ninguna. Si la cifra esta en los pixeles y la estas leyendo, es true aunque su " +
          "etiqueta no diga la palabra TOTAL. false si la foto corta el documento antes de esa cifra, " +
          "si la tapa una sombra, un dedo o la barra de un visor, o si el documento no lleva total. Ver " +
          "la base imponible y la cuota de IVA NO es ver el total: en los documentos recortados es justo " +
          "lo que se ve, y el importe final va debajo, fuera del encuadre. La prueba es poder COPIAR los " +
          "digitos; si tendrias que calcularlos, es false.",
      },
      total_citado: {
        type: ["string", "null"],
        description: "Los caracteres del total tal como estan impresos ('3.010,61EUR'). null si no esta impreso.",
      },
      base_imponible_citada: {
        type: ["string", "null"],
        description: "Los caracteres de la base imponible tal como estan impresos. null si no se ve.",
      },
      cuota_iva_citada: {
        type: ["string", "null"],
        description: "Los caracteres de la CUOTA de IVA en euros. null si solo se ve el porcentaje o no se ve nada.",
      },
      motivo: {
        type: "string",
        description: "Una frase diciendo que se ve y que no en el pie, y por que has contestado eso.",
      },
    },
  },
} as const;

// ─── 3d. El contador de filas: la segunda mirada, pero a la tabla ───────────
//
//  POR QUE HACE FALTA
//  ------------------
//  `filas_tabla` lo cuenta el mismo modelo que luego escribe las filas, y en la
//  factura mensual ML/101511 de Luga (54 filas impresas) se midio que no sirve:
//  en tres ejecuciones devolvio 10 filas diciendo `filas_tabla: 10`, 5 filas
//  diciendo `filas_tabla: null`, y 6 filas. Cuando el recuento COINCIDE con las
//  filas que ha escrito, ninguna de las tres senales de `deducirImportes` salta
//  y la suma parcial se guarda como total deducido: 1.801,54 EUR de 3.787,53 en
//  una ejecucion, 101,23 EUR en otra. Es el fallo del 47 % otra vez.
//
//  LO QUE SI FUNCIONA, Y ESTA MEDIDO
//  ---------------------------------
//  Lo mismo que con el pie: la pregunta estrecha se acierta. Preguntando SOLO
//  "cuantas filas de concepto tiene esta tabla", sin extraer nada, el mismo
//  modelo contesta 54, 55 y 54 sobre el mismo 31.jpg (el papel tiene 54), y da
//  3, 3, 19 y 23 exactos en los documentos de 3, 3, 19 y 23 filas.
//
//  POR QUE SOLO SE PREGUNTA A VECES
//  --------------------------------
//  El contador no es infalible: en el albaran 22 (9 filas repartidas en cuatro
//  bloques) conto 13, y en el 24 (14 filas) conto 15. Si su recuento mandara
//  siempre, esos dos documentos —que hoy salen BIEN— se llenarian de avisos
//  falsos de `lineas_incompletas`, y un aviso falso se acaba ignorando.
//
//  Asi que se pregunta SOLO donde un recuento equivocado se convierte en
//  dinero equivocado: cuando el documento no imprime NI base, NI IVA, NI total
//  y el unico total posible es la SUMA DE LAS LINEAS (la regla B de
//  `deducirImportes`). Ahi, y solo ahi, una linea que falta es un total que
//  miente. En los demas documentos el pie impreso ya es la comprobacion: si
//  faltan lineas, la suma no llega al subtotal y salta `descuadre_cabecera`.

/** Respuesta del contador de filas. */
export interface RecuentoFilas {
  primera_fila?: string;
  ultima_fila?: string;
  filas_por_bloque?: number[];
  filas_tabla: number | null;
  motivo?: string;
}

/** Esquema estricto del contador. Mismas reglas que los otros dos. */
export const RECUENTO_FILAS_SCHEMA = {
  name: "recuento_filas",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["primera_fila", "ultima_fila", "filas_por_bloque", "filas_tabla", "motivo"],
    properties: {
      primera_fila: {
        type: "string",
        description:
          "Texto de la PRIMERA fila de concepto, copiado tal cual. Escribelo antes de contar: obliga a " +
          "localizar donde empieza la tabla de verdad.",
      },
      ultima_fila: {
        type: "string",
        description:
          "Texto de la ULTIMA fila de concepto, copiado tal cual. Obliga a localizar donde acaba.",
      },
      filas_por_bloque: {
        type: "array",
        items: { type: "integer" },
        description:
          "Filas de cada bloque, pagina o albaran que veas, en orden. Si es una sola tabla seguida, un " +
          "solo numero. Contar por bloques es lo que evita perderse en una factura mensual.",
      },
      filas_tabla: {
        type: ["integer", "null"],
        description:
          "TOTAL de filas de concepto impresas, la suma de 'filas_por_bloque'. null solo si es " +
          "materialmente imposible contarlas.",
      },
      motivo: {
        type: "string",
        description: "Como has contado y por que sale ese numero.",
      },
    },
  },
} as const;

/**
 * Sube `filas_tabla` al recuento del contador cuando este ve MAS filas que el
 * extractor. Nunca lo baja, por lo mismo que `conservarRecuentoFilas`: bajar
 * el recuento hasta las lineas escritas es la forma barata de callar el aviso.
 *
 * Devuelve el documento (nuevo si cambia algo) y, cuando el contador ve mas
 * filas de las que se han extraido, la alerta que lo explica. Fail-open: sin
 * recuento util no toca nada.
 */
export function aplicarRecuentoVerificado(
  datos: DocumentoExtraido,
  recuento: RecuentoFilas | null | undefined,
): { datos: DocumentoExtraido; alerta: AlertaValidacion | null } {
  const contadas = recuento && esNumeroFinito(recuento.filas_tabla)
    ? Math.round(recuento.filas_tabla)
    : null;
  if (contadas === null || contadas <= 0) return { datos, alerta: null };

  const propias = esNumeroFinito(datos.filas_tabla) ? Math.round(datos.filas_tabla) : null;
  const mayor = propias === null ? contadas : Math.max(propias, contadas);
  const salida = mayor === propias ? datos : { ...datos, filas_tabla: mayor };

  const emitidas = salida.productos?.length ?? 0;
  if (contadas <= emitidas) return { datos: salida, alerta: null };

  return {
    datos: salida,
    alerta: {
      codigo: "recuento_filas_discordante",
      severidad: "alta",
      mensaje:
        `Una segunda lectura, hecha SOLO para contar, dice que la tabla tiene ${contadas} filas de ` +
        `concepto impresas, pero la extraccion ha devuelto ${emitidas}. Como este documento no imprime ` +
        `ni base, ni IVA, ni total, su total tendria que salir de sumar las lineas, y una suma a la que ` +
        `le faltan filas no es el total del documento. Contrasta con el papel.`,
      detalle: {
        filas_contadas: contadas,
        lineas_extraidas: emitidas,
        filas_tabla_extractor: propias,
        filas_por_bloque: recuento?.filas_por_bloque ?? null,
        primera_fila: recuento?.primera_fila ?? null,
        ultima_fila: recuento?.ultima_fila ?? null,
        origen: "contador_filas",
      },
    },
  };
}


// ─── 4. Deduccion aritmetica de un total que el documento NO imprime ────────
//
//  EL CASO QUE LO MOTIVA. Factura F/25011959 de Salazones Garre: es una
//  FACTURA (no un albaran), trae tres lineas con importe leido
//  (208,32 + 105,00 + 123,60) y en la foto el bloque de totales se quedo
//  FUERA DEL ENCUADRE. El modelo hizo lo correcto —no inventar lo que no
//  puede ver— y la fila quedo con subtotal, iva y total a NULL. Pero 436,92
//  no es un dato inexistente: es la suma EXACTA de tres numeros que si estan
//  leidos, y perderla es tirar informacion que ya teniamos.
//
//  ESTO NO ES LO MISMO QUE EL MODELO INVENTANDO IMPORTES.
//  La diferencia tiene que quedar clara en el codigo y en la base de datos:
//
//   · `contarCambiosNumericos` + `MAX_CAMBIOS_RELECTURA` defienden de que el
//     MODELO altere valores YA LEIDOS para forzar el cuadre (ReceiptBench).
//     Esa defensa NO SE TOCA aqui: no se sube el umbral, no se esquiva, y no
//     se deduce nada dentro del ciclo de relectura.
//   · `deducirImportes` corre DESPUES de `comprobarCuadre`, en NUESTRO
//     codigo, con aritmetica exacta, y SOLO RELLENA HUECOS (`null`). No
//     sobrescribe jamas un valor leido, asi que no puede hacer callar a
//     ninguna comprobacion: un campo que estaba a null no se habia comparado
//     con nada.
//   · El resultado queda marcado como `deducido` en `facturas.total_origen`
//     (migracion 20260928160000). Un total leido del papel y un total
//     calculado por nosotros no son el mismo dato, y el dueno tiene que
//     poder distinguirlos de un vistazo. La base y el IVA deducidos no tienen
//     columna de origen: lo dice el aviso, con el desglose.
//
//  QUE ES HONESTAMENTE DEDUCIBLE — Y QUE NO
//  ----------------------------------------
//  De las lineas solas sale la BASE IMPONIBLE: su suma. El IVA sale de las
//  lineas SOLO si cada una trae IMPRESO su tipo (columna «IVA» por fila, como
//  en las facturas mensuales de Luga: 10 % casi todo, 4 % el pan sin gluten y
//  las rosquillas). Sin esa columna el tipo puede ser el 10 %, el 21 % o una
//  mezcla, y elegir uno seria inventarselo. De ahi las reglas:
//
//    A. `subtotal` e `iva` LEIDOS y `total` ausente -> total = subtotal + iva.
//       Aritmetica exacta sobre dos importes impresos. Cero supuestos.
//    B. NI `subtotal` NI `iva` NI `total` impresos, TODAS las lineas con
//       importe y la lectura COMPLETA (ver mas abajo, caso Luga):
//       B1. Todas las lineas con importe traen su tipo de IVA ->
//           subtotal = suma de lineas; iva = suma, POR TIPO, de base x tipo,
//           con cada cuota redondeada a centimos (asi lo hacen las facturas
//           espanolas: una cuota por tipo, no una por linea); total =
//           subtotal + iva. Sin recargo de equivalencia: no consta en ningun
//           sitio que se lea. Metodo `iva_por_linea`, aviso `total_deducido`.
//       B2. Alguna linea sin tipo -> subtotal = suma de lineas y el TOTAL SE
//           QUEDA A NULL, con el aviso `falta_iva`. Metodo `base_sin_iva`.
//    C. Cualquier otra combinacion -> NO SE DEDUCE NADA. Si el documento
//       imprime PARTE del bloque de totales (solo la base, o solo el IVA) es
//       que ese bloque existe y solo hemos leido un trozo de el; completarlo
//       nosotros seria reconstruirlo a ojo, no calcularlo.
//
//  POR QUE B2 YA NO GUARDA LA SUMA COMO TOTAL (06/10/2026)
//  -------------------------------------------------------
//  Hasta hoy B guardaba `total = suma de lineas` con un aviso que decia "si
//  habia IVA, el total real sera mayor". En Luga ML/101511 (factura 54) eso
//  dejo total = 3.787,53, que es la BASE: el total real era 4.162,54. Y el
//  chatbot trata `facturas.total` como IVA INCLUIDO (herramientas.ts y las
//  RPC *_agente: "Gasto por proveedor: suma del total (IVA incluido)"), asi
//  que la base entraba en el gasto como si fuera el total, ~10 % por debajo,
//  sin que nadie leyera el aviso. Un total con IVA que es una base miente
//  igual que uno parcial.
//  Lo honesto con lo que hay: la suma va a `subtotal` (es exactamente eso, la
//  base) y el total se queda vacio. Un total NULL ya tiene tratamiento en todo
//  el sistema: validar_cordura_factura avisa `total_ausente`, el chatbot lo
//  cuenta en `documentos_sin_total` en vez de sumarlo, y el panel pide
//  completarlo en "Editar". Se pierde un numero aproximado en el gasto; a
//  cambio, ningun gasto sale calculado sobre una base presentada como total.
//
//  `subtotal` e `iva` SOLO se escriben en B (las lineas son la unica fuente y
//  el pie no existe). NUNCA en A ni en C, ni por resta:
//    (1) con medio pie leido, el IVA que falta no es derivable de las lineas
//        sin reconstruir el pie, y un IVA inventado es indistinguible de uno
//        leido;
//    (2) `comprobarCuadre` usa `subtotal ?? total` como REFERENCIA contra la
//        que compara la suma de lineas. Escribir en B la suma de lineas no le
//        quita nada: corre ANTES, y con el pie vacio no tenia referencia; y
//        `validar_cordura_factura` comparaba antes esa misma suma contra el
//        total deducido, que era la misma suma. En A y C si habria referencia
//        leida, y no se toca.
//
//  POR QUE LA REGLA B EXIGE ADEMAS QUE LA LECTURA ESTE COMPLETA
//  ------------------------------------------------------------
//  La regla B suponia que el unico riesgo era un bloque de IVA no visto. Hay
//  otro peor, y se midio en la factura ML/101511 de Luga Sabores: el modelo
//  habia extraido 11 de las 54 filas impresas, asi que la "suma de lineas" era
//  1.772,82 EUR cuando el documento vale 3.787,53. Se guardo ese 1.772,82
//  marcado como `deducido`, con su aviso. Antes ese campo estaba a NULL.
//
//  Un numero con pinta de calculado y con el 47 % del valor real es PEOR que
//  el hueco: el hueco se ve, y el 47 % entra en la contabilidad cuadrando lo
//  suficiente para que nadie lo mire. La suma de lineas solo vale como total
//  si las lineas son TODAS las del papel, y para saberlo hay tres senales que
//  el modelo observa sobre la imagen:
//
//    · `filas_tabla` != `productos.length` -> faltan (o sobran) filas.
//    · `continua_en_otra_pagina` -> hay documento que no se ha visto.
//    · `filas_tabla` a null -> el propio modelo dice que no pudo contarlas.
//
//  Con cualquiera de las tres NO se deduce nada (ni base, ni IVA, ni total):
//  se deja el aviso `total_no_deducible` diciendo por que. La deduccion A
//  (`subtotal + iva`, los dos impresos) NO se toca: no depende de las lineas.
//
//  Un albaran SIN PRECIOS (el caso Joselito) sale por el primer `return`:
//  `sin_importes` significa que en el papel no hay ni un euro, asi que no hay
//  nada que sumar y el documento se queda —correctamente— SIN TOTAL.

/** De donde sale el importe de `facturas.total`. Mismo vocabulario que la
 *  columna `facturas.total_origen`. */
export type OrigenImporte = "leido" | "deducido";

/** Como se ha llegado al importe deducido. Va en `detalle.metodo` del aviso. */
export type MetodoDeduccion = "subtotal_mas_iva" | "iva_por_linea" | "base_sin_iva" | "no_deducible";

export interface Deduccion {
  /** El importe que se ha rellenado: `total` (A y B1; en B1 tambien base e
   *  IVA) o solo `subtotal` (B2, el total se queda a null). */
  campo: "total" | "subtotal";
  /** Con `metodo: "no_deducible"` este valor NO se escribe en ningun sitio: la
   *  `Deduccion` viaja solo para llevar su `alerta`, y `datos.total` sigue a
   *  null. Quien la consume tiene que mirar `metodo`, no `valor`. */
  valor: number;
  metodo: MetodoDeduccion;
  /** Aviso para `alertas_validacion`: que el importe no se leyo tiene que
   *  verse tambien donde se miran los avisos, no solo en la columna. */
  alerta: AlertaValidacion;
}

/** Tipos de IVA (e IGIC) espanoles: 0, 2, 3, 4, 5, 7, 7,5, 9,5, 10, 15, 21.
 *  Por encima de esto no es un tipo de IVA: es otra columna mal leida. */
const IVA_PCT_MAX = 30;

/**
 * Normaliza el tipo de IVA de una linea: un porcentaje finito entre 0 y 30, a
 * dos decimales. Cualquier otra cosa (null, NaN, 110, un -10) es "sin tipo":
 * mejor un hueco que un tipo inventado.
 */
export function tipoIvaLinea(v: unknown): number | null {
  if (!esNumeroFinito(v) || v < 0 || v > IVA_PCT_MAX) return null;
  return Math.round(v * 100) / 100;
}

/** Un tipo de IVA del desglose: base, cuota (ya redondeada) y lineas. */
export interface TramoIva {
  tipo: number;
  base: number;
  cuota: number;
  lineas: number;
}

export interface DesgloseIva {
  /** Ordenados de mayor a menor tipo. */
  tramos: TramoIva[];
  /** Suma de TODAS las lineas (con y sin tipo). */
  base: number;
  /** Suma de las cuotas de los tramos. Solo es el IVA del documento si
   *  `lineas_sin_tipo` es 0. */
  cuota: number;
  /** Lineas con importe distinto de 0 y sin tipo de IVA legible. */
  lineas_sin_tipo: number;
}

/** Redondeo a centimos "de factura": la mitad se aleja del cero. */
const redondearCentimos = (centimosPorCien: number) =>
  Math.sign(centimosPorCien) * Math.round(Math.abs(centimosPorCien) + Number.EPSILON);

/**
 * Desglose del IVA a partir del tipo de cada linea, como lo imprime una
 * factura espanola: las bases se agrupan por tipo y la cuota de cada tipo se
 * redondea a centimos UNA vez (no linea a linea). Todo en centimos enteros
 * para no arrastrar coma flotante (3.725,10 x 10 % = 372,51 exacto).
 * Las lineas sin importe cuentan como 0. Una linea a 0 EUR (bonificada) sin
 * tipo no cuenta como "sin tipo": no aporta IVA tenga el que tenga.
 */
export function desgloseIvaPorLinea(lineas: LineaExtraida[]): DesgloseIva {
  const porTipo = new Map<number, { base: number; lineas: number }>();
  let baseTotal = 0;
  let sinTipo = 0;
  for (const l of lineas) {
    const c = esNumeroFinito(l.total) ? Math.round(l.total * 100) : 0;
    baseTotal += c;
    if (c === 0) continue;
    const tipo = tipoIvaLinea(l.iva_pct);
    if (tipo === null) {
      sinTipo++;
      continue;
    }
    const t = porTipo.get(tipo) ?? { base: 0, lineas: 0 };
    t.base += c;
    t.lineas++;
    porTipo.set(tipo, t);
  }
  const tramos = [...porTipo.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([tipo, t]) => ({
      tipo,
      base: t.base / 100,
      cuota: redondearCentimos((t.base * tipo) / 100) / 100,
      lineas: t.lineas,
    }));
  const cuota = tramos.reduce((a, t) => a + Math.round(t.cuota * 100), 0) / 100;
  return { tramos, base: baseTotal / 100, cuota, lineas_sin_tipo: sinTipo };
}

/** "10 %: base 3725.10 EUR -> IVA 372.51 EUR; 4 %: ..." para los avisos. */
function describirTramos(tramos: TramoIva[]): string {
  return tramos
    .map((t) => `${String(t.tipo).replace(".", ",")} %: base ${eur(t.base)} -> IVA ${eur(t.cuota)}`)
    .join("; ");
}

/**
 * Rellena `total` (y en el caso B1 tambien `subtotal` e `iva`) cuando el
 * documento no lo imprime pero SI se puede calcular con aritmetica exacta a
 * partir de lo que si esta leido.
 *
 * Devuelve SIEMPRE un documento nuevo (no muta la entrada) y, si ha deducido
 * algo, la `Deduccion` con el metodo y el aviso que hay que guardar.
 *
 * Invariantes que este codigo mantiene, y que los tests fijan:
 *  - nunca sobrescribe un importe leido del documento (subtotal, iva, total);
 *  - nunca escribe en `subtotal` ni en `iva` si alguno de los tres se ha
 *    leido (reglas A y C);
 *  - nunca inventa un tipo de IVA: sin el tipo IMPRESO en TODAS las lineas
 *    con importe, el total se queda a null (B2);
 *  - nunca deduce sobre un documento `sin_importes` (albaran sin precios);
 *  - nunca deduce si alguna linea se quedo sin importe (la suma no seria la
 *    del documento, sino la de lo que se pudo leer);
 *  - nunca deduce por las lineas si hay indicios de que faltan filas
 *    (`filas_tabla`, `continua_en_otra_pagina`): en ese caso devuelve una
 *    `Deduccion` con `metodo: "no_deducible"`, que NO trae importe y solo
 *    sirve para llevar el aviso.
 */
export function deducirImportes(datos: DocumentoExtraido): {
  datos: DocumentoExtraido;
  deduccion: Deduccion | null;
} {
  const sinDeducir = { datos, deduccion: null };

  // Albaran sin un solo importe impreso: no hay nada que sumar. (Joselito)
  if (datos.sin_importes) return sinDeducir;

  // Un total leido del papel manda siempre. Aqui solo se rellenan huecos.
  if (esNumeroFinito(datos.total)) return sinDeducir;

  // ── A) El bloque de totales esta impreso salvo su ultima linea ──
  if (esNumeroFinito(datos.subtotal) && esNumeroFinito(datos.iva)) {
    const total = redondear2(datos.subtotal + datos.iva);
    return {
      datos: { ...datos, total },
      deduccion: {
        campo: "total",
        valor: total,
        metodo: "subtotal_mas_iva",
        alerta: {
          codigo: "total_deducido",
          severidad: "media",
          mensaje:
            `El documento no declara total a pagar. Se ha CALCULADO como base ${eur(datos.subtotal)} ` +
            `+ IVA ${eur(datos.iva)} = ${eur(total)}: aritmetica exacta sobre dos importes que si ` +
            `estan impresos, pero el total NO se ha leido del papel.`,
          detalle: {
            metodo: "subtotal_mas_iva",
            subtotal: datos.subtotal,
            iva: datos.iva,
            total,
            origen: "deduccion",
          },
        },
      },
    };
  }

  // ── C) Medio bloque de totales leido: no se completa a ojo ──
  //    Si hay base pero no IVA (o al reves), el documento SI tiene bloque de
  //    totales y solo hemos leido un trozo. Lo que falta no se calcula.
  if (esNumeroFinito(datos.subtotal) || esNumeroFinito(datos.iva)) return sinDeducir;

  // ── B) Lo unico que hay son lineas ──
  const lineas = datos.productos ?? [];
  if (lineas.length === 0) return sinDeducir;

  //    ...pero SOLO si estan TODAS. Ver la explicacion de arriba (caso Luga):
  //    sumar una lectura incompleta da un importe con pinta de calculado y
  //    con una fraccion del valor real, que es peor que no tenerlo.
  const motivos: string[] = [];
  if (datos.continua_en_otra_pagina === true) {
    motivos.push("el documento continua en otra pagina o la tabla se corta en el borde de la imagen");
  }
  if (datos.filas_tabla === null) {
    motivos.push("el modelo no ha podido contar las filas impresas de la tabla");
  } else if (esNumeroFinito(datos.filas_tabla) && Math.round(datos.filas_tabla) !== lineas.length) {
    motivos.push(
      `el papel tiene ${Math.round(datos.filas_tabla)} filas impresas y se han extraido ${lineas.length}`,
    );
  }
  if (motivos.length > 0) {
    const parcial = redondear2(lineas.reduce((a, l) => a + ((l.total as number) ?? 0), 0));
    return {
      datos,
      deduccion: {
        campo: "total",
        valor: 0,
        metodo: "no_deducible",
        alerta: {
          codigo: "total_no_deducible",
          severidad: "alta",
          mensaje:
            `El documento no declara ni base imponible, ni IVA, ni total, y la lectura de las lineas no ` +
            `parece completa (${motivos.join("; ")}). NO se deduce ningun total: la suma de las ` +
            `${lineas.length} linea(s) leidas seria ${eur(parcial)}, pero es la suma de lo que se pudo ` +
            `leer, no la del documento. El total se queda vacio a proposito: un importe parcial con ` +
            `pinta de calculado es peor que un hueco.`,
          detalle: {
            metodo: "no_deducible",
            motivos,
            num_lineas_extraidas: lineas.length,
            filas_tabla: datos.filas_tabla ?? null,
            continua_en_otra_pagina: datos.continua_en_otra_pagina ?? null,
            suma_lineas_parcial: parcial,
            origen: "deduccion",
          },
        },
      },
    };
  }
  // TODAS las lineas tienen que traer importe. Si falta el de una, la suma no
  // es la del documento: es la de lo que se pudo leer, y pasarla por base o
  // por total seria dar por completo un numero incompleto.
  if (!lineas.every((l) => esNumeroFinito(l.total))) return sinDeducir;

  const desglose = desgloseIvaPorLinea(lineas);
  const base = desglose.base;

  // ── B1) Cada linea trae su tipo de IVA impreso: el IVA SI es calculable ──
  if (desglose.lineas_sin_tipo === 0) {
    const iva = desglose.cuota;
    const total = redondear2(base + iva);
    return {
      datos: { ...datos, subtotal: base, iva, total },
      deduccion: {
        campo: "total",
        valor: total,
        metodo: "iva_por_linea",
        alerta: {
          codigo: "total_deducido",
          severidad: "media",
          mensaje:
            `El documento no declara ni base imponible, ni IVA, ni total: el bloque de totales no se ve ` +
            `(recortado, en blanco o fuera del encuadre). Se ha CALCULADO deducido con el IVA de cada ` +
            `linea: base ${eur(base)} (suma de ${lineas.length} linea(s)) + IVA ${eur(iva)} ` +
            `(${describirTramos(desglose.tramos) || "sin importes"}) = ${eur(total)}. Sin recargo de ` +
            `equivalencia (no consta). Si el pie llevara portes, descuentos, recargo o retencion, o los ` +
            `importes de linea ya incluyeran el IVA, el total real sera distinto: contrastalo con el papel.`,
          detalle: {
            metodo: "iva_por_linea",
            num_lineas: lineas.length,
            subtotal: base,
            iva,
            total,
            desglose: desglose.tramos,
            recargo_equivalencia: null,
            origen: "deduccion",
          },
        },
      },
    };
  }

  // ── B2) Sin el tipo de cada linea el IVA no se sabe: base si, total no ──
  return {
    datos: { ...datos, subtotal: base },
    deduccion: {
      campo: "subtotal",
      valor: base,
      metodo: "base_sin_iva",
      alerta: {
        codigo: "falta_iva",
        severidad: "media",
        mensaje:
          `El documento no declara ni base imponible, ni IVA, ni total: el bloque de totales no se ve ` +
          `(recortado, tapado o fuera del encuadre), y ${desglose.lineas_sin_tipo} de las ` +
          `${lineas.length} linea(s) no traen su tipo de IVA. Se guarda como BASE la suma de las lineas, ` +
          `${eur(base)}, y el TOTAL SE DEJA VACIO a proposito: falta el IVA, y esa base presentada como ` +
          `total con IVA infravaloraria el gasto. Completa el IVA y el total con el papel en "Editar".`,
        detalle: {
          metodo: "base_sin_iva",
          num_lineas: lineas.length,
          lineas_sin_tipo: desglose.lineas_sin_tipo,
          subtotal: base,
          suma_lineas: base,
          total: null,
          origen: "deduccion",
        },
      },
    },
  };
}
