// ============================================================================
//  pagina.ts · Una PIEZA de un documento largo (página o franja)
// ----------------------------------------------------------------------------
//  04b §1.6: esquema estricto por pieza, tipos, validación (segunda red),
//  contexto de la pieza 1 para las demás, motivos locales de relectura y el
//  mensaje correctivo. Puro: sin Deno ni red (lo prueba vitest).
//
//  PIEZA = lo que se manda al modelo en una llamada:
//    · "pagina": una página entera (PDF partido en el navegador o una foto por
//      hoja).
//    · "franja": un trozo horizontal de una imagen muy alta (captura de móvil
//      con varias páginas apiladas, ticket largo), con unos renglones de
//      SOLAPE con la franja vecina. Decisión del dueño, 05-oct-2026.
// ============================================================================

import {
  comprobarCuadre,
  type DocumentoExtraido,
  leerImporteLiteral,
  type LineaExtraida,
  type RecuentoFilas,
  type VerificacionPie,
} from "./esquema.ts";

// ─── 1. Esquema estricto ─────────────────────────────────────────────────────
//  Mismas reglas que DOCUMENTO_JSON_SCHEMA: todo en `required`, opcionales como
//  unión con null, additionalProperties:false en cada objeto. Las citas del pie
//  van las PRIMERAS (esquema.ts:68-75, caso Osborne).

const strNull = { type: ["string", "null"] } as const;
const numNull = { type: ["number", "null"] } as const;

const ARRASTRE = {
  type: "object",
  additionalProperties: false,
  required: ["presente", "literal", "importe"],
  properties: {
    presente: { type: "boolean" },
    literal: { ...strNull, description: "Texto de la fila tal cual ('Suma y sigue 1.234,56')." },
    importe: numNull,
  },
} as const;

