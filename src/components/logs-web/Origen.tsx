/**
 * Super Admin › Logs: el ORIGEN de cada error en colores (petición del dueño,
 * 14/11/2026: «diferencia entre error web, error que no depende de la web,
 * diferentes colores y se tratan diferente»).
 *   · Rojo   → Fallo de la web: hay que arreglarlo; cuenta en la pestaña y puede abrir ticket.
 *   · Ámbar  → Servicio externo (Google Maps, Instagram, Stripe, OpenAI…): se cuenta aparte.
 *   · Gris   → No depende de la web (conexión, navegador o extensión, versión antigua, bots y pruebas).
 * Los textos salen de supabase/functions/_shared/logs-web/origen.ts (los mismos que el ticket).
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FiltroOrigen } from "@/hooks/useLogsWeb";
import {
  explicacionOrigen,
  grupoDeOrigen,
  NOMBRE_GRUPO_ORIGEN,
  type GrupoOrigen,
  type OrigenVisible,
} from "../../../supabase/functions/_shared/logs-web/origen";
import { ESTILO_GRUPO, estiloDe, etiquetaOrigen } from "./origenEstilos";

export function BadgeOrigen({ origen, proveedor, className }: { origen: OrigenVisible; proveedor?: string | null; className?: string }) {
  return (
    <Badge variant="outline" className={cn("shrink-0 whitespace-nowrap font-medium", estiloDe(origen).insignia, className)}
      data-testid="badge-origen" data-origen={origen} data-grupo={grupoDeOrigen(origen)}>
      {etiquetaOrigen(origen, proveedor)}
    </Badge>
  );
}

/** Cabecera del detalle: el color, el nombre y una línea en llano de qué es y qué hacer. */
export function AvisoOrigen({ origen, proveedor }: { origen: OrigenVisible; proveedor?: string | null }) {
  return (
    <section className={cn("flex flex-wrap items-start gap-2 rounded-md border p-3 text-sm", estiloDe(origen).bloque)} data-testid="aviso-origen" data-origen={origen}>
      <BadgeOrigen origen={origen} proveedor={proveedor} />
      <p className="min-w-0 flex-1 basis-60">{explicacionOrigen(origen, proveedor)}</p>
    </section>
  );
}

const LEYENDA: Array<{ grupo: GrupoOrigen; texto: string }> = [
  { grupo: "web", texto: "hay que arreglarlo; cuenta en el número de la pestaña y puede abrir ticket en Linear." },
  { grupo: "externo", texto: "falla un servicio de fuera (Google Maps, Instagram, Stripe, OpenAI…); se cuenta aparte y no abre ticket salvo que lo actives en Configuración." },
  { grupo: "no_depende", texto: "conexión del visitante, su navegador o extensiones, versión antigua que se arregló sola, bots y pruebas. No hay que hacer nada ni abre tickets." },
];

/** Qué significa cada color (corta, siempre a la vista encima de la lista). */
export function LeyendaOrigen() {
  return (
    <ul className="grid gap-1 text-xs text-muted-foreground md:grid-cols-3 md:gap-3" data-testid="leyenda-origen" aria-label="Qué significa cada color">
      {LEYENDA.map((l) => (
        <li key={l.grupo} className="flex items-start gap-1.5">
          <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", ESTILO_GRUPO[l.grupo].punto)} aria-hidden />
          <span><strong className="font-semibold text-foreground">{NOMBRE_GRUPO_ORIGEN[l.grupo]}:</strong> {l.texto}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Cuántas hay de cada color con los filtros actuales. Cada botón filtra por su
 * grupo (y vuelve al de siempre si ya estaba elegido).
 */
export function ResumenOrigenes({ conteos, filtro, onFiltro }: {
  conteos: Record<GrupoOrigen, number>;
  filtro: FiltroOrigen | null;
  onFiltro: (f: FiltroOrigen | null) => void;
}) {
  const grupos: GrupoOrigen[] = ["web", "externo", "no_depende"];
  return (
    <div className="flex flex-wrap gap-2" data-testid="resumen-origenes" role="group" aria-label="Incidencias por origen">
      {grupos.map((g) => {
        const activo = filtro === g;
        return (
          <button key={g} type="button" aria-pressed={activo} data-testid={`conteo-${g}`}
            onClick={() => onFiltro(activo ? "web_externos" : g)}
            className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm transition-colors hover:opacity-90",
              ESTILO_GRUPO[g].insignia, activo && "ring-2 ring-ring ring-offset-1")}>
            <span className={cn("h-2.5 w-2.5 rounded-full", ESTILO_GRUPO[g].punto)} aria-hidden />
            {NOMBRE_GRUPO_ORIGEN[g]}: <strong className="tabular-nums">{conteos[g]}</strong>
          </button>
        );
      })}
    </div>
  );
}
