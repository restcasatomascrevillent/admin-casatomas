import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LOGO_CASA_TOMAS } from "@/lib/cheques/casaTomas";
import { PLANTILLA_REGALO, type ChequeRegalo, type PlantillaRegalo } from "@/lib/cheques/regalo";

export function VistaChequeRegalo({ cheque, plantilla }: { cheque: ChequeRegalo; plantilla?: PlantillaRegalo }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [paginas, setPaginas] = useState<string[]>([]);
  useEffect(() => {
    let activo = true, objeto = "";
    setError(""); setUrl(""); setPaginas([]);
    const timer = window.setTimeout(() => { void (async () => {
      try {
        const { generarVistaRegalo } = await import("@/lib/cheques/chequeRegaloPdf");
        const vista = await generarVistaRegalo(cheque, { ...PLANTILLA_REGALO, ...cheque.plantilla_cheque, ...plantilla }, LOGO_CASA_TOMAS);
        if (!activo) return;
        objeto = URL.createObjectURL(new Blob([new Uint8Array(vista.pdf)], { type: "application/pdf" }));
        setUrl(objeto);
        setPaginas(vista.paginas.map(svg => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)));
      } catch { if (activo) setError("No se pudo generar la vista previa. Revisa el logo de la plantilla."); }
    })(); }, 250);
    return () => { activo = false; window.clearTimeout(timer); if (objeto) URL.revokeObjectURL(objeto); };
  }, [cheque, plantilla]);
  return <Card className="min-w-0 rounded-2xl overflow-hidden"><CardContent className="p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">Vista previa del cheque PDF</h3>{url && <Button asChild variant="outline" size="sm"><a href={url} download={`Cheque-${cheque.codigo}.pdf`}>Descargar PDF</a></Button>}</div>
    {error ? <p role="alert">{error}</p> : url ? <div role="region" aria-label="Vista previa del cheque regalo" tabIndex={0} className="max-h-[70dvh] overflow-y-auto rounded-lg border bg-muted/30 p-3 sm:p-4 space-y-4">
      {paginas.map((src, i) => <figure key={i} className="mx-auto w-full max-w-[46dvh]"><img src={src} alt={`Cheque regalo · página ${i + 1} de ${paginas.length}`} className="block w-full h-auto rounded-sm shadow-md" />{paginas.length > 1 && <figcaption className="mt-2 text-center text-xs text-muted-foreground">Página {i + 1} de {paginas.length}</figcaption>}</figure>)}
    </div> : <p role="status">Generando PDF…</p>}
  </CardContent></Card>;
}