export const PAGINA_JSON_SCHEMA = {
  name: "pagina_documento",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "pie", "pagina_visible", "cabecera_visible", "sin_importes", "formato_numerico", "columnas",
      "arrastre_entrada", "primera_fila", "ultima_fila", "filas_tabla", "lineas", "arrastre_salida",
      "albaran_abierto_al_final", "continua_en_otra_pagina", "observaciones", "resumen",
    ],
    properties: {
      pie: {
        type: "object",
        additionalProperties: false,
        description:
          "LO PRIMERO, mirando el PIE DE ESTA IMAGEN. Solo si aquí se ve el bloque de totales CON VALORES " +
          "impresos. Si no se ve, o se ve vacío, todo null (y tabla_totales_vacia según corresponda). No " +
          "calcules nada.",
        required: [
          "total_literal", "subtotal_literal", "iva_literal", "subtotal", "iva", "total", "tabla_totales_vacia",
        ],
        properties: {
          total_literal: { ...strNull, description: "Caracteres impresos del TOTAL A PAGAR; null si no se ve." },
          subtotal_literal: { ...strNull, description: "Caracteres impresos de la BASE; null si no se ve." },
          iva_literal: { ...strNull, description: "Caracteres impresos de la CUOTA de IVA en euros (no el %)." },
          subtotal: numNull,
          iva: numNull,
          total: numNull,
          tabla_totales_vacia: {
            type: "boolean",
            description:
              "true si se ve el recuadro de totales con sus cabeceras pero las celdas en blanco (pie de una " +
              "página intermedia).",
          },
        },
      },
      pagina_visible: {
        type: "object",
        additionalProperties: false,
        required: ["literal", "numero_impreso", "total_impreso"],
        properties: {
          literal: { ...strNull, description: "'Pág. 1/2', 'Hoja 2 de 3' tal cual; null si no se ve." },
          numero_impreso: { type: ["integer", "null"] },
          total_impreso: { type: ["integer", "null"] },
        },
      },
      cabecera_visible: {
        type: "object",
        additionalProperties: false,
        description: "SOLO lo que se ve en ESTA imagen. null en lo que no esté.",
        required: [
          "titulo_literal", "tipo", "proveedor", "cif", "numero_documento", "numero_etiqueta_literal", "fecha",
          "fecha_literal",
        ],
        properties: {
          titulo_literal: { ...strNull, description: "La palabra grande del título: 'FACTURA', 'ALBARÁN'." },
          tipo: { type: ["string", "null"], enum: ["factura", "albaran", null] },
          proveedor: { ...strNull, description: "Quien EMITE. Nunca el restaurante (MASIDE 2011 / Casa Tomás)." },
          cif: { ...strNull, description: "CIF del EMISOR. Nunca B54583356 (es el del cliente)." },
          numero_documento: { ...strNull, description: "Nº de factura/albarán con sus ceros y prefijos." },
          numero_etiqueta_literal: {
            ...strNull,
            description: "La etiqueta impresa junto al número ('N. Factura:', 'Albaranes:', 'Pedido:').",
          },
          fecha: { ...strNull, description: "YYYY-MM-DD. En España DD/MM/AAAA." },
          fecha_literal: strNull,
        },
      },
      sin_importes: {
        type: "boolean",
        description: "true si esta imagen NO lleva ningún precio ni importe en euros (albarán de entrega).",
      },
      formato_numerico: {
        type: "object",
        additionalProperties: false,
        required: ["formato", "ejemplo_literal"],
        properties: {
          formato: {
            type: "string",
            enum: ["es", "en", "mixto", "desconocido"],
            description: "'es' = 1.234,56 ; 'en' = 1,234.56 ; según lo impreso en ESTA imagen.",
          },
          ejemplo_literal: { ...strNull, description: "Un importe copiado tal cual que lo demuestre." },
        },
      },
      columnas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["cabecera_literal", "rol"],
          properties: {
            cabecera_literal: { type: "string" },
            rol: {
              type: "string",
              enum: [
                "descripcion", "referencia", "lote", "albaran", "cantidad", "unidad", "peso", "precio_unitario",
                "descuento", "importe", "iva_pct", "otro",
              ],
            },
          },
        },
      },
      arrastre_entrada: { ...ARRASTRE, description: "Fila 'Suma anterior' / 'Viene de' ARRIBA de la tabla." },
      primera_fila: {
        type: "object",
        additionalProperties: false,
        required: ["texto_literal", "partida_desde_pagina_anterior"],
        properties: {
          texto_literal: { ...strNull, description: "Texto de la primera fila de producto extraída." },
          partida_desde_pagina_anterior: { type: "boolean" },
        },
      },
      ultima_fila: {
        type: "object",
        additionalProperties: false,
        description:
          "ANTES de extraer las líneas, baja hasta el BORDE INFERIOR de la imagen y copia la ÚLTIMA fila de " +
          "producto completa que se ve. Es tu señal de parada: las líneas se extraen hasta llegar a ESA fila, " +
          "ni una antes. Un segundo lote o una descripción en un renglón aparte NO es el final de la tabla.",
        required: ["texto_literal", "continua_en_pagina_siguiente"],
        properties: {
          texto_literal: { ...strNull, description: "Texto de la última fila de producto completa de la imagen." },
          continua_en_pagina_siguiente: { type: "boolean" },
        },
      },
      filas_tabla: {
        type: ["integer", "null"],
        description:
          "Filas de producto que ves en ESTA imagen, de la primera a la de 'ultima_fila', contadas una a una " +
          "antes de extraer.",
      },
      lineas: {
        type: "array",
        description:
          "Una entrada por CADA fila de producto impresa en esta imagen, de arriba abajo, desde 'primera_fila' " +
          "hasta 'ultima_fila' (ambas incluidas), incluidas las repetidas y las de importe 0. No pares antes de " +
          "llegar a 'ultima_fila'.",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "nombre", "cantidad", "unidad", "peso_kg", "base_precio", "precio_unitario", "total", "importe_literal",
            "bonificada", "albaran_ref", "es_fila_arrastre", "partida",
          ],
          properties: {
            nombre: { type: "string", description: "Descripción sin códigos ni lote. PUEDE REPETIRSE." },
            cantidad: { type: "number", description: "Unidades de venta; si se factura al peso, los kilos." },
            unidad: { type: "string" },
            peso_kg: { ...numNull, description: "Solo si hay columna de peso APARTE de la cantidad." },
            base_precio: { type: "string", enum: ["por_unidad", "por_kg", "por_litro", "desconocida"] },
            precio_unitario: { ...numNull, description: "Tal como está impreso; null si no se imprime." },
            total: { ...numNull, description: "Importe de la línea tal como está impreso; null si no se ve." },
            importe_literal: { ...strNull, description: "Los caracteres del importe de la línea ('1,547.26')." },
            bonificada: { type: "boolean" },
            albaran_ref: {
              ...strNull,
              description: "Nº del albarán del que cuelga la fila, si se ve EN ESTA imagen ('V/ 781.316').",
            },
            es_fila_arrastre: {
              type: "boolean",
              description: "true para 'Suma y sigue', 'Suma anterior', 'Viene de': NO son productos.",
            },
            partida: { type: "string", enum: ["no", "continua_de_anterior", "continua_en_siguiente"] },
          },
        },
      },
      arrastre_salida: { ...ARRASTRE, description: "Fila 'Suma y sigue' / 'A trasladar' ABAJO de la tabla." },
      albaran_abierto_al_final: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "fecha_literal"],
        properties: { ref: strNull, fecha_literal: strNull },
      },
      continua_en_otra_pagina: { type: "boolean" },
      observaciones: strNull,
      resumen: { ...strNull, description: "1-2 frases (género, proveedor, importe). null si no aporta." },
    },
  },
} as const;

