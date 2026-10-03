// ============================================================================
// CampoColorMarca — selector de color + input hex sincronizados. Valida en
// el mismo formato que exige la BD (chk_plantilla_colores_hex: #RRGGBB) para
// que un color mal escrito se detecte aquí y no como un error de guardado.
// ============================================================================
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

interface CampoColorMarcaProps {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (nuevoValor: string) => void;
  disabled?: boolean;
}

export function CampoColorMarca({ id, etiqueta, valor, onChange, disabled }: CampoColorMarcaProps) {
  const esValido = HEX_RE.test(valor);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Selector visual de color para ${etiqueta}`}
          value={esValido ? valor : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          disabled={disabled}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={id}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          readOnly={disabled}
          placeholder="#RRGGBB"
          maxLength={7}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 font-mono uppercase text-base md:text-base"
        />
      </div>
      {!esValido && <p className="text-xs text-destructive">Tiene que ser un color hexadecimal de 6 dígitos, p.ej. #B8936A.</p>}
    </div>
  );
}
