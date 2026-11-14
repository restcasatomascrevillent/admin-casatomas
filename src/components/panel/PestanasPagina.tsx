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
  /** Color del contador: «primario» (por defecto), «dorado» o «rojo» (fallos que hay que arreglar, p. ej. Logs). */
  tonoContador?: "primario" | "dorado" | "rojo";
  /** Nombre accesible del contador (p. ej. «3 procesando»). */
  etiquetaContador?: string;
  /** Ya no hace nada (Fase 3): el contador se ve SIEMPRE. Se mantiene para no romper a quien lo pasa. */
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
   * una fila como siempre. Con `"lg"` se queda debajo hasta 1024 px (Reservas: 6 pestañas + «Nueva reserva» no caben
   * en 768 ni en apaisado); con `"xl"`, hasta 1280 px (Gestor Web › Carta: con el menú lateral, las 4 secciones y sus
   * botones no caben en una fila hasta entonces); con `"muyAncho"`, hasta 1800 px (Facturas › Análisis: periodo,
   * local, personalizar, IA y avisos no caben junto a las pestañas en una tablet o un portátil y se partían en dos
   * líneas, con las pestañas descolgadas; 09/11/2026).
   */
  accionesDebajoEnMovil?: boolean | "lg" | "xl" | "muyAncho";
  /**
   * Por debajo de `sm`, solo el icono de cada pestaña (la etiqueta queda como nombre accesible) y un punto en vez del
   * contador: todas caben en una línea fina, sin scroll horizontal. Para pantallas que necesitan el alto (el asistente
   * móvil de Instagram, 05/11/2026). Las pestañas sin icono enseñan su etiqueta.
   */
  soloIconosEnMovil?: boolean;
  /**
   * `acciones` se queda con todo el hueco que dejan las pestañas (y puede encoger): para meter
   * en la misma fila una barra de filtros (Facturas › Análisis, barra única, 07/11/2026).
   */
  accionesAnchas?: boolean;
  /** Los iconos de las pestañas solo en pantallas muy anchas (≥ 2xl): deja sitio a `acciones`. */
  iconosSoloMuyAncho?: boolean;
  /**
   * Nivel de la barra (Fase 3): 1 = pestañas de página (activa rellena); 2 = segundo nivel dentro de otra pestaña o de
   * un diálogo, con el aspecto de `ChipsSubnivel` (píldoras claras) pero con todo lo de esta barra (acciones,
   * contadores, scroll con degradado). Así nunca hay dos barras iguales una encima de otra.
   */
  nivel?: 1 | 2;
  className?: string;
}

// `flex-auto shrink-0` (11/11/2026, revisión móvil del dueño): en el móvil las pestañas llenan la fila si sobran
// sitio, pero NUNCA encogen hasta cortar el nombre («Stoc…», «Configuració…»): si no caben, la tira hace scroll
// con el degradado del borde (antes `flex-1` las apretaba y el nombre salía cortado sin aviso).
const CLASE_PESTANA =
  // Fase 3 (11/11/2026, «todas las pestañas con el mismo sistema»): la activa va RELLENA en pizarra, como pidió el
  // dueño para Reservas y la Carta el 10/11 («que se vean los botones»); ahora en todo el panel. Inactivas con texto
  // fuerte (no gris claro) y fondo suave al pasar el ratón. Antes: subrayado dorado y, en Reservas/Carta, CSS aparte.
  "group flex h-10 items-center gap-1 sm:gap-2 rounded-md border-0 bg-transparent px-2.5 sm:px-3.5 text-foreground/80 shadow-none transition-colors hover:bg-muted hover:text-foreground pointer-coarse:min-h-11 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:hover:bg-primary flex-auto shrink-0 sm:flex-none";

/** Clases de `accionesDebajoEnMovil`: fila, tira de pestañas y acciones, según hasta dónde bajan los botones. */
const DEBAJO = {
  sm: {
    fila: "flex-wrap gap-y-3 border-b-0 sm:flex-nowrap sm:border-b",
    tira: "basis-full border-b border-border/60 sm:basis-auto sm:border-b-0",
    acciones: "w-full sm:w-auto",
  },
  lg: {
    fila: "flex-wrap gap-y-3 border-b-0 lg:flex-nowrap lg:border-b",
    tira: "basis-full border-b border-border/60 sm:basis-full lg:basis-auto lg:border-b-0",
    acciones: "w-full lg:w-auto",
  },
  xl: {
    fila: "flex-wrap gap-y-3 border-b-0 xl:flex-nowrap xl:border-b",
    tira: "basis-full border-b border-border/60 sm:basis-full xl:basis-auto xl:border-b-0",
    acciones: "w-full xl:w-auto",
  },
  muyAncho: {
    fila: "flex-wrap gap-y-3 border-b-0 min-[1800px]:flex-nowrap min-[1800px]:border-b",
    tira: "basis-full border-b border-border/60 sm:basis-full min-[1800px]:basis-auto min-[1800px]:border-b-0",
    acciones: "w-full min-[1800px]:w-auto",
  },
} as const;

/** Pestaña de segundo nivel: el mismo aspecto que `ChipsSubnivel`. */
const CLASE_PESTANA_NIVEL_2 =
  "group flex h-9 items-center gap-1.5 rounded-full border border-transparent bg-transparent px-3.5 text-sm text-foreground/80 shadow-none transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11 data-[state=active]:border-primary/40 data-[state=active]:bg-primary/15 data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none shrink-0";

const TONO_CONTADOR_NIVEL_2 = { primario: "bg-primary/10 text-primary", dorado: "bg-gold/10 text-gold-strong", rojo: "bg-destructive/10 text-destructive" } as const;