// ─── 2. Tipos ────────────────────────────────────────────────────────────────

export type FormatoNumerico = "es" | "en" | "mixto" | "desconocido";
export type Partida = "no" | "continua_de_anterior" | "continua_en_siguiente";

export interface PiePagina {
  total_literal: string | null;
  subtotal_literal: string | null;
  iva_literal: string | null;
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  tabla_totales_vacia: boolean;
}

export interface CabeceraVisible {
  titulo_literal: string | null;
  tipo: "factura" | "albaran" | null;
  proveedor: string | null;
  cif: string | null;
  numero_documento: string | null;
  numero_etiqueta_literal: string | null;
  fecha: string | null;
  fecha_literal: string | null;
}

export interface Arrastre {
  presente: boolean;
  literal: string | null;
  importe: number | null;
}

export interface LineaPagina extends LineaExtraida {
  importe_literal: string | null;
  albaran_ref: string | null;
  es_fila_arrastre: boolean;
  partida: Partida;
}

export interface ResultadoPagina {
  pie: PiePagina;
  pagina_visible: { literal: string | null; numero_impreso: number | null; total_impreso: number | null };
  cabecera_visible: CabeceraVisible;
  sin_importes: boolean;
  formato_numerico: { formato: FormatoNumerico; ejemplo_literal: string | null };
  columnas: { cabecera_literal: string; rol: string }[];
  arrastre_entrada: Arrastre;
  primera_fila: { texto_literal: string | null; partida_desde_pagina_anterior: boolean };
  filas_tabla: number | null;
  lineas: LineaPagina[];
  ultima_fila: { texto_literal: string | null; continua_en_pagina_siguiente: boolean };
  arrastre_salida: Arrastre;
  albaran_abierto_al_final: { ref: string | null; fecha_literal: string | null };
  continua_en_otra_pagina: boolean;
  observaciones: string | null;
  resumen: string | null;
}

/** Contexto que la pieza 1 deja para las demás (ocr_trabajos.contexto_p1). */
export interface ContextoPagina {
  proveedor: string | null;
  numero_documento: string | null;
  tipo_titulo: string | null;
  formato_numerico: FormatoNumerico;
  ejemplo_numerico: string | null;
  columnas: { cabecera_literal: string; rol: string }[];
  albaran_abierto_al_final_p1: { ref: string | null; fecha_literal: string | null } | null;
  ultima_fila_p1: string | null;
  arrastre_salida_p1: number | null;
  num_piezas: number;
}

export type TipoPieza = "pagina" | "franja";

/** Una pieza ya cerrada, tal como la lee la consolidación de la base de datos. */
export interface PaginaCerrada {
  pagina_id: number;
  /** 1..N, orden de subida. */
  numero: number;
  pieza: TipoPieza;
  /** Página del documento (1..). En franjas de una misma imagen, la misma. */
  pagina_doc: number;
  /** Índice de franja dentro de su página (1..); null en páginas enteras. */
  franja: number | null;
  estado: "completada" | "fallida";
  resultado: ResultadoPagina | null;
  recuento: RecuentoFilas | null;
  verificacion_pie: VerificacionPie | null;
  relecturas: number;
}

// ─── 3. Validación (segunda red) ─────────────────────────────────────────────

