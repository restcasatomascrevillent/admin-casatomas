// ============================================================================
//  importar-factura-historica · mapeo.ts (puro: sin Deno ni red)
// ----------------------------------------------------------------------------
//  Convierte una factura ya extraída a JSON (formato de
//  facturas-conocimiento/INSTRUCCIONES-EXTRACCION.md) en:
//    · el «crudo» que espera normalizarDatos (procesar-factura/extraccion.ts),
//      igual que lo que devuelve el modelo de visión, para reutilizar la misma
//      normalización, duplicados, alertas, embeddings y archivo en Drive;
//    · lo que normalizarDatos no conserva y se vuelve a pegar a cada línea por
//      su `orden`: bultos, descuento_pct e importe_bruto (valor sin descuento,
//      petición del dueño del 04/11/2026: saber lo que VALE lo recibido aunque
//      venga con 100 % de descuento o regalado);
//    · las observaciones y avisos de la importación.
//
//  Decisiones:
//    · `abono` no existe en facturas.tipo (CHECK factura|albaran): entra como
//      `factura` con TODOS los importes en negativo (cabecera, líneas y cargos
//      de pie) y la cantidad de las líneas también en negativo (devolución),
//      que es como el OCR guarda una línea de abono («-1,000 → -1»). El precio
//      unitario queda positivo.
//    · `cargos_pie` (portes, embalajes, punto verde…) entran como líneas, para
//      que las líneas sumen la base imponible.
//    · El total es el IMPRESO: total_origen = 'leido'.
// ============================================================================

export type Local = "casa_tomas" | "touza";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface ExtrasLinea {
  bultos: number | null;
  descuento_pct: number | null;
  importe_bruto: number | null;
  importe_bruto_estimado: boolean;
}

export interface Preparada {
  /** Entrada de normalizarDatos. */
  crudo: Record<string, unknown>;
  /** Por `orden` de la línea en el crudo. */
  extras: Map<number, ExtrasLinea>;
  local: Local | null;
  /** Observaciones finales de la factura (sustituyen a las normalizadas). */
  observaciones: string;
  /** Avisos de la extracción del histórico como alerta de la factura. */
  alertas: Record<string, unknown>[];
  /** Páginas de esta factura (facturas.paginas, 1..20). */
  paginas: number;
  esAbono: boolean;
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Número de un campo del JSON: number tal cual; texto «1.234,56» o «12.5» también. */
export function numero(v: unknown): number | null {
  if (esNum(v)) return v;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim().replace(/\s|€/g, "");
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const negativo = (n: number | null) => (n === null ? null : -Math.abs(n));

export function localValido(v: unknown): Local | null {
  return v === "casa_tomas" || v === "touza" ? v : null;
}

/** Texto de un aviso del JSON (string, o un objeto con mensaje). */
function textoAviso(a: unknown): string | null {
  if (typeof a === "string") return a.trim() || null;
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    const m = o.mensaje ?? o.texto ?? o.detalle;
    if (typeof m === "string" && m.trim()) return m.trim();
    return JSON.stringify(a);
  }
  return null;
}

/**
 * Valor sin descuento de una línea: cantidad × precio cuando hay precio
 * (aunque el total sea 0); si no lo hay pero viene `precio_referencia` (lo que
 * ese proveedor cobró por el artículo en otras facturas), cantidad × precio de
 * referencia, marcado como estimado.
 */
export function valorBruto(
  cantidad: number,
  precio: number | null,
  precioReferencia: number | null,
): { importe_bruto: number | null; importe_bruto_estimado: boolean } {
  if (precio !== null && precio !== 0) return { importe_bruto: r2(cantidad * precio), importe_bruto_estimado: false };
  if (precioReferencia !== null && precioReferencia > 0) {
    return { importe_bruto: r2(cantidad * precioReferencia), importe_bruto_estimado: true };
  }
  return { importe_bruto: null, importe_bruto_estimado: false };
}

/** Página de la línea DENTRO del PDF de esta factura (paginas_pdf: páginas del PDF original). */
function paginaEnFactura(p: unknown, paginasPdf: number[], total: number): number {
  const n = Number.isInteger(p) ? (p as number) : null;
  if (n === null) return 1;
  const i = paginasPdf.indexOf(n);
  if (i >= 0) return i + 1;
  return n >= 1 && n <= total ? n : 1;
}

export function prepararImportacion(datos: Json, opciones: { nombrePdf?: string; local?: unknown; paginas?: number } = {}): Preparada {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    throw new Error("`datos` tiene que ser UNA factura (un objeto), no una lista");
  }
  const esAbono = String(datos.tipo ?? "").toLowerCase().trim() === "abono";
  const tipo = String(datos.tipo ?? "").toLowerCase().includes("albar") ? "albaran" : "factura";
  const signo = (n: number | null) => (esAbono ? negativo(n) : n);

