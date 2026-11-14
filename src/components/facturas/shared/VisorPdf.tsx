import { useEffect, useState } from "react";
import { ImageOff, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENLACE_ORIGINAL, VisorPantallaCompleta } from "./VisorPantallaCompleta";

/** Bytes del PDF: el Blob tal cual o, con una URL (firmada de Storage), descargándola. */
async function bytesPdf(fuente: Blob | string): Promise<ArrayBuffer> {
  if (typeof fuente !== "string") return fuente.arrayBuffer();
  const r = await fetch(fuente);
  if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
  return r.arrayBuffer();
}

/**
 * Un PDF del original, hoja a hoja, como imágenes (13/11/2026, «la factura en
 * PDF no se ve en el panel»). Lo pinta pdf.js en el navegador (ver
 * `src/lib/facturas/pintarPdf.ts`): no depende de que la CSP deje incrustar
 * PDFs y en el iPad se ven todas las hojas, no solo la primera. Tocar una hoja
 * la abre a pantalla completa con zoom.
 *
 * `fuente`: el Blob (el original de Drive que baja `facturas-original`) o la
 * URL firmada de Storage. Con un blob URL NO: `connect-src` no deja leerlo.
 */
export function VisorPdf({ fuente, titulo, className }: { fuente: Blob | string | undefined; titulo: string; className?: string }) {
  const [hojas, setHojas] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [listo, setListo] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  const [ampliada, setAmpliada] = useState<number | null>(null);

  useEffect(() => {
    if (!fuente) return;
    let cancelado = false;
    const propias: string[] = [];
    setHojas([]);
    setTotal(0);
    setListo(false);
    setFallo(false);
    setAmpliada(null);
    void (async () => {
      try {
        const datos = await bytesPdf(fuente);
        // pdf.js solo se descarga cuando hay un PDF que enseñar.
        const { pintarHojasPdf } = await import("@/lib/facturas/pintarPdf");
        if (cancelado) return;
        await pintarHojasPdf(datos, {
          cancelado: () => cancelado,
          alHoja: (url, _indice, n) => {
            if (cancelado) {
              URL.revokeObjectURL(url);
              return;
            }
            propias.push(url);
            setHojas((h) => [...h, url]);
            setTotal(n);
          },
        });
        if (!cancelado) setListo(true);
      } catch (e) {
        if (cancelado) return;
        console.error("[visor-pdf] no se pudo pintar el PDF:", e);
        setFallo(true);
      }
    })();
    return () => {
      cancelado = true;
      for (const u of propias) URL.revokeObjectURL(u);
    };
  }, [fuente, intento]);

  if (fallo) {
    return (
      <div role="status" className={cn("flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground", className)}>
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">No se ha podido enseñar el PDF aquí. Ábrelo con el enlace de arriba.</span>
        <button type="button" onClick={() => setIntento((n) => n + 1)} className={ENLACE_ORIGINAL}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  }

  const cargando = !listo;
  return (
    <div className={cn("flex min-h-0 flex-col gap-1", className)}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border bg-muted/40 p-2" data-testid="visor-pdf">
        {hojas.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setAmpliada(i)}
            aria-label={`Ampliar la hoja ${i + 1}${total > 1 ? ` de ${total}` : ""}`}
            className="block w-full cursor-zoom-in rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img src={url} alt={`${titulo} · hoja ${i + 1}`} className="block h-auto w-full bg-white shadow-sm" />
          </button>
        ))}
        {cargando && (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-busy="true">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {hojas.length === 0 ? "Cargando el PDF…" : `Cargando la hoja ${hojas.length + 1} de ${total}…`}
          </div>
        )}
        {listo && total > hojas.length && (
          <p className="px-1 text-xs text-muted-foreground">
            Se enseñan las {hojas.length} primeras hojas de {total}. Para ver el resto, ábrelo con el enlace de arriba.
          </p>
        )}
      </div>
      {hojas.length > 0 && <p className="shrink-0 text-xs text-muted-foreground">Toca una hoja para ampliarla.</p>}
      {ampliada !== null && hojas[ampliada] && (
        <VisorPantallaCompleta
          url={hojas[ampliada]}
          abierto
          onCerrar={() => setAmpliada(null)}
          titulo={`${titulo} · hoja ${ampliada + 1}`}
          conEnlace={false}
        />
      )}
    </div>
  );
}