export interface ProblemaPagina {
  campo: string;
  mensaje: string;
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const esNumONull = (v: unknown) => v === null || esNum(v);
const esStrONull = (v: unknown) => v === null || typeof v === "string";
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const numOrNull = (v: unknown) => (esNum(v) ? v : null);

/**
 * Valida y NORMALIZA una respuesta por pieza. Las líneas son estrictas (un
 * número que no es número es un fallo con su ruta); los bloques de anclaje
 * (pie, cabecera, arrastres…) se completan con null si faltan, porque su
 * ausencia solo resta información a la consolidación, no la corrompe.
 */
export function validarPagina(
  raw: unknown,
): { ok: true; datos: ResultadoPagina } | { ok: false; problemas: ProblemaPagina[] } {
  const problemas: ProblemaPagina[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problemas: [{ campo: "(raiz)", mensaje: "no es un objeto" }] };
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.lineas)) problemas.push({ campo: "lineas", mensaje: "no es una lista" });

  const lineas: LineaPagina[] = [];
  (Array.isArray(r.lineas) ? r.lineas : []).forEach((l0, i) => {
    const l = obj(l0);
    const ruta = `lineas[${i}]`;
    if (typeof l.nombre !== "string") problemas.push({ campo: `${ruta}.nombre`, mensaje: "no es texto" });
    if (!esNum(l.cantidad)) problemas.push({ campo: `${ruta}.cantidad`, mensaje: "no es un número" });
    for (const c of ["peso_kg", "precio_unitario", "total"]) {
      if (!esNumONull(l[c])) problemas.push({ campo: `${ruta}.${c}`, mensaje: "no es número ni null" });
    }
    for (const c of ["importe_literal", "albaran_ref"]) {
      if (l[c] !== undefined && !esStrONull(l[c])) problemas.push({ campo: `${ruta}.${c}`, mensaje: "no es texto ni null" });
    }
    const partida = l.partida === "continua_de_anterior" || l.partida === "continua_en_siguiente" ? l.partida : "no";
    const base = ["por_unidad", "por_kg", "por_litro", "desconocida"].includes(String(l.base_precio))
      ? l.base_precio as LineaExtraida["base_precio"]
      : "desconocida";
    lineas.push({
      nombre: typeof l.nombre === "string" ? l.nombre : "",
      cantidad: esNum(l.cantidad) ? l.cantidad : 0,
      unidad: typeof l.unidad === "string" ? l.unidad : "ud",
      peso_kg: numOrNull(l.peso_kg),
      base_precio: base,
      precio_unitario: numOrNull(l.precio_unitario),
      total: numOrNull(l.total),
      bonificada: l.bonificada === true,
      importe_literal: strOrNull(l.importe_literal),
      albaran_ref: strOrNull(l.albaran_ref),
      es_fila_arrastre: l.es_fila_arrastre === true,
      partida,
    });
  });
  if (problemas.length > 0) return { ok: false, problemas };

  const pie = obj(r.pie);
  const pv = obj(r.pagina_visible);
  const cab = obj(r.cabecera_visible);
  const fmt = obj(r.formato_numerico);
  const pf = obj(r.primera_fila);
  const uf = obj(r.ultima_fila);
  const alb = obj(r.albaran_abierto_al_final);
  const arr = (v: unknown): Arrastre => {
    const a = obj(v);
    return { presente: a.presente === true, literal: strOrNull(a.literal), importe: numOrNull(a.importe) };
  };
  const formato = ["es", "en", "mixto", "desconocido"].includes(String(fmt.formato))
    ? fmt.formato as FormatoNumerico
    : "desconocido";
  const tipo = cab.tipo === "factura" || cab.tipo === "albaran" ? cab.tipo : null;
  const filas = esNum(r.filas_tabla) ? Math.round(r.filas_tabla) : null;

  return {
    ok: true,
    datos: {
      pie: {
        total_literal: strOrNull(pie.total_literal),
        subtotal_literal: strOrNull(pie.subtotal_literal),
        iva_literal: strOrNull(pie.iva_literal),
        subtotal: numOrNull(pie.subtotal),
        iva: numOrNull(pie.iva),
        total: numOrNull(pie.total),
        tabla_totales_vacia: pie.tabla_totales_vacia === true,
      },
      pagina_visible: {
        literal: strOrNull(pv.literal),
        numero_impreso: esNum(pv.numero_impreso) ? Math.round(pv.numero_impreso) : null,
        total_impreso: esNum(pv.total_impreso) ? Math.round(pv.total_impreso) : null,
      },
      cabecera_visible: {
        titulo_literal: strOrNull(cab.titulo_literal),
        tipo,
        proveedor: strOrNull(cab.proveedor),
        cif: strOrNull(cab.cif),
        numero_documento: strOrNull(cab.numero_documento),
        numero_etiqueta_literal: strOrNull(cab.numero_etiqueta_literal),
        fecha: strOrNull(cab.fecha),
        fecha_literal: strOrNull(cab.fecha_literal),
      },
      sin_importes: r.sin_importes === true,
      formato_numerico: { formato, ejemplo_literal: strOrNull(fmt.ejemplo_literal) },
      columnas: Array.isArray(r.columnas)
        ? r.columnas.map((c) => obj(c)).filter((c) => typeof c.cabecera_literal === "string").map((c) => ({
          cabecera_literal: String(c.cabecera_literal),
          rol: String(c.rol ?? "otro"),
        }))
        : [],
      arrastre_entrada: arr(r.arrastre_entrada),
      primera_fila: {
        texto_literal: strOrNull(pf.texto_literal),
        partida_desde_pagina_anterior: pf.partida_desde_pagina_anterior === true,
      },
      filas_tabla: filas,
      lineas,
      ultima_fila: {
        texto_literal: strOrNull(uf.texto_literal),
        continua_en_pagina_siguiente: uf.continua_en_pagina_siguiente === true,
      },
      arrastre_salida: arr(r.arrastre_salida),
      albaran_abierto_al_final: { ref: strOrNull(alb.ref), fecha_literal: strOrNull(alb.fecha_literal) },
      continua_en_otra_pagina: r.continua_en_otra_pagina === true,
      observaciones: strOrNull(r.observaciones),
      resumen: strOrNull(r.resumen),
    },
  };
}

