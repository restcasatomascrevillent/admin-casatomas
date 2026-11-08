// ============================================================================
//  Facturas › Análisis — detalle en grande de un módulo del tablero
//  (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  Al ampliar una tarjeta se abre un diálogo con TODA su información: tabla
//  ordenable, gráfica, buscador y filtros (periodo, local, proveedor, familia,
//  rango de importe y con/sin IVA donde aplique), CSV y «Ver documentos».
//  Sin IA: reutiliza las RPC que ya hay (`explorar_compras` hasta 50 filas,
//  `tablero_compras` y `documentos_de_cifra`).
//
//  Aquí: qué admite cada módulo, cómo se convierte cada respuesta en filas de
//  una tabla y el filtrado/orden/CSV en el navegador.
// ============================================================================
import { nombreCorto } from "./tableroCompras";
import type { GastoFijo, Subida } from "./tableroCompras";
import { etiquetasClave, esTiempo, type Agrupar, type Desglose, type Exploracion, type Medida } from "./explorador";
import type { DocumentoCifra } from "./documentosCifra";
import { ETIQUETA_LOCAL, ETIQUETA_TIPO } from "./documentosCifra";
import type { IdModulo } from "./widgetsTablero";

// «precios_top» y «ahorro» (gráficas de decisión) no tienen detalle en grande: sus filas abren el explorador o la factura.
export type IdDetalle = Exclude<IdModulo, "explorar" | "precios_top" | "ahorro">;
export type Iva = "con" | "sin";

/** Qué filtros tienen sentido en cada módulo. */
export interface SpecDetalle {
  titulo: string;
  /** De dónde salen las filas. */
  fuente: "explorar" | "tablero" | "documentos";
  /** El local se elige (en «Casa Tomás y Touza» salen siempre los dos). */
  local: boolean;
  proveedor: boolean;
  familia: boolean;
  /** Con/sin IVA (gasto con IVA ↔ base sin IVA de las líneas). */
  iva: boolean;
  /** Eje de tiempo que se puede cambiar (mes, trimestre, semana). */
  tiempo: boolean;
  /** Etiqueta de la cifra que se filtra por rango («Importe», «Media al mes»…). */
  rango: string;
  /** Qué se busca con el buscador. */
  buscar: string;
}

export const SPECS: Record<IdDetalle, SpecDetalle> = {
  proveedores: { titulo: "Proveedores con más gasto", fuente: "explorar", local: true, proveedor: true, familia: true, iva: true, tiempo: false, rango: "Importe", buscar: "Buscar proveedor" },
  subidas: { titulo: "Lo que más ha subido", fuente: "tablero", local: true, proveedor: true, familia: false, iva: false, tiempo: false, rango: "Importe comprado", buscar: "Buscar producto o proveedor" },
  familias: { titulo: "Gasto por familia", fuente: "explorar", local: true, proveedor: true, familia: false, iva: false, tiempo: false, rango: "Base", buscar: "Buscar familia" },
  fijos: { titulo: "Gastos fijos al mes", fuente: "tablero", local: true, proveedor: true, familia: false, iva: false, tiempo: false, rango: "Media al mes", buscar: "Buscar proveedor" },
  abonos: { titulo: "Abonos por proveedor", fuente: "explorar", local: true, proveedor: true, familia: false, iva: false, tiempo: false, rango: "Abonado", buscar: "Buscar proveedor" },
  locales: { titulo: "Casa Tomás y Touza", fuente: "explorar", local: false, proveedor: true, familia: true, iva: true, tiempo: true, rango: "Total", buscar: "Buscar mes" },
  gasto_mes: { titulo: "Gasto por mes", fuente: "explorar", local: true, proveedor: true, familia: true, iva: true, tiempo: true, rango: "Total", buscar: "Buscar mes" },
  productos: { titulo: "Productos más comprados", fuente: "explorar", local: true, proveedor: true, familia: true, iva: false, tiempo: false, rango: "Base", buscar: "Buscar producto" },
  por_revisar: { titulo: "Albaranes por revisar", fuente: "documentos", local: true, proveedor: true, familia: false, iva: false, tiempo: false, rango: "Importe", buscar: "Buscar proveedor o nº" },
  regalado: { titulo: "Regalado por proveedor", fuente: "explorar", local: true, proveedor: true, familia: true, iva: false, tiempo: false, rango: "Regalado", buscar: "Buscar proveedor" },
  precio_producto: { titulo: "Evolución de un producto", fuente: "explorar", local: true, proveedor: true, familia: false, iva: false, tiempo: true, rango: "Precio", buscar: "Buscar mes" },
};