const TONO_CONTADOR = {
  // En la pestaña activa (rellena) el contador pasa a blanco translúcido para seguir leyéndose.
  primario: "bg-primary/10 text-primary group-data-[state=active]:bg-primary-foreground/20 group-data-[state=active]:text-primary-foreground",
  dorado: "bg-gold/10 text-gold-strong group-data-[state=active]:bg-gold group-data-[state=active]:text-white",
  rojo: "bg-destructive/10 text-destructive group-data-[state=active]:bg-destructive group-data-[state=active]:text-destructive-foreground",
} as const;

/**
 * Contador de una pestaña (Fase 3, 11/11/2026): SIEMPRE visible, también en el móvil (antes se ocultaba por debajo de
 * `sm`). Mismo aspecto en las pestañas de página y en los chips de segundo nivel: píldora de 20 px de alto, cifra
 * tabular centrada y con separador de miles («1.903»), así 0, 12 o 1.903 quedan alineados con el texto.
 */
export const CLASE_CONTADOR =
  "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold leading-none tabular-nums";
// `useGrouping: "always"`: en español el separador de miles no sale con 4 cifras («1903») salvo que se pida.
const FORMATO_CONTADOR = new Intl.NumberFormat("es-ES", { useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
export const formatoContador = (n: number) => FORMATO_CONTADOR.format(n);

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
  soloIconosEnMovil,
  accionesAnchas,
  iconosSoloMuyAncho,
  nivel = 1,
  className,
}: PestanasPaginaProps) {
  const tonos = nivel === 2 ? TONO_CONTADOR_NIVEL_2 : TONO_CONTADOR;
  const enRejillaMovil = !soloIconosEnMovil && pestanas.length >= 4;
  const { ref, bordes } = useBordesScroll();
  const debajo = accionesDebajoEnMovil ? DEBAJO[accionesDebajoEnMovil === true ? "sm" : accionesDebajoEnMovil] : null;
  const degradado = "pointer-events-none absolute inset-y-0 z-10 w-10 from-background via-background/70 to-transparent";
  return (
    <div
      data-testid="pestanas-pagina"
      className={cn(
        "mb-2 flex w-full shrink-0 items-center gap-2 border-b border-border/60",
        // En el móvil la línea va bajo las pestañas (no bajo la fila de botones de abajo).
        debajo?.fila,
        className,
      )}
    >
      <div
        ref={ref}
        className={cn(
          "relative min-w-0 flex-1 sm:flex-initial",
          debajo?.tira,
        )}
      >
        <TabsList
          className={cn(
            "flex h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0 pb-1.5 sm:w-auto pointer-coarse:min-h-11",
            // Móvil (12/11/2026, dueño: «no me hagas más cagadas»): las pestañas NUNCA se cortan ni quedan tapadas por
            // un degradado: si no caben, bajan a otra fila. Desde 640 px, una fila con scroll como siempre.
            "max-sm:flex-wrap max-sm:overflow-visible",
            // Con 4 o más, en el móvil van de dos en dos (rejilla pareja; antes 3 + 1 con la última suelta a lo ancho).
            // Si son impares, la última ocupa la fila entera.
            enRejillaMovil && "max-sm:grid max-sm:grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {pestanas.map((p) => (
            <TabsTrigger
              key={p.valor}
              value={p.valor}
              disabled={p.disabled}
              className={cn(nivel === 2 ? CLASE_PESTANA_NIVEL_2 : CLASE_PESTANA, soloIconosEnMovil && p.icono && "relative min-w-11 justify-center px-1 sm:justify-start sm:px-3")}
              data-tour={p.tour}
              title={soloIconosEnMovil && typeof p.etiqueta === "string" ? p.etiqueta : undefined}
            >
              {p.icono && (
                <span
                  className={cn(
                    "inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4",
                    iconosSoloEscritorio && "hidden sm:inline-flex",
                    iconosSoloMuyAncho && "sm:hidden 2xl:inline-flex",
                    soloIconosEnMovil && "[&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-4 sm:[&>svg]:w-4",
                  )}
                  aria-hidden="true"
                >
                  {p.icono}
                </span>
              )}
              {soloIconosEnMovil && p.icono ? (
                <span className="sr-only sm:not-sr-only sm:truncate sm:text-[15px] sm:font-medium">{p.etiqueta}</span>
              ) : p.etiquetaCorta ? (
                <>
                  <span className="truncate text-xs font-medium sm:hidden" aria-hidden="true">
                    {p.etiquetaCorta}
                  </span>
                  <span className="sr-only sm:not-sr-only sm:truncate sm:text-[15px] sm:font-medium">{p.etiqueta}</span>
                </>
              ) : (
                <span className="truncate text-xs font-medium sm:text-[15px]">{p.etiqueta}</span>
              )}
              {/* Solo iconos en el móvil: el número va en una burbuja sobre el icono (antes un punto sin cifra). */}
              {soloIconosEnMovil && p.icono && p.contador != null && p.contador > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(CLASE_CONTADOR, "absolute right-0 top-0.5 h-4 min-w-4 bg-gold px-1 text-[11px] text-white sm:hidden")}
                  data-testid={`punto-${p.valor}`}
                >
                  {formatoContador(p.contador)}
                </span>
              )}
              {p.contador != null && p.contador > 0 && (
                <span
                  aria-label={p.etiquetaContador}
                  className={cn(CLASE_CONTADOR, "ml-1", tonos[p.tonoContador ?? "primario"], soloIconosEnMovil && p.icono && "hidden sm:inline-flex")}
                >
                  {formatoContador(p.contador)}
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
            accionesAnchas && "min-w-0 flex-1 shrink flex-wrap sm:flex-nowrap",
            debajo?.acciones,
          )}
        >
          {acciones}
        </div>
      )}
    </div>
  );
}
