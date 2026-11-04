import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCheck, Info } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useHistorialAvisos } from "@/hooks/useHistorialAvisos";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { agruparPorDia, FILTROS_AVISOS, horaAviso, rutaDeAviso, TIPO_ICON, type FiltroAvisos } from "@/lib/avisos";
import { cn } from "@/lib/utils";

/** Suelo (px) del alto de la página: por debajo vuelve el scroll de página. */
const ALTURA_MINIMA_AVISOS = 380;

export default function Avisos() {
  const [filtro, setFiltro] = useState<FiltroAvisos>("todos");
  const { avisos, loading, cargandoMas, hayMas, error, cargarMas, marcarLeida, marcarTodasLeidas } =
    useHistorialAvisos(filtro);
  const navigate = useNavigate();
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_AVISOS);

  const abrir = (n: NotificacionDashboard) => {
    void marcarLeida(n.id);
    const ruta = rutaDeAviso(n);
    if (ruta) navigate(ruta);
  };

  const grupos = agruparPorDia(avisos);
  const haySinLeer = avisos.some((n) => !n.leida);

  return (
    <DashboardLayout>
      <div
        ref={setRaiz}
        className={`flex flex-col gap-3 ${alto ? "" : "h-[calc(100vh-6rem)] supports-[height:100dvh]:h-[calc(100dvh-6rem)]"}`}
        style={alto ? { height: alto } : undefined}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Avisos</h1>
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={() => void marcarTodasLeidas()}
            disabled={!haySinLeer}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Marcar todos como leídos
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2" role="group" aria-label="Filtrar avisos">
          {FILTROS_AVISOS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className={cn(
                "min-h-10 rounded-full border px-4 text-sm transition-colors",
                filtro === f.valor ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
              )}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border bg-card">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground" role="status">
              Cargando avisos…
            </p>
          ) : error ? (
            <p className="p-6 text-center text-sm text-destructive" role="alert">
              No se pudieron cargar los avisos. Inténtalo de nuevo más tarde.
            </p>
          ) : avisos.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No hay avisos.</p>
          ) : (
            <>
              {grupos.map((g) => (
                <section key={g.etiqueta} aria-label={g.etiqueta}>
                  <h2 className="sticky top-0 z-10 border-b bg-muted/80 px-4 py-1.5 text-xs font-semibold capitalize text-muted-foreground backdrop-blur">
                    {g.etiqueta}
                  </h2>
                  <ul className="divide-y">
                    {g.items.map((n) => {
                      const Icon = TIPO_ICON[n.tipo] || Info;
                      const ruta = rutaDeAviso(n);
                      return (
                        <li key={n.id} className={cn("flex items-stretch gap-1", !n.leida && "bg-primary/5")}>
                          <button
                            type="button"
                            className="flex min-h-12 min-w-0 flex-1 gap-3 p-3 text-left hover:bg-muted/50 disabled:cursor-default"
                            onClick={() => abrir(n)}
                            aria-label={`${n.titulo}${ruta ? " (abrir)" : ""}`}
                          >
                            <Icon
                              className={cn("mt-0.5 h-4 w-4 shrink-0", !n.leida ? "text-amber-500" : "text-muted-foreground")}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className={cn("block text-sm", !n.leida && "font-medium")}>{n.titulo}</span>
                              {n.mensaje && (
                                <span className="mt-0.5 block text-xs text-muted-foreground">{n.mensaje}</span>
                              )}
                              <span className="mt-1 block text-xs text-muted-foreground">{horaAviso(n.created_at)}</span>
                            </span>
                            {!n.leida && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Sin leer" />}
                          </button>
                          {!n.leida && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="my-auto mr-2 h-9 shrink-0 text-xs"
                              onClick={() => void marcarLeida(n.id)}
                              aria-label={`Marcar como leído: ${n.titulo}`}
                            >
                              Leído
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {hayMas && (
                <div className="p-3 text-center">
                  <Button variant="outline" className="h-11" onClick={() => void cargarMas()} disabled={cargandoMas}>
                    {cargandoMas ? "Cargando…" : "Cargar más"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
