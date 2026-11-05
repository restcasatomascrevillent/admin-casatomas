/**
 * Vista previa del montaje para el móvil: un carrusel que se desliza con el
 * dedo (scroll-snap nativo, sin librerías) con cada imagen pintada con el
 * MISMO HTML que capturará el servidor (construirDocumento) en un iframe
 * escalado. Solo se pintan la imagen visible y sus vecinas (memoria del móvil).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FORMATOS, type MarcaId } from "@/lib/instagram";
import type { DiapositivaMontada, FormatoMontado, FotoParaMontar } from "@/lib/instagram/montar";
import { useTamanoElemento } from "@/hooks/useAlturaDisponible";
import { cn } from "@/lib/utils";
import { documentoDiapositiva } from "./documento";

function Diapositiva({ documento, foto, formato, titulo, pintar }: { documento: string | null; foto?: FotoParaMontar; formato: FormatoMontado; titulo: string; pintar: boolean }) {
  const [hueco, setHueco] = useState<HTMLDivElement | null>(null);
  const tamano = useTamanoElemento(hueco);
  const { ancho, alto } = FORMATOS[formato === "story" ? "story" : "post"];
  const escala = tamano ? tamano.ancho / ancho : 0.3;
  return (
    <div ref={setHueco} className="relative w-full overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: `${ancho} / ${alto}` }}>
      {pintar && documento ? (
        <iframe
          title={titulo}
          sandbox="allow-same-origin"
          srcDoc={documento}
          width={ancho}
          height={alto}
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
          style={{ width: ancho, height: alto, transform: `scale(${escala})`, transformOrigin: "0 0" }}
        />
      ) : pintar && foto ? (
        <img src={foto.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
    </div>
  );
}

interface Props {
  marca: MarcaId;
  formato: FormatoMontado;
  diapositivas: DiapositivaMontada[];
  fotos: FotoParaMontar[];
  className?: string;
}

export function CarruselPrevia({ marca, formato, diapositivas, fotos, className }: Props) {
  const pista = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState(0);
  const porId = useMemo(() => new Map(fotos.map((f) => [f.id, f])), [fotos]);
  const documentos = useMemo(() => diapositivas.map((d) => documentoDiapositiva(marca, formato, d, porId.get(d.foto))), [diapositivas, marca, formato, porId]);
  const total = diapositivas.length;

  useEffect(() => {
    setActual((a) => Math.min(a, Math.max(0, total - 1)));
  }, [total]);

  /** Ancho de una imagen más el hueco (se asoma la siguiente: así se ve que se desliza). */
  const paso = () => {
    const el = pista.current;
    const a = el?.children[0] as HTMLElement | undefined;
    const b = el?.children[1] as HTMLElement | undefined;
    return a && b ? b.offsetLeft - a.offsetLeft : (el?.clientWidth ?? 0);
  };

  const alDeslizar = () => {
    const el = pista.current;
    const p = paso();
    if (!el || !p) return;
    setActual(Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / p))));
  };

  const irA = (i: number) => {
    const el = pista.current;
    setActual(i);
    if (el?.scrollTo) el.scrollTo({ left: i * paso(), behavior: "smooth" });
  };

  return (
    <section className={cn("flex flex-col gap-2", className)} aria-roledescription="carrusel" aria-label="Vista previa de la publicación">
      <div
        ref={pista}
        onScroll={alDeslizar}
        className={cn(
          "flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // 80 %: en un móvil de 360–390 px la imagen y el principio de «lo que ha entendido la IA» caben juntos.
          total > 1 ? "gap-2 px-[10%]" : "justify-center",
        )}
        data-testid="carrusel-previa"
      >
        {diapositivas.map((d, i) => (
          <div key={`${d.foto}-${i}`} className="w-[80%] shrink-0 snap-center" role="group" aria-roledescription="imagen" aria-label={`Imagen ${i + 1} de ${total}`}>
            <Diapositiva documento={documentos[i]} foto={porId.get(d.foto)} formato={formato} titulo={`Imagen ${i + 1} de ${total}`} pintar={Math.abs(i - actual) <= 1} />
          </div>
        ))}
      </div>
      {total > 1 && (
        <div className="flex items-center justify-center gap-1" aria-live="polite">
          <span className="sr-only">
            Imagen {actual + 1} de {total}
          </span>
          {diapositivas.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => irA(i)}
              aria-label={`Ver imagen ${i + 1}`}
              aria-current={i === actual}
              className="flex h-8 w-6 items-center justify-center"
            >
              <span className={cn("block h-2 w-2 rounded-full", i === actual ? "bg-foreground" : "bg-muted-foreground/40")} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
