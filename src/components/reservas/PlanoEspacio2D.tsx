// ============================================================================
// PLANO DE SALA — repartir MESAS a las reservas de un día y turno
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-26):
//   "a ver cómo hacemos esa vista para que esté lo más profesional y fácil de
//    trabajar con ello"
//   "hay que permitir asignar sala sin mesa y luego mesa, para ir cerrando los
//    días poco a poco"
//
// Esto lo usa el personal DURANTE EL SERVICIO, con prisa. El encargado abre la
// sala antes del servicio y va sentando las reservas del día.
//
// LA ASIGNACIÓN ES PROGRESIVA Y TIENE DOS GRADOS:
//   1. SALA (`reservas.espacio_id`) — lo hace el kanban arrastrando tarjetas.
//      NO se toca aquí.
//   2. MESA (`asignaciones_mesa`) — ES LO QUE HACE ESTA PANTALLA.
//
// Una reserva CON SALA Y SIN MESA es un estado legítimo y normal: se llama
// "pendiente de mesa". Nunca "error", nunca en rojo de error, y nunca hace
// falta mesa para guardar nada.
//
// ----------------------------------------------------------------------------
// CÓMO SE TRABAJA (2 clics para sentar una reserva normal)
// ----------------------------------------------------------------------------
//   1. Clic en la reserva del panel derecho ("Sentar").
//   2. Clic en la mesa del plano. Guardado.
//
// Si la reserva no cabe en esa mesa, la barra de trabajo se queda abierta
// invitando a JUNTAR otra mesa: "estos 6 caben juntando la 4 y la 5". El aviso
// de capacidad NO bloquea — nunca. Cuando las plazas ya cubren a los
// comensales, la barra se cierra sola y se puede pasar a la siguiente reserva.
//
// ----------------------------------------------------------------------------
// CON EL DEDO (2026-10-03: el panel tiene que funcionar en una tablet táctil)
// ----------------------------------------------------------------------------
//   · Tocar una mesa = elegirla (modo sentar) o seleccionarla. Todo llega como
//     `click`, que el navegador sólo emite si el dedo NO se ha movido: así un
//     pellizco o un arrastre del plano encima de una mesa ya no la elige.
//   · Un dedo sobre el vacío arrastra el plano; dos dedos hacen zoom y pan
//     (`crearGestosTactiles`, la misma lógica que el editor de plano).
//   · Recolocar una mesa arrastrándola tiene zona muerta de 6 px (un dedo nunca
//     está quieto) y no escribe en BBDD si la mesa no se ha movido.
//   · Todo control mide ≥ 44 px, los textos ≥ 12 px y los campos 16 px.
//
// ----------------------------------------------------------------------------
// ENTRAR SEÑALANDO UNA RESERVA (`reservaId` / `?reserva=`)
// ----------------------------------------------------------------------------
// El plano se puede abrir apuntando a UNA reserva concreta, lista para sentar
// (desde la lista y desde la pestaña Hoy). Dos cosas de ese salto no son
// evidentes y están comentadas donde pasan:
//   · EL TURNO ENTRA AL MONTAR, COMO LA FECHA. El panel solo lista el turno
//     elegido, y por defecto es el del reloj: saltar a una cena a mediodía sin
//     mover el turno lleva a un panel donde la reserva NO está. Quien lanza el
//     salto ya sabe la hora, así que manda el turno hecho (prop `turno`);
//     deducirlo aquí DESPUÉS de montar se probó y no se aplicaba (ver la prop).
//     La deducción sigue viva solo como respaldo de la vía `?reserva=`.
//   · `?reserva=` SE BORRA EN CUANTO SE ATIENDE. Es un encargo de un solo uso,
//     no un filtro: pegado en la URL volvería a preseleccionar esa reserva al
//     cambiar de día o al recargar.
//
// ----------------------------------------------------------------------------
// QUIÉN MANDA SOBRE "MESA OCUPADA"
// ----------------------------------------------------------------------------
// La base de datos. El aviso del navegador es solo una cortesía para no gastar
// un viaje al servidor; si dos camareros pelean por la misma mesa a la vez, el
// RPC `asignar_mesas_reserva` rechaza con `MESA_OCUPADA:` y aquí se traduce con
// `mensajeErrorAsignacion` y se refresca el plano con lo que hay de verdad.
//
// Todas las escrituras van por ese RPC (`useAsignarMesasReserva`), que
// REEMPLAZA de golpe la lista de mesas de una reserva: así juntar dos mesas es
// UNA operación atómica, y una lista vacía deja la reserva pendiente de mesa.
//
// La lógica pura (turnos, ajuste de capacidad, mensajes de error, resumen de
// cierre) vive en `./asignacionPlano.ts`, con tests propios.
// ============================================================================

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMesas, useCrearMesa, useActualizarMesasSilent, useEliminarMesa, Mesa } from "@/hooks/useMesas";
import { usePlanoEspacio } from "@/hooks/usePlanosEspacio";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useAjustesMesaServicio, useGuardarAjustesMesa, type TurnoServicio } from "@/hooks/useAjustesMesaServicio";
import {
  aplicarCambios,
  estadoServicio,
  geometriaServicio,
  mesaPiezasDesde,
  mesasDeLaUnion,
  plazasDe,
  proponerParaSentar,
  type AjusteMesa,
  type MesaPiezas,
  type ReservaEnMesas,
} from "@/lib/reservas/piezasMesa";
import { DialogoPropuestaPiezas, PanelPiezasMesa, type PropuestaAbierta } from "@/components/reservas/PiezasMesa";
import { useIsMobile } from "@/hooks/use-mobile";
import { configAsignacionDesde } from "@/lib/reservas/ventanaAsignacion";
import { configServicioSalaDesde } from "@/lib/reservas/servicioSala";
import {
  conflictoDeMesa,
  franjaDeHora,
  nombreCorto,
  ocupacionesDeMesa,
  textoFranja,
  textoMesaOcupada,
} from "@/lib/reservas/ocupacionMesa";
import {
  useAsignacionesMesa,
  useAsignarMesasReserva,
  AsignacionConDetalles,
} from "@/hooks/useAsignacionesMesa";
import {
  ajusteCapacidad,
  agruparPorReserva,
  calcularDistribucionMesas,
  dateAFechaISO,
  esFechaISO,
  esFiltroTurno,
  etiquetaFiltroTurno,
  fechaISOaDate,
  horaEnFiltro,
  hoyLocal,
  mensajeErrorAsignacion,
  nombreMesasJuntas,
  OPCIONES_TURNO,
  plazasDeMesas,
  resumenCierreDia,
  turnoDeHora,
  useReservasDeSala,
  type FiltroTurno,
  type ReservaSala,
  type Turno,
} from "./asignacionPlano";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Wand2,
  FileDown,
  Move,
  Users,
  Clock,
  X,
  GripVertical,
  Utensils,
  CheckCircle2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Link2,
  CircleDashed,
  Armchair,
  SquarePen,
} from "lucide-react";
import { toast } from "sonner";
import { posicionInicialMesaNueva } from "./posicionMesaNueva";
import { cn } from "@/lib/utils";
import type { RectFabric } from "@/components/espacios/puertaGeometria";
import { crearGestosTactiles, type Vpt } from "@/components/espacios/gestosTactiles";
import {
  GROSOR_PARED_ESCENA,
  estiloRotacionElemento,
  limitesContenidoPlano,
  rectDeElemento,
  renderElementoPlano,
  type ElementoPlano,
} from "./elementosPlano";

/**
 * Suelo (px) de la pantalla con `altoDePantalla`: cabecera, barra del día y un plano de ~300 px.
 * Por debajo (ventana muy baja) deja de encoger y la página hace scroll.
 */
const ALTURA_MINIMA_PLANO_PAGINA = 480;

interface PlanoEspacio2DProps {
  espacioId: string;
  espacioNombre: string;
  onBack: () => void;
  /**
   * Día a mostrar, `YYYY-MM-DD`. OPCIONAL a propósito: `src/pages/Reservas.tsx`
   * monta esta pantalla SIN fecha. Sin prop se lee `?fecha=` de la URL (por
   * donde entra el calendario de ocupación) y, si tampoco, hoy.
   */
  fecha?: string;
  /**
   * Turno con el que abrir. HERMANO de `fecha`, y por el mismo motivo: entra al
   * montar, no después.
   *
   * Lo deduce de la hora de la reserva quien lanza el salto
   * (`src/lib/reservas/saltoAsignacion.ts`), no esta pantalla. Medido en el
   * navegador el 2026-09-28: cuando el plano intentaba deducirlo DESPUÉS de
   * montarse —esperando a que cargaran las reservas del día y entonces
   * `setFiltroTurno`— ese cambio no llegaba a aplicarse nunca (la URL sí
   * quedaba en `turno=cena` y la reserva sí quedaba activa, pero el panel
   * seguía en comida y la reserva a sentar no salía). Lo que se pasa como PROP
   * AL MONTAR, en cambio, funciona siempre: es la vía que ya usaba `fecha`.
   */
  turno?: Turno;
  /**
   * Reserva a preseleccionar al abrir, para sentarla. OPCIONAL igual que
   * `fecha`: solo llega cuando se entra POR UNA RESERVA. Sin prop se lee
   * `?reserva=` de la URL y, si tampoco, no se señala ninguna y el plano se
   * comporta igual que siempre.
   */
  reservaId?: string;
  /**
   * Página de Reservas (regla del dueño, 2026-10-07: el alto de la página es el de la pantalla): la
   * pantalla mide lo que le queda hasta el fondo de la ventana (`useAlturaDisponible`) y la página no
   * desplaza; el plano se queda con el alto que sobra y la lista de reservas hace scroll por dentro.
   * Desde 768 px: en el móvil sigue el layout de siempre (plano de 340 px y la lista debajo). Sin
   * prop (el diálogo «Elegir mesa», que ya acota el alto con sus propias clases) no cambia nada.
   */
  altoDePantalla?: boolean;
}

