// ============================================================================
// Aviso de la sala privada (el Reservado) — pestaña «Hoy» y Dashboard
// ----------------------------------------------------------------------------
// El Reservado está FUERA DE AFORO (decisión del dueño, 2026-10-03: «no se tenga
// en cuenta en los aforos [...] pero que sepamos que está»): no suma capacidad ni
// sus reservas entran en las cifras de ocupación, comensales y %. Este aviso es
// lo que le dice al personal si está ocupado: «Reservado: ocupado — García, 8 pax
// (comida)» o «Reservado: libre». Va SIEMPRE aparte de las cifras de aforo.
// La lógica (qué sala, qué reserva, el texto) vive en `lib/reservas/salaPrivada.ts`.
// No es interactivo: nada que pulsar, así que no necesita áreas táctiles.
// ============================================================================

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { textoAvisoSalaPrivada, type AvisoSalaPrivada } from "@/lib/reservas/salaPrivada";
import { EtiquetaFueraDeAforo } from "./EtiquetaFueraDeAforo";

export function AvisoSalasPrivadas({
  avisos,
  className,
}: {
  avisos: readonly AvisoSalaPrivada[];
  className?: string;
}) {
  if (avisos.length === 0) return null;
  return (
    <section
      aria-label="Salas privadas, fuera de aforo"
      data-testid="aviso-sala-privada"
      className={cn(
        "space-y-1 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900 dark:bg-violet-950/20",
        className,
      )}
    >
      {avisos.map((aviso) => (
        <p
          key={aviso.espacioId}
          data-ocupada={aviso.ocupada ? "true" : "false"}
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          <Lock className="h-3.5 w-3.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
          <span className={cn("min-w-0 break-words", aviso.ocupada ? "font-medium" : "text-muted-foreground")}>
            {textoAvisoSalaPrivada(aviso)}
          </span>
          <EtiquetaFueraDeAforo />
        </p>
      ))}
    </section>
  );
}
