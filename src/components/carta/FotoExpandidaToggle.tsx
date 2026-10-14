import { useId } from "react";
import { Switch } from "@/components/ui/switch";

interface FotoExpandidaToggleProps {
  imagenUrl?: string | null;
  nombre: string;
  expanded?: boolean | null;
  isPending: boolean;
  onChange: (checked: boolean) => void;
}

export function FotoExpandidaToggle({ imagenUrl, nombre, expanded, isPending, onChange }: FotoExpandidaToggleProps) {
  const id = useId();
  const tieneFoto = !!imagenUrl?.trim();
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      <label htmlFor={id} className="flex min-h-11 items-center justify-between gap-3 text-sm text-muted-foreground">
        Foto expandida en carta web
        <Switch
          id={id}
          aria-label={`Foto expandida en carta web: ${nombre}`}
          aria-describedby={!tieneFoto ? `${id}-motivo` : undefined}
          checked={tieneFoto && (expanded ?? false)}
          disabled={!tieneFoto || isPending}
          onCheckedChange={(checked) => { if (tieneFoto && !isPending) onChange(checked); }}
          className="data-[state=checked]:bg-amber-600"
        />
      </label>
      {!tieneFoto && <p id={`${id}-motivo`} className="pb-1 text-xs text-muted-foreground">Añade una foto para poder expandirla.</p>}
    </div>
  );
}