/** Lo que se pide a `explorar_compras` para un módulo (null si no va por ahí). */
export function consultaExplorar(
  modulo: IdDetalle,
  o: { iva: Iva; agrupar: Agrupar; local: "casa_tomas" | "touza" | null; familias: number },
): { medida: Medida; agrupar: Agrupar; desglose: Desglose | null; top: number } | null {
  // Con familias se cuenta por líneas: la base sin IVA (el IVA va por documento).
  const gasto: Medida = o.iva === "con" && o.familias === 0 ? "gasto" : "base";
  switch (modulo) {
    case "proveedores":
      return { medida: gasto, agrupar: "proveedor", desglose: null, top: 50 };
    case "familias":
      return { medida: "base", agrupar: "familia", desglose: null, top: 50 };
    case "abonos":
      return { medida: "abonos", agrupar: "proveedor", desglose: null, top: 50 };
    case "productos":
      return { medida: "base", agrupar: "producto", desglose: null, top: 50 };
    case "regalado":
      return { medida: "regalado", agrupar: "proveedor", desglose: null, top: 50 };
    case "locales":
      return { medida: gasto, agrupar: o.agrupar, desglose: "local", top: 50 };
    case "gasto_mes":
      return { medida: gasto, agrupar: o.agrupar, desglose: o.local ? null : "local", top: 50 };
    case "precio_producto":
      // Precio medio sin IVA por proveedor (los 8 que más venden ese producto).
      return { medida: "precio", agrupar: o.agrupar, desglose: "proveedor", top: 8 };
    default:
      return null;
  }
}

// ─── Filas ──────────────────────────────────────────────────────────────────

export type TipoColumna = "texto" | "eur" | "entero" | "pct" | "variacion" | "precio" | "fecha";

export interface ColumnaDetalle {
  id: string;
  etiqueta: string;
  tipo: TipoColumna;
}

export interface FilaDetalle {
  clave: string;
  /** Lo que sale en la primera columna (y en la gráfica). */
  nombre: string;
  /** Nombre completo (globo y lector de pantalla). */
  nombreLargo: string;
  /** Proveedor, familia… (para las acciones). */
  id: number | null;
  /** La cifra principal (gráfica, rango y % del total). */
  valor: number | null;
  celdas: Record<string, string | number | null>;
  /** Texto en el que busca el buscador (minúsculas, sin tildes). */
  buscable: string;
  /** Lo que necesitan las acciones de la fila (ids, fechas…). */
  dato?: unknown;
}

/** «Camión» → «camion»: el buscador no distingue tildes ni mayúsculas. */
export const normalizarTexto = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const ETIQUETA_EJE: Record<string, string> = { proveedor: "Proveedor", familia: "Familia", producto: "Producto", mes: "Mes", trimestre: "Trimestre", semana: "Semana", dia: "Día" };

