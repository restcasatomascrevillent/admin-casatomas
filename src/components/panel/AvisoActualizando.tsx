import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useEnLinea } from "@/hooks/useEnLinea";

/**
 * Más viejo que esto, lo que se ve es de «antes» (la copia del dispositivo, o de hace rato) y no de la
 * relectura periódica de siempre (30 s en el móvil, 60 s en escritorio): esas no avisan, para no parpadear.
 */
export const ANTIGUEDAD_AVISO_ACTUALIZANDO_MS = 90_000;

/** ¿Hay que decir «Actualizando…»? Con datos viejos que se están volviendo a pedir, y con red. */
export function debeAvisarActualizando(actualizadoEn: number, pidiendo: boolean, ahora: number = Date.now()): boolean {
  return pidiendo && actualizadoEn > 0 && ahora - actualizadoEn > ANTIGUEDAD_AVISO_ACTUALIZANDO_MS;
}

/**
 * «Actualizando… · datos de las HH:MM» (09/11/2026, «Hoy» con mala cobertura): al abrir el panel se pinta
 * al momento lo último que se vio en este dispositivo (`cacheOffline.ts`) y se vuelve a pedir. Mientras
 * llega, esta pastilla flotante (abajo, no mueve nada) dice que lo de la pantalla es de antes. Desaparece
 * en cuanto llega la respuesta. Sin red no sale: lo dice `AvisoSinConexion`.
 */
export function AvisoActualizando({ actualizadoEn, pidiendo }: { actualizadoEn: number; pidiendo: boolean }) {
  const enLinea = useEnLinea();
  if (!enLinea || !debeAvisarActualizando(actualizadoEn, pidiendo)) return null;
  return (
    <div
      role="status"
      data-testid="hoy-actualizando"
      className="pointer-events-none fixed bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span className="truncate">Actualizando… · datos de las {format(new Date(actualizadoEn), "HH:mm")}</span>
    </div>
  );
}
