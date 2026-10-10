import { createContext, useContext } from "react";
import type { ColaSubida, EstadoCola } from "@/lib/facturas/colaSubida";
import type { PendienteDecidir } from "@/lib/facturas/pendientesDecidir";
import type { Anadible, Esperado, Sustituible } from "@/lib/facturas/documentoLargo";

/**
 * Lo que publica <ColaSubidaProvider> (montado UNA vez en App.tsx, por encima
 * de las rutas): la cola de subida de facturas que sigue aunque se cambie de
 * pestaña o de sección, y los duplicados pendientes de decidir.
 */
export interface ContextoColaSubida {
  cola: ColaSubida;
  estado: EstadoCola;
  /** Documentos en marcha (en cola, subiendo, leyéndose en el servidor). */
  activos: number;
  pendientes: PendienteDecidir[];
  /** «Dejar la existente»: se olvida el pendiente en este navegador. */
  descartarPendiente: (trabajoId: string) => void;
  /** «Sustituir la existente» ya confirmado con lo que el usuario vio. Lanza si el servidor lo rechaza. */
  sustituir: (s: Sustituible, esperado?: Esperado) => Promise<void>;
  /** «Añadir como página x» ya confirmado. Lanza si el servidor lo rechaza. */
  anadirPagina: (a: Anadible, esperado?: Esperado) => Promise<void>;
}

/** Facturas → pestaña «Cargar» (indicador, toasts y campana llevan aquí). */
export const RUTA_CARGAR = "/facturas?tab=cargar";

export const ColaSubidaContext = createContext<ContextoColaSubida | null>(null);

/** `null` fuera del provider (tests de otras pantallas): quien lo use no pinta nada. */
export function useColaSubidaOpcional(): ContextoColaSubida | null {
  return useContext(ColaSubidaContext);
}

export function useColaSubida(): ContextoColaSubida {
  const c = useContext(ColaSubidaContext);
  if (!c) throw new Error("useColaSubida debe usarse dentro de <ColaSubidaProvider>");
  return c;
}
