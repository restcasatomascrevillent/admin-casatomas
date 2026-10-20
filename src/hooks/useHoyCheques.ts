import { useEffect, useState } from "react";
import { hoyMadrid } from "@/lib/cheques/caducidad";

/** Actualiza los estados si el panel queda abierto durante el cambio de día. */
export function useHoyCheques() {
  const [hoy, setHoy] = useState(() => hoyMadrid());
  useEffect(() => {
    const actualizar = () => setHoy(hoyMadrid());
    const timer = window.setInterval(actualizar, 30_000);
    document.addEventListener("visibilitychange", actualizar);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", actualizar); };
  }, []);
  return hoy;
}
