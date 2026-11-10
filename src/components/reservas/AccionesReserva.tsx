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
// LOS BOTONES A LA VISTA (10/11/2026, peticiones del dueño: «hay que limpiarlo
// de botones para que quede claro lo que se tiene que hacer» y después «no
// pongas el Más, que se vean los botones»)
// ----------------------------------------------------------------------------
//   principal (verde) · dar mesa · editar  |  cancelar · lista negra (rojo)
// Solo los que se pueden usar en esa fila (nada deshabilitado ni hueco), con
// texto, 48 px y `flex-wrap`. En la Lista van debajo del nombre y el teléfono.
// Las filas de SOLICITUD del bot usan el mismo molde (`RanurasDeAcciones`).
//
//   · principal   «Verificar» si está pendiente (abre el diálogo con el día) y
//                 «Confirmar» si está verificada; en el resto no hay.
//   · dar mesa    lo decide `resolverSaltoAsignacion` (compartido con Hoy), no
//                 `accionesDisponibles`.
//   · editar      el lápiz. Su texto empieza por «Gestionar» porque «Dar mesa» sin
//                 sala manda ahí para asignarla.
// Fuera de la celda de acciones, y también desde aquí: la estrella
// (`EstrellaImportante`, en la columna Cliente) y la casilla de aceptar en bloque
// de la tarjeta de móvil (`CasillaAceptarEnBloque`, junto al nombre).
//
// EL PERMISO: sin `canEdit` no se pinta NINGUNA ranura (06/11/2026, decisión del
// dueño para quien solo tiene «Ver»: lo que no puede usar se OCULTA, no se
// desactiva, y la página enseña «Solo lectura»). La Lista quita entonces la
// columna de acciones entera. Tampoco «Dar mesa»: lleva a repartir mesas. La
// estrella de una reserva importante se sigue viendo, como dato, sin botón.
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

/** Los botones de acción: 48 px de alto, texto a 16 px (10/11/2026, petición del dueño). */
const BOTON = "h-12 shrink-0 gap-2 px-4 text-base [&_svg]:size-5";

/**
 * Hueco de ancho fijo para la casilla de «aceptar en bloque» (primera columna de la tabla y su cabecera, con
 * «seleccionar todas»).
 */
export function RanuraSeleccion({ children }: { children?: ReactNode }) {
  return <span className="inline-flex w-6 shrink-0 items-center justify-center">{children}</span>;
}

/** Un botón de la fila: solo los que se pueden usar en esa fila. */
interface BotonAccion {
  clave: string;
  texto: string;
  titulo: string;
  icono: ReactNode;
  onClick?: () => void;
  destructiva?: boolean;
  cargando?: boolean;
}

/**
 * El MOLDE de las acciones de una fila, el mismo para reservas y solicitudes.
 *
 * 10/11/2026, petición del dueño: «no pongas el Más, que se vean los botones». Todas las acciones que se pueden
 * usar en esa fila van a la vista, con texto y en este orden: la principal en verde («Verificar», «Confirmar»,
 * «Convertir»), «Dar mesa», «Editar» / «Gestionar» y, al final y separadas, en rojo contorneado, «Cancelar» y
 * «Lista negra» (cada una con la confirmación que ya tenía). Lo que no aplica NO sale (nada deshabilitado). Si no
 * caben en una línea, pasan a la siguiente (`flex-wrap`) antes que esconderse.
 */
