// Piezas comunes del tablero de Facturas › Análisis: selector segmentado,
// tarjeta con título y resumen para lectores de pantalla, esqueleto y estados.
import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Colores de los locales en las gráficas: Casa Tomás azul, Touza naranja. */
export const COLOR_CASA_TOMAS = "bg-sky-700 dark:bg-sky-500";
export const COLOR_TOUZA = "bg-orange-400 dark:bg-orange-400";

/** Segmentado (como «Qué mirar» de Compras): botones con `aria-pressed` de 44 px. */
export function Segmentado<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambio,
  className,
}: {
  etiqueta: string;
  opciones: { valor: T; etiqueta: string }[];
  valor: T;
  onCambio: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className={cn("inline-flex shrink-0 gap-1 rounded-lg bg-muted/40 p-1", className)}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "min-h-11 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            "aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm",
            FOCO,
          )}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

/**
 * Tarjeta del tablero: borde fino, esquinas de 12 px, título en peso medio y
 * subtítulo gris. `resumen`: lo que dice la gráfica en una frase, para lectores
 * de pantalla (va como descripción de la sección).
 */
export function Tarjeta({
  titulo,
  subtitulo,
  resumen,
  accion,
  children,
  className,
  testId,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  resumen?: string;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-t`}
      aria-describedby={resumen ? `${id}-r` : undefined}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-3 sm:p-4", className)}
    >
      <header className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-t`} className="text-sm font-medium leading-tight text-foreground sm:text-base">
            {titulo}
          </h3>
          {subtitulo && <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>}
        </div>
        {accion}
      </header>
      {resumen && (
        <p id={`${id}-r`} className="sr-only">
          {resumen}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * Indicador: tarjeta gris sin borde, etiqueta, cifra y nota. Con `onVer` toda
 * la tarjeta es un botón que abre los documentos que forman la cifra.
 */
export function Indicador({
  etiqueta,
  valor,
  nota,
  claseNota,
  onVer,
}: {
  etiqueta: string;
  valor: string;
  nota?: ReactNode;
  claseNota?: string;
  onVer?: () => void;
}) {
  const cuerpo = (
    <>
      <span className="flex items-center gap-1 truncate text-xs font-medium text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{etiqueta}</span>
        {onVer && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </span>
      <span className="block truncate text-lg font-semibold tabular-nums tracking-tight text-foreground sm:text-xl">{valor}</span>
      {nota && <span className={cn("block truncate text-xs text-muted-foreground", claseNota)}>{nota}</span>}
      {onVer && <span className="sr-only">. Ver documentos</span>}
    </>
  );
  const base = "block w-full min-w-0 rounded-xl bg-muted/50 px-3 py-2.5 text-left sm:px-4 sm:py-3";
  return (
    <li className="min-w-0">
      {onVer ? (
        <button type="button" onClick={onVer} className={cn(base, "group min-h-11 transition-colors hover:bg-muted", FOCO)}>
          {cuerpo}
        </button>
      ) : (
        <div className={base}>{cuerpo}</div>
      )}
    </li>
  );
}

export interface AccionMenu {
  etiqueta: string;
  icono?: ReactNode;
  onClick: () => void;
}

/**
 * Fila de una tarjeta que, al tocarla, ofrece qué hacer con ella (ver sus
 * documentos, abrirla en Compras, llevarla al explorador). `children` es el
 * contenido de la fila; `nombre`, su nombre accesible.
 */
export function FilaConMenu({
  nombre,
  acciones,
  children,
  className,
  disabled,
  title,
}: {
  nombre: string;
  acciones: AccionMenu[];
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={nombre} title={title} disabled={disabled || acciones.length === 0} className={className} aria-haspopup="menu">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1" role="menu" aria-label={nombre}>
        <p className="truncate px-2 py-1.5 text-xs text-muted-foreground" title={nombre}>
          {nombre.replace(/\. ?Opciones$/, "")}
        </p>
        {acciones.map((a) => (
          <button
            key={a.etiqueta}
            type="button"
            role="menuitem"
            onClick={() => {
              setAbierto(false);
              a.onClick();
            }}
            className={cn("flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60", FOCO)}
          >
            {a.icono}
            {a.etiqueta}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Esqueleto del tablero mientras llega la RPC (la misma forma que el tablero). */
export function EsqueletoTablero() {
  const bloque = "animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none";
  return (
    <div className="space-y-4" aria-busy="true" role="status" aria-label="Cargando el tablero">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(bloque, "h-[4.5rem]")} />
        ))}
      </div>
      <div className={cn(bloque, "h-[30rem]")} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn(bloque, "h-56")} />
        ))}
      </div>
    </div>
  );
}

export function ErrorTablero({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <span>
          No se ha podido cargar el tablero. <span className="text-muted-foreground">{mensaje}</span>
        </span>
      </p>
      <Button type="button" variant="outline" className="h-11" onClick={onReintentar}>
        <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden /> Reintentar
      </Button>
    </div>
  );
}

/** Texto gris para una tarjeta sin datos en el periodo. */
export const SinDatos = ({ children }: { children: ReactNode }) => (
  <p className="py-4 text-sm text-muted-foreground" role="status">
    {children}
  </p>
);
