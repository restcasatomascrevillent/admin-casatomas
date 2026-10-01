// ============================================================================
// ACCIONES DE UNA RESERVA EN LA LISTA — los botones de cada fila de la tabla y
// de cada tarjeta de móvil, pintados a partir de
// `accionesDisponibles(reserva, { vista: "lista", canEdit })`.
// ----------------------------------------------------------------------------
// Hasta el paso 3 cada ranura de la Lista (ListaReservasAvanzada) decidía con sus
// propios `if (estado === …)` si se podía pulsar y qué decía
// (`accionPrincipalReserva`, `ESTADO_RESERVA_TEXTO`, el `onClick` de cada ranura).
// Aquí NO se decide nada: QUÉ hay, QUÉ se puede pulsar y con QUÉ texto lo dice
// `accionesDisponibles` (src/lib/reservas/accionesReserva.ts), y este fichero solo
// lo PINTA. Lo que pasa al pulsar lo pone quien lo monta (`al`); la Lista lo manda
// al ejecutor único (`useAccionesServicioReserva`).
//
// Es la vista de GESTIÓN. La de SERVICIO (Hoy: «Ha llegado», «No vino», «Deshacer»,
// «Mover») tiene sus propios botones (kanban + `ControlLlegada`): las dos leen la
// misma fuente de verdad pero NO comparten botonera (decisión del dueño).
//
// LAS RANURAS: siempre las mismas, en el mismo orden y en la misma X
// ----------------------------------------------------------------------------
//   [casilla] · principal · dar mesa · verificar · editar · cancelar · lista negra
// Lo que no aplica a una fila sale DESHABILITADO y nunca se quita (2026-09-26,
// petición del dueño: los botones no bailan de sitio al bajar por la lista), con
// el motivo a la vista al pasar el ratón (`ConMotivo`: un botón deshabilitado no
// recibe el ratón). Las filas de SOLICITUD del bot usan el mismo molde
// (`RanurasDeAcciones`) con sus propias ranuras, así que caen en la misma X.
//
//   · principal   «Aceptar» si está pendiente y «Confirmar» en el resto (sin
//                 permiso dice «Aceptar» en todas las filas, como siempre).
//   · dar mesa    lo decide `resolverSaltoAsignacion` (compartido con Hoy), no
//                 `accionesDisponibles`.
//   · editar      el lápiz. Su texto empieza por «Gestionar» porque «Dar mesa» sin
//                 sala manda ahí para asignarla.
// Fuera de la celda de acciones, y también desde aquí: la estrella
// (`EstrellaImportante`, en la columna Cliente) y la casilla de aceptar en bloque
// de la tarjeta de móvil (`CasillaAceptarEnBloque`, junto al nombre).
//
// EL PERMISO: sin `canEdit` todo lo que escribe sale deshabilitado con el motivo
// («No tienes permiso para editar reservas»). Desde el paso 3 también «Verificar»,
// la estrella y la lista negra, que antes no lo miraban (decisión del dueño,
// 2026-10-01, junto con endurecer la RLS de `reservas`). «Dar mesa» no escribe
// nada (solo abre el plano) y sigue sin mirarlo.
// ============================================================================