  const paginasPdf: number[] = Array.isArray(datos.paginas_pdf)
    ? datos.paginas_pdf.filter((x: unknown) => Number.isInteger(x))
    : [];
  const paginas = Math.min(20, Math.max(1, opciones.paginas ?? (paginasPdf.length || 1)));

  const extras = new Map<number, ExtrasLinea>();
  const productos: Record<string, unknown>[] = [];
  const lineas: Json[] = Array.isArray(datos.productos) ? datos.productos : [];
  for (const p of lineas) {
    if (!p || typeof p !== "object") continue;
    const orden = productos.length;
    const precioLeido = numero(p.precio_unitario);
    const precio = precioLeido === null ? null : Math.abs(precioLeido);
    let total = numero(p.total);
    let cantidad = numero(p.cantidad);
    if (esAbono) {
      total = negativo(total);
      cantidad = negativo(cantidad);
    } else if (total !== null && total < 0 && cantidad !== null && cantidad > 0) {
      // Devolución dentro de una factura: la cantidad también en negativo.
      cantidad = -cantidad;
    }
    const cantidadValor = cantidad ?? (esAbono ? -1 : 1);
    const bruto = valorBruto(cantidadValor, precio, numero(p.precio_referencia));
    const bultos = numero(p.bultos);
    const descuento = numero(p.descuento_pct);
    extras.set(orden, {
      bultos: bultos !== null && bultos !== 0 ? Math.abs(bultos) : null,
      descuento_pct: descuento,
      ...bruto,
    });
    productos.push({
      nombre: typeof p.nombre === "string" ? p.nombre : "",
      cantidad,
      unidad: typeof p.unidad === "string" ? p.unidad : null,
      precio_unitario: precio,
      total,
      iva_pct: numero(p.iva_pct),
      bonificada: p.bonificada === true,
      albaran_ref: typeof p.albaran_ref === "string" ? p.albaran_ref : null,
      pagina: paginaEnFactura(p.pagina, paginasPdf, paginas),
      orden,
    });
  }

  // Cargos de pie como líneas (para que las líneas sumen la base).
  const cargos: Json[] = Array.isArray(datos.cargos_pie) ? datos.cargos_pie : [];
  for (const c of cargos) {
    const importe = signo(numero(c?.importe));
    if (importe === null || importe === 0) continue;
    const orden = productos.length;
    extras.set(orden, { bultos: null, descuento_pct: null, importe_bruto: null, importe_bruto_estimado: false });
    productos.push({
      nombre: (typeof c.concepto === "string" && c.concepto.trim()) || "Cargo de pie",
      cantidad: importe < 0 ? -1 : 1,
      unidad: "ud",
      precio_unitario: Math.abs(importe),
      total: importe,
      iva_pct: numero(c.iva_pct),
      bonificada: false,
      albaran_ref: null,
      pagina: paginas,
      orden,
    });
  }

  const archivo = (typeof datos.archivo === "string" && datos.archivo.trim()) || opciones.nombrePdf || "sin nombre";
  const recargo = numero(datos.recargo_equivalencia);
  const retencion = numero(datos.retencion_irpf);
  const avisos = (Array.isArray(datos.alertas) ? datos.alertas : []).map(textoAviso).filter((x: string | null): x is string => !!x);
  const partes = [
    typeof datos.observaciones === "string" ? datos.observaciones : null,
    esAbono ? "Abono (factura rectificativa): importes guardados en negativo" : null,
    recargo ? `Recargo de equivalencia impreso: ${recargo} €` : null,
    retencion ? `Retención IRPF impresa: ${retencion} €` : null,
    `Importada del histórico (archivo ${archivo})`,
    ...avisos.map((a: string) => `Aviso de la extracción: ${a}`),
  ]
    .filter((x): x is string => typeof x === "string" && !!x.trim())
    .map((x) => x.trim().replace(/[.\s]+$/, ""));
  const observaciones = partes.join(". ") + ".";

  const alertas = avisos.length > 0
    ? [{
      codigo: "extraccion_historica",
      severidad: "media",
      mensaje: `La extracción del histórico dejó ${avisos.length} aviso(s): ${avisos.slice(0, 3).join(" · ")}` +
        (avisos.length > 3 ? " …" : ""),
      detalle: { avisos: avisos.slice(0, 20), archivo },
    }]
    : [];

