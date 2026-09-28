import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import {
  CalendarCheck,
  ChevronRight,
  CircleDashed,
  MapPin,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CifrasNegocio } from "@/lib/reservas/resumenNegocios";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { hoyLocal } from "./asignacionPlano";
import {
  agruparPendientesDeMesa,
  contarPendientes,
  idsReservasConMesa,
  type GrupoPendientes,
  type ReservaPendienteMesa,
} from "@/lib/reservas/pendientesDeMesa";
import { resolverSaltoAsignacion, type DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { GestorReservasKanban } from "./GestorReservasKanban";
import { cn } from "@/lib/utils";

interface VistaHoyProps {
  onEspacioClick: (espacioId: string) => void;
  /** Salto al plano de la sala de una reserva, para darle mesa. */
  onAsignarMesa: (destino: DestinoAsignacion) => void;
}

/**
 * Pestaña "Hoy" (rediseñada 2026-09-25, petición del dueño): antes esto era
 * 4 tarjetas grandes de ocupación + una tabla "Reservas de Hoy" + el kanban
 * escondido detrás de un botón "Gestor de reservas" — en 1366px las 4
 * tarjetas solas ya llenaban la pantalla y no se veía ni una reserva.
 *
 * Ahora: una franja compacta con los mismos 4 datos (+ desglose por
 * negocio, que no se pierde) y, justo debajo, el kanban por espacios como
 * protagonista — es la vista de servicio, así que es lo primero que se ve.
 *
 * Ojo: NO hay lista/tabla de reservas de hoy aquí (decisión explícita del
 * dueño — "quita la lista de reservas de hoy, solo el kanban"). Buscar por
 * nombre/teléfono, marcar importante y añadir a blacklist siguen
 * disponibles, pero dentro del propio kanban (GestorReservasKanban.tsx) en
 * vez de en una tabla aparte. Las reservas que NO son de hoy están en la
 * pestaña "Lista".
 *
 * ----------------------------------------------------------------------------
 * FRANJA "PENDIENTES DE MESA" (2026-09-28) — y por qué NO va en el kanban
 * ----------------------------------------------------------------------------
 * El dueño pidió poder abrir el plano "desde la parte de la lista para asignar
 * mesas, O DESDE LA VISTA DE HOY SI SIGUEN SIN ASIGNAR". Lo natural sería un
 * botón en cada tarjeta del kanban, y se descartó por tres razones:
 *
 *   1. `GestorReservasKanban` no acepta props (se monta suelto) y su geometría
 *      está fijada por una batería de tests: meterle un botón por tarjeta es
 *      tocar justo lo que no se puede tocar.
 *   2. El kanban enseña TODAS las reservas del día; el dueño pidió ver "las que
 *      siguen sin asignar". Una franja aparte sólo enseña lo que queda por
 *      hacer y DESAPARECE SOLA cuando todo está sentado — un botón por tarjeta
 *      estaría ahí siempre, incluso sin nada que resolver.
 *   3. Por sala, que es como se trabaja: se agrupa por sala y la cabecera de
 *      cada grupo abre ese plano. Eso además REVIVE `onEspacioClick`, que
 *      estaba declarada aquí y no se invocaba desde ninguna parte (la entrada
 *      "por sala" desde Hoy que la documentación daba por existente llevaba
 *      tiempo muerta).
 *
 * TONO: con sala y sin mesa NO es un error, es trabajo pendiente normal (lo
 * dice el pie del propio plano). Por eso todo aquí es `muted`/`outline`, nunca
 * rojo ni iconos de alerta, y el icono y el título son los MISMOS que usa el
 * plano en su sección equivalente (`CircleDashed`, "Pendientes de mesa").
 */
export function VistaHoy({ onEspacioClick, onAsignarMesa }: VistaHoyProps) {
  const {
    data: resumen,
    isLoading,
    isError: errorResumen,
    error: errorResumenDetalle,
    refetch: refetchResumen,
  } = useResumenOcupacionHoy();

  // Ojo con el orden: estos hooks van ANTES de los `return` de carga/error de
  // arriba, o React se queda sin hooks a mitad de render.
  const hoy = useMemo(() => hoyLocal(), []);
  const { data: espacios } = useEspaciosReserva();
  // Sin `espacioId`: trae las asignaciones de TODAS las salas del día, que es
  // justo lo que hace falta para saber quién NO tiene mesa en ninguna.
  const { data: asignaciones } = useAsignacionesMesa(hoy);

  /**
   * Reservas de hoy, sólo las 6 columnas que necesita la franja.
   *
   * NO se reutiliza `useReservasServicioDia`: ese pide `llegada_at` y
   * `salida_at`, columnas de migraciones que pueden no estar aplicadas, y su
   * error subiría hasta aquí y tumbaría la pestaña entera. Estas 6 existen
   * seguro. Mismo patrón que `useReservasDeSala` (`"reservas" as any` porque
   * `espacio_id` no está en los tipos generados).
   *
   * CLAVE: empieza por "reservas-hoy", que es uno de los prefijos de
   * `CLAVES_LISTAS_RESERVAS` (useAccionesServicioReserva) y el primero de
   * `CLAVES_REFRESCO_RESERVAS` (FormularioReserva). Es decir, sin tocar ningún
   * otro fichero:
   *   · mover una reserva de sala o marcar llegada en el kanban ya invalida
   *     (y actualiza de forma optimista, porque el dato es un array de filas
   *     con `id`) todo lo que empiece por "reservas-hoy" → la franja se
   *     recoloca al instante;
   *   · crear o editar una reserva invalida la misma familia.
   * Y la lista de asignaciones se refresca sola: `useAsignacionesMesa` invalida
   * por el prefijo `CLAVE_ASIGNACIONES_MESA` cada vez que alguien sienta a
   * alguien en el plano, así que al darle mesa la reserva sale de la franja.
   */
  const { data: reservasHoy } = useQuery({
    queryKey: ["reservas-hoy", "pendientes-mesa", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("id, nombre, hora, numero_comensales, estado, espacio_id")
        .eq("fecha", hoy)
        .neq("estado", "cancelada")
        .order("hora");
      if (error) throw error;
      return (data ?? []) as unknown as ReservaPendienteMesa[];
    },
  });

  const grupos = useMemo(() => {
    // Las salas inactivas NO se filtran: si una reserva sigue colgando de una
    // sala que se desactivó, hace falta su nombre para poder ir a resolverla.
    const salas = ((espacios ?? []) as Array<{ id: string; nombre: string }>)
      .filter((e) => e?.id)
      .map((e) => ({ id: e.id, nombre: e.nombre }));
    return agruparPendientesDeMesa(reservasHoy ?? [], idsReservasConMesa(asignaciones ?? []), salas);
  }, [reservasHoy, asignaciones, espacios]);

  if (isLoading) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <div className="rounded-xl border bg-card/50 p-3 sm:p-4 animate-pulse">
          <div className="h-10 sm:h-8 bg-muted rounded" />
        </div>
        <div className="h-80 bg-muted/40 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (errorResumen) {
    return (
      <EstadoErrorCarga
        titulo="el resumen de ocupación de hoy"
        error={errorResumenDetalle}
        onReintentar={() => refetchResumen()}
      />
    );
  }

  const reservasCanceladas = resumen?.reservasCanceladas ?? 0;
  const porNegocio = resumen?.porNegocio ?? [];

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Franja compacta de ocupación: los 4 datos que antes eran 4
          tarjetas grandes, ahora en una sola línea en escritorio (2x2 en
          móvil) para que no compitan con el kanban por la pantalla. */}
      <div className="rounded-xl border bg-card/50 px-3 py-2.5 sm:px-2 sm:py-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2.5 sm:gap-x-0 sm:divide-x sm:divide-border">
          <IndicadorHoy
            icon={CalendarCheck}
            iconClass="bg-primary/10 text-primary"
            label="Reservas hoy"
            value={resumen?.totalReservas ?? 0}
            detalle={reservasCanceladas > 0 ? `· ${reservasCanceladas} canc.` : undefined}
            porNegocio={porNegocio}
            cifra={(n) => `${n.totalReservas}`}
          />
          <IndicadorHoy
            icon={Users}
            iconClass="bg-accent/10 text-accent"
            label="Comensales"
            value={resumen?.totalComensales ?? 0}
            porNegocio={porNegocio}
            cifra={(n) => `${n.totalComensales}`}
          />
          <IndicadorHoy
            icon={MapPin}
            iconClass="bg-secondary/10 text-secondary"
            label="Capacidad"
            value={resumen?.capacidadTotal ?? 0}
            porNegocio={porNegocio}
            cifra={(n) => `${n.capacidadTotal}`}
          />
          <IndicadorHoy
            icon={TrendingUp}
            iconClass="bg-green-500/10 text-green-600 dark:text-green-500"
            label="Ocupación"
            value={`${resumen?.porcentajeTotal ?? 0}%`}
            porNegocio={porNegocio}
            cifra={(n) => `${n.porcentajeTotal}%`}
          />
        </div>
      </div>

      <FranjaPendientesMesa
        grupos={grupos}
        fecha={hoy}
        onEspacioClick={onEspacioClick}
        onAsignarMesa={onAsignarMesa}
      />

      <GestorReservasKanban />
    </div>
  );
}

