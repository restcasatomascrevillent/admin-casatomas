import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  opcionesDenominacionVino,
  opcionesTipoVino,
  tipoDelFiltro,
  type FiltroVinos,
  type OpcionFiltroVino,
} from "./filtroVinos";
import type { OrigenVino } from "@/lib/origen-vino";

interface BarraProps {
  opciones: OpcionFiltroVino[];
  seleccionado: FiltroVinos | null;
  onChange: (valor: FiltroVinos) => void;
  /** Nombre del grupo («Filtrar vinos por tipo»). */
  etiqueta: string;
}

/**
 * Fila de píldoras con contador y desplazamiento horizontal, como en la carta
 * de la web (web-casatomas/src/components/carta/FiltrosTipoVino.tsx): si no
 * caben, se desliza con el dedo y aparecen flechas en los bordes.
 */
export function BarraFiltrosVino({ opciones, seleccionado, onChange, etiqueta }: BarraProps) {
  const carril = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ izquierda: false, derecha: false });
  const claveOpciones = opciones.map((o) => `${o.valor}:${o.cantidad}`).join("|");

  const medir = useCallback(() => {
    const el = carril.current;
    if (!el) return;
    const izquierda = el.scrollLeft > 2;
    const derecha = el.scrollWidth - el.clientWidth - Math.max(0, el.scrollLeft) > 2;
    setBordes((actual) => (actual.izquierda === izquierda && actual.derecha === derecha ? actual : { izquierda, derecha }));
  }, []);

  useEffect(() => {
    medir();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    if (carril.current) observer?.observe(carril.current);
    window.addEventListener("resize", medir);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [medir, claveOpciones]);

  // La píldora elegida, a la vista (solo mueve la fila: scrollIntoView movería también la página).
  useEffect(() => {
    const el = carril.current;
    const activo = el?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (el && activo && el.scrollWidth > el.clientWidth) {
      const distancia = activo.getBoundingClientRect().left - el.getBoundingClientRect().left;
      if (distancia < 8 || distancia + activo.offsetWidth > el.clientWidth - 8) {
        el.scrollLeft += distancia - (el.clientWidth - activo.offsetWidth) / 2;
      }
    }
    medir();
  }, [seleccionado, claveOpciones, medir]);

  const desplazar = (direccion: number) => {
    const el = carril.current;
    if (!el) return;
    const reducido = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy?.({ left: direccion * Math.max(120, el.clientWidth * 0.7), behavior: reducido ? "auto" : "smooth" });
  };

  return (
    <div className="relative w-full min-w-0 max-w-full sm:w-fit">
      <div
        ref={carril}
        onScroll={medir}
        role="group"
        aria-label={etiqueta}
        className="flex w-full min-w-0 max-w-full gap-1.5 overflow-x-auto overscroll-x-contain rounded-xl border border-border/60 bg-muted/30 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-fit"
      >
        {opciones.map((opcion) => {
          const activo = seleccionado === opcion.valor;
          return (
            <Button
              key={opcion.valor}
              type="button"
              variant="ghost"
              // Empieza por el texto visible («Tintos 113»): quien dicta «pulsar Tintos 113» lo encuentra
              // (WCAG 2.5.3). El nombre largo, si lo hay, va detrás.
              aria-label={`${opcion.etiqueta} ${opcion.cantidad}${
                opcion.nombreAccesible && opcion.nombreAccesible !== opcion.etiqueta ? `, ${opcion.nombreAccesible}` : ""
              }`}
              title={opcion.nombreAccesible ?? opcion.etiqueta}
              aria-pressed={activo}
              onClick={() => onChange(opcion.valor)}
              className={cn(
                "h-11 shrink-0 justify-center gap-2 rounded-lg border px-2.5 py-0 text-sm font-medium hover:text-foreground pointer-coarse:px-2.5",
                activo
                  ? "border-primary/30 bg-background text-foreground shadow-sm hover:bg-background"
                  : "border-transparent text-muted-foreground hover:bg-background/70",
                opcion.aviso && "text-amber-800 dark:text-amber-300",
                opcion.aviso && activo && "border-amber-500/60",
              )}
            >
              <span className={cn("min-w-0 whitespace-nowrap", activo && "font-semibold")}>{opcion.etiqueta}</span>{" "}
              <span
                aria-hidden="true"
                className={cn(
                  "shrink-0 rounded-md px-1.5 py-0.5 text-xs leading-none tabular-nums",
                  opcion.aviso ? "bg-amber-500/15" : "bg-foreground/5",
                  activo ? "font-semibold" : !opcion.aviso && "text-muted-foreground",
                )}
              >
                {opcion.cantidad}
              </span>
            </Button>
          );
        })}
      </div>
      {bordes.izquierda && (
        <div className="pointer-events-none absolute inset-y-px left-px flex w-14 items-center justify-start rounded-l-xl bg-gradient-to-r from-background via-background/95 to-transparent">
          <button
            type="button"
            aria-label="Ver opciones anteriores"
            onClick={() => desplazar(-1)}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {bordes.derecha && (
        <div className="pointer-events-none absolute inset-y-px right-px flex w-14 items-center justify-end rounded-r-xl bg-gradient-to-l from-background via-background/95 to-transparent">
          <button
            type="button"
            aria-label="Ver más opciones"
            onClick={() => desplazar(1)}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

interface FiltrosVinosProps {
  /** Vinos sobre los que se cuenta (ya con la visibilidad y la búsqueda aplicadas). */
  vinos: readonly (OrigenVino & { categoria?: string | null })[];
  valor: FiltroVinos;
  onChange: (valor: FiltroVinos) => void;
}

/**
 * Filtro de vinos como el de la carta de la web (04/11/2026, dueño: «en vez del
 * desplegable para filtrar vinos, que esté la misma opción que hay en carta»):
 * píldoras por tipo y, con un tipo elegido, por denominación.
 */
export function FiltrosVinos({ vinos, valor, onChange }: FiltrosVinosProps) {
  const tipo = tipoDelFiltro(valor);
  const tipos = opcionesTipoVino(vinos, valor);
  const denominaciones = tipo ? opcionesDenominacionVino(vinos, tipo, valor) : [];
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <BarraFiltrosVino
        etiqueta="Filtrar vinos por tipo"
        opciones={tipos}
        seleccionado={tipo ? `tipo:${tipo}` : valor}
        onChange={onChange}
      />
      {tipo && denominaciones.length > 1 && (
        <BarraFiltrosVino
          key={tipo}
          etiqueta="Filtrar vinos por denominación"
          opciones={denominaciones}
          seleccionado={valor}
          onChange={onChange}
        />
      )}
    </div>
  );
}
