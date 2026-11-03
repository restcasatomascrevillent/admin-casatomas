// ============================================================================
// TARJETA DE UNA RESERVA DEL SERVICIO — la del kanban de «Hoy» y la del plano de «Hoy»
// ----------------------------------------------------------------------------
// Sacada de `GestorReservasKanban.tsx` (04/10/2026) para que el aviso de la sala
// privada (`AvisoSalasPrivadas`: Hoy y Dashboard) enseñe a quien está en el
// Reservado con las MISMAS acciones que el kanban (llegada / no vino / deshacer,
// estrella y menú «⋮») sin duplicar nada ni arrastrar dnd-kit al Dashboard.
//
// Qué botones tiene cada tarjeta, y cuáles se pueden pulsar, lo decide
// `accionesDisponibles(reserva, { vista: "hoy", canEdit })`. El nombre y el color de
// cada estado salen de `ESTADOS_RESERVA` (src/lib/reservas/estadosReserva.ts).
//
// TOCAR LA TARJETA = «⋮» (04/10/2026, dueño: «si hago clic en la tarjeta es como los tres
// puntitos; lo único es arrastrar, que es cambiar de espacio»). Un toque/clic en cualquier zona
// neutra abre el MISMO menú que el botón «⋮» (un solo `DropdownMenu` controlado, anclado al «⋮»).
// Mantener pulsado y arrastrar sigue moviendo la tarjeta: un arrastre no abre el menú al soltar
// (dnd-kit ya se traga el clic posterior; además se ignora todo clic en los 400 ms siguientes a
// un arrastre, por si el navegador sintetiza otro). No abren el menú: estrella, «⋮», la fila de
// llegada (`ControlLlegada`), enlaces, y el envoltorio de un control apagado (`ConMotivo`);
// los dos últimos se marcan con `data-sin-menu-tarjeta`. Un clic dentro del menú ya abierto
// (React lo propaga por el portal) tampoco cuenta: se mira el DOM, no el árbol de React.
//
// TECLADO: la tarjeta arrastrable es el activador del `KeyboardSensor` de dnd-kit, que usa
// Intro/Espacio para empezar a arrastrar; esas teclas NO abren el menú (se prioriza el arrastre
// con teclado). El menú se abre con el «⋮» (Tab hasta él). La tarjeta que no se arrastra (sin
// permiso, estado que no se mueve, desplegable del Reservado) sí abre el menú con Intro/Espacio.
// ============================================================================
import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Clock, Users, Star, GripVertical, Phone, MoveRight, MoreVertical, Loader2, ShieldBan, SquarePen, CircleDashed, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { etiquetaMesasReserva } from "@/components/espacios/nombresMesa";
import type { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { accionesDisponibles, motivoSiNoSePuede } from "@/lib/reservas/accionesReserva";
import { etiquetaEstadoReserva, infoEstadoReserva, ocupaEspacio } from "@/lib/reservas/estadosReserva";
import { columnaDeReserva, type Columna } from "@/lib/reservas/columnasServicio";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";
import { ConMotivo } from "./ConMotivo";
import { ControlLlegada } from "./ControlLlegada";
import { accionesSoloIcono } from "./kanbanLayout";

type Acciones = ReturnType<typeof useAccionesServicioReserva>;

/** Controles propios de la tarjeta: un toque sobre ellos hace lo suyo y no abre el menú de la tarjeta. */
const CONTROLES_PROPIOS = "button, a, input, select, textarea, [data-sin-menu-tarjeta]";
/** Tras un arrastre no se abre el menú: el clic que algunos navegadores sintetizan al soltar. */
const MS_SIN_MENU_TRAS_ARRASTRE = 400;

// Draggable reservation card
export function ReservaCard({
  reserva,
  columnas,
  acciones,
  onMover,
  onToggleImportante,
  onBlacklist,
  onEditar,
  onDarMesa,
  sinMesa,
  mesas,
  puedeEditar,
  isDragOverlay,
  sinArrastre,
  telefonoEnlace,
  compacta = false,
  textoDarMesa = "Dar mesa",
  textoCambiarMesa,
  accionesExtra,
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
  /** Abre el plano de su sala para darle mesa (`ElegirMesaDialog`). Solo se usa si `sinMesa`. */
  onDarMesa?: (reserva: ReservaServicio) => void;
  /**
   * Tiene sala pero ninguna mesa asignada (04/10/2026: sustituye a la franja «Pendientes de mesa»
   * de Hoy). Pinta una insignia «Sin mesa» y añade «Dar mesa» al menú «⋮». Pendiente no es error:
   * tono neutro.
   */
  sinMesa?: boolean;
  /**
   * Nombres de las mesas asignadas ese día (`mesas.nombre`, que ES el número de la sala: "7",
   * "7+8"). Con alguna, la insignia «Mesa 7» / «Mesas 7, 9» ocupa el sitio de «Sin mesa».
   */
  mesas?: readonly string[];
  /**
   * Permiso de edición sobre «reservas». Obligatorio a propósito (un valor por
   * defecto dejaría pasar a todo el mundo si alguien se olvida de pasarlo): sin él,
   * todo lo que escribe en la reserva sale deshabilitado, con el motivo visible.
   */
  puedeEditar: boolean;
  isDragOverlay?: boolean;
  /**
   * La tarjeta se pinta fuera del kanban (el desplegable de la sala privada): no es arrastrable
   * ni tiene asa. `useDraggable` se llama igual (los hooks no pueden ser condicionales) pero
   * deshabilitado, y sin `DndContext` alrededor no hace nada.
   */
  sinArrastre?: boolean;
  /** El teléfono de la tarjeta es un enlace `tel:` (el desplegable de la sala privada). */
  telefonoEnlace?: boolean;
  /**
   * Versión de fila y media (panel del Plano de Hoy, 10/10/2026): punto de color del estado,
   * nombre, hora · personas · mesa · teléfono (tocable) y, si hay nota, su icono; a la derecha
   * «Ha llegado» en icono y «⋮» (zona táctil de 44 px). Tocar la fila abre el menú.
   */
  compacta?: boolean;
  /** Texto del «Dar mesa» del menú (en el Plano de Hoy: «Elegir mesa en el plano»). */
  textoDarMesa?: string;
  /** Con mesa: ofrecer también «Cambiar mesa» (usa `onDarMesa`). */
  textoCambiarMesa?: string;
  /** Acciones de más al principio del menú (p. ej. «Liberar mesa» en el Plano de Hoy). */
  accionesExtra?: ReadonlyArray<{ texto: string; onSelect: () => void }>;
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
  const arrastrable = acc.mover.habilitada && !sinArrastre;
  // Una reserva que por su estado no ocupa sitio («No vino») se ve apagada; sin
  // permiso, en cambio, se ve normal: lo único que cambia es que no se mueve.
  const ocupaSitio = ocupaEspacio(reserva.estado);
  const soloIcono = accionesSoloIcono(anchoColumna);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reserva.id,
    data: reserva,
    disabled: !arrastrable || isDragOverlay,
  });
  // Menú de acciones, controlado: lo abren el «⋮» y el toque en la tarjeta.
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Cuándo terminó el último arrastre (el cleanup corre al dejar de arrastrar): ver `alTocarTarjeta`.
  const finDeArrastre = useRef(0);
  useEffect(() => {
    if (!isDragging) return;
    return () => {
      finDeArrastre.current = Date.now();
    };
  }, [isDragging]);

  if (isDragOverlay) {
    return (
      <div
        className="p-2.5 sm:p-3 rounded-lg border-2 border-primary bg-card w-[200px] sm:w-[230px] shadow-2xl rotate-1 scale-[1.03] cursor-grabbing pointer-events-none"
      >
        <ContenidoTarjeta reserva={reserva} sinMesa={sinMesa} mesas={mesas} />
      </div>
    );
  }

  const columnaActual = columnaDeReserva(reserva, columnas);
  const destinos = columnas.filter((c) => c.id !== columnaActual);
  const textoMesas = etiquetaMesasReserva(mesas);

  /** Un toque en una zona neutra de la tarjeta = pulsar «⋮». */
  const alTocarTarjeta = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || isDragging) return;
    if (Date.now() - finDeArrastre.current < MS_SIN_MENU_TRAS_ARRASTRE) return;
    const destino = e.target as Element;
    // El menú vive en un portal: React propaga hasta aquí los clics de dentro de él, pero no son de la tarjeta.
    if (!e.currentTarget.contains(destino)) return;
    const control = destino.closest?.(CONTROLES_PROPIOS);
    if (control && control !== e.currentTarget && e.currentTarget.contains(control)) return;
    setMenuAbierto(true);
  };

  /** Solo la tarjeta que NO se arrastra (si no, Intro/Espacio son del `KeyboardSensor`). */
  const alTeclearEnTarjeta = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    setMenuAbierto(true);
  };

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
      <DropdownMenu open={menuAbierto} onOpenChange={setMenuAbierto}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6 text-muted-foreground", compacta && "touch-hit h-8 w-8")}
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
                  <span className="ml-auto text-[10px] pointer-coarse:text-xs text-muted-foreground tabular-nums">{c.capacidadMax} pax</span>
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            // El motivo, a la vista en el propio menú: «No se puede mover en este
            // estado» o «No tienes permiso para editar reservas».
            <DropdownMenuItem disabled>{acc.mover.titulo}</DropdownMenuItem>
          )}
          {/* «Dar mesa» (04/10/2026): abre el plano de SU sala con la reserva señalada, el mismo
              diálogo que sale tras moverla. Como «Dar mesa» de la Lista, no mira el permiso: el
              plano ya lo comprueba al guardar. */}
          {onDarMesa && (sinMesa || textoCambiarMesa) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onDarMesa(reserva)}>
                <CircleDashed className="h-3.5 w-3.5 mr-2" />
                {sinMesa ? textoDarMesa : textoCambiarMesa}
              </DropdownMenuItem>
            </>
          )}
          {accionesExtra?.map((a) => (
            <DropdownMenuItem key={a.texto} onSelect={a.onSelect}>
              {a.texto}
            </DropdownMenuItem>
          ))}
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

  const estadoInfo = infoEstadoReserva(reserva.estado);
  const nota = reserva.notas_cliente?.trim();

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-card transition-shadow duration-200 group outline-none select-none touch-manipulation [-webkit-touch-callout:none]",
        compacta ? "px-2 py-1" : soloIcono ? "p-2" : "p-2.5 sm:p-3",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        arrastrable
          ? "cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/30"
          : ocupaSitio
            ? "cursor-pointer hover:shadow-md hover:border-primary/30"
            : "cursor-pointer opacity-60",
        isDragging && "opacity-30 border-dashed border-primary/40",
        reserva.importante && "border-amber-400 bg-amber-50/30 dark:bg-amber-950/20",
        (reserva as { en_blacklist?: boolean }).en_blacklist && "border-destructive/40 bg-destructive/5",
      )}
      aria-roledescription={arrastrable ? "reserva arrastrable" : "reserva"}
      aria-label={`${reserva.nombre || "Sin nombre"}, ${reserva.hora?.substring(0, 5)}, ${reserva.numero_comensales} comensales, ${etiquetaEstadoReserva(reserva.estado)}${textoMesas ? `, ${textoMesas}` : ""}`}
      onClick={alTocarTarjeta}
      onKeyDown={arrastrable ? undefined : alTeclearEnTarjeta}
      {...(arrastrable ? listeners : {})}
      {...attributes}
      aria-haspopup="menu"
      aria-expanded={menuAbierto}
      // dnd-kit pone `aria-disabled` en la tarjeta que no se arrastra; ahora esa tarjeta se puede tocar
      // (abre el menú), así que se quita y el estado de arrastre pasa a `data-arrastrable`.
      aria-disabled={arrastrable ? attributes["aria-disabled"] : undefined}
      data-arrastrable={arrastrable ? "true" : "false"}
    >
      {compacta ? (
        <div className="flex min-h-11 items-center gap-2">
          <span
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", estadoInfo ? estadoInfo.insignia : "bg-gray-500")}
            title={estadoInfo?.etiqueta ?? reserva.estado}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="flex items-center gap-1 text-sm font-semibold">
              {reserva.importante && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Importante" />}
              <span className="truncate" title={reserva.nombre || "Sin nombre"}>{reserva.nombre || "Sin nombre"}</span>
              {nota && (
                <span title={nota} className="shrink-0" data-testid="nota-cliente">
                  <MessageSquareText className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                  <span className="sr-only">Nota del cliente: {nota}</span>
                </span>
              )}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground tabular-nums">
              <span>{typeof reserva.hora === "string" ? reserva.hora.substring(0, 5) : reserva.hora}</span>
              <span>· {reserva.numero_comensales} p.</span>
              <span aria-hidden="true">·</span>
              <span className={cn(!textoMesas && sinMesa && "text-amber-700 dark:text-amber-400")}>
                {textoMesas || (sinMesa ? "Sin mesa" : "—")}
              </span>
              {reserva.telefono && (
                <a
                  href={`tel:${reserva.telefono}`}
                  className="touch-hit underline-offset-2 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  · {reserva.telefono}
                </a>
              )}
            </p>
          </div>
          <ControlLlegada reserva={reserva} acciones={acciones} canEdit={puedeEditar} compacto soloIcono />
          {menuAcciones}
        </div>
      ) : (
      <>
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
      <ContenidoTarjeta reserva={reserva} sinCabecera sinMesa={sinMesa} mesas={mesas} telefonoEnlace={telefonoEnlace} />
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
      </>
      )}
    </div>
  );
}

