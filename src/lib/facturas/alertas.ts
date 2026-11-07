// Alertas de Facturas (migración 20261107300000_facturas_alertas): las genera
// cada día `facturas_generar_alertas()` en `notificaciones_dashboard` y el panel
// las lee con `facturas_alertas_activas()`. Aquí: tipos, normalización y cómo
// se reparten por las gráficas (meses, familias, proveedores, productos).

export type TipoAlertaFacturas =
  | "facturas_precio_sube"
  | "facturas_precio_mejor"
  | "facturas_familia_gasto"
  | "facturas_albaran_sin_factura"
  | "facturas_proveedor_nuevo"
  | "facturas_importe_inusual"
  | "facturas_revision";

export const TIPOS_ALERTA_FACTURAS: { tipo: TipoAlertaFacturas; etiqueta: string }[] = [
  { tipo: "facturas_precio_sube", etiqueta: "Suben de precio" },
  { tipo: "facturas_precio_mejor", etiqueta: "Más barato en otro proveedor" },
  { tipo: "facturas_familia_gasto", etiqueta: "Gasto alto de una familia" },
  { tipo: "facturas_albaran_sin_factura", etiqueta: "Albaranes sin factura" },
  { tipo: "facturas_proveedor_nuevo", etiqueta: "Proveedores nuevos" },
  { tipo: "facturas_importe_inusual", etiqueta: "Importes inusuales" },
  { tipo: "facturas_revision", etiqueta: "Por revisar" },
];

export const esTipoAlertaFacturas = (t: string): t is TipoAlertaFacturas => TIPOS_ALERTA_FACTURAS.some((x) => x.tipo === t);

export interface DatosAlerta {
  enlace: string | null;
  facturaId: number | null;
  mes: string | null;
  desde: string | null;
  hasta: string | null;
  local: "casa_tomas" | "touza" | null;
  proveedorId: number | null;
  proveedor: string | null;
  familiaId: number | null;
  familia: string | null;
  productoId: number | null;
  /** Texto de la línea (lo que filtra el explorador) o nombre del catálogo. */
  producto: string | null;
  nombreNormalizado: string | null;
  /** Unidad facturada de la línea («kg», «ud», «caja»…). */
  unidad: string | null;
  /** Medida del precio comparado («kg», «l» o la unidad). */
  medida: string | null;
  precio: number | null;
  precioRef: number | null;
  /** Precio y referencia en la unidad facturada (lo que dibuja el explorador). */
  precioUd: number | null;
  precioRefUd: number | null;
  variacionPct: number | null;
  umbralPct: number | null;
}

