import { useState, useMemo } from "react";
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
import {
  comensalesEnEspacioTurno,
  evaluarMovimiento,
  puedeMoverReserva,
  type ReservaServicio,
} from "@/lib/reservas/servicioSala";
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
import { Clock, Users, Star, GripVertical, Phone, Search, ChevronDown, ChevronRight, MoveRight, MoreVertical, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { ControlLlegada } from "./ControlLlegada";

// Estados del CHECK `reservas_estado_check`. Antes este mapa usaba "no-show"
// (con guion, nunca casaba) y "rechazada" (no existe en la BD).
const ESTADOS_RESERVA: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500" },
  verificada: { label: "Verificada", color: "bg-blue-500" },
  confirmada: { label: "Confirmada", color: "bg-green-500" },
  cancelada: { label: "Cancelada", color: "bg-red-500" },
  completada: { label: "Llegó", color: "bg-emerald-600" },
  no_show: { label: "No vino", color: "bg-gray-500" },
};

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
  isDragOverlay,
}: {
  reserva: ReservaServicio;
  columnas: Columna[];
  acciones: Acciones;
  onMover: (reserva: ReservaServicio, destinoColumnaId: string) => void;
  isDragOverlay?: boolean;
}) {
  const movible = puedeMoverReserva(reserva.estado);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
    disabled: !movible || isDragOverlay,
  });

  const estadoInfo = ESTADOS_RESERVA[reserva.estado] || { label: reserva.estado, color: "bg-gray-500" };

  if (isDragOverlay) {
    return (
      <div
        className="p-2.5 sm:p-3 rounded-lg border-2 border-primary bg-card w-[200px] sm:w-[230px] shadow-2xl rotate-1 scale-[1.03] cursor-grabbing pointer-events-none"
      >
        <ContenidoTarjeta reserva={reserva} estadoInfo={estadoInfo} />
      </div>
    );
  }

  // Solo se puede mover dentro de su negocio: una reserva de Casa Tomás no
  // pasa a El Reservado (Touza) ni al revés (cambiaría de aforo sin cambiar
  // de negocio). Para eso, cancelar y crear otra.
  const columnaActual = columnaDeReserva(reserva, columnas);
  const marcaReserva = marcaDeReserva(reserva as { marca?: string | null });
  const destinos = columnas.filter((c) => c.id !== columnaActual && c.marca === marcaReserva);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "p-2.5 sm:p-3 rounded-lg border bg-card transition-shadow duration-200 group outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        movible ? "cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/30" : "cursor-default opacity-60",
        isDragging && "opacity-30 border-dashed border-primary/40",
        reserva.importante && "border-amber-400 bg-amber-50/30 dark:bg-amber-950/20",
      )}
      aria-roledescription={movible ? "reserva arrastrable" : "reserva"}
      aria-label={`${reserva.nombre || "Sin nombre"}, ${reserva.hora?.substring(0, 5)}, ${reserva.numero_comensales} comensales, ${estadoInfo.label}`}
      {...(movible ? listeners : {})}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {reserva.importante && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" aria-label="Importante" />}
          <span className="font-semibold text-sm truncate">{reserva.nombre || "Sin nombre"}</span>
        </div>
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
              {movible ? (
                destinos.map((c) => (
                  <DropdownMenuItem key={c.id} onSelect={() => onMover(reserva, c.id)}>
                    {c.title}
                    {c.capacidadMax ? (
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{c.capacidadMax} pax</span>
                    ) : null}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>No se puede mover en este estado</DropdownMenuItem>
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
            </DropdownMenuContent>
          </DropdownMenu>
          {movible && (
            <GripVertical className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" aria-hidden="true" />
          )}
        </div>
      </div>
      <ContenidoTarjeta reserva={reserva} estadoInfo={estadoInfo} sinCabecera />
      <ControlLlegada reserva={reserva} acciones={acciones} compacto className="mt-2" />
    </div>
  );
}

function ContenidoTarjeta({
  reserva,
  estadoInfo,
  sinCabecera,
}: {
  reserva: ReservaServicio;
  estadoInfo: { label: string; color: string };
  sinCabecera?: boolean;
}) {
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
        <Badge className={cn("text-[10px] px-1.5 py-0 text-white h-4", estadoInfo.color)}>
          {estadoInfo.label}
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
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  if (minimized) {
    return (
      <button
        type="button"
        ref={setNodeRef}
        className={cn(
          "flex flex-col items-center rounded-xl border-2 bg-muted/20 w-[42px] sm:w-[52px] shrink-0 transition-colors duration-200",
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
      className={cn(
        "flex flex-col rounded-xl border-2 bg-muted/20 min-w-[210px] w-[230px] sm:min-w-[250px] sm:w-[270px] shrink-0 transition-colors duration-200",
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
      <ScrollArea className="flex-1 max-h-[65vh]">
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

// Primero lo que está bajo el puntero (preciso con columnas estrechas o
// minimizadas); si no hay nada — teclado, o el puntero entre columnas — el
// rectángulo con más intersección. `closestCenter`, lo que había, elegía a
// veces la columna vecina al soltar sobre el borde.
const deteccionColisiones: CollisionDetection = (args) => {
  const bajoPuntero = pointerWithin(args);
  return bajoPuntero.length > 0 ? bajoPuntero : rectIntersection(args);
};

interface MovimientoPendiente {
  reserva: ReservaServicio;
  destinoId: string | null;
  destinoNombre: string;
  ocupacionTras: number;
  capacidad: number;
  turno: "comida" | "cena";
}

export function GestorReservasKanban() {
  const { data: espacios } = useEspaciosReserva();
  const acciones = useAccionesServicioReserva();
  const [activeReserva, setActiveReserva] = useState<ReservaServicio | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTurno, setFiltroTurno] = useState<FiltroTurno>("todo");
  const [minimizedCols, setMinimizedCols] = useState<Set<string>>(new Set());
  const [movimientoPendiente, setMovimientoPendiente] = useState<MovimientoPendiente | null>(null);
  const hoy = format(new Date(), "yyyy-MM-dd");

  const toggleMinimize = (colId: string) => {
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
        setMovimientoPendiente({
          reserva,
          destinoId,
          destinoNombre: col?.title ?? "Sin asignar",
          ocupacionTras: evaluacion.ocupacionTras,
          capacidad: evaluacion.capacidad ?? 0,
          turno: evaluacion.turno,
        });
        return;
      case "ok":
        void acciones.moverEspacio(reserva, destinoId, col?.title ?? "Sin asignar");
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="relative w-full sm:max-w-sm">
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
          aria-label="Filtrar por turno"
        >
          <ToggleGroupItem value="todo">Todo el día</ToggleGroupItem>
          <ToggleGroupItem value="comida">Comida</ToggleGroupItem>
          <ToggleGroupItem value="cena">Cena</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground sm:ml-auto">
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
        <div className="flex gap-3 sm:gap-6 overflow-x-auto overflow-y-visible pb-4 px-1 pt-1 flex-1">
          {grupos.map(({ negocio, columnas: columnasGrupo }) => (
            <div
              key={negocio.marca}
              role="group"
              aria-label={negocio.etiqueta}
              className={cn("flex flex-col gap-2 shrink-0", grupos.length > 1 && "rounded-xl border border-dashed p-2")}
            >
              {grupos.length > 1 && (
                <div className="flex flex-wrap items-baseline gap-x-2 px-1 text-xs">
                  <span className="font-semibold">{negocio.etiqueta}</span>
                  {aforoPorNegocio[negocio.marca]?.capacidad > 0 && (
                    <span className="text-muted-foreground tabular-nums">
                      aforo comida {aforoPorNegocio[negocio.marca].comida}/{aforoPorNegocio[negocio.marca].capacidad} · cena{" "}
                      {aforoPorNegocio[negocio.marca].cena}/{aforoPorNegocio[negocio.marca].capacidad}
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-2 sm:gap-4">
          {columnasGrupo.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              capacidadMax={col.capacidadMax}
              paxComida={paxPorColumna[col.id]?.comida ?? 0}
              paxCena={paxPorColumna[col.id]?.cena ?? 0}
              filtroTurno={filtroTurno}
              count={reservasPorColumna[col.id]?.length || 0}
              isActive={!!activeReserva}
              minimized={minimizedCols.has(col.id)}
              onToggleMinimize={() => toggleMinimize(col.id)}
            >
              {(reservasPorColumna[col.id] || []).map((reserva) => (
                <ReservaCard
                  key={reserva.id}
                  reserva={reserva}
                  columnas={columnas}
                  acciones={acciones}
                  onMover={solicitarMovimiento}
                />
              ))}
            </KanbanColumn>
          ))}
              </div>
            </div>
          ))}
        </div>

        <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeReserva ? (
            <ReservaCard
              reserva={activeReserva}
              columnas={columnas}
              acciones={acciones}
              onMover={solicitarMovimiento}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <AlertDialog open={!!movimientoPendiente} onOpenChange={(open) => !open && setMovimientoPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Superar la capacidad de {movimientoPendiente?.destinoNombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Con la reserva de {movimientoPendiente?.reserva.nombre || "este cliente"} (
              {movimientoPendiente?.reserva.numero_comensales} pax), el turno de{" "}
              {movimientoPendiente?.turno === "comida" ? "comida" : "cena"} de {movimientoPendiente?.destinoNombre} quedaría
              en {movimientoPendiente?.ocupacionTras} de {movimientoPendiente?.capacidad} plazas.
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
              Mover igualmente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
