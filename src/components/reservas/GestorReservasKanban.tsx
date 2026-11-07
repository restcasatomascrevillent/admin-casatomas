import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  MeasuringStrategy,
  useDroppable,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent, CollisionDetection, Announcements } from "@dnd-kit/core";
import type { Modifier } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { coincideFiltroHoy, type FiltroTurnoHoy } from "@/lib/reservas/vistaHoy";
import { admiteReservas } from "@/lib/reservas/negocios";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { comensalesEnEspacioTurno, type ReservaServicio } from "@/lib/reservas/servicioSala";
import { ocupaEspacio } from "@/lib/reservas/estadosReserva";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Users, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { BlacklistModal } from "./BlacklistModal";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { ReservaCard } from "./ReservaCard";
import { useMovimientoReservaServicio, mesasPorReservaDe } from "@/hooks/useMovimientoReservaServicio";
import {
  SIN_ASIGNAR,
  columnaDeReserva,
  columnasVisibles,
  construirColumnas,
  esSinAsignar,
  type Columna,
} from "@/lib/reservas/columnasServicio";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useIsCoarsePointer } from "@/hooks/use-mobile";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import {
  ANCHO_COLUMNA_PLEGADA,
  ANCHO_MIN_COLUMNA,
  ANCHO_MIN_COLUMNA_TACTIL,
  calcularDisposicion,
  type DisposicionKanban,
  type ItemColumna,
} from "./kanbanLayout";

// El nombre y el color de cada estado salen de `ESTADOS_RESERVA`
// (src/lib/reservas/estadosReserva.ts), la fuente única que también leen el
// timeline y el filtro (la Lista pasa a leerla después). Este kanban tenía su
// propio mapa, con la paleta cruda de Tailwind (yellow-500, blue-500…); ahora usa
// los tokens `status-*` del tema para pendiente/verificada/confirmada y las clases
// de la Lista para cancelada, «Llegó» y «No vino» (no hay token para esos tres).
// Qué botones tiene cada tarjeta, y cuáles se pueden pulsar, lo decide
// `accionesDisponibles(reserva, { vista: "hoy", canEdit })`.

// El buscador y «Todo el día / Comida / Cena» viven en `VistaHoy` desde el 06/10/2026: son
// comunes a las dos vistas de «Hoy» (Kanban | Plano). Aquí llegan como props.
type FiltroTurno = FiltroTurnoHoy;

/**
 * ALTO DEL KANBAN (05/10/2026, petición del dueño: en «Hoy», sin scroll de página): la fila de columnas mide
 * justo el alto que queda de ventana, con el mismo mecanismo que el Calendario, «Próximas reservas» y la
 * Newsletter (`useAlturaDisponible`: alto del viewport visual − posición del bloque − relleno inferior del
 * <main>, recalculado al redimensionar, girar la tablet, abrir el teclado, plegar el menú o desplegar algo de
 * encima). Lo de arriba (cifras, aviso del Reservado, «Disponibilidad por cuartos de hora», buscador y
 * filtros) queda fijo; cada columna se estira hasta el fondo y sus tarjetas se desplazan por dentro.
 *
 * Antes cada columna tenía un tope de `65dvh` que no descontaba lo de encima (de 350 a 570 px según la pantalla):
 * con la columna «Sin asignar» llena, lo de encima + el tope + la cabecera de la columna pasaban del alto de la
 * ventana y la página entera hacía scroll. Ese tope solo queda para cuando no hay medida (jsdom, primer
 * pintado sin layout).
 *
 * SUELO (px): por debajo el kanban no encoge más y, solo entonces, la página hace scroll («Disponibilidad por
 * cuartos de hora» desplegada en una ventana baja, teclado en pantalla). 280 px = una tarjeta entera bajo la
 * cabecera de una columna con barras de aforo. No es el de 360 de «Próximas reservas»: aquí lo de encima es
 * más alto, y en la ventana del dueño (1280×711 a 150 %) al kanban le quedan 313 px; con 360 la página volvía
 * a hacer scroll justo ahí (y en la tablet apaisada y el móvil).
 */
const ALTURA_MINIMA_KANBAN = 280;

