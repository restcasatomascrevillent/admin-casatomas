// ============================================================================
//  Super Admin › Informes — informes de Facturas (gasto por proveedor, familia,
//  mes y productos). Son las mismas tablas que el «Exportar CSV» de Facturas ›
//  Análisis al ampliar una tarjeta (src/components/facturas/analisis/
//  DetalleModulo.tsx), sin filtros: los dos locales y todo el periodo elegido.
//  Misma RPC (`explorar_compras`) y mismas columnas (`filasDeExploracion`).
// ============================================================================
import { consultarExplorarCompras } from "@/hooks/useExplorarCompras";
import { consultaExplorar, filasDeExploracion, type ColumnaDetalle, type IdDetalle } from "@/lib/facturas/detalleModulo";
import { FILTROS_VACIOS, parametrosExplorar } from "@/lib/facturas/explorador";
import type { Periodo } from "../periodo";
import { sufijoArchivo, textoPeriodo } from "../periodo";
import { nombreArchivoInforme, textoCelda, type ColumnaInforme, type FilaInforme, type ResultadoInformeTabla, type TipoCelda } from "../tabla";

export type ModuloInformeFacturas = Extract<IdDetalle, "proveedores" | "familias" | "gasto_mes" | "productos">;

const TIPOS: Record<ColumnaDetalle["tipo"], TipoCelda> = {
  texto: "texto",
  eur: "eur",
  entero: "entero",
  pct: "pct",
  precio: "precio",
  fecha: "fecha",
  variacion: "pct",
};

/** Fechas del periodo para la RPC (un mes se pide entero). */
export function fechasDePeriodo(p: Periodo): { desde: string | null; hasta: string | null } {
  if (p.tipo === "rango") return { desde: p.desde, hasta: p.hasta };
  if (p.tipo === "mes") {
    const [a, m] = p.mes.split("-").map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    return { desde: `${p.mes}-01`, hasta: `${p.mes}-${String(ultimo).padStart(2, "0")}` };
  }
  return { desde: null, hasta: null };
}

export async function obtenerInformeFacturas(modulo: ModuloInformeFacturas, periodo: Periodo, titulo: string): Promise<ResultadoInformeTabla> {
  const consulta = consultaExplorar(modulo, { iva: "con", agrupar: "mes", local: null, familias: 0 });
  if (!consulta) throw new Error(`El informe «${titulo}» no tiene consulta.`);
  const params = parametrosExplorar(
    { medida: consulta.medida, agrupar: consulta.agrupar, desglose: consulta.desglose, filtros: FILTROS_VACIOS, grafica: "auto", top: consulta.top },
    fechasDePeriodo(periodo),
    null,
  );
  const ex = await consultarExplorarCompras(params);
  if (ex.sinDatos || ex.puntos.length === 0) return { vacio: true, motivo: "No hay compras registradas en este periodo." };

  const etiquetaValor = consulta.medida === "gasto" ? "Gasto con IVA" : "Base sin IVA";
  const base = filasDeExploracion(ex, etiquetaValor);
  const columnas: ColumnaInforme[] = base.columnas.map((c) => ({ id: c.id, etiqueta: c.etiqueta, tipo: TIPOS[c.tipo] ?? "texto" }));
  const filas: FilaInforme[] = base.filas.map((f) => ({ ...f.celdas }));

  // Total: la cifra principal y los documentos; cada serie del desglose (local), sumada.
  const total: FilaInforme = { nombre: "Total", valor: ex.total.valor ?? filas.reduce((s, f) => s + (Number(f.valor) || 0), 0), documentos: ex.total.documentos };
  for (const c of columnas) if (c.id.startsWith("s:")) total[c.id] = filas.reduce((s, f) => s + (Number(f[c.id]) || 0), 0);
  if (columnas.some((c) => c.id === "pct")) total.pct = ex.resto ? null : 100;

  const nota = ex.resto && ex.resto.entidades > 0 ? `Y ${ex.resto.entidades} más que no salen en la tabla: ${textoCelda(ex.resto.valor, "eur")} en total.` : null;
  return {
    vacio: false,
    titulo,
    descripcion: `${etiquetaValor} de los dos locales (Casa Tomás y Touza), según las facturas y albaranes del panel.`,
    textoPeriodo: textoPeriodo(periodo),
    tablas: [{ titulo, columnas, filas, total, nota }],
    nombreArchivo: nombreArchivoInforme(titulo, sufijoArchivo(periodo)),
  };
}
