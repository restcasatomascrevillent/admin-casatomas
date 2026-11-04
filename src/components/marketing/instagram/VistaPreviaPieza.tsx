import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTamanoElemento } from "@/hooks/useAlturaDisponible";
import { FORMATOS, comprobarMaquetacion, esperarRecursos, type FormatoId } from "@/lib/instagram";
import { cn } from "@/lib/utils";

export interface ResultadoMaquetacion {
  errores: string[];
  avisos: string[];
}

interface Props {
  /** Documento HTML de la pieza (construirDocumento) o null si aún no se puede pintar. */
  documento: string | null;
  formato: FormatoId;
  /** Se llama tras cada carga con los errores/avisos de maquetación medidos en el iframe. */
  onMaquetacion?: (r: ResultadoMaquetacion) => void;
  /** Texto cuando no hay documento. */
  vacio?: string;
  className?: string;
}

/**
 * Vista previa EN VIVO: el mismo HTML que capturará el servidor, en un iframe
 * a tamaño real (1080×1350 o 1080×1920) escalado con `transform` para caber en
 * su hueco. `sandbox="allow-same-origin"` sin scripts: el panel puede medir el
 * documento (comprobarMaquetacion) pero el documento no ejecuta nada.
 * No recorta nada: si un texto no cabe, se avisa y se ve desbordado.
 */
export function VistaPreviaPieza({ documento, formato, onMaquetacion, vacio, className }: Props) {
  const [hueco, setHueco] = useState<HTMLDivElement | null>(null);
  const tamano = useTamanoElemento(hueco);
  const iframe = useRef<HTMLIFrameElement>(null);
  const carga = useRef(0);
  const [midiendo, setMidiendo] = useState(false);
  const avisar = useRef(onMaquetacion);
  avisar.current = onMaquetacion;

  const { ancho, alto } = FORMATOS[formato];
  // Sin medida (jsdom, primer pintado) se usa una escala razonable para una tablet.
  const escala = tamano ? Math.min(tamano.ancho / ancho, tamano.alto / alto) : 0.3;

  useEffect(() => {
    if (documento) setMidiendo(true);
  }, [documento]);

  const alCargar = async () => {
    const n = ++carga.current;
    const doc = iframe.current?.contentDocument;
    if (!doc || !documento) return;
    try {
      const fallos = await esperarRecursos(doc);
      if (n !== carga.current) return; // ya hay otra carga más nueva
      const avisos: string[] = [];
      const errores = comprobarMaquetacion(doc, formato, avisos);
      if (fallos.length) avisos.push("No han cargado algunas fuentes o fotos: la vista previa puede no ser exacta.");
      avisar.current?.({ errores, avisos });
    } catch (e) {
      if (n === carga.current) avisar.current?.({ errores: [], avisos: [`No se ha podido medir la vista previa: ${(e as Error).message}`] });
    } finally {
      if (n === carga.current) setMidiendo(false);
    }
  };

  return (
    <div ref={setHueco} className={cn("relative flex min-h-0 items-center justify-center", className)} data-testid="hueco-vista-previa">
      {documento ? (
        <div
          className="relative shrink-0 overflow-hidden rounded-md shadow-md ring-1 ring-border"
          style={{ width: Math.floor(ancho * escala), height: Math.floor(alto * escala) }}
        >
          <iframe
            ref={iframe}
            title={`Vista previa del ${formato === "story" ? "story" : "post"} (${ancho}×${alto})`}
            sandbox="allow-same-origin"
            srcDoc={documento}
            onLoad={alCargar}
            width={ancho}
            height={alto}
            tabIndex={-1}
            className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
            style={{ width: ancho, height: alto, transform: `scale(${escala})`, transformOrigin: "0 0" }}
          />
          {midiendo && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Midiendo
            </span>
          )}
        </div>
      ) : (
        <div
          className="flex items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
          style={{ width: Math.floor(ancho * escala), height: Math.floor(alto * escala) }}
        >
          {vacio ?? "Rellena el formulario para ver la pieza."}
        </div>
      )}
    </div>
  );
}
