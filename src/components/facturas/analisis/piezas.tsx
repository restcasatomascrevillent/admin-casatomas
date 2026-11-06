// Piezas comunes del tablero de Facturas › Análisis: selector segmentado,
// tarjeta con título y resumen para lectores de pantalla, esqueleto y estados.
//
// CONTAINER QUERIES (06/11/2026): el tablero es un contenedor (`@container/
// tablero`) y cada tarjeta otro (`@container`). La rejilla y las filas se
// ordenan según el sitio que tienen DE VERDAD (al abrir la IA el tablero se
// estrecha ~360 px aunque la pantalla siga siendo ancha), no según la pantalla.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Maximize2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Tamano } from "@/lib/facturas/widgetsTablero";
import { Cifra } from "./Cifra";

export const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Rejilla «bento» de los módulos, por el ANCHO DEL TABLERO: 1 columna hasta
 * 34rem (móvil, tablet con la IA abierta muy estrecha), 2 hasta 60rem (1440
 * con la IA abierta, tablet vertical) y 3 a partir de ahí. `dense`: un módulo
 * pequeño rellena el hueco que deja uno mediano (los estrechos van juntos).
 */
export const REJILLA_BENTO =
  "grid grid-cols-1 gap-3 [grid-auto-flow:row_dense] @[34rem]/tablero:grid-cols-2 @[60rem]/tablero:grid-cols-3";

/** Columnas que ocupa cada tamaño (pequeño 1 · mediano 2 · grande 3), sin pasarse de las que hay. */
export const COLUMNAS_TAMANO: Record<Tamano, string> = {
  s: "col-span-1",
  m: "col-span-1 @[34rem]/tablero:col-span-2",
  l: "col-span-1 @[34rem]/tablero:col-span-2 @[60rem]/tablero:col-span-3",
};

/**
 * Cifras de arriba: 2 por fila hasta que caben más (por el ancho del
 * TABLERO). Las columnas dependen de cuántas hay para que las filas queden
 * llenas: 3 → 3; 4 → 4; 5 y 6 → 3 y, en ancho, todas en una fila; 7 y 8 → 4.
 */
export function rejillaCifras(n: number): string {
  const base = "grid grid-cols-2 gap-2 @[44rem]/tablero:gap-3";
  if (n <= 2) return base;
  if (n === 3) return cn(base, "@[30rem]/tablero:grid-cols-3");
  if (n === 4) return cn(base, "@[44rem]/tablero:grid-cols-4");
  if (n === 5) return cn(base, "@[44rem]/tablero:grid-cols-3 @[64rem]/tablero:grid-cols-5");
  if (n === 6) return cn(base, "@[44rem]/tablero:grid-cols-3 @[64rem]/tablero:grid-cols-6");
  return cn(base, "@[44rem]/tablero:grid-cols-4");
}
export const REJILLA_CIFRAS = rejillaCifras(4);

/**
 * Diálogo grande (detalle de un módulo, configurador): casi toda la pantalla
 * en escritorio y tablet; HOJA COMPLETA en el móvil (con `!`: gana a la
 * posición centrada del diálogo base, también con dedo).
 */
export const DIALOGO_GRANDE = cn(
  "flex max-w-none flex-col gap-0 overflow-hidden p-0 [&>button.absolute]:hidden",
  "w-full sm:max-h-[94dvh] sm:rounded-xl",
  "max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-none max-sm:!w-full max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:rounded-none max-sm:border-0",
);

/**
 * Escape cierra SOLO el desplegable abierto (periodo, filtros, menú de una
 * fila), también cuando está dentro de un diálogo grande. El diálogo y los
 * desplegables usan versiones distintas de la capa de Radix (cada una cree
 * ser «la de arriba») y, sin esto, Escape cerraba el diálogo entero
 * (QA 06/11/2026). Escucha en `window` en captura: llega antes que Radix.
 */
export function useEscapeCierra(abierto: boolean, cerrar: () => void) {
  const ref = useRef(cerrar);
  ref.current = cerrar;
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", alPulsar, { capture: true });
    return () => window.removeEventListener("keydown", alPulsar, { capture: true });
  }, [abierto]);
}

/** Filas que enseña una tarjeta según su tamaño (el resto, con «Ver los N» o ampliándola). */
export const FILAS_TAMANO: Record<Tamano, number> = { s: 5, m: 8, l: 10 };

/** Colores de los locales en las gráficas: Casa Tomás azul, Touza naranja. */
export const COLOR_CASA_TOMAS = "bg-sky-700 dark:bg-sky-500";
// orange-600 (no 400): contraste ≥ 3:1 sobre blanco (QA 05/11/2026).
export const COLOR_TOUZA = "bg-orange-600 dark:bg-orange-400";

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
 *
 * Con `onAmpliar`, la cabecera entera abre el detalle en grande (un botón
 * «Ampliar: <título>» cuyo área cubre la cabecera; Enter/Espacio como
 * cualquier botón). Las filas de dentro siguen siendo sus propios botones.
 * Es un contenedor (`@container`): sus filas se ordenan por SU ancho.
 */
