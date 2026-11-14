import { useMemo } from "react";
import { AlertTriangle, Bot, Camera, ChevronRight, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Peticion } from "@/lib/peticiones";
import { ESTADOS, MODULOS_PETICION, PRIORIDADES, etiquetaModulo } from "../../../supabase/functions/_shared/peticiones";
import { BadgeEstado, BadgePrioridad } from "./EtiquetasPeticion";
import { FILTROS_INICIALES, autorDe, autores, fechaCorta, filtrarTickets, type FiltrosTickets } from "./utilidades";

const SELECT = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

interface Props {
  tickets: Peticion[];
  filtros: FiltrosTickets;
  onFiltros: (f: FiltrosTickets) => void;
  onAbrir: (id: string) => void;
}

function EstadoIa({ p }: { p: Peticion }) {
  if (p.analisis_estado === "hecho") return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Bot className="h-3.5 w-3.5" aria-hidden="true" /> Analizada</span>;
  if (p.analisis_estado === "error") return <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Análisis fallido</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Analizando</span>;
}

/** Super Admin › Tickets: filtros (estado, prioridad, módulo, usuario) y la lista. */
export function ListaTickets({ tickets, filtros, onFiltros, onAbrir }: Props) {
  const visibles = useMemo(() => filtrarTickets(tickets, filtros), [tickets, filtros]);
  const personas = useMemo(() => autores(tickets), [tickets]);
  const poner = <K extends keyof FiltrosTickets>(k: K, v: FiltrosTickets[K]) => onFiltros({ ...filtros, [k]: v });
  const conFiltros = JSON.stringify(filtros) !== JSON.stringify(FILTROS_INICIALES);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Filtrar tickets">
        <label className="min-w-0 space-y-1 text-sm">
          <span className="font-medium">Estado</span>
          <select className={SELECT} value={filtros.estado} onChange={(e) => poner("estado", e.target.value as FiltrosTickets["estado"])} aria-label="Estado">
            <option value="abiertas">Abiertas</option>
            <option value="todas">Todas</option>
            {ESTADOS.map((e) => <option key={e.valor} value={e.valor}>{e.etiqueta}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="font-medium">Prioridad</span>
          <select className={SELECT} value={filtros.prioridad} onChange={(e) => poner("prioridad", e.target.value as FiltrosTickets["prioridad"])} aria-label="Prioridad">
            <option value="todas">Todas</option>
            {PRIORIDADES.map((p) => <option key={p.valor} value={p.valor}>{p.etiqueta}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="font-medium">Módulo</span>
          <select className={SELECT} value={filtros.modulo} onChange={(e) => poner("modulo", e.target.value)} aria-label="Módulo">
            <option value="todos">Todos</option>
            {MODULOS_PETICION.map((m) => <option key={m.clave} value={m.clave}>{m.etiqueta}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="font-medium">Usuario</span>
          <select className={SELECT} value={filtros.usuario} onChange={(e) => poner("usuario", e.target.value)} aria-label="Usuario">
            <option value="todos">Todos</option>
            {personas.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span aria-live="polite">{visibles.length === 1 ? "1 ticket" : `${visibles.length} tickets`}</span>
        {conFiltros && <Button variant="ghost" className="h-11" onClick={() => onFiltros(FILTROS_INICIALES)}>Quitar filtros</Button>}
      </div>

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="sin-tickets">
          <Inbox className="h-8 w-8" aria-hidden="true" />
          {tickets.length === 0 ? "Aún no ha llegado ninguna petición." : "Ningún ticket con estos filtros."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Tickets">
          {visibles.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onAbrir(t.id)}
                className="flex w-full min-h-12 items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="ticket"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-semibold" data-testid="titulo-ticket">{t.titulo}</span>
                    {t.captura_path && <Camera className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="con captura" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <BadgePrioridad prioridad={t.prioridad} />
                    <BadgeEstado estado={t.estado} />
                    <span>{etiquetaModulo(t.modulo)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{autorDe(t)}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={t.created_at}>{fechaCorta(t.created_at)}</time>
                    <EstadoIa p={t} />
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