import type { ReactNode } from "react";
import {
  Armchair,
  CheckCheck,
  CheckCircle,
  ClipboardCheck,
  Loader2,
  Settings2,
  ShieldBan,
  SquarePen,
  Star,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { accionesDisponibles, type AccionReserva, type EstadoAccion } from "@/lib/reservas/accionesReserva";
import { resolverSaltoAsignacion, type DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { ConMotivo } from "./ConMotivo";

/** Una ranura de acción: su texto (`title` y `aria-label`) y qué hace. Sin `onClick`, deshabilitada. */
export interface RanuraAccion {
  titulo: string;
  onClick?: () => void;
  /** Hay una petición en curso: el icono gira (y la ranura llega sin `onClick`). */
  cargando?: boolean;
}

/** Lo que hace falta de una reserva para pintar sus acciones en la Lista. */
export interface ReservaDeLaLista {
  id: string;
  estado: string;
  nombre?: string | null;
  importante?: boolean | null;
  /** Para «Dar mesa»: su día, su hora (de ahí sale el turno) y su sala. */
  fecha?: string | null;
  hora?: string | null;
  espacio_id?: string | null;
}

/** Qué hace cada botón al pulsarlo. El que no esté sale deshabilitado. */
export type AlPulsar = Partial<Record<AccionReserva, () => void>>;

/** Texto de «Dar mesa» cuando la pantalla que monta la lista no lleva a ningún plano de sala. */
export const TITULO_DAR_MESA_SIN_PLANO = "Dar mesa: esta pantalla no lleva al plano de sala";

/**
 * Acción secundaria de una fila: solo icono, con tooltip y `aria-label`. Las
 * destructivas (Cancelar, lista negra) van en rojo y se rellenan al pasar por
 * encima, para que no se confundan con las normales.
 *
 * SIEMPRE se pinta, aplique o no a esa fila: cuando no aplica va `disabled`,
 * nunca se quita. Así la columna mide lo mismo en todas las filas. El motivo va
 * también en el envoltorio (`ConMotivo`) porque un botón deshabilitado no recibe
 * eventos de ratón y no llegaría a enseñar su `title`.
 */
function AccionIcono({
  etiqueta,
  onClick,
  destructiva = false,
  children,
}: {
  etiqueta: string;
  onClick?: () => void;
  destructiva?: boolean;
  children: ReactNode;
}) {
  const deshabilitada = !onClick;
  return (
    <ConMotivo className="shrink-0" motivo={deshabilitada ? etiqueta : undefined}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        // `title` nativo en vez de <Tooltip> de Radix a propósito: con 375+
        // filas había ~750 tooltips montados y repintar la lista entera (p. ej.
        // al vaciar el buscador) costaba ~590 ms. Con `title` baja a ~250 ms sin
        // perder la pista de qué hace cada icono. `aria-label` mantiene el
        // nombre accesible para lectores de pantalla.
        title={etiqueta}
        aria-label={etiqueta}
        disabled={deshabilitada}
        onClick={onClick}
        className={cn(
          // 24 px de 1024 a 1279 px, 28 px a partir de ahí: con las seis
          // ranuras (5 iconos + 6 huecos) son ~32 px los que se ahorran aquí
          // en `lg`, y se los queda la columna Cliente, que es la que peor lo
          // pasa en pantalla estrecha.
          "h-6 w-6 shrink-0 [&_svg]:size-3.5 xl:h-7 xl:w-7",
          destructiva && "border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground",
        )}
      >
        {children}
      </Button>
    </ConMotivo>
  );
}

// Ancho FIJO de la acción principal. Es la única con texto y las etiquetas
// miden distinto ("Aceptar", "Confirmar", "Convertir"), así que sin fijarlo
// los iconos de al lado caerían en una X distinta según la fila. Si algún día
// apareciera scroll horizontal a 1024 px, esto (o el hueco entre ranuras) es lo
// primero que se aprieta; "Confirmar" es la etiqueta más larga y ya va justa.
const ANCHO_PRINCIPAL = "w-[76px] xl:w-[88px]";

/**
 * Acción PRINCIPAL de la fila: la única con texto, para que se distinga de un
 * vistazo cuál es lo siguiente que hacer con esa fila. Cuando no hay nada que
 * hacer (reserva ya confirmada, solicitud cerrada…) se queda deshabilitada,
 * pero ocupando exactamente el mismo sitio. Sin `aria-label`: su nombre
 * accesible es su texto.
 */
function AccionPrincipal({
  etiqueta,
  titulo,
  onClick,
  cargando,
  children,
}: {
  etiqueta: string;
  titulo: string;
  onClick?: () => void;
  cargando?: boolean;
  children: ReactNode;
}) {
  const deshabilitada = !onClick;
  return (
    <ConMotivo className="shrink-0" motivo={deshabilitada ? titulo : undefined}>
      <Button
        type="button"
        size="sm"
        title={titulo}
        disabled={deshabilitada}
        onClick={onClick}
        className={cn("h-6 shrink-0 justify-center gap-1 px-1 text-[11px] [&_svg]:size-3.5 xl:h-7", ANCHO_PRINCIPAL)}
      >
        {cargando ? <Loader2 className="animate-spin" /> : children}
        {etiqueta}
      </Button>
    </ConMotivo>
  );
}

/**
 * Hueco de ancho fijo para la casilla de selección, dentro de la celda de
 * acciones (y en su cabecera, con la de «seleccionar todas»). Se pinta siempre
 * que haya permiso —vacío cuando la fila no es seleccionable— para que los
 * botones de todas las filas empiecen en la misma X.
 */
export function RanuraSeleccion({ children }: { children?: ReactNode }) {
  return <span className="inline-flex w-4 shrink-0 items-center justify-center">{children}</span>;
}

/**
 * El MOLDE de la celda de acciones, el mismo para reservas y solicitudes: casilla
 * (si hay) · principal · dar mesa · verificar · gestionar/editar · cancelar ·
 * lista negra. Pinta lo que le den; qué va en cada ranura lo decide quien lo usa
 * (`AccionesReserva` para una reserva, la fila de solicitud de la Lista para una
 * solicitud del bot).
 */
export function RanurasDeAcciones({
  seleccion,
  principal,
  darMesa,
  verificar,
  gestionar,
  cancelar,
  listaNegra,
}: {
  /** `undefined` = no hay ranura de selección en toda la lista (sin permiso de edición). */
  seleccion?: ReactNode;
  principal: RanuraAccion & { etiqueta: string; icono: ReactNode };
  /** Salto al plano de SU sala, en SU día, con la reserva señalada. */
  darMesa: RanuraAccion;
  verificar: RanuraAccion;
  /** En una SOLICITUD es «Gestionar» (engranaje); en una RESERVA es el editor (lápiz, vía `icono`). */
  gestionar: RanuraAccion & { icono?: ReactNode };
  cancelar: RanuraAccion;
  listaNegra: RanuraAccion;
}) {
  return (
    <>
      {seleccion !== undefined && <RanuraSeleccion>{seleccion}</RanuraSeleccion>}
      <AccionPrincipal
        etiqueta={principal.etiqueta}
        titulo={principal.titulo}
        onClick={principal.onClick}
        cargando={principal.cargando}
      >
        {principal.icono}
      </AccionPrincipal>
      {/* "Dar mesa" va SIN `destructiva` a propósito: "con sala pero sin mesa" es
          trabajo pendiente normal, no un error, y el rojo diría lo contrario (ver
          el encabezado de `saltoAsignacion.ts`). El sillón es el mismo icono con
          el que el plano dibuja las mesas. */}
      <AccionIcono etiqueta={darMesa.titulo} onClick={darMesa.onClick}>
        <Armchair />
      </AccionIcono>
      <AccionIcono etiqueta={verificar.titulo} onClick={verificar.onClick}>
        <ClipboardCheck />
      </AccionIcono>
      <AccionIcono etiqueta={gestionar.titulo} onClick={gestionar.onClick}>
        {gestionar.icono ?? <Settings2 />}
      </AccionIcono>
      <AccionIcono destructiva etiqueta={cancelar.titulo} onClick={cancelar.onClick}>
        {cancelar.cargando ? <Loader2 className="animate-spin" /> : <XCircle />}
      </AccionIcono>
      <AccionIcono destructiva etiqueta={listaNegra.titulo} onClick={listaNegra.onClick}>
        <ShieldBan />
      </AccionIcono>
    </>
  );
}

/** La ranura de una acción de `accionesDisponibles`: su texto y, si se puede pulsar, qué hace. */
const ranura = (accion: EstadoAccion, onClick?: () => void): RanuraAccion => ({
  titulo: accion.titulo,
  onClick: accion.habilitada ? onClick : undefined,
});

/**
 * La casilla de «aceptar en bloque». Solo existe en las pendientes y con permiso
 * (`accionesDisponibles(…).seleccionar`). En la tabla va en la primera ranura de
 * `AccionesReserva`; en la tarjeta de móvil, junto al nombre.
 */
export function CasillaAceptarEnBloque({
  reserva,
  canEdit,
  marcada,
  onCambiar,
  className,
}: {
  reserva: ReservaDeLaLista;
  canEdit: boolean;
  marcada: boolean;
  onCambiar?: () => void;
  className?: string;
}) {
  const { seleccionar } = accionesDisponibles(reserva, { vista: "lista", canEdit });
  if (!seleccionar.visible) return null;
  return (
    <Checkbox
      checked={marcada}
      onCheckedChange={onCambiar}
      disabled={!seleccionar.habilitada || !onCambiar}
      aria-label={seleccionar.titulo}
      className={className}
    />
  );
}

/**
 * La estrella de «importante»: en la columna Cliente de la tabla (`fila`) y junto
 * al nombre en la tarjeta de móvil (`tarjeta`). Si se puede pulsar y por qué no
 * salen de `accionesDisponibles`: sin permiso, deshabilitada y con el motivo en el
 * envoltorio. Su NOMBRE (lo que hará: «Marcar Ana como importante») no cambia
 * porque falte el permiso, igual que la estrella del kanban.
 */
export function EstrellaImportante({
  reserva,
  canEdit,
  variante,
  onClick,
}: {
  reserva: ReservaDeLaLista;
  canEdit: boolean;
  variante: "fila" | "tarjeta";
  onClick?: () => void;
}) {
  const { importante } = accionesDisponibles(reserva, { vista: "lista", canEdit });
  const nombre = canEdit ? importante.titulo : accionesDisponibles(reserva, { vista: "lista", canEdit: true }).importante.titulo;
  const marcada = !!reserva.importante;
  const habilitada = importante.habilitada && !!onClick;
  return (
    <ConMotivo className="shrink-0" motivo={habilitada ? undefined : importante.titulo}>
      <button
        type="button"
        onClick={onClick}
        disabled={!habilitada}
        aria-label={nombre}
        className={cn(
          "shrink-0 disabled:pointer-events-none disabled:opacity-50",
          variante === "fila" && "transition-transform hover:scale-110",
        )}
      >
        <Star
          className={cn(
            "h-4 w-4",
            marcada
              ? "fill-amber-400 text-amber-400"
              : cn("text-muted-foreground/40", variante === "fila" && "hover:text-amber-400"),
          )}
        />
      </button>
    </ConMotivo>
  );
}

/**
 * Las ranuras de acción de UNA reserva de la Lista.
 *
 * · `fila`: el contenido de la celda de acciones de la tabla (la celda y su
 *   `flex` los pone la Lista), con la ranura de la casilla si hay permiso.
 * · `tarjeta`: la fila de botones de la tarjeta de móvil, mismo juego y mismo
 *   orden que la tabla para no tener que reaprenderlo al cambiar de pantalla. La
 *   casilla no se repite aquí: va arriba, junto al nombre (`CasillaAceptarEnBloque`).
 */
export function AccionesReserva({
  reserva,
  canEdit,
  variante,
  al,
  ocupada = false,
  bloqueEnCurso = false,
  seleccionada = false,
  nombreSala = null,
  onAsignarMesa,
}: {
  reserva: ReservaDeLaLista;
  /** Permiso de edición sobre «reservas» (`useCanAccessSection("reservas", "edit")`). */
  canEdit: boolean;
  variante: "fila" | "tarjeta";
  al: AlPulsar;
  /** Hay una escritura en curso sobre ESTA reserva (`estaEnCurso`): la principal y cancelar giran y no se pulsan. */
  ocupada?: boolean;
  /** Hay un «aceptar en bloque» en curso: la principal también espera. */
  bloqueEnCurso?: boolean;
  /** La casilla de aceptar en bloque está marcada (solo `fila`). */
  seleccionada?: boolean;
  /** Nombre de su sala, para que «Dar mesa» diga a DÓNDE lleva. */
  nombreSala?: string | null;
  /** A dónde salta «Dar mesa». Sin él, el botón sigue en su sitio pero deshabilitado. */
  onAsignarMesa?: (destino: DestinoAsignacion) => void;
}) {
  const acc = accionesDisponibles(reserva, { vista: "lista", canEdit });

  // La principal es UNA: «Aceptar» si está pendiente y «Confirmar» en el resto.
  const pendiente = acc.aceptar.visible;
  const principal = pendiente ? acc.aceptar : acc.confirmar;
  const principalOcupada = ocupada || bloqueEnCurso;
  // Sin permiso, la Lista enseña «Aceptar» en todas las filas (deshabilitado y con el motivo).
  const textoAceptar = pendiente || !canEdit;

  // «Dar mesa»: ni la decisión ni el texto se escriben aquí, los pone el módulo
  // compartido con la pestaña Hoy. Si esta pantalla no trae a dónde saltar, el
  // botón no promete un plano que no existe (eso no es un motivo de la reserva).
  const { destino, titulo: tituloDarMesa } = resolverSaltoAsignacion(reserva, { nombreSala });

  const ranuras = (
    <RanurasDeAcciones
      seleccion={
        variante === "fila" && canEdit ? (
          <CasillaAceptarEnBloque reserva={reserva} canEdit={canEdit} marcada={seleccionada} onCambiar={al.seleccionar} />
        ) : undefined
      }
      principal={{
        etiqueta: textoAceptar ? "Aceptar" : "Confirmar",
        icono: textoAceptar ? <CheckCircle /> : <CheckCheck />,
        titulo: principal.titulo,
        onClick: principal.habilitada && !principalOcupada ? (pendiente ? al.aceptar : al.confirmar) : undefined,
        cargando: principal.habilitada && principalOcupada,
      }}
      darMesa={{
        titulo: onAsignarMesa ? tituloDarMesa : TITULO_DAR_MESA_SIN_PLANO,
        onClick: destino && onAsignarMesa ? () => onAsignarMesa(destino) : undefined,
      }}
      verificar={ranura(acc.verificar, al.verificar)}
      gestionar={{ ...ranura(acc.editar, al.editar), icono: <SquarePen /> }}
      cancelar={{ ...ranura(acc.cancelar, ocupada ? undefined : al.cancelar), cargando: ocupada }}
      listaNegra={ranura(acc.listaNegra, al.listaNegra)}
    />
  );

  return variante === "tarjeta" ? <div className="flex items-center gap-1 pt-1">{ranuras}</div> : ranuras;
}
