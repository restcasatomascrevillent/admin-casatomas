// Catálogo de PREGUNTAS RÁPIDAS del chat de facturas (sin IA, 0 tokens).
//
// Añadir un botón = añadir una entrada a `PREGUNTAS_RAPIDAS`:
//   { id, etiqueta, icono, descripcion, rpc, consultar, Resultado }
//   · `consultar(llamarRpc, ahora)` llama a la(s) RPC con sus argumentos y
//     devuelve los datos (lanza Error si la RPC contesta {error}).
//   · `Resultado` pinta esos datos (resultados.tsx).
//   · `proximamente: true` (sin `consultar`) deja el botón visible pero
//     deshabilitado con el texto «próximamente».
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CalendarRange,
  ClipboardCheck,
  FileQuestion,
  Package,
  PieChart,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import {
  comprobarErrorRpc,
  rangoAnioActual,
  rangosGastoMes,
  rangoUltimos12Meses,
  ultimos12Meses,
  type EstadisticasGlobales,
  type FilaCantidadProducto,
  type FilaGastoProveedor,
  type FiltroDocumentos,
  type Ranking,
  type ResumenPeriodo,
} from "@/lib/facturas/preguntasRapidas";
import {
  ResultadoDocumentos,
  ResultadoGastoMes,
  ResultadoGastoPorMes,
  ResultadoProductos,
  ResultadoTopProveedores,
  type DatosDocumentos,
  type DatosGastoMes,
  type DatosGastoPorMes,
  type DatosProductos,
  type DatosTopProveedores,
} from "./resultados";

