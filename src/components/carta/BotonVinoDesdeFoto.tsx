import { useState } from "react";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VinoDesdeFoto } from "./leerVinoFoto";
import { LoteVinosDialog } from "./LoteVinosFoto";
import { useLoteVinos, type FilaLote } from "./useLoteVinos";

export type { DatosVinoFoto, VinoDesdeFoto } from "./leerVinoFoto";

interface Props {
  categorias: string[];
  onLeido: (resultado: VinoDesdeFoto) => void;
}

/**
 * «Varias botellas»: cola de fotos que se leen de 2 en 2; cada una se revisa y
 * guarda en VinoForm (precargado: no se vuelve a llamar a la IA). Nada se
 * guarda sin pasar por el formulario.
 *
 * La botella suelta ya no tiene botón propio (03/11/2026, dueño: un único
 * «Añadir vino»): el formulario lee la etiqueta con IA al poner la foto
 * (lecturaEtiquetaVino.ts).
 */
export function BotonVinoDesdeFoto({ categorias, onLeido }: Props) {
  const lote = useLoteVinos(categorias);
  const [loteAbierto, setLoteAbierto] = useState(false);
  // Fila cuyo formulario está abierto: el diálogo del lote se oculta mientras.
  const [filaEnForm, setFilaEnForm] = useState<string | null>(null);

  const abrirFila = (fila: FilaLote) => {
    if (!fila.resultado) return;
    setFilaEnForm(fila.id);
    onLeido({
      ...fila.resultado,
      alGuardar: () => lote.marcarGuardado(fila.id),
      alCerrar: () => setFilaEnForm(null),
    });
  };

  const enLote = lote.filas.length;

  return (
    <>
      <Button
        variant="outline"
        className="min-w-0 flex-1 px-3 sm:flex-none sm:px-4"
        onClick={() => setLoteAbierto(true)}
        title={enLote ? `Varias botellas (${enLote})` : "Varias botellas"}
      >
        <Images className="mr-2 h-4 w-4 shrink-0" />
        <span className="truncate">Varias botellas</span>
        {enLote > 0 && <span className="ml-1 shrink-0 tabular-nums">{`(${enLote})`}</span>}
      </Button>
      <LoteVinosDialog
        open={loteAbierto && filaEnForm === null}
        onOpenChange={setLoteAbierto}
        lote={lote}
        onAbrirFila={abrirFila}
      />
    </>
  );
}
