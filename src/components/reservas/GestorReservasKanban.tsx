import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
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
  useDraggable,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent, CollisionDetection, Announcements } from "@dnd-kit/core";
import type { Modifier } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { turnoDeHora } from "@/hooks/useDisponibilidad";
import { admiteReservas, salaAdmiteReservas } from "@/lib/reservas/negocios";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { esSalaPrivada } from "@/lib/reservas/salaPrivada";
import { EtiquetaFueraDeAforo } from "./EtiquetaFueraDeAforo";
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
import { ElegirMesaDialog } from "./ElegirMesaDialog";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useIsCoarsePointer } from "@/hooks/use-mobile";
import {
  ANCHO_COLUMNA_PLEGADA,
  ANCHO_MIN_COLUMNA,
  ANCHO_MIN_COLUMNA_TACTIL,
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

// Solo Casa Tomás (decisión del dueño, 2026-10-01: Touza no admite reservas).
// Las columnas son «Sin asignar» + las salas activas de Casa Tomás, y las
// reservas, las de Casa Tomás: lo que quede de Touza en la base de datos (sus
// salas aún activas, sus reservas de demostración) no sale (`admiteReservas`).
// Antes los negocios iban en filas de columnas apiladas, cada una con su aforo.
const SIN_ASIGNAR = "sin-asignar";
const esSinAsignar = (id: string) => id === SIN_ASIGNAR;
type FiltroTurno = "todo" | "comida" | "cena";

interface Columna {
  id: string;
  title: string;
  capacidadMax?: number;
  /** Sala privada (`caracteristicas.privada`, el Reservado): una reserva se queda la sala entera. */
  privada?: boolean;
}

/** Columna en la que se pinta una reserva: su sala si está entre las columnas; si no, "Sin asignar". */
function columnaDeReserva(reserva: ReservaServicio, columnas: Columna[]): string {
  return reserva.espacio_id && columnas.some((c) => c.id === reserva.espacio_id) ? reserva.espacio_id : SIN_ASIGNAR;
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
   * el mismo ancho de ventana da columnas distintas según cuántas salas haya
   * y el menú lateral, así que cada columna decide por su cuenta.
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

  const columnaActual = columnaDeReserva(reserva, columnas);
  const destinos = columnas.filter((c) => c.id !== columnaActual);
  // En una sala privada (el Reservado) la reserva está FUERA DE AFORO: se etiqueta.
  const fueraDeAforo = !!columnas.find((c) => c.id === columnaActual)?.privada;

  // El menú «…» de la tarjeta. En columnas estrechas baja a la fila de
  // acciones para dejarle al NOMBRE todo el ancho de la cabecera: con el menú
  // arriba (más la estrella y el asa) al nombre le quedaban 10px a 124px de
  // columna, o sea "L…". Abajo comparte fila con los iconos de llegada, que
  // ahí sí sobra sitio.
  const menuAcciones = (
    <div
      className="flex items-center shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      // `TouchSensor` escucha `touchstart` en la tarjeta: sin esto, un toque de >=250 ms sobre el
      // menú arrancaba un arrastre y dnd-kit se tragaba el clic.
      onTouchStart={(e) => e.stopPropagation()}
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
        "rounded-lg border bg-card transition-shadow duration-200 group outline-none select-none [-webkit-touch-callout:none]",
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
              onTouchStart={(e) => e.stopPropagation()}
              disabled={!acc.importante.habilitada}
              className="touch-hit shrink-0 -m-1 p-1 touch-manipulation hover:scale-110 transition-transform disabled:pointer-events-none disabled:opacity-50"
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
      {fueraDeAforo && <EtiquetaFueraDeAforo className="mb-2" />}
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
        <Badge className={cn("text-[10px] px-1.5 py-0 h-4 pointer-coarse:h-5 pointer-coarse:text-xs", estado ? estado.insignia : "bg-gray-500 text-white")}>
          {estado ? estado.etiqueta : reserva.estado}
        </Badge>
      </div>
      {reserva.telefono && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 mt-1.5 pointer-coarse:text-xs">
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
}: {
  id: string;
  title: string;
  capacidadMax?: number;
  /** Sala privada (el Reservado): fuera de aforo; no tiene barras de aforo y lleva su etiqueta. */
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
              className="touch-target inline-flex items-center justify-center p-0.5 -ml-1 rounded hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Minimizar columna ${title}`}
              title="Minimizar columna"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <h4 className="font-semibold text-sm">{title}</h4>
          </div>
          <Badge variant="secondary" className="text-xs tabular-nums">{count}</Badge>
        </div>
        {privada && <EtiquetaFueraDeAforo />}
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
 */
function FilaColumnas({
  items,
  arrastrando,
  children,
}: {
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
    <section aria-label="Salas de hoy" className="flex flex-col gap-2 min-w-0">
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
  const dedo = useIsCoarsePointer();
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
  // La reserva que se acaba de mover y la sala a la que ha ido: tras guardarse el cambio se abre el
  // mapa de esa sala para elegirle la mesa (`ElegirMesaDialog`). `null` hasta que se mueve algo.
  const [mapaMesa, setMapaMesa] = useState<{ reserva: ReservaServicio; espacioId: string; espacioNombre: string } | null>(null);
  const cerrarMapaMesa = useCallback(() => setMapaMesa(null), []);
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

  // Salas activas de Casa Tomás, por id (hay dos «Terraza», una de cada negocio).
  const espaciosActivos = useMemo(
    () => (espacios || []).filter((e: any) => e.activa !== false && salaAdmiteReservas(e)),
    [espacios],
  );

  // Columnas: "Sin asignar" + las salas de Casa Tomás.
  const columnas = useMemo<Columna[]>(
    () => [
      { id: SIN_ASIGNAR, title: "Sin asignar" },
      ...espaciosActivos.map((e: any) => ({
        id: e.id,
        title: e.nombre,
        capacidadMax: e.capacidad_maxima,
        privada: esSalaPrivada(e),
      })),
    ],
    [espaciosActivos],
  );
  const itemsFila = useMemo<ItemColumna[]>(
    () => columnas.map((col) => ({ id: col.id, plegada: minimizedCols.has(col.id) })),
    [columnas, minimizedCols],
  );

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

  const nombreColumna = (id: string | number | undefined | null) =>
    columnas.find((c) => c.id === id)?.title ?? "Sin asignar";

  /**
   * Hace el movimiento (ya confirmado, si hacía falta) y, SOLO si se ha guardado, abre el mapa de la
   * sala de destino para elegirle la mesa. Los dos caminos de mover (arrastrar y «Mover a…») y las
   * dos confirmaciones (aforo y mesas) acaban aquí.
   *
   * «Sin asignar» no tiene plano y no se abre nada. Con una sala, `ElegirMesaDialog` comprueba por su
   * cuenta que tenga mesas (por id de sala, nunca por nombre): si no las tiene no pinta nada y se cierra sin ruido.
   */
  const moverYElegirMesa = async (reserva: ReservaServicio, destinoId: string | null, destinoNombre: string) => {
    const movida = await acciones.moverEspacio(reserva, destinoId, destinoNombre);
    // Una sola reserva a la vez: si ya había un mapa abierto, éste lo sustituye (no se apilan).
    if (movida && destinoId) setMapaMesa({ reserva, espacioId: destinoId, espacioNombre: destinoNombre });
  };

  const solicitarMovimiento = (reserva: ReservaServicio, columnaId: string) => {
    const destinoId = esSinAsignar(columnaId) ? null : columnaId;
    const col = columnas.find((c) => c.id === columnaId);
    // Sala privada (el Reservado): una reserva se la queda entera; si ya hay otra en ese turno, se avisa aquí
    // en vez de dejar que la BD lo rechace (23514 «Sala privada ocupada»).
    const evaluacion = evaluarMovimiento(
      reserva,
      destinoId,
      reservas || [],
      col?.capacidadMax,
      col?.privada ? { nombre: col.title } : null,
    );

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
          void moverYElegirMesa(reserva, destinoId, destinoNombre);
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
          Mantén pulsada una tarjeta y arrástrala a otro espacio, o usa <MoreVertical className="inline h-3 w-3" aria-hidden="true" /> → «Mover a…».
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
        <div className="flex flex-col gap-3 min-w-0 flex-1">
          <FilaColumnas items={itemsFila} arrastrando={!!activeReserva}>
            {(disposicion) =>
              columnas.map((col) => {
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
                    alturaMaxima="65dvh"
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
                if (m) void moverYElegirMesa(m.reserva, m.destinoId, m.destinoNombre);
              }}
            >
              {movimientoPendiente?.excede ? "Mover igualmente" : "Cambiar de sala"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tras mover una reserva a una sala con plano: el mapa de esa sala, con la reserva ya señalada,
          para elegirle la mesa. «Ahora no» (o cerrar) la deja en la sala, sin mesa. Va FUERA del DndContext. */}
      {mapaMesa && (
        <ElegirMesaDialog
          key={`${mapaMesa.reserva.id}|${mapaMesa.espacioId}`}
          reserva={mapaMesa.reserva}
          fecha={hoy}
          espacioId={mapaMesa.espacioId}
          espacioNombre={mapaMesa.espacioNombre}
          onCerrar={cerrarMapaMesa}
        />
      )}

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
