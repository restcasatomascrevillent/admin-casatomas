import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Barra de pestañas de página (estilo de Facturas): texto con subrayado dorado en la activa, línea fina debajo,
 * 40 px con ratón y 44 px con dedo. Debe ir DENTRO de un `<Tabs>` de shadcn; el contenido (`TabsContent`) lo
 * pone la página. Si las pestañas no caben, la fila hace scroll horizontal sin barra, con un degradado en el
 * borde que avisa; y `acciones` (p. ej. «Nueva reserva») ocupa el hueco de la derecha sin cortar pestañas.
 *
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <PestanasPagina
 *       pestanas={[{ valor: "hoy", etiqueta: "Hoy", icono: <Sun /> }, { valor: "lista", etiqueta: "Lista", contador: 12 }]}
 *       acciones={<Button>Nueva reserva</Button>}
 *     />
 *     <TabsContent value="hoy">…</TabsContent>
 *   </Tabs>
 */
export interface PestanaPagina {
  valor: string;
  etiqueta: ReactNode;
  /**
   * Texto por debajo de `sm` si la etiqueta no cabe en el móvil (p. ej. «Menús» por «Menús diarios»).
   * La larga sigue siendo el nombre accesible.
   */
  etiquetaCorta?: ReactNode;
  /** Icono (p. ej. un `<Users />` de lucide; la barra lo fija a 16 px). */
  icono?: ReactNode;
  /** Número a la derecha del texto (no se pinta si es 0 o `undefined`). */
  contador?: number;
  /** Color del contador: «primario» (por defecto) o «dorado». */
  tonoContador?: "primario" | "dorado";
  /** Nombre accesible del contador (p. ej. «3 procesando»). */
  etiquetaContador?: string;
  /** Por defecto el contador se oculta por debajo de `sm` (poco sitio); `true` lo deja siempre. */
  contadorEnMovil?: boolean;
  disabled?: boolean;
  /** Marca para el tour guiado (`data-tour`), ver `lib/ayuda/tours.ts`. */
  tour?: string;
}

interface PestanasPaginaProps {
  pestanas: PestanaPagina[];
  /** Botones a la derecha de la barra (no cortan las pestañas: estas hacen scroll en su hueco). */
  acciones?: ReactNode;
  /** Sin iconos por debajo de `sm`: para barras con muchas pestañas que no caben a 390 px. */
  iconosSoloEscritorio?: boolean;
  /**
   * Por debajo de `sm`, las pestañas ocupan todo el ancho (con su línea) y `acciones` baja a su propia fila,
   * debajo y a todo el ancho. Para barras cuyas pestañas no caben junto a los botones a 390 px (F-47,
   * 01/11/2026). Antes los botones subían ENCIMA de las pestañas, apretados a la derecha y con un hueco vacío
   * a la izquierda, entre dos barras de pestañas (al dueño no le gustaba, 02/11/2026). Desde `sm`, todo en
   * una fila como siempre.
   */
  accionesDebajoEnMovil?: boolean;
  className?: string;
}

const CLASE_PESTANA =
  "flex h-10 items-center gap-1 sm:gap-2 rounded-none border-b-2 border-transparent bg-transparent px-2 sm:px-3 text-muted-foreground shadow-none transition-colors hover:text-foreground pointer-coarse:min-h-11 data-[state=active]:border-[hsl(38,59%,45%)] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none flex-1 sm:flex-none";

const TONO_CONTADOR = {
  primario: "bg-primary/10 text-primary",
  dorado: "bg-[hsl(38,59%,45%)/0.12] text-[hsl(38,59%,45%)]",
} as const;

