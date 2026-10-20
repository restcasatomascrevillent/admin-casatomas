import { useEffect, useState } from "react";
import { hoyLocal } from "@/components/reservas/asignacionPlano";

/** Cada cuánto se comprueba si ya es otro día. */
export const INTERVALO_COMPROBAR_DIA_MS = 60_000;

/**
 * «Hoy» (`YYYY-MM-DD`, hora local) que CAMBIA a medianoche. La tablet del servicio se queda toda la
 * noche en «Hoy»: con un `useMemo(() => hoyLocal(), [])` seguía pidiendo las reservas de ayer hasta
 * recargar. Se comprueba cada minuto y al volver a la pestaña (tablet bloqueada); solo hay render
 * nuevo cuando de verdad cambia el día.
 */
export function useHoyLocal(): string {
  const [hoy, setHoy] = useState<string>(() => hoyLocal());
  useEffect(() => {
    const comprobar = () => setHoy((actual) => {
      const ahora = hoyLocal();
      return ahora === actual ? actual : ahora;
    });
    const id = window.setInterval(comprobar, INTERVALO_COMPROBAR_DIA_MS);
    document.addEventListener("visibilitychange", comprobar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", comprobar);
    };
  }, []);
  return hoy;
}
