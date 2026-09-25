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
  CheckCircle,
  CheckCheck,
  XCircle,
  Clock,
  Search,
  Users,
  Calendar,
  Loader2,
  ShieldBan,
  Star,
  Phone,
  Globe,
  Pencil,
  UserX,
  Inbox,
  CalendarPlus,
  Settings2,
  ClipboardCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ModalVerificacionReserva } from "./ModalVerificacionReserva";
import { BlacklistModal } from "./BlacklistModal";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  type ReservaParaVerificar,
  aceptarComoSolicitado,
  aceptarVariasComoSolicitado,
} from "@/hooks/useVerificacionReservas";
import type { SolicitudPendiente, useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { SolicitudCard, MOTIVO_LABELS, ESTADO_LABELS } from "./GestionSolicitudes";
import { CLAVES_REFRESCO_RESERVAS, FormularioReserva, type ReservaCreadaDesdeFormulario } from "./FormularioReserva";
import { SolicitudGestionPanel } from "./SolicitudGestionPanel";
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
} from "@/lib/reservas/vistaUnificada";

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
//   · las celdas usan `CELDA` (px-3 py-2) en vez del `p-4` del primitivo;
//   · ningún texto puede romper: o `whitespace-nowrap`, o `truncate` con el
//     texto completo en un `title`;
//   · el contenido de cada celda ocupa como mucho dos líneas.
const ALTO_FILA = "h-14";
const CELDA = "px-3 py-2 align-middle";

/** Filas por página. Ver el comentario de "Paginación" más abajo. */
const TAMANO_PAGINA = 50;

// Insignias de la tabla: una sola línea y alto fijo. El primitivo `Badge` NO
// lleva `whitespace-nowrap` y lo comparte toda la app, así que no se toca
// ahí: sin esto "Solicitud · Pendiente" rompía en dos líneas y "Propuesta
// enviada 24/09 18:44" en tres, que es lo que hinchaba las filas.
const INSIGNIA = "h-5 shrink-0 gap-1 whitespace-nowrap px-1.5 py-0 text-[11px] font-medium";
/** Segunda línea del estado (motivo, propuesta): aún más compacta. */
const INSIGNIA_SECUNDARIA = "h-4 gap-1 whitespace-nowrap px-1 py-0 text-[10px] font-medium";

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

// Anchos fijos. Sumados dan ~900 px, que es el `min-w` de la tabla: por debajo
// de eso la tabla NO comprime columnas (que es lo que partía los botones por
// la mitad), sino que aparece scroll horizontal dentro del contenedor.
const ANCHO_ACCIONES = "w-[232px]";

// Fondos de fila. Hay que aplicarlos también a la celda de acciones: al ser
// `position: sticky` necesita fondo opaco propio, si no el resto de la fila se
// vería por debajo al desplazar en horizontal. La variante `sticky` usa
// `group-hover` porque el ratón está sobre la fila (`group`), no sobre la celda.
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
 * Acción secundaria de una fila: solo icono, con tooltip y `aria-label`, para
 * que la columna "Acciones" quepa entera sin recortarse. Las destructivas
 * (Cancelar, lista negra) van en rojo y se rellenan al pasar por encima, para
 * que no se confundan con las normales.
 */
function AccionIcono({
  etiqueta,
  onClick,
  disabled,
  destructiva = false,
  children,
}: {
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
  destructiva?: boolean;
  children: ReactNode;
}) {
  return (
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
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 w-8 shrink-0",
        destructiva &&
          "border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground",
      )}
    >
      {children}
    </Button>
  );
}

/** Celda de acciones: anclada a la derecha para que nunca quede fuera de vista. */
function CeldaAcciones({ fondo, children }: { fondo: string; children: ReactNode }) {
  return (
    <TableCell
      className={cn(
        CELDA,
        ANCHO_ACCIONES,
        // `sticky right-0`: aunque haga falta scroll horizontal (pantallas
        // estrechas), los botones siguen visibles y clicables.
        "sticky right-0 z-10 border-l border-border/60",
        fondo,
      )}
    >
      <div className="flex items-center justify-end gap-1.5">{children}</div>
    </TableCell>
  );
}

