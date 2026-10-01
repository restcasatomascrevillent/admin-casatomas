import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  MeasuringStrategy,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent, CollisionDetection, Announcements } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { turnoDeHora } from "@/hooks/useDisponibilidad";
import { ESTADOS_QUE_OCUPAN } from "../../../supabase/functions/_shared/disponibilidad";
import {
  agruparPorNegocio,
  etiquetaNegocio,
  marcaDeEspacio,
  marcaDeReserva,
  MARCA_POR_DEFECTO,
  normalizarMarca,
} from "@/lib/reservas/negocios";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { comensalesEnEspacioTurno, evaluarMovimiento, type ReservaServicio } from "@/lib/reservas/servicioSala";
import { accionesDisponibles, motivoSiNoSePuede } from "@/lib/reservas/accionesReserva";
import { etiquetaEstadoReserva, infoEstadoReserva, ocupaEspacio } from "@/lib/reservas/estadosReserva";
import { TEXTO_CAMBIO_INTERNO, textoQuitarMesas } from "@/lib/reservas/asignacionMesas";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Clock, Users, Star, GripVertical, Phone, Search, ChevronDown, ChevronLeft, ChevronRight, MoveRight, MoreVertical, Loader2, ShieldBan, SquarePen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { ControlLlegada } from "./ControlLlegada";
import { BlacklistModal } from "./BlacklistModal";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { ConMotivo } from "./ConMotivo";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  ANCHO_COLUMNA_PLEGADA,
  accionesSoloIcono,
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

// Columna "Sin asignar" POR NEGOCIO: "sin-asignar" es la de Casa Tomás (id
// histórico) y "sin-asignar:<marca>" la de otro negocio (solo aparece si
// tiene reservas sin sala, p. ej. una de El Reservado llegada desde la web).
const SIN_ASIGNAR = "sin-asignar";
const idSinAsignar = (marca: string) =>
  normalizarMarca(marca) === MARCA_POR_DEFECTO ? SIN_ASIGNAR : `${SIN_ASIGNAR}:${normalizarMarca(marca)}`;
const esSinAsignar = (id: string) => id === SIN_ASIGNAR || id.startsWith(`${SIN_ASIGNAR}:`);
type FiltroTurno = "todo" | "comida" | "cena";

interface Columna {
  id: string;
  title: string;
  capacidadMax?: number;
  /** Negocio de la columna (casa_tomas | touza). */
  marca: string;
}

/** Columna en la que se pinta una reserva: su sala si es de su negocio; si no, "Sin asignar" de su negocio. */
function columnaDeReserva(reserva: ReservaServicio, columnas: Columna[]): string {
  const marca = marcaDeReserva(reserva as { marca?: string | null });
  const propia = reserva.espacio_id ? columnas.find((c) => c.id === reserva.espacio_id) : undefined;
  return propia && propia.marca === marca ? propia.id : idSinAsignar(marca);
}

type Acciones = ReturnType<typeof useAccionesServicioReserva>;

