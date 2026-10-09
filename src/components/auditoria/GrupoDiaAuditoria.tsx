import { useMemo } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { agruparEntradas, type AuditLogGrupoDia } from "@/hooks/useAuditLog";
import { ResumenGrupoAuditoria } from "./ResumenGrupoAuditoria";
import { TablaEntradasAuditoria } from "./TablaEntradasAuditoria";

/**
 * Un día dentro de "Por día" o "Por mes": cabecera plegable con el resumen y,
 * al desplegar, la misma tabla de registros que la pestaña "Lista" (agrupando
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
  /** Dentro de un mes, el día va con menos aire que como bloque de nivel superior. */
  anidado?: boolean;
}) {
  const grupos = useMemo(() => agruparEntradas(dia.entradas), [dia.entradas]);

  return (
    <Collapsible
      defaultOpen={abiertoPorDefecto}
      className={anidado ? "rounded-md border border-border/60 bg-background" : "rounded-lg border border-border bg-card"}
    >
      <ResumenGrupoAuditoria
        etiqueta={dia.etiqueta}
        totalRegistros={dia.totalRegistros}
        desglosePorAccion={dia.desglosePorAccion}
        actoresDistintos={dia.actoresDistintos}
        nivel="dia"
      />
      <CollapsibleContent className="border-t border-border/60 px-1 pb-1 pt-1">
        <TablaEntradasAuditoria grupos={grupos} expandidas={expandidasFilas} onToggle={onToggleFila} columnaCuando="solo-hora" />
      </CollapsibleContent>
    </Collapsible>
  );
}
