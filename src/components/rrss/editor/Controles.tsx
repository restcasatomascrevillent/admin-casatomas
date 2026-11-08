/** Controles pequeños comunes de los ajustes (deslizador con etiqueta, selector nativo, número). */
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface DeslizadorProps {
  id: string;
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  paso: number;
  /** Cómo se enseña el valor (por defecto con coma decimal). */
  formato?: (v: number) => string;
  onCambio: (v: number) => void;
  disabled?: boolean;
}

export function Deslizador({ id, etiqueta, valor, min, max, paso, formato, onCambio, disabled }: DeslizadorProps) {
  const texto = formato ? formato(valor) : String(Math.round(valor * 100) / 100).replace(".", ",");
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm">
          {etiqueta}
        </Label>
        <output htmlFor={id} className="text-xs tabular-nums text-muted-foreground">
          {texto}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={paso}
        value={valor}
        disabled={disabled}
        onChange={(e) => onCambio(Number(e.target.value))}
        className="h-8 w-full cursor-pointer accent-primary pointer-coarse:h-11"
      />
    </div>
  );
}

interface SelectorProps {
  id: string;
  etiqueta: string;
  valor: string;
  opciones: { valor: string; etiqueta: string }[];
  onCambio: (v: string) => void;
  disabled?: boolean;
  className?: string;
}

export function SelectorNativo({ id, etiqueta, valor, opciones, onCambio, disabled, className }: SelectorProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className="text-sm">
        {etiqueta}
      </Label>
      <select
        id={id}
        value={valor}
        disabled={disabled}
        onChange={(e) => onCambio(e.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11"
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Campo({ etiqueta, htmlFor, ayuda, children }: { etiqueta: string; htmlFor: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-sm">
        {etiqueta}
      </Label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
