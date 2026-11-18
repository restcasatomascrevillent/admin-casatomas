import { useMemo } from "react";
import { isToday, isYesterday } from "date-fns";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { agruparEntradas, type AuditLogGrupoDia } from "@/hooks/useAuditLog";
import { cn } from "@/lib/utils";
import { ResumenGrupoAuditoria } from "./ResumenGrupoAuditoria";
import { TablaEntradasAuditoria } from "./TablaEntradasAuditoria";

/** «Hoy · …» / «Ayer · …» delante de la fecha del día, para ubicarse de un vistazo. */
function etiquetaConRelativo(dia: AuditLogGrupoDia): string {
  const [anio, mes, numero] = dia.key.split("-").map(Number);
  const fecha = new Date(anio, mes - 1, numero);
  if (isToday(fecha)) return `Hoy · ${dia.etiqueta}`;
  if (isYesterday(fecha)) return `Ayer · ${dia.etiqueta}`;
  return dia.etiqueta;
}

/**
 * Un día dentro de "Por día" o "Por mes": cabecera plegable con el resumen y,
 * al desplegar, la misma lista de registros que la pestaña "Lista" (agrupando
 * también los altas en bloque de una misma transacción).
 */
export function GrupoDiaAuditoria({
  dia,
  abiertoPorDefecto,
  expandidasFilas,
  onToggleFila,
  anidado = false,
}: {
  dia: AuditLogGrupoDia;
  abiertoPorDefecto: boolean;
  expandidasFilas: Set<string>;
  onToggleFila: (key: string) => void;
  /** Dentro de un mes, el día va sin caja propia (solo un separador), para no meter tarjetas dentro de tarjetas. */
  anidado?: boolean;
}) {
  const grupos = useMemo(() => agruparEntradas(dia.entradas), [dia.entradas]);

  return (
    <Collapsible
      defaultOpen={abiertoPorDefecto}
      className={cn(!anidado && "overflow-hidden rounded-lg border border-border bg-card")}
    >
      <ResumenGrupoAuditoria
        etiqueta={etiquetaConRelativo(dia)}
        totalRegistros={dia.totalRegistros}
        desglosePorAccion={dia.desglosePorAccion}
        actoresDistintos={dia.actoresDistintos}
        nivel="dia"
        className={cn(anidado && "bg-muted/25")}
      />
      <CollapsibleContent className="border-t border-border/60">
        <TablaEntradasAuditoria grupos={grupos} expandidas={expandidasFilas} onToggle={onToggleFila} />
      </CollapsibleContent>
    </Collapsible>
  );
}
