import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const TODOS = "__todos__";

export interface OpcionFiltro { valor: string; etiqueta: string }

/** Select con opción «Todos» (valor null). */
export function FiltroSelect({ etiqueta, valor, onCambio, opciones, ancho = "sm:w-[170px]" }: {
  etiqueta: string; valor: string | null; onCambio: (v: string | null) => void; opciones: OpcionFiltro[]; ancho?: string;
}) {
  return (
    <Select value={valor ?? TODOS} onValueChange={(v) => onCambio(v === TODOS ? null : v)}>
      <SelectTrigger aria-label={etiqueta} className={`h-11 w-full ${ancho}`}>
        <SelectValue placeholder={etiqueta} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{etiqueta}: todos</SelectItem>
        {opciones.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.etiqueta}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function Buscador({ valor, onCambio, placeholder }: { valor: string; onCambio: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-11 pl-9" />
    </div>
  );
}

export function Interruptor({ id, etiqueta, valor, onCambio }: { id: string; etiqueta: ReactNode; valor: boolean; onCambio: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      <Switch id={id} checked={valor} onCheckedChange={onCambio} />
      <Label htmlFor={id} className="text-sm font-normal">{etiqueta}</Label>
    </div>
  );
}

export function Paginacion({ pagina, tam, total, onCambio, cargando }: { pagina: number; tam: number; total: number; onCambio: (p: number) => void; cargando?: boolean }) {
  const desde = total === 0 ? 0 : pagina * tam + 1;
  const hasta = Math.min(total, (pagina + 1) * tam);
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground" data-testid="paginacion">
      <span aria-live="polite">{desde}–{hasta} de {total}{cargando ? " · actualizando…" : ""}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon" className="h-11 w-11" disabled={pagina === 0} onClick={() => onCambio(pagina - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-11 w-11" disabled={hasta >= total} onClick={() => onCambio(pagina + 1)} aria-label="Página siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
