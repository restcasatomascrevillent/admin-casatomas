// Periodo del tablero: Mes · Trimestre · Año · Todo · Personalizado.
// «Personalizado» abre un calendario táctil (rango desde–hasta) con atajos de
// un toque (últimos 7/30/90 días, este mes, mes anterior, este año, año pasado).
import { useState } from "react";
import { CalendarRange } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { periodosAnalisis, type PeriodoAnalisis } from "@/lib/facturas/tableroCompras";
import { atajosPeriodo, isoLocal, textoRango, type SeleccionPeriodo } from "@/lib/facturas/periodoAnalisis";
import { FOCO } from "./piezas";

const aFecha = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

const BOTON =
  "min-h-11 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm";

export function SelectorPeriodo({ valor, onCambio, hoy }: { valor: SeleccionPeriodo; onCambio: (v: SeleccionPeriodo) => void; hoy: Date }) {
  const [abierto, setAbierto] = useState(false);
  const [rango, setRango] = useState<DateRange | undefined>();
  const personalizado = valor.tipo === "personalizado" ? valor : null;

  const abrir = (o: boolean) => {
    if (o) setRango(personalizado ? { from: aFecha(personalizado.desde), to: aFecha(personalizado.hasta) } : undefined);
    setAbierto(o);
  };
  const aplicar = (desde: string, hasta: string) => {
    onCambio({ tipo: "personalizado", desde: desde <= hasta ? desde : hasta, hasta: desde <= hasta ? hasta : desde });
    setAbierto(false);
  };
  const listo = rango?.from && rango?.to;

  return (
    <div role="group" aria-label="Periodo" className="inline-flex max-w-full shrink-0 flex-wrap gap-1 rounded-lg bg-muted/40 p-1">
      {periodosAnalisis(hoy).map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor.tipo === o.valor}
          onClick={() => onCambio({ tipo: o.valor as PeriodoAnalisis })}
          className={cn(BOTON, FOCO)}
        >
          {o.etiqueta}
        </button>
      ))}
      <Popover open={abierto} onOpenChange={abrir}>
        <PopoverTrigger asChild>
          <button type="button" aria-pressed={!!personalizado} className={cn(BOTON, FOCO, "inline-flex items-center gap-1.5")} data-testid="periodo-personalizado">
            <CalendarRange className="h-4 w-4" aria-hidden />
            {personalizado ? <span className="tabular-nums">{textoRango(personalizado.desde, personalizado.hasta)}</span> : "Personalizado"}
          </button>
        </PopoverTrigger>
        {/* En el móvil no cabía (QA 05/11/2026): se ajusta al alto que queda (sin pegarse al borde),
            los atajos van en una fila que se desliza y «Aplicar» queda fijo abajo aunque haya que desplazar. */}
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="w-auto max-w-[min(40rem,calc(100vw-1rem))] p-0"
          aria-label="Elegir fechas"
        >
          <div className="flex flex-col sm:flex-row">
            <ul
              className="flex gap-1 overflow-x-auto border-b border-border/60 p-2 [scrollbar-width:none] sm:w-44 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r [&::-webkit-scrollbar]:hidden"
              aria-label="Atajos"
            >
              {atajosPeriodo(hoy).map((a) => (
                <li key={a.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => aplicar(a.desde, a.hasta)}
                    className={cn("min-h-11 w-full whitespace-nowrap rounded-md px-3 text-left text-sm hover:bg-muted/60", FOCO)}
                  >
                    {a.etiqueta}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-col">
              <Calendar
                mode="range"
                numberOfMonths={1}
                selected={rango}
                onSelect={setRango}
                defaultMonth={rango?.from ?? hoy}
                disabled={{ after: new Date(hoy.getFullYear() + 1, 11, 31) }}
                initialFocus
              />
              <div className="sticky bottom-0 flex items-center gap-2 border-t border-border/60 bg-popover p-2">
                <p className="line-clamp-2 min-w-0 flex-1 break-words text-xs text-muted-foreground tabular-nums" aria-live="polite">
                  {rango?.from
                    ? rango.to
                      ? textoRango(isoLocal(rango.from), isoLocal(rango.to))
                      : `Desde ${textoRango(isoLocal(rango.from), isoLocal(rango.from))}: toca el último día`
                    : "Toca el primer día"}
                </p>
                <Button type="button" className="h-11" disabled={!listo} onClick={() => listo && aplicar(isoLocal(rango.from as Date), isoLocal(rango.to as Date))}>
                  Aplicar
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
