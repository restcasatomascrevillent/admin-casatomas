import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { elegirPestanaInicial, pestanasVisibles, type ContextoMenuPanel } from "@/components/menuPanel";

/** Valor del Select para «sin elección» (Radix no admite value=""). */
const PESTANA_COMO_SIEMPRE = "como-siempre";

interface Props {
  /** Ruta guardada o elegida (`null` = como siempre). */
  valor: string | null;
  onCambiar: (ruta: string | null) => void;
  /** Permisos que está marcando el diálogo (no los guardados): las opciones siguen a lo que se marca. */
  contexto: ContextoMenuPanel;
  disabled?: boolean;
}

/**
 * «Pestaña al iniciar sesión» (11/11/2026) en el diálogo «Permisos»: solo ofrece las pestañas del menú que ESE
 * usuario ve (misma regla que el menú lateral, `menuPanel.ts`). «Como siempre» = sin elección.
 */
export function SelectorPestanaInicial({ valor, onCambiar, contexto, disabled }: Props) {
  const opciones = pestanasVisibles(contexto);
  // Una elección que ya no vería (permiso quitado en este diálogo, sección apagada) sale como «Como siempre».
  const actual = elegirPestanaInicial(valor, contexto) ?? PESTANA_COMO_SIEMPRE;
  return (
    <div className="space-y-2">
      <Label htmlFor="pestana-inicial" className="text-sm font-medium">
        Pestaña al iniciar sesión
      </Label>
      <Select
        value={actual}
        onValueChange={(v) => onCambiar(v === PESTANA_COMO_SIEMPRE ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger id="pestana-inicial" className="h-11 w-full sm:w-[360px]" data-testid="selector-pestana-inicial">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PESTANA_COMO_SIEMPRE}>Como siempre</SelectItem>
          {opciones.map((p) => (
            <SelectItem key={p.url} value={p.url}>
              {p.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