// Draggable reservation card
function ReservaCard({
  reserva,
  columnas,
  acciones,
  onMover,
  onToggleImportante,
  onBlacklist,
  onEditar,
  puedeEditar,
  isDragOverlay,
  anchoColumna,
}: {
  reserva: ReservaServicio;
  columnas: Columna[];
  acciones: Acciones;
  onMover: (reserva: ReservaServicio, destinoColumnaId: string) => void;
  onToggleImportante: (reserva: ReservaServicio) => void;
  onBlacklist: (reserva: ReservaServicio) => void;
  /** Abre el editor de la reserva (2026-09-30): está en el menú «⋮» de TODA tarjeta, movible o no. */
  onEditar?: (reserva: ReservaServicio) => void;
  /**
   * Permiso de edición sobre «reservas». Obligatorio a propósito (un valor por
   * defecto dejaría pasar a todo el mundo si alguien se olvida de pasarlo): sin él,
   * todo lo que escribe en la reserva sale deshabilitado, con el motivo visible.
   */
  puedeEditar: boolean;
  isDragOverlay?: boolean;
  /**
   * Ancho de la columna en la que vive la tarjeta. Decide si la botonera lleva
   * texto o solo iconos. Va por ancho de COLUMNA y no de ventana a propósito:
   * en la misma pantalla conviven Casa Tomás (5 columnas) y Touza (3), así que
   * sus columnas miden distinto y cada una decide por su cuenta.
   */
  anchoColumna?: number;
}) {
  // Qué se puede hacer con esta reserva en Hoy (servicio), según su estado y el permiso.
  const acc = accionesDisponibles(reserva, { vista: "hoy", canEdit: puedeEditar });
  // Se arrastra solo si se puede mover: que su estado lo permita Y que haya permiso.
  const arrastrable = acc.mover.habilitada;
  // Una reserva que por su estado no ocupa sitio («No vino») se ve apagada; sin
  // permiso, en cambio, se ve normal: lo único que cambia es que no se mueve.
  const ocupaSitio = ocupaEspacio(reserva.estado);
  const soloIcono = accionesSoloIcono(anchoColumna);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
    disabled: !arrastrable || isDragOverlay,
  });

  if (isDragOverlay) {
    return (
      <div
        className="p-2.5 sm:p-3 rounded-lg border-2 border-primary bg-card w-[200px] sm:w-[230px] shadow-2xl rotate-1 scale-[1.03] cursor-grabbing pointer-events-none"
      >
        <ContenidoTarjeta reserva={reserva} />
      </div>
    );
  }

  // Solo se puede mover dentro de su negocio: una reserva de Casa Tomás no
  // pasa a El Reservado (Touza) ni al revés (cambiaría de aforo sin cambiar
  // de negocio). Para eso, cancelar y crear otra.
  const columnaActual = columnaDeReserva(reserva, columnas);
  const marcaReserva = marcaDeReserva(reserva as { marca?: string | null });
  const destinos = columnas.filter((c) => c.id !== columnaActual && c.marca === marcaReserva);

  // El menú «…» de la tarjeta. En columnas estrechas baja a la fila de
  // acciones para dejarle al NOMBRE todo el ancho de la cabecera: con el menú
  // arriba (más la estrella y el asa) al nombre le quedaban 10px a 124px de
  // columna, o sea "L…". Abajo comparte fila con los iconos de llegada, que
  // ahí sí sobra sitio.
  const menuAcciones = (
    <div
      className="flex items-center shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            aria-label={`Acciones de la reserva de ${reserva.nombre || "sin nombre"}`}
          >
            {acciones.estaEnCurso(reserva.id) ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreVertical className="h-3.5 w-3.5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground font-normal">
            <MoveRight className="h-3.5 w-3.5" />
            Mover a…
          </DropdownMenuLabel>
          {acc.mover.habilitada ? (
            destinos.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => onMover(reserva, c.id)}>
                {c.title}
                {c.capacidadMax ? (
                  <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{c.capacidadMax} pax</span>
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            // El motivo, a la vista en el propio menú: «No se puede mover en este
            // estado» o «No tienes permiso para editar reservas».
            <DropdownMenuItem disabled>{acc.mover.titulo}</DropdownMenuItem>
          )}
          {reserva.telefono && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={`tel:${reserva.telefono}`}>
                  <Phone className="h-3.5 w-3.5 mr-2" />
                  Llamar
                </a>
              </DropdownMenuItem>
            </>
          )}
          {/* Editar datos, día, hora, comensales, sala o notas (2026-09-30). Va
              en el menú de TODA tarjeta —también las que no se pueden mover— y
              sin mirar el estado: lo único que lo apaga es el permiso. */}
          {onEditar && (
            <>
              <DropdownMenuSeparator />
              {/* El ítem deshabilitado no recibe el ratón: el motivo se ve en el envoltorio. */}
              <ConMotivo className="block" motivo={motivoSiNoSePuede(acc.editar)}>
                <DropdownMenuItem
                  disabled={!acc.editar.habilitada}
                  title={motivoSiNoSePuede(acc.editar)}
                  onSelect={() => onEditar(reserva)}
                >
                  <SquarePen className="h-3.5 w-3.5 mr-2" />
                  Editar reserva
                </DropdownMenuItem>
              </ConMotivo>
            </>
          )}
          <DropdownMenuSeparator />
          <ConMotivo className="block" motivo={motivoSiNoSePuede(acc.listaNegra)}>
            <DropdownMenuItem
              disabled={!acc.listaNegra.habilitada}
              onSelect={() => onBlacklist(reserva)}
              className="text-destructive focus:text-destructive"
            >
              <ShieldBan className="h-3.5 w-3.5 mr-2" />
              Añadir a blacklist
            </DropdownMenuItem>
          </ConMotivo>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Asa decorativa: se retira en columnas estrechas, donde esos 16px son
          la diferencia entre ver el nombre y no verlo. La tarjeta entera
          sigue siendo arrastrable. */}
      {arrastrable && !soloIcono && (
        <GripVertical className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" aria-hidden="true" />
      )}
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-card transition-shadow duration-200 group outline-none",
        soloIcono ? "p-2" : "p-2.5 sm:p-3",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        arrastrable
          ? "cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/30"
          : ocupaSitio
            ? "cursor-default"
            : "cursor-default opacity-60",
        isDragging && "opacity-30 border-dashed border-primary/40",
        reserva.importante && "border-amber-400 bg-amber-50/30 dark:bg-amber-950/20",
        (reserva as { en_blacklist?: boolean }).en_blacklist && "border-destructive/40 bg-destructive/5",
      )}
      aria-roledescription={arrastrable ? "reserva arrastrable" : "reserva"}
      aria-label={`${reserva.nombre || "Sin nombre"}, ${reserva.hora?.substring(0, 5)}, ${reserva.numero_comensales} comensales, ${etiquetaEstadoReserva(reserva.estado)}`}
      {...(arrastrable ? listeners : {})}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Sin permiso, deshabilitada y con el motivo a la vista (en el envoltorio:
              un botón deshabilitado no recibe el ratón). */}
          <ConMotivo motivo={motivoSiNoSePuede(acc.importante)}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleImportante(reserva); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!acc.importante.habilitada}
              className="shrink-0 -m-1 p-1 touch-manipulation hover:scale-110 transition-transform disabled:pointer-events-none disabled:opacity-50"
              aria-label={reserva.importante ? "Quitar importante" : "Marcar como importante"}
              aria-pressed={!!reserva.importante}
            >
              <Star className={cn("h-3.5 w-3.5", reserva.importante ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30 hover:text-amber-400")} />
            </button>
          </ConMotivo>
          {/* `title`: con las columnas estrechas (112–220px) los nombres largos
              se cortan con puntos suspensivos; el completo se lee al pasar el
              ratón, además de estar en el `aria-label` de la tarjeta. */}
          <span className="font-semibold text-sm truncate" title={reserva.nombre || "Sin nombre"}>
            {reserva.nombre || "Sin nombre"}
          </span>
          {(reserva as { en_blacklist?: boolean }).en_blacklist && (
            <ShieldBan className="h-3.5 w-3.5 text-destructive shrink-0" aria-label="En lista negra" />
          )}
        </div>
        {!soloIcono && menuAcciones}
      </div>
      <ContenidoTarjeta reserva={reserva} sinCabecera />
      {soloIcono ? (
        /* `flex-wrap`: antes que recortar un botón, que baje de línea. Así el
           suelo de ancho de columna lo marca el elemento suelto más ancho y no
           la fila entera. */
        <div className="flex flex-wrap items-center gap-1 mt-2">
          <ControlLlegada reserva={reserva} acciones={acciones} canEdit={puedeEditar} compacto soloIcono />
          {menuAcciones}
        </div>
      ) : (
        <ControlLlegada reserva={reserva} acciones={acciones} canEdit={puedeEditar} compacto className="mt-2" />
      )}
    </div>
  );
}