export function validarPaginaOLanzar(raw: unknown, contexto: string): ResultadoPagina {
  const v = validarPagina(raw);
  if (!v.ok) {
    throw new Error(
      `La pieza no cumple el contrato (${contexto}): ` +
        v.problemas.slice(0, 8).map((p) => `${p.campo}: ${p.mensaje}`).join("; "),
    );
  }
  return v.datos;
}

// ─── 4. Contexto de la pieza 1 ───────────────────────────────────────────────

export function construirContexto(r: ResultadoPagina, numPiezas: number): ContextoPagina {
  const ultima = [...r.lineas].reverse().find((l) => !l.es_fila_arrastre);
  return {
    proveedor: r.cabecera_visible.proveedor,
    numero_documento: r.cabecera_visible.numero_documento,
    tipo_titulo: r.cabecera_visible.titulo_literal,
    formato_numerico: r.formato_numerico.formato,
    ejemplo_numerico: r.formato_numerico.ejemplo_literal,
    columnas: r.columnas.slice(0, 16),
    albaran_abierto_al_final_p1: r.albaran_abierto_al_final.ref ? r.albaran_abierto_al_final : null,
    ultima_fila_p1: r.ultima_fila.texto_literal ?? ultima?.nombre ?? null,
    arrastre_salida_p1: r.arrastre_salida.presente ? r.arrastre_salida.importe : null,
    num_piezas: numPiezas,
  };
}

/** El contexto como texto para el mensaje de usuario (compacto, sin nulos). */
export function contextoComoTexto(c: ContextoPagina | null | undefined): string | null {
  if (!c) return null;
  const limpio = Object.fromEntries(
    Object.entries(c).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)),
  );
  return JSON.stringify(limpio);
}

// ─── 5. Motivos locales de relectura ─────────────────────────────────────────

export interface MotivoRelectura {
  codigo:
    | "lineas_incompletas_pagina"
    | "descuadre_linea"
    | "precio_unitario_extremo"
    | "importe_linea_discordante"
    | "formato_numerico_contradictorio"
    | "bloque_repetido";
  severidad: "alta" | "media";
  mensaje: string;
  detalle: Record<string, unknown>;
}

/** Líneas de producto (sin las filas de arrastre). */
export function lineasProducto(r: ResultadoPagina): LineaPagina[] {
  return r.lineas.filter((l) => !l.es_fila_arrastre);
}

