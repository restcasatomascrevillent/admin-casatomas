import { Checkbox } from "@/components/ui/checkbox";

export function OpcionesRegalo({ ocultarImporte, incluirDedicatoria, onImporte, onDedicatoria, disabled = false }: {
  ocultarImporte: boolean; incluirDedicatoria: boolean;
  onImporte: (ocultar: boolean) => void; onDedicatoria: (incluir: boolean) => void; disabled?: boolean;
}) {
  return <div className="space-y-3 rounded-xl border p-4">
    <label className="flex gap-3 items-center text-sm"><Checkbox disabled={disabled} checked={!ocultarImporte} onCheckedChange={v => onImporte(v !== true)} />Mostrar el importe en el regalo y en el PDF</label>
    <label className="flex gap-3 items-center text-sm"><Checkbox disabled={disabled} checked={incluirDedicatoria} onCheckedChange={v => onDedicatoria(v === true)} />Incluir dedicatoria en el PDF</label>
  </div>;
}