function ContenidoTarjeta({
  reserva,
  sinCabecera,
}: {
  reserva: ReservaServicio;
  sinCabecera?: boolean;
}) {
  // Nombre y color del estado, del mapa único. Un estado que no existe (el CHECK no
  // lo permite) se pinta tal cual y en gris, como hacía este kanban.
  const estado = infoEstadoReserva(reserva.estado);
  return (
    <>
      {!sinCabecera && (
        <div className="flex items-center gap-1.5 min-w-0 mb-2">
          {reserva.importante && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />}
          <span className="font-semibold text-sm truncate">{reserva.nombre || "Sin nombre"}</span>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1 bg-muted/50 rounded-md px-1.5 py-0.5 tabular-nums">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}
        </span>
        <span className="flex items-center gap-1 bg-muted/50 rounded-md px-1.5 py-0.5 tabular-nums">
          <Users className="h-3 w-3" aria-hidden="true" />
          {reserva.numero_comensales}
        </span>
        <Badge className={cn("text-[10px] px-1.5 py-0 h-4", estado ? estado.insignia : "bg-gray-500 text-white")}>
          {estado ? estado.etiqueta : reserva.estado}
        </Badge>
      </div>
      {reserva.telefono && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 mt-1.5">
          <Phone className="h-2.5 w-2.5" aria-hidden="true" />
          {reserva.telefono}
        </div>
      )}
    </>
  );
}

function BarraTurno({ etiqueta, pax, capacidad }: { etiqueta: string; pax: number; capacidad: number }) {
  const porcentaje = capacidad ? Math.min(100, Math.round((pax / capacidad) * 100)) : 0;
  const excedido = pax > capacidad;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
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
}: {
  id: string;
  title: string;
  capacidadMax?: number;
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
  alturaMaxima: string;
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
          <Badge variant="secondary" className="text-[10px] px-1.5 tabular-nums">{count}</Badge>
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
              className="p-0.5 rounded hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Minimizar columna ${title}`}
              title="Minimizar columna"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <h4 className="font-semibold text-sm">{title}</h4>
          </div>
          <Badge variant="secondary" className="text-xs tabular-nums">{count}</Badge>
        </div>
        {capacidadMax != null && capacidadMax > 0 && (
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
        className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block"
        style={{ maxHeight: alturaMaxima }}
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
 * Fila de columnas de UN negocio. Cumple los dos encargos del dueño:
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
 * Por qué una fila por negocio y no todas en la misma: cuando Casa Tomás y
 * Touza convivían en la MISMA fila con scroll, el ancho pedido era siempre
 * mayor que el disponible y la última columna quedaba cortada por el borde.
 * Apilando los negocios, cada uno dispone del ancho completo.
 *
 * El ancho se mide con ResizeObserver, no por breakpoints: el ancho real
 * depende del sidebar, que se pliega.
 */
function FilaNegocio({
  etiqueta,
  aforo,
  mostrarCabecera,
  items,
  arrastrando,
  children,
}: {
  etiqueta: string;
  aforo?: { comida: number; cena: number; capacidad: number };
  mostrarCabecera: boolean;
  items: ItemColumna[];
  arrastrando: boolean;
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

  const disposicion = useMemo(() => calcularDisposicion(items, ancho), [items, ancho]);

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
    <section
      aria-label={etiqueta}
      className={cn("flex flex-col gap-2 min-w-0", mostrarCabecera && "rounded-xl border border-dashed p-2")}
    >
      {(mostrarCabecera || desplazable) && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1 text-xs min-w-0">
          {mostrarCabecera && (
            <>
              <span className="font-semibold">{etiqueta}</span>
              {aforo && aforo.capacidad > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  aforo comida {aforo.comida}/{aforo.capacidad} · cena {aforo.cena}/{aforo.capacidad}
                </span>
              )}
            </>
          )}
          {desplazable && (
            <div className="ml-auto flex items-center gap-1 self-center">
              <span
                role="status"
                className="text-muted-foreground tabular-nums"
                aria-label={`Viendo los espacios ${desde} a ${hasta} de ${items.length} de ${etiqueta}`}
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
                aria-label={`Ver los espacios anteriores de ${etiqueta}`}
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
                aria-label={`Ver los siguientes espacios de ${etiqueta}`}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="relative min-w-0">
        <div
          ref={scrollRef}
          onScroll={alDesplazar}
          className={cn(
            // `min-w-0` + `overflow-x-auto` AQUÍ: el scroll horizontal se
            // contiene en el kanban y nunca sube a los layouts (ya rompió
            // `position: sticky` en toda la app una vez).
            "flex min-w-0 overflow-x-auto overflow-y-hidden py-2",
            desplazable ? "[scrollbar-width:thin]" : "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
const deteccionColisiones: CollisionDetection = (args) => {
  const bajoPuntero = pointerWithin(args);
  return bajoPuntero.length > 0 ? bajoPuntero : rectIntersection(args);
};

/**
 * Un movimiento que se confirma antes de hacerlo. Hay DOS motivos para preguntar y
 * pueden darse a la vez (entonces sale un solo aviso con los dos):
 *   · `excede`: la sala de destino se pasaría de aforo en ese turno.
 *   · `mesas`: la reserva tiene mesas asignadas y el trigger de la BD
 *     (`trg_reservas_sincronizar_asignaciones`) las BORRA al cambiar la sala.
 */
interface MovimientoPendiente {
  reserva: ReservaServicio;
  destinoId: string | null;
  destinoNombre: string;
  excede: { ocupacionTras: number; capacidad: number; turno: "comida" | "cena" } | null;
  mesas: { nombres: string[]; salaActual: string | null } | null;
}

export function GestorReservasKanban() {
  const { data: espacios } = useEspaciosReserva();
  const acciones = useAccionesServicioReserva();
  // Permiso de edición sobre «reservas». Antes solo lo miraba el editor y el resto
  // del kanban se apoyaba en la RLS de la BD; ahora TODO lo que escribe en una
  // reserva (estrella, llegada, no vino, deshacer, mover, lista negra, editar)
  // sale deshabilitado sin él, con el motivo a la vista (`accionesDisponibles`).
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const [activeReserva, setActiveReserva] = useState<ReservaServicio | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTurno, setFiltroTurno] = useState<FiltroTurno>("todo");
  // Columnas plegadas a carril, SIEMPRE por decisión del usuario: ya no hay
  // plegado automático (2026-09-26, el dueño lo rechazó: "tienen que estar
  // todos aunque ocupen menos espacio de ancho por columna"). Por defecto el
  // conjunto está vacío, o sea: todas abiertas.
  const [minimizedCols, setMinimizedCols] = useState<Set<string>>(new Set());
  const [movimientoPendiente, setMovimientoPendiente] = useState<MovimientoPendiente | null>(null);
  const [blacklistReserva, setBlacklistReserva] = useState<ReservaServicio | null>(null);
  const hoy = format(new Date(), "yyyy-MM-dd");

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
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // Reservas de hoy de TODOS los negocios (decisión del dueño 2026-09-24):
  // Casa Tomás con sus salas y Touza con "El Reservado", agrupados por
  // negocio y con el aforo de cada uno por separado (como el trigger).
  //
  // `select("*")`: trae `llegada_at` si la migración 20260923_reservas_llegada
  // está aplicada, sin romper si no lo está (nombrarla en la lista fallaría),
  // y `marca`. `as any`: `marca` no está en los tipos generados.
  //
  // La clave empieza por "reservas-kanban": useAccionesServicioReserva hace el
  // update optimista por prefijo.
  const {
    data: reservas,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservas-kanban", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", hoy)
        .neq("estado", "cancelada")
        .order("hora", { ascending: true });
      if (error) throw error;
      return data as unknown as ReservaServicio[];
    },
  });

  // Mesas asignadas de hoy, por reserva: sirven para avisar ANTES de mover a otra
  // sala una reserva que tiene mesa (el trigger de la BD las borra). Es la misma
  // consulta —y la misma clave de caché— que ya pide `VistaHoy`, así que no cuesta
  // una petición más; `CLAVE_ASIGNACIONES_MESA` la refresca al cambiar de sala. Si
  // aún no ha llegado (o falla) no se bloquea el movimiento: el trigger tampoco lo
  // bloquea, para no romper el kanban.
  const { data: asignacionesDeHoy } = useAsignacionesMesa(hoy);
  const mesasPorReserva = useMemo(() => {
    const porReserva = new Map<string, string[]>();
    for (const a of asignacionesDeHoy ?? []) {
      if (!a?.reserva_id) continue;
      porReserva.set(a.reserva_id, [...(porReserva.get(a.reserva_id) ?? []), a.mesas?.nombre ?? ""]);
    }
    for (const nombres of porReserva.values()) {
      nombres.sort((x, y) => x.localeCompare(y, "es", { numeric: true }));
    }
    return porReserva;
  }, [asignacionesDeHoy]);

  const espaciosActivos = useMemo(
    () => (espacios || []).filter((e: any) => e.activa !== false),
    [espacios],
  );

  // Grupos de columnas por negocio. Casa Tomás: "Sin asignar" + sus salas.
  // Otro negocio (Touza): sus salas ("El Reservado") y, solo si hace falta,
  // su propio "Sin asignar".
  const grupos = useMemo(() => {
    const todas = reservas || [];
    return agruparPorNegocio(
      [
        ...espaciosActivos.map((e: any) => ({ tipo: "espacio" as const, marca: marcaDeEspacio(e), e })),
        ...todas.map((r) => ({ tipo: "reserva" as const, marca: marcaDeReserva(r as { marca?: string | null }), e: null })),
      ],
      (x) => x.marca,
      [MARCA_POR_DEFECTO],
    ).map(({ negocio, items }) => {
      const salas: Columna[] = items
        .filter((x) => x.tipo === "espacio")
        .map((x: any) => ({ id: x.e.id, title: x.e.nombre, capacidadMax: x.e.capacidad_maxima, marca: negocio.marca }));
      const idsSalas = new Set(salas.map((c) => c.id));
      const hayHuerfanas = todas.some(
        (r) =>
          marcaDeReserva(r as { marca?: string | null }) === negocio.marca &&
          (!r.espacio_id || !idsSalas.has(r.espacio_id)),
      );
      const sinAsignar: Columna = {
        id: idSinAsignar(negocio.marca),
        title: negocio.marca === MARCA_POR_DEFECTO ? "Sin asignar" : `Sin asignar (${negocio.nombre})`,
        marca: negocio.marca,
      };
      const columnasGrupo =
        negocio.marca === MARCA_POR_DEFECTO || hayHuerfanas || salas.length === 0 ? [sinAsignar, ...salas] : salas;
      return { negocio, columnas: columnasGrupo };
    });
  }, [espaciosActivos, reservas]);

  const columnas = useMemo<Columna[]>(() => grupos.flatMap((g) => g.columnas), [grupos]);

  // Aforo del turno POR NEGOCIO (lo que valida el trigger): reservas que
  // ocupan (pendiente/verificada/confirmada) de ese negocio contra la suma
  // de SUS salas. Las de Touza nunca cuentan contra Casa Tomás.
  const aforoPorNegocio = useMemo(() => {
    const todas = reservas || [];
    const map: Record<string, { comida: number; cena: number; capacidad: number }> = {};
    for (const g of grupos) {
      const propias = todas.filter(
        (r) =>
          marcaDeReserva(r as { marca?: string | null }) === g.negocio.marca &&
          (ESTADOS_QUE_OCUPAN as readonly string[]).includes(r.estado),
      );
      const pax = (turno: "comida" | "cena") =>
        propias.filter((r) => turnoDeHora(r.hora) === turno).reduce((s, r) => s + (Number(r.numero_comensales) || 0), 0);
      map[g.negocio.marca] = {
        comida: pax("comida"),
        cena: pax("cena"),
        capacidad: g.columnas.reduce((s, c) => s + (c.capacidadMax || 0), 0),
      };
    }
    return map;
  }, [grupos, reservas]);

  const reservasFiltradas = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return (reservas || []).filter((r) => {
      if (filtroTurno !== "todo" && turnoDeHora(r.hora) !== filtroTurno) return false;
      if (!q) return true;
      return (
        (r.nombre || "").toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        (r.telefono || "").includes(q)
      );
    });
  }, [reservas, busqueda, filtroTurno]);

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
  // filtre. Cada columna cuenta solo reservas de SU negocio.
  const paxPorColumna = useMemo(() => {
    const todas = reservas || [];
    const map: Record<string, { comida: number; cena: number }> = {};
    columnas.forEach((c) => {
      const delNegocio = todas.filter((r) => marcaDeReserva(r as { marca?: string | null }) === c.marca);
      const espacioId = esSinAsignar(c.id) ? null : c.id;
      map[c.id] = {
        comida: comensalesEnEspacioTurno(delNegocio, espacioId, "comida"),
        cena: comensalesEnEspacioTurno(delNegocio, espacioId, "cena"),
      };
    });
    return map;
  }, [reservas, columnas]);

  const nombreColumna = (id: string | number | undefined | null) =>
    columnas.find((c) => c.id === id)?.title ?? "Sin asignar";

  const solicitarMovimiento = (reserva: ReservaServicio, columnaId: string) => {
    const destinoId = esSinAsignar(columnaId) ? null : columnaId;
    const col = columnas.find((c) => c.id === columnaId);
    const marcaReserva = marcaDeReserva(reserva as { marca?: string | null });
    if (col && col.marca !== marcaReserva) {
      toast.error(
        `Esta reserva es de ${etiquetaNegocio(marcaReserva)} y «${col.title}» es de ${etiquetaNegocio(col.marca)}. ` +
          "No se puede mover entre negocios: cancélala y crea una nueva.",
      );
      return;
    }
    const delNegocio = (reservas || []).filter((r) => marcaDeReserva(r as { marca?: string | null }) === marcaReserva);
    const evaluacion = evaluarMovimiento(reserva, destinoId, delNegocio, col?.capacidadMax);

    switch (evaluacion.tipo) {
      case "sin_cambio":
        return;
      case "bloqueado":
        toast.error(evaluacion.motivo);
        return;
      case "excede_capacidad":
      case "ok": {
        const destinoNombre = col?.title ?? "Sin asignar";
        const excede =
          evaluacion.tipo === "excede_capacidad"
            ? { ocupacionTras: evaluacion.ocupacionTras, capacidad: evaluacion.capacidad ?? 0, turno: evaluacion.turno }
            : null;
        const nombresMesas = mesasPorReserva.get(reserva.id);
        const mesas = nombresMesas
          ? {
              nombres: nombresMesas,
              salaActual: columnas.find((c) => c.id === columnaDeReserva(reserva, columnas))?.title ?? null,
            }
          : null;
        if (!excede && !mesas) {
          void acciones.moverEspacio(reserva, destinoId, destinoNombre);
          return;
        }
        setMovimientoPendiente({ reserva, destinoId, destinoNombre, excede, mesas });
      }
    }
  };

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
      {/* `flex-wrap`: por debajo de ~1100px el texto de ayuda se baja a su
          propia línea en vez de estrujar el filtro de turno hasta partir
          "Todo el día" en dos renglones. */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
        <div className="relative w-full min-w-0 sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por nombre, email o teléfono…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
            aria-label="Buscar reservas"
          />
        </div>
        <ToggleGroup
          type="single"
          value={filtroTurno}
          onValueChange={(v) => v && setFiltroTurno(v as FiltroTurno)}
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label="Filtrar por turno"
        >
          <ToggleGroupItem value="todo" className="whitespace-nowrap">Todo el día</ToggleGroupItem>
          <ToggleGroupItem value="comida" className="whitespace-nowrap">Comida</ToggleGroupItem>
          <ToggleGroupItem value="cena" className="whitespace-nowrap">Cena</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground sm:basis-full lg:basis-auto lg:ml-auto">
          Arrastra una tarjeta a otro espacio o usa <MoreVertical className="inline h-3 w-3" aria-hidden="true" /> → «Mover a…».
        </p>
      </div>

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
        {/* Los negocios se APILAN (antes iban uno al lado del otro y entre los
            dos nunca cabían): así cada uno dispone del ancho completo. */}
        <div className="flex flex-col gap-3 min-w-0 flex-1">
          {grupos.map(({ negocio, columnas: columnasGrupo }) => {
            const cuenta = (id: string) => reservasPorColumna[id]?.length || 0;
            const itemsFila: ItemColumna[] = columnasGrupo.map((col) => ({
              id: col.id,
              plegada: minimizedCols.has(col.id),
            }));
            return (
              <FilaNegocio
                key={negocio.marca}
                etiqueta={negocio.etiqueta}
                aforo={aforoPorNegocio[negocio.marca]}
                mostrarCabecera={grupos.length > 1}
                items={itemsFila}
                arrastrando={!!activeReserva}
              >
                {(disposicion) =>
                  columnasGrupo.map((col) => {
                    const plegada = minimizedCols.has(col.id);
                    return (
                      <KanbanColumn
                        key={col.id}
                        id={col.id}
                        title={col.title}
                        capacidadMax={col.capacidadMax}
                        paxComida={paxPorColumna[col.id]?.comida ?? 0}
                        paxCena={paxPorColumna[col.id]?.cena ?? 0}
                        filtroTurno={filtroTurno}
                        count={cuenta(col.id)}
                        isActive={!!activeReserva}
                        minimized={plegada}
                        onToggleMinimize={() => togglePlegado(col.id)}
                        ancho={disposicion.anchoColumna}
                        margenDerecho={disposicion.margenes[col.id] ?? 0}
                        conIman={disposicion.idsConIman.includes(col.id)}
                        alturaMaxima={grupos.length > 1 ? "42vh" : "65vh"}
                      >
                        {(reservasPorColumna[col.id] || []).map((reserva) => (
                          <ReservaCard
                            key={reserva.id}
                            reserva={reserva}
                            columnas={columnas}
                            acciones={acciones}
                            onMover={solicitarMovimiento}
                            onToggleImportante={toggleImportante}
                            onBlacklist={setBlacklistReserva}
                            onEditar={(r) => editarReserva(r.id)}
                            puedeEditar={puedeEditar}
                            anchoColumna={disposicion.anchoColumna}
                          />
                        ))}
                      </KanbanColumn>
                    );
                  })
                }
              </FilaNegocio>
            );
          })}
        </div>

        <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeReserva ? (
            <ReservaCard
              reserva={activeReserva}
              columnas={columnas}
              acciones={acciones}
              onMover={solicitarMovimiento}
              onToggleImportante={toggleImportante}
              onBlacklist={setBlacklistReserva}
              puedeEditar={puedeEditar}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <AlertDialog open={!!movimientoPendiente} onOpenChange={(open) => !open && setMovimientoPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* Si se pasa de aforo manda ese aviso (el de siempre); si solo hay mesas
                que se van a quitar, el mismo aviso que el panel de Asignación. */}
            <AlertDialogTitle>
              {movimientoPendiente?.excede
                ? `¿Superar la capacidad de ${movimientoPendiente.destinoNombre}?`
                : "¿Cambiar de sala y quitar sus mesas?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {movimientoPendiente?.excede && (
                  <p>
                    {`Con la reserva de ${movimientoPendiente.reserva.nombre || "este cliente"} (${movimientoPendiente.reserva.numero_comensales} pax), el turno de ${movimientoPendiente.excede.turno === "comida" ? "comida" : "cena"} de ${movimientoPendiente.destinoNombre} quedaría en ${movimientoPendiente.excede.ocupacionTras} de ${movimientoPendiente.excede.capacidad} plazas.`}
                  </p>
                )}
                {movimientoPendiente?.mesas && (
                  <>
                    <p>
                      {textoQuitarMesas({
                        nombre: movimientoPendiente.reserva.nombre,
                        cantidad: movimientoPendiente.mesas.nombres.length,
                        mesasNombres: movimientoPendiente.mesas.nombres,
                        salaActual: movimientoPendiente.mesas.salaActual,
                        destinoNombre: movimientoPendiente.destinoNombre,
                      })}
                    </p>
                    <p>{TEXTO_CAMBIO_INTERNO}</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No mover</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const m = movimientoPendiente;
                setMovimientoPendiente(null);
                if (m) void acciones.moverEspacio(m.reserva, m.destinoId, m.destinoNombre);
              }}
            >
              {movimientoPendiente?.excede ? "Mover igualmente" : "Cambiar de sala"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
