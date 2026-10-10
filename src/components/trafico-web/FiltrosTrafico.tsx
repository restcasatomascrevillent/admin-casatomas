import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import type { FiltroProyecto } from "@/hooks/useTraficoWeb";
import { RANGOS_DIAS, type RangoDias } from "./calculos";

interface FiltrosTraficoProps {
  proyecto: FiltroProyecto;
  onProyectoChange: (p: FiltroProyecto) => void;
  dias: RangoDias;
  onDiasChange: (d: RangoDias) => void;
}

export function FiltrosTrafico({ proyecto, onProyectoChange, dias, onDiasChange }: FiltrosTraficoProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
      <Select value={proyecto} onValueChange={(v) => onProyectoChange(v as FiltroProyecto)}>
        <SelectTrigger aria-label="Web" className="h-11 w-full sm:w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ambos">Ambas webs</SelectItem>
          <SelectItem value="casa-tomas-story">Casa Tomás</SelectItem>
          <SelectItem value="touza-restaurant-website">Touza</SelectItem>
        </SelectContent>
      </Select>
      <SelectorSubrayado
        aria-label="Periodo"
        valor={String(dias)}
        onCambio={(v) => onDiasChange(Number(v) as RangoDias)}
        opciones={RANGOS_DIAS.map((d) => ({ valor: String(d), etiqueta: `${d} días` }))}
      />
    </div>
  );
}