/** Llama a una RPC de Postgres y devuelve `data` (lanza si hay error). */
export type LlamarRpc = (funcion: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface PreguntaRapida<T = unknown> {
  id: string;
  etiqueta: string;
  icono: LucideIcon;
  /** Qué enseña y de qué periodo (title del botón y subtítulo de la tarjeta). */
  descripcion: string;
  /** RPC(s) que usa; informativo (documentación y pruebas). */
  rpc: string;
  proximamente?: boolean;
  consultar?: (llamar: LlamarRpc, ahora: Date) => Promise<T>;
  Resultado?: ComponentType<{ datos: T }>;
}

// Variancia de `Resultado`: cada entrada se tipa con sus datos y la lista las
// guarda como `PreguntaRapida<unknown>`.
const definir = <T,>(p: PreguntaRapida<T>) => p as unknown as PreguntaRapida<unknown>;

/** Cuántas filas se piden a filtrar_documentos_agente (su máximo es 50). */
export const LIMITE_DOCUMENTOS = 50;
/** Cuántas filas se piden a ranking_agente(cantidad) para repartirlas por unidad. */
export const LIMITE_PRODUCTOS = 40;

const listaDocumentos = (filtro: DatosDocumentos["filtro"]) =>
  async (llamar: LlamarRpc): Promise<DatosDocumentos> => ({
    filtro,
    lista: comprobarErrorRpc(
      (await llamar("filtrar_documentos_agente", {
        p_filtro: filtro,
        p_orden: "fecha_desc",
        p_limite: LIMITE_DOCUMENTOS,
      })) as FiltroDocumentos,
    ),
  });

export const PREGUNTAS_RAPIDAS: PreguntaRapida[] = [
  definir<DatosGastoMes>({
    id: "gasto-mes",
    etiqueta: "Gasto este mes",
    icono: Wallet,
    descripcion: "Facturas del mes en curso frente al mes anterior",
    rpc: "resumen_periodo_agente",
    consultar: async (llamar, ahora) => {
      const rangos = rangosGastoMes(ahora);
      const [actual, anterior] = await Promise.all([
        llamar("resumen_periodo_agente", { p_desde: rangos.actual.desde, p_hasta: rangos.actual.hasta }),
        llamar("resumen_periodo_agente", { p_desde: rangos.anterior.desde, p_hasta: rangos.anterior.hasta }),
      ]);
      return {
        rangos,
        actual: comprobarErrorRpc(actual as ResumenPeriodo),
        anterior: comprobarErrorRpc(anterior as ResumenPeriodo),
      };
    },
    Resultado: ResultadoGastoMes,
  }),
  definir<DatosGastoPorMes>({
    id: "gasto-por-mes",
    etiqueta: "Gasto por mes",
    icono: CalendarRange,
    descripcion: "Facturas de los últimos 12 meses",
    rpc: "estadisticas_globales_agente",
    consultar: async (llamar, ahora) => {
      const datos = comprobarErrorRpc((await llamar("estadisticas_globales_agente")) as EstadisticasGlobales);
      const ventana = ultimos12Meses(ahora);
      if (datos.sin_datos) return { ventana, meses: [], sinDatos: "No hay ningún documento cargado todavía." };
      return { ventana, meses: (datos.meses ?? []).filter((m) => ventana.includes(m.mes)) };
    },
    Resultado: ResultadoGastoPorMes,
  }),
  definir<DatosTopProveedores>({
    id: "top-proveedores",
    etiqueta: "Top proveedores",
    icono: Truck,
    descripcion: "Gasto en facturas por proveedor este año",
    rpc: "ranking_agente",
    consultar: async (llamar, ahora) => {
      const anio = rangoAnioActual(ahora);
      const ranking = comprobarErrorRpc(
        (await llamar("ranking_agente", {
          p_criterio: "gasto_proveedor",
          p_tipo: "factura",
          p_limite: 10,
          p_desde: anio.desde,
          p_hasta: anio.hasta,
          p_orden: "desc",
        })) as Ranking<FilaGastoProveedor>,
      );
      return { anio: anio.anio, ranking };
    },
    Resultado: ResultadoTopProveedores,
  }),
  definir<DatosProductos>({
    id: "productos-mas-comprados",
    etiqueta: "Productos más comprados",
    icono: Package,
    descripcion: "Cantidad comprada por unidad (kg, ud…), sin servicios, últimos 12 meses",
    rpc: "ranking_agente",
    consultar: async (llamar, ahora) => {
      const rango = rangoUltimos12Meses(ahora);
      const ranking = comprobarErrorRpc(
        (await llamar("ranking_agente", {
          p_criterio: "cantidad",
          p_limite: LIMITE_PRODUCTOS,
          p_desde: rango.desde,
          p_hasta: rango.hasta,
          p_orden: "desc",
          p_incluir_servicios: false,
        })) as Ranking<FilaCantidadProducto>,
      );
      return { ...rango, ranking };
    },
    Resultado: ResultadoProductos,
  }),
  definir<DatosDocumentos>({
    id: "por-revisar",
    etiqueta: "Por revisar",
    icono: ClipboardCheck,
    descripcion: "Facturas y albaranes sin verificar",
    rpc: "filtrar_documentos_agente",
    consultar: listaDocumentos("sin_verificar"),
    Resultado: ResultadoDocumentos,
  }),
  definir<DatosDocumentos>({
    id: "con-avisos",
    etiqueta: "Con avisos",
    icono: AlertTriangle,
    descripcion: "Documentos con avisos de lectura o de importes",
    rpc: "filtrar_documentos_agente",
    consultar: listaDocumentos("con_alertas"),
    Resultado: ResultadoDocumentos,
  }),
  definir<DatosDocumentos>({
    id: "sin-total",
    etiqueta: "Sin total",
    icono: FileQuestion,
    descripcion: "Documentos a los que no se les leyó el importe total",
    rpc: "filtrar_documentos_agente",
    consultar: listaDocumentos("sin_total"),
    Resultado: ResultadoDocumentos,
  }),
  // ── Próximamente: faltan sus RPC. Para activarlas, quitar `proximamente` y
  //    añadir `consultar` + `Resultado` (ver informe en engram
  //    facturas/preguntas-rapidas-sin-ia).
  definir({
    id: "gasto-categoria",
    etiqueta: "Gasto por categoría",
    icono: PieChart,
    descripcion: "Gasto por categoría de producto (próximamente)",
    rpc: "pendiente",
    proximamente: true,
  }),
  definir({
    id: "subidas-precio",
    etiqueta: "Qué ha subido de precio",
    icono: TrendingUp,
    descripcion: "Productos que han subido de precio (próximamente)",
    rpc: "pendiente",
    proximamente: true,
  }),
];
