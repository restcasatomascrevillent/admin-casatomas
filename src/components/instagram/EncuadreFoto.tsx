/**
 * Encuadre de «Solo foto» (12/11/2026): la foto recortada a 4:5 a sangre, como
 * saldrá, y se ARRASTRA dentro del marco para elegir qué parte se ve. Debajo,
 * dos deslizadores (horizontal y vertical) para el teclado y para afinar.
 * Valores en % (0-100, 50 = centro): posicionX / posicionY de la pieza.
 *
 * Arrastrar a la derecha enseña más de la izquierda (baja X), como mover una
 * foto bajo un marco. El recorrido solo existe en el eje en que la foto sobra:
 * en una apaisada (las de la carta, 1200×900), el horizontal.
 */
import { useId, useRef, useState, type PointerEvent } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface Encuadre {
  x: number;
  y: number;
}

const limitar = (v: number) => Math.round(Math.min(100, Math.max(0, v)));

/** Cuánto sobra la foto (px del marco) en cada eje al cubrir un marco de w×h. */
export function sobrante(natural: { ancho: number; alto: number }, w: number, h: number): { x: number; y: number } {
  if (!(natural.ancho > 0) || !(natural.alto > 0) || !(w > 0) || !(h > 0)) return { x: 0, y: 0 };
  const s = Math.max(w / natural.ancho, h / natural.alto);
  return { x: natural.ancho * s - w, y: natural.alto * s - h };
}

/** Nuevo encuadre tras arrastrar dx, dy px desde `inicio`. */
export function encuadreArrastrado(inicio: Encuadre, dx: number, dy: number, sobra: { x: number; y: number }): Encuadre {
  return {
    x: sobra.x > 0.5 ? limitar(inicio.x - (dx * 100) / sobra.x) : inicio.x,
    y: sobra.y > 0.5 ? limitar(inicio.y - (dy * 100) / sobra.y) : inicio.y,
  };
}

interface Props {
  src: string;
  valor: Encuadre;
  onCambio: (e: Encuadre) => void;
  className?: string;
}

export function EncuadreFoto({ src, valor, onCambio, className }: Props) {
  const id = useId();
  const marco = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ ancho: number; alto: number } | null>(null);
  const arrastre = useRef<{ px: number; py: number; inicio: Encuadre } | null>(null);

  const sobraAhora = () => {
    const el = marco.current;
    return natural && el ? sobrante(natural, el.clientWidth, el.clientHeight) : { x: 0, y: 0 };
  };

  const alBajar = (e: PointerEvent<HTMLDivElement>) => {
    arrastre.current = { px: e.clientX, py: e.clientY, inicio: valor };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrastre.current;
    if (!a) return;
    const nuevo = encuadreArrastrado(a.inicio, e.clientX - a.px, e.clientY - a.py, sobraAhora());
    if (nuevo.x !== valor.x || nuevo.y !== valor.y) onCambio(nuevo);
  };
  const alSoltar = () => {
    arrastre.current = null;
  };

  return (
    <div className={cn("space-y-2", className)} data-testid="encuadre-foto">
      <p className="text-sm font-medium">Encuadre</p>
      <div
        ref={marco}
        role="presentation"
        className="relative mx-auto aspect-[4/5] w-full max-w-[240px] cursor-grab touch-none select-none overflow-hidden rounded-md border bg-muted active:cursor-grabbing"
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: `${valor.x}% ${valor.y}%` }}
          onLoad={(e) => setNatural({ ancho: e.currentTarget.naturalWidth, alto: e.currentTarget.naturalHeight })}
        />
      </div>
      <p className="text-center text-xs text-muted-foreground">Arrastra la foto para elegir qué parte se ve.</p>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        <Label id={`${id}-x`} className="text-xs">
          Horizontal
        </Label>
        <Slider aria-labelledby={`${id}-x`} min={0} max={100} step={1} value={[valor.x]} onValueChange={([x]) => onCambio({ ...valor, x: limitar(x) })} />
        <Label id={`${id}-y`} className="text-xs">
          Vertical
        </Label>
        <Slider aria-labelledby={`${id}-y`} min={0} max={100} step={1} value={[valor.y]} onValueChange={([y]) => onCambio({ ...valor, y: limitar(y) })} />
      </div>
    </div>
  );
}