/** La pieza como DocumentoExtraido de solo líneas: para reutilizar
 *  comprobarCuadre / compararExpansion / contarCambiosNumericos sin el pie. */
export function paginaComoDocumento(r: ResultadoPagina): DocumentoExtraido {
  return {
    tipo: r.cabecera_visible.tipo ?? "factura",
    proveedor: null,
    cif: null,
    numero_documento: r.cabecera_visible.numero_documento ?? "(pieza)",
    fecha: "2000-01-01",
    sin_importes: r.sin_importes,
    continua_en_otra_pagina: false,
    filas_tabla: null,
    productos: lineasProducto(r),
    subtotal: null,
    iva: null,
    total: null,
    observaciones: null,
    resumen: null,
  };
}

/** Filas que esta pieza tiene impresas según el extractor y el contador. */
export function filasVistas(r: ResultadoPagina, recuento: RecuentoFilas | null): number | null {
  const c = recuento && esNum(recuento.filas_tabla) ? Math.round(recuento.filas_tabla) : null;
  const p = r.filas_tabla;
  if (c === null && p === null) return null;
  return Math.max(c ?? 0, p ?? 0);
}

/**
 * Motivos LOCALIZADOS en esta pieza para pedir una relectura. Solo los que se
 * pueden achacar a ESTA imagen: un descuadre del documento entero no es
 * localizable y nunca pide relectura (04b §1.8 paso 6).
 */
export function motivosLocales(
  r: ResultadoPagina,
  recuento: RecuentoFilas | null,
  contexto: ContextoPagina | null,
): MotivoRelectura[] {
  const motivos: MotivoRelectura[] = [];
  const lineas = lineasProducto(r);

  const contadas = recuento && esNum(recuento.filas_tabla) ? Math.round(recuento.filas_tabla) : null;
  if (contadas !== null && contadas > lineas.length) {
    motivos.push({
      codigo: "lineas_incompletas_pagina",
      severidad: "alta",
      mensaje:
        `Un recuento independiente ve ${contadas} filas de producto en esta imagen y has extraído ` +
        `${lineas.length}. Faltan ${contadas - lineas.length}.`,
      detalle: {
        contadas,
        extraidas: lineas.length,
        primera_fila: recuento?.primera_fila ?? null,
        ultima_fila: recuento?.ultima_fila ?? null,
      },
    });
  }

  if (!r.sin_importes) {
    for (const d of comprobarCuadre(paginaComoDocumento(r))) {
      // Una línea que se factura por KILOS (columna de peso aparte) no cuadra
      // con cantidad × precio y está bien leída: peso × precio = importe (Luga:
      // NATOP 12 uds / 24 kg × 4,14 = 99,46). No es motivo de relectura.
      if (d.codigo === "descuadre_linea" && cuadraPorPeso(lineas[Number(d.detalle?.indice)])) continue;
      if (d.codigo === "descuadre_linea" || d.codigo === "precio_unitario_extremo") {
        motivos.push({ codigo: d.codigo, severidad: d.severidad, mensaje: d.mensaje, detalle: d.detalle });
      }
    }
    lineas.forEach((l, i) => {
      if (!l.importe_literal || !esNum(l.total)) return;
      // Se acepta cualquiera de las lecturas posibles del literal (es, en, o la
      // heurística del separador más a la derecha): el formato que declara el
      // modelo no es fiable (Luga: dice 'es' con importes '1,547.26').
      const lecturas = (["es", "en", "desconocido"] as FormatoNumerico[])
        .map((f) => leerImporteConFormato(l.importe_literal!, f))
        .filter((x): x is number => x !== null);
      if (lecturas.length === 0) return;
      if (!lecturas.some((x) => Math.abs(x - (l.total as number)) <= 0.011)) {
        const leido = leerImporteConFormato(l.importe_literal, r.formato_numerico.formato) ?? lecturas[0];
        motivos.push({
          codigo: "importe_linea_discordante",
          severidad: "media",
          mensaje:
            `La fila ${i + 1} («${l.nombre}») cita el importe "${l.importe_literal}" (= ${leido}) pero devuelve ` +
            `total = ${l.total}.`,
          detalle: { indice: i, nombre: l.nombre, literal: l.importe_literal, leido, total: l.total },
        });
      }
    });
  }

  const rep = bloqueRepetido(lineas);
  if (rep) {
    motivos.push({
      codigo: "bloque_repetido",
      severidad: "alta",
      mensaje:
        `Las filas ${rep.desde + 1}-${rep.desde + rep.largo} repiten EXACTAMENTE (mismo producto, cantidad e importe, ` +
        `en el mismo orden) las filas ${rep.original + 1}-${rep.original + rep.largo}. Eso casi nunca está así en el ` +
        `papel: comprueba si las has escrito dos veces.`,
      detalle: rep as unknown as Record<string, unknown>,
    });
  }

  const a = contexto?.formato_numerico;
  const b = r.formato_numerico.formato;
  if ((a === "es" && b === "en") || (a === "en" && b === "es")) {
    motivos.push({
      codigo: "formato_numerico_contradictorio",
      severidad: "media",
      mensaje:
        `La primera pieza usa formato numérico '${a}' (${contexto?.ejemplo_numerico ?? "?"}) y en esta has leído ` +
        `'${b}' (${r.formato_numerico.ejemplo_literal ?? "?"}).`,
      detalle: { contexto: a, pieza: b },
    });
  }
  return motivos;
}