export function ContenidoTarjeta({
  reserva,
  sinCabecera,
  sinMesa,
  mesas,
  telefonoEnlace,
}: {
  reserva: ReservaServicio;
  sinCabecera?: boolean;
  /** Tiene sala y ninguna mesa: insignia neutra «Sin mesa» junto al estado (con mesa, sale «Mesa N»). */
  sinMesa?: boolean;
  /** Nombres de las mesas asignadas: insignia «Mesa 7» / «Mesas 7, 9» en el sitio de «Sin mesa». */
  mesas?: readonly string[];
  /** El teléfono es un enlace `tel:` (con área táctil de 44 px con dedo). */
  telefonoEnlace?: boolean;
}) {
  // Nombre y color del estado, del mapa único. Un estado que no existe (el CHECK no
  // lo permite) se pinta tal cual y en gris, como hacía este kanban.
  const estado = infoEstadoReserva(reserva.estado);
  const textoMesas = etiquetaMesasReserva(mesas);
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
        <Badge className={cn("text-[10px] pointer-coarse:text-xs px-1.5 py-0 h-4 pointer-coarse:h-5 pointer-coarse:text-xs", estado ? estado.insignia : "bg-gray-500 text-white")}>
          {estado ? estado.etiqueta : reserva.estado}
        </Badge>
        {textoMesas ? (
          <Badge
            variant="outline"
            className="gap-0.5 text-[11px] pointer-coarse:text-xs px-1.5 py-0 h-5 font-semibold tabular-nums text-foreground border-primary/40 pointer-coarse:h-6 pointer-coarse:text-xs"
            title={mesas && mesas.length > 1 ? "Mesas asignadas a esta reserva" : "Mesa asignada a esta reserva"}
          >
            {textoMesas}
          </Badge>
        ) : sinMesa && (
          <Badge
            variant="outline"
            className="gap-0.5 text-[10px] pointer-coarse:text-xs px-1.5 py-0 h-4 font-normal text-muted-foreground pointer-coarse:h-5 pointer-coarse:text-xs"
            title="Tiene sala pero todavía no tiene mesa: «⋮» → «Dar mesa»"
          >
            <CircleDashed className="h-2.5 w-2.5" aria-hidden="true" />
            Sin mesa
          </Badge>
        )}
      </div>
      {/* Nota del cliente (alergias, trona, celebración…): antes no salía en ninguna parte de Hoy. */}
      {reserva.notas_cliente?.trim() && (
        <p
          data-testid="nota-cliente"
          className="mt-1.5 flex items-start gap-1 rounded-md bg-amber-50 px-1.5 py-1 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
          title={reserva.notas_cliente.trim()}
        >
          <MessageSquareText className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2 break-words">
            <span className="sr-only">Nota del cliente: </span>
            {reserva.notas_cliente.trim()}
          </span>
        </p>
      )}
      {reserva.telefono &&
        (telefonoEnlace ? (
          <a
            href={`tel:${reserva.telefono}`}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline pointer-coarse:min-h-11"
          >
            <Phone className="h-3 w-3" aria-hidden="true" />
            {reserva.telefono}
          </a>
        ) : (
          <div className="flex items-center gap-1 text-[10px] pointer-coarse:text-xs text-muted-foreground/70 mt-1.5 pointer-coarse:text-xs">
            <Phone className="h-2.5 w-2.5" aria-hidden="true" />
            {reserva.telefono}
          </div>
        ))}
    </>
  );
}