interface DragState {
  isDragging: boolean;
  mesaId: string | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

// Geometría y dibujo de los elementos del plano (paredes, áreas, puertas…) y el
// encuadre: en `./elementosPlano.tsx` (06/10/2026), compartidos con la vista
// «Plano» de «Hoy». Allí están también las DOS CONVENCIONES DE ROTACIÓN.

/** "14:00:00" → "14:00". */
function horaCorta(hora: string | null | undefined): string {
  return String(hora ?? "").slice(0, 5);
}

/**
 * Texto del ajuste de capacidad, sin lenguaje de error: "faltan plazas" es una
 * observación, no un fallo.
 *
 * `diferencia` viene FIRMADA del contrato (`plazasAsignadas - comensales`:
 * negativa cuando no caben), así que se pinta con `Math.abs` y el signo lo
 * cuenta `estado`.
 */
function textoAjuste(comensales: number, plazas: number): { etiqueta: string; tono: string } {
  const ajuste = ajusteCapacidad(comensales, plazas);
  const magnitud = Math.abs(ajuste.diferencia);
  switch (ajuste.estado) {
    case "sin_mesa":
      return { etiqueta: "Sin mesa todavía", tono: "border-slate-300 text-slate-600 dark:text-slate-300" };
    case "excede":
      return {
        etiqueta: `Faltan ${magnitud} plaza${magnitud === 1 ? "" : "s"}`,
        tono: "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      };
    case "justo":
      return {
        etiqueta: "Justo",
        tono: "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      };
    default:
      return {
        etiqueta: `Sobran ${magnitud}`,
        tono: "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
      };
  }
}

// ─── Tarjeta de reserva del panel ────────────────────────────────────────────

/**
 * Fila de reserva del panel derecho.
 *
 * Las acciones van SIEMPRE en la misma posición (ancho fijo a la derecha) para
 * que no bailen entre filas: [asa de arrastre] [datos] [botón] [quitar].
 */
function TarjetaReserva({
  reserva,
  mesasAsignadas,
  plazasAsignadas,
  activa,
  mostrarTurno,
  onActivar,
  onQuitarMesas,
  onEditar,
  puedeEditar = true,
}: {
  reserva: ReservaSala;
  mesasAsignadas: string[];
  plazasAsignadas: number;
  activa: boolean;
  /**
   * Solo en "Todo el día". Con un turno concreto elegido todas las filas son de
   * ese turno, así que la insignia no diría nada y le quitaría sitio al nombre
   * (el panel mide 320 px).
   */
  mostrarTurno: boolean;
  onActivar: (reserva: ReservaSala) => void;
  onQuitarMesas?: (reserva: ReservaSala) => void;
  /** Abre el editor de la reserva (2026-09-30): el lápiz junto al nombre, en toda fila. */
  onEditar?: (reserva: ReservaSala) => void;
  /** Permiso de edición sobre «reservas»: sin él, el lápiz sale deshabilitado. */
  puedeEditar?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `reserva-${reserva.id}`,
    data: { type: "reserva", reserva },
  });

  const tieneMesa = mesasAsignadas.length > 0;
  const ajuste = textoAjuste(reserva.numero_comensales, plazasAsignadas);

  return (
    <div
      ref={setNodeRef}
      // Marca para que la pantalla pueda asomarse a ESTA fila cuando se entra
      // señalando la reserva (ver el salto de `?reserva=`).
      data-reserva-fila={reserva.id}
      className={cn(
        // `flex-wrap`: con controles de 44 px no caben en una línea en un panel de 320 px.
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border p-2 transition-colors",
        tieneMesa
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
          : "border-border bg-card",
        isDragging && "opacity-40",
        activa && "border-primary ring-2 ring-primary/40",
      )}
    >
      {/* Asa de arrastre: solo aquí, para que el clic de la fila no pelee con el arrastre */}
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Arrastrar ${reserva.nombre} al plano`}
        title="Arrastrar al plano"
        className="flex h-11 w-9 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        <GripVertical className="h-5 w-5" />
      </button>

      {/* Datos */}
      <div className="min-w-[8rem] flex-1 basis-[8rem]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold" title={reserva.nombre}>
            {reserva.nombre}
          </span>
          {mostrarTurno && (
            <Badge variant="outline" className="h-5 shrink-0 whitespace-nowrap px-1.5 py-0 text-xs font-medium">
              {turnoDeHora(reserva.hora) === "comida" ? "Comida" : "Cena"}
            </Badge>
          )}
          {/* Editar datos, día, hora, comensales, sala o notas (2026-09-30). Va
              junto al nombre y no en la botonera de la derecha: esa tiene ancho
              fijo (72 + 28 px) y el panel mide 320. Sin mirar el estado: solo el
              permiso lo apaga. */}
          {onEditar && (
            <button
              type="button"
              disabled={!puedeEditar}
              onClick={() => onEditar(reserva)}
              aria-label={`Editar la reserva de ${reserva.nombre}`}
              title={puedeEditar ? "Editar la reserva" : "No tienes permiso para editar reservas"}
              className="-my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SquarePen className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex shrink-0 items-center gap-1 tabular-nums">
            <Clock className="h-3 w-3" />
            {horaCorta(reserva.hora)}
          </span>
          <span className="flex shrink-0 items-center gap-1 tabular-nums" title={`${reserva.numero_comensales} comensales`}>
            <Users className="h-3 w-3" />
            {reserva.numero_comensales}
          </span>
          {tieneMesa ? (
            <span className="flex min-w-0 items-center gap-1" title={nombreMesasJuntas(mesasAsignadas)}>
              {mesasAsignadas.length > 1 && <Link2 className="h-3 w-3 shrink-0 text-emerald-600" />}
              <span className="truncate font-medium text-foreground">{nombreMesasJuntas(mesasAsignadas)}</span>
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1">
              <CircleDashed className="h-3 w-3" />
              Pendiente de mesa
            </span>
          )}
        </div>
      </div>

      {/* Plazas vs comensales — solo cuando ya hay mesa, si no no dice nada */}
      {tieneMesa && (
        <Badge
          variant="outline"
          className={cn("h-6 shrink-0 whitespace-nowrap px-1.5 py-0 text-xs tabular-nums", ajuste.tono)}
          title={`${plazasAsignadas} plazas asignadas para ${reserva.numero_comensales} comensales`}
        >
          {plazasAsignadas}/{reserva.numero_comensales}
        </Badge>
      )}

      {/* Acciones — posición y ancho FIJOS en todas las filas.
          El texto visible es corto para que quepa; el nombre completo de la
          acción vive en `aria-label` (mismo criterio que ListaReservasAvanzada). */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant={activa ? "default" : tieneMesa ? "outline" : "secondary"}
        className="h-11 min-w-[84px] shrink-0 touch-manipulation px-3 text-sm"
        aria-label={
          activa
            ? `Dejar de elegir mesa para ${reserva.nombre}`
            : tieneMesa
              ? `Cambiar mesas de ${reserva.nombre}`
              : `Sentar a ${reserva.nombre}`
        }
        onClick={() => onActivar(reserva)}
      >
        {activa ? "Eligiendo" : tieneMesa ? "Cambiar" : "Sentar"}
      </Button>
      {tieneMesa && onQuitarMesas ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-11 shrink-0 touch-manipulation text-muted-foreground hover:text-destructive"
          aria-label={`Quitar mesas de ${reserva.nombre}`}
          title="Quitar mesas"
          onClick={() => onQuitarMesas(reserva)}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
      </div>
    </div>
  );
}

// ─── Mesa del plano ──────────────────────────────────────────────────────────

/** Una reserva sentada en una mesa (puede haber varias: a horas que no se pisan). */
interface OcupanteMesa {
  asignacion: AsignacionConDetalles;
  /** La primera mesa del grupo de esa reserva lleva el cartel con el nombre; las demás, «Junta». */
  esPrimeraDelGrupo: boolean;
  mesasDelGrupo: number;
  /** Quitarle las mesas a esa reserva (solo en la primera mesa del grupo). */
  onQuitar?: () => void;
}

function MesaPlano({
  mesa,
  mesaOriginal,
  ocupantes,
  motivoOcupada = null,
  elegida,
  noSeOfrece = false,
  modoAsignacion,
  reservaActivaNombre,
  comensalesActivos,
  isSelected,
  isDragging,
  onDragStart,
  onSeleccionar,
  onAlternar,
  scale,
  piezasInfo,
}: {
  /** Mesas por piezas: rayas entre piezas y marca del pico (servicio actual). */
  piezasInfo?: { piezas: number; picos: number; ladoPico: "derecha" | "izquierda" };
  /** Mesa con coordenadas y tamaño YA en píxeles de pantalla. */
  mesa: Mesa;
  /** Mesa con los datos originales (metros / capacidad) para los callbacks. */
  mesaOriginal: Mesa;
  /** Quién la ocupa en el turno que se pinta, por orden de hora (vacío = nadie). */
  ocupantes: OcupanteMesa[];
  /**
   * Solo mientras se sienta a alguien: por qué NO está libre a la hora de ESA
   * reserva («La mesa 3 está ocupada de 14:00 a 16:00 por Oscar»), o `null` si
   * lo está — aunque tenga otras reservas a otras horas.
   */
  motivoOcupada?: string | null;
  elegida: boolean;
  /**
   * Mesa excluida en Configuración (`asignacion_mesas_excluidas`): se pinta
   * atenuada y `guardarMesas` rechaza añadirla. No cambia el aforo.
   */
  noSeOfrece?: boolean;
  modoAsignacion: boolean;
  reservaActivaNombre?: string | null;
  comensalesActivos?: number | null;
  isSelected: boolean;
  isDragging: boolean;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, mesa: Mesa) => void;
  onSeleccionar: (mesa: Mesa) => void;
  onAlternar: (mesa: Mesa) => void;
  scale: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `mesa-${mesa.id}`,
    data: { type: "mesa", mesa: mesaOriginal },
  });

  const minDimension = Math.min(mesa.ancho || 60, mesa.alto || 60);
  const fontSize = Math.max(11, Math.min(14, minDimension * 0.18));
  const iconSize = Math.max(8, Math.min(12, minDimension * 0.12));

  // Fuera del modo asignación: ocupada = alguien la tiene en el turno que se
  // pinta. Sentando a una reserva: ocupada = no está libre a SU hora (otra
  // reserva a otra hora no la bloquea; ver `motivoOcupada`).
  const hayOcupantes = ocupantes.length > 0;
  const ocupadaPorOtra = modoAsignacion && !!motivoOcupada && !elegida;
  const ocupada = modoAsignacion ? elegida || ocupadaPorOtra : hayOcupantes;
  // Varios en la misma mesa → carteles compactos, uno por reserva.
  const varios = ocupantes.length > 1;
  const unico = ocupantes.length === 1 ? ocupantes[0] : null;

  // Encaje informativo mientras se está sentando a alguien. NO bloquea: una
  // mesa pequeña se marca "se queda corta" pero se puede elegir igual para
  // juntarla con otra.
  const encaje = useMemo(() => {
    if (!modoAsignacion || !comensalesActivos || ocupadaPorOtra) return null;
    const capacidad = mesaOriginal.capacidad || 0;
    if (comensalesActivos > capacidad) return "corta" as const;
    if (comensalesActivos === capacidad) return "justa" as const;
    return "sobra" as const;
  }, [modoAsignacion, comensalesActivos, ocupadaPorOtra, mesaOriginal.capacidad]);

  const mesaWidth = mesa.ancho || 60;
  const mesaHeight = mesa.alto || 60;
  // Zona sensible de 44 px REALES como mínimo (el mínimo táctil), no escalada
  // por el zoom del plano: con el plano alejado una mesa de 80 cm mide 20-30 px.
  // El relleno se limita a 14 px por lado para que la zona de una mesa no se
  // coma el borde de la vecina.
  const hitAreaPadding = Math.min(14, Math.max(4, (44 - Math.min(mesaWidth, mesaHeight)) / 2));

  const baseScale = minDimension < 40 ? 1.6 : minDimension < 60 ? 1.4 : 1.2;
  const hoverScale = isOver ? baseScale : 1;
  const hoverZIndex = isOver ? 100 : isDragging ? 60 : elegida || isSelected ? 30 : 10;

  const quienes = ocupantes
    .map((o) => `${o.asignacion.reservas.nombre} a las ${horaCorta(o.asignacion.reservas.hora)}`)
    .join(" y por ");
  const estadoTexto =
    (elegida
      ? `elegida para ${reservaActivaNombre ?? "la reserva"}`
      : ocupadaPorOtra
        ? hayOcupantes
          ? `ocupada por ${quienes} · no está libre a esa hora`
          : `ocupada a esa hora · ${motivoOcupada}`
        : modoAsignacion && hayOcupantes
          ? `libre a esa hora · también la usa ${quienes}`
          : hayOcupantes
            ? `ocupada por ${quienes}`
            : "libre") + (noSeOfrece ? " · no se ofrece al asignar" : "");

  // Sentando a alguien, los carteles de quien NO estorba a esa hora se atenúan.
  const cartelAtenuado = modoAsignacion && !ocupadaPorOtra && !elegida;

  const manejarClic = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (modoAsignacion) onAlternar(mesaOriginal);
    else onSeleccionar(mesaOriginal);
  };

  // El arrastre para RECOLOCAR la mesa solo se activa fuera del modo
  // asignación: durante el reparto, un clic es un clic.
  const manejarMouseDown = (e: React.MouseEvent) => {
    if (modoAsignacion) return;
    e.preventDefault();
    e.stopPropagation();
    onDragStart(e, mesaOriginal);
  };

  const manejarTouchStart = (e: React.TouchEvent) => {
    // Sentando: NO se actúa al apoyar el dedo. El navegador convierte un toque
    // que no se mueve en `click` (y manejarClic lo atiende), mientras que un
    // pellizco o un arrastre del plano que empiece encima de una mesa no lo
    // hace — antes elegía/soltaba la mesa al apoyar el primer dedo.
    if (modoAsignacion) return;
    e.stopPropagation();
    onDragStart(e, mesaOriginal);
  };

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      data-mesa-id={mesaOriginal.id}
      onMouseDown={manejarMouseDown}
      onTouchStart={manejarTouchStart}
      onClick={manejarClic}
      style={{
        left: (mesa.pos_x || 0) - hitAreaPadding,
        top: (mesa.pos_y || 0) - hitAreaPadding,
        width: mesaWidth + hitAreaPadding * 2,
        height: mesaHeight + hitAreaPadding * 2,
        zIndex: hoverZIndex,
        touchAction: "none",
      }}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${mesaOriginal.nombre} · ${mesaOriginal.capacidad} plazas · ${estadoTexto}`}
              aria-pressed={modoAsignacion ? elegida : undefined}
              className={cn(
                "absolute flex select-none flex-col items-center justify-center border-2 text-center shadow-sm",
                mesa.forma === "circular" ? "rounded-full" : "rounded-lg",
                // Libre / ocupada de un vistazo
                ocupada
                  ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-900/50"
                  : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800",
                elegida && "border-primary bg-primary/25 ring-4 ring-primary/40",
                isSelected && !elegida && "ring-2 ring-primary/30",
                isDragging && "border-primary opacity-90 shadow-2xl ring-4 ring-primary/40",
                // En modo asignación el resto se atenúa para que salten las opciones
                modoAsignacion && ocupadaPorOtra && "opacity-50",
                modoAsignacion && noSeOfrece && !elegida && "border-dashed opacity-40",
                modoAsignacion && !ocupada && encaje === "justa" && "ring-2 ring-emerald-400",
                modoAsignacion && !ocupada && encaje === "corta" && "ring-2 ring-amber-300",
                isOver && "ring-4 ring-primary shadow-2xl",
                modoAsignacion ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
              )}
              style={{
                left: hitAreaPadding,
                top: hitAreaPadding,
                width: mesaWidth,
                height: mesaHeight,
                transform: `rotate(${mesa.rotacion || 0}deg) scale(${hoverScale})`,
                transformOrigin: "center center",
                padding: Math.max(2, minDimension * 0.05),
                transition: isDragging
                  ? "box-shadow 100ms ease"
                  : "transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms ease",
              }}
            >
              {piezasInfo &&
                Array.from({ length: Math.max(0, piezasInfo.piezas - 1) }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed border-slate-400"
                    style={{ left: `${((i + 1) * 100) / piezasInfo.piezas}%` }}
                  />
                ))}
              {piezasInfo && piezasInfo.picos > 0 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 h-1/2 w-1.5 -translate-y-1/2 rounded-sm bg-amber-500"
                  style={piezasInfo.ladoPico === "izquierda" ? { left: -8 } : { right: -8 }}
                />
              )}
              <span
                className="pointer-events-none break-words text-center font-bold leading-tight"
                style={{ fontSize: `${fontSize}px`, maxWidth: "100%", wordBreak: "break-word", lineHeight: 1.1 }}
              >
                {mesaOriginal.nombre}
              </span>
              <div
                className="pointer-events-none flex items-center gap-0.5 text-muted-foreground tabular-nums"
                style={{ fontSize: `${iconSize}px`, marginTop: 1 }}
              >
                <Users style={{ width: iconSize, height: iconSize }} />
                <span>{mesaOriginal.capacidad}</span>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold">{mesaOriginal.nombre}</p>
              <p className="text-xs">{mesaOriginal.capacidad} plazas</p>
              {noSeOfrece && (
                <p className="text-xs text-muted-foreground">No se ofrece al asignar (Configuración)</p>
              )}
              {hayOcupantes ? (
                ocupantes.map((o) => (
                  <div key={o.asignacion.reserva_id} className="mt-1 border-t border-border pt-1">
                    <p className="text-xs font-medium">{o.asignacion.reservas.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {horaCorta(o.asignacion.reservas.hora)} · {o.asignacion.reservas.numero_comensales} comensales
                      {o.mesasDelGrupo > 1 && ` · ${o.mesasDelGrupo} mesas juntas`}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Libre</p>
              )}
              {motivoOcupada && !elegida && (
                <p className="text-xs font-medium text-destructive">{motivoOcupada}</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Quién ocupa la mesa: nombre y hora legibles justo encima. Solo en la
          primera mesa del grupo, para que dos mesas juntas no repitan cartel. */}
      {unico && unico.esPrimeraDelGrupo && (
        <div
          className={cn(
            "pointer-events-auto absolute left-1/2 z-20 min-w-max -translate-x-1/2 rounded-md bg-emerald-600 px-2 py-1 text-white shadow-lg",
            cartelAtenuado && "opacity-60",
          )}
          style={{ top: -34, maxWidth: Math.max(130, mesaWidth * 1.6) }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {unico.onQuitar && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                unico.onQuitar?.();
              }}
              aria-label={`Liberar las mesas de ${unico.asignacion.reservas.nombre}`}
              title="Quitar mesas"
              // Zona de 44x44 px alrededor de una X visible de 20 px.
              className="absolute -right-5 -top-5 z-30 flex h-11 w-11 items-center justify-center touch-manipulation"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md">
                <X className="h-3 w-3" />
              </span>
            </button>
          )}
          <p className="pointer-events-none truncate text-center text-xs font-semibold leading-tight">
            {unico.asignacion.reservas.nombre}
          </p>
          <div className="pointer-events-none flex items-center justify-center gap-1.5 text-[11px] opacity-95 tabular-nums">
            <span>{horaCorta(unico.asignacion.reservas.hora)}</span>
            <span>·</span>
            <span>{unico.asignacion.reservas.numero_comensales} pax</span>
            {unico.mesasDelGrupo > 1 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Link2 className="h-2.5 w-2.5" />
                  {unico.mesasDelGrupo}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mesas juntas que no llevan cartel: se marca que son parte de un grupo */}
      {unico && !unico.esPrimeraDelGrupo && (
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded bg-emerald-600 px-1 py-0.5 text-[11px] font-semibold text-white shadow",
            cartelAtenuado && "opacity-60",
          )}
          style={{ top: -18 }}
        >
          Junta
        </div>
      )}

      {/* Varias reservas en la misma mesa (a horas que no se pisan): un cartel
          compacto por reserva, «14:00 Oscar» / «20:30 Ezequiel», por orden de
          hora. Sin X aquí (dos zonas de 44 px se pisarían): se quitan desde su
          fila del panel o con «Quitar mesas». */}
      {varios && (
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 z-20 flex min-w-max -translate-x-1/2 flex-col gap-0.5",
            cartelAtenuado && "opacity-60",
          )}
          style={{ top: -(ocupantes.length * 21 + 6) }}
          data-ocupantes-mesa={mesaOriginal.id}
        >
          {ocupantes.map((o) => (
            <div
              key={o.asignacion.reserva_id}
              className="flex items-center justify-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-white shadow tabular-nums"
              title={`${o.asignacion.reservas.nombre} · ${horaCorta(o.asignacion.reservas.hora)} · ${o.asignacion.reservas.numero_comensales} pax`}
            >
              <span>{horaCorta(o.asignacion.reservas.hora)}</span>
              <span className="max-w-[7rem] truncate">{nombreCorto(o.asignacion.reservas.nombre)}</span>
              {o.mesasDelGrupo > 1 && <Link2 className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}

      {/* Etiqueta fija de la mesa (p. ej. "junto a la ventana") */}
      {mesaOriginal.etiqueta && (
        <div
          className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2"
          style={{ top: hitAreaPadding + mesaHeight + 4 }}
        >
          <div className="whitespace-nowrap rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 shadow-sm">
            {mesaOriginal.etiqueta}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pantalla ────────────────────────────────────────────────────────────────

export function PlanoEspacio2D({
  espacioId,
  espacioNombre,
  onBack,
  fecha,
  turno,
  reservaId,
  altoDePantalla = false,
}: PlanoEspacio2DProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Alto de pantalla (ver `altoDePantalla`): `raiz` es el contenedor de toda la pantalla. `null`
  // (móvil, diálogo, jsdom, primer pintado) = el layout de siempre.
  const esMovil = useIsMobile();
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const altoPantalla = useAlturaDisponible(altoDePantalla && !esMovil ? raiz : null, ALTURA_MINIMA_PLANO_PAGINA);
  const [searchParams, setSearchParams] = useSearchParams();
  // Editar una reserva desde su fila del panel (2026-09-30).
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  // ── Día y turno ───────────────────────────────────────────────────────────
  // Prioridad: prop `fecha` > `?fecha=` de la URL > hoy. El parámetro se llama
  // `fecha` y NO `date`: `src/pages/Reservas.tsx` ya usa `tab`, `status` y
  // `date` para la pestaña Lista y no hay que pisárselos.
  const fechaInicial = useMemo(() => {
    if (esFechaISO(fecha)) return fecha as string;
    const deUrl = searchParams.get("fecha");
    if (esFechaISO(deUrl)) return deUrl as string;
    return hoyLocal();
    // Solo al montar: después manda el estado interno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [fechaSel, setFechaSel] = useState<string>(fechaInicial);

  // Turno por defecto: el del momento en que se abre la pantalla. El encargado
  // entra antes o durante un servicio concreto, no a ver los dos mezclados.
  //
  // Prioridad calcada a la de `fecha`: prop `turno` > `?turno=` de la URL >
  // el del reloj. La prop va PRIMERO porque es la que trae el salto por
  // reserva, y ese turno es el único que sabe a qué servicio se quiere entrar
  // (ver el comentario de la prop: deducirlo después de montar no se aplicaba).
  const turnoInicial = useMemo<FiltroTurno>(() => {
    if (esFiltroTurno(turno)) return turno;
    const deUrl = searchParams.get("turno");
    if (esFiltroTurno(deUrl)) return deUrl;
    return turnoDeHora(new Date().toLocaleTimeString("es-ES", { hour12: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filtroTurno, setFiltroTurno] = useState<FiltroTurno>(turnoInicial);

  // Tercer parámetro del mismo mecanismo, con la MISMA prioridad que `fecha`:
  // prop `reservaId` > `?reserva=` de la URL > ninguna. Se llama `reserva` por
  // lo mismo que el día se llama `fecha` y no `date`: los nombres cortos de
  // `src/pages/Reservas.tsx` ya están cogidos y no hay que pisárselos.
  //
  // No se valida el formato (a diferencia de `?fecha=`, donde una fecha
  // imposible rompería la consulta): un id que no exista simplemente no
  // aparecerá en las reservas del día y se avisa sin romper nada.
  const reservaSenaladaInicial = useMemo(() => {
    const dePropiedad = (reservaId ?? "").trim();
    if (dePropiedad) return dePropiedad;
    const deUrl = (searchParams.get("reserva") ?? "").trim();
    return deUrl || null;
    // Solo al montar, igual que `fechaInicial` y `turnoInicial`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Salto pendiente de atender. Encargo de UN SOLO USO, no un filtro. */
  const [reservaSenalada, setReservaSenalada] = useState<string | null>(reservaSenaladaInicial);

  // Si el padre empieza a pasar `fecha` (o la cambia), se sigue.
  useEffect(() => {
    if (esFechaISO(fecha)) setFechaSel(fecha as string);
  }, [fecha]);

  // Y lo mismo con la reserva señalada: así dos saltos seguidos a reservas
  // distintas funcionan sin desmontar el plano (en el primero la prop ya valía
  // eso, en el segundo cambia y entra un encargo nuevo).
  useEffect(() => {
    const id = (reservaId ?? "").trim();
    if (id) setReservaSenalada(id);
  }, [reservaId]);

  // El turno del salto, igual. Depende TAMBIÉN de `reservaId` a propósito: dos
  // saltos seguidos al mismo turno traen la misma prop `turno`, y si en medio
  // el usuario hubiera cambiado el filtro a mano, sin esto el segundo salto lo
  // dejaría en el turno equivocado y la reserva no saldría. Solo se reaplica
  // cuando el PADRE señala algo nuevo; un cambio a mano no toca las props, así
  // que al usuario no se le pelea el filtro.
  useEffect(() => {
    if (esFiltroTurno(turno)) setFiltroTurno(turno);
  }, [turno, reservaId]);

  /**
   * Guarda día/turno en la URL sin tocar el resto de parámetros, y de paso
   * BORRA `reserva`.
   *
   * Lo de borrar no es un descuido: `?reserva=` es el salto con el que se entra
   * señalando una reserva, y se agota al atenderlo. Si se quedara pegado, al
   * cambiar de día o al recargar se volvería a preseleccionar una reserva que
   * ya no pinta nada en lo que se está viendo — y `cambiarFecha`/`cambiarTurno`
   * precisamente acaban de soltar la reserva activa.
   */
  const sincronizarUrl = useCallback(
    (nuevaFecha: string, nuevoTurno: FiltroTurno) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("fecha", nuevaFecha);
          params.set("turno", nuevoTurno);
          params.delete("reserva");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const cambiarFecha = useCallback(
    (nueva: string) => {
      if (!esFechaISO(nueva)) return;
      setFechaSel(nueva);
      setReservaActivaId(null);
      // Si quedaba un salto sin atender, el usuario acaba de decir a mano dónde
      // quiere estar: manda él, no el encargo con el que se entró.
      setReservaSenalada(null);
      setUltimoCambio(null);
      sincronizarUrl(nueva, filtroTurno);
    },
    [filtroTurno, sincronizarUrl],
  );

  const moverDia = useCallback(
    (dias: number) => {
      const d = fechaISOaDate(fechaSel);
      d.setDate(d.getDate() + dias);
      cambiarFecha(dateAFechaISO(d));
    },
    [fechaSel, cambiarFecha],
  );

  const cambiarTurno = useCallback(
    (nuevo: string) => {
      // El ToggleGroup devuelve "" al desmarcar: se ignora, siempre hay turno.
      if (!esFiltroTurno(nuevo)) return;
      setFiltroTurno(nuevo);
      setReservaActivaId(null);
      // Igual que al cambiar de día: elegir turno a mano cancela el salto que
      // aún no se hubiera atendido. Nunca se le pelea el filtro al usuario.
      setReservaSenalada(null);
      sincronizarUrl(fechaSel, nuevo);
    },
    [fechaSel, sincronizarUrl],
  );

  // ── Estado de la pantalla ─────────────────────────────────────────────────
  const [selectedMesa, setSelectedMesa] = useState<Mesa | null>(null);
  const [showAddMesa, setShowAddMesa] = useState(false);
  const [mesaABorrar, setMesaABorrar] = useState<Mesa | null>(null);
  const [localMesas, setLocalMesas] = useState<Mesa[]>([]);
  const [activeReserva, setActiveReserva] = useState<ReservaSala | null>(null);
  const [reservaActivaId, setReservaActivaId] = useState<string | null>(null);
  /**
   * Tarjeta a la que hay que asomarse tras un salto.
   *
   * Va aparte de `reservaActivaId` porque el scroll NO se puede hacer en el
   * mismo momento de activarla: al cambiar el turno, su tarjeta todavía no está
   * en el DOM — aparece en el render siguiente. Se deja apuntado y el efecto lo
   * reintenta con cada lista nueva hasta que la encuentra.
   */
  const [reservaAEnfocar, setReservaAEnfocar] = useState<string | null>(null);
  /** Contenedor de las tarjetas del panel, para buscar dentro solo ahí. */
  const panelReservasRef = useRef<HTMLDivElement>(null);
  /** Un solo nivel de deshacer, como se pidió: nada de historial infinito. */
  const [ultimoCambio, setUltimoCambio] = useState<{
    reservaId: string;
    nombre: string;
    mesaIdsAntes: string[];
    descripcion: string;
  } | null>(null);
  const [aQuitarMesas, setAQuitarMesas] = useState<{ reserva: ReservaSala; mesas: string } | null>(null);
  /** El reparto automático está en marcha: no se puede pulsar dos veces. */
  const [repartiendo, setRepartiendo] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  /** El dedo/ratón ya ha pasado la zona muerta de 6 px: la mesa empieza a seguirlo. */
  const arrastreArmadoRef = useRef(false);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    mesaId: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [newMesa, setNewMesa] = useState({
    nombre: "",
    capacidad: 4,
    forma: "rectangular",
    ancho: 80,
    alto: 80,
  });

  // ── Datos ─────────────────────────────────────────────────────────────────
  const { data: mesas, isLoading: loadingMesas } = useMesas(espacioId);
  const { data: plano } = usePlanoEspacio(espacioId);
  // Las asignaciones del DÍA ENTERO, sin recortar al turno: desde el
  // 05/10/2026 una mesa se ocupa por franjas de tiempo ([hora, hora + tiempo de
  // ocupación)), y una comida de las 16:30 sigue ocupando la mesa a las 18:00.
  // Lo que se PINTA sí se recorta al turno elegido (`asignacionesTurno`).
  const { data: asignaciones, refetch: refetchAsignaciones } = useAsignacionesMesa(fechaSel, espacioId);
  const { data: reservasDia } = useReservasDeSala(espacioId, fechaSel);

  const crearMesa = useCrearMesa();
  const actualizarMesasSilent = useActualizarMesasSilent();
  const eliminarMesa = useEliminarMesa();
  const asignarMesas = useAsignarMesasReserva();
  // Mesas que Configuración no ofrece al asignar (reservas-sin-salas, Fase B).
  // No se quitan del plano —pueden tener ya una reserva y hay que verla—: se
  // atenúan y no se dejan AÑADIR a ninguna reserva.
  const { data: configReservas } = useConfiguracionReservas();
  const mesasNoOfrecidas = useMemo(
    () => new Set(configAsignacionDesde(configReservas).mesasExcluidas),
    [configReservas],
  );
  // «Tiempo de ocupación de mesa» (Configuración): cuánto ocupa la mesa cada
  // reserva según su turno. Decide si una mesa está libre PARA una reserva.
  const configOcupacion = useMemo(() => configServicioSalaDesde(configReservas), [configReservas]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  // ── Turno: filtra reservas Y ocupación de mesas a la vez ──────────────────
  // Sin esto el plano mezcla los dos servicios del día y "mesa ocupada" no
  // significa nada: la 4 puede estar ocupada a las 14:00 y libre a las 21:00.
  const reservasTurno = useMemo(
    () => (reservasDia ?? []).filter((r) => horaEnFiltro(r.hora, filtroTurno)),
    [reservasDia, filtroTurno],
  );

  // Todas las del día: con ellas se decide si una mesa está libre para una
  // reserva concreta (por su franja).
  const asignacionesDia = useMemo(() => asignaciones ?? [], [asignaciones]);
  // Las del turno elegido: lo que se pinta (carteles, contadores, panel).
  const asignacionesTurno = useMemo(
    () => asignacionesDia.filter((a) => horaEnFiltro(a.reservas?.hora ?? "", filtroTurno)),
    [asignacionesDia, filtroTurno],
  );

  // -- Mesas por piezas (Comedor, 08/10/2026) --------------------------------
  // El plano base no se toca: cada servicio (fecha + comida/cena) tiene sus
  // ajustes de piezas, picos y uniones. Con «Todo el día» se ve el plano base.
  // Lógica pura y tests en `src/lib/reservas/piezasMesa.ts`.
  const turnoServicio: TurnoServicio | null = filtroTurno === "dia" ? null : filtroTurno;
  const { data: ajustesServicio } = useAjustesMesaServicio(espacioId, fechaSel, turnoServicio);
  const guardarAjustes = useGuardarAjustesMesa(espacioId, fechaSel, turnoServicio);
  const [propuestaPiezas, setPropuestaPiezas] = useState<PropuestaAbierta | null>(null);
  const mesasPiezas = useMemo(
    () => localMesas.map(mesaPiezasDesde).filter((m): m is MesaPiezas => m !== null),
    [localMesas],
  );
  const estadoPiezas = useMemo(
    () => estadoServicio(mesasPiezas, turnoServicio ? (ajustesServicio ?? []) : []),
    [mesasPiezas, turnoServicio, ajustesServicio],
  );
  /** Las mesas tal y como están en ESTE servicio (largo y plazas recalculados). */
  const mesasVista = useMemo(
    () =>
      localMesas.map((m) => {
        const g = geometriaServicio(m, estadoPiezas.get(m.id));
        return g ? { ...m, pos_x: g.pos_x, ancho: g.ancho, capacidad: g.capacidad } : m;
      }),
    [localMesas, estadoPiezas],
  );
  /** Reservas del servicio y sus mesas: para no quitar piezas que alguien necesita. */
  const reservasEnMesas = useMemo<ReservaEnMesas[]>(() => {
    const porReserva = new Map<string, ReservaEnMesas>();
    for (const a of asignacionesTurno) {
      const r = porReserva.get(a.reserva_id) ?? {
        reservaId: a.reserva_id,
        mesaIds: [],
        comensales: a.reservas?.numero_comensales ?? 0,
      };
      r.mesaIds.push(a.mesa_id);
      porReserva.set(a.reserva_id, r);
    }
    return [...porReserva.values()];
  }, [asignacionesTurno]);

  const guardarPiezas = useCallback(
    async (cambios: AjusteMesa[], mensaje: string | null): Promise<boolean> => {
      try {
        await guardarAjustes.mutateAsync(cambios);
      } catch {
        return false;
      }
      if (mensaje) toast.success(mensaje);
      return true;
    },
    [guardarAjustes],
  );

  const mesasPorId = useMemo(() => new Map(mesasVista.map((m) => [m.id, m])), [mesasVista]);
  const asignacionesPorReserva = useMemo(() => agruparPorReserva(asignacionesTurno), [asignacionesTurno]);

  /**
   * Quién ocupa cada mesa en el turno elegido, por orden de hora. Con «Todo el
   * día» puede haber varias reservas en una mesa («14:00 Oscar · 20:30
   * Ezequiel»), y también dentro de un turno si sus horas no se pisan.
   */
  const ocupacionesPorMesa = useMemo(() => {
    const mapa = new Map<string, AsignacionConDetalles[]>();
    for (const id of new Set(asignacionesTurno.map((a) => a.mesa_id))) {
      mapa.set(id, ocupacionesDeMesa(asignacionesTurno, id));
    }
    return mapa;
  }, [asignacionesTurno]);

  const ocupantesDeMesa = useCallback(
    (mesaId: string): AsignacionConDetalles[] => ocupacionesPorMesa.get(mesaId) ?? [],
    [ocupacionesPorMesa],
  );

  /**
   * ¿Puede `reserva` usar esta mesa? Devuelve la frase de por qué no («La mesa
   * 3 está ocupada de 14:00 a 16:00 por Oscar») o `null` si está libre a SU
   * hora. Mira el día entero, no solo el turno que se pinta.
   */
  const motivoMesaOcupada = useCallback(
    (mesa: { id: string; nombre: string }, reserva: { id: string; hora: string }): string | null => {
      const conflicto = conflictoDeMesa(asignacionesDia, mesa.id, reserva, configOcupacion);
      return conflicto ? textoMesaOcupada(mesa.nombre, conflicto) : null;
    },
    [asignacionesDia, configOcupacion],
  );

  const mesaIdsDe = useCallback(
    (reservaId: string): string[] => (asignacionesPorReserva.get(reservaId) ?? []).map((a) => a.mesa_id),
    [asignacionesPorReserva],
  );

  const nombresMesasDe = useCallback(
    (reservaId: string): string[] =>
      mesaIdsDe(reservaId).map((id) => mesasPorId.get(id)?.nombre ?? "Mesa"),
    [mesaIdsDe, mesasPorId],
  );

  const reservaActiva = useMemo(
    () => reservasTurno.find((r) => r.id === reservaActivaId) ?? null,
    [reservasTurno, reservaActivaId],
  );
  const mesaIdsActivos = reservaActiva ? mesaIdsDe(reservaActiva.id) : [];
  const plazasActivas = plazasDeMesas(mesaIdsActivos, mesasPorId);

  const resumen = useMemo(
    () => resumenCierreDia(reservasTurno, asignacionesPorReserva),
    [reservasTurno, asignacionesPorReserva],
  );

  const mesasOcupadas = ocupacionesPorMesa.size;

  const reservasPendientes = useMemo(
    () => reservasTurno.filter((r) => mesaIdsDe(r.id).length === 0),
    [reservasTurno, mesaIdsDe],
  );
  const reservasConMesa = useMemo(
    () => reservasTurno.filter((r) => mesaIdsDe(r.id).length > 0),
    [reservasTurno, mesaIdsDe],
  );

  // ── Salto: abrir señalando una reserva, lista para sentar ─────────────────

  /**
   * Atiende el encargo de `reservaId` / `?reserva=`: deja la reserva activa y,
   * SOLO SI EL TURNO NO HA VENIDO POR PROP, lo deduce de su hora.
   *
   * POR QUÉ EL TURNO IMPORTA TANTO
   * El panel solo lista `reservasTurno`, y el turno por defecto es el del
   * momento de abrir la pantalla (`turnoDeHora(new Date()...)`). Si alguien
   * salta a una reserva de CENA a mediodía y el turno se queda en comida, el
   * salto lleva a un panel donde esa reserva NO está: la pantalla se abre
   * "vacía" y quien venía a sentarla no la encuentra.
   *
   * POR QUÉ DEDUCIRLO AQUÍ ES SOLO EL RESPALDO
   * Esta vía —esperar a que carguen las reservas del día y entonces
   * `setFiltroTurno`— NO funciona en el navegador: medido el 2026-09-28,
   * saltando desde Hoy y desde la lista a una cena siendo mediodía, la URL sí
   * quedaba en `turno=cena` y `setReservaActivaId` sí se aplicaba, pero el
   * panel seguía en comida (muestreado cada 40 ms durante 1,9 s: nunca llegaba
   * a cena). O sea: de las tres cosas que hace este efecto, justo el
   * `setFiltroTurno` se perdía. No se ha podido aislar el mecanismo exacto
   * —apunta a que la instancia que ejecuta este efecto no es la que acaba
   * pintando, por un remontaje o una carrera con la navegación de
   * `setSearchParams`—, pero la forma de la prueba es clara: lo que llega como
   * PROP AL MONTAR es fiable, y lo que se escribe con `setState` después, en
   * este camino, no. De ahí que el turno viaje ahora con el destino
   * (`saltoAsignacion.ts`) y entre por `turnoInicial`.
   *
   * Se conserva la deducción porque la vía `?reserva=` de la URL no trae prop
   * `turno` y ahí sigue haciendo falta. Cuando la prop existe, ella manda: este
   * efecto ni toca el filtro.
   *
   * UNA SOLA VEZ POR SALTO: el encargo se consume (`setReservaSenalada(null)`)
   * en cuanto se atiende, encontrada o no. Después el filtro es del usuario, y
   * si él cambia de turno a mano nadie se lo vuelve a mover.
   */
  useEffect(() => {
    if (!reservaSenalada) return;
    // `undefined` = las reservas del día todavía están cargando. Sin esta
    // espera se diría "no está" antes de haber mirado.
    if (!reservasDia) return;

    const reserva = reservasDia.find((r) => r.id === reservaSenalada);
    setReservaSenalada(null);

    if (!reserva) {
      // Ni error ni rojo: que la reserva sea de otra sala o de otro día es un
      // caso normal (la han movido, o se viene de un enlace viejo). El plano se
      // queda EXACTAMENTE como estaba, sin cambiar de día ni de turno.
      toast.info(
        `Esa reserva no está en ${espacioNombre} el ${fechaCorta(fechaSel)}. Puede que sea de otra sala o de otro día.`,
      );
      sincronizarUrl(fechaSel, filtroTurno);
      return;
    }

    // Con prop manda la prop —ya la puso `turnoInicial` al montar—; sin ella,
    // la hora de la reserva.
    const turnoDestino: FiltroTurno = esFiltroTurno(turno) ? turno : turnoDeHora(reserva.hora);
    if (!esFiltroTurno(turno)) setFiltroTurno(turnoDestino);
    // Se fija DIRECTO, no con `activarReserva`: esa función ALTERNA, así que un
    // segundo salto a la misma reserva la apagaría justo cuando se pedía verla.
    setReservaActivaId(reserva.id);
    setSelectedMesa(null);
    setReservaAEnfocar(reserva.id);
    // Deja la URL en `?fecha=&turno=` (con el turno del destino) y sin
    // `reserva`: ver `sincronizarUrl`.
    sincronizarUrl(fechaSel, turnoDestino);
  }, [reservaSenalada, reservasDia, fechaSel, filtroTurno, turno, espacioNombre, sincronizarUrl]);

  /** Asomarse a la tarjeta señalada en cuanto exista. */
  useEffect(() => {
    if (!reservaAEnfocar) return;
    // La tarjeta solo existe si la reserva entra en el turno que se está
    // pintando; si no, se espera al render en que sí.
    if (!reservasTurno.some((r) => r.id === reservaAEnfocar)) return;

    // Se busca por `data-` recorriendo, y no con un selector de atributo, para
    // no tener que escapar el id.
    const fila = Array.from(
      panelReservasRef.current?.querySelectorAll<HTMLElement>("[data-reserva-fila]") ?? [],
    ).find((el) => el.dataset.reservaFila === reservaAEnfocar);
    if (!fila) return;

    // `nearest` y sin `behavior: "smooth"`: si la tarjeta ya se ve no se mueve
    // nada, y si no, se mueve lo justo. En pleno servicio un salto de scroll
    // largo y animado despista más que ayuda.
    // El `?.` es por jsdom, que no implementa `scrollIntoView`.
    fila.scrollIntoView?.({ block: "nearest" });
    setReservaAEnfocar(null);
  }, [reservaAEnfocar, reservasTurno]);

  // ── Guardar / deshacer ────────────────────────────────────────────────────

  /**
   * Única puerta de escritura. `mesaIds` es la lista COMPLETA que tendrá la
   * reserva: vacía = quitarle las mesas (sigue con sala, pendiente de mesa).
   */
  const guardarMesas = useCallback(
    async (
      reserva: ReservaSala,
      mesaIds: string[],
      opciones?: { registrarDeshacer?: boolean; mensaje?: string; plazas?: number },
    ) => {
      const antes = mesaIdsDe(reserva.id);
      const nombresNuevos = mesaIds.map((id) => mesasPorId.get(id)?.nombre ?? "Mesa");

      // Solo se bloquea AÑADIR una mesa no ofrecida: si la reserva ya la tenía
      // se le deja conservar (y soltar las demás).
      const noOfrecida = mesaIds.find((id) => !antes.includes(id) && mesasNoOfrecidas.has(id));
      if (noOfrecida) {
        toast.error(
          `${mesasPorId.get(noOfrecida)?.nombre ?? "Esa mesa"} no se ofrece al asignar (está desmarcada en Configuración). Elige otra.`,
        );
        return false;
      }

      try {
        // `silencioso`: el mensaje de éxito lo pone esta pantalla, que sabe
        // nombrar las mesas ("María → Mesa 4 + Mesa 5"). El de ERROR lo pone el
        // hook con `mensajeErrorAsignacion`, así que aquí NO se repite: dos
        // avisos idénticos encima del otro.
        await asignarMesas.mutateAsync({ reserva_id: reserva.id, mesa_ids: mesaIds, silencioso: true });
      } catch {
        // La base de datos es la que manda sobre "mesa ocupada": se refresca el
        // plano con lo que hay de verdad ahora mismo.
        await refetchAsignaciones();
        return false;
      }

      if (opciones?.registrarDeshacer !== false) {
        setUltimoCambio({
          reservaId: reserva.id,
          nombre: reserva.nombre,
          mesaIdsAntes: antes,
          descripcion:
            mesaIds.length === 0
              ? `Mesas quitadas a ${reserva.nombre}`
              : `${reserva.nombre} en ${nombreMesasJuntas(nombresNuevos)}`,
        });
      }

      await refetchAsignaciones();

      // `plazas` llega hecho cuando se acaban de ajustar piezas: `mesasPorId` aún no lo sabe.
      const plazas = opciones?.plazas ?? plazasDeMesas(mesaIds, mesasPorId);
      const ajuste = ajusteCapacidad(reserva.numero_comensales, plazas);

      if (mesaIds.length === 0) {
        toast.success(`${reserva.nombre} se queda pendiente de mesa`);
      } else {
        toast.success(opciones?.mensaje ?? `${reserva.nombre} → ${nombreMesasJuntas(nombresNuevos)}`);
      }

      // AVISO, no bloqueo: es exactamente el caso "estos 6 caben juntando la 4
      // y la 5", así que se guarda y se invita a juntar otra mesa.
      if (ajuste.estado === "excede") {
        toast.warning(
          `${nombreMesasJuntas(nombresNuevos)} da ${plazas} plazas y son ${reserva.numero_comensales}: faltan ${Math.abs(
            ajuste.diferencia,
          )}. Puedes juntar otra mesa o dejarlo así.`,
        );
      }

      // Si ya caben, se cierra la barra para poder pasar a la siguiente
      // reserva; si no caben, se queda abierta invitando a juntar.
      if (ajuste.estado !== "excede" && mesaIds.length > 0) setReservaActivaId(null);

      return true;
    },
    [asignarMesas, mesaIdsDe, mesasPorId, mesasNoOfrecidas, refetchAsignaciones],
  );

  const deshacer = useCallback(async () => {
    if (!ultimoCambio) return;
    const reserva = (reservasDia ?? []).find((r) => r.id === ultimoCambio.reservaId);
    try {
      await asignarMesas.mutateAsync({
        reserva_id: ultimoCambio.reservaId,
        mesa_ids: ultimoCambio.mesaIdsAntes,
        silencioso: true,
      });
    } catch {
      // El error ya lo explica el hook; aquí solo se recoge el plano.
      await refetchAsignaciones();
      return;
    }
    await refetchAsignaciones();
    setUltimoCambio(null);
    const nombres = ultimoCambio.mesaIdsAntes.map((id) => mesasPorId.get(id)?.nombre ?? "Mesa");
    toast.success(
      ultimoCambio.mesaIdsAntes.length === 0
        ? `Deshecho: ${reserva?.nombre ?? ultimoCambio.nombre} vuelve a estar pendiente de mesa`
        : `Deshecho: ${reserva?.nombre ?? ultimoCambio.nombre} vuelve a ${nombreMesasJuntas(nombres)}`,
    );
  }, [ultimoCambio, reservasDia, asignarMesas, refetchAsignaciones, mesasPorId]);

  // ── Interacción ───────────────────────────────────────────────────────────

  const activarReserva = useCallback(
    (reserva: ReservaSala) => {
      setReservaActivaId((actual) => (actual === reserva.id ? null : reserva.id));
      setSelectedMesa(null);
    },
    [],
  );

  const pedirQuitarMesas = useCallback(
    (reserva: ReservaSala) => {
      setAQuitarMesas({ reserva, mesas: nombreMesasJuntas(nombresMesasDe(reserva.id)) });
    },
    [nombresMesasDe],
  );

  // Se cierra el diálogo AL FINAL (en el `finally`), no antes de guardar, igual
  // que `confirmarBorrado` en GestionMesasEspacios.tsx. Cerrarlo primero y
  // hacer después el guardado + refetch interrumpe la secuencia de cierre de
  // Radix a media animación: el diálogo se queda en el DOM con
  // `data-state="closed"` y, lo grave, `document.body` se queda con
  // `pointer-events: none`, o sea LA PANTALLA ENTERA CONGELADA justo en
  // pleno servicio (verificado en el navegador: tras confirmar, ni "Deshacer"
  // ni ninguna otra acción volvían a responder). De paso arregla que el título
  // parpadeara como "¿Quitar las mesas de ?" al anularse el nombre antes de
  // que el diálogo terminara de desaparecer.
  const confirmarQuitarMesas = useCallback(async () => {
    if (!aQuitarMesas) return;
    const pendiente = aQuitarMesas;
    try {
      await guardarMesas(pendiente.reserva, []);
      setReservaActivaId(null);
    } finally {
      setAQuitarMesas(null);
    }
  }, [aQuitarMesas, guardarMesas]);

  /** Clic en una mesa mientras se sienta a una reserva: la añade o la quita. */
  const alternarMesa = useCallback(
    (mesa: Mesa) => {
      if (!reservaActiva) return;
      const actuales = mesaIdsDe(reservaActiva.id);

      if (actuales.includes(mesa.id)) {
        const restantes = actuales.filter((id) => id !== mesa.id);
        if (restantes.length === 0) {
          pedirQuitarMesas(reservaActiva);
          return;
        }
        void guardarMesas(reservaActiva, restantes, {
          mensaje: `${mesa.nombre} liberada · ${reservaActiva.nombre} en ${nombreMesasJuntas(
            restantes.map((id) => mesasPorId.get(id)?.nombre ?? "Mesa"),
          )}`,
        });
        return;
      }

      // Cortesía: avisar antes de gastar un viaje al servidor. La comprobación
      // de verdad la hace la base de datos (ver cabecera del fichero). Libre u
      // ocupada se decide por la FRANJA de esta reserva, no por el turno.
      const motivo = motivoMesaOcupada(mesa, reservaActiva);
      if (motivo) {
        toast.error(`${motivo}. Elige otra mesa o quítasela primero.`);
        return;
      }

      // Mesa junta con otras en este servicio: se sienta en toda la fila.
      const union = turnoServicio ? mesasDeLaUnion(estadoPiezas, mesa.id) : [mesa.id];
      for (const id of union) {
        const otra = mesasPorId.get(id);
        const motivoOtra = otra && id !== mesa.id ? motivoMesaOcupada(otra, reservaActiva) : null;
        if (motivoOtra) {
          toast.error(`${motivoOtra}. Elige otra mesa o sepáralas primero.`);
          return;
        }
      }
      const nuevas = [...actuales, ...union.filter((id) => !actuales.includes(id))];

      // No cabe en una mesa por piezas: la app PROPONE cómo agrandarla y
      // espera a que el usuario pulse «Hacer». Nunca mueve piezas sola.
      const reserva = reservaActiva;
      if (
        turnoServicio &&
        actuales.length === 0 &&
        union.length === 1 &&
        plazasDeMesas(nuevas, mesasPorId) < reserva.numero_comensales &&
        mesasPiezas.some((m) => m.id === mesa.id)
      ) {
        const resultado = proponerParaSentar({
          mesas: mesasPiezas,
          estado: estadoPiezas,
          reservas: reservasEnMesas.filter((r) => r.reservaId !== reserva.id),
          mesaId: mesa.id,
          comensales: reserva.numero_comensales,
        });
        if (resultado.propuestas.length > 0 || resultado.motivo) {
          setPropuestaPiezas({
            titulo: `${reserva.nombre} · ${reserva.numero_comensales} en la ${mesa.nombre}`,
            resultado,
            extra: {
              texto: "Sentar sin ajustar",
              accion: () => {
                setPropuestaPiezas(null);
                void guardarMesas(reserva, nuevas);
              },
            },
            hacer: async (p) => {
              if (!(await guardarPiezas(p.cambios, null))) return;
              setPropuestaPiezas(null);
              const final = aplicarCambios(estadoPiezas, p.cambios).get(mesa.id);
              await guardarMesas(reserva, nuevas, {
                plazas: final ? plazasDe(final) : undefined,
                mensaje: `${reserva.nombre} → ${mesa.nombre} (${p.texto.replace(/^Para sentar [^:]+: /, "")})`,
              });
            },
          });
          return;
        }
      }

      void guardarMesas(reserva, nuevas);
    },
    [
      reservaActiva,
      mesaIdsDe,
      motivoMesaOcupada,
      guardarMesas,
      pedirQuitarMesas,
      mesasPorId,
      turnoServicio,
      estadoPiezas,
      mesasPiezas,
      reservasEnMesas,
      guardarPiezas,
    ],
  );

  const seleccionarMesa = useCallback((mesa: Mesa) => setSelectedMesa(mesa), []);

  // Arrastrar una reserva a una mesa: la AÑADE a las que ya tenga, así que
  // arrastrar la misma reserva a una segunda mesa las junta.
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === "reserva") {
      setActiveReserva(active.data.current.reserva as ReservaSala);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveReserva(null);
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (activeData?.type !== "reserva" || overData?.type !== "mesa") return;

    const reserva = activeData.reserva as ReservaSala;
    const mesa = overData.mesa as Mesa;
    const actuales = mesaIdsDe(reserva.id);

    if (actuales.includes(mesa.id)) {
      toast.info(`${reserva.nombre} ya tiene la ${mesa.nombre}`);
      return;
    }

    const motivo = motivoMesaOcupada(mesa, reserva);
    if (motivo) {
      toast.error(`${motivo}. Elige otra mesa o quítasela primero.`);
      return;
    }

    // Sin bloqueo por capacidad: se guarda y, si no caben, se avisa.
    await guardarMesas(reserva, [...actuales, mesa.id]);
  };

  // ── Plano: dimensiones, zoom y pan (sin cambios de comportamiento) ────────
  const PIXELS_PER_METER = plano?.pixels_per_meter || 50;
  const realWidth = plano?.ancho_metros || 12;
  const realHeight = plano?.alto_metros || 8;
  const canvasWidth = realWidth * PIXELS_PER_METER;
  const canvasHeight = realHeight * PIXELS_PER_METER;
  // Memoizado: sin esto el `|| []` crea un array nuevo en cada render y tira
  // por tierra el `useMemo` de `contentBounds` (que es el cálculo caro).
  const elementosPlano: ElementoPlano[] = useMemo(
    () => plano?.configuracion?.elementos || [],
    [plano?.configuracion?.elementos],
  );

  // El encuadre (caja de paredes, elementos y mesas con un metro de margen) vive en
  // `elementosPlano.tsx`, compartido con la vista «Plano» de «Hoy».
  const contentBounds = useMemo(
    () => limitesContenidoPlano(elementosPlano, localMesas, PIXELS_PER_METER, canvasWidth, canvasHeight),
    [elementosPlano, localMesas, PIXELS_PER_METER, canvasWidth, canvasHeight],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
    // Depende de `loadingMesas`: el contenedor del plano no existe mientras se
    // muestra el spinner de carga, y con `[]` el observador nunca llegaba a
    // engancharse (el plano se encuadraba para 800x500 en cualquier pantalla).
  }, [loadingMesas]);

  const autoScale = useMemo(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0) return 1;
    if (contentBounds.width <= 0 || contentBounds.height <= 0) return 1;
    const padding = 32;
    return Math.min(
      (containerSize.width - padding) / contentBounds.width,
      (containerSize.height - padding) / contentBounds.height,
    );
  }, [containerSize.width, containerSize.height, contentBounds.width, contentBounds.height]);

  const scale = manualZoom !== null ? manualZoom : autoScale;

  const handleZoomIn = useCallback(() => {
    const currentScale = manualZoom !== null ? manualZoom : autoScale;
    setManualZoom(Math.min(currentScale * 1.25, 5));
  }, [manualZoom, autoScale]);

  const handleZoomOut = useCallback(() => {
    const currentScale = manualZoom !== null ? manualZoom : autoScale;
    setManualZoom(Math.max(currentScale * 0.8, 0.2));
  }, [manualZoom, autoScale]);

  const handleCenterView = useCallback(() => {
    setManualZoom(null);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const currentScale = manualZoom !== null ? manualZoom : autoScale;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setManualZoom(Math.min(Math.max(currentScale * delta, 0.2), 5));
    },
    [manualZoom, autoScale],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.code === "Space" && !isSpacePressed) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleCenterView();
      }
      // Escape deja de sentar a la reserva activa: salida rápida sin ratón.
      if (e.code === "Escape") setReservaActivaId(null);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isSpacePressed, handleCenterView]);

  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      if (isSpacePressed) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      }
    },
    [isSpacePressed, panOffset],
  );

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning && isSpacePressed) {
        setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      }
    },
    [isPanning, isSpacePressed, panStart],
  );

  const handlePanEnd = useCallback(() => setIsPanning(false), []);

  const offsetX = contentBounds.minX;
  const offsetY = contentBounds.minY;

  useEffect(() => {
    if (mesas) setLocalMesas(mesas);
  }, [mesas]);

  // ── Recolocar mesas en el plano ───────────────────────────────────────────
  const handleMesaDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, mesa: Mesa) => {
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    arrastreArmadoRef.current = false;
    setDragState({
      isDragging: true,
      mesaId: mesa.id,
      startX: clientX,
      startY: clientY,
      offsetX: mesa.pos_x,
      offsetY: mesa.pos_y,
    });
    setSelectedMesa(mesa);
  }, []);

  const handleMesaMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragState.isDragging || !dragState.mesaId) return;
      // Zona muerta: un dedo nunca está quieto, y tocar una mesa para
      // seleccionarla no debe moverla ni guardar nada.
      if (!arrastreArmadoRef.current) {
        if (Math.hypot(clientX - dragState.startX, clientY - dragState.startY) < 6) return;
        arrastreArmadoRef.current = true;
      }
      const deltaX = (clientX - dragState.startX) / (PIXELS_PER_METER * scale);
      const deltaY = (clientY - dragState.startY) / (PIXELS_PER_METER * scale);

      setLocalMesas((prev) =>
        prev.map((m) =>
          m.id === dragState.mesaId
            ? {
                ...m,
                pos_x: Math.max(0, Math.min(realWidth - (m.ancho || 80) / 100, dragState.offsetX + deltaX)),
                pos_y: Math.max(0, Math.min(realHeight - (m.alto || 80) / 100, dragState.offsetY + deltaY)),
              }
            : m,
        ),
      );
    },
    [dragState, PIXELS_PER_METER, scale, realWidth, realHeight],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => handleMesaMove(e.clientX, e.clientY),
    [handleMesaMove],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (dragState.isDragging) {
        e.preventDefault();
        handleMesaMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    [dragState.isDragging, handleMesaMove],
  );

  const handleMesaDragEnd = useCallback(() => {
    if (dragState.isDragging && dragState.mesaId) {
      const mesa = localMesas.find((m) => m.id === dragState.mesaId);
      // Sólo se escribe si la mesa se ha movido de verdad (un toque suelto no).
      if (mesa && (mesa.pos_x !== dragState.offsetX || mesa.pos_y !== dragState.offsetY)) {
        actualizarMesasSilent.mutate([{ id: mesa.id, pos_x: mesa.pos_x, pos_y: mesa.pos_y }]);
      }
    }
    arrastreArmadoRef.current = false;
    setDragState({ isDragging: false, mesaId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
  }, [dragState, localMesas, actualizarMesasSilent]);

  // ── Gestos táctiles del plano: pellizco (zoom), dos dedos (pan), un dedo sobre
  // el vacío (pan). Los valores vivos se leen de refs para no re-crear los
  // listeners en cada render. El "viewport" equivalente es una matriz
  // [escala,0,0,escala,x,y] con el origen en el CENTRO del contenido, que es
  // donde el plano lo ancla (`left: 50% + pan`).
  const escalaViva = useRef(1);
  const panVivo = useRef({ x: 0, y: 0 });
  const arrastreVivo = useRef<DragState | null>(null);
  escalaViva.current = manualZoom !== null ? manualZoom : autoScale;
  panVivo.current = panOffset;
  arrastreVivo.current = dragState;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const controlador = crearGestosTactiles({
      elemento: el,
      zoomMin: 0.2,
      zoomMax: 5,
      obtenerVpt: () => {
        const r = el.getBoundingClientRect();
        const z = escalaViva.current;
        return [z, 0, 0, z, r.width / 2 + panVivo.current.x, r.height / 2 + panVivo.current.y] as Vpt;
      },
      aplicarVpt: (v) => {
        const r = el.getBoundingClientRect();
        setManualZoom(v[0]);
        setPanOffset({ x: v[4] - r.width / 2, y: v[5] - r.height / 2 });
      },
      // Sobre una mesa manda la mesa (tocar / recolocar); sobre el vacío, el plano.
      decidirUnDedo: (e) => ((e.target as HTMLElement | null)?.closest?.("[data-mesa-id]") ? "no" : "pan-umbral"),
      // Un segundo dedo = pellizco: si había una mesa a medio recolocar, vuelve a su sitio.
      alIniciarPellizco: () => {
        const arrastre = arrastreVivo.current;
        if (arrastre?.isDragging && arrastre.mesaId) {
          setLocalMesas((prev) =>
            prev.map((m) =>
              m.id === arrastre.mesaId ? { ...m, pos_x: arrastre.offsetX, pos_y: arrastre.offsetY } : m,
            ),
          );
        }
        arrastreArmadoRef.current = false;
        setDragState({ isDragging: false, mesaId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
      },
    });
    return controlador.destruir;
  }, [loadingMesas]);

  // ── Alta y baja de mesas ──────────────────────────────────────────────────
  const handleAddMesa = async () => {
    if (!newMesa.nombre.trim()) {
      toast.error("Introduce un nombre para la mesa");
      return;
    }
    // `pos_x/pos_y` van en METROS. Antes se daba `50, 50` (parecía píxeles de
    // escena pero se leía como 50 m): la mesa nacía fuera del plano y el editor
    // no la mostraba. Ahora se coge el primer hueco libre dentro de la sala.
    const posicion = posicionInicialMesaNueva({
      anchoCm: newMesa.ancho,
      altoCm: newMesa.alto,
      forma: newMesa.forma,
      espacio: { width: realWidth, height: realHeight },
      mesas: localMesas,
      elementos: elementosPlano,
      pixelsPerMeter: PIXELS_PER_METER,
    });
    await crearMesa.mutateAsync({
      espacio_id: espacioId,
      nombre: newMesa.nombre.trim(),
      capacidad: newMesa.capacidad,
      forma: newMesa.forma,
      ancho: newMesa.ancho,
      alto: newMesa.forma === "circular" ? newMesa.ancho : newMesa.alto,
      pos_x: posicion.pos_x,
      pos_y: posicion.pos_y,
    });
    if (posicion.sinHueco) {
      toast.warning(
        `No quedaba ningún hueco libre: la mesa ${newMesa.nombre.trim()} se ha colocado en ` +
          `(${posicion.pos_x} m, ${posicion.pos_y} m) y puede estar encima de otra o de una pared. ` +
          "Muévela a su sitio en el editor de plano.",
      );
    }
    setNewMesa({ nombre: "", capacidad: 4, forma: "rectangular", ancho: 80, alto: 80 });
    setShowAddMesa(false);
  };

  // Mismo orden que `confirmarQuitarMesas`: primero se borra y el diálogo se
  // cierra en el `finally`. Cerrarlo antes del await deja `pointer-events:
  // none` pegado al body y la pantalla congelada (ver el comentario largo de
  // `confirmarQuitarMesas`).
  const confirmarBorrarMesa = async () => {
    if (!mesaABorrar) return;
    const mesa = mesaABorrar;
    try {
      await eliminarMesa.mutateAsync(mesa.id);
      setSelectedMesa(null);
    } finally {
      setMesaABorrar(null);
    }
  };

  // ── PDF del servicio ──────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    toast.info("Preparando PDF...");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const { default: jsPDF } = await import("jspdf");

      const tempContainer = document.createElement("div");
      tempContainer.style.position = "fixed";
      tempContainer.style.left = "-9999px";
      tempContainer.style.top = "0";
      tempContainer.style.width = `${contentBounds.width}px`;
      tempContainer.style.height = `${contentBounds.height}px`;
      tempContainer.style.backgroundColor = "#ffffff";
      tempContainer.style.overflow = "visible";
      document.body.appendChild(tempContainer);

      const contentDiv = document.createElement("div");
      contentDiv.style.position = "relative";
      contentDiv.style.width = "100%";
      contentDiv.style.height = "100%";
      tempContainer.appendChild(contentDiv);

      const gridSize = 50;
      for (let x = 0; x <= contentBounds.width; x += gridSize) {
        const line = document.createElement("div");
        line.style.position = "absolute";
        line.style.left = `${x}px`;
        line.style.top = "0";
        line.style.width = "1px";
        line.style.height = "100%";
        line.style.backgroundColor = "#e5e7eb";
        contentDiv.appendChild(line);
      }
      for (let y = 0; y <= contentBounds.height; y += gridSize) {
        const line = document.createElement("div");
        line.style.position = "absolute";
        line.style.left = "0";
        line.style.top = `${y}px`;
        line.style.width = "100%";
        line.style.height = "1px";
        line.style.backgroundColor = "#e5e7eb";
        contentDiv.appendChild(line);
      }

      // Misma geometría que `renderElementoPlano`, en imperativo: esta rama
      // construye el plano con nodos sueltos del DOM porque html2canvas
      // necesita un árbol fuera de pantalla. Aquí no hay zoom (escala 1).
      const colocarRect = (div: HTMLDivElement, rect: RectFabric) => {
        div.style.left = `${rect.left - offsetX}px`;
        div.style.top = `${rect.top - offsetY}px`;
        div.style.width = `${rect.width}px`;
        div.style.height = `${rect.height}px`;
        const rotacion = estiloRotacionElemento(rect.angle);
        div.style.transform = rotacion.transform;
        div.style.transformOrigin = rotacion.transformOrigin;
      };

      elementosPlano.forEach((elem) => {
        const props = elem.props || elem;
        const elemDiv = document.createElement("div");
        elemDiv.style.position = "absolute";

        switch (elem.tipo) {
          case "wall": {
            const x1 = props.x1 ?? 0;
            const y1 = props.y1 ?? 0;
            const x2 = props.x2 ?? 0;
            const y2 = props.y2 ?? 0;
            const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            elemDiv.style.left = `${x1 - offsetX}px`;
            // Medio grosor arriba, igual que en la vista (ver `case "wall"`).
            elemDiv.style.top = `${y1 - offsetY - GROSOR_PARED_ESCENA / 2}px`;
            elemDiv.style.width = `${length}px`;
            elemDiv.style.height = `${GROSOR_PARED_ESCENA}px`;
            elemDiv.style.backgroundColor = "#374151";
            elemDiv.style.transform = `rotate(${angle}deg)`;
            elemDiv.style.transformOrigin = "0 50%";
            break;
          }
          case "rectangle":
          case "area": {
            colocarRect(elemDiv, rectDeElemento(elem, 100, 100));
            // `||` a propósito, igual que en la vista: un `fill` vacío no es un
            // color válido y debe caer al de por defecto.
            elemDiv.style.backgroundColor = props.fill || elem.fill || "rgba(226, 232, 240, 0.5)";
            elemDiv.style.border = "2px solid #64748b";
            elemDiv.style.borderRadius = "4px";
            break;
          }
          case "circle": {
            // Sin rotar, por lo mismo que en la vista (ver `case "circle"`).
            const radius = props.radius ?? elem.radius ?? 30;
            elemDiv.style.left = `${(props.left ?? elem.left ?? 0) - offsetX}px`;
            elemDiv.style.top = `${(props.top ?? elem.top ?? 0) - offsetY}px`;
            elemDiv.style.width = `${radius * 2}px`;
            elemDiv.style.height = `${radius * 2}px`;
            elemDiv.style.backgroundColor = props.fill || elem.fill || "#e2e8f0";
            elemDiv.style.border = "2px solid #64748b";
            elemDiv.style.borderRadius = "50%";
            break;
          }
          case "door": {
            colocarRect(elemDiv, rectDeElemento(elem, 70, 12));
            elemDiv.style.backgroundColor = "#fef3c7";
            elemDiv.style.border = "2px solid #d97706";
            elemDiv.style.borderRadius = "2px";
            break;
          }
          case "window": {
            colocarRect(elemDiv, rectDeElemento(elem, 60, 8));
            elemDiv.style.backgroundColor = "#bfdbfe";
            elemDiv.style.border = "2px solid #3b82f6";
            break;
          }
          default:
            return;
        }
        contentDiv.appendChild(elemDiv);
      });

      localMesas.forEach((mesa) => {
        const ocupantes = ocupantesDeMesa(mesa.id);
        const asignacion = ocupantes[0];
        const posXPixels = (mesa.pos_x || 0) * PIXELS_PER_METER - offsetX;
        const posYPixels = (mesa.pos_y || 0) * PIXELS_PER_METER - offsetY;
        const anchoPixels = ((mesa.ancho || 80) / 100) * PIXELS_PER_METER;
        const altoPixels = ((mesa.alto || 80) / 100) * PIXELS_PER_METER;

        const mesaDiv = document.createElement("div");
        mesaDiv.style.position = "absolute";
        mesaDiv.style.left = `${posXPixels}px`;
        mesaDiv.style.top = `${posYPixels}px`;
        mesaDiv.style.width = `${anchoPixels}px`;
        mesaDiv.style.height = `${altoPixels}px`;
        mesaDiv.style.backgroundColor = asignacion ? "#bbf7d0" : "#e5e7eb";
        mesaDiv.style.border = "2px solid #6b7280";
        mesaDiv.style.borderRadius = mesa.forma === "circular" ? "50%" : "8px";
        // La mesa gira alrededor de su CENTRO (ojo, al revés que los elementos
        // del plano: ver el comentario de `ORIGEN_ROTACION_ELEMENTO`). El PDF
        // se dejaba la rotación sin aplicar y sacaba todas las mesas rectas.
        mesaDiv.style.transform = `rotate(${mesa.rotacion ?? 0}deg)`;
        mesaDiv.style.transformOrigin = "center center";
        mesaDiv.style.display = "flex";
        mesaDiv.style.alignItems = "center";
        mesaDiv.style.justifyContent = "center";
        mesaDiv.style.fontSize = "11px";
        mesaDiv.style.fontWeight = "600";
        mesaDiv.style.color = "#1f2937";
        mesaDiv.textContent = mesa.nombre;
        contentDiv.appendChild(mesaDiv);

        if (asignacion) {
          const cardDiv = document.createElement("div");
          cardDiv.style.position = "absolute";
          cardDiv.style.left = `${posXPixels + anchoPixels / 2}px`;
          cardDiv.style.top = `${posYPixels - 45 - (ocupantes.length - 1) * 16}px`;
          cardDiv.style.transform = "translateX(-50%)";
          cardDiv.style.backgroundColor = "#16a34a";
          cardDiv.style.color = "white";
          cardDiv.style.padding = "6px 10px";
          cardDiv.style.borderRadius = "8px";
          cardDiv.style.fontSize = "11px";
          cardDiv.style.fontWeight = "600";
          cardDiv.style.whiteSpace = "nowrap";
          cardDiv.style.boxShadow = "0 4px 6px rgba(0,0,0,0.15)";
          cardDiv.style.textAlign = "center";
          cardDiv.style.lineHeight = "1.3";
          cardDiv.style.minWidth = "80px";

          if (ocupantes.length > 1) {
            // Varias reservas en la misma mesa (a horas que no se pisan): una
            // línea por reserva, «14:00 Oscar · 3 pers.».
            for (const ocupante of ocupantes) {
              const linea = document.createElement("div");
              linea.style.fontSize = "11px";
              linea.textContent = `${horaCorta(ocupante.reservas.hora)} ${nombreCorto(ocupante.reservas.nombre)} · ${ocupante.reservas.numero_comensales} pers.`;
              cardDiv.appendChild(linea);
            }
          } else {
            const nameSpan = document.createElement("div");
            nameSpan.style.fontWeight = "700";
            nameSpan.style.fontSize = "12px";
            nameSpan.textContent = asignacion.reservas.nombre || "Sin nombre";

            const infoSpan = document.createElement("div");
            infoSpan.style.fontSize = "10px";
            infoSpan.style.opacity = "0.9";
            infoSpan.textContent = `${horaCorta(asignacion.reservas.hora)} · ${asignacion.reservas.numero_comensales} pers.`;

            cardDiv.appendChild(nameSpan);
            cardDiv.appendChild(infoSpan);
          }
          contentDiv.appendChild(cardDiv);
        }
      });

      const canvas = await html2canvas(tempContainer, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      document.body.removeChild(tempContainer);

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;

      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text(`${espacioNombre}`, margin, 15);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      pdf.text(
        `${fechaLegible(fechaSel)} · ${etiquetaFiltroTurno(filtroTurno)}`,
        margin,
        22,
      );

      const maxImgWidth = pdfWidth - margin * 2;
      const maxImgHeight = 90;
      const imgRatio = canvas.width / canvas.height;
      let imgWidth = maxImgWidth;
      let imgHeight = imgWidth / imgRatio;
      if (imgHeight > maxImgHeight) {
        imgHeight = maxImgHeight;
        imgWidth = imgHeight * imgRatio;
      }
      pdf.addImage(imgData, "PNG", (pdfWidth - imgWidth) / 2, 28, imgWidth, imgHeight);

      const tableStartY = 28 + imgHeight + 10;
      const filas = reservasTurno
        .map((r) => ({
          nombre: r.nombre || "Sin nombre",
          hora: horaCorta(r.hora),
          comensales: r.numero_comensales,
          mesa: nombreMesasJuntas(nombresMesasDe(r.id)) || "Pendiente de mesa",
        }))
        .sort((a, b) => a.hora.localeCompare(b.hora));

      if (filas.length > 0) {
        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.text("Reservas del servicio", margin, tableStartY);

        pdf.setFontSize(10);
        pdf.setFont("helvetica", "bold");
        const colWidths = [25, 60, 28, pdfWidth - margin * 2 - 113];
        const headers = ["Hora", "Cliente", "Personas", "Mesa"];
        let xPos = margin;
        const headerY = tableStartY + 8;

        pdf.setFillColor(240, 240, 240);
        pdf.rect(margin, headerY - 4, pdfWidth - margin * 2, 7, "F");
        headers.forEach((header, i) => {
          pdf.text(header, xPos + 2, headerY);
          xPos += colWidths[i];
        });

        pdf.setFont("helvetica", "normal");
        let rowY = headerY + 8;
        filas.forEach((fila, index) => {
          if (rowY > pdfHeight - 15) {
            pdf.addPage();
            rowY = 20;
          }
          if (index % 2 === 0) {
            pdf.setFillColor(250, 250, 250);
            pdf.rect(margin, rowY - 4, pdfWidth - margin * 2, 7, "F");
          }
          xPos = margin;
          [fila.hora, fila.nombre.substring(0, 30), String(fila.comensales), fila.mesa.substring(0, 40)].forEach(
            (cell, i) => {
              pdf.text(cell, xPos + 2, rowY);
              xPos += colWidths[i];
            },
          );
          rowY += 7;
        });

        pdf.setFont("helvetica", "bold");
        pdf.text(
          `${filas.length} reservas · ${resumen.comensales} comensales · ${resumen.conMesa} con mesa · ${resumen.pendientesMesa} pendientes de mesa`,
          margin,
          rowY + 5,
        );
      } else {
        pdf.setFontSize(12);
        pdf.text("No hay reservas en este servicio", margin, tableStartY);
      }

      pdf.save(`plano-${espacioNombre}-${fechaSel}-${filtroTurno}.pdf`);
      toast.success("PDF exportado correctamente");
    } catch (error) {
      console.error("Error al exportar PDF:", error);
      toast.error("Error al exportar PDF");
    }
  };

  /**
   * Reparte de golpe las reservas que siguen pendientes de mesa.
   *
   * ANTES: llamaba por `fetch` a la Edge Function `calcular-distribucion-mesas`,
   * que INSERTABA directamente en `asignaciones_mesa`. Dos problemas gordos:
   *   1. Esa función NO EXISTE en el repositorio (`supabase/functions/` no la
   *      tiene; la única referencia era esta llamada). O estaba desplegada sin
   *      commitear —la misma enfermedad que las migraciones `20260925150523` y
   *      `20260925154109`— o el botón llevaba roto desde siempre.
   *   2. Insertando a pelo se salta TODO lo que añadió
   *      `20260926140000_asignaciones_mesa_sin_solapes.sql`: el candado, la
   *      validación de sala/estado/mesa activa y el índice único
   *      `(mesa_id, fecha, turno)`. En cuanto se aplique la migración, sus
   *      INSERT empezarían a ser rechazados a mitad, con un error críptico y
   *      medio reparto hecho.
   *
   * AHORA: el reparto se calcula aquí con `calcularDistribucionMesas` (función
   * pura y con tests) y se escribe por el MISMO camino que la asignación
   * manual, el RPC `asignar_mesas_reserva`.
   *
   * UNA LLAMADA POR RESERVA, no una que las agrupe. Por qué:
   *   - El contrato del RPC es "estas son TODAS las mesas de ESTA reserva":
   *     recibe un solo `p_reserva_id`. Agrupar exigiría un RPC nuevo, o sea una
   *     migración nueva, y `db push` está bloqueado: sería código que no se
   *     puede aplicar ni probar.
   *   - Cada llamada es atómica y coge el advisory lock, así que **ninguna
   *     reserva puede quedarse a medio sentar**, que es la garantía que
   *     importa.
   *   - Lo que NO es atómico es el LOTE. Por eso, si una mesa se ocupa por el
   *     camino, se PARA en seco (seguir aplicaría un plan ya caducado) y se
   *     dice exactamente cuántas se sentaron, en cuál se paró y por qué.
   */
  const handleCalcularDistribucion = async () => {
    if (repartiendo) return;

    // Candidatas: activas y que se ofrecen. Quién está libre A CADA HORA lo
    // decide el reparto con las franjas (lo ya sentado del día entero + lo que
    // va proponiendo): una mesa puede servir a la comida y a la cena, o a dos
    // reservas del mismo turno que no se pisen.
    const mesasCandidatas = localMesas
      .filter((m) => m.activa !== false && !mesasNoOfrecidas.has(m.id))
      .map((m) => ({ id: m.id, nombre: m.nombre, capacidad: m.capacidad }));

    const ocupaciones = asignacionesDia.flatMap((a) => {
      const franja = franjaDeHora(a.reservas?.hora ?? "", configOcupacion);
      return franja ? [{ mesa_id: a.mesa_id, franja }] : [];
    });

    const { propuestas, sinHueco } = calcularDistribucionMesas({
      reservas: reservasPendientes,
      mesasLibres: mesasCandidatas,
      franjaDe: (r) => franjaDeHora(r.hora, configOcupacion),
      ocupaciones,
    });

    if (propuestas.length === 0) {
      toast.info(
        reservasPendientes.length === 0
          ? `No hay reservas pendientes de mesa en ${etiquetaFiltroTurno(filtroTurno).toLowerCase()}.`
          : "No quedan mesas libres a esas horas que cubran las reservas pendientes.",
      );
      return;
    }

    setRepartiendo(true);
    let aplicadas = 0;
    let fallo: { nombre: string; motivo: string } | null = null;

    try {
      for (const propuesta of propuestas) {
        try {
          await asignarMesas.mutateAsync({
            reserva_id: propuesta.reserva.id,
            mesa_ids: propuesta.mesaIds,
            silencioso: true,
          });
          aplicadas += 1;
        } catch (error) {
          fallo = { nombre: propuesta.reserva.nombre, motivo: mensajeErrorAsignacion(error) };
          break;
        }
      }
    } finally {
      // El lote no se puede deshacer de un botonazo (el deshacer es de un solo
      // nivel): se limpia para no ofrecer un "Deshacer" que solo revertiría la
      // última reserva y daría a entender que revierte todo el reparto.
      setUltimoCambio(null);
      await refetchAsignaciones();
      setRepartiendo(false);
    }

    if (fallo) {
      toast.error(
        `Reparto detenido: se sentaron ${aplicadas} de ${propuestas.length}. Falló en ${fallo.nombre}: ${fallo.motivo} El plano ya está actualizado; vuelve a pulsar Repartir para seguir con el resto.`,
        { duration: 12000 },
      );
      return;
    }

    toast.success(
      aplicadas === 1 ? "Repartido: 1 reserva sentada." : `Repartido: ${aplicadas} reservas sentadas.`,
    );

    if (sinHueco.length > 0) {
      toast.warning(
        sinHueco.length === 1
          ? `${sinHueco[0].nombre} se queda pendiente de mesa: no hay mesas libres a su hora que la cubran.`
          : `${sinHueco.length} reservas se quedan pendientes de mesa: no hay mesas libres a su hora que las cubran.`,
        { duration: 9000 },
      );
    }
  };

  if (loadingMesas) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div
          role="status"
          aria-label="Cargando"
          className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"
        />
      </div>
    );
  }

