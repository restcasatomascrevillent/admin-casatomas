import { lazy, Suspense, useState } from "react";
import { Printer } from "lucide-react";
import { BotonHerramientaCarta } from "../BotonHerramientaCarta";
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
 * «PDF Carta» (carta para imprimir en A5/A4) en la barra de acciones de Gestor Web › Carta
 * — texto corto a petición del dueño (05/11/2026: «el botón es muy grande») —
 * (platos y vinos). Solo lee la carta: lo ve quien ve la pestaña (permiso
 * «Gestor Web · Carta»), como el resto de la pestaña.
 */
export function BotonCartaImprimir({ tipo, platos, vinos, className }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [montado, setMontado] = useState(false);
  return (
    <>
      <BotonHerramientaCarta
        icono={<Printer />}
        etiqueta="PDF Carta"
        ayuda={tipo === "vinos" ? "Carta de vinos para imprimir: PDF en A5 o A4" : "Carta de platos para imprimir: PDF en A5 o A4"}
        className={className}
        onClick={() => {
          setMontado(true);
          setAbierto(true);
        }}
      />
      {montado && (
        <Suspense fallback={null}>
          <DialogoCartaImprimir abierto={abierto} onCambiarAbierto={setAbierto} tipo={tipo} platos={platos} vinos={vinos} />
        </Suspense>
      )}
    </>
  );
}
