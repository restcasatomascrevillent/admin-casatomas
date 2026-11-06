import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";

/**
 * Recortes de fotos fuera de los formularios:
 *   - las fotos que se guardaron sin fondo porque el móvil y el servidor
 *     fallaron pasan a un TRABAJO para un ordenador con el panel abierto
 *     (recorteEnOrdenador.ts; sin la migración 20261102160000, solo se avisa:
 *     «Quitar fondo» desde un ordenador);
 *   - al abrir el panel, detecta un recorte del móvil que se quedó a medias
 *     porque el sistema cerró la pestaña (marca sin latido): el móvil queda
 *     marcado y las siguientes fotos van directas al servidor;
 *   - el aviso «Hay N fotos pendientes de recortar · ¿Recortarlas aquí?» que
 *     salía en los ordenadores (AvisoTrabajosRecorte) se quitó el 06/11/2026 a
 *     petición del dueño: ya no se muestra. Esas fotos se recortan con «Quitar
 *     fondo» desde la ficha.
 * Los módulos del recorte se cargan bajo demanda (no engordan el arranque).
 */
export function GestorRecortes() {
  const { user } = useAuth();
  // Recortar y mandar trabajos escribe en la carta: hace falta «Editar» (06/11/2026).
  const { canAccess } = useCanAccessSection("gestor_carta", "edit");

  // Limpieza única: el antiguo «Diagnóstico recorte» (?diag=recorte) se retiró; se borra su marca.
  useEffect(() => {
    try {
      sessionStorage.removeItem("panel.diag.recorte");
    } catch {
      /* sin sessionStorage */
    }
  }, []);

  useEffect(() => {
    if (!user || !canAccess) return;
    let cancelar: (() => void) | undefined;
    let vivo = true;
    void Promise.all([import("./recorteEnSegundoPlano"), import("./recorteEnOrdenador")]).then(
      ([m, o]) => {
        if (!vivo) return;
        m.configurarAlNoRecortar(o.mandarRecorteAOrdenador);
        cancelar = m.recuperarRecorteInterrumpido();
      },
      // Sin estos módulos las fotos sin fondo solo se avisan (sin trabajo para un ordenador).
      (e) => console.warn("[recorte] no se pudo preparar el gestor de recortes", e),
    );
    return () => {
      vivo = false;
      cancelar?.();
    };
  }, [user, canAccess]);


  return null;
}