interface ListaReservasAvanzadaProps {
  onEditReserva?: (reserva: Reservation) => void;
  onEspacioClick?: (espacioId: string) => void;
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
  onEditReserva,
  onEspacioClick,
  initialStatusFilter,
  initialDateFilter,
  solicitudesState,
}: ListaReservasAvanzadaProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
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
  // Selección para aceptar en bloque — solo pendientes participan.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [aceptandoBloque, setAceptandoBloque] = useState(false);

  const { canAccess: canEdit } = useCanAccessSection("reservas", "edit");

  const queryClient = useQueryClient();
  const refrescarReservas = () =>
    CLAVES_REFRESCO_RESERVAS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const toggleImportante = async (reservation: Reservation) => {
    const nuevoValor = !(reservation as any).importante;
    const { error } = await supabase.from("reservas").update({ importante: nuevoValor }).eq("id", reservation.id);
    if (error) {
      console.error("Error actualizando la reserva:", error);
      toast.error("No se pudo actualizar la reserva: " + error.message);
      return;
    }
    toast.success(nuevoValor ? "Reserva marcada como importante" : "Reserva desmarcada");
    fetchReservations();
  };

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
  // opcionales y el resto del código (objetivoAceptarComoSolicitado,
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
    // Negocio de la solicitud (sala propuesta o marcador de El Reservado en
    // las notas). Si es de un negocio con una sola sala (Touza), esa sala
    // queda preseleccionada: la reserva nace de Touza, con su aforo.
    const espacioElegido = p ? p.espacioId : s.espacio_propuesto_id ?? null;
    const marca = marcaDeSolicitud({ espacio_propuesto_id: espacioElegido, notas_cliente: s.notas_cliente }, espacios);
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

  const updateReservationStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id);
    try {
      const currentReservation = reservations.find(r => r.id === id);

      const { error } = await supabase
        .from("reservas")
        .update({ estado: newStatus })
        .eq("id", id);

      if (error) {
        toast.error("Error al actualizar estado");
        return;
      }

      toast.success("Estado actualizado correctamente");

      // Enviar datos al webhook
      supabase.functions.invoke('notify-reservation-change', {
        body: { ...currentReservation, estado: newStatus }
      }).catch(err => console.error('Error notifying webhook:', err));

      fetchReservations();
    } finally {
      setUpdatingId(null);
    }
  };

  // Un clic: acepta una solicitud pendiente exactamente como la pidió el
  // cliente (ver useVerificacionReservas.ts). Requisito explícito del dueño
  // ("hay mucho volumen"): esto NO abre el modal de contraoferta.
  const handleAceptarUnaClic = async (reservation: Reservation) => {
    setUpdatingId(reservation.id);
    try {
      const resultado = await aceptarComoSolicitado(reservation);
      if (resultado.ok) fetchReservations();
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleSeleccion = (id: string) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
    if (elegidas.length === 0) return;
    setAceptandoBloque(true);
    try {
      await aceptarVariasComoSolicitado(elegidas);
      setSeleccionadas(new Set());
      fetchReservations();
    } finally {
      setAceptandoBloque(false);
    }
  };

  const getCanalBadge = (canal: string | null) => {
    switch (canal) {
      case 'telefono':
        return (
          <Badge className={cn(INSIGNIA, "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300")}>
            <Phone className="h-3 w-3" />
            Teléfono
          </Badge>
        );
      case 'web':
        return (
          <Badge className={cn(INSIGNIA, "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>
            <Globe className="h-3 w-3" />
            Web
          </Badge>
        );
      case 'manual':
        return (
          <Badge className={cn(INSIGNIA, "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300")}>
            <Pencil className="h-3 w-3" />
            Manual
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className={cn(INSIGNIA, "text-muted-foreground")}>
            <Globe className="h-3 w-3" />
            Web
          </Badge>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pendiente":
        return (
          <Badge className={cn(INSIGNIA, "bg-status-pending text-status-pending-foreground")}>
            <Clock className="h-3 w-3" />
            Pendiente
          </Badge>
        );
      case "verificada":
        return (
          <Badge className={cn(INSIGNIA, "bg-status-verified text-status-verified-foreground")}>
            <CheckCircle className="h-3 w-3" />
            Verificada
          </Badge>
        );
      case "confirmada":
        return (
          <Badge className={cn(INSIGNIA, "bg-status-confirmed text-status-confirmed-foreground")}>
            <CheckCircle className="h-3 w-3" />
            Confirmada
          </Badge>
        );
      case "cancelada":
        return (
          <Badge variant="destructive" className={INSIGNIA}>
            <XCircle className="h-3 w-3" />
            Cancelada
          </Badge>
        );
      // 'completada' = el cliente llegó (ver src/lib/reservas/servicioSala.ts).
      case "completada":
        return (
          <Badge className={cn(INSIGNIA, "bg-emerald-600 text-white")}>
            <CheckCheck className="h-3 w-3" />
            Llegó
          </Badge>
        );
      case "no_show":
        return (
          <Badge variant="secondary" className={INSIGNIA}>
            <UserX className="h-3 w-3" />
            No vino
          </Badge>
        );
      default:
        return <Badge variant="outline" className={INSIGNIA}>{status}</Badge>;
    }
  };

  // Aplicar filtros — a reservas Y solicitudes a la vez (lógica pura en
  // src/lib/reservas/vistaUnificada.ts). La fecha se compara como texto
  // "yyyy-MM-dd": antes se hacía `new Date(r.fecha)` (medianoche UTC) contra
  // una fecha local, lo que en husos negativos casaba con el día anterior.
  const filas = useMemo(
    () =>
      filtrarFilasUnificadas(unificarReservasYSolicitudes(reservations, solicitudes), {
        busqueda: searchQuery,
        estado: statusFilter,
        canal: canalFilter,
        fecha: dateFilter ? format(dateFilter, "yyyy-MM-dd") : null,
        negocio: negocioFilter,
        marcaDeSolicitud: (s) => marcaDeSolicitud(s, espacios),
      }),
    [reservations, solicitudes, searchQuery, statusFilter, canalFilter, dateFilter, negocioFilter, espacios],
  );
  const filteredReservations = filas.flatMap((f) => (f.tipo === "reserva" ? [f.reserva] : []));
  const numSolicitudesVisibles = filas.length - filteredReservations.length;

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
              <Button size="sm" onClick={handleAceptarSeleccionadas} disabled={aceptandoBloque}>
                {aceptandoBloque ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCheck className="h-4 w-4 mr-1" />}
                Aceptar seleccionadas tal cual
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mobile card view */}
      <div className="sm:hidden space-y-3">
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
          ) : (() => { const reservation = fila.reserva; return (
            <Card key={reservation.id} className={(reservation as any).importante ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {reservation.estado === "pendiente" && canEdit && (
                      <Checkbox
                        checked={seleccionadas.has(reservation.id)}
                        onCheckedChange={() => toggleSeleccion(reservation.id)}
                        className="shrink-0"
                        aria-label="Seleccionar para aceptar en bloque"
                      />
                    )}
                    <button onClick={() => toggleImportante(reservation)} className="shrink-0">
                      <Star className={cn("h-4 w-4", (reservation as any).importante ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
                    </button>
                    <span className="font-medium text-sm">{reservation.nombre || "Sin nombre"}</span>
                  </div>
                  {getStatusBadge(reservation.estado)}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{new Date(reservation.fecha).toLocaleDateString("es-ES")}</span>
                  <span>{reservation.hora}</span>
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{reservation.numero_comensales}</span>
                  {getCanalBadge(reservation.canal)}
                  <NegocioBadge marca={marcaDeReserva(reservation)} corta />
                </div>
                {reservation.telefono && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" />{reservation.telefono}
                  </p>
                )}
                <div className="flex gap-2 pt-1 flex-wrap">
                  {reservation.estado === "pendiente" && canEdit && (
                    <Button size="sm" className="h-7 text-xs" disabled={updatingId === reservation.id || aceptandoBloque} onClick={() => handleAceptarUnaClic(reservation)}>
                      {updatingId === reservation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                      Aceptar
                    </Button>
                  )}
                  {reservation.estado === "pendiente" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                      setSelectedReservaForVerification(reservation);
                      setVerificacionModalOpen(true);
                    }}>Verificar</Button>
                  )}
                  {reservation.estado === "verificada" && canEdit && (
                    <Button size="sm" className="h-7 text-xs" disabled={updatingId === reservation.id} onClick={() => updateReservationStatus(reservation.id, "confirmada")}>
                      {updatingId === reservation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar"}
                    </Button>
                  )}
                  {reservation.estado !== "cancelada" && canEdit && (
                    <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={updatingId === reservation.id} onClick={() => updateReservationStatus(reservation.id, "cancelada")}>
                      {updatingId === reservation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancelar"}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => setBlacklistReserva(reservation)} aria-label={`Añadir a ${reservation.nombre || "este cliente"} a la lista negra`}>
                    <ShieldBan className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
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
      <Card className="hidden overflow-hidden sm:block">
        {/* El alto llega como variable CSS porque hay que aplicarlo al `div`
            que envuelve la tabla, que lo pinta el primitivo compartido. El
            `calc()` es solo el valor de arranque, hasta que el efecto mide. */}
        <CardContent
          ref={contenedorTablaRef}
          className="p-0 [&>div]:max-h-[var(--alto-lista)] [&>div]:min-h-[16rem]"
          style={{ "--alto-lista": altoTabla ? `${altoTabla}px` : "calc(100vh - 17rem)" } as CSSProperties}
        >
          {/* `min-w`: por debajo de este ancho la tabla NO aprieta las
              columnas (que es lo que partía los botones a media palabra),
              sino que ofrece scroll horizontal. */}
          <Table className="min-w-[900px]">
            <TableHeader className="sticky top-0 z-20">
              <TableRow className="hover:bg-transparent">
                {canEdit && (
                  <TableHead className={cn("h-10 w-[36px] bg-card", CELDA)}>
                    <Checkbox
                      checked={pendientesVisibles().length > 0 && pendientesVisibles().every((r) => seleccionadas.has(r.id))}
                      onCheckedChange={toggleSeleccionarTodasPendientes}
                      disabled={pendientesVisibles().length === 0}
                      aria-label="Seleccionar todas las pendientes visibles"
                    />
                  </TableHead>
                )}
                <TableHead className={cn("h-10 w-[132px] bg-card", CELDA)}>Fecha y hora</TableHead>
                <TableHead className={cn("h-10 min-w-[180px] bg-card", CELDA)}>Cliente</TableHead>
                <TableHead className={cn("h-10 w-[62px] bg-card", CELDA)} title="Comensales">Pax</TableHead>
                <TableHead className={cn("h-10 w-[100px] bg-card", CELDA)}>Canal</TableHead>
                <TableHead className={cn("h-10 w-[184px] bg-card", CELDA)}>Estado</TableHead>
                <TableHead
                  className={cn(
                    "sticky right-0 z-30 h-10 border-l border-border/60 bg-card text-right",
                    ANCHO_ACCIONES,
                    CELDA,
                  )}
                >
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canEdit ? 7 : 6} className="text-center py-8 text-muted-foreground">
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
                  const ocupada = updatingId === reservation.id;
                  const nombre = reservation.nombre || "Sin nombre";
                  return (
                  <TableRow key={reservation.id} className={cn("group", ALTO_FILA, fondo.fila)}>
                    {canEdit && (
                      <TableCell className={cn(CELDA, "w-[36px]")}>
                        {reservation.estado === "pendiente" && (
                          <Checkbox
                            checked={seleccionadas.has(reservation.id)}
                            onCheckedChange={() => toggleSeleccion(reservation.id)}
                            aria-label="Seleccionar para aceptar en bloque"
                          />
                        )}
                      </TableCell>
                    )}
                    {/* Fecha y hora juntas: dos columnas para esto gastaban
                        ancho que hacía falta para las acciones. */}
                    <TableCell className={cn(CELDA, "w-[132px] whitespace-nowrap tabular-nums")}>
                      <span>{new Date(reservation.fecha).toLocaleDateString("es-ES")}</span>
                      <span className="ml-2 font-medium">{String(reservation.hora ?? "").substring(0, 5)}</span>
                    </TableCell>
                    <TableCell className={cn(CELDA, "min-w-[180px] max-w-[280px]")}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleImportante(reservation)}
                          className="shrink-0 transition-transform hover:scale-110"
                          aria-label={importante ? `Desmarcar ${nombre} como importante` : `Marcar ${nombre} como importante`}
                        >
                          <Star className={cn("h-4 w-4", importante ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")} />
                        </button>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate font-medium leading-tight" title={nombre}>{nombre}</p>
                            <NegocioBadge marca={marcaDeReserva(reservation)} corta />
                          </div>
                          {reservation.telefono && (
                            <p className="truncate text-xs leading-tight text-muted-foreground">{reservation.telefono}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn(CELDA, "w-[62px]")}>
                      <div className="flex items-center gap-1 tabular-nums"><Users className="h-4 w-4 shrink-0 text-muted-foreground" />{reservation.numero_comensales}</div>
                    </TableCell>
                    <TableCell className={cn(CELDA, "w-[100px]")}>{getCanalBadge(reservation.canal)}</TableCell>
                    <TableCell className={cn(CELDA, "w-[184px]")}>{getStatusBadge(reservation.estado)}</TableCell>
                    <CeldaAcciones fondo={fondo.acciones}>
                      {reservation.estado === "pendiente" && canEdit && (
                        <Button
                          size="sm"
                          className="h-8 shrink-0 px-2.5 text-xs"
                          title="Aceptar la reserva tal y como la pidió el cliente"
                          disabled={ocupada || aceptandoBloque}
                          onClick={() => handleAceptarUnaClic(reservation)}
                        >
                          {ocupada ? <Loader2 className="animate-spin" /> : <CheckCircle />}
                          Aceptar
                        </Button>
                      )}
                      {reservation.estado === "pendiente" && (
                        <AccionIcono
                          etiqueta="Verificar: comparar lo pedido con lo ofrecido"
                          onClick={() => {
                            setSelectedReservaForVerification(reservation);
                            setVerificacionModalOpen(true);
                          }}
                        >
                          <ClipboardCheck />
                        </AccionIcono>
                      )}
                      {reservation.estado === "verificada" && canEdit && (
                        <Button
                          size="sm"
                          className="h-8 shrink-0 px-2.5 text-xs"
                          disabled={ocupada}
                          onClick={() => updateReservationStatus(reservation.id, "confirmada")}
                        >
                          {ocupada ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                          Confirmar
                        </Button>
                      )}
                      {reservation.estado !== "cancelada" && canEdit && (
                        <AccionIcono
                          destructiva
                          etiqueta={`Cancelar la reserva de ${nombre}`}
                          disabled={ocupada}
                          onClick={() => updateReservationStatus(reservation.id, "cancelada")}
                        >
                          {ocupada ? <Loader2 className="animate-spin" /> : <XCircle />}
                        </AccionIcono>
                      )}
                      <AccionIcono
                        destructiva
                        etiqueta={`Añadir a ${nombre} a la lista negra`}
                        onClick={() => setBlacklistReserva(reservation)}
                      >
                        <ShieldBan />
                      </AccionIcono>
                    </CeldaAcciones>
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

      <BlacklistModal
        reserva={blacklistReserva}
        open={!!blacklistReserva}
        onOpenChange={(open) => { if (!open) setBlacklistReserva(null); }}
      />

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
  return (
    // Franja ámbar a la izquierda + insignia "Solicitud · …" en Estado: una
    // solicitud NO es una reserva (otra tabla, otro ciclo de vida) y tiene que
    // notarse de un vistazo aunque compartan lista.
    <TableRow
      className={cn(
        "group border-l-4 border-l-amber-400",
        ALTO_FILA,
        FONDOS.destacada.fila,
        !abierta && "opacity-70",
      )}
    >
      {canEdit && <TableCell className={cn(CELDA, "w-[36px]")} />}
      <TableCell className={cn(CELDA, "w-[132px] whitespace-nowrap tabular-nums")}>
        {solicitud.fecha_solicitada ? (
          <>
            <span>{new Date(`${solicitud.fecha_solicitada}T12:00:00`).toLocaleDateString("es-ES")}</span>
            <span className="ml-2 font-medium">
              {solicitud.hora_solicitada ? String(solicitud.hora_solicitada).substring(0, 5) : "—"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Sin fecha</span>
        )}
      </TableCell>
      <TableCell className={cn(CELDA, "min-w-[180px] max-w-[280px]")}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate font-medium leading-tight" title={nombre}>{nombre}</p>
            <NegocioBadge marca={marca} corta />
          </div>
          {solicitud.telefono && (
            <a
              href={`tel:${solicitud.telefono}`}
              className="block truncate text-xs leading-tight text-muted-foreground hover:underline"
            >
              {solicitud.telefono}
            </a>
          )}
        </div>
      </TableCell>
      <TableCell className={cn(CELDA, "w-[62px]")}>
        {solicitud.numero_comensales ? (
          <div className="flex items-center gap-1 tabular-nums"><Users className="h-4 w-4 shrink-0 text-muted-foreground" />{solicitud.numero_comensales}</div>
        ) : "—"}
      </TableCell>
      <TableCell className={cn(CELDA, "w-[100px]")}>
        <Badge className={cn(INSIGNIA, "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300")}>
          <Phone className="h-3 w-3" />
          Bot
        </Badge>
      </TableCell>
      <TableCell className={cn(CELDA, "w-[184px]")}>
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <Badge className={cn(INSIGNIA, "bg-amber-500 text-white")}>
            <Inbox className="h-3 w-3" />
            Solicitud · {estadoLabel}
          </Badge>
          <div className="flex min-w-0 items-center gap-1">
            {vistaPropuesta && vistaPropuesta.clave !== "borrador" && (
              <span className="shrink-0" title={`${vistaPropuesta.etiqueta} — ${vistaPropuesta.detalle}`}>
                <EstadoPropuestaBadge
                  vista={{ ...vistaPropuesta, etiqueta: etiquetaPropuestaCorta(vistaPropuesta, enviadaAt) }}
                  className={INSIGNIA_SECUNDARIA}
                />
              </span>
            )}
            <Badge
              className={cn(INSIGNIA_SECUNDARIA, "min-w-0 max-w-full truncate", motivo.color)}
              title={motivoTitulo}
            >
              {motivo.label}
            </Badge>
          </div>
        </div>
      </TableCell>
      <CeldaAcciones fondo={FONDOS.destacada.acciones}>
        {canEdit && abierta && (
          <Button
            size="sm"
            className="h-8 shrink-0 px-2.5 text-xs"
            title="Convertir la solicitud en una reserva"
            onClick={onConvertir}
          >
            <CalendarPlus />
            Convertir
          </Button>
        )}
        <AccionIcono etiqueta="Gestionar: propuesta al cliente, salas y notas" onClick={onGestionar}>
          <Settings2 />
        </AccionIcono>
      </CeldaAcciones>
    </TableRow>
  );
}