export function Tarjeta({
  titulo,
  subtitulo,
  resumen,
  accion,
  children,
  className,
  testId,
  onAmpliar,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  resumen?: string;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  onAmpliar?: () => void;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-t`}
      aria-describedby={resumen ? `${id}-r` : undefined}
      data-testid={testId}
      // `relative`: el resumen `sr-only` (absolute) se queda dentro de la tarjeta y no
      // alarga la página (scroll vertical de 1063 px a 1180×820, QA 05/11/2026).
      className={cn(
        "@container relative flex h-full min-w-0 flex-col rounded-xl border border-border/70 bg-card p-3.5 shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] transition-colors sm:p-4",
        onAmpliar && "hover:border-border",
        className,
      )}
    >
      <header className="group/cabecera relative mb-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3
            id={`${id}-t`}
            className={cn(
              "text-sm font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere] @[22rem]:text-[0.9375rem]",
              onAmpliar && "transition-colors group-hover/cabecera:text-primary",
            )}
          >
            {titulo}
          </h3>
          {subtitulo && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{subtitulo}</p>}
        </div>
        {accion && <div className="relative z-10 flex shrink-0">{accion}</div>}
        {onAmpliar && (
          <button
            type="button"
            onClick={onAmpliar}
            aria-label={`Ampliar: ${titulo}`}
            aria-haspopup="dialog"
            title="Ver en grande, con filtros"
            className={cn(
              "-mr-1.5 -mt-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground group-hover/cabecera:text-foreground pointer-coarse:h-11 pointer-coarse:w-11",
              // El área del botón cubre toda la cabecera (título y subtítulo también abren el detalle).
              "after:absolute after:inset-0 after:content-['']",
              FOCO,
            )}
          >
            <Maximize2 className="h-4 w-4" aria-hidden />
          </button>
        )}
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
 *
 * `valor`: la cifra o sus formas de larga a corta (lib/facturas/cifras.ts):
 * nunca se corta, sale la primera que cabe. El tamaño de la letra va con el
 * ancho de la propia tarjeta (`cqi`), no con el de la pantalla.
 */
export function Indicador({
  etiqueta,
  valor,
  nota,
  claseNota,
  extra,
  onVer,
  accion = "Ver documentos",
  testId,
}: {
  etiqueta: string;
  valor: string | string[];
  nota?: ReactNode;
  claseNota?: string;
  /** Notas de más debajo de la nota (retención IRPF, meses incompletos): cada una en su línea. */
  extra?: ReactNode;
  onVer?: () => void;
  /** Qué hace al tocarla (para el lector de pantalla): por defecto, «Ver documentos». */
  accion?: string;
  testId?: string;
}) {
  const formas = Array.isArray(valor) ? valor : [valor];
  const cuerpo = (
    <>
      {/* La etiqueta en dos líneas si hace falta: «Regalado y des…» no decía nada (QA 06/11/2026). */}
      <span className="flex items-start gap-1 text-xs font-medium leading-snug text-muted-foreground">
        <span className="line-clamp-2 min-w-0 flex-1 break-words">{etiqueta}</span>
        {onVer && <ChevronRight className="mt-px h-3.5 w-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </span>
      <Cifra
        formas={formas}
        className="mt-0.5 text-[clamp(1.0625rem,0.55rem+4.5cqi,1.5rem)] font-semibold leading-tight tabular-nums tracking-tight text-foreground"
      />
      {nota && <span className={cn("mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted-foreground", claseNota)}>{nota}</span>}
      {extra && <span className="mt-1 block space-y-0.5 break-words text-xs leading-snug text-muted-foreground">{extra}</span>}
      {onVer && <span className="sr-only">. {accion}</span>}
    </>
  );
  // Columna arriba del todo: las cuatro miden lo mismo (la más alta manda) y todas empiezan arriba.
  const base =
    "flex h-full w-full min-w-0 flex-col items-stretch justify-start rounded-xl border border-transparent bg-muted/50 px-3 py-2.5 text-left @[13rem]:px-4 @[13rem]:py-3";
  return (
    <li className="@container relative min-w-0" data-testid={testId}>
      {onVer ? (
        <button type="button" onClick={onVer} className={cn(base, "group min-h-11 transition-colors hover:border-border/70 hover:bg-muted", FOCO)}>
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
  const disparador = useRef<HTMLButtonElement>(null);
  useEscapeCierra(abierto, () => setAbierto(false));
  // Sin `role="menu"`: un menú ARIA promete flechas y aquí son botones normales
  // con Tab (QA 05/11/2026). Radix ya marca el disparador con `aria-haspopup="dialog"`.
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button ref={disparador} type="button" aria-label={nombre} title={title} disabled={disabled || acciones.length === 0} className={className}>
          {children}
        </button>
      </PopoverTrigger>
      {/* `pointer-events-auto`: dentro del detalle en grande (un Dialog con otra versión de
          Radix) el cuerpo queda con `pointer-events: none` y el menú no se podría tocar. */}
      <PopoverContent align="start" className="pointer-events-auto w-64 p-1" aria-label={nombre} collisionPadding={12}>
        <p className="line-clamp-2 break-words px-2 py-1.5 text-xs text-muted-foreground">{nombre.replace(/\. ?Opciones$/, "")}</p>
        {acciones.map((a) => (
          <button
            key={a.etiqueta}
            type="button"
            onClick={() => {
              setAbierto(false);
              // El foco vuelve a la fila ANTES de abrir la hoja: así, al cerrarla, vuelve aquí.
              disparador.current?.focus({ preventScroll: true });
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
    <div className="@container/tablero space-y-4" aria-busy="true" role="status" aria-label="Cargando el tablero">
      <div className={REJILLA_CIFRAS}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(bloque, "h-[4.5rem]")} />
        ))}
      </div>
      <div className={cn(bloque, "h-[30rem]")} />
      <div className={REJILLA_BENTO}>
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

// ─── Filas de las tarjetas ──────────────────────────────────────────────────

/**
 * Fila con barra (proveedores, familias, productos…). En una tarjeta estrecha
 * el nombre va en SU línea (entero hasta donde quepa, con «…» y el nombre
 * completo en el globo y en el nombre accesible) y debajo la barra, la cifra y
 * el %, alineados en columna. Desde 36rem de tarjeta, todo en una línea.
 */
export const FILA_BARRA = cn(
  "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-2.5 gap-y-1 rounded-md px-1.5 py-1.5 text-left",
  "hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent",
  "@[36rem]:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto_2.75rem]",
  FOCO,
);

export function ContenidoFilaBarra({
  nombre,
  valor,
  pct,
  fraccion,
  color = COLOR_CASA_TOMAS,
}: {
  nombre: ReactNode;
  valor: string;
  pct?: string | null;
  /** De 0 a 1: largo de la barra frente a la mayor. */
  fraccion: number;
  color?: string;
}) {
  return (
    <>
      <span className="col-span-3 min-w-0 truncate text-sm text-foreground @[36rem]:col-span-1">{nombre}</span>
      <span className="block h-1.5 min-w-6 rounded-full bg-muted/70" aria-hidden>
        <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(1, fraccion)) * 100}%` }} />
      </span>
      <span className="whitespace-nowrap text-right text-sm tabular-nums text-foreground">{valor}</span>
      <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">{pct ?? ""}</span>
    </>
  );
}

