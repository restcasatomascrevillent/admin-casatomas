// ============================================================================
// «HOY» EN VISTA PLANO — los planos del local con las reservas de hoy encima
// ----------------------------------------------------------------------------
// Petición del dueño (06/10/2026): «montar aquí DOS VISTAS: una de kanban y luego
// montar la vista con los planos del local». Esta es la segunda: para llevar el
// servicio desde la tablet mirando la sala tal como es.
//
// QUÉ HAY (todo reutilizado; aquí solo se junta y se coloca)
//   · Pestañas de sala (Casa Tomás: `construirColumnas`, las mismas del kanban)
//     con cuántas reservas tiene cada una y cuántas siguen sin mesa. El Reservado
//     (sala privada) va el último, con candado y «Fuera de aforo».
//   · El plano de la sala (`MapaSalaServicio`) con cada mesa del color de su
//     estado: libre / reservada / retrasada / ocupada / por liberar. El estado lo
//     calcula `estadoMesaServicio` con los umbrales de Configuración, EXACTAMENTE
//     como el modo servicio de una sala (`ModoServicioPlano`).
//   · Al lado (tablet y escritorio) o en una hoja (móvil):
//       - sin mesa elegida: las reservas por sentar — «Sin mesa en <sala>» y
//         «Sin sala» — con la MISMA tarjeta del kanban (`ReservaCard`): tocarla
//         abre su menú, con «Dar mesa» (el mapa de siempre, `ElegirMesaDialog`) o
//         «Mover a…» (que tras mover abre ese mapa);
//       - con una mesa tocada: su número, su estado y la tarjeta de su reserva con
//         las acciones del kanban (Ha llegado, No vino, Editar, Llamar…), más
//         «Liberar mesa» / «Deshacer liberar» del modo servicio. Si la mesa está
//         libre, «Sentar aquí» a una reserva de esta sala sin mesa (el mismo RPC
//         atómico de siempre, que valida solapes en el servidor).
//   · El buscador y «Todo el día / Comida / Cena» de arriba mandan igual que en el
//     kanban: filtran las listas y, en el plano, resaltan las mesas que coinciden
//     y atenúan las demás. Con «Todo el día» se pinta el turno EN CURSO (una mesa
//     no puede enseñar la comida y la cena a la vez).
//
// DATOS Y TIEMPO REAL: las reservas de hoy llegan de `VistaHoy` (la consulta que
// ya tenía, con `llegada_at`/`salida_at` si existen) y las mesas asignadas son la
// misma consulta del kanban. `VistaHoy` ya monta `useReservasEnVivo` y el sondeo
// de cada minuto: aquí NO se abre ningún canal nuevo.
//
// ALTO: el bloque mide justo lo que queda de ventana (`useAlturaDisponible`, como
// el kanban): sin scroll de página; solo la lista de al lado se desplaza por dentro.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LayoutGrid, Loader2, Lock, LogOut, MessageSquareText, RotateCcw, Star, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useAsignacionesMesa, useAsignarMesasReserva } from "@/hooks/useAsignacionesMesa";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import { usePlanoEspacio } from "@/hooks/usePlanosEspacio";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAccionesModoServicio } from "@/hooks/useAccionesModoServicio";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { mesasPorReservaDe, useMovimientoReservaServicio } from "@/hooks/useMovimientoReservaServicio";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useIsBelow, useIsMobile } from "@/hooks/use-mobile";
import { useHoyLocal } from "@/hooks/useHoyLocal";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { SIN_ASIGNAR, columnaDeReserva, construirColumnas, esSinAsignar } from "@/lib/reservas/columnasServicio";
import { ocupaEspacio } from "@/lib/reservas/estadosReserva";
import { TITULO_SIN_PERMISO_EDITAR, accionesDisponibles } from "@/lib/reservas/accionesReserva";
import { turnoDeHora } from "@/lib/reservas/asignacionMesas";
import {
  ESTADOS_MESA_SERVICIO,
  configServicioSalaDesde,
  estadoMesaServicio,
  haLlegado,
  type EstadoMesaServicio,
  type ReservaMesaServicio,
  type ReservaServicio,
} from "@/lib/reservas/servicioSala";
import {
  ALTURA_MINIMA_PLANO_HOY,
  ALTURA_MINIMA_PLANO_HOY_MOVIL,
  coincideFiltroHoy,
  turnoDelPlano,
  type FiltroTurnoHoy,
} from "@/lib/reservas/vistaHoy";
import { BlacklistModal } from "../BlacklistModal";
import { ConMotivo } from "../ConMotivo";
import { EtiquetaFueraDeAforo } from "../EtiquetaFueraDeAforo";
import { ReservaCard } from "../ReservaCard";
import { CONFIG_ESTADO_MESA, textoMinutosMesa } from "./estadosMesa";
import { MapaSalaServicio } from "./MapaSalaServicio";

