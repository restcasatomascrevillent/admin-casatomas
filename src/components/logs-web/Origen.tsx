/**
 * Super Admin › Logs: el ORIGEN de cada error en colores (petición del dueño,
 * 14/11/2026: «diferencia entre error web, error que no depende de la web,
 * diferentes colores y se tratan diferente»).
 *   · Rojo   → Fallo nuestro, separado según DÓNDE falla (18/11/2026): «Fallo de
 *              la web» (lo que usan los clientes) o «Fallo del admin» (el panel
 *              y sus tareas automáticas). Hay que arreglarlo; cuenta en la
 *              pestaña y puede abrir ticket.
 *   · Ámbar  → Servicio externo (Google Maps, Instagram, Stripe, OpenAI…): se cuenta aparte.
 *   · Gris   → No depende de la web (conexión, navegador o extensión, versión antigua, bots y pruebas).
 * Los textos salen de supabase/functions/_shared/logs-web/origen.ts y ambito.ts (los mismos que el ticket).
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FiltroOrigen, GrupoConteo } from "@/hooks/useLogsWeb";
import { grupoDeOrigen, NOMBRE_GRUPO_ORIGEN, type GrupoOrigen, type OrigenVisible } from "../../../supabase/functions/_shared/logs-web/origen";
import { explicacionOrigenAmbito, NOMBRE_GRUPO_AMBITO, type Ambito } from "../../../supabase/functions/_shared/logs-web/ambito";
import { ESTILO_GRUPO, estiloDe, etiquetaOrigen } from "./origenEstilos";

export function BadgeOrigen({ origen, proveedor, ambito, className }: { origen: OrigenVisible; proveedor?: string | null; ambito?: Ambito | null; className?: string }) {
  return (
    <Badge variant="outline" className={cn("shrink-0 whitespace-nowrap font-medium", estiloDe(origen).insignia, className)}
      data-testid="badge-origen" data-origen={origen} data-grupo={grupoDeOrigen(origen)} data-ambito={origen === "web" ? ambito ?? "web" : undefined}>
      {etiquetaOrigen(origen, proveedor, ambito)}
    </Badge>
  );
}

/**
 * Cabecera del detalle: el color, el nombre («Fallo del admin»), la zona
 * («Panel › Facturas») y una línea en llano de qué es y qué hacer.
 */
export function AvisoOrigen({ origen, proveedor, ambito, zona }: { origen: OrigenVisible; proveedor?: string | null; ambito?: Ambito | null; zona?: string | null }) {
  return (
    <section className={cn("flex flex-wrap items-start gap-2 rounded-md border p-3 text-sm", estiloDe(origen).bloque)} data-testid="aviso-origen" data-origen={origen}>
      <span className="flex flex-wrap items-center gap-1.5">
        <BadgeOrigen origen={origen} proveedor={proveedor} ambito={ambito} />
        {zona && <span className={cn("font-medium", estiloDe(origen).texto)} data-testid="zona-incidencia">· {zona}</span>}
      </span>
      <p className="min-w-0 flex-1 basis-60">{explicacionOrigenAmbito(origen, proveedor, ambito)}</p>
    </section>
  );
}

const LEYENDA: Array<{ grupo: GrupoOrigen; nombre: string; texto: string }> = [
  {
    grupo: "web",
    nombre: "Fallos de la web y del admin",
    texto: "hay que arreglarlo; cuentan en el número de la pestaña y pueden abrir ticket en Linear. «De la web» si falla algo que usan los clientes; «del admin» si falla el panel o una tarea automática.",
  },
  { grupo: "externo", nombre: NOMBRE_GRUPO_ORIGEN.externo, texto: "falla un servicio de fuera (Google Maps, Instagram, Stripe, OpenAI…); se cuenta aparte y no abre ticket salvo que lo actives en Configuración." },
  { grupo: "no_depende", nombre: NOMBRE_GRUPO_ORIGEN.no_depende, texto: "conexión del visitante, su navegador o extensiones, versión antigua que se arregló sola, bots y pruebas. No hay que hacer nada ni abre tickets." },
];

/** Qué significa cada color (corta, siempre a la vista encima de la lista). */
export function LeyendaOrigen() {
  return (
    <ul className="grid gap-1 text-xs text-muted-foreground md:grid-cols-3 md:gap-3" data-testid="leyenda-origen" aria-label="Qué significa cada color">
      {LEYENDA.map((l) => (
        <li key={l.grupo} className="flex items-start gap-1.5">
          <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", ESTILO_GRUPO[l.grupo].punto)} aria-hidden />
          <span><strong className="font-semibold text-foreground">{l.nombre}:</strong> {l.texto}</span>
        </li>
      ))}
    </ul>
  );
}

/** Cada cuenta: su nombre, su color y el filtro que pone al pulsarla. */
const CONTEOS: Array<{ grupo: GrupoConteo; nombre: string; color: GrupoOrigen; filtro: FiltroOrigen }> = [
  { grupo: "web", nombre: NOMBRE_GRUPO_AMBITO.web, color: "web", filtro: "fallo_web" },
  { grupo: "admin", nombre: NOMBRE_GRUPO_AMBITO.admin, color: "web", filtro: "fallo_admin" },
  { grupo: "externo", nombre: NOMBRE_GRUPO_ORIGEN.externo, color: "externo", filtro: "externo" },
  { grupo: "no_depende", nombre: NOMBRE_GRUPO_ORIGEN.no_depende, color: "no_depende", filtro: "no_depende" },
];

/**
 * Cuántas hay de cada clase con los filtros actuales: fallos de la web, fallos
 * del admin, externos y lo que no depende de la web. Cada botón filtra por su
 * clase (y vuelve al de siempre si ya estaba elegido).
 */
export function ResumenOrigenes({ conteos, filtro, onFiltro }: {
  conteos: Record<GrupoConteo, number>;
  filtro: FiltroOrigen | null;
  onFiltro: (f: FiltroOrigen | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="resumen-origenes" role="group" aria-label="Incidencias por origen">
      {CONTEOS.map((c) => {
        const activo = filtro === c.filtro;
        return (
          <button key={c.grupo} type="button" aria-pressed={activo} data-testid={`conteo-${c.grupo}`}
            onClick={() => onFiltro(activo ? "web_externos" : c.filtro)}
            className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm transition-colors hover:opacity-90",
              ESTILO_GRUPO[c.color].insignia, activo && "ring-2 ring-ring ring-offset-1")}>
            <span className={cn("h-2.5 w-2.5 rounded-full", ESTILO_GRUPO[c.color].punto)} aria-hidden />
            {c.nombre}: <strong className="tabular-nums">{conteos[c.grupo] ?? 0}</strong>
          </button>
        );
      })}
    </div>
  );
}
