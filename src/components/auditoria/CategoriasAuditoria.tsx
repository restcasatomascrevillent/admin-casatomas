import { Cog } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface CategoriaAuditoria {
  id: string;
  label: string;
  descripcion: string;
}

/** Valor de la categoría «Procesos» (actividad automática del servidor y la base de datos). */
export const CATEGORIA_PROCESOS = "procesos";

/** Opción de un control segmentado: pista gris y la elegida en blanco (los segmentados de filtro del panel). */
const SEGMENTO =
  "relative inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary pointer-coarse:h-10";

/**
 * Atajos para ver un tipo de actividad («Inicios de sesión», «Platos»…) con un toque.
 *
 * - Móvil (< 640 px): un desplegable a lo ancho. Las nueve opciones no caben en una fila y en tres filas se comían la
 *   pantalla; en un desplegable no se corta ninguna ni hay que deslizar.
 * - Tablet y escritorio: control segmentado (si no cabe, baja a otra fila; nunca se corta) y, aparte, «Procesos»,
 *   que no es un tipo de acción sino otro origen (lo automático del servidor).
 *
 * Debajo, en una línea, qué se está viendo.
 */
export function CategoriasAuditoria({
  categorias,
  activa,
  procesos,
  descripcion,
  onElegir,
}: {
  categorias: readonly CategoriaAuditoria[];
  /** Id de la categoría elegida; sin valor = filtros personalizados (no coincide con ningún atajo). */
  activa?: string;
  procesos: boolean;
  descripcion: string;
  onElegir: (id: string) => void;
}) {
  const valorMovil = procesos ? CATEGORIA_PROCESOS : (activa ?? "personalizado");
  return (
    <div className="min-w-0 shrink-0 space-y-1.5">
      <div className="flex min-w-0 items-center gap-2 sm:hidden">
        <Label htmlFor="auditoria-categoria" className="shrink-0 text-sm font-normal text-muted-foreground">
          Ver
        </Label>
        <select
          id="auditoria-categoria"
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={valorMovil}
          onChange={(e) => onElegir(e.target.value)}
        >
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          <option value={CATEGORIA_PROCESOS}>Procesos del servidor</option>
          {valorMovil === "personalizado" && (
            <option value="personalizado" disabled>
              Filtros personalizados
            </option>
          )}
        </select>
      </div>
      <div className="hidden min-w-0 flex-wrap items-center gap-2 sm:flex">
        <nav
          aria-label="Filtros rápidos por tipo de acción"
          className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-lg bg-muted/60 p-0.5"
        >
          {categorias.map((c) => (
            <button
              key={c.id}
              type="button"
              className={SEGMENTO}
              aria-pressed={!procesos && activa === c.id}
              title={c.descripcion}
              onClick={() => onElegir(c.id)}
            >
              {c.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          aria-pressed={procesos}
          title="Procesos automáticos del servidor y de la base de datos"
          onClick={() => onElegir(CATEGORIA_PROCESOS)}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary pointer-coarse:h-11",
            procesos
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <Cog className="h-4 w-4" aria-hidden="true" />
          Procesos
        </button>
      </div>
      <p className="hidden text-xs text-muted-foreground sm:block" role="status">
        {descripcion}
      </p>
    </div>
  );
}
