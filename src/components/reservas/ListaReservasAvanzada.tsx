import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
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
import {
  espacioUnicoDeNegocio,
  FILTRO_NEGOCIO_TODOS,
  marcaDeReserva,
  marcaDeSolicitud,
  NEGOCIOS_PANEL,
} from "@/lib/reservas/negocios";
import { NegocioBadge } from "./NegocioBadge";
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
} from "lucide-react";
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
import type { SolicitudPendiente, useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { SolicitudCard, MOTIVO_LABELS, ESTADO_LABELS } from "./GestionSolicitudes";
import { FormularioReserva, type ReservaCreadaDesdeFormulario } from "./FormularioReserva";
import { SolicitudGestionPanel } from "./SolicitudGestionPanel";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { EstadoPropuestaBadge } from "./EstadoPropuestaBadge";
import {
  estadoPropuestaVista,
  fechaHoraCorta,
  type EstadoPropuestaVista,
} from "@/lib/reservas/propuestaCliente";
import { actualizacionPropuesta, type PropuestaSolicitud } from "@/lib/reservas/solicitudPropuesta";
import {
  OPCIONES_FILTRO_ESTADO,
  esSolicitudAbierta,
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
  type FiltrosListaUnificada,
} from "@/lib/reservas/vistaUnificada";
// «Cómo avanza una reserva» (2026-10-01): el timeline de la pestaña Hoy, con las cifras de lo que se ve
// aquí (los filtros de la lista menos el de estado) y los estados pulsables como filtro.
import { TimelineEstadosReserva } from "./TimelineEstadosReserva";
import { alcanceCifrasDeLaLista, cifrasDeLaLista } from "@/lib/reservas/cifrasPorEstado";
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
// Y, sobre todo: CERO scroll horizontal (2026-09-26, petición del dueño)
// ---------------------------------------------------------------------------
// La tabla ya NO lleva `min-w`. Antes valía 900 px + los anchos de columna
// sumaban ~1010 px, así que por debajo de eso aparecía scroll horizontal y la
// columna de acciones (entonces `sticky right-0`, opaca) tapaba las insignias
// de Estado: de ahí los "Solicitud · Pendient" y "Grupo g" que se veían
// partidos. Medido en el navegador con las 377 filas reales, el desbordamiento
// del contenedor era de 51 px a 1280, 307 px a 1024 y 563 px a 768.
//
// Ahora el ancho MÁXIMO de la tabla es el del contenedor y lo que se ajusta es
// el contenido. El caso peor de escritorio es 1024 px de ventana: menú lateral
// (16rem) + relleno del `main` (p-6) + borde de la tarjeta + la barra de
// desplazamiento vertical del propio listado dejan ~688 px útiles. Todo cabe
// ahí porque de 1024 a 1279 px (`lg`) se aprieta:
//   · relleno de celda px-1.5 en vez de px-3;
//   · insignias a 10 px y fecha/hora apiladas en dos líneas;
//   · Canal solo con su icono (la palabra vuelve en `xl`);
//   · el motivo de la solicitud cede el sitio a la propuesta enviada.
// A partir de 1280 px (`xl`) sobra sitio y vuelve todo a tamaño cómodo.
// Por debajo de 1024 px no hay tabla: tarjetas apiladas (ver más abajo).
const ALTO_FILA = "h-14";
const CELDA = "px-1.5 py-2 align-middle xl:px-3";

/** Filas por página. Ver el comentario de "Paginación" más abajo. */
const TAMANO_PAGINA = 50;

// Insignias de la tabla: una sola línea y alto fijo. El primitivo `Badge` NO
// lleva `whitespace-nowrap` y lo comparte toda la app, así que no se toca
// ahí: sin esto "Solicitud · Pendiente" rompía en dos líneas y "Propuesta
// enviada 24/09 18:44" en tres, que es lo que hinchaba las filas.
// Los `lg:` encogen SOLO en la franja 1024–1279 px, que es donde falta sitio:
// en las tarjetas de móvil y a partir de 1280 px la insignia queda a 11 px.
const INSIGNIA =
  "h-5 shrink-0 gap-1 whitespace-nowrap px-1.5 py-0 text-[11px] font-medium lg:px-1 lg:text-[10px] xl:px-1.5 xl:text-[11px]";
/** Segunda línea del estado (motivo, propuesta): aún más compacta. */
const INSIGNIA_SECUNDARIA = "h-4 shrink-0 gap-1 whitespace-nowrap px-1 py-0 text-[10px] font-medium";

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

// Anchos de columna. La tabla reparte el espacio en automático, así que estos
// anchos son una SUGERENCIA: lo que manda de verdad es el ancho mínimo del
// contenido de cada celda. Por eso, además de estrecharlos, el contenido se
// abrevia en `lg` (ver CELDA, INSIGNIA y los `hidden xl:inline` de Canal y
// Estado). Medido con las 377 filas reales, lo que la tabla pide como mínimo
// es 653 px a 1024 px de ventana y 864 px a 1280 px, por debajo de los 688 y
// 944 px útiles de cada caso. Si se toca algo de aquí, vuelve a medirlo.
//
// 2026-09-28 · la SEXTA ranura de acciones ("Dar mesa") ensancha esta primera
// columna. Cuentas hechas a mano (medido después en Chrome, 2026-10-01, con 58
// filas de prueba: a 1024 px la tabla llena los 703 px de su contenedor SIN
// scroll horizontal y esta columna mide ~249 px; a 1366 px, ~285 px):
//   · ancho real del contenido de la celda de acciones = relleno + ranuras +
//     huecos + el borde derecho:
//       lg  12 + (16 + 76 + 5×24) + 6×2 + 1 = 237 px  (antes 211: 4 iconos)
//       xl  16 + (16 + 88 + 5×28) + 6×4 + 1 = 285 px  (antes 253)
//     o sea +26 px en `lg` y +32 px en `xl`, que es justo lo que se sube aquí
//     para conservar el mismo margen que tenía la sugerencia sobre el
//     contenido (13 px de sobra en `lg`; en `xl` la sugerencia ya iba por
//     debajo del contenido, y la tabla la estira sola).
//   · suma de anchos sugeridos a 1024 px: 250+74+120+40+40+152 = 676 px de
//     los ~688 útiles. Cabe, pero el colchón baja de 38 px a 12 px. Si al
//     medir apareciera scroll horizontal, lo siguiente que hay que apretar en
//     la franja `lg` es ANCHO_PRINCIPAL (en AccionesReserva.tsx: 76 px — ojo:
//     "Confirmar" es la etiqueta más larga y ya va justa) o el `gap-0.5` de
//     CeldaAcciones.
//     NUNCA recortar insignias ni dejar que aparezca el scroll horizontal.
const ANCHO_ACCIONES = "w-[250px] xl:w-[276px]";
const ANCHO_FECHA = "w-[74px] xl:w-[116px]";
// OJO con el `max-w` de Cliente: el nombre lleva `truncate`, o sea
// `white-space: nowrap`, y en una tabla de reparto automático eso hace que la
// columna RECLAME el ancho del nombre más largo de la página (medido: 233 px,
// que era justo lo que desbordaba). El `max-width` de la celda recorta esa
// reclamación —`min-width: 0` por dentro NO basta— pero no impide que, cuando
// sobra sitio (1456 px), el reparto le dé más: a 1456 px la columna acaba en
// ~390 px y ahí no se recorta ni un nombre.
const ANCHO_CLIENTE = "min-w-[120px] max-w-[148px] xl:max-w-[200px] 2xl:max-w-[320px]";
/** Envoltorio del nombre: ocupa lo que le deje la celda, ni más ni menos. */
const ANCHO_NOMBRE = "min-w-0 flex-1";
const ANCHO_PAX = "w-[40px] xl:w-[62px]";
const ANCHO_CANAL = "w-[40px] xl:w-[100px]";
const ANCHO_ESTADO = "w-[152px] xl:w-[190px]";

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
  franja = false,
  children,
}: {
  fondo: string;
  /** Franja ámbar de "esto es una solicitud, no una reserva". */
  franja?: boolean;
  children: ReactNode;
}) {
  return (
    <TableCell
      className={cn(
        // Relleno propio, más apretado que `CELDA`: esta columna es la más
        // ancha de todas y sus 6 ranuras no cambian de tamaño con la pantalla.
        "px-1.5 py-2 align-middle xl:px-2",
        ANCHO_ACCIONES,
        "sticky left-0 z-10 border-r border-border/60",
        // La franja va como sombra interior y NO como `border-l-4` en la fila:
        // con `border-collapse`, un borde de verdad empuja el contenido 2 px y
        // los botones de las solicitudes dejaban de caer en la misma X que los
        // de las reservas. Una sombra no ocupa sitio.
        franja && "shadow-[inset_4px_0_0_0_#fbbf24]",
        fondo,
      )}
    >
      <div className="flex items-center justify-start gap-0.5 xl:gap-1">{children}</div>
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
      <span
        className="flex flex-col text-xs leading-tight xl:flex-row xl:items-baseline xl:gap-2 xl:text-sm"
        title={`${larga} · ${hhmm}`}
      >
        <span>
          <span className="xl:hidden">{corta}</span>
          <span className="hidden xl:inline">{larga}</span>
        </span>
        <span className="font-medium">{hhmm}</span>
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
  // Alto del contenedor de la tabla. Se MIDE en caliente en vez de descontar
  // un número fijo de rem al 100vh: encima de la lista hay cabecera de
  // página, pestañas y la tarjeta de filtros, y eso cambia — la fila superior
  // de la app desapareció en escritorio, en <768px sigue habiendo una barra de
  // 48px, y los filtros se reparten en más líneas según se estrecha la
  // ventana. Midiendo la posición real del contenedor sale bien en todos esos
  // casos y no hay que recalibrar nada a mano cuando el layout vuelva a
  // cambiar.
  const contenedorTablaRef = useRef<HTMLDivElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const [altoTabla, setAltoTabla] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);
  const [verificacionModalOpen, setVerificacionModalOpen] = useState(false);
  const [selectedReservaForVerification, setSelectedReservaForVerification] = useState<Reservation | null>(null);
  const [blacklistReserva, setBlacklistReserva] = useState<Reservation | null>(null);
  // Cancelar pide confirmación (2026-09-26, petición del dueño): el botón ya no
  // cancela al primer clic, abre este diálogo con el nombre, el día y la hora
  // de la reserva para que no se cancele la equivocada. Un ÚNICO AlertDialog
  // para toda la lista: montar uno por fila serían 50 diálogos en el DOM.
  const [reservaACancelar, setReservaACancelar] = useState<Reservation | null>(null);
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
  const [dateFilter, setDateFilter] = useState<Date | undefined>(initialDateFilter);
  // Negocio: Casa Tomás / Touza · El Reservado (las dos se gestionan aquí).
  const [negocioFilter, setNegocioFilter] = useState<string>(FILTRO_NEGOCIO_TODOS);
  const { data: espaciosData } = useEspaciosReserva();
  const espacios = useMemo(() => ((espaciosData ?? []) as any[]), [espaciosData]);
  const marcaSolicitud = (s: SolicitudPendiente) => marcaDeSolicitud(s, espacios);
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
    queryFn: async () => {
      // Reservas de TODOS los negocios (Casa Tomás y Touza · El Reservado,
      // decisión del dueño 2026-09-24): cada fila lleva su insignia de negocio
      // y el filtro "Negocio" separa una de otra.
      const { data, error } = await supabase
        .from("reservas")
        .select("*")
        .order("fecha", { ascending: false })
        .order("hora", { ascending: true });
      if (error) {
        toast.error("Error al cargar reservas");
        console.error(error);
        throw error;
      }
      return (data as unknown as Reservation[]) || [];
    },
  });
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
    // Negocio de la solicitud: manda la marca guardada en la solicitud
    // (reservas-sin-salas); solo si falta se deduce de la sala propuesta o del
    // marcador de El Reservado en las notas. Si es de un negocio con una sola
    // sala (Touza), esa sala queda preseleccionada: la reserva nace de Touza,
    // con su aforo.
    const espacioElegido = p ? p.espacioId : s.espacio_propuesto_id ?? null;
    const marca = marcaDeSolicitud(
      { marca: s.marca, espacio_propuesto_id: espacioElegido, notas_cliente: s.notas_cliente },
      espacios,
    );
    return {
      fecha: fecha ? new Date(`${fecha}T12:00:00`) : undefined,
      hora: hora ? String(hora).substring(0, 5) : undefined,
      nombre: s.nombre ?? undefined,
      telefono: s.telefono ?? undefined,
      email: s.email ?? undefined,
      numero_comensales: (p ? p.comensales : s.numero_comensales) ?? undefined,
      notas_cliente: s.notas_cliente ?? undefined,
      espacio_id: espacioElegido ?? espacioUnicoDeNegocio(marca, espacios),
      marca,
      // El cliente llamó al bot: la reserva es de canal teléfono y queda
      // enlazada a su solicitud (reservas.solicitud_id).
      canal: "telefono" as const,
      solicitud_id: s.id,
    };
  }, [solicitudAConvertir, propuestaConversion, espacios]);

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
  const alPulsar = (reserva: Reservation): AlPulsar => ({
    aceptar: () => void handleAceptarUnaClic(reserva),
    confirmar: () => void acciones.confirmar(reserva),
    verificar: () => {
      setSelectedReservaForVerification(reserva);
      setVerificacionModalOpen(true);
    },
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
    const ETIQUETA_CANAL = completo ? "" : "hidden xl:inline";
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
  // Los filtros van en UN solo objeto porque los leen dos cosas a la vez: las filas que se ven y las
  // cifras de «Cómo avanza una reserva». Así no pueden desincronizarse: si mañana se añade un filtro,
  // lo usan las dos.
  const filtrosLista = useMemo<FiltrosListaUnificada>(
    () => ({
      busqueda: searchQuery,
      estado: statusFilter,
      canal: canalFilter,
      fecha: dateFilter ? format(dateFilter, "yyyy-MM-dd") : null,
      negocio: negocioFilter,
      marcaDeSolicitud: (s) => marcaDeSolicitud(s, espacios),
    }),
    [searchQuery, statusFilter, canalFilter, dateFilter, negocioFilter, espacios],
  );
  const filas = useMemo(
    () => filtrarFilasUnificadas(unificarReservasYSolicitudes(reservations, solicitudes), filtrosLista),
    [reservations, solicitudes, filtrosLista],
  );
  const filteredReservations = filas.flatMap((f) => (f.tipo === "reserva" ? [f.reserva] : []));
  const numSolicitudesVisibles = filas.length - filteredReservations.length;

  // Cifras de «Cómo avanza una reserva»: las RESERVAS de esta lista (las que ya hay cargadas, sin consulta
  // propia) con los mismos filtros que las filas PERO SIN el de estado, para que al filtrar por un estado los
  // demás sigan dando su cifra y el timeline sirva de referencia. No cuenta las solicitudes del bot ni las
  // reservas de Touza (no admite reservas, decisión del dueño: la regla es `esDeCasaTomas`, que se aplica
  // dentro de `cifrasDeLaLista` y no se repite aquí; mientras la lista siga enseñando esas filas, la tabla
  // puede tener alguna más que las cifras). La cifra de cada estado es el número de filas de Casa Tomás que
  // la lista enseña al filtrar por él. Detalle en `src/lib/reservas/cifrasPorEstado.ts`.
  const cifrasPorEstado = useMemo(() => cifrasDeLaLista(reservations, filtrosLista), [reservations, filtrosLista]);
  // Cómo se rotulan: «cifras de la lista», «…de hoy», «…del 3 oct 2026»; y avisa si hay filtro de estado.
  const alcanceCifras = useMemo(
    () => alcanceCifrasDeLaLista({ fecha: dateFilter, filtroDeEstado: statusFilter !== "all" }),
    [dateFilter, statusFilter],
  );

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
  // La barra de "N solicitudes seleccionadas" empuja la tabla ~78px hacia abajo.
  const barraSeleccionVisible = canEdit && seleccionadas.size > 0;

  // Al cambiar cualquier filtro se vuelve a la primera página: si no, filtrar
  // desde la página 7 dejaba la lista en blanco.
  useEffect(() => {
    setPagina(1);
  }, [searchQuery, statusFilter, canalFilter, dateFilter, negocioFilter]);

  const irAPagina = (destino: number) => {
    setPagina(Math.min(Math.max(1, destino), totalPaginas));
    // Volver arriba: si no, cambias de página y sigues viendo el centro de la
    // lista anterior.
    contenedorTablaRef.current?.firstElementChild?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  useLayoutEffect(() => {
    const el = contenedorTablaRef.current;
    if (!el) return;
    const recalcular = () => {
      const rect = el.getBoundingClientRect();
      // Posición respecto al DOCUMENTO, no a la ventana: así el alto no baila
      // si la página acaba teniendo scroll propio.
      const topDocumento = rect.top + window.scrollY;
      // Hay que descontar el relleno inferior del `main` que envuelve la
      // página (`p-3 sm:p-6` en DashboardLayout); si no, la tarjeta se pasa de
      // largo y sale una barra de scroll de la página de unos pocos píxeles.
      const main = el.closest("main");
      const relleno = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      // Y lo que quede por DEBAJO de la tabla dentro del componente (la barra
      // de paginación y su separación). Se mide en vez de darlo por sabido,
      // así aparecer/desaparecer no descuadra nada.
      const raiz = raizRef.current?.getBoundingClientRect();
      const debajo = raiz ? Math.max(0, raiz.bottom - rect.bottom) : 0;
      // −2px del borde de la tarjeta.
      const disponible = Math.round(window.innerHeight - topDocumento - relleno - debajo - 2);
      // El guard corta el bucle del ResizeObserver: al fijar el alto cambia el
      // alto del contenido, que vuelve a disparar esto con el mismo resultado.
      setAltoTabla((previo) => {
        const nuevo = Math.max(240, disponible);
        return previo === nuevo ? previo : nuevo;
      });
    };
    recalcular();
    window.addEventListener("resize", recalcular);
    // Red de seguridad para lo que cambie de alto por encima o por debajo de
    // la tabla sin pasar por el estado de este componente (p. ej. los filtros
    // repartiéndose en más líneas al estrechar). Si el navegador no lo
    // soporta, quedan `resize` y las dependencias del efecto.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(recalcular) : null;
    if (observer && raizRef.current) observer.observe(raizRef.current);
    return () => {
      window.removeEventListener("resize", recalcular);
      observer?.disconnect();
    };
    // La barra de "N seleccionadas" y la de paginación mueven el techo y el
    // suelo del contenedor: se recalcula con un render de React (determinista)
    // en vez de depender solo del ResizeObserver.
  }, [barraSeleccionVisible, hayPaginacion]);

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
    <div ref={raizRef} className="space-y-4">
      {/* Cómo avanza una reserva (2026-10-01, petición del dueño: «este timeline ponlo en la lista también»).
          Arriba de todo, como una banda de estados sobre los filtros y la tabla (el mismo patrón que las
          pestañas de estado de un listado), y plegable: la preferencia es la MISMA que la de la pestaña Hoy.
          Cifras: las reservas de ESTA lista con sus filtros menos el de estado (`cifrasPorEstado`); sin
          consulta propia. Cada estado es además un botón que activa/desactiva el filtro «Estado»: volver a
          pulsar el que está puesto lo quita («Todos»). Va dentro de `raizRef`, así que el alto de la tabla
          (que se mide en caliente) ya descuenta lo que ocupe y lo recalcula al plegarlo. */}
      <TimelineEstadosReserva
        cifras={cifrasPorEstado}
        alcance={alcanceCifras}
        estadoActivo={statusFilter}
        onElegirEstado={(estado) => setStatusFilter((actual) => (actual === estado ? "all" : estado))}
      />

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center">
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

            <div className="flex gap-2 flex-wrap">
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

              {/* Filtro de estado */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[170px] sm:w-[200px]" aria-label="Filtrar por estado">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  {OPCIONES_FILTRO_ESTADO.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Filtro de canal */}
              <Select value={canalFilter} onValueChange={setCanalFilter}>
                <SelectTrigger className="w-[120px] sm:w-[140px]">
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="telefono">📞 Tel</SelectItem>
                  <SelectItem value="web">🌐 Web</SelectItem>
                  <SelectItem value="manual">✏️ Manual</SelectItem>
                </SelectContent>
              </Select>

              {/* Filtro de negocio */}
              <Select value={negocioFilter} onValueChange={setNegocioFilter}>
                <SelectTrigger className="w-[150px] sm:w-[190px]" aria-label="Filtrar por negocio">
                  <SelectValue placeholder="Negocio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTRO_NEGOCIO_TODOS}>Todos los negocios</SelectItem>
                  {NEGOCIOS_PANEL.map((n) => (
                    <SelectItem key={n.marca} value={n.marca}>
                      {n.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Contador de resultados */}
            <Badge variant="secondary" className="self-center sm:ml-auto">
              {filteredReservations.length} reservas
              {numSolicitudesVisibles > 0 && ` · ${numSolicitudesVisibles} solicitud${numSolicitudesVisibles === 1 ? "" : "es"}`}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Barra de acción en bloque — aceptar varias solicitudes pendientes a
          la vez sin abrir una ficha por cada una. Solo con permiso de edición. */}
      {canEdit && seleccionadas.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
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
          y la tabla entra entera (ver el bloque del principio del fichero). */}
      <div className="lg:hidden space-y-3">
        {filas.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-muted-foreground">
              No se encontraron reservas con los filtros aplicados
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
                onGestionarPropuesta={(s) => setSolicitudGestionId(s.id)}
                marca={marcaSolicitud(fila.solicitud)}
              />
            )
          ) : (() => { const reservation = fila.reserva; const al = alPulsar(reservation); return (
            <Card key={reservation.id} className={(reservation as any).importante ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
              <CardContent className="p-3 space-y-2">
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
                    <span className="font-medium text-sm">{reservation.nombre || "Sin nombre"}</span>
                  </div>
                  <InsigniaEstado estado={reservation.estado} />
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{new Date(reservation.fecha).toLocaleDateString("es-ES")}</span>
                  <span>{reservation.hora}</span>
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{reservation.numero_comensales}</span>
                  {getCanalBadge(reservation.canal, true)}
                  <NegocioBadge marca={marcaDeReserva(reservation)} corta />
                </div>
                {reservation.telefono && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" />{reservation.telefono}
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
          alrededor de la tabla; se le limita el alto desde aquí con
          `[&>div]:max-h-…` para no tocar `ui/table.tsx` (compartido). Con el
          alto acotado, ese div es el único "scrollport" de la tabla, y eso es
          lo que hace que funcionen a la vez la cabecera pegajosa (`top-0`) y
          la columna de acciones pegajosa (`right-0`).

          Ojo: el scroll horizontal se queda AQUÍ dentro. No subir nunca un
          `overflow-x-hidden` a los layouts — ya rompió `position: sticky` en
          toda la app; en los layouts va `min-w-0`. */}
      <Card className="hidden overflow-hidden lg:block">
        {/* El alto llega como variable CSS porque hay que aplicarlo al `div`
            que envuelve la tabla, que lo pinta el primitivo compartido. El
            `calc()` es solo el valor de arranque, hasta que el efecto mide. */}
        <CardContent
          ref={contenedorTablaRef}
          className="p-0 [&>div]:max-h-[var(--alto-lista)] [&>div]:min-h-[16rem]"
          style={{ "--alto-lista": altoTabla ? `${altoTabla}px` : "calc(100vh - 17rem)" } as CSSProperties}
        >
          {/* Sin `min-w`: la tabla nunca es más ancha que su contenedor. Lo
              que se aprieta es el contenido (ver el bloque de "CERO scroll
              horizontal" al principio del fichero). */}
          <Table className="text-xs xl:text-sm">
            <TableHeader className="sticky top-0 z-20">
              <TableRow className="hover:bg-transparent">
                {/* Cabecera SIN título (2026-09-26, petición del dueño). Lo
                    único que lleva es la casilla de "seleccionar todas"; el
                    nombre de la columna vive en `aria-label`, que los lectores
                    de pantalla sí anuncian y no ocupa ancho. */}
                <TableHead
                  aria-label="Acciones"
                  className={cn("sticky left-0 z-30 h-10 border-r border-border/60 bg-card", ANCHO_ACCIONES, CELDA)}
                >
                  {canEdit && (
                    <RanuraSeleccion>
                      <Checkbox
                        checked={pendientesVisibles().length > 0 && pendientesVisibles().every((r) => seleccionadas.has(r.id))}
                        onCheckedChange={toggleSeleccionarTodasPendientes}
                        disabled={pendientesVisibles().length === 0}
                        aria-label="Seleccionar todas las pendientes visibles"
                      />
                    </RanuraSeleccion>
                  )}
                </TableHead>
                <TableHead className={cn("h-10 bg-card", ANCHO_FECHA, CELDA)}>
                  Fecha<span className="hidden xl:inline"> y hora</span>
                </TableHead>
                <TableHead className={cn("h-10 bg-card", ANCHO_CLIENTE, CELDA)}>Cliente</TableHead>
                <TableHead className={cn("h-10 bg-card", ANCHO_PAX, CELDA)} title="Comensales">Pax</TableHead>
                <TableHead className={cn("h-10 bg-card", ANCHO_CANAL, CELDA)}>Canal</TableHead>
                <TableHead className={cn("h-10 bg-card", ANCHO_ESTADO, CELDA)}>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No se encontraron reservas con los filtros aplicados
                  </TableCell>
                </TableRow>
              ) : (
                filasPagina.map((fila) => fila.tipo === "solicitud" ? (
                  <FilaSolicitud
                    key={fila.id}
                    solicitud={fila.solicitud}
                    canEdit={canEdit}
                    onConvertir={() => abrirConversion(fila.solicitud)}
                    onGestionar={() => setSolicitudGestionId(fila.solicitud.id)}
                    marca={marcaSolicitud(fila.solicitud)}
                  />
                ) : (() => {
                  const reservation = fila.reserva;
                  const importante = !!(reservation as any).importante;
                  const fondo = importante ? FONDOS.destacada : FONDOS.normal;
                  const nombre = reservation.nombre || "Sin nombre";
                  const al = alPulsar(reservation);
                  return (
                  <TableRow key={reservation.id} className={cn("group", ALTO_FILA, fondo.fila)}>
                    {/* Acciones PRIMERO (2026-09-26, petición del dueño). El
                        juego de acciones es el mismo en todas las filas; lo
                        que no aplica va deshabilitado, nunca se quita. */}
                    <CeldaAcciones fondo={fondo.acciones}>
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
                    {/* Fecha y hora juntas: dos columnas para esto gastaban
                        ancho que hacía falta para las acciones. */}
                    <CeldaFechaHora dia={new Date(reservation.fecha)} hora={reservation.hora} />
                    <TableCell className={cn(CELDA, ANCHO_CLIENTE)}>
                      <div className="flex items-center gap-1.5">
                        <EstrellaImportante reserva={reservation} canEdit={canEdit} variante="fila" onClick={al.importante} />
                        <div className={ANCHO_NOMBRE}>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate font-medium leading-tight" title={nombre}>{nombre}</p>
                            <NegocioBadge marca={marcaDeReserva(reservation)} corta />
                          </div>
                          {reservation.telefono && (
                            <p className="truncate text-[11px] leading-tight text-muted-foreground xl:text-xs" title={reservation.telefono}>
                              {reservation.telefono}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn(CELDA, ANCHO_PAX)}>
                      <div className="flex items-center gap-0.5 tabular-nums xl:gap-1" title={`${reservation.numero_comensales} comensales`}>
                        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {reservation.numero_comensales}
                      </div>
                    </TableCell>
                    <TableCell className={cn(CELDA, ANCHO_CANAL)}>{getCanalBadge(reservation.canal)}</TableCell>
                    <TableCell className={cn(CELDA, ANCHO_ESTADO)}>
                      <InsigniaEstado estado={reservation.estado} />
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-sm text-muted-foreground">
            Mostrando{" "}
            <span className="font-medium text-foreground tabular-nums">
              {primeraDeLaPagina + 1}–{primeraDeLaPagina + filasPagina.length}
            </span>{" "}
            de <span className="tabular-nums">{filas.length}</span>
          </p>
          <div className="flex items-center gap-2">
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
          {solicitudGestion && solicitudesState && (
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
  canEdit,
  onConvertir,
  onGestionar,
  marca,
}: {
  solicitud: SolicitudPendiente;
  canEdit: boolean;
  onConvertir: () => void;
  onGestionar: () => void;
  marca: string;
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
      )}
    >
      {/* Mismas ranuras que una fila de reserva (el mismo molde,
          `RanurasDeAcciones`) y en el mismo orden: lo que una solicitud no
          puede hacer (dar mesa, verificar, cancelar, lista negra) sale
          deshabilitado, no desaparece. */}
      <CeldaAcciones franja fondo={FONDOS.destacada.acciones}>
        <RanurasDeAcciones
          seleccion={canEdit ? null : undefined}
          principal={{
            etiqueta: "Convertir",
            titulo: canEdit
              ? abierta
                ? "Convertir la solicitud en una reserva"
                : `La solicitud ya está ${estadoLabel.toLowerCase()}`
              : "No tienes permiso para editar reservas",
            icono: <CalendarPlus />,
            onClick: canEdit && abierta ? onConvertir : undefined,
          }}
          darMesa={DAR_MESA_SOLICITUD}
          verificar={{ titulo: "Verificar: solo para reservas" }}
          gestionar={{
            titulo: "Gestionar: propuesta al cliente, salas y notas",
            onClick: onGestionar,
          }}
          cancelar={{ titulo: "Descartar la solicitud: se hace desde «Gestionar»" }}
          listaNegra={{ titulo: "Lista negra: solo para reservas" }}
        />
      </CeldaAcciones>
      <CeldaFechaHora
        dia={solicitud.fecha_solicitada ? new Date(`${solicitud.fecha_solicitada}T12:00:00`) : null}
        hora={solicitud.hora_solicitada}
      />
      <TableCell className={cn(CELDA, ANCHO_CLIENTE)}>
        <div className={ANCHO_NOMBRE}>
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate font-medium leading-tight" title={nombre}>{nombre}</p>
            <NegocioBadge marca={marca} corta />
          </div>
          {solicitud.telefono && (
            <a
              href={`tel:${solicitud.telefono}`}
              title={solicitud.telefono}
              className="block truncate text-[11px] leading-tight text-muted-foreground hover:underline xl:text-xs"
            >
              {solicitud.telefono}
            </a>
          )}
        </div>
      </TableCell>
      <TableCell className={cn(CELDA, ANCHO_PAX)}>
        {solicitud.numero_comensales ? (
          <div className="flex items-center gap-0.5 tabular-nums xl:gap-1" title={`${solicitud.numero_comensales} comensales`}>
            <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {solicitud.numero_comensales}
          </div>
        ) : "—"}
      </TableCell>
      <TableCell className={cn(CELDA, ANCHO_CANAL)}>
        <Badge title="Canal: asistente telefónico" className={cn(INSIGNIA, "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300")}>
          <Phone className="h-3 w-3" />
          <span className="hidden xl:inline">Bot</span>
        </Badge>
      </TableCell>
      <TableCell className={cn(CELDA, ANCHO_ESTADO)}>
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <Badge className={cn(INSIGNIA, "bg-amber-500 text-white")}>
            <Inbox className="h-3 w-3" />
            Solicitud · {estadoLabel}
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