/** Degradados de los bordes que avisan de que hay más pestañas fuera de la vista. */
function useBordesScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ izq: false, der: false });
  const medir = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>("[role=tablist]");
    if (!el) return;
    const izq = el.scrollLeft > 1;
    const der = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setBordes((b) => (b.izq === izq && b.der === der ? b : { izq, der }));
  }, []);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[role=tablist]");
    if (!el) return;
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    // La pestaña activa siempre a la vista (P-31): si hay más pestañas de las que caben, al cambiar de pestaña (o al
    // cargar con `?tab=` de una lejana) la tira se desplaza para enseñarla. Solo scroll horizontal de la propia tira.
    const verActiva = () => {
      const activa = el.querySelector<HTMLElement>("[role=tab][data-state=active]");
      if (!activa || el.scrollWidth <= el.clientWidth + 1) return;
      const izq = activa.offsetLeft - 24;
      const der = activa.offsetLeft + activa.offsetWidth + 24 - el.clientWidth;
      if (izq < el.scrollLeft) el.scrollLeft = Math.max(0, izq);
      else if (der > el.scrollLeft) el.scrollLeft = der;
    };
    verActiva();
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(verActiva) : null;
    mo?.observe(el, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    return () => {
      el.removeEventListener("scroll", medir);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [medir]);
  return { ref, bordes };
}

export function PestanasPagina({
  pestanas,
  acciones,
  iconosSoloEscritorio,
  accionesDebajoEnMovil,
  className,
}: PestanasPaginaProps) {
  const { ref, bordes } = useBordesScroll();
  const degradado = "pointer-events-none absolute inset-y-0 z-10 w-8 from-background to-transparent";
  return (
    <div
      data-testid="pestanas-pagina"
      className={cn(
        "mb-2 flex w-full shrink-0 items-center gap-2 border-b border-border/60",
        // En el móvil la línea va bajo las pestañas (no bajo la fila de botones de abajo).
        accionesDebajoEnMovil && "flex-wrap gap-y-3 border-b-0 sm:flex-nowrap sm:border-b",
        className,
      )}
    >
      <div
        ref={ref}
        className={cn(
          "relative min-w-0 flex-1 sm:flex-initial",
          accionesDebajoEnMovil && "basis-full border-b border-border/60 sm:basis-auto sm:border-b-0",
        )}
      >
        <TabsList
          className={cn(
            "-mb-px flex h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0 sm:w-auto sm:gap-1 pointer-coarse:min-h-11",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {pestanas.map((p) => (
            <TabsTrigger key={p.valor} value={p.valor} disabled={p.disabled} className={CLASE_PESTANA} data-tour={p.tour}>
              {p.icono && (
                <span
                  className={cn(
                    "inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4",
                    iconosSoloEscritorio && "hidden sm:inline-flex",
                  )}
                  aria-hidden="true"
                >
                  {p.icono}
                </span>
              )}
              {p.etiquetaCorta ? (
                <>
                  <span className="truncate text-xs font-medium sm:hidden" aria-hidden="true">
                    {p.etiquetaCorta}
                  </span>
                  <span className="sr-only sm:not-sr-only sm:truncate sm:text-[15px] sm:font-medium">{p.etiqueta}</span>
                </>
              ) : (
                <span className="truncate text-xs font-medium sm:text-[15px]">{p.etiqueta}</span>
              )}
              {p.contador != null && p.contador > 0 && (
                <span
                  aria-label={p.etiquetaContador}
                  className={cn(
                    "ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
                    TONO_CONTADOR[p.tonoContador ?? "primario"],
                    !p.contadorEnMovil && "hidden sm:inline",
                  )}
                >
                  {p.contador}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {bordes.izq && <span aria-hidden="true" data-testid="degradado-izq" className={cn(degradado, "left-0 bg-gradient-to-r")} />}
        {bordes.der && <span aria-hidden="true" data-testid="degradado-der" className={cn(degradado, "right-0 bg-gradient-to-l")} />}
      </div>
      {acciones && (
        <div
          className={cn(
            "ml-auto flex shrink-0 items-center gap-2",
            accionesDebajoEnMovil && "w-full sm:w-auto",
          )}
        >
          {acciones}
        </div>
      )}
    </div>
  );
}
