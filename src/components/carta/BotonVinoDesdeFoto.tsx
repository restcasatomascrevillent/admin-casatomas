import { useState } from "react";
import { Images } from "lucide-react";
import { BotonHerramientaCarta } from "./BotonHerramientaCarta";
import type { VinoDesdeFoto } from "./leerVinoFoto";
import { LoteVinosDialog } from "./LoteVinosFoto";
import { useLoteVinos, type FilaLote } from "./useLoteVinos";

export type { DatosVinoFoto, VinoDesdeFoto } from "./leerVinoFoto";

interface Props {
  categorias: string[];
  onLeido: (resultado: VinoDesdeFoto) => void;
  className?: string;
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
export function BotonVinoDesdeFoto({ categorias, onLeido, className }: Props) {
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
      <BotonHerramientaCarta
        icono={<Images />}
        etiqueta="Varias botellas"
        etiquetaCorta="Botellas"
        nombreAccesible={enLote ? `Varias botellas (${enLote})` : "Varias botellas"}
        ayuda="Añade varios vinos seguidos: una foto de cada etiqueta y los revisas después"
        extra={enLote > 0 ? <span aria-hidden="true" className="-ml-1 shrink-0 tabular-nums">{`(${enLote})`}</span> : null}
        className={className}
        onClick={() => setLoteAbierto(true)}
      />
      <LoteVinosDialog
        open={loteAbierto && filaEnForm === null}
        onOpenChange={setLoteAbierto}
        lote={lote}
        onAbrirFila={abrirFila}
      />
    </>
  );
}
