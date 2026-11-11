// ============================================================================
// useAbrirAviso — qué pasa al tocar «Ver» en un aviso (11/11/2026, dueño: «en
// avisos le doy a ver una reserva y no me abre un modal con esa reserva»).
// ----------------------------------------------------------------------------
// El aviso de una reserva (nueva, cancelada…) abre SU ficha en un modal
// (`EditarReservaDialog`: datos, Verificar, Confirmar, Cancelar, editar) sin
// salir de donde se está. Sin permiso para editar reservas, o con cualquier otro
// aviso, se va a su origen como siempre (`rutaDeAviso`).
//   const { abrirAviso, abreFicha, dialogoAviso } = useAbrirAviso();
//   …  {dialogoAviso}   ← pintarlo UNA vez, fuera de cualquier popover que se cierre.
// ============================================================================
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { reservaDeAviso, rutaDeAviso } from "@/lib/avisos";

type AvisoAbrible = Parameters<typeof rutaDeAviso>[0];

export function useAbrirAviso() {
  const navigate = useNavigate();
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  const abreFicha = useCallback((n: AvisoAbrible) => puedeEditar && !!reservaDeAviso(n), [puedeEditar]);

  /** Abre la ficha de la reserva o va al origen. Devuelve qué ha hecho («ficha», «ruta» o nada). */
  const abrirAviso = useCallback(
    (n: AvisoAbrible): "ficha" | "ruta" | null => {
      const id = puedeEditar ? reservaDeAviso(n) : null;
      if (id) {
        editarReserva(id);
        return "ficha";
      }
      const ruta = rutaDeAviso(n);
      if (ruta) {
        navigate(ruta);
        return "ruta";
      }
      return null;
    },
    [puedeEditar, editarReserva, navigate],
  );

  return { abrirAviso, abreFicha, editarReserva, puedeEditarReservas: puedeEditar, dialogoAviso: dialogoEdicion };
}
