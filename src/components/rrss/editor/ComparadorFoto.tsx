import { useState } from "react";
import type { Encuadre } from "@/lib/rrss/plan";
import { posicionOriginal } from "./util";

interface Props {
  /** Medidas de la imagen resultante. */
  ancho: number;
  alto: number;
  urlResultado?: string;
  urlOriginal?: string;
  /** Medidas del original (para encuadrarlo como lo hace el motor). */
  original?: { ancho: number | null; alto: number | null };
  encuadre: Encuadre;
  descripcion: string;
}

export function ComparadorFoto({ ancho, alto, urlResultado, urlOriginal, original, encuadre, descripcion }: Props) {
  const [pos, setPos] = useState(50);
  const rec = posicionOriginal(original, ancho, alto, encuadre);
  const comparable = !!urlOriginal && !!urlResultado && !!rec;

  return (
    <div
      className="relative w-full select-none overflow-hidden rounded-md bg-muted focus-within:ring-2 focus-within:ring-ring"
      style={{ aspectRatio: `${ancho} / ${alto}` }}
      data-testid="comparador"
    >
      {urlResultado ? <img src={urlResultado} alt={descripcion || "Resultado"} className="absolute inset-0 h-full w-full object-cover" draggable={false} /> : <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Cargando…</div>}
      {comparable && rec && (
        <>
          <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <img src={urlOriginal} alt="Original encuadrado" className="absolute max-w-none" style={rec} draggable={false} />
          </div>
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }}>
            <span className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/50" />
          </div>
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">Antes</span>
          <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">Después</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pos}
            aria-label="Comparar antes y después"
            onChange={(e) => setPos(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          />
        </>
      )}
    </div>
  );
}
