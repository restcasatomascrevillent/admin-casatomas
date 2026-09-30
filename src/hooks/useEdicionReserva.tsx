// ============================================================================
// useEdicionReserva — lo que usan las vistas para abrir el editor de una reserva
// ----------------------------------------------------------------------------
//   const { editarReserva, dialogoEdicion } = useEdicionReserva();
//   …  <Button onClick={() => editarReserva(reserva.id)}>Editar</Button>
//   …  {dialogoEdicion}
//
// `editarReserva(id)` abre `EditarReservaDialog` para esa reserva; `dialogoEdicion`
// hay que pintarlo UNA vez en la vista (vale `null` mientras no se edita nada, y
// entonces no cuesta ni una consulta). Vive en un fichero aparte del diálogo para
// que éste exporte solo un componente (react-refresh) y porque es un hook que
// devuelve JSX, no un componente.
// ============================================================================
import { useCallback, useState } from "react";
import { EditarReservaDialog } from "@/components/reservas/EditarReservaDialog";

export function useEdicionReserva() {
  const [reservaId, setReservaId] = useState<string | null>(null);
  const editarReserva = useCallback((id: string) => setReservaId(id), []);
  const cerrar = useCallback(() => setReservaId(null), []);
  const dialogoEdicion = reservaId ? <EditarReservaDialog reservaId={reservaId} onClose={cerrar} /> : null;
  return { editarReserva, dialogoEdicion };
}
