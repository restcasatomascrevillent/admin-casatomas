import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { calcularTiempos, crearResolverFotos, entradaRotulo_s, inicioDeEscena, type FotoElegida, type ReelPieza, type ResolverFoto } from "@/lib/instagram/reels";
import { EditorReel, type EditorReelProps } from "./EditorReel";
import { VistaPreviaReel, type ControlVistaPreviaReel } from "./VistaPreviaReel";

export interface EstudioReelProps {
  reel: ReelPieza;
  onChange: (reel: ReelPieza) => void;
  /** Igual que en EditorReel: abre el selector de fotos del panel. */
  elegirFoto?: EditorReelProps["elegirFoto"];
  /** URLs de fotos que ya conoce el padre (p. ej. al reabrir un reel guardado). */
  urlFoto?: ResolverFoto;
  /** Base de fuentes, logos y muestras (por defecto "/instagram"). */
  baseRecursos?: string;
  className?: string;
}

/**
 * Editor + vista previa lado a lado (en tablet vertical, uno encima del otro,
 * cada uno con la mitad del alto). Guarda las URLs de las fotos elegidas para
 * la vista previa y, al seleccionar una escena, lleva la vista previa a ella.
 * Ocupa el alto del padre: el padre le da h-full (sin scroll de página).
 */
export function EstudioReel({ reel, onChange, elegirFoto, urlFoto, baseRecursos = "/instagram", className }: EstudioReelProps) {
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const vista = useRef<ControlVistaPreviaReel>(null);
  const resolver = useMemo(() => crearResolverFotos(baseRecursos, (id: string) => fotos[id] ?? urlFoto?.(id)), [baseRecursos, fotos, urlFoto]);
  const alElegir = useCallback((f: FotoElegida) => setFotos((m) => ({ ...m, [f.id]: f.url })), []);

  const alSeleccionar = (i: number) => {
    const inicio = inicioDeEscena(reel, i);
    const e = reel.escenas[i];
    // Un poco después del corte, para que se vea ya el rótulo.
    const dentro = e ? Math.min(e.rotulo ? entradaRotulo_s(e.rotulo) : 1, e.duracion_s - 0.7) : Math.min(3.4, reel.cierre.duracion_s - 0.7);
    vista.current?.irA(Math.min(inicio + Math.max(0, dentro), calcularTiempos(reel).total));
  };

  return (
    <div
      className={cn(
        "grid h-full min-h-0 gap-4 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-1 md:grid-cols-[minmax(0,1fr)_minmax(16rem,38%)]",
        className,
      )}
    >
      <EditorReel reel={reel} onChange={onChange} elegirFoto={elegirFoto} onFotoElegida={alElegir} urlFoto={resolver} onSeleccion={alSeleccionar} />
      <VistaPreviaReel ref={vista} reel={reel} urlFoto={resolver} baseRecursos={baseRecursos} />
    </div>
  );
}
