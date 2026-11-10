// ============================================================================
//  Super Admin › Informes — informes de TABLA (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  Muchos informes son una o varias tablas (gasto por proveedor, votos del vino
//  favorito…). Su generador solo tiene que devolver un `InformeTabla`; la
//  página lo pinta con el mismo formato que el informe de Tráfico web
//  (diapositivas 16:9 de Casa Tomás: portada y una o varias diapositivas por
//  tabla) y lo descarga en PDF o en CSV para Excel.
// ============================================================================

export type TipoCelda = "texto" | "eur" | "entero" | "pct" | "precio" | "fecha";

export interface ColumnaInforme {
  id: string;
  etiqueta: string;
  tipo: TipoCelda;
}

export type ValorCelda = string | number | null;
export type FilaInforme = Record<string, ValorCelda>;

export interface TablaInforme {
  titulo: string;
  columnas: ColumnaInforme[];
  filas: FilaInforme[];
  /** Fila de totales (al final de la tabla, en negrita). */
  total?: FilaInforme | null;
  /** Nota bajo la tabla («y 12 proveedores más: 1.234 €»). */
  nota?: string | null;
}

export interface InformeTabla {
  vacio: false;
  /** «Gasto por proveedor». */
  titulo: string;
  /** Una frase: qué cuenta el informe. Sale en la portada. */
  descripcion: string;
  /** «Octubre de 2026», «1 – 31 oct 2026». */
  textoPeriodo: string;
  tablas: TablaInforme[];
  /** Sin extensión: «informe-gasto-por-proveedor-2026-10». */
  nombreArchivo: string;
}

export interface InformeTablaVacio {
  vacio: true;
  /** Por qué no hay nada que enseñar («No hay compras en este periodo.»). */
  motivo: string;
}

export type ResultadoInformeTabla = InformeTabla | InformeTablaVacio;

/** Filas que caben en una diapositiva de 1280 × 720 debajo del titular. */
export const FILAS_POR_DIAPOSITIVA = 11;

// ─── Formato ────────────────────────────────────────────────────────────────

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 2 });
const entero = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: true });
const decimal1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Texto de una celda tal y como se ve (vista previa y PDF). `null` es «—», nunca 0. */
export function textoCelda(valor: ValorCelda, tipo: TipoCelda): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "string") return valor;
  switch (tipo) {
    case "eur":
    case "precio":
      return eur.format(valor);
    case "entero":
      // Intl no agrupa los números de 4 cifras en es-ES («1234»): se agrupan a mano para que la tabla cuadre.
      return Math.abs(valor) >= 1000 ? entero.format(valor).replace(/^(-?\d)(\d{3})$/, "$1.$2") : entero.format(valor);
    case "pct":
      return `${decimal1.format(valor)}\u00a0%`;
    default:
      return String(valor);
  }
}

export const alineadaDerecha = (tipo: TipoCelda): boolean => tipo !== "texto" && tipo !== "fecha";

// ─── CSV ────────────────────────────────────────────────────────────────────

const celdaCsv = (texto: string) => (/[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto);
const numeroCsv = (n: number) => String(Math.round(n * 10000) / 10000).replace(".", ",");

function valorCsv(valor: ValorCelda, tipo: TipoCelda): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number" && tipo !== "texto" && tipo !== "fecha") return numeroCsv(valor);
  return celdaCsv(String(valor));
}

/**
 * CSV para Excel en español (separador «;», coma decimal y BOM, como el resto
 * de CSV del panel). Cada tabla lleva delante una línea `# título`; entre
 * tablas, una línea en blanco.
 */
export function csvInformeTabla(inf: InformeTabla): string {
  const bloques = inf.tablas.map((t) => {
    const lineas = [`# ${celdaCsv(t.titulo)} · ${celdaCsv(inf.textoPeriodo)}`, t.columnas.map((c) => celdaCsv(c.etiqueta)).join(";")];
    for (const f of [...t.filas, ...(t.total ? [t.total] : [])]) lineas.push(t.columnas.map((c) => valorCsv(f[c.id] ?? null, c.tipo)).join(";"));
    if (t.nota) lineas.push(`# ${celdaCsv(t.nota)}`);
    return lineas.join("\r\n");
  });
  return "﻿" + bloques.join("\r\n\r\n") + "\r\n";
}

// ─── Diapositivas ───────────────────────────────────────────────────────────

export interface PaginaTabla {
  tabla: TablaInforme;
  filas: FilaInforme[];
  /** 1-based dentro de su tabla. */
  parte: number;
  partes: number;
  /** Última página de la tabla: lleva el total y la nota. */
  ultima: boolean;
}

/** Reparte cada tabla en diapositivas de `porPagina` filas (una tabla vacía ocupa una, con su aviso). */
export function paginarTablas(tablas: TablaInforme[], porPagina = FILAS_POR_DIAPOSITIVA): PaginaTabla[] {
  const paginas: PaginaTabla[] = [];
  for (const tabla of tablas) {
    // El total ocupa una fila: si no cabe, pasa a la página siguiente con las últimas filas.
    const filasConTotal = tabla.filas.length + (tabla.total ? 1 : 0);
    const partes = Math.max(1, Math.ceil(filasConTotal / porPagina));
    for (let i = 0; i < partes; i++) {
      paginas.push({ tabla, filas: tabla.filas.slice(i * porPagina, (i + 1) * porPagina), parte: i + 1, partes, ultima: i === partes - 1 });
    }
  }
  return paginas;
}

/** «informe-gasto-por-proveedor-2026-10» (sin tildes ni espacios). */
export function nombreArchivoInforme(titulo: string, sufijo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `informe-${base}${sufijo ? `-${sufijo}` : ""}`;
}