  const esHoy = fechaSel === hoyLocal();
  const ajusteActivo = reservaActiva ? textoAjuste(reservaActiva.numero_comensales, plazasActivas) : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        ref={altoDePantalla ? setRaiz : undefined}
        className={cn("flex flex-col gap-3", altoPantalla ? "min-h-0" : "min-h-[calc(100dvh-220px)]")}
        style={altoPantalla ? { height: altoPantalla } : undefined}
      >
        {/* ── Cabecera ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" className="h-11 touch-manipulation" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-bold">{espacioNombre}</h3>
              <p className="truncate text-sm text-muted-foreground">
                Reparto de mesas · {fechaLegible(fechaSel)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-11 touch-manipulation" onClick={deshacer} disabled={!ultimoCambio}>
              <Undo2 className="mr-2 h-4 w-4" />
              Deshacer
            </Button>
            <Button variant="outline" size="sm" className="h-11 touch-manipulation" onClick={() => setShowAddMesa(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Mesa
            </Button>
            {/* "Repartir", no "Auto-asignar con IA": ya no llama a ninguna IA,
                reparte aquí mismo con una regla explicable (los grupos grandes
                primero, la mesa más justa que valga). */}
            <Button
              variant="outline"
              size="sm"
              className="h-11 touch-manipulation"
              onClick={handleCalcularDistribucion}
              disabled={repartiendo || reservasPendientes.length === 0}
              title={
                reservasPendientes.length === 0
                  ? `No hay reservas pendientes de mesa en ${etiquetaFiltroTurno(filtroTurno).toLowerCase()}`
                  : `Repartir mesas entre las ${reservasPendientes.length} reservas pendientes (a horas que no se pisen)`
              }
            >
              <Wand2 className="mr-2 h-4 w-4" />
              {repartiendo ? "Repartiendo…" : "Repartir"}
            </Button>
            <Button variant="outline" size="sm" className="h-11 touch-manipulation" onClick={handleExportPDF}>
              <FileDown className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>

