import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { Check, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { etiquetasDia, type ResumenPestana } from "@/lib/reservas/asignacionPorDias";

// ============================================================================
// TIRA DE DÍAS — las pestañas del panel «Asignación» (una por día del rango)
// ----------------------------------------------------------------------------
// Va DENTRO de un `<Tabs>` de Shadcn/Radix (teclado: flechas, Inicio y Fin; roles
// ARIA tablist/tab; solo la pestaña activa está en el orden de tabulación).
//
// Cada pestaña dice, sin depender del color:
//   · el día («Hoy», «Mañana», «Sáb 3»);
//   · cuántas reservas SIN mesa tiene (número), «todo asignado» (✓) o nada si no
//     tiene reservas;
//   · si cae dentro de la ventana de asignación (reloj).
// Esa misma información va en el nombre accesible y en el `title`. Qué cuenta cada
// cosa está en `src/lib/reservas/asignacionPorDias.ts`.
//
// La tira es una sola fila con scroll horizontal contenido (la página nunca se
// ensancha), se queda fija arriba al bajar por un día largo y mantiene a la vista
// la pestaña activa.
// ============================================================================

interface TiraDiasProps {
  dias: readonly ResumenPestana[];
  /** Hoy (`YYYY-MM-DD`, hora de Madrid): da nombre a «Hoy» y «Mañana». */
  hoy: string;
  /** Horas de la ventana de asignación, para el texto de las pestañas que caen dentro. */
  ventanaHoras: number;
  /** Fecha de la pestaña seleccionada. */
  activo: string;
  /** Para que quien la monta sepa dónde queda la tira (al cambiar de día vuelve a ella). */
  tiraRef?: Ref<HTMLDivElement>;
}

const reducirMovimiento = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function textoEstado(d: ResumenPestana): string {
  if (d.reservas === 0) return "sin reservas";
  if (d.sinMesa === 0) return "todo asignado";
  return d.sinMesa === 1 ? "1 reserva sin mesa" : `${d.sinMesa} reservas sin mesa`;
}

export function TiraDias({ dias, hoy, ventanaHoras, activo, tiraRef }: TiraDiasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const primeraVez = useRef(true);
  const [borde, setBorde] = useState({ izquierda: false, derecha: false });

  const medir = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const izquierda = el.scrollLeft > 2;
    const derecha = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setBorde((previo) => (previo.izquierda === izquierda && previo.derecha === derecha ? previo : { izquierda, derecha }));
  }, []);

  // ¿Se sale la tira? Se mide al montar, al hacer scroll y cuando cambia el tamaño.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const observador = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    observador?.observe(el);
    if (el.firstElementChild) observador?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", medir);
      observador?.disconnect();
    };
  }, [medir, dias.length]);

  // La pestaña activa se queda a la vista (centrada). Solo se mueve la tira, nunca la página.
  useEffect(() => {
    const contenedor = scrollRef.current;
    const pestana = contenedor?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!contenedor || !pestana || typeof contenedor.scrollTo !== "function") return;
    const objetivo = pestana.offsetLeft - (contenedor.clientWidth - pestana.offsetWidth) / 2;
    contenedor.scrollTo({
      left: Math.max(0, objetivo),
      behavior: primeraVez.current || reducirMovimiento() ? "auto" : "smooth",
    });
    primeraVez.current = false;
  }, [activo]);

  const desplazar = (sentido: -1 | 1) => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollBy !== "function") return;
    el.scrollBy({ left: sentido * el.clientWidth * 0.7, behavior: reducirMovimiento() ? "auto" : "smooth" });
  };

  const sale = borde.izquierda || borde.derecha;

  return (
    <div
      ref={tiraRef}
      // Fija arriba al bajar por un día largo. En móvil queda justo debajo de la barra superior
      // (`DashboardLayout`: h-12, sticky, z-50); en escritorio no hay barra.
      className="sticky top-12 z-30 border-b bg-background py-2 md:top-0"
    >
      <div className="flex items-center gap-1.5">
        {sale && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden h-9 w-9 shrink-0 sm:inline-flex"
            tabIndex={-1}
            aria-label="Ver días anteriores"
            disabled={!borde.izquierda}
            onClick={() => desplazar(-1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollRef}
            className="no-scrollbar relative overflow-x-auto overscroll-x-contain rounded-md"
          >
            <TabsList className="h-auto w-max min-w-full justify-start gap-1 p-1">
              {dias.map((d) => {
                const etiquetas = etiquetasDia(d.fecha, hoy);
                const estado = textoEstado(d);
                const ventana = d.enVentana ? `dentro de las próximas ${ventanaHoras} h` : null;
                return (
                  <TabsTrigger
                    key={d.fecha}
                    value={d.fecha}
                    data-fecha={d.fecha}
                    aria-label={[etiquetas.corta, estado, ventana].filter(Boolean).join(", ")}
                    title={[etiquetas.titulo, estado, ventana].filter(Boolean).join(" · ")}
                    className="h-10 min-w-[3.25rem] shrink-0 cursor-pointer touch-manipulation gap-1.5 px-2.5 hover:bg-background/60 data-[state=active]:hover:bg-background sm:h-9 sm:px-3"
                  >
                    {d.enVentana && <Clock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />}
                    <span>{etiquetas.corta}</span>
                    <InsigniaDia dia={d} />
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {/* Difuminado en el borde por el que se sigue la tira: avisa de que hay más días. */}
          {borde.izquierda && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-md bg-gradient-to-r from-background to-transparent"
            />
          )}
          {borde.derecha && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-md bg-gradient-to-l from-background to-transparent"
            />
          )}
        </div>

        {sale && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden h-9 w-9 shrink-0 sm:inline-flex"
            tabIndex={-1}
            aria-label="Ver días siguientes"
            disabled={!borde.derecha}
            onClick={() => desplazar(1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Insignia de la pestaña. Pendiente no es error: ámbar (nunca rojo) si el día está en la ventana,
 * neutra si queda lejos; ✓ verde si no queda nada por asignar; nada si el día no tiene reservas.
 * El número y el ✓ son formas distintas, así que no dependen del color.
 */
function InsigniaDia({ dia }: { dia: ResumenPestana }) {
  if (dia.reservas === 0) return null;
  if (dia.sinMesa === 0) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        dia.enVentana
          ? "bg-amber-200 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100"
          : "border border-border bg-background text-foreground",
      )}
    >
      {dia.sinMesa}
    </span>
  );
}