export function RanurasDeAcciones({
  principal,
  darMesa,
  verificar,
  gestionar,
  cancelar,
  listaNegra,
  className,
}: {
  principal: RanuraAccion & { etiqueta: string; icono: ReactNode };
  /** Salto al plano de SU sala, en SU día, con la reserva señalada. */
  darMesa: RanuraAccion;
  verificar: RanuraAccion;
  /** En una SOLICITUD es «Gestionar» (engranaje); en una RESERVA es el editor (lápiz, vía `icono`). */
  gestionar: RanuraAccion & { icono?: ReactNode; etiqueta?: string };
  cancelar: RanuraAccion;
  listaNegra: RanuraAccion;
  className?: string;
}) {
  const todas: BotonAccion[] = [
    { clave: "darMesa", texto: "Dar mesa", titulo: darMesa.titulo, icono: <Armchair />, onClick: darMesa.onClick },
    { clave: "verificar", texto: "Verificar", titulo: verificar.titulo, icono: <ClipboardCheck />, onClick: verificar.onClick },
    {
      clave: "gestionar",
      texto: gestionar.etiqueta ?? "Gestionar",
      titulo: gestionar.titulo,
      icono: gestionar.icono ?? <Settings2 />,
      onClick: gestionar.onClick,
    },
    {
      clave: "cancelar",
      texto: cancelar.cargando ? "Cancelando…" : "Cancelar",
      titulo: cancelar.titulo,
      icono: cancelar.cargando ? <Loader2 className="animate-spin" /> : <XCircle />,
      onClick: cancelar.onClick,
      destructiva: true,
      cargando: cancelar.cargando,
    },
    { clave: "listaNegra", texto: "Lista negra", titulo: listaNegra.titulo, icono: <ShieldBan />, onClick: listaNegra.onClick, destructiva: true },
  ];
  const visibles = todas.filter((o) => o.onClick || o.cargando);
  const normales = visibles.filter((o) => !o.destructiva);
  const destructivas = visibles.filter((o) => o.destructiva);
  const hayPrincipal = !!principal.onClick || !!principal.cargando;
  if (!hayPrincipal && !visibles.length) return null;

  const boton = (o: BotonAccion) => (
    <Button
      key={o.clave}
      type="button"
      variant="outline"
      title={o.titulo}
      disabled={!o.onClick}
      onClick={o.onClick}
      className={cn(
        BOTON,
        o.destructiva && "border-2 border-destructive/60 text-destructive hover:bg-destructive hover:text-destructive-foreground",
      )}
    >
      {o.icono}
      {o.texto}
    </Button>
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)} data-testid="acciones-fila">
      {hayPrincipal && (
        <Button
          type="button"
          title={principal.titulo}
          disabled={!principal.onClick}
          onClick={principal.onClick}
          className={cn(BOTON, "bg-emerald-600 font-semibold text-white hover:bg-emerald-700")}
          data-principal=""
        >
          {principal.cargando ? <Loader2 className="animate-spin" /> : principal.icono}
          {principal.etiqueta}
        </Button>
      )}
      {normales.map(boton)}
      {destructivas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-l-2 border-border pl-3" data-testid="acciones-destructivas">
          {destructivas.map(boton)}
        </div>
      )}
    </div>
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
 * al nombre en la tarjeta de móvil (`tarjeta`). Si se puede pulsar sale de
 * `accionesDisponibles`. Sin permiso no hay botón (06/11/2026): si la reserva es
 * importante, la estrella se ve como dato; si no, queda el hueco (la fila no baila).
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
  const marcada = !!reserva.importante;
  if (!importante.visible) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center", variante === "fila" ? "w-4" : "touch-target")}>
        {marcada && <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-label="Importante" />}
      </span>
    );
  }
  const habilitada = importante.habilitada && !!onClick;
  return (
    <ConMotivo className="shrink-0" motivo={habilitada ? undefined : importante.titulo}>
      <button
        type="button"
        onClick={onClick}
        disabled={!habilitada}
        aria-label={importante.titulo}
        className={cn(
          // Con dedo: 44x44 de verdad en la tarjeta (va suelta en su cabecera) y área ampliada
          // en la tabla (no se puede ensanchar la fila por una estrella).
          "shrink-0 disabled:pointer-events-none disabled:opacity-50",
          variante === "fila" ? "touch-hit transition-transform hover:scale-110" : "touch-target inline-flex items-center justify-center",
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
  const textoAceptar = pendiente;

  // «Dar mesa»: ni la decisión ni el texto se escriben aquí, los pone el módulo
  // compartido con la pestaña Hoy. Si esta pantalla no trae a dónde saltar, el
  // botón no promete un plano que no existe (eso no es un motivo de la reserva).
  const { destino, titulo: tituloDarMesa } = resolverSaltoAsignacion(reserva, { nombreSala });

  // Solo «Ver» (06/11/2026): ninguna ranura. La Lista ya no pinta ni la columna.
  if (!canEdit) return null;

  const ranuras = (
    <RanurasDeAcciones
      className={variante === "tarjeta" ? "pt-2" : "mt-3"}
      principal={{
        // «Verificar» (10/11/2026, dueño: «lo que hace es verificarla»; antes decía «Aceptar»).
        etiqueta: textoAceptar ? "Verificar" : "Confirmar",
        icono: textoAceptar ? <CheckCircle /> : <CheckCheck />,
        titulo: principal.titulo,
        onClick: principal.habilitada && !principalOcupada ? (pendiente ? al.aceptar : al.confirmar) : undefined,
        cargando: principal.habilitada && principalOcupada,
      }}
      darMesa={{
        titulo: onAsignarMesa ? tituloDarMesa : TITULO_DAR_MESA_SIN_PLANO,
        onClick: destino && onAsignarMesa ? () => onAsignarMesa(destino) : undefined,
      }}
      // Una sola «Verificar» (10/11/2026): la principal abre el diálogo con el día y, desde ahí, «Verificar con
      // otra hora» lleva a elegir la hora. No se repite.
      verificar={{ titulo: acc.verificar.titulo }}
      gestionar={{ ...ranura(acc.editar, al.editar), icono: <SquarePen />, etiqueta: "Editar" }}
      cancelar={{ ...ranura(acc.cancelar, ocupada ? undefined : al.cancelar), cargando: ocupada }}
      listaNegra={ranura(acc.listaNegra, al.listaNegra)}
    />
  );

  return ranuras;
}
