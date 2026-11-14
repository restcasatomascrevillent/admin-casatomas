/**
 * Super Admin › Logs: colores de cada origen (rojo fallo de la web, ámbar
 * servicio externo, gris lo que no depende de la web). Aparte de los
 * componentes de Origen.tsx para que el refresco en caliente funcione.
 */
import { grupoDeOrigen, NOMBRE_ORIGEN, type GrupoOrigen, type OrigenVisible } from "../../../supabase/functions/_shared/logs-web/origen";

/** Clases de cada color (insignia, bloque, punto de la leyenda, fila y texto de la línea de tiempo). */
export const ESTILO_GRUPO: Record<GrupoOrigen, { insignia: string; bloque: string; punto: string; fila: string; texto: string; icono: string }> = {
  web: {
    insignia: "border-destructive/60 bg-destructive/10 text-destructive",
    bloque: "border-destructive/40 bg-destructive/5",
    punto: "bg-destructive",
    fila: "bg-destructive/5",
    texto: "text-destructive",
    icono: "text-destructive",
  },
  externo: {
    insignia: "border-amber-500/60 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    bloque: "border-amber-500/40 bg-amber-50/70 dark:bg-amber-950/20",
    punto: "bg-amber-500",
    fila: "bg-amber-50/60 dark:bg-amber-950/20",
    texto: "text-amber-800 dark:text-amber-200",
    icono: "text-amber-600 dark:text-amber-400",
  },
  no_depende: {
    insignia: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
    bloque: "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40",
    punto: "bg-slate-400",
    fila: "bg-slate-50/70 dark:bg-slate-900/30",
    texto: "text-slate-600 dark:text-slate-300",
    icono: "text-slate-500 dark:text-slate-400",
  },
};

export const estiloDe = (o: OrigenVisible | null | undefined) => ESTILO_GRUPO[grupoDeOrigen(o)];

/** «Servicio externo · Google Maps», «Conexión del visitante»… */
export function etiquetaOrigen(o: OrigenVisible, proveedor?: string | null): string {
  return o === "externo" && proveedor ? `${NOMBRE_ORIGEN[o]} · ${proveedor}` : NOMBRE_ORIGEN[o];
}