export interface AlertaFacturas {
  id: string;
  tipo: TipoAlertaFacturas;
  prioridad: "alta" | "normal";
  titulo: string;
  mensaje: string;
  leida: boolean;
  creada: string | null;
  datos: DatosAlerta;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** La respuesta de la RPC, validada (lo que no se entiende se descarta). */
export function normalizarAlertas(data: unknown): AlertaFacturas[] {
  if (!Array.isArray(data)) return [];
  const out: AlertaFacturas[] = [];
  for (const fila of data) {
    if (!fila || typeof fila !== "object") continue;
    const f = fila as Record<string, unknown>;
    const tipo = txt(f.tipo);
    const id = txt(f.id);
    const titulo = txt(f.titulo);
    if (!tipo || !id || !titulo || !esTipoAlertaFacturas(tipo)) continue;
    const d = (f.datos && typeof f.datos === "object" ? f.datos : {}) as Record<string, unknown>;
    const local = d.local === "touza" || d.local === "casa_tomas" ? d.local : null;
    out.push({
      id,
      tipo,
      prioridad: f.prioridad === "alta" ? "alta" : "normal",
      titulo,
      mensaje: txt(f.mensaje) ?? "",
      leida: f.leida === true,
      creada: txt(f.creada),
      datos: {
        enlace: txt(d.enlace),
        facturaId: num(d.factura_id),
        mes: txt(d.mes),
        desde: txt(d.desde),
        hasta: txt(d.hasta),
        local,
        proveedorId: num(d.proveedor_id),
        proveedor: txt(d.proveedor),
        familiaId: num(d.familia_id),
        familia: txt(d.familia),
        productoId: num(d.producto_id),
        producto: txt(d.producto),
        nombreNormalizado: txt(d.nombre_normalizado),
        unidad: txt(d.unidad),
        medida: txt(d.medida),
        precio: num(d.precio),
        precioRef: num(d.precio_ref),
        precioUd: num(d.precio_ud),
        precioRefUd: num(d.precio_ref_ud),
        variacionPct: num(d.variacion_pct),
        umbralPct: num(d.umbral_pct),
      },
    });
  }
  return out;
}

/** Alta primero; dentro, sin revisar primero (la RPC ya las da así; aquí por si se mezclan). */
export function ordenarAlertas(a: AlertaFacturas[]): AlertaFacturas[] {
  return [...a].sort((x, y) => Number(y.prioridad === "alta") - Number(x.prioridad === "alta") || Number(x.leida) - Number(y.leida));
}

export const etiquetaTipoAlerta = (t: string): string => TIPOS_ALERTA_FACTURAS.find((x) => x.tipo === t)?.etiqueta ?? t;

/** Ruta del panel de una alerta (la campana navega con ella): «/facturas?tab=…». */
export function rutaAlerta(datos: { enlace?: unknown } | null | undefined): string | null {
  const e = datos && typeof datos.enlace === "string" ? datos.enlace : null;
  if (!e || !e.startsWith("?")) return null;
  return `/facturas${e}`;
}

/** Normaliza un texto de producto como lo compara el explorador (sin tildes, minúsculas, espacios simples). */
export const claveProducto = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type EjeAlertas = "mes" | "proveedor" | "familia" | "producto";

/**
 * Las alertas de cada punto de una gráfica, por la CLAVE del punto (la misma
 * que da `explorar_compras`: «AAAA-MM», id de proveedor, id de familia o
 * nombre normalizado del producto). Las de revisión (resumen) no van a ningún
 * punto: se ven en «Requiere atención».
 */
export function alertasPorClave(alertas: AlertaFacturas[], eje: EjeAlertas): Map<string, AlertaFacturas[]> {
  const m = new Map<string, AlertaFacturas[]>();
  const poner = (k: string | null | undefined, a: AlertaFacturas) => {
    if (!k) return;
    const l = m.get(k);
    if (l) l.push(a);
    else m.set(k, [a]);
  };
  for (const a of alertas) {
    if (a.tipo === "facturas_revision") continue;
    const d = a.datos;
    if (eje === "mes") {
      // Proveedores nuevos y albaranes sin factura no son «del mes»: van a su proveedor.
      if (a.tipo === "facturas_proveedor_nuevo" || a.tipo === "facturas_albaran_sin_factura") continue;
      poner(d.mes, a);
    } else if (eje === "proveedor") {
      if (a.tipo === "facturas_familia_gasto") continue;
      poner(d.proveedorId !== null ? String(d.proveedorId) : null, a);
    } else if (eje === "familia") {
      if (a.tipo !== "facturas_familia_gasto" && a.tipo !== "facturas_precio_sube") continue;
      poner(d.familiaId !== null ? String(d.familiaId) : null, a);
    } else {
      if (a.tipo !== "facturas_precio_sube") continue;
      poner(d.nombreNormalizado ?? (d.producto ? claveProducto(d.producto) : null), a);
    }
  }
  return m;
}

/** Filtra las alertas que tocan un periodo (`desde`…`hasta` de la alerta frente al elegido) y local. */
export function alertasDelPeriodo(
  alertas: AlertaFacturas[],
  periodo: { desde: string | null; hasta: string | null },
  local: "casa_tomas" | "touza" | null,
): AlertaFacturas[] {
  return alertas.filter((a) => {
    const d = a.datos;
    if (local && d.local && d.local !== local) return false;
    if (periodo.desde && d.hasta && d.hasta < periodo.desde) return false;
    if (periodo.hasta && d.desde && d.desde > periodo.hasta) return false;
    return true;
  });
}

/**
 * Para «Precio de un producto»: las subidas de ESE producto (texto de línea
 * normalizado) y la unidad del explorador. Devuelve la referencia (si todas
 * las subidas son del mismo proveedor, su mediana; con varias, la de la más
 * reciente) y los meses marcados.
 */
export function alertasDePrecio(
  alertas: AlertaFacturas[],
  producto: string | null | undefined,
  unidad: string | null | undefined,
): { referencia: number | null; etiquetaReferencia: string | null; meses: Map<string, AlertaFacturas[]>; alertas: AlertaFacturas[] } {
  const vacio = { referencia: null, etiquetaReferencia: null, meses: new Map<string, AlertaFacturas[]>(), alertas: [] };
  if (!producto) return vacio;
  const k = claveProducto(producto);
  const u = unidad ? unidad.toLowerCase() : null;
  const mias = alertas.filter(
    (a) =>
      a.tipo === "facturas_precio_sube" &&
      (claveProducto(a.datos.nombreNormalizado ?? "") === k || claveProducto(a.datos.producto ?? "") === k) &&
      (!u || !a.datos.unidad || a.datos.unidad.toLowerCase() === u),
  );
  if (mias.length === 0) return vacio;
  const meses = new Map<string, AlertaFacturas[]>();
  for (const a of mias) {
    if (!a.datos.mes) continue;
    const l = meses.get(a.datos.mes);
    if (l) l.push(a);
    else meses.set(a.datos.mes, [a]);
  }
  const ultima = [...mias].sort((x, y) => (y.datos.desde ?? "").localeCompare(x.datos.desde ?? ""))[0];
  const ref = ultima.datos.precioRefUd ?? ultima.datos.precioRef;
  const nombreProv = ultima.datos.proveedor ? ` (${ultima.datos.proveedor})` : "";
  return { referencia: ref, etiquetaReferencia: ref !== null ? `Precio de referencia${nombreProv}` : null, meses, alertas: mias };
}

/** ¿Una subida de «Lo que más ha subido» pasa el umbral de alerta? (por defecto el 10 % de la configuración). */
export function superaUmbral(variacionPct: number | null | undefined, umbralPct: number | null | undefined): boolean {
  if (variacionPct === null || variacionPct === undefined) return false;
  return variacionPct > (umbralPct ?? 10);
}

/** Lo que una gráfica del explorador necesita saber de su consulta para marcar sus alertas. */
export interface ConsultaMarcas {
  medida: string;
  agrupar: string;
  filtros: { proveedores: { id: number }[]; familias: { id: number }[]; productos: string[]; unidad: string | null };
  periodo: { desde: string | null; hasta: string | null };
  local: "casa_tomas" | "touza" | null;
}

/**
 * Marcas de una gráfica del explorador: alertas por clave de punto y, en el
 * precio de UN producto, la línea del precio de referencia. Con filtros de
 * proveedor o familia, solo las alertas de esos proveedores o familias.
 */
export function marcasDeExploracion(
  alertas: AlertaFacturas[],
  c: ConsultaMarcas,
): { porClave: Map<string, AlertaFacturas[]>; referencia: { valor: number; etiqueta: string } | null } {
  const vacio = { porClave: new Map<string, AlertaFacturas[]>(), referencia: null };
  if (alertas.length === 0) return vacio;
  let lista = alertasDelPeriodo(alertas, c.periodo, c.local);
  if (c.medida === "precio" && c.filtros.productos.length === 1) {
    const p = alertasDePrecio(lista, c.filtros.productos[0], c.filtros.unidad);
    return {
      porClave: c.agrupar === "mes" ? p.meses : new Map(),
      referencia: p.referencia !== null && p.etiquetaReferencia ? { valor: p.referencia, etiqueta: p.etiquetaReferencia } : null,
    };
  }
  // Una gráfica de precio solo marca subidas de precio; las de gasto, todo; las demás, nada.
  if (c.medida === "precio") lista = lista.filter((a) => a.tipo === "facturas_precio_sube");
  else if (!["gasto", "base", "documentos"].includes(c.medida)) return vacio;
  const prov = new Set(c.filtros.proveedores.map((p) => p.id));
  const fam = new Set(c.filtros.familias.map((f) => f.id));
  if (prov.size) lista = lista.filter((a) => a.datos.proveedorId !== null && prov.has(a.datos.proveedorId));
  if (fam.size) lista = lista.filter((a) => a.datos.familiaId !== null && fam.has(a.datos.familiaId));
  if (c.filtros.productos.length) {
    const ks = new Set(c.filtros.productos.map(claveProducto));
    lista = lista.filter((a) => ks.has(claveProducto(a.datos.nombreNormalizado ?? a.datos.producto ?? "")));
  }
  const eje = c.agrupar === "mes" || c.agrupar === "proveedor" || c.agrupar === "familia" || c.agrupar === "producto" ? c.agrupar : null;
  return { porClave: eje ? alertasPorClave(lista, eje) : new Map(), referencia: null };
}

/** El umbral de subida que traen las alertas (el mismo para todas), o null. */
export function umbralSubida(alertas: AlertaFacturas[]): number | null {
  return alertas.find((a) => a.tipo === "facturas_precio_sube" && a.datos.umbralPct !== null)?.datos.umbralPct ?? null;
}