/** Columnas y filas de una respuesta de `explorar_compras`. */
export function filasDeExploracion(ex: Exploracion, etiquetaValor: string): { columnas: ColumnaDetalle[]; filas: FilaDetalle[] } {
  const { agrupar, desglose, medida } = ex.parametros;
  const tiempo = esTiempo(agrupar);
  const variosAnios = tiempo && new Set(ex.puntos.map((p) => p.clave.slice(0, 4))).size > 1;
  const total = ex.total.valor ?? ex.puntos.reduce((s, p) => s + (p.valor ?? 0), 0);
  const series = desglose ? ex.series.filter((s) => s.clave !== "__otros__") : [];
  // El precio medio no se suma: «Media» y su unidad («2,35 €/kg»).
  const precio = medida === "precio";
  const tipoCifra = precio ? ("precio" as const) : ("eur" as const);
  const columnas: ColumnaDetalle[] = [
    { id: "nombre", etiqueta: ETIQUETA_EJE[agrupar] ?? "Nombre", tipo: "texto" },
    ...series.map((s) => ({ id: `s:${s.clave}`, etiqueta: desglose === "proveedor" ? nombreCorto(s.etiqueta) : s.etiqueta, tipo: tipoCifra })),
    { id: "valor", etiqueta: precio ? "Media" : series.length ? "Total" : etiquetaValor, tipo: medida === "documentos" ? ("entero" as const) : tipoCifra },
    ...(tiempo ? [] : [{ id: "pct", etiqueta: "% del total", tipo: "pct" as const }]),
    { id: "documentos", etiqueta: "Documentos", tipo: "entero" },
  ];
  const signo = (n: number | null) => (n === null ? null : medida === "abonos" ? -Math.abs(n) : n);
  const filas = ex.puntos.map((p) => {
    const e = etiquetasClave(agrupar, p.clave, p.etiqueta, variosAnios);
    const nombre = p.clave === "0" && agrupar === "familia" ? "Sin clasificar" : agrupar === "proveedor" ? nombreCorto(p.etiqueta) : e.larga;
    const celdas: FilaDetalle["celdas"] = {
      nombre,
      valor: signo(p.valor),
      documentos: p.documentos,
    };
    if (!tiempo) celdas.pct = total && p.valor !== null ? (Math.abs(p.valor) / Math.abs(total)) * 100 : null;
    if (precio) celdas.unidad = ex.parametros.unidad;
    // Un precio que no hay (ese proveedor no lo vendió ese mes) es «—», no 0.
    for (const s of series) celdas[`s:${s.clave}`] = precio ? (p.desglose?.[s.clave] ?? null) : signo(p.desglose?.[s.clave] ?? 0);
    return {
      clave: p.clave,
      nombre,
      nombreLargo: e.larga,
      id: p.id,
      valor: signo(p.valor),
      celdas,
      buscable: normalizarTexto(`${nombre} ${e.larga}`),
      dato: { clave: p.clave, etiqueta: p.etiqueta },
    };
  });
  return { columnas, filas };
}

export function filasDeSubidas(subidas: Subida[]): { columnas: ColumnaDetalle[]; filas: FilaDetalle[] } {
  return {
    columnas: [
      { id: "nombre", etiqueta: "Producto", tipo: "texto" },
      { id: "proveedor", etiqueta: "Proveedor", tipo: "texto" },
      { id: "antes", etiqueta: "Antes", tipo: "precio" },
      { id: "ahora", etiqueta: "Ahora", tipo: "precio" },
      { id: "valor", etiqueta: "Subida", tipo: "variacion" },
      { id: "importe", etiqueta: "Importe comprado", tipo: "eur" },
    ],
    filas: subidas.map((s) => ({
      clave: `${s.proveedor_id}-${s.nombre_normalizado}-${s.unidad}`,
      nombre: s.producto,
      nombreLargo: `${s.producto} · ${s.proveedor}`,
      id: s.proveedor_id,
      valor: s.variacion_pct,
      celdas: {
        nombre: s.producto,
        proveedor: nombreCorto(s.proveedor),
        antes: s.precio_inicio,
        ahora: s.precio_fin,
        valor: s.variacion_pct,
        importe: s.importe,
        unidad: s.unidad,
      },
      buscable: normalizarTexto(`${s.producto} ${s.proveedor}`),
      dato: s,
    })),
  };
}

export function filasDeFijos(fijos: GastoFijo[]): { columnas: ColumnaDetalle[]; filas: FilaDetalle[] } {
  return {
    columnas: [
      { id: "nombre", etiqueta: "Proveedor", tipo: "texto" },
      { id: "valor", etiqueta: "Media al mes", tipo: "eur" },
      { id: "meses", etiqueta: "Meses con factura", tipo: "texto" },
      { id: "documentos", etiqueta: "Documentos", tipo: "entero" },
    ],
    filas: fijos.map((f) => ({
      clave: String(f.id ?? f.nombre),
      nombre: nombreCorto(f.nombre),
      nombreLargo: f.nombre,
      id: f.id,
      valor: f.medio_mes,
      celdas: { nombre: nombreCorto(f.nombre), valor: f.medio_mes, meses: `${f.meses} de ${f.meses_con_datos}`, documentos: f.documentos },
      buscable: normalizarTexto(f.nombre),
      dato: f,
    })),
  };
}

