import { Children, Fragment, type ComponentType, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Lista plana de filas (estilo de Facturas → Compras): sin tarjetas, un separador fino entre filas, ~56 px por
 * fila. Cada `FilaPlana` lleva título y subtítulo «a · b · c» truncados, un área a la derecha (importe, estado
 * con punto de color), UNA acción primaria (la única con color dorado) y un menú «⋯» para el resto. Sin
 * virtualización: para listas de cientos de filas, no de miles.
 *
 *   <ListaPlana aria-label="Suscriptores" scroll vacio={<p>Nadie todavía.</p>}>
 *     <FilaPlana titulo="ana@ejemplo.es" subtitulo={["Ana Pérez", "Reserva web"]} derecha="12,50 €"
 *       estado={{ texto: "Activo", tono: "verde" }} seleccionada={sel === id} onSeleccionar={() => setSel(id)}
 *       accion={{ etiqueta: "Abrir", onClick: abrir }}
 *       menu={[{ etiqueta: "Eliminar", onClick: borrar, destructiva: true }]} />
 *   </ListaPlana>
 */

interface ListaPlanaProps {
  children?: ReactNode;
  className?: string;
  /** La lista toma el alto que sobra (`flex-1 min-h-0`) y hace scroll por dentro: úsala en un contenedor flex. */
  scroll?: boolean;
  /** Se pinta en lugar de la lista cuando no hay filas. */
  vacio?: ReactNode;
  "aria-label"?: string;
  "data-testid"?: string;
}

export function ListaPlana({ children, className, scroll, vacio, "aria-label": ariaLabel, "data-testid": testId }: ListaPlanaProps) {
  if (vacio !== undefined && Children.toArray(children).length === 0) return <>{vacio}</>;
  return (
    <ul
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn("divide-y divide-border/60", scroll && "min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
    >
      {children}
    </ul>
  );
}

export type TonoEstado = "verde" | "ambar" | "rojo" | "gris";

const PUNTO: Record<TonoEstado, string> = {
  verde: "bg-emerald-500",
  ambar: "bg-amber-500",
  rojo: "bg-red-500",
  gris: "bg-muted-foreground/50",
};

export interface AccionFila {
  etiqueta: string;
  onClick: () => void;
  icono?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  /** Por defecto la etiqueta se oculta por debajo de `sm` y queda solo el icono (si lo hay). */
  etiquetaEnMovil?: boolean;
}

export interface OpcionMenuFila {
  etiqueta: string;
  onClick: () => void;
  icono?: ComponentType<{ className?: string }>;
  destructiva?: boolean;
  disabled?: boolean;
  /** Raya fina encima de esta opción. */
  separadorAntes?: boolean;
}

interface FilaPlanaProps {
  titulo: ReactNode;
  /** Texto o lista: una lista se une con « · » saltando los vacíos. */
  subtitulo?: ReactNode | Array<ReactNode | false | null | undefined>;
  /** A la izquierda del texto (checkbox, avatar…). */
  inicio?: ReactNode;
  /** Importe u otro dato a la derecha. */
  derecha?: ReactNode;
  /** Punto de color + texto, junto a `derecha`. */
  estado?: { texto: string; tono?: TonoEstado };
  accion?: AccionFila;
  menu?: OpcionMenuFila[];
  /** Fila marcada (fondo suave y `aria-current`). */
  seleccionada?: boolean;
  /** Si se da, tocar el texto de la fila la selecciona. */
  onSeleccionar?: () => void;
  /** Nombre accesible del menú «⋯» (por defecto «Más acciones»). */
  etiquetaMenu?: string;
  className?: string;
  "data-testid"?: string;
}

function unir(subtitulo: FilaPlanaProps["subtitulo"]): ReactNode {
  if (!Array.isArray(subtitulo)) return subtitulo;
  const partes = subtitulo.filter((p): p is Exclude<typeof p, false | null | undefined | ""> => p !== false && p != null && p !== "");
  // Todo texto: una sola cadena (un único nodo, mejor para lectores de pantalla y para truncar).
  if (partes.every((p) => typeof p === "string" || typeof p === "number")) return partes.join(" · ");
  return partes.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>);
}

export function FilaPlana({
  titulo,
  subtitulo,
  inicio,
  derecha,
  estado,
  accion,
  menu,
  seleccionada,
  onSeleccionar,
  etiquetaMenu = "Más acciones",
  className,
  "data-testid": testId,
}: FilaPlanaProps) {
  const sub = unir(subtitulo);
  const cuerpo = (
    <>
      {inicio}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{titulo}</span>
        {sub != null && sub !== false && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {(derecha != null || estado) && (
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right sm:flex-row sm:items-center sm:gap-3">
          {derecha != null && <span className="text-sm font-semibold tabular-nums">{derecha}</span>}
          {estado && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", PUNTO[estado.tono ?? "gris"])} />
              {estado.texto}
            </span>
          )}
        </span>
      )}
    </>
  );
  const claseCuerpo = "flex min-h-14 min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left";
  const Icono = accion?.icono;

  return (
    <li
      data-testid={testId}
      aria-current={seleccionada ? "true" : undefined}
      className={cn("flex items-center gap-1 pr-1 transition-colors", seleccionada ? "bg-muted/70" : "hover:bg-muted/40", className)}
    >
      {onSeleccionar ? (
        <button type="button" onClick={onSeleccionar} className={cn(claseCuerpo, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}>
          {cuerpo}
        </button>
      ) : (
        <div className={claseCuerpo}>{cuerpo}</div>
      )}
      {accion && (
        <Button
          type="button"
          size="sm"
          className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 active:bg-accent/80"
          onClick={accion.onClick}
          disabled={accion.disabled}
          aria-label={accion.etiqueta}
        >
          {Icono && <Icono className="h-4 w-4" />}
          <span className={cn(Icono && !accion.etiquetaEnMovil && "hidden sm:inline")}>{accion.etiqueta}</span>
        </Button>
      )}
      {menu && menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={etiquetaMenu}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((o) => {
              const IconoOpcion = o.icono;
              return (
                <Fragment key={o.etiqueta}>
                  {o.separadorAntes && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    disabled={o.disabled}
                    onSelect={o.onClick}
                    className={cn(o.destructiva && "text-destructive focus:text-destructive")}
                  >
                    {IconoOpcion && <IconoOpcion className="mr-2 h-4 w-4" />}
                    {o.etiqueta}
                  </DropdownMenuItem>
                </Fragment>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