        {/* ── Barra de trabajo: día, turno y estado de cierre ─────────────── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
            {/* Día */}
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 touch-manipulation"
                aria-label="Día anterior"
                onClick={() => moverDia(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-11 min-w-[150px] touch-manipulation justify-start px-3 font-normal"
                    aria-label={`Cambiar día · ${fechaLegible(fechaSel)}`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    {/* Corta en el botón (cabe en la barra) y completa en la
                        cabecera y en el `aria-label`: nada cortado sin salida. */}
                    <span className="truncate tabular-nums">{fechaCorta(fechaSel)}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarUI
                    mode="single"
                    selected={fechaISOaDate(fechaSel)}
                    onSelect={(d) => d && cambiarFecha(dateAFechaISO(d))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 touch-manipulation"
                aria-label="Día siguiente"
                onClick={() => moverDia(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant={esHoy ? "default" : "outline"}
                size="sm"
                className="h-11 touch-manipulation"
                onClick={() => cambiarFecha(hoyLocal())}
              >
                Hoy
              </Button>
            </div>

            {/* Turno */}
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Turno</span>
              <ToggleGroup
                type="single"
                value={filtroTurno}
                onValueChange={cambiarTurno}
                variant="outline"
                aria-label="Turno"
                className="gap-0 [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none [&>*:not(:first-child)]:-ml-px"
              >
                {OPCIONES_TURNO.map((o) => (
                  <ToggleGroupItem
                    key={o.valor}
                    value={o.valor}
                    title={o.detalle}
                    className="h-11 min-w-[4.5rem] touch-manipulation whitespace-nowrap px-4 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {o.etiqueta}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {/* Estado de cierre del día — sin lenguaje de error */}
            <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-x-4 gap-y-1">
              <div className="min-w-[160px] flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {etiquetaFiltroTurno(filtroTurno)}: mesas repartidas
                  </span>
                  <span className="text-xs font-semibold tabular-nums">
                    {resumen.conMesa}/{resumen.total}
                  </span>
                </div>
                <Progress value={resumen.porcentaje} className="mt-1 h-2" />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="h-7 gap-1 whitespace-nowrap border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-700 tabular-nums dark:bg-emerald-950/40 dark:text-emerald-300"
                  title="Reservas que ya tienen mesa"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {resumen.conMesa} con mesa
                </Badge>
                <Badge
                  variant="outline"
                  className="h-7 gap-1 whitespace-nowrap px-2 text-xs tabular-nums"
                  title="Tienen sala pero todavía no mesa. Es normal: se van cerrando poco a poco."
                >
                  <CircleDashed className="h-3 w-3" />
                  {resumen.pendientesMesa} pendientes de mesa
                </Badge>
                <Badge
                  variant="outline"
                  className="h-7 gap-1 whitespace-nowrap px-2 text-xs tabular-nums"
                  title="Mesas de esta sala libres en este turno"
                >
                  <Armchair className="h-3 w-3" />
                  {Math.max(0, localMesas.length - mesasOcupadas)}/{localMesas.length} mesas libres
                </Badge>
                <Badge
                  variant="outline"
                  className="h-7 gap-1 whitespace-nowrap px-2 text-xs tabular-nums"
                  title="Comensales del turno"
                >
                  <Users className="h-3 w-3" />
                  {resumen.comensales} comensales
                </Badge>
                {resumen.cerrado && (
                  <Badge className="h-7 gap-1 whitespace-nowrap bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-600">
                    <CheckCircle2 className="h-3 w-3" />
                    Servicio cerrado
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {filtroTurno === "dia" && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="aviso-todo-el-dia">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Estás viendo <strong className="font-medium text-foreground">los dos servicios a la vez</strong>: cada
              mesa dice quién la ocupa y a qué hora. Una mesa vale para varias reservas si no se pisan: cada una la
              ocupa {configOcupacion.estanciaComidaMinutos} min en comida y {configOcupacion.estanciaCenaMinutos} min
              en cena (Configuración → Tiempo de ocupación de mesa).
            </span>
          </p>
        )}

        {/* ── Barra de sentar (solo mientras se elige mesa) ───────────────── */}
        {reservaActiva && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="shrink-0 text-base">
                  Sentando a <strong>{reservaActiva.nombre}</strong>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                  <Clock className="h-3 w-3" />
                  {horaCorta(reservaActiva.hora)}
                  <span className="mx-1">·</span>
                  <Users className="h-3 w-3" />
                  {reservaActiva.numero_comensales} comensales
                </span>
                {mesaIdsActivos.length > 0 ? (
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {mesaIdsActivos.map((id) => (
                      <Badge key={id} variant="secondary" className="h-7 gap-1 whitespace-nowrap px-2 text-xs">
                        {mesasPorId.get(id)?.nombre ?? "Mesa"}
                        <span className="text-muted-foreground tabular-nums">
                          {mesasPorId.get(id)?.capacidad ?? 0}
                        </span>
                      </Badge>
                    ))}
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums">
                      = {plazasActivas} plaza{plazasActivas === 1 ? "" : "s"} para{" "}
                      {reservaActiva.numero_comensales}
                    </span>
                    {ajusteActivo && (
                      <Badge
                        variant="outline"
                        className={cn("h-7 whitespace-nowrap px-2 text-xs", ajusteActivo.tono)}
                      >
                        {ajusteActivo.etiqueta}
                      </Badge>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Toca una mesa del plano. Puedes elegir varias para juntarlas.
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {mesaIdsActivos.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 touch-manipulation"
                    onClick={() => pedirQuitarMesas(reservaActiva)}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Quitar mesas
                  </Button>
                )}
                <Button size="sm" className="h-11 touch-manipulation px-5" onClick={() => setReservaActivaId(null)}>
                  Listo
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Plano + panel ──────────────────────────────────────────────── */}
        {/* Con alto de pantalla y la lista DEBAJO del plano (< lg): la lista ocupa lo que pida hasta el
            40 % del alto (`fit-content`) y el plano, el resto. Desde lg van lado a lado en una fila. */}
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_380px]",
            altoPantalla && "grid-rows-[minmax(0,1fr)_fit-content(40%)] lg:grid-rows-[minmax(0,1fr)]",
          )}
        >
          {/* Plano */}
          <Card className="flex flex-col overflow-hidden">
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <div
                ref={containerRef}
                className={cn(
                  // `touch-none`: ni scroll ni zoom de página encima del plano (los gestos son suyos).
                  "relative w-full flex-1 touch-none select-none overflow-hidden",
                  // Con alto de pantalla el alto lo pone la rejilla; sin él, el suelo de siempre.
                  altoPantalla ? "min-h-0" : "min-h-[340px] md:min-h-[min(56dvh,36rem)]",
                  isSpacePressed && "cursor-grab",
                  isPanning && "cursor-grabbing",
                )}
                style={{
                  backgroundImage: `
                    linear-gradient(to right, hsl(var(--border) / 0.25) 1px, transparent 1px),
                    linear-gradient(to bottom, hsl(var(--border) / 0.25) 1px, transparent 1px)
                  `,
                  backgroundSize: `${PIXELS_PER_METER * scale}px ${PIXELS_PER_METER * scale}px`,
                  backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
                }}
                onWheel={handleWheel}
                onMouseDown={handlePanStart}
                onMouseMove={(e) => {
                  handlePanMove(e);
                  if (!isPanning) handleMouseMove(e);
                }}
                onMouseUp={() => {
                  handlePanEnd();
                  handleMesaDragEnd();
                }}
                onMouseLeave={() => {
                  handlePanEnd();
                  handleMesaDragEnd();
                }}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleMesaDragEnd}
                onTouchCancel={handleMesaDragEnd}
              >
                <div
                  ref={canvasRef}
                  className="absolute"
                  style={{
                    width: contentBounds.width * scale,
                    height: contentBounds.height * scale,
                    left: `calc(50% + ${panOffset.x}px)`,
                    top: `calc(50% + ${panOffset.y}px)`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {elementosPlano.map((elem) => renderElementoPlano(elem, { offsetX, offsetY, scale }))}

                  {mesasVista.filter((m) => (estadoPiezas.get(m.id)?.piezas ?? 1) > 0).map((mesa) => {
                    const ocupantes = ocupantesDeMesa(mesa.id).map((asignacion) => {
                      const grupo = asignacionesPorReserva.get(asignacion.reserva_id) ?? [];
                      const esPrimeraDelGrupo = grupo[0]?.mesa_id === mesa.id;
                      return {
                        asignacion,
                        esPrimeraDelGrupo,
                        mesasDelGrupo: grupo.length,
                        onQuitar: esPrimeraDelGrupo
                          ? () => {
                              const reserva = (reservasDia ?? []).find((r) => r.id === asignacion.reserva_id);
                              if (reserva) pedirQuitarMesas(reserva);
                            }
                          : undefined,
                      };
                    });
                    const elegida = mesaIdsActivos.includes(mesa.id);

                    return (
                      <MesaPlano
                        key={mesa.id}
                        mesa={{
                          ...mesa,
                          pos_x: ((mesa.pos_x || 0) * PIXELS_PER_METER - offsetX) * scale,
                          pos_y: ((mesa.pos_y || 0) * PIXELS_PER_METER - offsetY) * scale,
                          ancho: ((mesa.ancho || 80) / 100) * PIXELS_PER_METER * scale,
                          alto: ((mesa.alto || 80) / 100) * PIXELS_PER_METER * scale,
                        }}
                        mesaOriginal={mesa}
                        ocupantes={ocupantes}
                        motivoOcupada={reservaActiva && !elegida ? motivoMesaOcupada(mesa, reservaActiva) : null}
                        elegida={elegida}
                        noSeOfrece={mesasNoOfrecidas.has(mesa.id)}
                        modoAsignacion={!!reservaActiva}
                        reservaActivaNombre={reservaActiva?.nombre}
                        comensalesActivos={reservaActiva?.numero_comensales ?? null}
                        isSelected={selectedMesa?.id === mesa.id}
                        isDragging={dragState.mesaId === mesa.id}
                        // Recolocar mueve el PLANO BASE: se arrastra la fila original, no la del servicio.
                        onDragStart={(e, m) => handleMesaDragStart(e, localMesas.find((l) => l.id === m.id) ?? m)}
                        onSeleccionar={seleccionarMesa}
                        piezasInfo={(() => {
                          const g = geometriaServicio(mesa, estadoPiezas.get(mesa.id));
                          return g ? { piezas: g.piezas, picos: g.picos, ladoPico: g.ladoPico } : undefined;
                        })()}
                        onAlternar={alternarMesa}
                        scale={scale}
                      />
                    );
                  })}

                  {localMesas.length === 0 && elementosPlano.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <Move className="mx-auto mb-2 h-12 w-12 opacity-50" />
                        <p>No hay configuración de plano</p>
                        <p className="text-sm">Configura el plano desde la sección Espacios</p>
                      </div>
                    </div>
                  )}

                  {activeReserva && localMesas.length > 0 && (
                    <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg">
                      <span className="flex items-center gap-1.5">
                        <Move className="h-3 w-3" />
                        Suelta sobre una mesa libre
                      </span>
                    </div>
                  )}

                  {reservaActiva && !activeReserva && localMesas.length > 0 && (
                    <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg">
                      <span className="flex items-center gap-1.5">
                        <Utensils className="h-3 w-3" />
                        Toca las mesas de {reservaActiva.nombre}
                      </span>
                    </div>
                  )}
                </div>

                {/* Leyenda: libre / ocupada de un vistazo */}
                <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-3 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border-2 border-slate-300 bg-white" />
                    Libre
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border-2 border-emerald-500 bg-emerald-100" />
                    Ocupada
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-emerald-600" />
                    Juntas
                  </span>
                </div>

                {/* Zoom: botones de 44 px (además del pellizco y la rueda) y «Ajustar»
                    para volver al encuadre. */}
                <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
                  <Button variant="ghost" size="icon" className="h-11 w-11 touch-manipulation" onClick={handleZoomOut} aria-label="Alejar">
                    <ZoomOut className="h-5 w-5" />
                  </Button>
                  <span className="min-w-[48px] text-center text-sm font-medium tabular-nums">
                    {Math.round(scale * 100)}%
                  </span>
                  <Button variant="ghost" size="icon" className="h-11 w-11 touch-manipulation" onClick={handleZoomIn} aria-label="Acercar">
                    <ZoomIn className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-11 touch-manipulation gap-1.5 px-3"
                    onClick={handleCenterView}
                    aria-label="Centrar plano"
                  >
                    <Maximize2 className="h-5 w-5" />
                    <span className="text-sm">Ajustar</span>
                  </Button>
                </div>

                <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-0.5 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground tabular-nums">
                  <span>
                    {realWidth}m × {realHeight}m
                  </span>
                  <span className="hidden [@media(pointer:coarse)]:inline">Pellizca para zoom · arrastra para mover</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Panel lateral. Con alto de pantalla la lista de reservas no baja de 14rem (con la ficha
              de una mesa abierta se quedaba en nada) y, si con la ficha no cabe todo, el panel hace
              scroll por dentro en vez de estirar la página. */}
          <div className={cn("flex min-h-0 flex-col gap-3", altoPantalla && "overflow-y-auto overscroll-contain")}>
            {selectedMesa && !reservaActiva && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="min-w-0 truncate text-base">{selectedMesa.nombre}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 touch-manipulation"
                      aria-label="Cerrar detalle de mesa"
                      onClick={() => setSelectedMesa(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Plazas</p>
                      <p className="font-medium tabular-nums">
                        {mesasPorId.get(selectedMesa.id)?.capacidad ?? selectedMesa.capacidad}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Forma</p>
                      <p className="font-medium capitalize">{selectedMesa.forma}</p>
                    </div>
                  </div>

                  {(() => {
                    const mp = mesasPiezas.find((m) => m.id === selectedMesa.id);
                    if (!mp) return null;
                    return (
                      <PanelPiezasMesa
                        mesa={mp}
                        mesas={mesasPiezas}
                        estado={estadoPiezas}
                        reservas={reservasEnMesas}
                        hayServicio={!!turnoServicio}
                        ocupado={guardarAjustes.isPending}
                        onGuardar={async (cambios, mensaje) => {
                          if (await guardarPiezas(cambios, mensaje)) setPropuestaPiezas(null);
                        }}
                        onProponer={setPropuestaPiezas}
                      />
                    );
                  })()}

                  {(() => {
                    const ocupantes = ocupantesDeMesa(selectedMesa.id);
                    if (ocupantes.length === 0) {
                      return (
                        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                          Libre en {etiquetaFiltroTurno(filtroTurno).toLowerCase()}.
                        </p>
                      );
                    }
                    return (
                      <div className="rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-950/40">
                        <p className="text-xs font-medium text-muted-foreground">Ocupada por</p>
                        <ul className="mt-0.5 space-y-1">
                          {ocupantes.map((asignacion) => {
                            const franja = franjaDeHora(asignacion.reservas.hora, configOcupacion);
                            return (
                              <li key={asignacion.reserva_id}>
                                <p className="truncate text-sm font-semibold">{asignacion.reservas.nombre}</p>
                                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {franja ? textoFranja(franja) : horaCorta(asignacion.reservas.hora)}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {asignacion.reservas.numero_comensales}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 w-full touch-manipulation text-destructive hover:bg-destructive/10"
                    onClick={() => setMesaABorrar(selectedMesa)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Borrar mesa
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", altoPantalla && "min-h-56")}>
              <CardHeader className="border-b pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                    <Utensils className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">Reservas de {etiquetaFiltroTurno(filtroTurno).toLowerCase()}</span>
                  </CardTitle>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {reservasTurno.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                {reservasTurno.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="mb-3 rounded-full bg-muted p-3">
                      <Utensils className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Sin reservas en {etiquetaFiltroTurno(filtroTurno).toLowerCase()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Aquí solo salen las reservas que ya tienen esta sala
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="min-h-0 flex-1">
                    <div ref={panelReservasRef} className="space-y-3 p-3">
                      {/* Pendientes de mesa — primero, porque es lo que queda por hacer */}
                      {reservasPendientes.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <CircleDashed className="h-3.5 w-3.5" />
                              Pendientes de mesa
                            </span>
                            <Badge variant="outline" className="h-5 tabular-nums">
                              {reservasPendientes.length}
                            </Badge>
                          </div>
                          <div className="space-y-1.5">
                            {reservasPendientes.map((r) => (
                              <TarjetaReserva
                                key={r.id}
                                reserva={r}
                                mesasAsignadas={[]}
                                plazasAsignadas={0}
                                activa={reservaActivaId === r.id}
                                mostrarTurno={filtroTurno === "dia"}
                                onActivar={activarReserva}
                                onEditar={(reservaAEditar) => editarReserva(reservaAEditar.id)}
                                puedeEditar={puedeEditar}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {reservasConMesa.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Con mesa
                            </span>
                            <Badge
                              variant="outline"
                              className="h-5 border-emerald-300 text-emerald-700 tabular-nums dark:text-emerald-400"
                            >
                              {reservasConMesa.length}
                            </Badge>
                          </div>
                          <div className="space-y-1.5">
                            {reservasConMesa.map((r) => (
                              <TarjetaReserva
                                key={r.id}
                                reserva={r}
                                mesasAsignadas={nombresMesasDe(r.id)}
                                plazasAsignadas={plazasDeMesas(mesaIdsDe(r.id), mesasPorId)}
                                activa={reservaActivaId === r.id}
                                mostrarTurno={filtroTurno === "dia"}
                                onActivar={activarReserva}
                                onQuitarMesas={pedirQuitarMesas}
                                onEditar={(reservaAEditar) => editarReserva(reservaAEditar.id)}
                                puedeEditar={puedeEditar}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}

                <div className="border-t bg-muted/40 px-3 py-2">
                  <p className="text-xs leading-snug text-muted-foreground">
                    <strong className="font-medium text-foreground">Sentar:</strong> toca la reserva y toca la mesa.
                    Para juntar mesas, sigue tocando más mesas.{" "}
                    <strong className="font-medium text-foreground">Sin mesa no es un error:</strong> la reserva sigue
                    en pie y se le puede dar mesa cuando toque.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeReserva && (
            <div className="flex -rotate-1 scale-90 items-center gap-1.5 rounded-lg border-2 border-primary bg-primary px-2 py-1 text-primary-foreground opacity-90 shadow-xl">
              <Users className="h-3 w-3" />
              <span className="max-w-[80px] truncate text-xs font-bold">{activeReserva.nombre}</span>
              <span className="text-xs tabular-nums opacity-80">{activeReserva.numero_comensales}p</span>
            </div>
          )}
        </DragOverlay>

        {/* ── Quitar mesas: confirmación, y sin lenguaje de error ─────────── */}
        <AlertDialog open={!!aQuitarMesas} onOpenChange={(abierto) => !abierto && setAQuitarMesas(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Quitar las mesas de {aQuitarMesas?.reserva.nombre}?</AlertDialogTitle>
              <AlertDialogDescription>
                Se liberan {aQuitarMesas?.mesas || "sus mesas"} y {aQuitarMesas?.reserva.nombre} se queda en{" "}
                {espacioNombre} <strong>pendiente de mesa</strong>. La reserva sigue en pie: eso es normal y podrás
                darle mesa más tarde.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmarQuitarMesas}>Quitar las mesas</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Borrar mesa: confirmación ───────────────────────────────────── */}
        <AlertDialog open={!!mesaABorrar} onOpenChange={(abierto) => !abierto && setMesaABorrar(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Borrar la mesa {mesaABorrar?.nombre}?</AlertDialogTitle>
              <AlertDialogDescription>
                Desaparece del plano de {espacioNombre} y deja de sumar plazas. No se puede deshacer. Si solo quieres
                dejar de usarla, desactívala en Configuración › Mesas y aforo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmarBorrarMesa}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Borrar mesa
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Alta rápida de mesa ─────────────────────────────────────────── */}
        <Dialog open={showAddMesa} onOpenChange={setShowAddMesa}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Añadir nueva mesa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="mesa-nombre">Nombre</Label>
                <Input
                  id="mesa-nombre"
                  value={newMesa.nombre}
                  onChange={(e) => setNewMesa({ ...newMesa, nombre: e.target.value })}
                  placeholder="Ej: Mesa 1, Terraza A..."
                  className="h-11 text-base"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="mesa-plazas">Plazas</Label>
                  <Input
                    id="mesa-plazas"
                    type="number"
                    className="h-11 text-base"
                    value={newMesa.capacidad}
                    onChange={(e) => setNewMesa({ ...newMesa, capacidad: parseInt(e.target.value) || 4 })}
                    min={1}
                    max={20}
                  />
                </div>
                <div>
                  <Label>Forma</Label>
                  <Select value={newMesa.forma} onValueChange={(v) => setNewMesa({ ...newMesa, forma: v })}>
                    <SelectTrigger aria-label="Forma de la mesa" className="h-11 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rectangular">Rectangular</SelectItem>
                      <SelectItem value="circular">Circular</SelectItem>
                      <SelectItem value="cuadrada">Cuadrada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="mesa-ancho">Ancho (cm)</Label>
                  <Input
                    id="mesa-ancho"
                    type="number"
                    className="h-11 text-base"
                    value={newMesa.ancho}
                    onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 80 })}
                    min={50}
                    max={300}
                  />
                </div>
                <div>
                  <Label htmlFor="mesa-alto">Alto (cm)</Label>
                  <Input
                    id="mesa-alto"
                    type="number"
                    className="h-11 text-base"
                    value={newMesa.alto}
                    onChange={(e) => setNewMesa({ ...newMesa, alto: parseInt(e.target.value) || 80 })}
                    min={50}
                    max={300}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="h-11 touch-manipulation" onClick={() => setShowAddMesa(false)}>
                  Cancelar
                </Button>
                <Button className="h-11 touch-manipulation" onClick={handleAddMesa} disabled={crearMesa.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear mesa
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Editor de la reserva elegida con el lápiz de su fila ─────────── */}
        {dialogoEdicion}
        <DialogoPropuestaPiezas
          propuesta={propuestaPiezas}
          ocupado={guardarAjustes.isPending || asignarMesas.isPending}
          onCerrar={() => setPropuestaPiezas(null)}
        />
      </div>
    </DndContext>
  );
}

/** "Viernes, 26 de septiembre de 2026" — con mayúscula inicial. */
function fechaLegible(iso: string): string {
  return conMayuscula(
    fechaISOaDate(iso).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  );
}

/** "Vie, 26 sept 2026" — para el botón de la barra, donde el espacio es oro. */
function fechaCorta(iso: string): string {
  return conMayuscula(
    fechaISOaDate(iso).toLocaleDateString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  );
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
