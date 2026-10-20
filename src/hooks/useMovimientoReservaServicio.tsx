// ============================================================================
// MOVER UNA RESERVA DE SALA DESDE EL SERVICIO — la lógica y los avisos
// ----------------------------------------------------------------------------
// Sacado de `GestorReservasKanban.tsx` (04/10/2026) para que lo compartan el
// kanban de «Hoy» (arrastrar y «⋮ → Mover a…») y el desplegable de la sala privada
// (`AvisoSalasPrivadas`, que ya no tiene columna propia en el kanban y por eso
// necesita su propio «Mover a…»). Comportamiento idéntico al que tenía el kanban:
//
//   1. `evaluarMovimiento` decide: sin cambio (nada), bloqueado (aviso; p. ej. la
//      sala privada ya ocupada en ese turno) o ok / excede aforo.
//   2. Si se pasaría de aforo o la reserva tiene mesas (el trigger de la BD las
//      BORRA al cambiar de sala) se pide confirmación antes de mover.
//   3. Tras mover a una sala se abre el mapa de esa sala (`ElegirMesaDialog`) para
//      elegirle la mesa; «Dar mesa» lo abre sin mover nada.
//
// Devuelve `dialogos`: los diálogos de confirmación y del mapa, que quien lo use
// tiene que pintar (fuera de cualquier `DndContext`).
// ============================================================================
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ElegirMesaDialog } from "@/components/reservas/ElegirMesaDialog";
import type { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { TEXTO_CAMBIO_INTERNO, textoQuitarMesas } from "@/lib/reservas/asignacionMesas";
import { SIN_ASIGNAR, columnaDeReserva, esSinAsignar, type Columna } from "@/lib/reservas/columnasServicio";
import { evaluarMovimiento, type ReservaServicio } from "@/lib/reservas/servicioSala";

type Acciones = ReturnType<typeof useAccionesServicioReserva>;

/** `asignaciones_mesa` de un día → nombres de las mesas de cada reserva (ordenados). */
export function mesasPorReservaDe(
  asignaciones: ReadonlyArray<{ reserva_id?: string | null; mesas?: { nombre?: string | null } | null }> | null | undefined,
): Map<string, string[]> {
  const porReserva = new Map<string, string[]>();
  for (const a of asignaciones ?? []) {
    if (!a?.reserva_id) continue;
    porReserva.set(a.reserva_id, [...(porReserva.get(a.reserva_id) ?? []), a.mesas?.nombre ?? ""]);
  }
  for (const nombres of porReserva.values()) {
    nombres.sort((x, y) => x.localeCompare(y, "es", { numeric: true }));
  }
  return porReserva;
}

/**
 * Un movimiento que se confirma antes de hacerlo. Hay DOS motivos para preguntar y
 * pueden darse a la vez (entonces sale un solo aviso con los dos):
 *   · `excede`: la sala de destino se pasaría de aforo en ese turno.
 *   · `mesas`: la reserva tiene mesas asignadas y el trigger de la BD
 *     (`trg_reservas_sincronizar_asignaciones`) las BORRA al cambiar la sala.
 */
interface MovimientoPendiente {
  reserva: ReservaServicio;
  destinoId: string | null;
  destinoNombre: string;
  excede: { ocupacionTras: number; capacidad: number; turno: "comida" | "cena" } | null;
  mesas: { nombres: string[]; salaActual: string | null } | null;
}

export function useMovimientoReservaServicio({
  acciones,
  columnas,
  reservas,
  mesasPorReserva,
  fecha,
}: {
  acciones: Acciones;
  /** TODAS las columnas posibles como destino, privadas incluidas (no solo las que se pintan). */
  columnas: readonly Columna[];
  /** Reservas del día (para el aforo y la sala privada ya ocupada). */
  reservas: ReservaServicio[];
  mesasPorReserva: ReadonlyMap<string, string[]>;
  fecha: string;
}): {
  solicitarMovimiento: (reserva: ReservaServicio, columnaId: string) => void;
  darMesa: (reserva: ReservaServicio) => void;
  dialogos: ReactNode;
} {
  const [movimientoPendiente, setMovimientoPendiente] = useState<MovimientoPendiente | null>(null);
  // La reserva que se acaba de mover y la sala a la que ha ido: tras guardarse el cambio se abre el
  // mapa de esa sala para elegirle la mesa (`ElegirMesaDialog`). `null` hasta que se mueve algo.
  const [mapaMesa, setMapaMesa] = useState<{ reserva: ReservaServicio; espacioId: string; espacioNombre: string } | null>(null);
  const cerrarMapaMesa = useCallback(() => setMapaMesa(null), []);

  /**
   * Hace el movimiento (ya confirmado, si hacía falta) y, SOLO si se ha guardado, abre el mapa de la
   * sala de destino para elegirle la mesa. Los dos caminos de mover (arrastrar y «Mover a…») y las
   * dos confirmaciones (aforo y mesas) acaban aquí.
   *
   * «Sin asignar» no tiene plano y no se abre nada. Con una sala, `ElegirMesaDialog` comprueba por su
   * cuenta que tenga mesas (por id de sala, nunca por nombre): si no las tiene no pinta nada y se cierra sin ruido.
   */
  const moverYElegirMesa = async (reserva: ReservaServicio, destinoId: string | null, destinoNombre: string) => {
    const movida = await acciones.moverEspacio(reserva, destinoId, destinoNombre);
    // Una sola reserva a la vez: si ya había un mapa abierto, éste lo sustituye (no se apilan).
    if (movida && destinoId) setMapaMesa({ reserva, espacioId: destinoId, espacioNombre: destinoNombre });
  };

  const solicitarMovimiento = (reserva: ReservaServicio, columnaId: string) => {
    const destinoId = esSinAsignar(columnaId) ? null : columnaId;
    const col = columnas.find((c) => c.id === columnaId);
    // Sala privada (el Reservado): una reserva se la queda entera; si ya hay otra en ese turno, se avisa aquí
    // en vez de dejar que la BD lo rechace (23514 «Sala privada ocupada»).
    const evaluacion = evaluarMovimiento(
      reserva,
      destinoId,
      reservas,
      col?.capacidadMax,
      col?.privada ? { nombre: col.title } : null,
    );

    switch (evaluacion.tipo) {
      case "sin_cambio":
        return;
      case "bloqueado":
        toast.error(evaluacion.motivo);
        return;
      case "excede_capacidad":
      case "ok": {
        const destinoNombre = col?.title ?? "Sin asignar";
        const excede =
          evaluacion.tipo === "excede_capacidad"
            ? { ocupacionTras: evaluacion.ocupacionTras, capacidad: evaluacion.capacidad ?? 0, turno: evaluacion.turno }
            : null;
        const nombresMesas = mesasPorReserva.get(reserva.id);
        const mesas = nombresMesas
          ? {
              nombres: nombresMesas,
              salaActual: columnas.find((c) => c.id === columnaDeReserva(reserva, columnas))?.title ?? null,
            }
          : null;
        if (!excede && !mesas) {
          void moverYElegirMesa(reserva, destinoId, destinoNombre);
          return;
        }
        setMovimientoPendiente({ reserva, destinoId, destinoNombre, excede, mesas });
      }
    }
  };

  /** «Dar mesa» desde el menú de la tarjeta: abre el plano de su sala (como tras moverla). */
  const darMesa = (reserva: ReservaServicio) => {
    const espacioId = columnaDeReserva(reserva, columnas);
    if (espacioId === SIN_ASIGNAR) return;
    setMapaMesa({ reserva, espacioId, espacioNombre: columnas.find((c) => c.id === espacioId)?.title ?? "Sin asignar" });
  };

  const dialogos = (
    <>
      <AlertDialog open={!!movimientoPendiente} onOpenChange={(open) => !open && setMovimientoPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* Si se pasa de aforo manda ese aviso (el de siempre); si solo hay mesas
                que se van a quitar, el mismo aviso que el panel de Asignación. */}
            <AlertDialogTitle>
              {movimientoPendiente?.excede
                ? `¿Superar la capacidad de ${movimientoPendiente.destinoNombre}?`
                : "¿Cambiar de sala y quitar sus mesas?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {movimientoPendiente?.excede && (
                  <p>
                    {`Con la reserva de ${movimientoPendiente.reserva.nombre || "este cliente"} (${movimientoPendiente.reserva.numero_comensales} pax), el turno de ${movimientoPendiente.excede.turno === "comida" ? "comida" : "cena"} de ${movimientoPendiente.destinoNombre} quedaría en ${movimientoPendiente.excede.ocupacionTras} de ${movimientoPendiente.excede.capacidad} plazas.`}
                  </p>
                )}
                {movimientoPendiente?.mesas && (
                  <>
                    <p>
                      {textoQuitarMesas({
                        nombre: movimientoPendiente.reserva.nombre,
                        cantidad: movimientoPendiente.mesas.nombres.length,
                        mesasNombres: movimientoPendiente.mesas.nombres,
                        salaActual: movimientoPendiente.mesas.salaActual,
                        destinoNombre: movimientoPendiente.destinoNombre,
                      })}
                    </p>
                    <p>{TEXTO_CAMBIO_INTERNO}</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No mover</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const m = movimientoPendiente;
                setMovimientoPendiente(null);
                if (m) void moverYElegirMesa(m.reserva, m.destinoId, m.destinoNombre);
              }}
            >
              {movimientoPendiente?.excede ? "Mover igualmente" : "Cambiar de sala"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tras mover una reserva a una sala con plano: el mapa de esa sala, con la reserva ya señalada,
          para elegirle la mesa. «Ahora no» (o cerrar) la deja en la sala, sin mesa. */}
      {mapaMesa && (
        <ElegirMesaDialog
          key={`${mapaMesa.reserva.id}|${mapaMesa.espacioId}`}
          reserva={mapaMesa.reserva}
          fecha={fecha}
          espacioId={mapaMesa.espacioId}
          espacioNombre={mapaMesa.espacioNombre}
          onCerrar={cerrarMapaMesa}
        />
      )}
    </>
  );

  return { solicitarMovimiento, darMesa, dialogos };
}
