// ============================================================================
//  Super Admin › Informes — informes de Facturas (gasto por proveedor y por
//  familia). Son las mismas tablas que el «Exportar CSV» de Facturas ›
//  Análisis al ampliar una tarjeta (src/components/facturas/analisis/
//  DetalleModulo.tsx), sin filtros: los dos locales y todo el periodo elegido.
//  Misma RPC (`explorar_compras`) y mismas columnas (`filasDeExploracion`).
//
//  16/11/2026, petición del dueño: en «Gasto por familia», Bebidas lleva debajo
//  Cervezas y Vinos como subfilas. `explorar_compras` solo da la familia de
//  primer nivel; las subfamilias salen de `productos_gasto_por_categoria`, que
//  suma las mismas líneas (mismas fechas, sin los albaranes ya facturados).
// ============================================================================
import { consultarExplorarCompras } from "@/hooks/useExplorarCompras";
import { consultaExplorar, filasDeExploracion, type ColumnaDetalle, type IdDetalle } from "@/lib/facturas/detalleModulo";
import { FILTROS_VACIOS, parametrosExplorar } from "@/lib/facturas/explorador";
import { aGastoCategoria, type GastoCategoria } from "@/lib/facturas/productos";
import { supabase } from "@/integrations/supabase/client";
import type { Periodo } from "../periodo";
import { sufijoArchivo, textoPeriodo } from "../periodo";
import { CLAVE_SUBFILA, nombreArchivoInforme, textoCelda, type ColumnaInforme, type FilaInforme, type ResultadoInformeTabla, type TipoCelda } from "../tabla";

export type ModuloInformeFacturas = Extract<IdDetalle, "proveedores" | "familias">;

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

/** Subfamilias que salen como subfilas de su familia: familia → subfamilias, en este orden (nombres sin tildes y en minúsculas). */
export const SUBFAMILIAS_INFORME: Record<string, string[]> = { bebidas: ["cervezas", "vinos"] };

const sinTildes = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

async function gastoPorCategoria(desde: string | null, hasta: string | null): Promise<GastoCategoria[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("productos_gasto_por_categoria", { p_desde: desde, p_hasta: hasta, p_tipo: null });
  if (error) throw new Error(error.message || "No se ha podido leer el gasto por subfamilia");
  return ((data ?? []) as Record<string, unknown>[]).map(aGastoCategoria);
}

/**
 * Mete debajo de cada familia de `SUBFAMILIAS_INFORME` sus subfamilias con gasto en el periodo.
 * La subfila no tiene documentos (la RPC cuenta líneas) y su % es sobre el total del informe.
 */
export function conSubfilas(filas: (FilaInforme & { clave?: string })[], categorias: GastoCategoria[], total: number): FilaInforme[] {
  const salida: FilaInforme[] = [];
  for (const { clave, ...fila } of filas) {
    salida.push(fila);
    const buscadas = SUBFAMILIAS_INFORME[sinTildes(String(fila.nombre ?? ""))];
    if (!buscadas) continue;
    for (const nombre of buscadas) {
      // Varias filas de la RPC pueden ser de la misma subfamilia: se suman.
      const suyas = categorias.filter((c) => c.padre_id !== null && String(c.padre_id) === clave && sinTildes(c.categoria) === nombre);
      if (suyas.length === 0) continue;
      const valor = suyas.reduce((s, c) => s + c.gasto, 0);
      salida.push({ nombre: suyas[0].categoria, valor, pct: total ? (Math.abs(valor) / Math.abs(total)) * 100 : null, documentos: null, [CLAVE_SUBFILA]: 1 });
    }
  }
  return salida;
}

export async function obtenerInformeFacturas(modulo: ModuloInformeFacturas, periodo: Periodo, titulo: string): Promise<ResultadoInformeTabla> {
  const consulta = consultaExplorar(modulo, { iva: "con", agrupar: "mes", local: null, familias: 0 });
  if (!consulta) throw new Error(`El informe «${titulo}» no tiene consulta.`);
  const params = parametrosExplorar(
    { medida: consulta.medida, agrupar: consulta.agrupar, desglose: consulta.desglose, filtros: FILTROS_VACIOS, grafica: "auto", top: consulta.top },
    fechasDePeriodo(periodo),
    null,
  );
  const fechas = fechasDePeriodo(periodo);
  const [ex, categorias] = await Promise.all([
    consultarExplorarCompras(params),
    modulo === "familias" ? gastoPorCategoria(fechas.desde, fechas.hasta) : Promise.resolve([] as GastoCategoria[]),
  ]);
  if (ex.sinDatos || ex.puntos.length === 0) return { vacio: true, motivo: "No hay compras registradas en este periodo." };

  const etiquetaValor = consulta.medida === "gasto" ? "Gasto con IVA" : "Base sin IVA";
  const base = filasDeExploracion(ex, etiquetaValor);
  const columnas: ColumnaInforme[] = base.columnas.map((c) => ({ id: c.id, etiqueta: c.etiqueta, tipo: TIPOS[c.tipo] ?? "texto" }));
  const totalValor = ex.total.valor ?? base.filas.reduce((s, f) => s + (f.valor ?? 0), 0);
  const filas: FilaInforme[] =
    modulo === "familias"
      ? conSubfilas(base.filas.map((f) => ({ ...f.celdas, clave: f.clave })), categorias, totalValor)
      : base.filas.map((f) => ({ ...f.celdas }));

  // Total: la cifra principal y los documentos; cada serie del desglose (local), sumada.
  const total: FilaInforme = { nombre: "Total", valor: totalValor, documentos: ex.total.documentos };
  for (const c of columnas) if (c.id.startsWith("s:")) total[c.id] = filas.reduce((s, f) => s + (Number(f[c.id]) || 0), 0);
  if (columnas.some((c) => c.id === "pct")) total.pct = ex.resto ? null : 100;

  const nota = ex.resto && ex.resto.entidades > 0 ? `Y ${ex.resto.entidades} más que no salen en la tabla: ${textoCelda(ex.resto.valor, "eur")} en total.` : null;
  const haySubfilas = filas.some((f) => f[CLAVE_SUBFILA] === 1);
  const notas = [nota, haySubfilas ? "Cervezas y Vinos ya están sumados en Bebidas." : null].filter(Boolean);
  return {
    vacio: false,
    titulo,
    descripcion: `${etiquetaValor} de los dos locales (Casa Tomás y Touza), según las facturas y albaranes del panel.`,
    textoPeriodo: textoPeriodo(periodo),
    tablas: [{ titulo, columnas, filas, total, nota: notas.length ? notas.join(" ") : null }],
    nombreArchivo: nombreArchivoInforme(titulo, sufijoArchivo(periodo)),
  };
}
