import { EtiquetaFuera } from "./SentarFuera";
import { useState, useMemo, useRef, useEffect, type MouseEvent, type ReactNode } from "react";
import { InsigniaMenuCerrado, InsigniaMenuDelDia, InsigniaZona } from "@/components/reservas/InterruptoresServiciosOnline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { toast } from "sonner";
import {
  CheckCheck,
  Search,
  Users,
  Calendar,
  Loader2,
  Phone,
  Globe,
  Pencil,
  Inbox,
  CalendarPlus,
  SlidersHorizontal,
  X,
  Store,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ModalVerificacionReserva } from "./ModalVerificacionReserva";
import { BlacklistModal } from "./BlacklistModal";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import type { ReservaParaVerificar } from "@/hooks/useVerificacionReservas";
// El ejecutor ÚNICO de acciones sobre una reserva (Aceptar, aceptar en bloque, Confirmar, Cancelar y la
// estrella pasan por él).
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
// Los botones de cada reserva: los pinta `AccionesReserva` a partir de `accionesDisponibles` (qué hay,
// qué se puede pulsar y con qué texto); aquí solo se dice qué hace cada uno.
import {
  AccionesReserva,
  CasillaAceptarEnBloque,
  EstrellaImportante,
  RanuraSeleccion,
  RanurasDeAcciones,
  type AlPulsar,
  type RanuraAccion,
} from "./AccionesReserva";
import { infoEstadoReserva } from "@/lib/reservas/estadosReserva";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
// La consulta de la lista (`reservas-lista`) lee el histórico por lotes de 1.000 y puede lanzar
// `ErrorLecturaInconsistente` si los datos cambian mientras se leen (ver el comentario de la `queryFn`).
import { leerReservasLista } from "@/lib/reservas/leerReservasLista";
import { ErrorLecturaInconsistente } from "@/lib/reservas/paginarConsulta";
import type { SolicitudPendiente, useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { SolicitudCard, MOTIVO_LABELS, ESTADO_LABELS } from "./GestionSolicitudes";
import { FormularioReserva, type ReservaCreadaDesdeFormulario } from "./FormularioReserva";
import { SolicitudGestionPanel } from "./SolicitudGestionPanel";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { telefonoEnGrupos } from "@/lib/reservas/telefono";
import { DialogoAccionReserva, type AccionDialogo } from "./DialogoAccionReserva";
import { useListaReservasEnVivo } from "@/hooks/useListaReservasEnVivo";
import { EstadoPropuestaBadge } from "./EstadoPropuestaBadge";
import {
  estadoPropuestaVista,
  fechaHoraCorta,
  type EstadoPropuestaVista,
} from "@/lib/reservas/propuestaCliente";
import { actualizacionPropuesta, type PropuestaSolicitud } from "@/lib/reservas/solicitudPropuesta";
import {
  FILTRO_POR_ATENDER,
  OPCIONES_FILTRO_ESTADO,
  esSolicitudAbierta,
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
  type FiltrosListaUnificada,
} from "@/lib/reservas/vistaUnificada";
// «Cómo avanza una reserva» (2026-10-01): los seis estados, pulsables como filtro, en una fila fina y sin
// cifras (2026-10-06).
import { TimelineEstadosReserva } from "./TimelineEstadosReserva";
import { cifraPorAtender } from "@/lib/reservas/cifrasPorEstado";
// Quién puede saltar al plano de su sala para que le den mesa, y con qué
// texto cuando no puede. Módulo compartido con la pestaña Hoy a propósito: el
// dueño pidió que las dos pantallas digan exactamente lo mismo.
import { resolverSaltoAsignacion, type DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";

// Mismo tipo que consume ModalVerificacionReserva.tsx — fuente única del
// contrato con `reservas` (incluye espacio_id y, si la migración
// 20260920010000 ya está aplicada, hora_solicitada/espacio_solicitado_id
// para la comparación "pedido vs. ofrecido").
type Reservation = ReservaParaVerificar;

// ---------------------------------------------------------------------------
// Densidad de la tabla de escritorio
// ---------------------------------------------------------------------------
// La lista mezcla 375+ reservas con las solicitudes del bot. Antes cada fila
// medía ~90 px (reservas) y hasta ~200 px (solicitudes, con tres insignias
// apiladas que además rompían a varias líneas porque el primitivo `Badge` no
// lleva `whitespace-nowrap`), así que en una pantalla entraban 3 filas. Ahora
// TODA fila mide lo mismo — `ALTO_FILA` — y para conseguirlo:
//   · las celdas usan `CELDA` en vez del `p-4` del primitivo;
//   · ningún texto puede romper: o `whitespace-nowrap`, o `truncate` con el
//     texto completo en un `title`;
//   · el contenido de cada celda ocupa como mucho dos líneas.
//
// ---------------------------------------------------------------------------
// Y, sobre todo: CERO scroll horizontal (2026-09-26 y otra vez 2026-10-06,
// peticiones del dueño)
// ---------------------------------------------------------------------------
// La tabla no lleva `min-w`: su ancho es el del contenedor. Hasta el 2026-10-06
// repartía el ancho en AUTOMÁTICO y los anchos de columna eran solo una
// sugerencia: mandaba el mínimo del contenido. Al sumar la sexta ranura de
// acciones (2026-09-28) y las insignias anchas de Estado, a 1280 px (la ventana
// del dueño, 1280×711 al 150 %) la tabla pedía 970 px de 944 y salía scroll
// horizontal con «Estado» cortado (medido con 1.239 reservas simuladas).
//
// Desde el 2026-10-06 es de reparto FIJO (`table-fixed`): cada columna mide lo
// que dice su `ANCHO_*` (en la cabecera) y Cliente se queda con lo que sobra,
// con el nombre y el teléfono recortados con «…» y enteros en el `title`. Así la
// tabla NUNCA es más ancha que su contenedor. A cambio, el ancho fijo de cada
// columna tiene que bastar para su contenido más ancho: si no, se montaría sobre
// la vecina. Los anchos de abajo salen de MEDIR ese contenido en Chrome (con la
// tabla en automático y a 1 px de ancho, cada columna se queda en su mínimo) y
// llevan unos píxeles de colchón. Si se toca el contenido de una celda, hay que
// volver a medir.
//
// Dos franjas (por debajo de 1024 px no hay tabla: tarjetas, ver más abajo):
//   · 1024–1279 px (`lg`): relleno px-1.5, insignias a 10 px, fecha y hora en
//     dos líneas con el año de dos cifras, Canal solo con su icono y el motivo
//     de la solicitud cede el sitio a la propuesta enviada.
//   · desde 1280 px (`xl`): relleno px-2, insignias a 11 px, fecha en una línea
//     con el año entero y Canal con la palabra.
// Cliente, lo que queda (medido): 219 px a 1280×711, 305 a 1366, 379 a 1440 y
// 859 a 1920; con dedo, 222 a 1024 (tablet apaisada, menú plegado a iconos).
// 10/11/2026 (petición del dueño: «los botones de acción y las cosas más grandes»): filas más altas, texto a
// 16 px, insignias a 14 px y botones de 44 px. Para que siga sin haber scroll horizontal, la fecha va siempre en
// dos líneas y Canal solo con su icono hasta 1536 px (`2xl`).
// 10/11/2026, segunda vuelta (dueño: «los botones un poquito más grandes y la letra más grande. Da igual que se
// vean menos, pero que quede mucho más claro»; y «ojo con los padding y los márgenes»): filas de 76 px, texto a
// 18 px, nombre a 20 px, celdas con px-4 py-3. Para que quepa SIN apretar márgenes sale la columna Canal (va en
// el diálogo de la reserva) y las insignias de menú solo se ven desde 1280 px.
const ALTO_FILA = "h-[76px]";
const CELDA = "px-4 py-3 align-middle";

/** Filas por página. Ver el comentario de "Paginación" más abajo. */
const TAMANO_PAGINA = 50;

/**
 * ALTO DE LA LISTA (2026-10-06, petición del dueño: «la página sigue teniendo scroll vertical: que no lo
 * haya»). Como «Hoy», el Calendario, «Próximas reservas» y la Newsletter (`useAlturaDisponible`: alto del
 * viewport visual − posición del bloque − relleno inferior del <main>, recalculado al redimensionar, girar
 * la tablet, abrir el teclado, plegar el menú lateral o cambiar de alto algo de encima): el bloque de la
 * lista —barra de «N seleccionadas», tabla (o tarjetas, < 1024 px) y paginación— mide justo lo que queda de
 * ventana. Lo de encima (el timeline y los filtros) queda fijo y SOLO las filas se desplazan, por dentro de
 * la tabla (con la cabecera de columnas pegada arriba) o del listado de tarjetas.
 *
 * SUELO (px): por debajo el bloque no encoge más y, solo entonces, la página hace scroll (ventana muy baja,
 * teclado en pantalla en el móvil). 280 px, el mismo que el kanban de Hoy: la paginación y, debajo de la
 * cabecera, tres filas de la tabla o una tarjeta entera. En la ventana del dueño (1280×711 al 150 %) al
 * bloque le quedan ~460 px; en el móvil (375×812), ~300.
 */
const ALTURA_MINIMA_LISTA = 280;

/**
 * Tocar la fila (o la tarjeta) fuera de sus botones abre la ficha (10/11/2026, petición del dueño): el editor
 * en una reserva y «Gestionar» en una solicitud. Lo que se toque dentro de un control (botones, casillas,
 * enlaces, el menú «Más», que va en un portal pero sus eventos suben por React hasta la fila) no cuenta.
 */
function alTocarFila(abrir?: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if (!abrir) return;
    const destino = e.target as Element | null;
    if (destino?.closest?.("button, a, input, label, [role='checkbox'], [role='menu'], [role='menuitem']")) return;
    if (!e.currentTarget.contains(destino as Node)) return;
    abrir();
  };
}

/** Lleva arriba del todo los contenedores con scroll propio que se le den (la tabla y las tarjetas). */
function subirArriba(...contenedores: (Element | null | undefined)[]) {
  for (const contenedor of contenedores) if (contenedor) contenedor.scrollTop = 0;
}

// Insignias de la tabla: una sola línea y alto fijo. El primitivo `Badge` NO
// lleva `whitespace-nowrap` y lo comparte toda la app, así que no se toca
// ahí: sin esto "Solicitud · Pendiente" rompía en dos líneas y "Propuesta
// enviada 24/09 18:44" en tres, que es lo que hinchaba las filas.
// Los `lg:` encogen SOLO en la franja 1024–1279 px, que es donde falta sitio:
// en las tarjetas de móvil y a partir de 1280 px la insignia queda a 11 px.
const INSIGNIA =
  "h-8 shrink-0 gap-1.5 whitespace-nowrap px-3 py-0 text-[15px] font-medium [&_svg]:h-4 [&_svg]:w-4";
/** Segunda línea del estado (motivo, propuesta): aún más compacta. */
const INSIGNIA_SECUNDARIA = "h-7 shrink-0 gap-1 whitespace-nowrap px-2 py-0 text-sm font-medium";

/**
 * "Propuesta enviada 24/09 18:44" no cabe en la columna Estado. En la lista
 * se resume a "Enviada 24/09"; el texto completo va en el `title` y sin
 * recortar en el diálogo de gestión.
 */
function etiquetaPropuestaCorta(vista: EstadoPropuestaVista, enviadaAt: string | null | undefined) {
  if (vista.clave !== "enviada") return vista.etiqueta;
  const dia = fechaHoraCorta(enviadaAt).slice(0, 5);
  return dia ? `Enviada ${dia}` : "Enviada";
}

// Anchos de columna (reparto FIJO: ver «CERO scroll horizontal» arriba). Van en
// la cabecera, que es la fila que manda en una tabla `table-fixed`; Cliente no
// lleva: se queda con lo que sobra. Contenido más ancho de cada columna, medido
// en Chrome el 2026-10-06 (relleno incluido), y el ancho que se le da:
//   · Acciones = relleno + casilla + principal + 5 iconos + 6 huecos + borde:
//       lg     12 + 16 + 76 + 5×24 + 6×2 + 1 = 237 → 240
//       xl     16 + 16 + 88 + 5×28 + 6×2 + 1 = 273 → 276 (huecos de 2 px, antes 4)
//       dedo   12 + 24 + 100 + 5×44 + 6×4 + 1 = 381 → 384 (`xl`: 385 → 388); los
//              iconos a 44 px (área táctil, commit b63d6e2) y la principal con
//              ancho fijo de 100 px (antes, la de su texto: hasta 113)
//   · Fecha    lg dos líneas «31/10/26» / «13:00»: 61 → 64; xl una línea: 130 → 132
//   · Pax      lg 41 → 44; xl 49 → 52
//   · Canal    lg solo el icono (manda el título «Canal»): 42 → 44; xl «Teléfono»: 89 → 92
//   · Estado   el peor caso es una solicitud: «Solicitud · Contactado» encima de
//              «Enviada 24/09» + «Sin disponibilidad» (en `lg`, sin el motivo):
//              lg 138 → 144; xl 185 → 188
// Suma sin Cliente: 536 px en `lg` (680 con dedo) y 740 en `xl` (852 con dedo).
// Con ratón a 1024 px y el menú lateral DESPLEGADO a mano (16rem) la tabla tiene
// 703 px: a Cliente le quedan 167. Con dedo y el menú desplegado a mano (718 px),
// solo 38: el nombre se ve con «…», pero sin scroll horizontal (el menú, en esa
// anchura, arranca plegado a iconos).
// 10/11/2026: casilla 24 + principal 136 + «Más» ~82 + huecos 2×8 + relleno 16 + borde 1 = 275 → 280.
// Acciones al ancho JUSTO (10/11/2026, petición del dueño: la columna era enorme y vacía con «Más» tras un hueco):
//   · con alguna acción principal en la página: relleno 32 + casilla 24 + principal 152 + «Más» ~100 + huecos 2×12
//     + borde 1 = 333 → 336;
//   · sin ninguna (todas confirmadas, p. ej.): relleno 32 + casilla 24 + «Más» ~100 + hueco 12 + borde 1 = 169 → 176.
// Sin hueco reservado: en una fila sin acción principal, «Más» va justo detrás de la casilla. Lo que sobra es de Cliente.
const ANCHO_ACCIONES_CON_PRINCIPAL = "w-[336px]";
const ANCHO_ACCIONES_SOLO_MAS = "w-[176px]";
// «Fecha y hora» en una línea en la cabecera: 92 px de texto + 32 de relleno.
const ANCHO_FECHA = "w-[136px]";
/** Envoltorio del nombre: ocupa lo que le deje la celda, ni más ni menos. */
const ANCHO_NOMBRE = "min-w-0 flex-1";
const ANCHO_PAX = "w-[84px]";
const ANCHO_ESTADO = "w-[200px] xl:w-[260px]";

// Fondos de fila. Hay que aplicarlos también a la celda de acciones: al ser
// `position: sticky` necesita fondo opaco propio (hoy no debería haber scroll
// horizontal nunca, pero si algún día lo hubiera, los botones se quedan
// visibles y sin transparencias). La variante `sticky` usa `group-hover`
// porque el ratón está sobre la fila (`group`), no sobre la celda.
// Las clases van literales a propósito: Tailwind no genera las que se componen
// concatenando cadenas.
const FONDOS = {
  normal: {
    fila: "bg-card hover:bg-muted",
    acciones: "bg-card group-hover:bg-muted",
  },
  // OJO con el modo oscuro: aquí NO valen colores translúcidos (`amber-950/30`
  // y compañía). La celda de acciones es `sticky`, así que si deja pasar algo
  // de fondo se ve el resto de la fila desfilando por debajo al hacer scroll
  // horizontal. Estos tonos son opacos y del mismo tono cálido que el
  // `amber-50` del modo claro, para que la fila siga leyéndose como destacada.
  destacada: {
    fila: "bg-amber-50 hover:bg-amber-100 dark:bg-[hsl(35_35%_22%)] dark:hover:bg-[hsl(35_35%_27%)]",
    acciones: "bg-amber-50 group-hover:bg-amber-100 dark:bg-[hsl(35_35%_22%)] dark:group-hover:bg-[hsl(35_35%_27%)]",
  },
} as const;

/**
 * Celda de acciones. Es la PRIMERA columna, antes de "Fecha y hora"
 * (2026-09-26, petición del dueño) y sin título en la cabecera. Se ancla a la
 * izquierda por si algún día hiciera falta scroll horizontal. Lo de dentro (las
 * ranuras, iguales en todas las filas) lo pintan `AccionesReserva` en una
 * reserva y `RanurasDeAcciones` en una solicitud.
 */
function CeldaAcciones({
  fondo,
  ancho,
  franja = false,
  children,
}: {
  fondo: string;
  /** `ANCHO_ACCIONES_CON_PRINCIPAL` o `ANCHO_ACCIONES_SOLO_MAS`, el mismo que la cabecera. */
  ancho: string;
  /** Franja ámbar de "esto es una solicitud, no una reserva". */
  franja?: boolean;
  children: ReactNode;
}) {
  return (
    <TableCell
      className={cn(
        // Relleno propio, más apretado que `CELDA`: esta columna es la más
        // ancha de todas y sus 6 ranuras no cambian de tamaño con la pantalla.
        "px-4 py-3 align-middle",
        ancho,
        "sticky left-0 z-10 border-r border-border/60",
        // La franja va como sombra interior y NO como `border-l-4` en la fila:
        // con `border-collapse`, un borde de verdad empuja el contenido 2 px y
        // los botones de las solicitudes dejaban de caer en la misma X que los
        // de las reservas. Una sombra no ocupa sitio.
        franja && "shadow-[inset_4px_0_0_0_#fbbf24]",
        fondo,
      )}
    >
      {/* Huecos de 2 px con ratón (también en `xl`: antes 4, son 12 px menos de columna); con dedo, 4. */}
      <div className="flex items-center justify-start gap-3">{children}</div>
    </TableCell>
  );
}

/**
 * Ranura "Dar mesa" de una fila de SOLICITUD: siempre deshabilitada. Una
 * solicitud del bot todavía no es una reserva (otra tabla, otro ciclo de
 * vida), así que no hay nada que sentar hasta que se convierta. El texto lo
 * pone el módulo compartido —`resolverSaltoAsignacion(null)`— y no se escribe
 * aquí, para que la lista y la pestaña Hoy digan lo mismo palabra por palabra.
 * Se calcula una sola vez: es constante.
 */
const DAR_MESA_SOLICITUD: RanuraAccion = { titulo: resolverSaltoAsignacion(null).titulo };

/** Tooltip de la insignia «Solicitud · …»: qué es una solicitud (no es una reserva todavía). */
const TITULO_SOLICITUD =
  "Solicitud que el asistente telefónico no pudo cerrar (el motivo va debajo): todavía no es una reserva";

/**
 * Celda "Fecha y hora". Hasta 1279 px va en dos líneas y con el año de dos
 * cifras (la columna baja de ~136 px a ~70 px, que es de donde sale buena
 * parte del sitio que necesita Estado); a partir de 1280 px, una línea y el
 * año completo. La fecha entera está siempre en el `title`.
 *
 * Ojo: la tabla solo existe a partir de `lg`, así que aquí el estilo base ES
 * el de 1024–1279 px y `xl:` el de pantalla ancha. No hacen falta `lg:`.
 */
function CeldaFechaHora({ dia, hora }: { dia: Date | null; hora: string | null | undefined }) {
  const hhmm = hora ? String(hora).substring(0, 5) : "—";
  if (!dia) {
    return (
      <TableCell className={cn(CELDA, ANCHO_FECHA, "whitespace-nowrap")}>
        <span className="text-muted-foreground">Sin fecha</span>
      </TableCell>
    );
  }
  const dd = String(dia.getDate()).padStart(2, "0");
  const mm = String(dia.getMonth() + 1).padStart(2, "0");
  const larga = dia.toLocaleDateString("es-ES");
  const corta = `${dd}/${mm}/${String(dia.getFullYear()).slice(-2)}`;
  return (
    <TableCell className={cn(CELDA, ANCHO_FECHA, "whitespace-nowrap tabular-nums")}>
      <span className="flex flex-col gap-0.5 text-lg leading-tight" title={`${larga} · ${hhmm}`}>
        <span>{corta}</span>
        <span className="font-semibold">{hhmm}</span>
      </span>
    </TableCell>
  );
}

/**
 * Insignia del estado de una reserva (columna Estado y tarjeta de móvil). Nombre,
 * icono, color y variante salen de `ESTADOS_RESERVA`, el mapa único que leen
 * también el kanban y el timeline: «Llegó» para 'completada', «No vino» para
 * 'no_show'. Un estado que no es de los seis se enseña tal cual, con borde.
 */
function InsigniaEstado({ estado }: { estado: string }) {
  const info = infoEstadoReserva(estado);
  if (!info) {
    return (
      <Badge variant="outline" className={INSIGNIA}>
        {estado}
      </Badge>
    );
  }
  const { Icono } = info;
  return (
    <Badge variant={info.varianteInsignia} className={cn(INSIGNIA, info.insignia)}>
      <Icono className="h-3 w-3" />
      {info.etiqueta}
    </Badge>
  );
}

/**
 * Opciones del desplegable «Canal» (los valores son los de `FiltrosListaUnificada.canal`). `corta` es lo que
 * dice el desplegable CERRADO tras «Canal: »: sin el icono y con el nombre de la insignia de la columna Canal.
 */
const OPCIONES_FILTRO_CANAL: { value: string; label: string; corta?: string }[] = [
  { value: "all", label: "Todos los canales" },
  { value: "telefono", label: "📞 Tel", corta: "Teléfono" },
  { value: "web", label: "🌐 Web", corta: "Web" },
  { value: "manual", label: "✏️ Manual", corta: "Manual" },
  { value: "presencial", label: "🏠 En local", corta: "En local" },
];

/**
 * Lo que dice un desplegable de filtro CERRADO (2026-10-05, petición del dueño: «en los dos filtros pon lo que
 * es el filtro en lugar de "Todos" para que se entienda»): sin filtro, su nombre («Estado»); con un valor
 * elegido, «Nombre: valor» («Estado: Pendiente», «Canal: Web»). Un valor que no está entre las opciones (una
 * URL antigua, p. ej.) se enseña tal cual.
 */
/** Un filtro puesto, en el móvil: chip pequeño que se quita con un toque (área táctil de 44 px). */
function ChipFiltro({ children, onQuitar }: { children: ReactNode; onQuitar: () => void }) {
  return (
    <button
      type="button"
      onClick={onQuitar}
      className="touch-hit inline-flex h-8 max-w-full items-center gap-1 rounded-full border bg-muted px-2.5 text-xs font-medium"
    >
      <span className="truncate">{children}</span>
      <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(quitar)</span>
    </button>
  );
}

function textoFiltroCerrado(
  nombre: string,
  valor: string,
  opciones: readonly { value: string; label: string; corta?: string }[],
): string {
  if (valor === "all") return nombre;
  const opcion = opciones.find((o) => o.value === valor);
  return `${nombre}: ${opcion ? opcion.corta ?? opcion.label : valor}`;
}

interface ListaReservasAvanzadaProps {
  /**
   * Salto al plano de la sala de una reserva, para darle mesa. Opcional: si la
   * pantalla que monta la lista no tiene plano al que llevar, el botón se queda
   * en su sitio pero deshabilitado — nunca desaparece, o los botones bailarían
   * de una fila a otra. (El editor de una reserva lo abre la propia lista, con
   * `useEdicionReserva`.)
   */
  onAsignarMesa?: (destino: DestinoAsignacion) => void;
  initialStatusFilter?: string;
  initialDateFilter?: Date;
  /**
   * Solicitudes que el bot no pudo resolver, mezcladas en la lista como
   * filas "Solicitud". Lo instancia `Reservas.tsx` (una sola vez: ver el
   * aviso de realtime en useSolicitudesPendientes.ts) y lo pasa aquí.
   */
  solicitudesState?: ReturnType<typeof useSolicitudesPendientes>;
}

export function ListaReservasAvanzada({
  onAsignarMesa,
  initialStatusFilter,
  initialDateFilter,
  solicitudesState,
}: ListaReservasAvanzadaProps) {
  // Alto del bloque de la lista (barra de «N seleccionadas» + tabla o tarjetas + paginación), calculado
  // solo: ver `ALTURA_MINIMA_LISTA`. `null` mientras no hay medida (cargando, jsdom): entonces la tabla
  // conserva su tope de siempre y la página crece con ella.
  const [bloqueLista, setBloqueLista] = useState<HTMLDivElement | null>(null);
  const altoLista = useAlturaDisponible(bloqueLista, ALTURA_MINIMA_LISTA);
  const medida = altoLista !== null;
  // Los dos contenedores con scroll propio: el de la tabla (el `div` que el primitivo `Table` pone
  // alrededor de la tabla, primer hijo de este) y el de las tarjetas (< 1024 px).
  const contenedorTablaRef = useRef<HTMLDivElement>(null);
  const tarjetasRef = useRef<HTMLDivElement>(null);
  const [pagina, setPagina] = useState(1);
  const [verificacionModalOpen, setVerificacionModalOpen] = useState(false);
  const [selectedReservaForVerification, setSelectedReservaForVerification] = useState<Reservation | null>(null);
  const [blacklistReserva, setBlacklistReserva] = useState<Reservation | null>(null);
  // Cancelar pide confirmación (2026-09-26, petición del dueño): el botón ya no
  // cancela al primer clic, abre este diálogo con el nombre, el día y la hora
  // de la reserva para que no se cancele la equivocada. Un ÚNICO AlertDialog
  // para toda la lista: montar uno por fila serían 50 diálogos en el DOM.
  const [reservaACancelar, setReservaACancelar] = useState<Reservation | null>(null);
  // Diálogo de aceptar / confirmar / verificar con los datos y el día a la vista (10/11/2026).
  const [dialogoAccion, setDialogoAccion] = useState<{ reserva: Reservation; accion: AccionDialogo } | null>(null);
  // Selección para aceptar en bloque — solo pendientes participan.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [aceptandoBloque, setAceptandoBloque] = useState(false);
  // Aceptar en bloque también confirma: escribe en N reservas de golpe y
  // dispara N avisos al cliente, y eso no se deshace con otro clic.
  const [confirmarBloque, setConfirmarBloque] = useState(false);

  const { canAccess: canEdit } = useCanAccessSection("reservas", "edit");
  // Editor de reservas (2026-09-30): lo abre la cuarta ranura de cada fila.
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  const queryClient = useQueryClient();
  // Tras crear una reserva desde una solicitud (aceptar la propuesta por teléfono): las mismas
  // claves que refrescan las acciones que cambian ocupación (`clavesCache.ts`).
  const refrescarReservas = () =>
    CLAVES_POR_CAMBIO.ocupacion.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  // Todo lo que cambia una reserva desde esta lista (Aceptar, aceptar en bloque, Confirmar, Cancelar,
  // la estrella) lo ejecuta este hook: comprueba que la escritura de verdad se ha guardado, la
  // condiciona al estado de partida, cambia la fila al instante, refresca lo cacheado (también esta
  // lista: `reservas-lista`) y, donde toca, avisa al cliente con la respuesta comprobada. Antes cada
  // handler de aquí escribía, avisaba y refrescaba a su manera.
  const acciones = useAccionesServicioReserva();

  // Filtros - inicializar con props si vienen de URL
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || "all");
  const [canalFilter, setCanalFilter] = useState<string>("all");
  // «Menú del día / Carta» (10/11/2026): filtro rápido de dos botones; volver a pulsar el puesto lo quita.
  const [servicioFilter, setServicioFilter] = useState<"all" | "menu" | "carta">("all");
  const [dateFilter, setDateFilter] = useState<Date | undefined>(initialDateFilter);
  // Móvil (< 768 px, 07/11/2026): los filtros (fecha, estado, canal, «Por atender») viven en una hoja inferior.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  // Sin filtro «Negocio»: solo Casa Tomás admite reservas (decisión del dueño, 2026-10-01). Lo que quede de
  // Touza en la base de datos no llega a ser fila (`unificarReservasYSolicitudes`, regla `admiteReservas`).
  const { data: espaciosData } = useEspaciosReserva();
  const espacios = useMemo(() => ((espaciosData ?? []) as any[]), [espaciosData]);
  // Nombre de sala por id, para que el `title` de "Dar mesa" diga a DÓNDE
  // lleva ("Abrir el plano en Comedor para darle mesa"). Sale de los espacios
  // que la lista ya tiene cargados: ni una consulta más por esto. No se mira si
  // ya tiene MESA (`yaTieneMesa`) a propósito: eso está en `asignaciones_mesa` y
  // costaría otra consulta para las 375+ filas solo para cambiar una frase del
  // tooltip; el plano, nada más abrirse, ya enseña si está sentada o no.
  const nombresDeSala = useMemo(() => {
    const porId = new Map<string, string>();
    for (const e of espacios) if (e?.id) porId.set(String(e.id), String(e.nombre ?? ""));
    return porId;
  }, [espacios]);
  const nombreSalaDe = (reserva: Reservation) =>
    reserva.espacio_id ? nombresDeSala.get(reserva.espacio_id) ?? null : null;
  // El Reservado ya no lleva etiqueta «Fuera de aforo» aquí: solo se ve en Hoy (dueño, 2026-10-15).
  // Solicitud del bot que se está convirtiendo en reserva / gestionando.
  const [solicitudAConvertir, setSolicitudAConvertir] = useState<SolicitudPendiente | null>(null);
  // Día/hora/pax/sala editados en el diálogo de gestión (SolicitudGestionPanel).
  // `null` = convertir tal cual está guardada la solicitud.
  const [propuestaConversion, setPropuestaConversion] = useState<PropuestaSolicitud | null>(null);
  const abrirConversion = (s: SolicitudPendiente, propuesta: PropuestaSolicitud | null = null) => {
    setPropuestaConversion(propuesta);
    setSolicitudAConvertir(s);
  };
  const [solicitudGestionId, setSolicitudGestionId] = useState<string | null>(null);

  // `select("*")` a propósito, no una lista de columnas: `hora_solicitada`/
  // `espacio_solicitado_id` (migración 20260920010000) todavía no están en
  // los tipos generados, y nombrarlas explícitamente en un `.select(...)`
  // literal hace que el propio compilador de Supabase infiera
  // `SelectQueryError<"column ... does not exist">` para TODA la consulta
  // (falla en build, no solo en runtime). `*` no tiene ese problema — trae
  // lo que exista en la tabla en cada momento, ni más ni menos — y es el
  // mismo patrón que ya usa `useBlacklist.ts` para las columnas nuevas de
  // `blacklist`. Si la migración no está aplicada, las dos columnas
  // simplemente no vienen en cada fila: `ReservaParaVerificar` las declara
  // opcionales y el resto del código (espacioAlAceptar,
  // difiereSolicitudDeOferta) ya trata su ausencia como "sin contraoferta
  // todavía", no como un error.
  //
  // React Query (antes useState + fetch manual) con clave "reservas-lista":
  // así las acciones de otras partes de la pestaña — "Ha llegado" en
  // "Reservas de hoy", mover de espacio en el Gestor, alta nueva — refrescan
  // también esta lista (useAccionesServicioReserva / FormularioReserva
  // invalidan por prefijo), y un fallo de carga sigue sin pintarse como
  // "No se encontraron reservas".
  const {
    data: reservasData,
    isLoading: loading,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["reservas-lista"],
    queryFn: async ({ signal }) => {
      try {
        // TODO el histórico de `reservas`, sin filtro de estado, de fecha ni de negocio: los filtros de la
        // pantalla se aplican aquí, en el cliente, y lo que quede de Touza en datos antiguos no llega a ser fila
        // (`unificarReservasYSolicitudes`). PostgREST corta cada petición a 1.000 filas y ya hay más de 1.200
        // reservas, así que se lee por LOTES de 1.000 (`leerReservasLista` / `paginarConsulta`), de la más
        // reciente a la más antigua: `fecha` descendente, `hora` ascendente y `id` de desempate. Todo o nada: si
        // un lote falla, falla la consulta entera. La caché sigue siendo un ARRAY de reservas (`.filas`): los
        // parches optimistas de `useAccionesServicioReserva` (`Array.isArray(old)`) dependen de ello.
        //
        // Cada recarga (una acción, el foco de la ventana, un cambio llegado por realtime: ver
        // `useListaReservasEnVivo`, justo debajo) relee el histórico entero, hoy ~1.241 reservas = 2 peticiones.
        // Si crece mucho habrá que filtrar por fecha en el servidor en vez de leerlo todo: por encima de
        // `LIMITE_FILAS` (10.000) `leerReservasLista` corta y devuelve `truncado: true`, que esta pantalla todavía
        // no enseña.
        const { filas } = await leerReservasLista(supabase, { signal });
        return filas as unknown as Reservation[];
      } catch (error) {
        // Solo los errores REALES avisan. A este `catch` llegan también los ABORTOS (cada acción optimista hace
        // `cancelQueries(["reservas-lista"])`; también cancelan la lectura una recarga que se vuelve a pedir con
        // datos ya en caché y desmontar la Lista) y `ErrorLecturaInconsistente` (los datos cambiaron mientras se
        // leían los lotes): de los dos se ocupa TanStack Query, con sus cancelaciones y sus reintentos, y avisar
        // sería un falso «error de carga». Siempre se relanza.
        if (!signal.aborted && !(error instanceof ErrorLecturaInconsistente)) {
          toast.error("Error al cargar reservas");
          console.error(error);
        }
        throw error;
      }
    },
  });
  // Lo que cambie en `reservas` desde otro dispositivo, la web o el bot vuelve a pedir esta lista (1-5 s después;
  // con la pestaña del navegador oculta, al volver a ella).
  useListaReservasEnVivo();
  const reservations = useMemo(() => reservasData ?? [], [reservasData]);
  const fetchReservations = () => {
    void refetch();
  };

  const solicitudes = useMemo(() => solicitudesState?.solicitudes ?? [], [solicitudesState?.solicitudes]);
  const solicitudGestion = solicitudGestionId ? solicitudes.find((s) => s.id === solicitudGestionId) ?? null : null;

  // Datos para prerrellenar el alta a partir de la solicitud. Memo: el
  // formulario reescribe sus campos cada vez que cambia la identidad.
  const datosConversion = useMemo(() => {
    const s = solicitudAConvertir;
    if (!s) return null;
    const p = propuestaConversion;
    const fecha = p ? p.fecha : s.fecha_solicitada;
    const hora = p ? p.hora : s.hora_solicitada;
    // La reserva que sale de aquí es de Casa Tomás (el alta siempre escribe su marca): las solicitudes de
    // otro negocio ni siquiera salen en la lista.
    return {
      fecha: fecha ? new Date(`${fecha}T12:00:00`) : undefined,
      hora: hora ? String(hora).substring(0, 5) : undefined,
      nombre: s.nombre ?? undefined,
      telefono: s.telefono ?? undefined,
      email: s.email ?? undefined,
      numero_comensales: (p ? p.comensales : s.numero_comensales) ?? undefined,
      notas_cliente: s.notas_cliente ?? undefined,
      espacio_id: p ? p.espacioId : s.espacio_propuesto_id ?? null,
      // El cliente llamó al bot: la reserva es de canal teléfono y queda
      // enlazada a su solicitud (reservas.solicitud_id).
      canal: "telefono" as const,
      solicitud_id: s.id,
    };
  }, [solicitudAConvertir, propuestaConversion]);

  const handleReservaDesdeSolicitudCreada = async (creada?: ReservaCreadaDesdeFormulario) => {
    const s = solicitudAConvertir;
    setSolicitudAConvertir(null);
    setPropuestaConversion(null);
    if (s && solicitudesState) {
      // Si la reserva final difiere de lo guardado en la solicitud, se deja
      // constancia en la propia solicitud (día/hora/pax/sala + "Petición
      // original" en notas) antes de cerrarla. Sin toast: el de "resuelta" basta.
      const cambios = creada
        ? actualizacionPropuesta(
            s,
            { fecha: creada.fecha, hora: creada.hora, comensales: creada.numero_comensales, espacioId: creada.espacio_id },
            { persistirSala: "espacio_propuesto_id" in s },
          )
        : null;
      if (cambios) await solicitudesState.updatePropuesta(s.id, cambios, { silencioso: true });
      await solicitudesState.marcarConvertida(s.id, creada?.id ?? null);
    }
  };

  /** Cancela de verdad — solo se llega aquí desde el "sí" del diálogo. */
  const confirmarCancelacion = async () => {
    const reserva = reservaACancelar;
    if (!reserva) return;
    setReservaACancelar(null);
    await acciones.cancelar(reserva);
  };

  // Un clic: acepta la reserva pendiente TAL COMO ESTÁ, sin tocar su hora ni su
  // sala (ver `espacioAlAceptar` en verificacion.ts). Requisito explícito del
  // dueño ("hay mucho volumen"): esto NO abre el modal de contraoferta.
  const handleAceptarUnaClic = (reservation: Reservation) => acciones.aceptar(reservation);

  const toggleSeleccion = (id: string) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Qué hace cada botón de una reserva: lo mismo en la tabla y en la tarjeta de
   * móvil. Si se puede pulsar o no (y por qué) lo decide `AccionesReserva` con
   * `accionesDisponibles`; aquí solo se dice a quién se llama.
   */
  /**
   * Lo que hacían «Aceptar», «Confirmar» y «Verificar» al pulsarlos en la fila. Desde el 10/11/2026 (petición
   * del dueño: «se abre el pop-up para ver el día, lo que hay ese día y ver si se puede») la fila abre primero
   * `DialogoAccionReserva` con los datos y el día, y es su botón verde el que llama a esto: lo mismo de antes.
   */
  const ejecutarAccion = (reserva: Reservation, accion: AccionDialogo) => {
    if (accion === "aceptar") return handleAceptarUnaClic(reserva);
    if (accion === "confirmar") return acciones.confirmar(reserva);
    setSelectedReservaForVerification(reserva);
    setVerificacionModalOpen(true);
    return undefined;
  };

  const alPulsar = (reserva: Reservation): AlPulsar => ({
    aceptar: () => setDialogoAccion({ reserva, accion: "aceptar" }),
    confirmar: () => setDialogoAccion({ reserva, accion: "confirmar" }),
    verificar: () => setDialogoAccion({ reserva, accion: "verificar" }),
    seleccionar: () => toggleSeleccion(reserva.id),
    // El editor (2026-09-30, «las reservas se editan siempre»): en CUALQUIER estado, fecha y canal.
    editar: () => editarReserva(reserva.id),
    // Cancelar no cancela al primer clic: abre la confirmación (más abajo).
    cancelar: () => setReservaACancelar(reserva),
    listaNegra: () => setBlacklistReserva(reserva),
    importante: () => void acciones.alternarImportante(reserva),
  });

  // Solo las pendientes de la PÁGINA actual: "seleccionar todas" tiene que
  // marcar lo que el usuario está viendo, no 300 reservas que no ve.
  const pendientesVisibles = () =>
    filasPagina.flatMap((f) => (f.tipo === "reserva" && f.reserva.estado === "pendiente" ? [f.reserva] : []));

  const toggleSeleccionarTodasPendientes = () => {
    const pendientes = pendientesVisibles();
    setSeleccionadas((prev) => {
      const todasYaSeleccionadas = pendientes.length > 0 && pendientes.every((r) => prev.has(r.id));
      if (todasYaSeleccionadas) return new Set();
      return new Set(pendientes.map((r) => r.id));
    });
  };

  // Acción en bloque: no navega ni cambia de filtro al terminar, así que la
  // lista no "salta" — las filas aceptadas simplemente desaparecen del
  // filtro "Pendiente" al refrescar, sin perder el sitio en el resto.
  const handleAceptarSeleccionadas = async () => {
    const elegidas = reservations.filter((r) => seleccionadas.has(r.id));
    setConfirmarBloque(false);
    if (elegidas.length === 0) return;
    setAceptandoBloque(true);
    try {
      await acciones.aceptarVarias(elegidas);
      setSeleccionadas(new Set());
    } finally {
      setAceptandoBloque(false);
    }
  };

  // En la tabla, entre 1024 y 1279 px la columna Canal se queda solo con el
  // icono (el nombre completo sigue en el `title`): esos ~60 px hacen falta
  // para que Estado enseñe sus insignias enteras. A partir de 1280 px, y en
  // las tarjetas de móvil (`completo`), se lee la palabra.
  const getCanalBadge = (canal: string | null, completo = false) => {
    const ETIQUETA_CANAL = completo ? "" : "hidden 2xl:inline";
    switch (canal) {
      case 'telefono':
        return (
          <Badge title="Canal: teléfono" className={cn(INSIGNIA, "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300")}>
            <Phone className="h-3 w-3" />
            <span className={ETIQUETA_CANAL}>Teléfono</span>
          </Badge>
        );
      case 'web':
        return (
          <Badge title="Canal: web" className={cn(INSIGNIA, "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>
            <Globe className="h-3 w-3" />
            <span className={ETIQUETA_CANAL}>Web</span>
          </Badge>
        );
      case 'presencial':
        // Sentados sin reserva («Sin reserva 13:35»): antes caían en el «Web» por defecto.
        return (
          <Badge title="Canal: en el local, sin reserva" className={cn(INSIGNIA, "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300")}>
            <Store className="h-3 w-3" />
            <span className={ETIQUETA_CANAL}>En local</span>
          </Badge>
        );
      case 'manual':
        return (
          <Badge title="Canal: alta manual" className={cn(INSIGNIA, "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300")}>
            <Pencil className="h-3 w-3" />
            <span className={ETIQUETA_CANAL}>Manual</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" title="Canal: web" className={cn(INSIGNIA, "text-muted-foreground")}>
            <Globe className="h-3 w-3" />
            <span className={ETIQUETA_CANAL}>Web</span>
          </Badge>
        );
    }
  };

  // Aplicar filtros — a reservas Y solicitudes a la vez (lógica pura en
  // src/lib/reservas/vistaUnificada.ts). La fecha se compara como texto
  // "yyyy-MM-dd": antes se hacía `new Date(r.fecha)` (medianoche UTC) contra
  // una fecha local, lo que en husos negativos casaba con el día anterior.
  //
  // Los filtros van en UN solo objeto porque los leen dos cosas a la vez: las filas que se ven y la cifra
  // del botón «Por atender». Así no pueden desincronizarse: si mañana se añade un filtro, lo usan las dos.
  const filtrosLista = useMemo<FiltrosListaUnificada>(
    () => ({
      busqueda: searchQuery,
      estado: statusFilter,
      canal: canalFilter,
      fecha: dateFilter ? format(dateFilter, "yyyy-MM-dd") : null,
      servicio: servicioFilter,
    }),
    [searchQuery, statusFilter, canalFilter, dateFilter, servicioFilter],
  );
  const filas = useMemo(
    () => filtrarFilasUnificadas(unificarReservasYSolicitudes(reservations, solicitudes), filtrosLista),
    [reservations, solicitudes, filtrosLista],
  );
  // Sin recuento «N reservas · M solicitudes» en la barra de filtros (2026-10-06, petición del dueño: ocupaba
  // una línea entera a 1280 px). Lo que hay por atender sigue en el botón «Por atender» y el total de filas,
  // en la paginación («Mostrando 1–50 de 1241»).
  //
  // «Por atender» (botón de la barra = opción `FILTRO_POR_ATENDER` del desplegable «Estado»). Su cifra se cuenta
  // con la lista y sus filtros menos el de estado, con las reservas pendientes y las solicitudes sin resolver:
  // es justo lo que se verá al pulsarlo (`cifraPorAtender`).
  const soloPorAtender = statusFilter === FILTRO_POR_ATENDER;
  const cuantasPorAtender = useMemo(
    () => cifraPorAtender(reservations, solicitudes, filtrosLista),
    [reservations, solicitudes, filtrosLista],
  );
  // Lo que dicen los dos desplegables cerrados: «Estado» / «Estado: Pendiente», «Canal» / «Canal: Web».
  const textoEstado = textoFiltroCerrado("Estado", statusFilter, OPCIONES_FILTRO_ESTADO);
  const textoCanal = textoFiltroCerrado("Canal", canalFilter, OPCIONES_FILTRO_CANAL);
  // Lista vacía: con «Por atender» se dice que no queda nada por atender (con los demás filtros, si los hay).
  const hayOtrosFiltros = searchQuery.trim() !== "" || !!dateFilter || canalFilter !== "all" || servicioFilter !== "all";
  const textoListaVacia = soloPorAtender
    ? `No hay nada por atender${hayOtrosFiltros ? " con los filtros aplicados" : ""}: ninguna reserva pendiente ni solicitud sin resolver`
    : "No se encontraron reservas con los filtros aplicados";

  // --- Paginación -----------------------------------------------------------
  // Medido en el navegador con las 375 reservas + 2 solicitudes reales:
  // repintar la lista ENTERA (al vaciar el buscador, al cambiar de estado…)
  // costaba entre 0,4 y 0,9 s, mientras que repintar una lista ya filtrada de
  // 13-27 filas costaba 40-120 ms. El coste va con el número de filas que se
  // montan, así que se acota cuántas se montan a la vez. Se descartó
  // virtualizar: obliga a meter dependencia nueva y a sacar las filas del
  // flujo normal de la tabla, que es justo lo que sostiene la cabecera y la
  // columna de acciones pegajosas.
  const totalPaginas = Math.max(1, Math.ceil(filas.length / TAMANO_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const primeraDeLaPagina = (paginaActual - 1) * TAMANO_PAGINA;
  const filasPagina = filas.slice(primeraDeLaPagina, primeraDeLaPagina + TAMANO_PAGINA);
  const hayPaginacion = totalPaginas > 1;
  // La barra de "N solicitudes seleccionadas" va DENTRO del bloque de la lista, encima de la tabla: al
  // aparecer, la tabla encoge por dentro y el alto del bloque no cambia (nada que volver a medir).
  const barraSeleccionVisible = canEdit && seleccionadas.size > 0;
  // ¿Alguna fila de la página tiene acción principal? Si no, la columna de acciones se queda al ancho de «Más».
  const hayAccionPrincipal = filasPagina.some((f) =>
    f.tipo === "solicitud" ? esSolicitudAbierta(f.solicitud.estado) : f.reserva.estado === "pendiente" || f.reserva.estado === "verificada",
  );
  const anchoAcciones = hayAccionPrincipal ? ANCHO_ACCIONES_CON_PRINCIPAL : ANCHO_ACCIONES_SOLO_MAS;

  // Al cambiar cualquier filtro se vuelve a la primera página (si no, filtrar desde la página 7 dejaba la
  // lista en blanco) y las filas vuelven arriba: los resultados nuevos se ven desde el principio. SOLO al
  // cambiar un filtro: al refrescarse los datos (una acción, el foco de la ventana) o al marcar una casilla,
  // el contenedor de las filas no se toca y conserva su posición.
  useEffect(() => {
    setPagina(1);
    subirArriba(contenedorTablaRef.current?.firstElementChild, tarjetasRef.current);
  }, [searchQuery, statusFilter, canalFilter, dateFilter, servicioFilter]);

  const irAPagina = (destino: number) => {
    setPagina(Math.min(Math.max(1, destino), totalPaginas));
    // Volver arriba: si no, cambias de página y sigues viendo el centro de la
    // lista anterior.
    subirArriba(contenedorTablaRef.current?.firstElementChild, tarjetasRef.current);
    window.scrollTo({ top: 0 });
  };

  // Cuántos filtros hay puestos (el buscador aparte): la cifra del botón «Filtros» del móvil.
  const filtrosActivos =
    Number(!!dateFilter) + Number(statusFilter !== "all") + Number(canalFilter !== "all") + Number(servicioFilter !== "all");
  const textoServicio = servicioFilter === "menu" ? "Menú del día" : servicioFilter === "carta" ? "Carta" : "";

  // Los controles de filtro: en la fila de la tarjeta desde `md` y en la hoja «Filtros» en el móvil.
  const controlesFiltro = (
    <>
      {/* Botón Hoy */}
      <Button
        variant={dateFilter && dateFilter.toDateString() === new Date().toDateString() ? "default" : "outline"}
        size="default"
        onClick={() => setDateFilter(new Date())}
      >
        Hoy
      </Button>

      {/* Filtro de fecha */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-[120px] sm:min-w-[150px]">
            <Calendar className="mr-2 h-4 w-4" />
            {dateFilter
              ? (dateFilter.toDateString() === new Date().toDateString()
                ? "Hoy"
                : format(dateFilter, "d MMM yyyy", { locale: es }))
              : "Fecha"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarUI
            mode="single"
            selected={dateFilter}
            onSelect={setDateFilter}
            initialFocus
          />
          {dateFilter && (
            <div className="p-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setDateFilter(undefined)}
              >
                Limpiar
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* «Por atender» (2026-10-05, petición del dueño: «pon aquí un filtro de solo pendientes»; el nombre lo
          decidió él: «Por atender», no «Pendientes»): botón de alternancia con el estilo de «Hoy» para ver
          solo lo que espera a que el personal haga algo —las reservas pendientes y las solicitudes sin
          resolver—. No es un filtro aparte: pone y quita la opción «Por atender» del desplegable «Estado»
          (`FILTRO_POR_ATENDER`), así que los dos van siempre a la par, y volver a pulsarlo deja «Todos los
          estados». La cifra es lo que enseñaría al pulsarlo con los demás filtros puestos. Un poco más
          ceñido que «Hoy» (`px-3 gap-1.5`): con él, la barra sigue cabiendo en una línea a 1440 px. */}
      <Button
        variant={soloPorAtender ? "default" : "outline"}
        className="gap-1.5 px-3"
        aria-pressed={soloPorAtender}
        title={
          soloPorAtender
            ? "Quitar el filtro «Por atender»"
            : "Ver solo lo que está por atender: reservas pendientes y solicitudes sin resolver"
        }
        onClick={() => setStatusFilter((actual) => (actual === FILTRO_POR_ATENDER ? "all" : FILTRO_POR_ATENDER))}
      >
        Por atender{" "}
        <span
          data-cifra-por-atender={cuantasPorAtender}
          className={cn(
            "rounded-full px-1.5 text-[11px] pointer-coarse:text-xs font-semibold leading-5 tabular-nums",
            // Pulsado, en negativo sobre el botón oscuro (también con un 0), como la cifra del timeline.
            soloPorAtender
              ? "bg-primary-foreground text-primary"
              : cuantasPorAtender > 0
                ? // Con algo por atender, en rojo y más grande (10/11/2026: «que se vea más»).
                  "min-w-6 bg-red-600 text-center text-sm text-white motion-safe:animate-pulse"
                : "text-muted-foreground",
          )}
        >
          {cuantasPorAtender}
          {/* El espacio, fuera del `sr-only` (dentro, el nombre accesible lo recorta). Se lee «Por atender
              4 reservas y solicitudes». */}
          {" "}
          <span className="sr-only">{cuantasPorAtender === 1 ? "reserva o solicitud" : "reservas y solicitudes"}</span>
        </span>
      </Button>

      {/* Filtro de estado. Cerrado dice QUÉ filtra (2026-10-05, petición del dueño): «Estado» sin filtro y
          «Estado: Pendiente» con uno (`textoFiltroCerrado`). Lo que no cabe se recorta con «…» letra a
          letra (`truncate`: el `line-clamp-1` del primitivo corta por palabras y dejaba «Canal:…» sin el
          valor), a la izquierda (un `<button>` centra), sin encoger la flecha (`[&>svg]:shrink-0`) y con
          el texto entero en el `title`. Ancho: 170 px (antes 200 desde `sm`): caben enteros los seis
          estados y «Por atender» y, con el botón nuevo, la barra sigue en una línea a 1440 px; solo las
          dos opciones de solicitudes se recortan, y desde `2xl` (1536 px), donde sobra sitio, caben. */}
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger
          className="w-[170px] gap-1 text-left 2xl:w-[236px] [&>svg]:shrink-0"
          aria-label="Filtrar por estado"
          title={statusFilter === "all" ? undefined : textoEstado}
        >
          <SelectValue>
            <span className="block truncate">{textoEstado}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {OPCIONES_FILTRO_ESTADO.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Filtro de canal: igual que el de estado («Canal» / «Canal: Web»). 144 px en todas las anchuras
          (antes 120 en el móvil y 140 desde `sm`): cabe «Canal: Teléfono», y a 375 px va en su línea. */}
      <Select value={canalFilter} onValueChange={setCanalFilter}>
        <SelectTrigger
          className="w-[144px] gap-1 text-left [&>svg]:shrink-0"
          aria-label="Filtrar por canal"
          title={canalFilter === "all" ? undefined : textoCanal}
        >
          <SelectValue>
            <span className="block truncate">{textoCanal}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {OPCIONES_FILTRO_CANAL.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* «Menú del día / Carta» (10/11/2026, petición del dueño): dos botones; el puesto se quita al volver a pulsarlo. */}
      <div role="group" aria-label="Menú del día o carta" className="flex gap-1">
        {(["menu", "carta"] as const).map((v) => (
          <Button
            key={v}
            type="button"
            variant={servicioFilter === v ? "default" : "outline"}
            aria-pressed={servicioFilter === v}
            onClick={() => setServicioFilter((actual) => (actual === v ? "all" : v))}
          >
            {v === "menu" ? "Menú del día" : "Carta"}
          </Button>
        ))}
      </div>
    </>
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <EstadoErrorCarga
        titulo="el listado de reservas"
        error={loadError}
        onReintentar={() => fetchReservations()}
      />
    );
  }

  return (
    // Una columna: lo de arriba (timeline y filtros) a su alto y, debajo, el bloque de la lista, que mide lo
    // que queda de ventana (`altoLista`). Si lo de arriba cambia de alto (los filtros se reparten en más
    // líneas, el timeline gana o pierde su barra de scroll), el bloque se mueve y `useAlturaDisponible` lo
    // vuelve a medir: vigila los contenedores del bloque hasta el <main>.
    <div className="flex flex-col gap-3">
      {/* Cómo avanza una reserva (2026-10-01, petición del dueño: «este timeline ponlo en la lista también»).
          Arriba de todo, como una banda de estados sobre los filtros y la tabla (el mismo patrón que las
          pestañas de estado de un listado), en UNA fila fina y sin cifras (2026-10-06), y plegable (la
          preferencia se recuerda en el navegador). Cada estado es un botón que activa/desactiva el filtro
          «Estado»: volver a pulsar el que está puesto lo quita («Todos»). */}
      <TimelineEstadosReserva
        className="shrink-0 max-md:hidden"
        estadoActivo={statusFilter}
        onElegirEstado={(estado) => setStatusFilter((actual) => (actual === estado ? "all" : estado))}
      />

      {/* Filtros */}
      <Card className="shrink-0 max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardContent className="p-0 md:p-4">
          <div className="flex flex-row flex-wrap items-center gap-2 md:gap-4">
            {/* Búsqueda */}
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar nombre, teléfono o email…"
                aria-label="Buscar reservas y solicitudes"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Móvil (< 768 px, 07/11/2026): solo el buscador y «Filtros (N)», que abre una hoja inferior con
                fecha, «Por atender», estado y canal. Desde `md`, todo en la fila de siempre. */}
            <Button
              type="button"
              variant={filtrosActivos > 0 ? "default" : "outline"}
              className="h-11 shrink-0 gap-1.5 px-3 md:hidden"
              onClick={() => setFiltrosAbiertos(true)}
              aria-label={filtrosActivos > 0 ? `Filtros (${filtrosActivos} activos)` : "Filtros"}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filtros{filtrosActivos > 0 && ` (${filtrosActivos})`}
            </Button>

            <div className="hidden gap-2 flex-wrap md:flex">
              {controlesFiltro}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Móvil: los filtros puestos, como chips pequeños que se quitan con un toque. */}
      {filtrosActivos > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 md:hidden" aria-label="Filtros activos">
          {dateFilter && (
            <ChipFiltro onQuitar={() => setDateFilter(undefined)}>
              {dateFilter.toDateString() === new Date().toDateString() ? "Hoy" : format(dateFilter, "d MMM yyyy", { locale: es })}
            </ChipFiltro>
          )}
          {statusFilter !== "all" && <ChipFiltro onQuitar={() => setStatusFilter("all")}>{textoEstado}</ChipFiltro>}
          {canalFilter !== "all" && <ChipFiltro onQuitar={() => setCanalFilter("all")}>{textoCanal}</ChipFiltro>}
          {servicioFilter !== "all" && <ChipFiltro onQuitar={() => setServicioFilter("all")}>{textoServicio}</ChipFiltro>}
        </div>
      )}

      <Sheet open={filtrosAbiertos} onOpenChange={setFiltrosAbiertos}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>Fecha, estado y canal de las reservas y solicitudes.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-wrap gap-2 [&_button]:min-h-11">{controlesFiltro}</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-12"
              disabled={filtrosActivos === 0}
              onClick={() => {
                setDateFilter(undefined);
                setStatusFilter("all");
                setCanalFilter("all");
              }}
            >
              Quitar filtros
            </Button>
            <Button className="h-12" onClick={() => setFiltrosAbiertos(false)}>
              Ver {filas.length} {filas.length === 1 ? "resultado" : "resultados"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* BLOQUE DE LA LISTA: mide lo que queda de ventana (`altoLista`, ver `ALTURA_MINIMA_LISTA`) y es una
          columna: la barra de «N seleccionadas» y la paginación a su alto, y la tabla (o las tarjetas) con
          todo lo demás y su propio scroll vertical. `flex-none` y no `flex-1`: en una columna flex sin alto
          propio (la de este componente), Chrome ignora el `height` de un hijo `flex: 1 1 0%`. Sin medida
          (jsdom, primer pintado) crece con su contenido, como antes. */}
      <div
        ref={setBloqueLista}
        data-testid="lista-bloque"
        data-altura-fija={medida ? String(altoLista) : undefined}
        className={cn("flex min-w-0 flex-col gap-3", medida && "flex-none")}
        style={medida ? { height: altoLista } : undefined}
      >
        {/* Barra de acción en bloque — aceptar varias solicitudes pendientes a
            la vez sin abrir una ficha por cada una. Solo con permiso de edición.
            DENTRO del bloque: al aparecer encoge la tabla, no mueve el bloque. */}
        {barraSeleccionVisible && (
          <Card className="shrink-0 border-primary/40 bg-primary/5">
            <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-medium">
                {seleccionadas.size} solicitud{seleccionadas.size === 1 ? "" : "es"} seleccionada{seleccionadas.size === 1 ? "" : "s"}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSeleccionadas(new Set())} disabled={aceptandoBloque}>
                  Quitar selección
                </Button>
                <Button size="sm" onClick={() => setConfirmarBloque(true)} disabled={aceptandoBloque}>
                  {aceptandoBloque ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCheck className="h-4 w-4 mr-1" />}
                  Verificar tal como están
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
  
        {/* Vista de tarjetas apiladas: TODO lo que no llega a 1024 px.
            El corte está en `lg` y no en `sm` porque lo que manda no es el
            ancho de la ventana sino el de la columna de contenido: el menú
            lateral aparece a 768 px y se lleva 16rem, así que entre 768 y
            1023 px al listado le quedan ~460 px — ahí una tabla de seis
            columnas no cabe de ninguna manera. A partir de 1024 px hay ~688 px
            y la tabla entra entera (ver el bloque del principio del fichero).
            Con alto medido, las tarjetas se desplazan por dentro, como las filas
            de la tabla (y como el kanban de Hoy en el móvil). */}
        <div
          ref={tarjetasRef}
          className={cn("space-y-3 lg:hidden", medida && "min-h-0 flex-1 overflow-y-auto overscroll-contain")}
        >
          {filas.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8 text-muted-foreground">
                {textoListaVacia}
              </CardContent>
            </Card>
          ) : (
            filasPagina.map((fila) => fila.tipo === "solicitud" ? (
              solicitudesState && (
                <SolicitudCard
                  key={fila.id}
                  solicitud={fila.solicitud}
                  onUpdateEstado={solicitudesState.updateEstado}
                  onUpdateNotas={solicitudesState.updateNotasInternas}
                  onConvertir={canEdit ? (s) => abrirConversion(s) : undefined}
                  onGestionarPropuesta={canEdit ? (s) => setSolicitudGestionId(s.id) : undefined}
                  soloLectura={!canEdit}
                />
              )
            ) : (() => { const reservation = fila.reserva; const al = alPulsar(reservation); return (
              <Card
                key={reservation.id}
                className={cn((reservation as { importante?: boolean | null }).importante && "bg-amber-50/60 dark:bg-amber-950/20", canEdit && "cursor-pointer")}
                onClick={canEdit ? alTocarFila(al.editar) : undefined}
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CasillaAceptarEnBloque
                        reserva={reservation}
                        canEdit={canEdit}
                        marcada={seleccionadas.has(reservation.id)}
                        onCambiar={al.seleccionar}
                        className="shrink-0"
                      />
                      <EstrellaImportante reserva={reservation} canEdit={canEdit} variante="tarjeta" onClick={al.importante} />
                      <span className="text-lg font-semibold">{reservation.nombre || "Sin nombre"}</span>
                    </div>
                    <InsigniaEstado estado={reservation.estado} />
                    <EtiquetaFuera reserva={reservation as never} compacta />
                    <InsigniaMenuDelDia reserva={reservation as { menu_del_dia?: boolean | null }} />
                    <InsigniaMenuCerrado reserva={reservation as { menu_cerrado?: boolean | null; menu_precio?: number | string | null }} />
                    <InsigniaZona reserva={reservation as { zona_preferida?: string | null }} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-muted-foreground">
                    <span>{new Date(reservation.fecha).toLocaleDateString("es-ES")}</span>
                    <span className="font-medium text-foreground tabular-nums">{reservation.hora?.slice(0, 5)}</span>
                    <span className="flex items-center gap-1 tabular-nums"><Users className="h-4 w-4" />{reservation.numero_comensales}</span>
                    {getCanalBadge(reservation.canal, true)}
                  </div>
                  {reservation.telefono && (
                    <p className="text-base text-muted-foreground flex items-center gap-1">
                      <Phone className="h-4 w-4" />{reservation.telefono}
                    </p>
                  )}
                  {/* El mismo juego de acciones y en el mismo orden que en la
                      tabla, para no tener que reaprenderlo al cambiar de
                      pantalla. La casilla de selección no se repite aquí: ya
                      está arriba, junto al nombre. */}
                  <AccionesReserva
                    variante="tarjeta"
                    reserva={reservation}
                    canEdit={canEdit}
                    al={al}
                    ocupada={acciones.estaEnCurso(reservation.id)}
                    bloqueEnCurso={aceptandoBloque}
                    nombreSala={nombreSalaDe(reservation)}
                    onAsignarMesa={onAsignarMesa}
                  />
                </CardContent>
              </Card>
            ); })())
          )}
        </div>
  
        {/* Desktop table view.
            El contenedor de scroll es el `div` que el primitivo `Table` pone
            alrededor de la tabla; su alto se fija desde aquí con `[&>div]:…`
            para no tocar `ui/table.tsx` (compartido). Con el alto acotado, ese
            div es el único "scrollport" de la tabla, y eso es lo que hace que
            funcionen a la vez la cabecera pegajosa (`top-0`) y la columna de
            acciones pegajosa (`left-0`).
  
            Ojo: si algún día hubiera scroll horizontal, se queda AQUÍ dentro. No
            subir nunca un `overflow-x-hidden` a los layouts — ya rompió
            `position: sticky` en toda la app; en los layouts va `min-w-0`. */}
        <Card className={cn("hidden overflow-hidden lg:block", medida && "min-h-0 flex-1")}>
          {/* Con alto medido, la tarjeta se queda con lo que dejan la barra de
              selección y la paginación, y la tabla la llena (`h-full`). Sin
              medida, el tope de siempre. */}
          <CardContent
            ref={contenedorTablaRef}
            className={cn("p-0", medida ? "h-full [&>div]:h-full" : "[&>div]:max-h-[calc(100vh-17rem)]")}
          >
            {/* Sin `min-w` y con reparto FIJO (`table-fixed`): la tabla nunca es
                más ancha que su contenedor; cada columna mide su `ANCHO_*` y
                Cliente, lo que sobra (ver «CERO scroll horizontal» al principio
                del fichero). El nombre accesible sustituye al título que había
                encima («Todas las reservas y solicitudes», quitado el 2026-10-06). */}
            <Table aria-label="Reservas y solicitudes" className="table-fixed text-lg">
              <TableHeader className="sticky top-0 z-20">
                <TableRow className="hover:bg-transparent">
                  {/* Cabecera SIN título (2026-09-26, petición del dueño). Lo
                      único que lleva es la casilla de "seleccionar todas"; el
                      nombre de la columna vive en `aria-label`, que los lectores
                      de pantalla sí anuncian y no ocupa ancho. */}
                  {/* Solo «Ver» (06/11/2026): sin permiso de edición no hay ninguna acción que pintar,
                      así que la columna entera desaparece y su ancho se lo queda Cliente. */}
                  {canEdit && (
                    <TableHead
                      aria-label="Acciones"
                      className={cn("sticky left-0 z-30 h-12 border-r border-border/60 bg-card", anchoAcciones, CELDA)}
                    >
                      <RanuraSeleccion>
                        <Checkbox
                          checked={pendientesVisibles().length > 0 && pendientesVisibles().every((r) => seleccionadas.has(r.id))}
                          onCheckedChange={toggleSeleccionarTodasPendientes}
                          disabled={pendientesVisibles().length === 0}
                          aria-label="Seleccionar todas las pendientes visibles"
                        />
                      </RanuraSeleccion>
                    </TableHead>
                  )}
                  <TableHead className={cn("h-12 bg-card text-base", ANCHO_FECHA, CELDA)}>
                    <span className="whitespace-nowrap">Fecha y hora</span>
                  </TableHead>
                  {/* Cliente SIN ancho: en una tabla `table-fixed` se queda con lo que dejan las demás. */}
                  <TableHead className={cn("h-12 bg-card text-base", CELDA)}>Cliente</TableHead>
                  <TableHead className={cn("h-12 bg-card text-base", ANCHO_PAX, CELDA)} title="Comensales">Pax</TableHead>
                  <TableHead className={cn("h-12 bg-card text-base", ANCHO_ESTADO, CELDA)}>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 5 : 4} className="py-10 text-center text-lg text-muted-foreground">
                      {textoListaVacia}
                    </TableCell>
                  </TableRow>
                ) : (
                  filasPagina.map((fila) => fila.tipo === "solicitud" ? (
                    <FilaSolicitud
                      key={fila.id}
                      solicitud={fila.solicitud}
                      anchoAcciones={anchoAcciones}
                      canEdit={canEdit}
                      onConvertir={() => abrirConversion(fila.solicitud)}
                      onGestionar={() => setSolicitudGestionId(fila.solicitud.id)}
                    />
                  ) : (() => {
                    const reservation = fila.reserva;
                    const importante = !!(reservation as any).importante;
                    const fondo = importante ? FONDOS.destacada : FONDOS.normal;
                    const nombre = reservation.nombre || "Sin nombre";
                    const al = alPulsar(reservation);
                    return (
                    <TableRow
                      key={reservation.id}
                      className={cn("group", ALTO_FILA, fondo.fila, canEdit && "cursor-pointer")}
                      onClick={canEdit ? alTocarFila(al.editar) : undefined}
                    >
                      {/* Acciones PRIMERO (2026-09-26, petición del dueño). El
                          juego de acciones es el mismo en todas las filas; lo
                          que no aplica va deshabilitado, nunca se quita. Sin
                          permiso de edición no hay columna (06/11/2026). */}
                      {canEdit && (
                        <CeldaAcciones fondo={fondo.acciones} ancho={anchoAcciones}>
                          <AccionesReserva
                            variante="fila"
                            reserva={reservation}
                            canEdit={canEdit}
                            al={al}
                            ocupada={acciones.estaEnCurso(reservation.id)}
                            bloqueEnCurso={aceptandoBloque}
                            seleccionada={seleccionadas.has(reservation.id)}
                            nombreSala={nombreSalaDe(reservation)}
                            onAsignarMesa={onAsignarMesa}
                          />
                        </CeldaAcciones>
                      )}
                      {/* Fecha y hora juntas: dos columnas para esto gastaban
                          ancho que hacía falta para las acciones. */}
                      <CeldaFechaHora dia={new Date(reservation.fecha)} hora={reservation.hora} />
                      <TableCell className={CELDA}>
                        <div className="flex items-center gap-3">
                          <EstrellaImportante reserva={reservation} canEdit={canEdit} variante="fila" onClick={al.importante} />
                          <div className={cn(ANCHO_NOMBRE, "space-y-1")}>
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="min-w-0 break-words text-xl font-semibold leading-tight" title={nombre}>{nombre}</p>
                              <InsigniaMenuDelDia reserva={reservation as { menu_del_dia?: boolean | null }} className="hidden px-2 py-0.5 text-sm xl:inline-flex" />
                              <InsigniaMenuCerrado reserva={reservation as { menu_cerrado?: boolean | null; menu_precio?: number | string | null }} className="hidden px-2 py-0.5 text-sm xl:inline-flex" />
                              <InsigniaZona reserva={reservation as { zona_preferida?: string | null }} className="hidden px-2 py-0.5 text-sm xl:inline-flex" />
                            </div>
                            {reservation.telefono && (
                              <p className="whitespace-nowrap text-base leading-tight text-muted-foreground tabular-nums" title={reservation.telefono}>
                                {telefonoEnGrupos(reservation.telefono)}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={cn(CELDA, ANCHO_PAX)}>
                        <div className="flex items-center gap-1.5 font-semibold tabular-nums" title={`${reservation.numero_comensales} comensales`}>
                          <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
                          {reservation.numero_comensales}
                        </div>
                      </TableCell>
                      <TableCell className={cn(CELDA, ANCHO_ESTADO)}>
                        <InsigniaEstado estado={reservation.estado} />
                        {/* «Sentar fuera» (10/11/2026): dónde se sentó, fuera de las salas (nada si está dentro). */}
                        <EtiquetaFuera reserva={reservation as never} compacta className="mt-1 flex w-fit" />
                      </TableCell>
                    </TableRow>
                  ); })())
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
  
        {/* Paginación. Vale para las dos vistas (tarjetas en móvil, tabla en
            escritorio). Las solicitudes abiertas se ordenan las primeras, así
            que el trabajo pendiente sigue cayendo siempre en la página 1. */}
        {hayPaginacion && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-sm text-muted-foreground">
              Mostrando{" "}
              <span className="font-medium text-foreground tabular-nums">
                {primeraDeLaPagina + 1}–{primeraDeLaPagina + filasPagina.length}
              </span>{" "}
              de <span className="tabular-nums">{filas.length}</span>
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={paginaActual === 1}
                onClick={() => irAPagina(paginaActual - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">
                Página {paginaActual} de {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={paginaActual === totalPaginas}
                onClick={() => irAPagina(paginaActual + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>

      <ModalVerificacionReserva
        reserva={selectedReservaForVerification}
        open={verificacionModalOpen}
        onOpenChange={setVerificacionModalOpen}
        onSuccess={fetchReservations}
      />

      {/* Editor de una reserva (cuarta ranura de cada fila): al guardar refresca
          por sí solo la lista y el resto de pantallas (`CLAVES_POR_CAMBIO.ocupacion`
          de `clavesCache.ts`, ver `FormularioReserva`). Es `null` hasta que se pide editar. */}
      {dialogoEdicion}

      <DialogoAccionReserva
        reserva={dialogoAccion?.reserva ?? null}
        accion={dialogoAccion?.accion ?? null}
        nombreSala={dialogoAccion ? nombreSalaDe(dialogoAccion.reserva) : null}
        onAccion={dialogoAccion && canEdit ? () => ejecutarAccion(dialogoAccion.reserva, dialogoAccion.accion) : undefined}
        onEditar={dialogoAccion && canEdit ? () => editarReserva(dialogoAccion.reserva.id) : undefined}
        onElegirHora={
          dialogoAccion && canEdit && dialogoAccion.accion === "aceptar"
            ? () => ejecutarAccion(dialogoAccion.reserva, "verificar")
            : undefined
        }
        onCerrar={() => setDialogoAccion(null)}
      />

      {/* Lista negra: NO necesita AlertDialog propio. `BlacklistModal` ya es
          en sí mismo una confirmación —enseña de quién se trata, pide el
          motivo y hay que pulsar "Añadir a Lista Negra"—, así que abrirlo no
          mete a nadie en la lista. Además es un componente compartido
          (GestionBlacklist, SugerenciasBlacklist) y no se toca desde aquí. */}
      <BlacklistModal
        reserva={blacklistReserva}
        open={!!blacklistReserva}
        onOpenChange={(open) => { if (!open) setBlacklistReserva(null); }}
      />

      {/* Confirmación de cancelación (2026-09-26, petición del dueño: "si
          cancelo una reserva debe pedir confirmación"). El diálogo dice de QUÉ
          reserva se trata —nombre, día, hora y comensales— para que no se
          cancele la de al lado. Cerrarlo o pulsar "No, volver" no cancela
          nada: la reserva solo cambia de estado desde `confirmarCancelacion`. */}
      <AlertDialog open={!!reservaACancelar} onOpenChange={(open) => { if (!open) setReservaACancelar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Cancelar la reserva de {reservaACancelar?.nombre || "este cliente"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reservaACancelar && (
                <span className="block font-medium text-foreground">
                  {new Date(reservaACancelar.fecha).toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  {" a las "}
                  {String(reservaACancelar.hora ?? "").substring(0, 5)}
                  {" · "}
                  {reservaACancelar.numero_comensales} comensales
                  {reservaACancelar.telefono ? ` · ${reservaACancelar.telefono}` : ""}
                </span>
              )}
              <span className="mt-2 block">
                Pasará a estado «cancelada» y se enviará el aviso de cambio al cliente. Para recuperarla habría
                que volver a cambiarle el estado a mano.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, volver</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmarCancelacion();
              }}
            >
              Sí, cancelar la reserva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mismo criterio para aceptar en bloque: escribe en N reservas de una
          vez y dispara N avisos al cliente, y eso no se deshace con otro clic. */}
      <AlertDialog open={confirmarBloque} onOpenChange={(open) => { if (!open) setConfirmarBloque(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Verificar {seleccionadas.size} reserva{seleccionadas.size === 1 ? " tal como está" : "s tal como están"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se verificarán sin abrir ninguna ficha, tal como están ahora (con el día y la hora que tienen), y
              se le enviará a cada uno el correo para que confirme. La sala no se toca: se asigna por dentro y el
              cliente no la ve. Para echarse atrás habría que cambiarlas una a una.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleAceptarSeleccionadas();
              }}
            >
              Sí, aceptar {seleccionadas.size === 1 ? "la reserva" : "las reservas"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Convertir una solicitud del bot en reserva: alta manual prerrellenada;
          al crearla, la solicitud pasa a "resuelta". */}
      <Dialog open={!!solicitudAConvertir} onOpenChange={(open) => { if (!open) { setSolicitudAConvertir(null); setPropuestaConversion(null); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convertir solicitud en reserva</DialogTitle>
            <DialogDescription>
              {propuestaConversion
                ? "Datos de la solicitud con los cambios que has propuesto (día, hora, comensales y sala). Revísalos: al crear la reserva, la solicitud se marcará como resuelta."
                : "Datos tomados de la solicitud que dejó el cliente por teléfono. Revísalos: al crear la reserva, la solicitud se marcará como resuelta."}
            </DialogDescription>
          </DialogHeader>
          {solicitudAConvertir && (
            <FormularioReserva
              datosPreseleccionados={datosConversion}
              onSuccess={handleReservaDesdeSolicitudCreada}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Gestión completa de una solicitud (notas internas, contactado,
          resuelta, descartar…) desde la tabla de escritorio. */}
      <Dialog open={!!solicitudGestion} onOpenChange={(open) => { if (!open) setSolicitudGestionId(null); }}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Solicitud pendiente del bot</DialogTitle>
            <DialogDescription>
              El asistente telefónico no pudo cerrar esta reserva. Ajusta día, hora, comensales y sala mirando la ocupación y envía la propuesta al cliente; cuando la acepte, se crea la reserva.
            </DialogDescription>
          </DialogHeader>
          {/* Solo con permiso de edición: el panel es para gestionar (notas, estado, propuesta). */}
          {solicitudGestion && solicitudesState && canEdit && (
            <SolicitudGestionPanel
              key={solicitudGestion.id}
              solicitud={solicitudGestion}
              onUpdateEstado={solicitudesState.updateEstado}
              onUpdateNotas={solicitudesState.updateNotasInternas}
              onGuardarPropuesta={(id, cambios, opciones) => solicitudesState.updatePropuesta(id, cambios, opciones)}
              onConvertir={canEdit ? (s, propuesta) => { setSolicitudGestionId(null); abrirConversion(s, propuesta); } : undefined}
              onEnviarPropuesta={canEdit ? solicitudesState.enviarPropuesta : undefined}
              onAceptarTelefono={
                canEdit
                  ? async (id, contacto) => {
                      const res = await solicitudesState.aceptarPropuestaTelefono(id, contacto);
                      if (res.ok) refrescarReservas();
                      return res;
                    }
                  : undefined
              }
              onRechazarTelefono={canEdit ? solicitudesState.rechazarPropuestaTelefono : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Fila de la tabla (escritorio) para una solicitud pendiente del bot. */
function FilaSolicitud({
  solicitud,
  anchoAcciones,
  canEdit,
  onConvertir,
  onGestionar,
}: {
  solicitud: SolicitudPendiente;
  anchoAcciones: string;
  canEdit: boolean;
  onConvertir: () => void;
  onGestionar: () => void;
}) {
  const motivo = MOTIVO_LABELS[solicitud.motivo_rechazo] || MOTIVO_LABELS.otro;
  const abierta = esSolicitudAbierta(solicitud.estado);
  const estadoLabel = ESTADO_LABELS[solicitud.estado]?.label || solicitud.estado;
  const vistaPropuesta = estadoPropuestaVista(solicitud, format(new Date(), "yyyy-MM-dd"));
  const nombre = solicitud.nombre || "Sin nombre";
  // El motivo y el porqué concreto del bot son información secundaria: se
  // resumen en la insignia pequeña y el texto completo va en el `title` (y
  // sin recortar en "Gestionar"). Antes ocupaban una línea propia por fila.
  const motivoTitulo = solicitud.descripcion_rechazo
    ? `${motivo.label} — ${solicitud.descripcion_rechazo}`
    : motivo.label;
  const enviadaAt = (solicitud as { propuesta_enviada_at?: string | null }).propuesta_enviada_at;
  const hayPropuesta = !!vistaPropuesta && vistaPropuesta.clave !== "borrador";
  return (
    // Franja ámbar a la izquierda (ahora en la celda de acciones, ver
    // `CeldaAcciones`) + fondo cálido + insignia "Solicitud · …" en Estado:
    // una solicitud NO es una reserva (otra tabla, otro ciclo de vida) y tiene
    // que notarse de un vistazo aunque compartan lista.
    <TableRow
      className={cn(
        "group",
        ALTO_FILA,
        FONDOS.destacada.fila,
        !abierta && "opacity-70",
        canEdit && "cursor-pointer",
      )}
      onClick={canEdit ? alTocarFila(onGestionar) : undefined}
    >
      {/* Mismas ranuras que una fila de reserva (el mismo molde,
          `RanurasDeAcciones`) y en el mismo orden: lo que una solicitud no
          puede hacer (dar mesa, verificar, cancelar, lista negra) sale
          deshabilitado, no desaparece. Sin permiso de edición, ni la columna
          (06/11/2026: solo «Ver» no gestiona solicitudes). */}
      {canEdit && (
        <CeldaAcciones franja fondo={FONDOS.destacada.acciones} ancho={anchoAcciones}>
          <RanurasDeAcciones
            seleccion={null}
            principal={{
              etiqueta: "Convertir",
              titulo: abierta
                ? "Convertir la solicitud en una reserva"
                : `La solicitud ya está ${estadoLabel.toLowerCase()}`,
              icono: <CalendarPlus />,
              onClick: abierta ? onConvertir : undefined,
            }}
            darMesa={DAR_MESA_SOLICITUD}
            verificar={{ titulo: "Verificar: solo para reservas" }}
            gestionar={{
              titulo: "Gestionar: propuesta al cliente, salas y notas",
              onClick: onGestionar,
            }}
            cancelar={{ titulo: "Descartar la solicitud: se hace desde «Gestionar»" }}
            listaNegra={{ titulo: "Lista negra: solo para reservas" }}
            nombre={nombre}
          />
        </CeldaAcciones>
      )}
      <CeldaFechaHora
        dia={solicitud.fecha_solicitada ? new Date(`${solicitud.fecha_solicitada}T12:00:00`) : null}
        hora={solicitud.hora_solicitada}
      />
      <TableCell className={CELDA}>
        <div className={ANCHO_NOMBRE}>
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="min-w-0 break-words text-xl font-semibold leading-tight" title={nombre}>{nombre}</p>
          </div>
          {solicitud.telefono && (
            <a
              href={`tel:${solicitud.telefono}`}
              title={solicitud.telefono}
              className="mt-1 block whitespace-nowrap text-base leading-tight text-muted-foreground tabular-nums hover:underline"
            >
              {telefonoEnGrupos(solicitud.telefono)}
            </a>
          )}
        </div>
      </TableCell>
      <TableCell className={cn(CELDA, ANCHO_PAX)}>
        {solicitud.numero_comensales ? (
          <div className="flex items-center gap-1.5 font-semibold tabular-nums" title={`${solicitud.numero_comensales} comensales`}>
            <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
            {solicitud.numero_comensales}
          </div>
        ) : "—"}
      </TableCell>
      <TableCell className={cn(CELDA, ANCHO_ESTADO)}>
        <div className="flex min-w-0 flex-col items-start gap-1">
          {/* El `title` explica qué es una «Solicitud» (lo decía el subtítulo de la pestaña, quitado el 2026-10-06). */}
          <Badge className={cn(INSIGNIA, "bg-amber-500 text-white")} title={TITULO_SOLICITUD}>
            <Inbox className="h-3 w-3" />
            Solicitud<span className="hidden xl:inline"> · {estadoLabel}</span>
          </Badge>
          <div className="flex min-w-0 items-center gap-1">
            {hayPropuesta && (
              <span className="shrink-0" title={`${vistaPropuesta.etiqueta} — ${vistaPropuesta.detalle}`}>
                <EstadoPropuestaBadge
                  vista={{ ...vistaPropuesta, etiqueta: etiquetaPropuestaCorta(vistaPropuesta, enviadaAt) }}
                  className={INSIGNIA_SECUNDARIA}
                />
              </span>
            )}
            {/* Nada de `truncate` aquí: una insignia a medias ("Grupo g…") es
                justo lo que el dueño rechazó. Si ya hay insignia de propuesta,
                las dos juntas no caben por debajo de 1280 px, así que el motivo
                se esconde ahí (sigue en el `title` y entero en «Gestionar»). */}
            <Badge
              className={cn(INSIGNIA_SECUNDARIA, motivo.color, hayPropuesta && "hidden xl:inline-flex")}
              title={motivoTitulo}
            >
              {motivo.label}
            </Badge>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
