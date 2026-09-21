// ============================================================================
// VistaPreviaEmail — renderiza el HTML real del correo (vía motorPlantilla,
// espejo del backend) dentro de un <iframe> aislado. Se usa un iframe con
// `sandbox=""` (el más restrictivo: sin scripts, sin same-origin, sin forms)
// en vez de dangerouslySetInnerHTML en la página: el HTML del correo trae
// sus propios estilos en línea pensados para clientes de correo, y mezclarlo
// con el CSS del panel (Tailwind) rompería ambos. El iframe también es la
// defensa en profundidad correcta aquí: aunque motorPlantilla ya escapa todo
// el texto del usuario, un iframe sandboxed no ejecutaría nada aunque algo
// se colara.
// ============================================================================
import { useMemo } from "react";
import { renderPlantilla, type FilaPlantilla } from "./motorPlantilla";
import { datosEjemploPara } from "./catalogoTokens";
import type { CamposEditablesPlantilla, TipoPlantilla } from "@/hooks/usePlantillasEmail";

interface VistaPreviaEmailProps {
  tipo: TipoPlantilla;
  campos: CamposEditablesPlantilla;
}

export function VistaPreviaEmail({ tipo, campos }: VistaPreviaEmailProps) {
  const { asunto, html } = useMemo(() => {
    const filaFicticia: FilaPlantilla = { tipo, version: 0, ...campos };
    return renderPlantilla(filaFicticia, datosEjemploPara(tipo));
  }, [tipo, campos]);

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <div className="space-y-1 border-b bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">Vista previa en vivo · datos de ejemplo</p>
        <p className="truncate text-sm font-medium">
          <span className="text-muted-foreground">Asunto: </span>
          {asunto || <span className="italic text-muted-foreground">(vacío)</span>}
        </p>
      </div>
      <iframe
        title={`Vista previa del correo — ${tipo}`}
        srcDoc={html}
        sandbox=""
        className="h-[640px] w-full border-0 bg-white"
      />
    </div>
  );
}
