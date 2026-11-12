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

/**
 * «Pendientes» en amarillo chillón (12/11/2026, petición del dueño: «ponlo de color amarillo chillón pero bonito»):
 * fondo amarillo intenso con texto marrón muy oscuro (11:1, se lee perfecto) y el número en una píldora oscura.
 * Igual en la Lista, en la pestaña Reservas y en el móvil. `activo`: la Lista con «Pendientes» puesto (más intenso
 * y con anillo).
 */
export function clasesBotonPendientes(activo = false) {
  return cn(
    "border-yellow-400 bg-yellow-300 font-semibold text-yellow-950 shadow-sm hover:bg-yellow-400 hover:text-yellow-950",
    "dark:border-yellow-300 dark:bg-yellow-400 dark:text-yellow-950 dark:hover:bg-yellow-300",
    activo && "bg-yellow-400 ring-2 ring-yellow-600 ring-offset-1 ring-offset-background",
  );
}

/** El número de «Pendientes»: píldora oscura sobre el amarillo. */
export function clasesNumeroPendientes(_n: number, _activo = false) {
  return "min-w-6 rounded-full bg-yellow-950 px-1.5 text-sm font-semibold tabular-nums text-yellow-200";
}

export function BotonPendientes({
  onVerDia,
  compacto = false,
  className,
}: {
  onVerDia?: (fecha: string) => void;
  /** Móvil (12/11/2026): solo el reloj y el número, para caber junto a «Cerrar comida / Cerrar cena». */
  compacto?: boolean;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const pendientes = useReservasPorEstado("pendiente");
  const n = pendientes.data?.length ?? 0;
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("touch-hit h-11 text-base", clasesBotonPendientes(), compacto ? "gap-1.5 px-2.5" : "gap-2", className)}
        aria-haspopup="dialog"
        aria-label={compacto ? `Pendientes: ${n}` : undefined}
        title={compacto ? "Pendientes de verificar" : undefined}
        onClick={() => setAbierto(true)}
        data-testid="boton-pendientes"
      >
        <Clock className="h-4 w-4" aria-hidden="true" />
        {!compacto && "Pendientes"}
        <span className={clasesNumeroPendientes(n)}>{n}</span>
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Pendientes de verificar</DialogTitle>
            <DialogDescription>Desde hoy. «Verificar» la verifica y avisa al cliente; toca la reserva para ver su ficha, cancelarla o editarla.</DialogDescription>
          </DialogHeader>
          <ResultadosLista
            sinMarco
            conVerificar
            titulo="Pendientes de verificar"
            reservas={pendientes.data}
            cargando={pendientes.isLoading}
            error={pendientes.isError}
            onReintentar={() => void pendientes.refetch()}
            vacio="No hay reservas pendientes de verificar."
            conTelefono
            onAbrir={editarReserva}
            onVerDia={
              onVerDia
                ? (fecha) => {
                    setAbierto(false);
                    onVerDia(fecha);
                  }
                : undefined
            }
          />
        </DialogContent>
      </Dialog>
      {dialogoEdicion}
    </>
  );
}