/**
 * Fila de dos líneas sin barra (fijos, abonos, subidas, albaranes): el nombre
 * arriba a todo lo ancho; debajo, un detalle gris a la izquierda y la cifra a
 * la derecha. Desde 36rem de tarjeta, en una línea.
 */
export const FILA_DOBLE = cn(
  "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-1.5 py-1.5 text-left",
  "hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent",
  "@[36rem]:grid-cols-[minmax(0,1fr)_auto_auto]",
  FOCO,
);

export function ContenidoFilaDoble({ nombre, detalle, valor, claseValor }: { nombre: ReactNode; detalle?: ReactNode; valor: ReactNode; claseValor?: string }) {
  return (
    <>
      <span className="col-span-2 min-w-0 truncate text-sm text-foreground @[36rem]:col-span-1">{nombre}</span>
      <span className="min-w-0 truncate text-xs text-muted-foreground @[36rem]:text-right">{detalle}</span>
      <span className={cn("whitespace-nowrap text-right text-sm tabular-nums text-foreground", claseValor)}>{valor}</span>
    </>
  );
}

/** «Ver los 10» / «Ver solo 5»: despliega la lista dentro de la tarjeta. */
export function BotonVerMas({
  total,
  visibles,
  abierto,
  onCambio,
  controla,
  femenino = false,
}: {
  total: number;
  visibles: number;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  controla: string;
  femenino?: boolean;
}) {
  if (total <= visibles) return null;
  return (
    <button
      type="button"
      onClick={() => onCambio(!abierto)}
      aria-expanded={abierto}
      aria-controls={controla}
      className={cn("mt-1 inline-flex min-h-11 items-center self-start rounded-md px-1.5 text-sm font-medium text-primary hover:underline", FOCO)}
    >
      {abierto ? `Ver solo ${visibles}` : `Ver ${femenino ? "las" : "los"} ${total}`}
    </button>
  );
}