export function filasDeAlbaranes(docs: DocumentoCifra[]): { columnas: ColumnaDetalle[]; filas: FilaDetalle[] } {
  return {
    columnas: [
      { id: "fecha", etiqueta: "Fecha", tipo: "fecha" },
      { id: "nombre", etiqueta: "Proveedor", tipo: "texto" },
      { id: "numero", etiqueta: "Nº", tipo: "texto" },
      { id: "local", etiqueta: "Local", tipo: "texto" },
      { id: "valor", etiqueta: "Importe", tipo: "eur" },
    ],
    filas: docs.map((d) => ({
      clave: String(d.id),
      nombre: nombreCorto(d.proveedor),
      nombreLargo: `${ETIQUETA_TIPO[d.tipo]} ${d.numero ?? "sin número"} de ${d.proveedor}`,
      id: d.proveedorId,
      valor: d.aporta,
      celdas: { fecha: d.fecha, nombre: nombreCorto(d.proveedor), numero: d.numero ?? "—", local: ETIQUETA_LOCAL[d.local], valor: d.aporta },
      buscable: normalizarTexto(`${d.proveedor} ${d.numero ?? ""}`),
      dato: d,
    })),
  };
}

// ─── Filtrar, ordenar, resumir ──────────────────────────────────────────────

/** «1.000» · «1000,5» · «1.000,50 €» → número (null si vacío o no vale). */
export function leerImporte(texto: string): number | null {
  const limpio = texto.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export interface FiltrosLocales {
  texto: string;
  /** Rango de la cifra principal (en valor absoluto: los abonos van en negativo). */
  min: number | null;
  max: number | null;
  /** Proveedores elegidos cuando la fuente no los filtra (tablero, subidas). */
  proveedores?: number[];
}

export function filtrarFilas(filas: FilaDetalle[], f: FiltrosLocales): FilaDetalle[] {
  const palabras = normalizarTexto(f.texto).split(/\s+/).filter(Boolean);
  return filas.filter((x) => {
    if (palabras.length && !palabras.every((p) => x.buscable.includes(p))) return false;
    const v = x.valor === null ? null : Math.abs(x.valor);
    if (f.min !== null && (v === null || v < f.min)) return false;
    if (f.max !== null && (v === null || v > f.max)) return false;
    if (f.proveedores?.length && (x.id === null || !f.proveedores.includes(x.id))) return false;
    return true;
  });
}

export type Direccion = "asc" | "desc";

/** Ordena por una columna (los vacíos, al final en los dos sentidos). */
export function ordenarFilas(filas: FilaDetalle[], columna: string, dir: Direccion): FilaDetalle[] {
  const k = dir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    const x = a.celdas[columna];
    const y = b.celdas[columna];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * k;
    return String(x).localeCompare(String(y), "es", { numeric: true, sensitivity: "base" }) * k;
  });
}

/** Suma de la cifra principal de las filas que se ven. */
export const sumaValor = (filas: FilaDetalle[]): number => filas.reduce((s, f) => s + (f.valor ?? 0), 0);

// ─── CSV ────────────────────────────────────────────────────────────────────

/** Celda de texto: lo que empieza por = + - @ va con «'» (Excel no lo ejecuta). */
const celdaCsv = (texto: string) => {
  const s = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const numeroCsv = (n: number) => String(Math.round(n * 10000) / 10000).replace(".", ",");

/** CSV para Excel en español (`;`, coma decimal, BOM) de las filas tal y como se ven. */
export function csvDetalle(titulo: string, columnas: ColumnaDetalle[], filas: FilaDetalle[]): string {
  const lineas = [`# ${titulo}`, columnas.map((c) => celdaCsv(c.etiqueta)).join(";")];
  for (const f of filas) {
    lineas.push(
      columnas
        .map((c) => {
          const v = c.id === "nombre" ? f.nombreLargo : f.celdas[c.id];
          if (v === null || v === undefined) return "";
          return typeof v === "number" ? numeroCsv(v) : celdaCsv(String(v));
        })
        .join(";"),
    );
  }
  return `\uFEFF${lineas.join("\r\n")}\r\n`;
}

/** «gasto-por-familia-2026-01-01-2026-12-31.csv» */
export function nombreCsv(titulo: string, desde: string | null, hasta: string | null): string {
  const base = normalizarTexto(titulo)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base}${desde && hasta ? `-${desde}-${hasta}` : "-historico"}.csv`;
}