function BarraTurno({ etiqueta, pax, capacidad }: { etiqueta: string; pax: number; capacidad: number }) {
  const porcentaje = capacidad ? Math.min(100, Math.round((pax / capacidad) * 100)) : 0;
  const excedido = pax > capacidad;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] pointer-coarse:text-xs text-muted-foreground">
        <span>{etiqueta}</span>
        <span className={cn("tabular-nums", excedido && "text-destructive font-medium")}>
          {pax}/{capacidad} pax
        </span>
      </div>
      <Progress
        value={porcentaje}
        className={cn("h-1.5", excedido && "[&>div]:bg-destructive")}
        aria-label={`${etiqueta}: ${pax} de ${capacidad} plazas`}
      />
    </div>
  );
}

// Droppable column
function KanbanColumn({
  id,
  title,
  capacidadMax,
  privada,
  paxComida,
  paxCena,
  filtroTurno,
  children,
  count,
  isActive,
  minimized,
  onToggleMinimize,
  ancho,
  margenDerecho,
  conIman,
  alturaMaxima,
  onVerPlano,
}: {
  id: string;
  title: string;
  capacidadMax?: number;
  /** Sala privada (el Reservado): fuera de aforo; no tiene barras de aforo. */
  privada?: boolean;
  paxComida: number;
  paxCena: number;
  filtroTurno: FiltroTurno;
  children: React.ReactNode;
  count: number;
  isActive: boolean;
  minimized: boolean;
  onToggleMinimize: () => void;
  /** Ancho calculado por `kanbanLayout`; ya no es fijo (ver ese módulo). */
  ancho: number;
  /** Separación a la derecha: incluye el hueco de relleno de fin de página. */
  margenDerecho: number;
  /** Lleva imán de scroll: es donde el desplazamiento puede quedarse parado. */
  conIman: boolean;
  /**
   * Tope de alto de las tarjetas, solo sin altura medida (ver `ALTURA_MINIMA_KANBAN`). Con altura medida no
   * hay tope: la columna se estira hasta el fondo de la fila y las tarjetas se desplazan por dentro.
   */
  alturaMaxima?: string;
  /**
   * Abre esta sala en la vista «Plano» de «Hoy» (06/10/2026). Con él, el NOMBRE de la columna es un
   * botón (se ve igual; subrayado al pasar el ratón). «Sin asignar» no lo lleva: no tiene plano.
   */
  onVerPlano?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  // El ancho va en `style` y no en clases porque lo decide la aritmética de
  // `kanbanLayout` a partir del ancho real del contenedor.
  const medidas: React.CSSProperties = {
    marginRight: margenDerecho,
    scrollSnapAlign: conIman ? "start" : undefined,
  };

  if (minimized) {
    return (
      <button
        type="button"
        ref={setNodeRef}
        style={{ ...medidas, width: ANCHO_COLUMNA_PLEGADA }}
        className={cn(
          "flex flex-col items-center rounded-xl border-2 bg-muted/20 shrink-0 transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOver && "border-primary bg-primary/5 shadow-lg shadow-primary/10",
          !isOver && "border-transparent hover:border-muted-foreground/20",
        )}
        onClick={onToggleMinimize}
        aria-label={`Expandir columna ${title} (${count} reservas)`}
      >
        <div className="p-2 flex flex-col items-center gap-2">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold [writing-mode:vertical-lr] rotate-180 whitespace-nowrap">{title}</span>
          <Badge variant="secondary" className="text-[10px] pointer-coarse:text-xs px-1.5 tabular-nums">{count}</Badge>
        </div>
      </button>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={`Columna ${title}`}
      style={{ ...medidas, width: ancho }}
      className={cn(
        "flex flex-col rounded-xl border-2 bg-muted/20 shrink-0 transition-colors duration-200",
        isOver && "border-primary bg-primary/5 shadow-lg shadow-primary/10",
        !isOver && "border-transparent",
        isActive && !isOver && "border-muted-foreground/10",
      )}
    >
      <div className={cn("p-3 border-b space-y-2 transition-colors duration-200", isOver && "bg-primary/5")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleMinimize}
              className="touch-target inline-flex items-center justify-center p-0.5 -ml-1 rounded hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Minimizar columna ${title}`}
              title="Minimizar columna"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <h4 className="font-semibold text-sm">
              {onVerPlano ? (
                <button
                  type="button"
                  onClick={onVerPlano}
                  className="touch-hit rounded text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Ver ${title} en el plano`}
                  title={`Ver ${title} en el plano`}
                >
                  {title}
                </button>
              ) : (
                title
              )}
            </h4>
          </div>
          <Badge variant="secondary" className="text-xs tabular-nums">{count}</Badge>
        </div>
        {!privada && capacidadMax != null && capacidadMax > 0 && (
          <div className="space-y-1.5">
            {filtroTurno !== "cena" && <BarraTurno etiqueta="Comida" pax={paxComida} capacidad={capacidadMax} />}
            {filtroTurno !== "comida" && <BarraTurno etiqueta="Cena" pax={paxCena} capacidad={capacidadMax} />}
          </div>
        )}
      </div>
      {/* `[&>[data-radix-scroll-area-viewport]>div]:!block`: Radix mete dentro
          del viewport un `<div style="min-width:100%; display:table">`, y una
          caja `display:table` se dimensiona a MAX-CONTENT. Resultado: la
          tarjeta crecía hasta el largo del nombre más largo (321px dentro de
          una columna de 175) y lo que sobraba —la insignia de estado— quedaba
          recortado; `truncate` no servía de nada ahí dentro. Volviéndolo un
          bloque normal, la tarjeta mide lo que la columna y el nombre se corta
          con puntos suspensivos, como estaba previsto. Se notaba poco con
          columnas de 224px y mucho al bajar el mínimo. */}
      <ScrollArea
        className="min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block"
        style={alturaMaxima ? { maxHeight: alturaMaxima } : undefined}
      >
        <div className={cn("p-2 space-y-2 min-h-[120px] transition-colors duration-200 rounded-b-xl", isOver && "bg-primary/[0.02]")}>
          {children}
          {count === 0 && (
            <div
              className={cn(
                "flex flex-col items-center justify-center py-8 text-muted-foreground/60 transition-all duration-200",
                isOver && "text-primary/70 scale-105",
              )}
            >
              <div
                className={cn(
                  "w-12 h-12 rounded-full border-2 border-dashed flex items-center justify-center mb-2 transition-colors",
                  isOver ? "border-primary/40 bg-primary/5" : "border-muted-foreground/20",
                )}
              >
                <Users className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-xs font-medium">{isOver ? "Soltar aquí" : "Arrastra reservas aquí"}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

/**
 * La fila de columnas (Sin asignar + una por sala). Cumple los dos encargos del
 * dueño:
 *
 *   · TODAS las columnas a la vista a la vez (2026-09-26). Ninguna se pliega
 *     sola: el ancho mínimo por columna es 112px, así que las 5 de Casa Tomás
 *     caben enteras en cualquier escritorio. Antes se plegaban solas las
 *     columnas vacías a un carril de 52px y, a 1456px, el dueño se encontraba
 *     con cuatro carriles y una sola columna abierta — "cuando abro todos se
 *     pierden". Ese automatismo ya no existe; plegar es un gesto manual.
 *   · NUNCA se ve una columna partida (2026-09-25). Solo si ni al mínimo caben
 *     (pantalla muy estrecha) se desplaza, y entonces con imán: al pararse el
 *     scroll siempre hay columnas enteras a la vista.
 *
 * El ancho se mide con ResizeObserver, no por breakpoints: el ancho real
 * depende del sidebar, que se pliega.
 *
 * `llenarAlto`: el bloque que la contiene tiene altura fija (`ALTURA_MINIMA_KANBAN`): la fila se queda con
 * todo ese alto (`flex-1 min-h-0` en cada nivel) y las columnas se estiran hasta abajo.
 */
function FilaColumnas({
  items,
  arrastrando,
  llenarAlto,
  children,
}: {
  items: ItemColumna[];
  arrastrando: boolean;
  llenarAlto: boolean;
  children: (disposicion: DisposicionKanban) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [parada, setParada] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAncho(el.clientWidth);
    const observador = new ResizeObserver(() => setAncho(el.clientWidth));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  // Con dedo las columnas no bajan de ~232px (ver `ANCHO_MIN_COLUMNA_TACTIL`).
  const dedo = useIsCoarsePointer();
  const disposicion = useMemo(
    () => calcularDisposicion(items, ancho, dedo ? ANCHO_MIN_COLUMNA_TACTIL : ANCHO_MIN_COLUMNA),
    [items, ancho, dedo],
  );

  const { paradas, visiblesPorParada } = disposicion;
  const desplazable = disposicion.modo === "desplazable";
  const totalParadas = paradas.length;
  const paradaActual = Math.min(parada, Math.max(0, totalParadas - 1));

  // Rango de espacios a la vista ("2–4 de 5"): se lee de la propia disposición,
  // que es quien sabe cuántas columnas caben enteras.
  const visibles = visiblesPorParada[paradaActual] ?? [];
  const posicionDe = (id: string) => items.findIndex((i) => i.id === id) + 1;
  const desde = visibles.length > 0 ? posicionDe(visibles[0]) : 0;
  const hasta = visibles.length > 0 ? posicionDe(visibles[visibles.length - 1]) : 0;

  // Al cambiar el ancho (redimensionar, plegar el sidebar) el desplazamiento
  // anterior ya no cae en una parada: se recoloca en el sitio exacto para no
  // dejar media columna a la vista.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = desplazable ? (paradas[Math.min(parada, paradas.length - 1)] ?? 0) : 0;
    // `parada` a propósito fuera de las dependencias: este efecto recoloca al
    // cambiar la disposición, no debe pelearse con el scroll del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desplazable, totalParadas, disposicion.anchoColumna]);

  const irAParada = (destino: number) => {
    const el = scrollRef.current;
    if (!el || totalParadas === 0) return;
    const objetivo = Math.max(0, Math.min(destino, totalParadas - 1));
    el.scrollTo({ left: paradas[objetivo], behavior: "smooth" });
    setParada(objetivo);
  };

  const alDesplazar = () => {
    const el = scrollRef.current;
    if (!el || totalParadas === 0) return;
    let masCercana = 0;
    let minimaDistancia = Infinity;
    paradas.forEach((posicion, i) => {
      const distancia = Math.abs(posicion - el.scrollLeft);
      if (distancia < minimaDistancia) {
        minimaDistancia = distancia;
        masCercana = i;
      }
    });
    setParada(masCercana);
  };

  return (
    <section aria-label="Salas de hoy" className={cn("flex flex-col gap-2 min-w-0", llenarAlto && "min-h-0 flex-1")}>
      {desplazable && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1 text-xs min-w-0">
          <div className="ml-auto flex items-center gap-1 self-center">
            <span
              role="status"
              className="text-muted-foreground tabular-nums"
              aria-label={`Viendo los espacios ${desde} a ${hasta} de ${items.length}`}
            >
              {desde}–{hasta} de {items.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={paradaActual <= 0}
              onClick={() => irAParada(paradaActual - 1)}
              aria-label="Ver los espacios anteriores"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={paradaActual >= totalParadas - 1}
              onClick={() => irAParada(paradaActual + 1)}
              aria-label="Ver los siguientes espacios"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className={cn("relative min-w-0", llenarAlto && "flex min-h-0 flex-1 flex-col")}>
        <div
          ref={scrollRef}
          onScroll={alDesplazar}
          className={cn(
            // `min-w-0` + `overflow-x-auto` AQUÍ: el scroll horizontal se
            // contiene en el kanban y nunca sube a los layouts (ya rompió
            // `position: sticky` en toda la app una vez).
            "flex min-w-0 overflow-x-auto overflow-y-hidden py-2",
            desplazable ? "[scrollbar-width:thin]" : "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            // Con alto fijo, la fila ocupa todo el alto y las columnas (estiradas) también.
            llenarAlto && "min-h-0 flex-1",
          )}
          style={{
            // Mientras se arrastra se desactiva el imán: si no, el autoscroll
            // de dnd-kit y el snap se pelean y la tarjeta da saltos. Al soltar
            // vuelve a activarse y el navegador recoloca en página entera.
            scrollSnapType: desplazable && !arrastrando ? "x mandatory" : undefined,
          }}
        >
          {children(disposicion)}
          {disposicion.espacioFinal > 0 && (
            <div aria-hidden="true" className="shrink-0" style={{ width: disposicion.espacioFinal }} />
          )}
        </div>
        {desplazable && paradaActual > 0 && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent" />
        )}
        {desplazable && paradaActual < totalParadas - 1 && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" />
        )}
      </div>
    </section>
  );
}

// Primero lo que está bajo el puntero (preciso con columnas estrechas o
// minimizadas); si no hay nada — teclado, o el puntero entre columnas — el
// rectángulo con más intersección. `closestCenter`, lo que había, elegía a
// veces la columna vecina al soltar sobre el borde.
/**
 * Con dedo, `snapCenterToCursor` dejaba la tarjeta que se arrastra justo debajo de la yema, tapando
 * la columna de destino. Se sube ~64px para que se vea dónde se va a soltar (la detección de
 * colisión sigue usando el punto del dedo, no la tarjeta).
 */
const subirSobreElDedo: Modifier = ({ transform }) => ({ ...transform, y: transform.y - 64 });

const deteccionColisiones: CollisionDetection = (args) => {
  const bajoPuntero = pointerWithin(args);
  return bajoPuntero.length > 0 ? bajoPuntero : rectIntersection(args);
};

export function GestorReservasKanban({
  busqueda = "",
  filtroTurno = "todo",
  onVerPlanoSala,
}: {
  /** El buscador de «Hoy» (vive en `VistaHoy`, común a las dos vistas). */
  busqueda?: string;
  /** «Todo el día / Comida / Cena» de «Hoy» (ídem). */
  filtroTurno?: FiltroTurno;
  /** Tocar el nombre de una sala abre su plano (vista «Plano» de «Hoy»). Sin él, el nombre es solo texto. */
  onVerPlanoSala?: (espacioId: string) => void;
} = {}) {
  const { data: espacios } = useEspaciosReserva();
  const acciones = useAccionesServicioReserva();
  // Permiso de edición sobre «reservas». Antes solo lo miraba el editor y el resto
  // del kanban se apoyaba en la RLS de la BD; ahora TODO lo que escribe en una
  // reserva (estrella, llegada, no vino, deshacer, mover, lista negra, editar, dar
  // mesa) exige el permiso, y sin él no sale (06/11/2026: se oculta, no se
  // desactiva; `accionesDisponibles` y `ReservaCard`). Las tarjetas no se arrastran.
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const dedo = useIsCoarsePointer();
  const [activeReserva, setActiveReserva] = useState<ReservaServicio | null>(null);
  // Columnas plegadas a carril, SIEMPRE por decisión del usuario: ya no hay
  // plegado automático (2026-09-26, el dueño lo rechazó: "tienen que estar
  // todos aunque ocupen menos espacio de ancho por columna"). Por defecto el
  // conjunto está vacío, o sea: todas abiertas.
  const [minimizedCols, setMinimizedCols] = useState<Set<string>>(new Set());
  const [blacklistReserva, setBlacklistReserva] = useState<ReservaServicio | null>(null);
  const hoy = format(new Date(), "yyyy-MM-dd");
  // Alto de la fila de columnas, calculado solo (ver `ALTURA_MINIMA_KANBAN`). `null` mientras no hay medida
  // (cargando, jsdom): entonces cada columna conserva su tope de siempre y la página crece con ellas.
  const [bloqueColumnas, setBloqueColumnas] = useState<HTMLDivElement | null>(null);
  const alturaColumnas = useAlturaDisponible(bloqueColumnas, ALTURA_MINIMA_KANBAN);
  const medida = alturaColumnas !== null;

  // Marcar/desmarcar "importante" y añadir a blacklist: acciones que antes
  // vivían solo en la tabla "Reservas de Hoy" (retirada 2026-09-25 al pasar
  // el kanban a vista principal de "Hoy" — ver Reservas.tsx). Se traen aquí
  // para no perder capacidad, no para duplicar UI.
  //
  // La estrella pasa por el ejecutor único (`alternarImportante`), igual que en la
  // lista: pide la fila de vuelta (con la RLS denegando no da un falso «marcada»),
  // cambia al instante y deshace el cambio si no se guarda. Antes cada pantalla tenía
  // su copia de esta función.
  const toggleImportante = (reserva: ReservaServicio) => {
    void acciones.alternarImportante(reserva);
  };

  /** Plegar/desplegar una columna a mano. Nada la vuelve a plegar por su cuenta. */
  const togglePlegado = (colId: string) => {
    setMinimizedCols((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  };

  const sensors = useSensors(
    // TABLET (03/10/2026): ratón y dedo por separado. Con `PointerSensor` el dedo activaba el
    // arrastre a los 6 px (saltándose el retardo del `TouchSensor`) y el navegador, que se queda
    // el gesto para hacer scroll, lanza `pointercancel`, que ese sensor no escucha: deslizar para
    // desplazar la columna o la fila de salas unas veces arrancaba un arrastre y otras no.
    // El Apple Pencil emite eventos táctiles, así que `TouchSensor` también lo cubre.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Reservas de hoy de Casa Tomás. Touza no admite reservas (decisión del dueño
  // 2026-10-01): las de otro negocio que queden en la base de datos se
  // descartan aquí (`admiteReservas`), así que ni se pintan ni se cuentan.
  //
  // `select("*")`: trae `llegada_at` si la migración 20260923_reservas_llegada
  // está aplicada, sin romper si no lo está (nombrarla en la lista fallaría),
  // y `marca`. `as any`: `marca` no está en los tipos generados.
  //
  // La clave empieza por "reservas-kanban": useAccionesServicioReserva hace el
  // update optimista por prefijo. Lo que cambie otro dispositivo llega por
  // `useReservasEnVivo` (lo monta `VistaHoy`) y, sin realtime, con el refresco
  // de cada minuto mientras la pestaña está a la vista (`REFRESCO_PERIODICO`).
  const {
    data: reservas,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    ...REFRESCO_PERIODICO,
    queryKey: ["reservas-kanban", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", hoy)
        .neq("estado", "cancelada")
        .order("hora", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as (ReservaServicio & { marca?: string | null })[]).filter((r) =>
        admiteReservas(r.marca),
      );
    },
  });

  // Mesas asignadas de hoy, por reserva: sirven para avisar ANTES de mover a otra
  // sala una reserva que tiene mesa (el trigger de la BD las borra). Es la misma
  // consulta —y la misma clave de caché— que ya pide `VistaHoy`, así que no cuesta
  // una petición más; `CLAVE_ASIGNACIONES_MESA` la refresca al cambiar de sala. Si
  // aún no ha llegado (o falla) no se bloquea el movimiento: el trigger tampoco lo
  // bloquea, para no romper el kanban. Con el mismo respaldo de cada minuto que
  // `VistaHoy` (las mesas que dé otro dispositivo, sin realtime).
  const { data: asignacionesDeHoy } = useAsignacionesMesa(hoy, undefined, undefined, REFRESCO_PERIODICO);
  const mesasPorReserva = useMemo(() => mesasPorReservaDe(asignacionesDeHoy), [asignacionesDeHoy]);

  // Todas las columnas posibles como DESTINO: "Sin asignar" + las salas activas de Casa Tomás (por id: hay
  // dos «Terraza», una de cada negocio), el Reservado (sala privada) incluido, para poder mandar ahí una
  // reserva con «⋮ → Mover a…». Las que se PINTAN son `columnasPintadas`: sin las privadas.
  const columnas = useMemo<Columna[]>(() => construirColumnas(espacios), [espacios]);
  const columnasPintadas = useMemo(() => columnasVisibles(columnas), [columnas]);
  const itemsFila = useMemo<ItemColumna[]>(
    () => columnasPintadas.map((col) => ({ id: col.id, plegada: minimizedCols.has(col.id) })),
    [columnasPintadas, minimizedCols],
  );

  // La regla de siempre (turno por la hora; texto en nombre, email o teléfono), ahora en
  // `coincideFiltroHoy` para que el plano de «Hoy» filtre exactamente igual.
  const reservasFiltradas = useMemo(
    () => (reservas || []).filter((r) => coincideFiltroHoy(r, { busqueda, filtroTurno })),
    [reservas, busqueda, filtroTurno],
  );

  const reservasPorColumna = useMemo(() => {
    const map: Record<string, ReservaServicio[]> = {};
    columnas.forEach((c) => (map[c.id] = []));
    reservasFiltradas.forEach((r) => {
      const key = columnaDeReserva(r, columnas);
      (map[key] ??= []).push(r);
    });
    return map;
  }, [reservasFiltradas, columnas]);

  // Ocupación por espacio y TURNO sobre todas las reservas del día (no solo
  // las visibles por la búsqueda): la capacidad no depende de lo que se
  // filtre.
  const paxPorColumna = useMemo(() => {
    const todas = reservas || [];
    const map: Record<string, { comida: number; cena: number }> = {};
    columnas.forEach((c) => {
      const espacioId = esSinAsignar(c.id) ? null : c.id;
      map[c.id] = {
        comida: comensalesEnEspacioTurno(todas, espacioId, "comida"),
        cena: comensalesEnEspacioTurno(todas, espacioId, "cena"),
      };
    });
    return map;
  }, [reservas, columnas]);

  const { solicitarMovimiento, darMesa, dialogos } = useMovimientoReservaServicio({
    acciones,
    columnas,
    reservas: reservas || [],
    mesasPorReserva,
    fecha: hoy,
  });

  /**
   * Las mesas cambian constantemente (07/11/2026, idea del dueño): la asignada es solo la previsión. Al marcar
   * «Llegó» en una reserva con mesa, el aviso de siempre trae también «Cambiar mesa», que abre el mapa para
   * confirmar la mesa donde se han sentado de verdad. `darMesa` va por ref: cambia en cada render.
   */
  const darMesaRef = useRef(darMesa);
  darMesaRef.current = darMesa;
  const accionesTarjeta = useMemo(
    () => ({
      ...acciones,
      marcarLlegada: (reserva: ReservaServicio) =>
        acciones.marcarLlegada(
          reserva,
          puedeEditar && mesasPorReserva.get(reserva.id)?.length
            ? { accionAviso: { label: "Cambiar mesa", onClick: () => darMesaRef.current(reserva) } }
            : undefined,
        ),
    }),
    [acciones, mesasPorReserva, puedeEditar],
  );

  /**
   * Con sala, que ocupe sitio (pendiente/verificada/confirmada/completada) y sin ninguna mesa
   * asignada. Mientras las asignaciones no han llegado NO se marca nada: mejor callar que acusar en falso.
   */
  const estaSinMesa = (reserva: ReservaServicio) =>
    asignacionesDeHoy !== undefined &&
    ocupaEspacio(reserva.estado) &&
    columnaDeReserva(reserva, columnas) !== SIN_ASIGNAR &&
    !mesasPorReserva.has(reserva.id);

  const nombreColumna = (id: string | number | undefined | null) =>
    columnas.find((c) => c.id === id)?.title ?? "Sin asignar";

  const handleDragStart = (event: DragStartEvent) => {
    const r = (reservas || []).find((res) => res.id === event.active.id);
    setActiveReserva(r || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveReserva(null);
    const { active, over } = event;
    if (!over) return;
    const reserva = (reservas || []).find((r) => r.id === active.id);
    if (!reserva) return;
    solicitarMovimiento(reserva, String(over.id));
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const r = (reservas || []).find((x) => x.id === active.id);
      return `Has cogido la reserva de ${r?.nombre || "sin nombre"}. Usa las flechas para cambiar de columna, Espacio o Intro para soltar, Escape para cancelar.`;
    },
    onDragOver: ({ over }) => (over ? `Sobre la columna ${nombreColumna(over.id)}.` : "Fuera de cualquier columna."),
    onDragEnd: ({ over }) => (over ? `Reserva soltada en ${nombreColumna(over.id)}.` : "Reserva soltada fuera de las columnas; no se mueve."),
    onDragCancel: () => "Movimiento cancelado.",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando reservas…
      </div>
    );
  }

  if (isError) {
    return <EstadoErrorCarga titulo="las reservas de hoy" error={error} onReintentar={() => refetch()} />;
  }

  return (
    <div className="space-y-3 sm:space-y-4 h-full flex flex-col">
      {/* El buscador, «Todo el día / Comida / Cena» y la ayuda se pintan en `VistaHoy` (comunes a las dos
          vistas de «Hoy»), justo encima de este bloque y con la misma separación. */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveReserva(null)}
        collisionDetection={deteccionColisiones}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Para mover una reserva con el teclado, pulsa Espacio o Intro, usa las flechas para ir a otra columna y vuelve a pulsar Espacio o Intro. También puedes usar el menú de acciones de la tarjeta: «Mover a…».",
          },
        }}
      >
        {/* Con altura medida: este bloque mide justo lo que queda de ventana y la fila de columnas se queda con
            todo él. `flex-none` y no `flex-1`: en una columna flex sin alto propio (la de este componente),
            Chrome ignora el `height` de un hijo `flex: 1 1 0%` y le da el alto de su contenido. */}
        <div
          ref={setBloqueColumnas}
          data-testid="kanban-columnas"
          data-altura-fija={medida ? String(alturaColumnas) : undefined}
          className={cn("flex flex-col gap-3 min-w-0", medida ? "flex-none" : "flex-1")}
          style={medida ? { height: alturaColumnas } : undefined}
        >
          <FilaColumnas items={itemsFila} arrastrando={!!activeReserva} llenarAlto={medida}>
            {(disposicion) =>
              columnasPintadas.map((col) => {
                const plegada = minimizedCols.has(col.id);
                return (
                  <KanbanColumn
                    key={col.id}
                    id={col.id}
                    title={col.title}
                    capacidadMax={col.capacidadMax}
                    privada={col.privada}
                    paxComida={paxPorColumna[col.id]?.comida ?? 0}
                    paxCena={paxPorColumna[col.id]?.cena ?? 0}
                    filtroTurno={filtroTurno}
                    count={reservasPorColumna[col.id]?.length || 0}
                    isActive={!!activeReserva}
                    minimized={plegada}
                    onToggleMinimize={() => togglePlegado(col.id)}
                    ancho={disposicion.anchoColumna}
                    margenDerecho={disposicion.margenes[col.id] ?? 0}
                    conIman={disposicion.idsConIman.includes(col.id)}
                    alturaMaxima={medida ? undefined : "65dvh"}
                    onVerPlano={onVerPlanoSala && !esSinAsignar(col.id) ? () => onVerPlanoSala(col.id) : undefined}
                  >
                    {(reservasPorColumna[col.id] || []).map((reserva) => (
                      <ReservaCard
                        key={reserva.id}
                        reserva={reserva}
                        columnas={columnas}
                        acciones={accionesTarjeta}
                        onMover={solicitarMovimiento}
                        onToggleImportante={toggleImportante}
                        onBlacklist={setBlacklistReserva}
                        onEditar={(r) => editarReserva(r.id)}
                        onDarMesa={darMesa}
                        textoCambiarMesa={mesasPorReserva.get(reserva.id)?.length ? "Cambiar mesa" : undefined}
                        sinMesa={estaSinMesa(reserva)}
                        mesas={mesasPorReserva.get(reserva.id)}
                        puedeEditar={puedeEditar}
                        anchoColumna={disposicion.anchoColumna}
                      />
                    ))}
                  </KanbanColumn>
                );
              })
            }
          </FilaColumnas>
        </div>

        <DragOverlay modifiers={dedo ? [snapCenterToCursor, subirSobreElDedo] : [snapCenterToCursor]} dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeReserva ? (
            <ReservaCard
              reserva={activeReserva}
              columnas={columnas}
              acciones={acciones}
              onMover={solicitarMovimiento}
              onToggleImportante={toggleImportante}
              onBlacklist={setBlacklistReserva}
              sinMesa={estaSinMesa(activeReserva)}
              mesas={mesasPorReserva.get(activeReserva.id)}
              puedeEditar={puedeEditar}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Confirmaciones de mover y mapa para elegir mesa (`useMovimientoReservaServicio`). Van FUERA del DndContext. */}
      {dialogos}

      <BlacklistModal
        reserva={blacklistReserva}
        open={!!blacklistReserva}
        onOpenChange={(open) => { if (!open) setBlacklistReserva(null); }}
      />

      {/* Editor de la reserva elegida en el menú «⋮» de una tarjeta. `null` hasta que se pide. */}
      {dialogoEdicion}
    </div>
  );
}
