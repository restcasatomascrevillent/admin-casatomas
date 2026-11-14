import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, Ticket } from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Button } from "@/components/ui/button";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { ListaTickets } from "@/components/peticiones/ListaTickets";
import { DetalleTicket } from "@/components/peticiones/DetalleTicket";
import { FILTROS_INICIALES, type FiltrosTickets } from "@/components/peticiones/utilidades";
import { useTickets } from "@/hooks/usePeticiones";

/**
 * Super Admin › Tickets (13/11/2026): las peticiones de los usuarios del panel con el análisis de la IA (qué
 * quieren, tarea propuesta y prompt para la IA). Enlace directo (aviso de la campana): ?ticket=<uuid>.
 * Ruta protegida por SuperAdminRoute; los datos, por la RLS (solo el super admin lee todas).
 */
export default function SuperAdminTickets() {
  const [params, setParams] = useSearchParams();
  const [filtros, setFiltros] = useState<FiltrosTickets>(FILTROS_INICIALES);
  const tickets = useTickets();
  const abierto = params.get("ticket");
  const seleccionado = abierto ? tickets.data?.find((t) => t.id === abierto) ?? null : null;
  const abrir = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set("ticket", id);
      else n.delete("ticket");
      return n;
    });

  return (
    <SuperAdminLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4" data-testid="tickets">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Ticket className="h-6 w-6 shrink-0 text-destructive sm:h-8 sm:w-8" aria-hidden="true" />
            <div>
              <h1 className="text-2xl font-bold">Tickets</h1>
              <p className="text-sm text-muted-foreground">Peticiones de los usuarios del panel, analizadas por la IA.</p>
            </div>
          </div>
          <Button variant="outline" className="h-11 gap-2" onClick={() => void tickets.refetch()} disabled={tickets.isFetching}>
            <RefreshCw className={tickets.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" /> Actualizar
          </Button>
        </header>

        {tickets.error ? (
          <EstadoErrorCarga titulo="los tickets" error={tickets.error} onReintentar={() => void tickets.refetch()} />
        ) : tickets.isLoading ? (
          <div className="flex justify-center py-10" role="status" aria-live="polite">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Cargando tickets…</span>
          </div>
        ) : (
          <ListaTickets tickets={tickets.data ?? []} filtros={filtros} onFiltros={setFiltros} onAbrir={abrir} />
        )}
      </div>
      <DetalleTicket peticion={seleccionado} onCerrar={() => abrir(null)} />
    </SuperAdminLayout>
  );
}
