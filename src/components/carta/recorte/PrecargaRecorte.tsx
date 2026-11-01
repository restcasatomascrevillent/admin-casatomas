import { useEffect } from "react";
import { useCanAccessSection } from "@/hooks/useUserRole";

/** Margen tras entrar al panel antes de empezar: primero, lo que pide la pantalla. */
export const ESPERA_PRECARGA_MS = 5_000;

/** Permiso de la carta sin exigir <UserRoleProvider> (en los tests de página no siempre lo hay). */
function usePuedeTocarCarta(): boolean {
  try {
    return useCanAccessSection("gestor_carta").canAccess;
  } catch {
    return false;
  }
}

/**
 * Al entrar al panel, quien puede tocar la carta deja bajando en segundo plano
 * el modelo del recorte de fotos («sticker» de platos, vinos, bebidas y
 * cócteles), para no esperar la descarga al añadir la primera foto. La
 * decisión de si toca (escritorio, sin ahorro de datos, aún no guardado) es de
 * `precargarRecorte`. El módulo del recorte se importa aquí bajo demanda para
 * no engordar el arranque del panel. No pinta nada.
 */
export function PrecargaRecorte() {
  const canAccess = usePuedeTocarCarta();

  useEffect(() => {
    if (!canAccess) return;
    let cancelado = false;
    let idle: number | undefined;
    const lanzar = () => {
      if (cancelado) return;
      void import("./quitarFondoNavegador")
        .then((m) => m.precargarRecorte())
        .catch(() => {
          /* sin precarga: se descargará al usarlo, como antes */
        });
    };
    const temporizador = window.setTimeout(() => {
      // Cuando el navegador esté desocupado (o, como mucho, 10 s después).
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(lanzar, { timeout: 10_000 });
      else lanzar();
    }, ESPERA_PRECARGA_MS);
    return () => {
      cancelado = true;
      window.clearTimeout(temporizador);
      if (idle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
    };
  }, [canAccess]);

  return null;
}
