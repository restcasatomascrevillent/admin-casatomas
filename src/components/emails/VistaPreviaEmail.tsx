// ============================================================================
// VistaPreviaEmail — renderiza el HTML real del correo (vía motorPlantilla,
// espejo del backend) dentro de un <iframe> aislado. Se usa un iframe en vez
// de dangerouslySetInnerHTML en la página: el HTML del correo trae sus
// propios estilos en línea pensados para clientes de correo, y mezclarlo con
// el CSS del panel (Tailwind) rompería ambos. El iframe también es la
// defensa en profundidad correcta aquí: aunque motorPlantilla ya escapa todo
// el texto del usuario, un iframe sandboxed no ejecutaría nada aunque algo
// se colara.
//
// sandbox="allow-same-origin" (NO "allow-scripts", NO vacío):
// - Sigue bloqueando scripts, formularios, popups y navegación top-level —
//   la única superficie que le interesa a la defensa en profundidad de
//   arriba — porque "allow-scripts" nunca se concede.
// - "allow-same-origin" es necesario para que el navegador PINTE el
//   contenido: con sandbox="" (sin ningún token) el iframe recibe un origen
//   opaco y, verificado en este mismo panel, Chromium deja el <iframe> en
//   blanco pese a que su `srcdoc` contiene HTML válido y no vacío (se
//   confirmó con un iframe de prueba con el mismo srcdoc: sin "sandbox" o
//   con "allow-same-origin" pinta bien; con sandbox="" no pinta nada). Esta
//   fue la causa real de la vista previa vacía reportada — no un problema
//   de datos ni del motor de renderizado.
// - allow-same-origin sin allow-scripts no reabre el riesgo de XSS: no hay
//   scripts que puedan aprovecharlo para quitarse el sandbox a sí mismos.
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
        sandbox="allow-same-origin"
        className="h-[640px] w-full border-0 bg-white"
      />
    </div>
  );
}