export function cuadraPorPeso(l: LineaExtraida | undefined): boolean {
  if (!l || !esNum(l.peso_kg) || !esNum(l.precio_unitario) || !esNum(l.total)) return false;
  const esperado = l.peso_kg * l.precio_unitario;
  if (esperado <= 0) return false;
  const ratio = l.total / esperado;
  return ratio >= 0.98 && ratio <= 1.02;
}

/** Lee un literal de importe respetando el formato declarado de la pieza:
 *  "1,547" en formato 'en' son mil quinientos; en 'es', uno con cincuenta. */
export function leerImporteConFormato(literal: string, formato: FormatoNumerico): number | null {
  const limpio = literal.replace(/[^\d.,\-]/g, "");
  if (!/\d/.test(limpio)) return null;
  if (formato === "en") {
    const n = Number(limpio.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (formato === "es") {
    const n = Number(limpio.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return leerImporteLiteral(literal);
}

const claveFila = (l: LineaPagina) =>
  `${l.nombre.toUpperCase().replace(/[^A-Z0-9]/g, "")}|${l.cantidad}|${esNum(l.total) ? l.total.toFixed(2) : "-"}`;

/**
 * Un bloque de 4+ filas consecutivas idéntico (nombre, cantidad e importe) a
 * otro bloque anterior de la MISMA imagen: síntoma de que el modelo ha
 * entrado en bucle y ha escrito filas dos veces (visto con gpt-5.4-mini en la
 * franja 2 de Luga). En el papel real, dos entregas del mismo producto
 * cambian casi siempre en cantidad o importe.
 */
export function bloqueRepetido(
  lineas: LineaPagina[],
  minimo = 4,
): { desde: number; original: number; largo: number } | null {
  const k = lineas.map(claveFila);
  for (let i = minimo; i < k.length; i++) {
    for (let j = 0; j + minimo <= i; j++) {
      let n = 0;
      while (i + n < k.length && j + n < i && k[i + n] === k[j + n]) n++;
      if (n >= minimo) return { desde: i, original: j, largo: n };
    }
  }
  return null;
}

export function pesoMotivos(m: MotivoRelectura[]): number {
  return m.reduce((acc, x) => acc + (x.severidad === "alta" ? 10 : 1), 0);
}

/** Mensaje correctivo para la relectura de UNA pieza: dice QUÉ falla y DÓNDE,
 *  y repite que lo impreso manda (no se pide que cuadre). */
export function mensajeCorrectivoPagina(motivos: MotivoRelectura[]): string {
  const lista = motivos.slice(0, 12).map((m, i) => `${i + 1}. ${m.mensaje}`).join("\n");
  return (
    "Vuelve a mirar ESTA imagen. Una comprobación automática ha encontrado esto:\n" +
    lista +
    "\n\nRecorre la tabla fila por fila, de arriba abajo, sin mirar lo que ya escribiste. Si faltan filas, " +
    "añádelas en su sitio (las repetidas también cuentan). Si un importe estaba mal leído, corrígelo mirando " +
    "los píxeles. Pero si el papel dice lo que dice, DEVUELVE LO IMPRESO: no cambies ningún número para que " +
    "una suma salga. Devuelve la pieza completa otra vez, con el mismo esquema."
  );
}
