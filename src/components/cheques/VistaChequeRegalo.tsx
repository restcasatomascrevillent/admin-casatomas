import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LOGO_CASA_TOMAS } from "@/lib/cheques/casaTomas";
import { PLANTILLA_REGALO, type ChequeRegalo, type PlantillaRegalo } from "@/lib/cheques/regalo";

export function VistaChequeRegalo({ cheque, plantilla }: { cheque: ChequeRegalo; plantilla?: PlantillaRegalo }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let activo = true, objeto = "";
    setError(""); setUrl("");
    const timer = window.setTimeout(() => { void (async () => {
      try {
        const { generarPdfRegalo } = await import("@/lib/cheques/chequeRegaloPdf");
        const bytes = await generarPdfRegalo(cheque, { ...PLANTILLA_REGALO, ...cheque.plantilla_cheque, ...plantilla }, LOGO_CASA_TOMAS);
        if (!activo) return;
        objeto = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
        setUrl(objeto);
      } catch { if (activo) setError("No se pudo generar la vista previa. Revisa el logo de la plantilla."); }
    })(); }, 250);
    return () => { activo = false; window.clearTimeout(timer); if (objeto) URL.revokeObjectURL(objeto); };
  }, [cheque, plantilla]);
  return <Card className="rounded-2xl overflow-hidden"><CardContent className="p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">Vista previa del cheque PDF</h3>{url && <Button asChild variant="outline" size="sm"><a href={url} download={`Cheque-${cheque.codigo}.pdf`}>Descargar PDF</a></Button>}</div>
    {error ? <p role="alert">{error}</p> : url ? <iframe title="Cheque regalo PDF" src={url + "#toolbar=0"} className="w-full h-[65dvh] min-h-80 rounded-lg border bg-[#faf7f1]" /> : <p role="status">Generando PDF…</p>}
  </CardContent></Card>;
}