/** Reserva de hoy tal como la trae `VistaHoy` (`select("*")`): `salida_at`/`marca` si existen. */
export type ReservaPlanoHoy = ReservaMesaServicio & { marca?: string | null };

export interface VistaPlanoHoyProps {
  /** Reservas de hoy de Casa Tomás, sin canceladas (`undefined` mientras cargan). */
  reservas: ReservaPlanoHoy[] | undefined;
  busqueda: string;
  filtroTurno: FiltroTurnoHoy;
  /** Sala elegida (id de `espacios_reserva`); `null` o una que ya no existe = la primera. */
  salaId: string | null;
  onCambiarSala: (salaId: string) => void;
  /** Abre el reparto de mesas de la sala (la pantalla de siempre, `PlanoEspacio2D`). */
  onAbrirReparto?: (salaId: string) => void;
  /** Falló la consulta de reservas de hoy (la de `VistaHoy`): se dice, con «Reintentar», en vez de «Cargando…» para siempre. */
  reservasError?: boolean;
  onReintentarReservas?: () => void;
}

/**
 * Por debajo de este ancho la lista de al lado no cabe sin estrujar el plano: va en una hoja (la lista
 * «Por sentar» y la mesa tocada). Revisión de diseño (07/10/2026): a 1024 y 1280 la lista enseñaba una
 * tarjeta y el plano se quedaba en ~570×280 px.
 */
const ANCHO_PANEL_LATERAL = 1280;

/** «Sentar aquí» ofrece además «Solo dar la mesa» si para la hora de la reserva falta más que esto. */
const MINUTOS_SOLO_DAR_MESA = 30;

/** Cada cuánto se recalcula «ahora» (retrasos, minutos sentados): como el modo servicio. */
const INTERVALO_AHORA_MS = 45_000;

const porHora = (a: { hora: string }, b: { hora: string }) => String(a.hora).localeCompare(String(b.hora));

const ETIQUETA_TURNO = { comida: "Comida", cena: "Cena" } as const;

function useAhora(): Date {
  const [ahora, setAhora] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), INTERVALO_AHORA_MS);
    return () => window.clearInterval(id);
  }, []);
  return ahora;
}

