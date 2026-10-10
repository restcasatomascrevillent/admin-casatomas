// ============================================================================
//  paginasDocumento.ts · Páginas sueltas de un mismo documento y duplicados
// ----------------------------------------------------------------------------
//  Revisión del 10/10/2026 (factura 352): cada foto era un documento; la
//  página 2/2 de un albarán llegó como «duplicado sustituible» de la página
//  1/2 y «Sustituir» borró la página 1. Aquí se decide, SIN base de datos, qué
//  se ofrece cuando un documento coincide con otro que ya existe:
//
//   · «pagina»     → es OTRA página del mismo documento (la lectura trae
//                    «página x/y» y sus líneas no son las de la existente):
//                    se ofrece «Añadir como página x a la factura N», que
//                    AÑADE líneas sin borrar nada. NUNCA «Sustituir».
//   · «duplicado»  → el mismo documento otra vez. «Sustituir» solo si es
//                    seguro: la existente ha terminado de guardarse (su
//                    trabajo no sigue en marcha), tiene líneas y no es un
//                    documento de varias páginas que el nuevo (una página)
//                    dejaría a medias.
//
//  El campo `pagina` {actual,total} de la lectura lo añade el esquema de
//  extracción (otro agente); aquí se consume de forma OPCIONAL: si no viene,
//  se busca «Página 2/2», «Hoja 1 de 2»… en las observaciones; si tampoco,
//  no hay página y todo sigue como antes.
// ============================================================================

export interface PaginaDocumento {
  actual: number;
  total: number;
}

/** Lo que hace falta saber de la factura existente (ocr_factura_existente). */
export interface ExistenteParaDecidir {
  id: number;
  lineas: number;
  paginas?: number | null;
  /** Páginas distintas de sus líneas (productos_factura.pagina). */
  paginas_lineas?: number[] | null;
  /** Importes de sus líneas (para saber si la página nueva ya está dentro). */
  totales_lineas?: (number | null)[] | null;
  /** Su trabajo de OCR aún no ha terminado (cabecera insertada, líneas en camino). */
  trabajo_pendiente?: boolean | null;
  created_at?: string | null;
}

export type Decision =
  | { tipo: "pagina"; pagina: PaginaDocumento }
  | { tipo: "duplicado"; sustituible: boolean; motivo: string | null };

/** Días hacia atrás en los que una coincidencia con «página x/y» se toma por otra página. */
export const DIAS_PAGINAS = 30;

const entero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** {actual,total} válido (1 ≤ actual ≤ total ≤ 20, total ≥ 2) o null. */
export function paginaValida(v: unknown): PaginaDocumento | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const actual = entero(o.actual ?? o.pagina ?? o.numero);
  const total = entero(o.total ?? o.de ?? o.paginas);
  if (actual === null || total === null) return null;
  if (total < 2 || total > 20 || actual < 1 || actual > total) return null;
  return { actual, total };
}

const RE_PAGINA = /\b(?:p[áa]g(?:ina)?|hoja|p\.)\s*(?:n[ºo°.]?\s*)?(\d{1,2})\s*(?:\/|de|of)\s*(\d{1,2})\b/i;

/** «Página Nº 2/2», «Hoja 1 de 2», «pág. 2/3» dentro de un texto. */
export function paginaDeTexto(texto: unknown): PaginaDocumento | null {
  if (typeof texto !== "string" || !texto) return null;
  const m = texto.match(RE_PAGINA);
  return m ? paginaValida({ actual: Number(m[1]), total: Number(m[2]) }) : null;
}

/** Página de la lectura: el campo `pagina` si existe; si no, las observaciones. */
export function leerPagina(d: { pagina?: unknown; observaciones?: unknown } | null | undefined): PaginaDocumento | null {
  if (!d) return null;
  return paginaValida(d.pagina) ?? paginaDeTexto(d.observaciones);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ¿Las líneas nuevas ya están en la existente? (Misma página subida dos
 * veces.) Al menos el 60 % de los importes de línea nuevos aparecen entre los
 * de la existente, contando repeticiones.
 */
export function lineasYaIncluidas(nuevos: (number | null | undefined)[], existentes: (number | null | undefined)[]): boolean {
  const n = nuevos.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x !== 0).map(r2);
  if (n.length === 0) return false;
  const bolsa = new Map<number, number>();
  for (const x of existentes) {
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    const k = r2(x);
    bolsa.set(k, (bolsa.get(k) ?? 0) + 1);
  }
  let comunes = 0;
  for (const x of n) {
    const q = bolsa.get(x) ?? 0;
    if (q > 0) {
      comunes += 1;
      bolsa.set(x, q - 1);
    }
  }
  return comunes / n.length >= 0.6;
}

function esReciente(creada: string | null | undefined, ahora: number): boolean {
  if (!creada) return true; // sin fecha (RPC antigua): se da por reciente
  const t = Date.parse(creada);
  return !Number.isFinite(t) || ahora - t <= DIAS_PAGINAS * 24 * 3600 * 1000;
}

/**
 * Qué se ofrece para un documento que coincide con uno existente.
 * `nuevo`: lo leído (pagina/observaciones y los importes de sus líneas) y las
 * páginas del documento nuevo (1 = una foto).
 */
export function decidirCoincidencia(
  nuevo: { pagina?: unknown; observaciones?: unknown; productos: { total: number | null }[]; paginas?: number },
  existente: ExistenteParaDecidir,
  ahora: number = Date.now(),
): Decision {
  const pag = leerPagina(nuevo);
  const totalesExistentes = existente.totales_lineas ?? [];
  if (pag && (nuevo.paginas ?? 1) <= 1 && esReciente(existente.created_at, ahora)) {
    const mismas = lineasYaIncluidas(nuevo.productos.map((p) => p.total), totalesExistentes);
    // Una página que ya está dentro (mismas líneas): es la misma foto otra vez.
    if (!mismas) return { tipo: "pagina", pagina: pag };
  }

  if (existente.trabajo_pendiente) {
    return { tipo: "duplicado", sustituible: false, motivo: "la factura que ya existe aún se está guardando" };
  }
  if (!(existente.lineas > 0)) {
    return { tipo: "duplicado", sustituible: false, motivo: "la factura que ya existe no tiene líneas todavía" };
  }
  const paginasExistente = Math.max(existente.paginas ?? 1, new Set(existente.paginas_lineas ?? []).size);
  if (paginasExistente > 1 && (nuevo.paginas ?? 1) < paginasExistente) {
    return {
      tipo: "duplicado",
      sustituible: false,
      motivo: "la que ya existe tiene varias páginas y esto es solo una: sustituirla borraría las demás",
    };
  }
  return { tipo: "duplicado", sustituible: true, motivo: null };
}
