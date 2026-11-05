import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Lenguaje visual de Facturas › Compras (acabado del 05/11/2026)
// ---------------------------------------------------------------------------
// Un solo juego de piezas para Documentos, Productos, Proveedores y las fichas:
//   · superficies planas con separadores finos (nada de tarjetas dentro de tarjetas);
//   · filas de 48 px como mínimo, con hover, pulsado y «abierto» (barra a la izquierda);
//   · marcas pequeñas (20 px) con la misma forma y un color por significado;
//   · importes en `tabular-nums`, alineados a la derecha;
//   · zonas táctiles de 44 px aunque lo visible mida menos (`before:`).

/** Foco visible común (contorno de 2 px, por dentro en filas a todo el ancho). */
export const FOCO = "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary";

/**
 * Chip de filtro: 32 px a la vista y 44 de zona táctil (el contenedor mide 44 y el
 * `before:` amplía el toque). Elegido = fondo tintado y borde fino.
 */
export const CHIP = `relative inline-flex h-8 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-3 text-[13px] font-medium text-muted-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-muted/50 hover:text-foreground active:bg-muted aria-pressed:border-primary/20 aria-pressed:bg-primary/[0.07] aria-pressed:text-foreground motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary`;

/** Fila de chips: 44 px de alto, scroll horizontal sin barra si no caben. */
export const BARRA_CHIPS = "flex h-11 shrink-0 snap-x items-center gap-1 overflow-x-auto overscroll-x-contain no-scrollbar";

/** Control segmentado (Local, Periodo): pista gris y la opción elegida en blanco. */
export const PISTA_SEGMENTOS = "inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg bg-muted/45 p-0.5";
export const SEGMENTO = `relative inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary`;

/** Fondo opaco de las cabeceras fijas (mes, columnas): el gris de la app mezclado con la tarjeta. */
export const FONDO_CABECERA = "bg-[color-mix(in_srgb,hsl(var(--muted))_32%,hsl(var(--card)))]";

/** Cabecera de columnas de una lista (texto pequeño en versalitas, fija arriba). */
export const CABECERA_COLUMNAS = "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

/** Estado de una fila de lista: hover, pulsado y «abierto» (barra de 3 px a la izquierda). */
export const filaEstado = (abierta: boolean) =>
  `transition-colors motion-reduce:transition-none hover:bg-muted/30 ${abierta ? "bg-primary/[0.05] shadow-[inset_3px_0_0_0_hsl(var(--primary))]" : ""}`;

/** Título de sección dentro de una ficha («Líneas», «Albaranes»…). */
export const TITULO_SECCION = "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground";

// ---------------------------------------------------------------------------
// Marcas (Albarán, Abono, Touza, avisos, Sin revisar, Sin factura)
// ---------------------------------------------------------------------------
export type TonoMarca = "neutro" | "touza" | "abono" | "aviso" | "pendiente" | "sinFactura" | "ok";

const TONOS: Record<TonoMarca, string> = {
  neutro: "border-border bg-muted/40 text-foreground/80",
  touza: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  abono: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  aviso: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  sinFactura: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  pendiente: "border-dashed border-slate-300 bg-transparent text-slate-600 dark:border-slate-600 dark:text-slate-300",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
};

/** Marca de texto (12 px, 20 px de alto): siempre lleva palabra, el color solo refuerza. */
export const Marca = ({ tono, icono, children, grande = false }: { tono: TonoMarca; icono?: ReactNode; children: ReactNode; grande?: boolean }) => (
  <span
    className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 text-xs font-medium [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0 ${grande ? "h-7 px-2" : "h-5"} ${TONOS[tono]}`}
  >
    {icono}
    {children}
  </span>
);

// ---------------------------------------------------------------------------
// Estados: vacío y error
// ---------------------------------------------------------------------------

/** Lista vacía: icono suave, qué pasa, qué hacer y, si la hay, la acción. */
export function EstadoVacio({
  icono,
  titulo,
  texto,
  accion,
}: {
  icono: ReactNode;
  titulo: string;
  texto?: string;
  accion?: { etiqueta: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="status">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground [&_svg]:h-6 [&_svg]:w-6" aria-hidden="true">
        {icono}
      </span>
      <p className="text-sm font-semibold text-foreground">{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{texto}</p>}
      {accion && (
        <Button variant="outline" className="mt-4 h-11 px-4" onClick={accion.onClick}>
          {accion.etiqueta}
        </Button>
      )}
    </div>
  );
}

/** Fallo al cargar: qué ha fallado, el detalle técnico en gris y «Reintentar». */
export function EstadoError({ titulo, detalle, onReintentar }: { titulo: string; detalle?: string; onReintentar?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" aria-hidden="true">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <p className="text-sm font-semibold text-foreground">{titulo}</p>
      {detalle && <p className="mt-1 max-w-sm break-words text-sm text-muted-foreground">{detalle}</p>}
      {onReintentar && (
        <Button variant="outline" className="mt-4 h-11 gap-1.5 px-4" onClick={onReintentar}>
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </Button>
      )}
    </div>
  );
}

/** Bloque de esqueleto (gris que late; quieto con «reducir movimiento»). */
export const Hueso = ({ className = "" }: { className?: string }) => (
  <span className={`block animate-pulse rounded bg-muted/70 motion-reduce:animate-none ${className}`} aria-hidden="true" />
);