export function VistaPlanoHoy({
  reservas,
  busqueda,
  filtroTurno,
  salaId,
  onCambiarSala,
  onAbrirReparto,
  reservasError = false,
  onReintentarReservas,
}: VistaPlanoHoyProps) {
  // Cambia a medianoche: la tablet se queda en «Hoy» toda la noche.
  const hoy = useHoyLocal();
  const esMovil = useIsMobile();
  const enHojas = useIsBelow(ANCHO_PANEL_LATERAL);
  const ahora = useAhora();
  const turno = turnoDelPlano(filtroTurno, ahora);

  // ── Salas: las de Casa Tomás, el Reservado (privada) la última ─────────────
  const { data: espacios } = useEspaciosReserva();
  const columnas = useMemo(() => construirColumnas(espacios), [espacios]);
  const salas = useMemo(() => {
    const deVerdad = columnas.filter((c) => !esSinAsignar(c.id));
    return [...deVerdad.filter((c) => !c.privada), ...deVerdad.filter((c) => c.privada)];
  }, [columnas]);
  const sala = salas.find((s) => s.id === salaId) ?? salas[0] ?? null;

  // ── Datos (consultas ya existentes; ningún canal realtime nuevo) ───────────
  const asignacionesQuery = useAsignacionesMesa(hoy, undefined, undefined, REFRESCO_PERIODICO);
  const asignacionesDeHoy = asignacionesQuery.data;
  const mesasQuery = useMesas(sala?.id, { habilitado: !!sala });
  const planoQuery = usePlanoEspacio(sala?.id);
  const plano = planoQuery.data;
  const { data: configReservas } = useConfiguracionReservas();
  const config = useMemo(() => configServicioSalaDesde(configReservas), [configReservas]);

  // ── Acciones: las del kanban y las del modo servicio ────────────────────────
  const acciones = useAccionesServicioReserva();
  const servicio = useAccionesModoServicio();
  const asignarMesas = useAsignarMesasReserva();
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const [blacklist, setBlacklist] = useState<ReservaServicio | null>(null);
  const lista = useMemo<ReservaPlanoHoy[]>(() => reservas ?? [], [reservas]);
  const mesasPorReserva = useMemo(() => mesasPorReservaDe(asignacionesDeHoy), [asignacionesDeHoy]);
  const { solicitarMovimiento, darMesa, dialogos } = useMovimientoReservaServicio({
    acciones,
    columnas,
    reservas: lista,
    mesasPorReserva,
    fecha: hoy,
  });

  // ── Alto: justo lo que queda de ventana (como el kanban) ────────────────────
  const [bloque, setBloque] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(bloque, esMovil ? ALTURA_MINIMA_PLANO_HOY_MOVIL : ALTURA_MINIMA_PLANO_HOY);
  const medida = alto !== null;

  // ── Qué reservas se ven (buscador y turno de arriba) ────────────────────────
  /** Con sala, que ocupe sitio y sin mesa. Sin las mesas cargadas no se acusa a nadie (como el kanban). */
  const estaSinMesa = useCallback(
    (r: ReservaServicio) =>
      asignacionesDeHoy !== undefined &&
      ocupaEspacio(r.estado) &&
      columnaDeReserva(r, columnas) !== SIN_ASIGNAR &&
      !mesasPorReserva.has(r.id),
    [asignacionesDeHoy, columnas, mesasPorReserva],
  );
  const visibles = useMemo(
    () => lista.filter((r) => coincideFiltroHoy(r, { busqueda, filtroTurno })),
    [lista, busqueda, filtroTurno],
  );
  const resumenPorSala = useMemo(() => {
    const resumen = new Map<string, { total: number; sinMesa: number }>();
    for (const s of salas) resumen.set(s.id, { total: 0, sinMesa: 0 });
    for (const r of visibles) {
      const cuenta = resumen.get(columnaDeReserva(r, columnas));
      if (!cuenta) continue;
      cuenta.total += 1;
      if (estaSinMesa(r)) cuenta.sinMesa += 1;
    }
    return resumen;
  }, [salas, visibles, columnas, estaSinMesa]);
  const pendientesSala = useMemo(
    () => (sala ? visibles.filter((r) => columnaDeReserva(r, columnas) === sala.id && estaSinMesa(r)).sort(porHora) : []),
    [sala, visibles, columnas, estaSinMesa],
  );
  const sinSala = useMemo(
    () =>
      visibles.filter((r) => columnaDeReserva(r, columnas) === SIN_ASIGNAR && ocupaEspacio(r.estado)).sort(porHora),
    [visibles, columnas],
  );

  // ── Mesas de la sala y su estado en el turno que se pinta ───────────────────
  const mesas = useMemo(
    () => [...(mesasQuery.data ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })),
    [mesasQuery.data],
  );
  const asignacionesSala = useMemo(() => {
    const ids = new Set(mesas.map((m) => m.id));
    return (asignacionesDeHoy ?? [])
      .filter((a) => ids.has(a.mesa_id))
      .map((a) => ({ mesa_id: a.mesa_id, reserva_id: a.reserva_id }));
  }, [mesas, asignacionesDeHoy]);
  const estados = useMemo(
    () => new Map(mesas.map((m) => [m.id, estadoMesaServicio(m.id, asignacionesSala, lista, turno, ahora, config)])),
    [mesas, asignacionesSala, lista, turno, ahora, config],
  );
  /** El cartel con el nombre va en UNA de las mesas de cada reserva (la de número más bajo). */
  const conCartel = useMemo(() => {
    const yaPuestas = new Set<string>();
    const mesasConCartel = new Set<string>();
    for (const m of mesas) {
      const r = estados.get(m.id)?.reserva;
      if (r && !yaPuestas.has(r.id)) {
        yaPuestas.add(r.id);
        mesasConCartel.add(m.id);
      }
    }
    return mesasConCartel;
  }, [mesas, estados]);
  const coincidentes = useMemo(() => {
    if (!busqueda.trim()) return null;
    const encontradas = new Set<string>();
    for (const m of mesas) {
      const r = estados.get(m.id)?.reserva;
      if (r && coincideFiltroHoy(r, { busqueda, filtroTurno: "todo" })) encontradas.add(m.id);
    }
    return encontradas;
  }, [busqueda, mesas, estados]);
  const recuento = useMemo(() => {
    const acc: Record<EstadoMesaServicio, number> = { libre: 0, reservada: 0, retrasada: 0, ocupada: 0, por_liberar: 0 };
    for (const m of mesas) acc[estados.get(m.id)?.estado ?? "libre"] += 1;
    return acc;
  }, [mesas, estados]);

  // ── Mesa tocada ─────────────────────────────────────────────────────────────
  const [mesaSelId, setMesaSelId] = useState<string | null>(null);
  const [pendientesAbiertos, setPendientesAbiertos] = useState(false);
  const [sentando, setSentando] = useState<string | null>(null);
  useEffect(() => setMesaSelId(null), [sala?.id]);
  const mesaSel = mesas.find((m) => m.id === mesaSelId) ?? null;
  const estadoSel = mesaSel ? estados.get(mesaSel.id) ?? null : null;
  /** Las reservas de esa mesa en el turno que se pinta (las ya liberadas también, para poder deshacerlo). */
  const reservasDeMesa = useMemo(() => {
    if (!mesaSel) return [];
    const ids = new Set(asignacionesSala.filter((a) => a.mesa_id === mesaSel.id).map((a) => a.reserva_id));
    return lista.filter((r) => ids.has(r.id) && turnoDeHora(r.hora) === turno && ocupaEspacio(r.estado)).sort(porHora);
  }, [mesaSel, asignacionesSala, lista, turno]);
  /** Mesa libre: las reservas de esta sala sin mesa de este turno, para sentarlas aquí. */
  const candidatas = useMemo(
    () => (mesaSel && estadoSel?.estado === "libre" ? pendientesSala.filter((r) => turnoDeHora(r.hora) === turno) : []),
    [mesaSel, estadoSel, pendientesSala, turno],
  );

  const tocarMesa = (mesa: Mesa) => setMesaSelId((actual) => (actual === mesa.id ? null : mesa.id));

  /**
   * «Sentar aquí»: la persona está en la sala, así que se le da la mesa Y se marca «Ha llegado» (la misma
   * acción que el kanban). Antes solo se daba la mesa: la reserva seguía «por llegar», pasaba a «Retrasada»
   * y, a las 3 h, el cron la marcaba «No vino» y proponía la lista negra a un cliente que había venido.
   * `conLlegada = false` («Solo dar la mesa», para reservar sitio a quien aún no ha llegado).
   */
  const sentarAqui = async (reserva: ReservaServicio, conLlegada: boolean) => {
    if (!mesaSel) return;
    setSentando(reserva.id);
    try {
      // Sustituye las mesas de la reserva (ninguna) por esta: el RPC valida sala, estado y solapes.
      await asignarMesas.mutateAsync({ reserva_id: reserva.id, mesa_ids: [mesaSel.id] });
    } catch {
      // El aviso de error lo pone el propio hook (`mensajeErrorAsignacion`). Sin mesa no se marca nada.
      return;
    } finally {
      setSentando(null);
    }
    if (
      conLlegada &&
      !haLlegado(reserva.estado) &&
      accionesDisponibles(reserva, { vista: "hoy", canEdit: puedeEditar }).haLlegado.habilitada
    ) {
      await acciones.marcarLlegada(reserva);
    }
  };

  /** Minutos que faltan para la hora de la reserva (negativo: ya pasó). */
  const minutosParaLaHora = (hora: string) => {
    const [h, m] = String(hora).split(":").map(Number);
    return h * 60 + (m || 0) - (ahora.getHours() * 60 + ahora.getMinutes());
  };

  const etiquetaTurno = `${ETIQUETA_TURNO[turno]}${filtroTurno === "todo" ? " · turno en curso" : ""}`;

  // ── ¿Está todo cargado? (revisión 07/10/2026) ─────────────────────────────
  // Sin las mesas asignadas (cargando o con error) cada mesa salía «Libre» y la lista decía «Todas las
  // reservas tienen mesa»: datos falsos en pleno servicio. Mientras falte algo, esqueleto; si falla,
  // se dice, con «Reintentar».
  const cargando =
    (reservas === undefined && !reservasError) ||
    espacios === undefined ||
    asignacionesQuery.isLoading ||
    (!!sala && (mesasQuery.isLoading || planoQuery.isLoading));
  const errorDatos = reservasError || asignacionesQuery.isError;
  const listo = !cargando && !errorDatos;
  const reintentar = () => {
    if (asignacionesQuery.isError) void asignacionesQuery.refetch();
    if (reservasError) onReintentarReservas?.();
  };
  const avisoError = (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm" role="alert">
      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
      <p className="font-medium">
        {reservasError ? "No se pudieron cargar las reservas de hoy." : "No se pudieron cargar las mesas asignadas de hoy."}
      </p>
      <p className="text-muted-foreground">Sin eso no se sabe qué mesas están libres: no se enseña nada que pueda ser falso.</p>
      <Button variant="outline" className="h-11" onClick={reintentar}>
        Reintentar
      </Button>
    </div>
  );
  const esqueletoLista = (
    <div className="space-y-2 p-3" role="status" aria-label="Cargando las reservas…">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/50" />
      ))}
    </div>
  );

  // ── Piezas ──────────────────────────────────────────────────────────────────
  const tarjeta = (r: ReservaServicio) => (
    <ReservaCard
      reserva={r}
      columnas={columnas}
      acciones={acciones}
      onMover={solicitarMovimiento}
      onToggleImportante={(x) => void acciones.alternarImportante(x)}
      onBlacklist={setBlacklist}
      onEditar={(x) => editarReserva(x.id)}
      onDarMesa={darMesa}
      sinMesa={estaSinMesa(r)}
      mesas={mesasPorReserva.get(r.id)}
      puedeEditar={puedeEditar}
      sinArrastre
      telefonoEnlace
    />
  );

  const leyendaEn = (enFila: boolean) => (
    <ul aria-label="Leyenda de estados de mesa" className={cn("flex gap-1.5", enFila ? "flex-nowrap" : "flex-wrap")}>
      {ESTADOS_MESA_SERVICIO.map((estado) => {
        const { etiqueta, Icono, badge } = CONFIG_ESTADO_MESA[estado];
        return (
          <li key={estado} className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium", badge)}>
            <Icono className="h-3.5 w-3.5" aria-hidden="true" />
            {etiqueta}
            <span className="tabular-nums opacity-80">{recuento[estado]}</span>
          </li>
        );
      })}
    </ul>
  );
  const leyenda = leyendaEn(false);

  const grupo = (titulo: string, reservasGrupo: ReservaServicio[], vacio: string) => (
    <section aria-label={titulo} className="space-y-2">
      <h4 className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
        {titulo}
        <Badge variant="outline" className="h-5 px-1.5 text-xs tabular-nums">
          {reservasGrupo.length}
        </Badge>
      </h4>
      {reservasGrupo.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="space-y-2">
          {reservasGrupo.map((r) => (
            <li key={r.id} className="min-w-0">
              {tarjeta(r)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const panelPendientes = sala && !listo ? (errorDatos ? avisoError : esqueletoLista) : sala && (
    <div className="space-y-4 p-3">
      {grupo(`Sin mesa en ${sala.title}`, pendientesSala, `Todas las reservas de ${sala.title} tienen mesa.`)}
      {grupo("Sin sala", sinSala, "No hay reservas sin sala.")}
      <p className="text-[13px] text-muted-foreground">
        Toca una tarjeta para sus acciones: «Dar mesa» abre el plano para elegirla y «Mover a…» la pasa a otra sala.
      </p>
    </div>
  );

  const datosMesa = mesaSel ? `${mesaSel.capacidad} plazas · ${sala?.title ?? ""} · ${ETIQUETA_TURNO[turno]}` : "";

  const panelMesa = mesaSel && (
    <div className="space-y-3 p-3" data-testid="detalle-mesa">
      {/* En una hoja (móvil y tablet) el título y los datos van en su cabecera. */}
      {!enHojas && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{`Mesa ${mesaSel.nombre}`}</h3>
            <p className="flex items-center gap-1 text-[13px] text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {datosMesa}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Cerrar la mesa" onClick={() => setMesaSelId(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {estadoSel && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-medium",
              CONFIG_ESTADO_MESA[estadoSel.estado].badge,
            )}
          >
            {CONFIG_ESTADO_MESA[estadoSel.estado].etiqueta}
          </span>
          {textoMinutosMesa(estadoSel.estado, estadoSel.minutos) && (
            <span className="text-[13px] font-medium">{textoMinutosMesa(estadoSel.estado, estadoSel.minutos)}</span>
          )}
        </div>
      )}

      {reservasDeMesa.map((r) => (
        <div key={r.id} className="space-y-2">
          {(r.importante || r.notas_cliente?.trim()) && (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[13px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="aviso-reserva-mesa">
              {r.importante && (
                <p className="flex items-center gap-1 font-semibold">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-600" aria-hidden="true" /> Reserva importante
                </p>
              )}
              {r.notas_cliente?.trim() && (
                <p className="flex items-start gap-1">
                  <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-words">
                    <span className="font-semibold">Nota: </span>
                    {r.notas_cliente.trim()}
                  </span>
                </p>
              )}
            </div>
          )}
          {/* Liberar / deshacer: lo del modo servicio (solo `salida_at`; la reserva sigue «Llegó»). Antes que
              la tarjeta: es lo que se viene a hacer a una mesa «por liberar», y en la tablet apaisada la
              tarjeta entera no cabe a la vista. */}
          {haLlegado(r.estado) && (
            <ConMotivo className="flex" motivo={puedeEditar ? undefined : TITULO_SIN_PERMISO_EDITAR}>
              {r.salida_at ? (
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  disabled={!puedeEditar || servicio.estaEnCurso(r.id)}
                  onClick={() => void servicio.deshacerLiberarMesa(r)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Deshacer liberar
                </Button>
              ) : (
                <Button
                  variant={estadoSel?.estado === "por_liberar" ? "default" : "outline"}
                  className="h-11 w-full"
                  disabled={!puedeEditar || servicio.estaEnCurso(r.id)}
                  onClick={() => void servicio.liberarMesa(r)}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Liberar mesa
                </Button>
              )}
            </ConMotivo>
          )}
          {tarjeta(r)}
        </div>
      ))}

      {estadoSel?.estado === "libre" && (
        <section aria-label="Sentar aquí" className="space-y-2">
          <p className="text-[13px] text-muted-foreground">
            {candidatas.length > 0
              ? `Libre. Sentar aquí a una reserva de ${sala?.title ?? "la sala"} sin mesa:`
              : `Libre. No hay reservas de ${sala?.title ?? "la sala"} sin mesa en la ${ETIQUETA_TURNO[turno].toLowerCase()}.`}
          </p>
          <ul className="space-y-1.5">
            {candidatas.map((r) => {
              const pax = Number(r.numero_comensales) || 0;
              const noCaben = pax > (mesaSel.capacidad || 0);
              const yaLlego = haLlegado(r.estado);
              const ofrecerSoloMesa = !yaLlego && minutosParaLaHora(r.hora) > MINUTOS_SOLO_DAR_MESA;
              const nombre = r.nombre || "sin nombre";
              const hora = String(r.hora).slice(0, 5);
              return (
                <li key={r.id} className="space-y-1.5 rounded-lg border bg-background p-2">
                  <p className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="tabular-nums">{hora}</span> · {r.nombre || "Sin nombre"}
                    </span>
                    <span className={cn("shrink-0 text-[13px] tabular-nums", noCaben ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                      {sentando === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Guardando" /> : `${pax} pax${noCaben ? " · no caben" : ""}`}
                    </span>
                  </p>
                  <ConMotivo className="flex flex-wrap gap-1.5" motivo={puedeEditar ? undefined : TITULO_SIN_PERMISO_EDITAR}>
                    <Button
                      className="h-11 flex-1"
                      disabled={!puedeEditar || sentando !== null}
                      onClick={() => void sentarAqui(r, true)}
                      aria-label={
                        `Sentar en la mesa ${mesaSel.nombre} a ${nombre}, ${hora}, ${pax} comensales` +
                        (yaLlego ? "" : ": le da la mesa y marca que ha llegado")
                      }
                    >
                      Sentar aquí
                    </Button>
                    {ofrecerSoloMesa && (
                      <Button
                        variant="outline"
                        className="h-11 flex-1"
                        disabled={!puedeEditar || sentando !== null}
                        onClick={() => void sentarAqui(r, false)}
                        aria-label={`Solo dar la mesa ${mesaSel.nombre} a ${nombre}, ${hora}: todavía no ha llegado`}
                      >
                        Solo dar la mesa
                      </Button>
                    )}
                  </ConMotivo>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );

  // ── Pantalla ──────────────────────────────────────────────────────────────

  return (
    <div
      ref={setBloque}
      data-testid="plano-hoy"
      data-altura-fija={medida ? String(alto) : undefined}
      className={cn("flex min-w-0 flex-col gap-2", medida ? "flex-none" : "h-[65dvh] min-h-[420px]")}
      style={medida ? { height: alto } : undefined}
    >
      {salas.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border text-sm text-muted-foreground" role="status">
          {espacios === undefined ? "Cargando salas…" : "No hay salas de Casa Tomás activas. Se crean en Espacios."}
        </div>
      ) : (
        <Tabs
          value={sala?.id ?? ""}
          onValueChange={(valor) => valor && onCambiarSala(valor)}
          className="flex min-h-0 flex-1 flex-col gap-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <TabsList aria-label="Salas" className="h-auto min-h-10 min-w-0 justify-start">
              {salas.map((s) => {
                const cuenta = resumenPorSala.get(s.id) ?? { total: 0, sinMesa: 0 };
                // Sin datos completos no se dan cifras (un «0» sería falso).
                if (!listo) {
                  return (
                    <TabsTrigger key={s.id} value={s.id} className="gap-1.5" aria-label={s.title}>
                      {s.privada && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                      <span>{s.title}</span>
                      {s.privada && <EtiquetaFueraDeAforo className="h-5 text-xs" />}
                    </TabsTrigger>
                  );
                }
                return (
                  <TabsTrigger
                    key={s.id}
                    value={s.id}
                    className="gap-1.5"
                    aria-label={
                      `${s.title}: ${cuenta.total} ${cuenta.total === 1 ? "reserva" : "reservas"}` +
                      (cuenta.sinMesa ? `, ${cuenta.sinMesa} sin mesa` : "") +
                      (s.privada ? ", sala privada fuera de aforo" : "")
                    }
                  >
                    {s.privada && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span>{s.title}</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs tabular-nums">
                      {cuenta.total}
                    </Badge>
                    {/* En el móvil no cabe: la barra «Por sentar» ya dice los «sin mesa» de la sala elegida. */}
                    {cuenta.sinMesa > 0 && (
                      <span className="hidden text-[13px] font-normal tabular-nums text-muted-foreground sm:inline">{`· ${cuenta.sinMesa} sin mesa`}</span>
                    )}
                    {s.privada && <EtiquetaFueraDeAforo className="h-5 text-xs" />}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {onAbrirReparto && sala && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-10 shrink-0 gap-1.5"
                onClick={() => onAbrirReparto(sala.id)}
                aria-label={`Abrir el reparto de mesas de ${sala.title}`}
                title="Repartir mesas, juntar, PDF del servicio…"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">Reparto de mesas</span>
              </Button>
            )}
          </div>

          {sala && (
            <TabsContent
              value={sala.id}
              className={cn(
                "mt-0 grid min-h-0 flex-1 gap-2 focus-visible:ring-offset-0",
                // Por debajo de 1280 px, el plano a todo lo ancho y la lista en una hoja.
                enHojas ? "grid-cols-1 grid-rows-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_23rem] gap-3",
              )}
            >
              {/* El plano: no se desplaza (se ajusta, y se acerca o se mueve con los dedos). */}
              <section
                aria-label={`Plano de ${sala.title}`}
                className="relative min-h-0 overflow-hidden rounded-xl border bg-card"
              >
                {errorDatos ? (
                  avisoError
                ) : cargando ? (
                  <div className="flex h-full items-center justify-center gap-2 text-muted-foreground" role="status" data-testid="plano-cargando">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Cargando el plano…
                  </div>
                ) : mesasQuery.isError ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground" role="alert">
                    {`No se pudieron cargar las mesas de ${sala.title}. `}
                    <Button variant="link" className="h-auto p-0" onClick={() => void mesasQuery.refetch()}>
                      Reintentar
                    </Button>
                  </div>
                ) : (
                  <MapaSalaServicio
                    key={sala.id}
                    salaNombre={sala.title}
                    mesas={mesas}
                    elementos={plano?.configuracion?.elementos ?? []}
                    pixelsPorMetro={plano?.pixels_per_meter || 50}
                    anchoMetros={plano?.ancho_metros || 12}
                    altoMetros={plano?.alto_metros || 8}
                    estados={estados}
                    conCartel={conCartel}
                    seleccionada={mesaSelId}
                    coincidentes={coincidentes}
                    onTocarMesa={tocarMesa}
                  />
                )}
                <p className="pointer-events-none absolute left-2 top-2 rounded-md border bg-background/90 px-2 py-1 text-[13px] font-medium shadow-sm backdrop-blur-sm">
                  {etiquetaTurno}
                </p>
              </section>

              {enHojas ? (
                <div className="flex min-w-0 items-center gap-2">
                  {!esMovil && listo && <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">{leyendaEn(true)}</div>}
                  <Button
                    variant="outline"
                    className={cn("h-11 justify-between gap-3", esMovil ? "w-full" : "ml-auto shrink-0")}
                    disabled={!listo}
                    onClick={() => setPendientesAbiertos(true)}
                    aria-label={
                      listo
                        ? `Por sentar: ${pendientesSala.length} sin mesa en ${sala.title} y ${sinSala.length} sin sala`
                        : "Por sentar: cargando"
                    }
                  >
                    <span>Por sentar</span>
                    <span className="text-[13px] tabular-nums text-muted-foreground">
                      {listo ? `${pendientesSala.length} sin mesa · ${sinSala.length} sin sala` : "…"}
                    </span>
                  </Button>
                </div>
              ) : (
                <aside
                  aria-label={mesaSel ? `Mesa ${mesaSel.nombre}` : "Reservas por sentar"}
                  className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-muted/20"
                >
                  {/* Con una mesa tocada sobra (su estado se dice con palabras) y deja sitio a la mesa. */}
                  {!mesaSel && listo && <div className="shrink-0 border-b p-3">{leyenda}</div>}
                  {/* Lo único que se desplaza: la lista, por dentro. */}
                  <ScrollArea className="min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
                    {mesaSel ? panelMesa : panelPendientes}
                  </ScrollArea>
                </aside>
              )}
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Por debajo de 1280 px: la mesa tocada y la lista por sentar, en hojas (de lado en tablet, desde abajo en móvil). */}
      {enHojas && (
        <>
          <Sheet open={!!mesaSel} onOpenChange={(abierta) => !abierta && setMesaSelId(null)}>
            <SheetContent
              side={esMovil ? "bottom" : "right"}
              className={cn("overflow-y-auto p-0", esMovil ? "max-h-[85dvh]" : "w-[min(92vw,26rem)] sm:max-w-none")}
            >
              <SheetHeader className="px-3 pt-3 text-left">
                <SheetTitle>{mesaSel ? `Mesa ${mesaSel.nombre}` : "Mesa"}</SheetTitle>
                <SheetDescription>{datosMesa}</SheetDescription>
              </SheetHeader>
              {panelMesa}
            </SheetContent>
          </Sheet>
          <Sheet open={pendientesAbiertos} onOpenChange={setPendientesAbiertos}>
            <SheetContent
              side={esMovil ? "bottom" : "right"}
              className={cn("overflow-y-auto p-0", esMovil ? "max-h-[85dvh]" : "w-[min(92vw,26rem)] sm:max-w-none")}
            >
              <SheetHeader className="px-3 pt-3 text-left">
                <SheetTitle>Por sentar</SheetTitle>
                <SheetDescription>{etiquetaTurno}</SheetDescription>
              </SheetHeader>
              <div className="px-3 pt-3">{leyenda}</div>
              {panelPendientes}
            </SheetContent>
          </Sheet>
        </>
      )}

      {/* Confirmar movimientos y el mapa para elegir mesa (los del kanban), lista negra y editor. */}
      {dialogos}
      <BlacklistModal
        reserva={blacklist}
        open={!!blacklist}
        onOpenChange={(abierto) => {
          if (!abierto) setBlacklist(null);
        }}
      />
      {dialogoEdicion}
    </div>
  );
}
