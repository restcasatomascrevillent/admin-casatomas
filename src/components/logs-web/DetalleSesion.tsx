import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useSesion } from "@/hooks/useLogsWeb";
import { NOMBRE_DISPOSITIVO, NOMBRE_ORIGEN, DEFINICIONES } from "@/components/trafico-web/comportamiento/definiciones";
import { fmtDuracion, fmtFechaHora } from "./calculos";
import { LineaTiempo } from "./LineaTiempo";

interface DetalleSesionProps {
  sesionId: string | null;
  onCerrar: () => void;
  onAbrirIncidencia: (id: number) => void;
}

/** Recorrido de una sesión, de la entrada a la última actividad observada. */
export function DetalleSesion({ sesionId, onCerrar, onAbrirIncidencia }: DetalleSesionProps) {
  const q = useSesion(sesionId);
  const s = q.data?.sesion ?? null;
  return (
    <Sheet open={!!sesionId} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent side="right" className="w-full max-w-none sm:max-w-2xl" data-testid="detalle-sesion">
        <SheetHeader>
          <SheetTitle>Sesión {sesionId?.slice(0, 8)}</SheetTitle>
          <SheetDescription>
            Identificador seudónimo: no identifica a una persona. {s ? `De ${fmtFechaHora(s.inicio)} a ${fmtFechaHora(s.ultima_actividad)} (hora local).` : ""}
          </SheetDescription>
        </SheetHeader>
        {q.isError ? (
          <EstadoErrorCarga titulo="la sesión" error={q.error} onReintentar={() => q.refetch()} />
        ) : q.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
        ) : (
          <div className="mt-4 space-y-4">
            {s && (
              <>
                <TiraCifras
                  cifras={[
                    { etiqueta: "Entrada", valor: s.pagina_entrada ?? "—" },
                    { etiqueta: "Procedencia", valor: NOMBRE_ORIGEN[s.origen_tipo ?? "desconocido"] ?? s.origen_tipo ?? "—", detalle: s.campana ?? s.origen_detalle ?? undefined },
                    { etiqueta: "Duración", valor: fmtDuracion(Date.parse(s.ultima_actividad) - Date.parse(s.inicio)), detalle: `${fmtDuracion(s.tiempo_activo_ms)} activo` },
                    { etiqueta: "Páginas", valor: s.paginas_vistas, detalle: s.scroll_max != null ? `scroll máx. ${s.scroll_max} %` : undefined },
                    { etiqueta: "Conversiones", valor: s.conversiones },
                    { etiqueta: "Errores", valor: s.errores, tono: s.errores > 0 ? "rojo" : undefined },
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  {NOMBRE_DISPOSITIVO[s.dispositivo ?? "desconocido"] ?? s.dispositivo} · {s.navegador ?? "?"} · {s.so ?? "?"}
                  {s.idioma ? ` · idioma ${s.idioma}` : ""} · última página observada: {s.ultima_pagina ?? "—"} ({DEFINICIONES.ultimaPagina.split(":")[0].toLowerCase()})
                  {s.es_interno ? " · tráfico interno" : ""}{s.es_prueba ? " · prueba automática" : ""}{s.es_bot ? " · bot" : ""}
                </p>
              </>
            )}
            {!s && <p className="text-sm text-muted-foreground">Sin resumen de sesión (eventos de un navegador sin consentimiento: solo errores).</p>}
            <LineaTiempo eventos={q.data?.eventos ?? []} onAbrirIncidencia={onAbrirIncidencia} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