/**
 * La franja de trabajo pendiente: sólo lo que queda por sentar, agrupado por
 * sala y a un clic del plano.
 *
 * SI NO HAY NADA PENDIENTE NO PINTA NADA — ni la caja vacía ni un "todo
 * sentado". Todo hecho = nada que enseñar; el kanban es el protagonista y no
 * se le roban píxeles para decir que no hay noticias.
 *
 * Si la carga falla, `grupos` llega vacío y pasa exactamente lo mismo: la
 * franja no aparece y el kanban sigue funcionando. Aquí NO se usa
 * `EstadoErrorCarga` a propósito: es información accesoria de una pantalla
 * cuyo protagonista es otro, y tapar el kanban con un cartel de error por un
 * fallo en el extra sería peor que no enseñar el extra.
 */
function FranjaPendientesMesa({
  grupos,
  fecha,
  onEspacioClick,
  onAsignarMesa,
}: {
  grupos: GrupoPendientes[];
  fecha: string;
  onEspacioClick: (espacioId: string) => void;
  onAsignarMesa: (destino: DestinoAsignacion) => void;
}) {
  if (grupos.length === 0) return null;

  return (
    <section
      aria-label="Pendientes de mesa"
      className="rounded-xl border bg-muted/30 px-3 py-2 sm:px-3 sm:py-2.5"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
          Pendientes de mesa
        </span>
        <Badge variant="outline" className="h-5 tabular-nums">
          {contarPendientes(grupos)}
        </Badge>
      </div>

      {/* Alto limitado con scroll propio: en un sábado con 30 reservas sin
          sentar esto crecería sin fin y volveríamos al problema de 2026-09-25
          (la parte de arriba llenando la pantalla y el kanban sin verse).
          `flex-wrap` para que en 1024px las pastillas bajen de línea en vez de
          desbordar a lo ancho. */}
      <div className="max-h-24 space-y-1 overflow-y-auto sm:max-h-28">
        {grupos.map((grupo) => (
          <div
            key={grupo.espacioId ?? "__sin_sala__"}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <CabeceraGrupo grupo={grupo} onEspacioClick={onEspacioClick} />
            {grupo.reservas.map((reserva) => (
              <PastillaPendiente
                key={reserva.id}
                reserva={reserva}
                fecha={fecha}
                nombreSala={grupo.nombreSala}
                onAsignarMesa={onAsignarMesa}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Nombre de la sala, clicable: abre SU plano (la entrada "por sala" desde Hoy).
 * El grupo "sin sala" no tiene plano que abrir, así que ahí es texto muerto.
 */
function CabeceraGrupo({
  grupo,
  onEspacioClick,
}: {
  grupo: GrupoPendientes;
  onEspacioClick: (espacioId: string) => void;
}) {
  const base = "shrink-0 text-xs font-semibold";

  if (grupo.espacioId == null) {
    return <span className={cn(base, "text-muted-foreground")}>Sin sala</span>;
  }

  const espacioId = grupo.espacioId;
  // Sala huérfana (su id ya no está en `espacios_reserva`): se puede abrir
  // igual, porque el plano abre por id, pero no hay nombre que enseñar.
  const nombre = grupo.nombreSala ?? "Sala";

  return (
    <button
      type="button"
      onClick={() => onEspacioClick(espacioId)}
      title={`Abrir el plano de ${nombre} para repartir mesas`}
      className={cn(
        base,
        "inline-flex items-center gap-0.5 rounded px-1 py-0.5 -ml-1 text-foreground",
        "hover:bg-background hover:underline underline-offset-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {nombre}
      <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/**
 * Una reserva sin mesa: hora + nombre + comensales, y un clic la lleva a su
 * plano con la reserva ya señalada.
 *
 * El `title` sale SIEMPRE de `resolverSaltoAsignacion` —nunca se escribe aquí—
 * para que esta franja y la lista de reservas digan exactamente lo mismo ante
 * el mismo caso. Sin sala: la pastilla se queda deshabilitada (no hay plano al
 * que ir) y el `title` compartido explica que primero hay que darle sala con
 * «Gestionar». Estilo `secondary`/`outline`: pendiente no es error.
 */
function PastillaPendiente({
  reserva,
  fecha,
  nombreSala,
  onAsignarMesa,
}: {
  reserva: ReservaPendienteMesa;
  fecha: string;
  nombreSala: string | null;
  onAsignarMesa: (destino: DestinoAsignacion) => void;
}) {
  const salto = resolverSaltoAsignacion(
    // `hora` va incluida: de ella sale el turno del destino, y sin turno el
    // plano abriría en el del reloj — una cena buscada a mediodía no saldría
    // en el panel.
    { id: reserva.id, fecha, espacio_id: reserva.espacio_id, estado: reserva.estado, hora: reserva.hora },
    { yaTieneMesa: false, nombreSala },
  );
  const destino = salto.destino;

  return (
    // El `title` va TAMBIÉN en un `<span>` que envuelve al botón, igual que
    // `AccionIcono` en la lista: un botón deshabilitado no dispara eventos de
    // ratón, así que su propio `title` no llega a enseñarse — y justo el caso
    // deshabilitado (sin sala) es el que más necesita explicarse.
    <span className="inline-flex min-w-0" title={salto.titulo}>
      <button
        type="button"
        disabled={!destino}
        title={salto.titulo}
        onClick={destino ? () => onAsignarMesa(destino) : undefined}
        className={cn(
          "inline-flex min-w-0 max-w-[14rem] items-center gap-1.5 rounded-full border px-2 py-0.5",
          "text-xs text-foreground/90 transition-colors",
          destino
            ? "bg-background hover:bg-secondary hover:text-secondary-foreground"
            : "cursor-not-allowed border-dashed bg-transparent text-muted-foreground opacity-70",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="shrink-0 font-medium tabular-nums">
          {String(reserva.hora ?? "").substring(0, 5)}
        </span>
        {/* `min-w-0` además de `truncate`: sin él un nombre largo no se recorta
            —los hijos de un flex no bajan de su ancho de contenido— y la
            pastilla se saltaría su propio `max-w`. */}
        <span className="min-w-0 truncate">{reserva.nombre || "Sin nombre"}</span>
        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <Users className="h-3 w-3" aria-hidden="true" />
          <span className="tabular-nums">{reserva.numero_comensales}</span>
          <span className="sr-only">comensales</span>
        </span>
      </button>
    </span>
  );
}

/** Un dato de la franja compacta: icono + número + (si hay 2 negocios) su desglose. */
function IndicadorHoy({
  icon: Icon,
  iconClass,
  label,
  value,
  detalle,
  porNegocio,
  cifra,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  value: string | number;
  detalle?: string;
  porNegocio: CifrasNegocio[];
  cifra: (n: CifrasNegocio) => string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 sm:px-3 sm:first:pl-1">
      <div className={cn("p-1.5 rounded-lg shrink-0", iconClass)}>
        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-xs font-medium text-muted-foreground leading-none truncate">{label}</p>
        <p className="text-base sm:text-lg font-bold leading-tight tabular-nums">
          {value}
          {detalle && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{detalle}</span>}
        </p>
        {porNegocio.length > 1 && (
          <p className="text-[10px] text-muted-foreground truncate tabular-nums" aria-label="Desglose por negocio">
            {porNegocio.map((n) => `${n.negocio.nombre} ${cifra(n)}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
