import { useNavigate } from "react-router-dom";
import { Loader2, Replace } from "lucide-react";
import { cn } from "@/lib/utils";
import { RUTA_CARGAR, useColaSubidaOpcional } from "@/hooks/useColaSubida";
import { textoIndicador } from "@/lib/facturas/colaSubida";

interface Props {
  /** `menu`: pie del menú lateral (≥ 1024 px). `cabecera`: barra superior de tablet vertical / móvil. */
  variante: "menu" | "cabecera";
  /** Menú lateral plegado a iconos: solo el icono con el número. */
  colapsado?: boolean;
  className?: string;
}

/**
 * Indicador global discreto de la subida de facturas en segundo plano
 * («Facturas: 2 procesando · 1 por decidir»), visible desde cualquier sección.
 * Al tocarlo lleva a Facturas → Cargar. No pinta nada si no hay nada en marcha
 * ni pendiente, ni fuera de <ColaSubidaProvider>.
 */
export function IndicadorSubidasFacturas(props: Props) {
  const c = useColaSubidaOpcional();
  if (!c) return null;
  const porDecidir = c.pendientes.length;
  if (c.activos === 0 && porDecidir === 0) return null;
  return <Indicador {...props} activos={c.activos} porDecidir={porDecidir} />;
}

function Indicador({ variante, colapsado, className, activos, porDecidir }: Props & { activos: number; porDecidir: number }) {
  const navigate = useNavigate();
  const texto = textoIndicador(activos, porDecidir);
  const etiqueta = `Facturas: ${texto}. Abrir Facturas, pestaña Cargar`;
  const Icono = activos > 0 ? Loader2 : Replace;
  const icono = (
    <Icono className={cn("h-4 w-4 shrink-0", activos > 0 && "motion-safe:animate-spin")} aria-hidden="true" />
  );

  return (
    <div role="status" aria-live="polite" className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={() => navigate(RUTA_CARGAR)}
        aria-label={etiqueta}
        title={`Facturas: ${texto}`}
        className={cn(
          "relative flex min-h-11 min-w-11 items-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          variante === "menu"
            ? "w-full text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent"
            : "max-w-full border border-border bg-muted/50 px-3 text-foreground hover:bg-muted active:bg-muted",
          variante === "menu" && (colapsado ? "justify-center" : "px-3"),
        )}
      >
        {icono}
        {colapsado ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] pointer-coarse:text-xs leading-none tabular-nums text-primary-foreground">
            {activos + porDecidir}
          </span>
        ) : (
          <span className="min-w-0 truncate">
            <span className={variante === "cabecera" ? "sr-only sm:not-sr-only" : undefined}>Facturas: </span>
            {texto}
          </span>
        )}
      </button>
    </div>
  );
}
