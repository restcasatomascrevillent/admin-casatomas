import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { useReservasPorEstado } from "@/hooks/useBusquedaReservas";
import { ResultadosLista } from "./ResultadosLista";

// ============================================================================
// «Pendientes» en la pestaña Reservas (12/11/2026, petición del dueño: «pon el
// botón de pendientes también en la pestaña de reservas, mismo comportamiento
// que el de Lista»). El mismo número y la misma lista que en la Lista: las
// reservas pendientes de verificar de hoy en adelante, por día. Tocar una abre
// su ficha (Verificar, Confirmar, Cancelar); «Ver el día» lleva a ese día.
// En la pestaña Reservas la lista va en un diálogo, encima del plano.
// ============================================================================

/** Clases del número de «Pendientes»: ámbar si hay alguna, gris si no. Las comparten la Lista y la pestaña Reservas. */
export function clasesNumeroPendientes(n: number, activo = false) {
  return cn(
    "min-w-6 rounded-full px-1.5 text-sm font-semibold tabular-nums",
    activo ? "bg-primary-foreground/20" : n ? "bg-status-pending text-status-pending-foreground" : "bg-muted text-muted-foreground",
  );
}

export function BotonPendientes({ onVerDia, className }: { onVerDia?: (fecha: string) => void; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const pendientes = useReservasPorEstado("pendiente");
  const n = pendientes.data?.length ?? 0;
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("touch-hit h-11 gap-2 text-base", className)}
        aria-haspopup="dialog"
        onClick={() => setAbierto(true)}
        data-testid="boton-pendientes"
      >
        <Clock className="h-4 w-4" aria-hidden="true" /> Pendientes
        <span className={clasesNumeroPendientes(n)}>{n}</span>
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Pendientes de verificar</DialogTitle>
            <DialogDescription>Desde hoy. Toca una reserva para verificarla, confirmarla, cancelarla o editarla.</DialogDescription>
          </DialogHeader>
          <ResultadosLista
            sinMarco
            titulo="Pendientes de verificar"
            reservas={pendientes.data}
            cargando={pendientes.isLoading}
            error={pendientes.isError}
            onReintentar={() => void pendientes.refetch()}
            vacio="No hay reservas pendientes de verificar."
            conTelefono
            onAbrir={editarReserva}
            onVerDia={(fecha) => {
              setAbierto(false);
              onVerDia?.(fecha);
            }}
          />
        </DialogContent>
      </Dialog>
      {dialogoEdicion}
    </>
  );
}
