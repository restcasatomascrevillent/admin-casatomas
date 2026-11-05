import { lazy, Suspense, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FilaPlato, FilaVino, TipoCartaImpresa } from "@/lib/carta-pdf/datos";

// El diálogo (maquetación, logos, fuentes y pdf-lib) solo se descarga al pulsar el botón.
const DialogoCartaImprimir = lazy(() => import("./DialogoCartaImprimir"));

interface Props {
  tipo: TipoCartaImpresa;
  platos?: readonly FilaPlato[];
  vinos?: readonly FilaVino[];
  className?: string;
}

/**
 * «Carta para imprimir (PDF A5/A4)» en la barra de acciones de Gestor Web › Carta
 * (platos y vinos). Solo lee la carta: lo ve quien ve la pestaña (permiso
 * «Gestor Web · Carta»), como el resto de la pestaña.
 */
export function BotonCartaImprimir({ tipo, platos, vinos, className }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [montado, setMontado] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("min-w-0 px-3 sm:px-4", className)}
        title={tipo === "vinos" ? "Carta de vinos para imprimir (PDF A5 o A4)" : "Carta de platos para imprimir (PDF A5 o A4)"}
        onClick={() => {
          setMontado(true);
          setAbierto(true);
        }}
      >
        <Printer className="mr-2 h-4 w-4 shrink-0" />
        <span className="truncate">Carta para imprimir (PDF A5/A4)</span>
      </Button>
      {montado && (
        <Suspense fallback={null}>
          <DialogoCartaImprimir abierto={abierto} onCambiarAbierto={setAbierto} tipo={tipo} platos={platos} vinos={vinos} />
        </Suspense>
      )}
    </>
  );
}