  const crudo = {
    tipo,
    proveedor: typeof datos.proveedor === "string" ? datos.proveedor : null,
    cif: typeof datos.cif === "string" ? datos.cif : null,
    numero_documento: typeof datos.numero_documento === "string"
      ? datos.numero_documento
      : esNum(datos.numero_documento)
      ? String(datos.numero_documento)
      : null,
    fecha: typeof datos.fecha === "string" ? datos.fecha : null,
    subtotal: signo(numero(datos.subtotal)),
    iva: signo(numero(datos.iva)),
    total: signo(numero(datos.total)),
    observaciones: null,
    resumen: null,
    productos,
  };

  return {
    crudo,
    extras,
    local: localValido(opciones.local) ?? localValido(datos.local),
    observaciones,
    alertas,
    paginas,
    esAbono,
  };
}

/**
 * Vuelve a pegar a las líneas normalizadas lo que normalizarDatos no conserva,
 * por `orden` (normalizarDatos puede quitar filas, p. ej. rótulos sin cantidad).
 */
export function aplicarExtras<T extends { orden?: number | null; bultos?: number | null }>(
  productos: T[],
  extras: Map<number, ExtrasLinea>,
): (T & Partial<ExtrasLinea>)[] {
  return productos.map((p) => {
    const e = p.orden === null || p.orden === undefined ? undefined : extras.get(p.orden);
    if (!e) return p;
    return {
      ...p,
      bultos: p.bultos ?? e.bultos,
      ...(e.descuento_pct !== null ? { descuento_pct: e.descuento_pct } : {}),
      ...(e.importe_bruto !== null
        ? { importe_bruto: e.importe_bruto, importe_bruto_estimado: e.importe_bruto_estimado }
        : {}),
    };
  });
}

/** CIF para comparar: mayúsculas, solo letras y números. */
const cifNorm = (c: unknown) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const nombreNorm = (n: unknown) =>
  String(n ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");

/**
 * Duplicado por importe: misma fecha, mismo proveedor (CIF; si no hay, nombre)
 * y mismo total (±1 céntimo). Devuelve la candidata que coincide o null.
 */
export function mismaFacturaPorImporte<F extends { cif?: string | null; proveedor?: string | null; total?: number | string | null; fecha?: string | null }>(
  nueva: { cif: string | null; proveedor: string | null; total: number | null; fecha: string },
  candidatas: F[],
): F | null {
  if (nueva.total === null) return null;
  const cif = cifNorm(nueva.cif);
  const nombre = nombreNorm(nueva.proveedor);
  for (const f of candidatas) {
    if (f.fecha !== nueva.fecha) continue;
    if (f.total === null || f.total === undefined || Math.abs(Number(f.total) - nueva.total) > 0.01) continue;
    const mismoProveedor = cif ? cifNorm(f.cif) === cif : !!nombre && nombreNorm(f.proveedor) === nombre;
    if (mismoProveedor) return f;
  }
  return null;
}

/** Validación de la petición. */
export function validarEntrada(b: Json):
  | { ok: true; clave: string; datos: Json; pdfB64: string; nombrePdf: string; local: unknown; paginas?: number }
  | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "Cuerpo vacío" };
  const clave = typeof b.clave === "string" ? b.clave.trim() : "";
  if (!clave || clave.length > 200) return { ok: false, error: "Falta `clave` (o pasa de 200 caracteres)" };
  if (!b.datos || typeof b.datos !== "object" || Array.isArray(b.datos)) {
    return { ok: false, error: "`datos` tiene que ser una factura (objeto JSON)" };
  }
  const bruto = typeof b.pdf_b64 === "string" ? b.pdf_b64 : "";
  const pdfB64 = bruto.includes(",") && bruto.startsWith("data:") ? bruto.slice(bruto.indexOf(",") + 1) : bruto;
  if (!pdfB64) return { ok: false, error: "Falta el PDF (`pdf_b64`)" };
  if (pdfB64.length > 28_000_000) return { ok: false, error: "El PDF pasa de 20 MB" };
  const nombre = typeof b.nombre_pdf === "string" && b.nombre_pdf.trim() ? b.nombre_pdf.trim().slice(0, 200) : "factura.pdf";
  const paginas = Number.isInteger(b.paginas) && b.paginas > 0 ? (b.paginas as number) : undefined;
  return { ok: true, clave, datos: b.datos, pdfB64, nombrePdf: nombre, local: b.local, paginas };
}
