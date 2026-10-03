import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-6">
      <div className="space-y-1.5">
        <Label htmlFor="trafico-proyecto" className="text-xs text-muted-foreground">
          Web
        </Label>
        <Select value={proyecto} onValueChange={(v) => onProyectoChange(v as FiltroProyecto)}>
          <SelectTrigger id="trafico-proyecto" className="h-11 w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ambos">Ambas webs</SelectItem>
            <SelectItem value="casa-tomas-story">Casa Tomás</SelectItem>
            <SelectItem value="touza-restaurant-website">Touza</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <span className="block text-xs text-muted-foreground" id="trafico-rango">
          Periodo
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby="trafico-rango"
          value={String(dias)}
          onValueChange={(v) => {
            if (v) onDiasChange(Number(v) as RangoDias);
          }}
          className="justify-start"
        >
          {RANGOS_DIAS.map((d) => (
            <ToggleGroupItem key={d} value={String(d)} className="min-h-11 px-4 text-sm">
              {d} días
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
