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
//     (sala privada) va el último, con candado.
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
// SOLO «VER» (06/11/2026, decisión del dueño): sin «Editar» en Reservas se ve todo
// (salas, mesas con su estado, reservas, notas) pero no sale nada que escriba:
// ni las acciones de la tarjeta, ni «Liberar mesa», ni «Sentar aquí», ni las piezas,
// ni el interruptor de la terraza, ni «Plano base». Se ocultan, no se desactivan.
//
// DATOS Y TIEMPO REAL: las reservas de hoy llegan de `VistaHoy` (la consulta que
// ya tenía, con `llegada_at`/`salida_at` si existen) y las mesas asignadas son la
// misma consulta del kanban. `VistaHoy` ya monta `useReservasEnVivo` y el sondeo
// de cada minuto: aquí NO se abre ningún canal nuevo.
//
// ALTO: el bloque mide justo lo que queda de ventana (`useAlturaDisponible`, como
// el kanban): sin scroll de página; solo la lista de al lado se desplaza por dentro.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ListChecks, Loader2, Lock, LogOut, MessageSquareText, RotateCcw, Star, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { decidirSoltar } from "@/lib/reservas/sentarAhora";
import { reservasConMesaEnSala, yaAtendida } from "@/lib/reservas/hoyMovil";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  CLAVE_AJUSTES_MESA,
  guardarAjustesServicio,
  useAjustesMesaServicio,
  useVolverAPlanoBase,
  type TurnoServicio,
} from "@/hooks/useAjustesMesaServicio";
import { useSalaCerradaServicio } from "@/hooks/useSalaCerradaServicio";
import {
  estadoServicio,
  geometriaServicio,
  mesaPiezasDesde,
  type AjusteMesa,
  type MesaPiezas,
  type ReservaEnMesas,
} from "@/lib/reservas/piezasMesa";
import { aplicarPosicionesUnion, dibujarUniones } from "@/lib/reservas/dibujoMesas";
import type { PiezasDibujo } from "../DibujoPiezas";
import {
  ajustesPropuestos,
  disposicionPropuesta,
  mesasQueCambian,
  type MovimientoOrg,
} from "@/lib/reservas/organizarServicio";
import { DialogoPropuestaPiezas, PanelPiezasMesa, type PropuestaAbierta } from "../PiezasMesa";
import { ListaPropuesta, usePropuestaOrganizar } from "../OrganizarServicio";
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
import { useFijarMesa } from "@/hooks/useMesaFijada";
import { mesasPorReservaDe, useMovimientoReservaServicio } from "@/hooks/useMovimientoReservaServicio";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useIsBelow, useIsMobile } from "@/hooks/use-mobile";
import { useHoyLocal } from "@/hooks/useHoyLocal";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { SIN_ASIGNAR, columnaDeReserva, construirColumnas, esSinAsignar } from "@/lib/reservas/columnasServicio";
import { ocupaEspacio } from "@/lib/reservas/estadosReserva";
import { accionesDisponibles } from "@/lib/reservas/accionesReserva";
import { turnoDeHora } from "@/lib/reservas/asignacionMesas";
import { esGrupoGrande, esSalaMesaLarga, sugerenciaGrupoGrande, type SugerenciaGrupo } from "@/lib/reservas/grupoGrande";
import { esSalaPrivada } from "@/lib/reservas/salaPrivada";
import {
  ESTADOS_MESA_SERVICIO,
  configServicioSalaDesde,
  estadoMesaServicio,
  haLlegado,
  type EstadoMesaServicio,
  type ResultadoEstadoMesa,
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
import { ReservaCard } from "../ReservaCard";
import { CONFIG_ESTADO_MESA, textoMinutosMesa } from "./estadosMesa";
import { MapaSalaServicio } from "./MapaSalaServicio";
import { MesasGrandesSala } from "./MesasGrandesSala";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

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
  /** Abre el reparto de mesas de la sala (`PlanoEspacio2D`). Desde el 10/10/2026 Hoy ya no lo ofrece. */
  onAbrirReparto?: (salaId: string) => void;
  /**
   * «Organizar» (10/10/2026): el plano pasa a MODO PROPUESTA de ese turno. Cada sala enseña cómo
   * quedarían las mesas; nada se guarda hasta «Aplicar». `onSalir` vuelve al plano normal.
   */
  organizar?: { turno: TurnoServicio; onSalir: () => void } | null;
  /** Falló la consulta de reservas de hoy (la de `VistaHoy`): se dice, con «Reintentar», en vez de «Cargando…» para siempre. */
  reservasError?: boolean;
  onReintentarReservas?: () => void;
  /**
   * «Hoy» de ESCRITORIO (07/11/2026, petición del dueño): plano grande y FIJO, una sala a la vez. En vez de
   * las pestañas, el nombre de la sala en grande («Comedor 1/3») y flechas grandes a los lados del plano (y
   * las teclas ← →) para pasar de sala. El plano no se acerca ni se mueve (`MapaSalaServicio` `fijo`) y la
   * mesa tocada y «Por sentar» van en hojas, para dejarle al plano todo el sitio.
   */
  fijo?: boolean;
  /**
   * Reserva señalada en la lista de la izquierda («Hoy» de escritorio, 07/11/2026): al pasar el ratón o al
   * abrirla, sus mesas se resaltan y, si están en otra sala, el plano salta a esa sala (solo `fijo`).
   */
  reservaResaltada?: string | null;
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
  organizar = null,
  reservasError = false,
  onReintentarReservas,
  fijo = false,
  reservaResaltada: reservaResaltadaExterna = null,
}: VistaPlanoHoyProps) {
  // Cambia a medianoche: la tablet se queda en «Hoy» toda la noche.
  const hoy = useHoyLocal();
  const esMovil = useIsMobile();
  const enHojas = useIsBelow(ANCHO_PANEL_LATERAL) || fijo;
  const ahora = useAhora();
  const turno: TurnoServicio = organizar?.turno ?? turnoDelPlano(filtroTurno, ahora);
  const proponiendo = !!organizar;

  // ── Salas: las de Casa Tomás, el Reservado (privada) la última ─────────────
  const { data: espacios } = useEspaciosReserva();
  const columnas = useMemo(() => construirColumnas(espacios), [espacios]);
  const salas = useMemo(() => {
    const deVerdad = columnas.filter((c) => !esSinAsignar(c.id));
    return [...deVerdad.filter((c) => !c.privada), ...deVerdad.filter((c) => c.privada)];
  }, [columnas]);
  const sala = salas.find((s) => s.id === salaId) ?? salas[0] ?? null;
  const indiceSala = sala ? salas.findIndex((s) => s.id === sala.id) : -1;
  /** Plano fijo: la sala anterior o la siguiente (da la vuelta). */
  const irSala = useCallback(
    (paso: number) => {
      if (salas.length < 2 || indiceSala < 0) return;
      onCambiarSala(salas[(indiceSala + paso + salas.length) % salas.length].id);
    },
    [salas, indiceSala, onCambiarSala],
  );
  // Teclas ← → (solo el plano fijo), salvo escribiendo o con un diálogo u hoja abiertos.
  useEffect(() => {
    if (!fijo) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const destino = e.target as HTMLElement | null;
      if (destino?.closest?.("input, textarea, select, [contenteditable='true'], [role='slider'], [role='tablist'], [role='radiogroup'], [role='group']")) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']")) return;
      e.preventDefault();
      irSala(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [fijo, irSala]);

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
  const fijarMesa = useFijarMesa();
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
  /** «Reservas en <sala>»: las que ya tienen mesa (turno y buscador aplicados), las atendidas al final. */
  const conMesaSala = useMemo(
    () =>
      sala
        ? reservasConMesaEnSala(
            visibles.filter((r) => turnoDeHora(r.hora) === turno || filtroTurno === "todo"),
            sala.id,
            (id) => mesasPorReserva.has(id),
          )
        : [],
    [sala, visibles, turno, filtroTurno, mesasPorReserva],
  );
  const sinSala = useMemo(
    () =>
      visibles.filter((r) => columnaDeReserva(r, columnas) === SIN_ASIGNAR && ocupaEspacio(r.estado)).sort(porHora),
    [visibles, columnas],
  );

  // ── «Organizar»: la propuesta de todo el servicio (solo en modo propuesta) ─
  const org = usePropuestaOrganizar(hoy, turno, proponiendo);
  const movimientos = useMemo<MovimientoOrg[]>(() => org.resultado?.movimientos ?? [], [org.resultado]);
  const cambian = useMemo(() => mesasQueCambian(movimientos), [movimientos]);
  const [verSinSitio, setVerSinSitio] = useState(false);

  // ── Piezas, picos y uniones del servicio (los de verdad, o los propuestos) ─
  const qc = useQueryClient();
  const ajustesQuery = useAjustesMesaServicio(sala?.id ?? "", hoy, turno);
  const ajustesSala = useMemo(() => {
    if (!proponiendo) return ajustesQuery.data ?? [];
    const delTurno = (org.ajustesDia ?? []).filter((a) => a.turno === turno);
    return ajustesPropuestos(delTurno, movimientos).filter((a) => a.espacioId === sala?.id);
  }, [proponiendo, ajustesQuery.data, org.ajustesDia, turno, movimientos, sala?.id]);
  const mesasBase = useMemo(
    () => [...(mesasQuery.data ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })),
    [mesasQuery.data],
  );
  const mesasPiezas = useMemo(
    () => mesasBase.map(mesaPiezasDesde).filter((m): m is MesaPiezas => m !== null),
    [mesasBase],
  );
  const estadoPiezas = useMemo(() => estadoServicio(mesasPiezas, ajustesSala), [mesasPiezas, ajustesSala]);
  /** Las mesas como están (o quedarían) en este servicio: largo y plazas recalculados; sin piezas, fuera. */
  const { mesas, unionesMapa, piezasMapa } = useMemo(() => {
    const piezas = new Map<string, PiezasDibujo>();
    const conPiezas = mesasBase
      .filter((m) => (estadoPiezas.get(m.id)?.piezas ?? 1) > 0)
      .map((m) => {
        const g = geometriaServicio(m, estadoPiezas.get(m.id));
        if (!g) return m;
        piezas.set(m.id, { piezas: g.piezas, picos: g.picos, ladoPico: g.ladoPico, vertical: g.vertical });
        return { ...m, pos_x: g.pos_x, pos_y: g.pos_y, ancho: g.ancho, alto: g.alto, capacidad: g.capacidad };
      });
    // Mesas juntas en este servicio: UNA mesa larga (piezas en fila, horizontal si cabe) dentro de
    // las paredes del plano y sin pisar otras mesas, con contorno y rótulo comunes.
    const dibujo = dibujarUniones(
      conPiezas.map((m) => ({ ...m, vertical: piezas.get(m.id)?.vertical })),
      estadoPiezas,
      { plano },
    );
    for (const [id, giro] of dibujo.giros) {
      const info = piezas.get(id);
      if (info) piezas.set(id, { ...info, ...giro });
    }
    return { mesas: aplicarPosicionesUnion(conPiezas, dibujo), unionesMapa: dibujo.uniones, piezasMapa: piezas };
  }, [mesasBase, estadoPiezas, plano]);
  const asignacionesSala = useMemo(() => {
    const ids = new Set(mesas.map((m) => m.id));
    return (asignacionesDeHoy ?? [])
      .filter((a) => ids.has(a.mesa_id))
      .map((a) => ({ mesa_id: a.mesa_id, reserva_id: a.reserva_id }));
  }, [mesas, asignacionesDeHoy]);
  const estadosReales = useMemo(
    () => new Map(mesas.map((m) => [m.id, estadoMesaServicio(m.id, asignacionesSala, lista, turno, ahora, config)])),
    [mesas, asignacionesSala, lista, turno, ahora, config],
  );
  /** En la propuesta: cada mesa con la reserva que tendría (nombre y personas en el cartel). */
  const estados = useMemo(() => {
    if (!proponiendo) return estadosReales;
    const disposicion = disposicionPropuesta(org.mesasDe, movimientos);
    const porId = new Map(lista.map((r) => [r.id, r]));
    return new Map<string, ResultadoEstadoMesa>(
      mesas.map((m): [string, ResultadoEstadoMesa] => {
        const r = porId.get(disposicion.get(m.id) ?? "");
        if (!r || r.salida_at || r.estado === "no_show") return [m.id, { estado: "libre", reserva: null, minutos: null }];
        return [
          m.id,
          {
            estado: haLlegado(r.estado) ? "ocupada" : "reservada",
            reserva: { ...r, nombre: `${r.nombre || "Reserva"} · ${r.numero_comensales}` },
            minutos: null,
          },
        ];
      }),
    );
  }, [proponiendo, estadosReales, org.mesasDe, movimientos, lista, mesas]);
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
    // En la propuesta se resaltan las mesas que cambian (y se atenúan las demás).
    if (proponiendo) return cambian.size > 0 ? new Set(mesas.filter((m) => cambian.has(m.id)).map((m) => m.id)) : null;
    if (!busqueda.trim()) return null;
    const encontradas = new Set<string>();
    for (const m of mesas) {
      const r = estados.get(m.id)?.reserva;
      if (r && coincideFiltroHoy(r, { busqueda, filtroTurno: "todo" })) encontradas.add(m.id);
    }
    return encontradas;
  }, [proponiendo, cambian, busqueda, mesas, estados]);
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

  // ── Dar mesa arrastrando (pulsación larga) o con «Elegir mesa en el plano» (10/10/2026) ─
  /** La reserva que se está arrastrando, o para la que se elige mesa tocando el plano. */
  const [arrastrando, setArrastrando] = useState<ReservaServicio | null>(null);
  const [eligiendoPara, setEligiendoPara] = useState<ReservaServicio | null>(null);
  useEffect(() => setEligiendoPara(null), [sala?.id, proponiendo]);
  const sensores = useSensors(
    // Ratón: a los 6 px. Dedo: pulsación larga (250 ms, 8 px de margen); deslizar sigue siendo scroll.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const tocarMesa = (mesa: Mesa) => {
    if (eligiendoPara && puedeEditar) {
      const r = eligiendoPara;
      setEligiendoPara(null);
      void soltar(r, mesa);
      return;
    }
    setMesaSelId((actual) => (actual === mesa.id ? null : mesa.id));
  };

  // ── Piezas desde la ficha de mesa (lo que antes solo estaba en «Reparto de mesas») ─
  const [propuestaPiezas, setPropuestaPiezas] = useState<PropuestaAbierta | null>(null);
  const [guardandoPiezas, setGuardandoPiezas] = useState(false);
  const reservasEnMesas = useMemo<ReservaEnMesas[]>(() => {
    const porReserva = new Map<string, ReservaEnMesas>();
    const porId = new Map(lista.map((r) => [r.id, r]));
    for (const a of asignacionesSala) {
      const r = porId.get(a.reserva_id);
      if (!r || turnoDeHora(r.hora) !== turno || !ocupaEspacio(r.estado) || r.salida_at) continue;
      const fila = porReserva.get(r.id) ?? { reservaId: r.id, mesaIds: [], comensales: r.numero_comensales };
      fila.mesaIds.push(a.mesa_id);
      porReserva.set(r.id, fila);
    }
    return [...porReserva.values()];
  }, [asignacionesSala, lista, turno]);
  const guardarPiezas = async (cambios: AjusteMesa[], mensaje: string) => {
    if (!sala) return;
    setGuardandoPiezas(true);
    try {
      await guardarAjustesServicio(sala.id, hoy, turno, cambios);
      toast.success(mensaje);
      setPropuestaPiezas(null);
    } catch (e) {
      toast.error(`No se ha podido ajustar la mesa: ${mensajeUsuario(e, "error")}`);
    } finally {
      setGuardandoPiezas(false);
      void qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA] });
    }
  };
  /** Qué pasa al soltar `reserva` en `mesa` (lógica pura en `decidirSoltar`). */
  const decidir = (reserva: ReservaServicio, mesa: Mesa) =>
    decidirSoltar({
      reserva,
      mesa: { id: mesa.id, nombre: mesa.nombre, espacio_id: sala?.id ?? mesa.espacio_id, plazas: mesa.capacidad },
      asignaciones: asignacionesDeHoy ?? [],
      configOcupacion: config,
      piezas: { mesas: mesasPiezas, estado: estadoPiezas, reservas: reservasEnMesas },
    });
  /** Solo DA la mesa (no marca «Llegó»); cambia antes la sala si era de otra. Con «Deshacer». */
  const darMesaA = async (reserva: ReservaServicio, mesa: Mesa, cambiarSala: boolean) => {
    if (!sala) return;
    if (cambiarSala && !(await acciones.moverEspacio(reserva, sala.id, sala.title))) return;
    try {
      await asignarMesas.mutateAsync({ reserva_id: reserva.id, mesa_ids: [mesa.id], silencioso: true });
    } catch {
      return; // El aviso lo pone el hook.
    }
    toast.success(`${reserva.nombre || "Reserva"} → mesa ${mesa.nombre}`, {
      action: {
        label: "Deshacer",
        onClick: () => asignarMesas.mutate({ reserva_id: reserva.id, mesa_ids: [], silencioso: true }),
      },
    });
  };
  const soltar = async (reserva: ReservaServicio, mesa: Mesa) => {
    const r = decidir(reserva, mesa);
    if (r.tipo === "ocupada") {
      toast.error(r.motivo);
      return;
    }
    if (r.tipo === "asignar") {
      await darMesaA(reserva, mesa, r.cambiarSala);
      return;
    }
    setPropuestaPiezas({
      titulo: `${reserva.nombre || "Reserva"} · ${reserva.numero_comensales} en la ${mesa.nombre}`,
      resultado: r.propuesta ?? { propuestas: [], motivo: `En la ${mesa.nombre} caben ${mesa.capacidad}.` },
      extra: {
        texto: "Darle la mesa igual",
        accion: () => {
          setPropuestaPiezas(null);
          void darMesaA(reserva, mesa, r.cambiarSala);
        },
      },
      hacer: async (prop) => {
        if (!sala) return;
        try {
          await guardarAjustesServicio(sala.id, hoy, turno, prop.cambios);
        } catch (e) {
          toast.error(`No se ha podido ajustar la mesa: ${mensajeUsuario(e, "error")}`);
          return;
        }
        void qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA] });
        setPropuestaPiezas(null);
        await darMesaA(reserva, mesa, r.cambiarSala);
      },
    });
  };
  /** Mientras se arrastra o se elige: las mesas donde cabe y están libres, en verde; el resto, atenuadas. */
  const objetivo = arrastrando ?? eligiendoPara;

  // ── Grupo de 8 o más: ayuda para asignarlo a mano (13/10/2026, `grupoGrande.ts`) ─
  // Reservado hasta 14; si son más (o está cogido), la mesa larga del Salón se dibuja
  // en discontinuo en su esquina (pared de abajo a la derecha). No crea ninguna mesa.
  const salaEsSalon = esSalaMesaLarga(sala?.title);
  const sugerenciaObjetivo = useMemo<SugerenciaGrupo | null>(() => {
    if (!objetivo || !esGrupoGrande(objetivo.numero_comensales)) return null;
    const turnoObj = turnoDeHora(objetivo.hora);
    const reservado =
      ((espacios ?? []) as Array<{ id: string; nombre: string; capacidad_maxima?: number | null; activa?: boolean | null; caracteristicas?: unknown }>)
        .find((e) => e.activa !== false && esSalaPrivada(e)) ?? null;
    const otra = reservado
      ? lista.find((r) => r.id !== objetivo.id && r.espacio_id === reservado.id && ocupaEspacio(r.estado) && turnoDeHora(r.hora) === turnoObj)
      : undefined;
    const ocupadas = new Set(
      (asignacionesDeHoy ?? []).filter((a) => turnoDeHora(a.reservas?.hora ?? "") === turnoObj).map((a) => a.mesa_id),
    );
    return sugerenciaGrupoGrande({
      comensales: objetivo.numero_comensales,
      reservado: reservado
        ? { id: reservado.id, nombre: reservado.nombre, capacidad: reservado.capacidad_maxima, ocupadoPor: otra ? otra.nombre?.trim() || "otra reserva" : null }
        : null,
      salon: salaEsSalon && sala ? { id: sala.id, nombre: sala.title, mesas, plano, ocupadas } : null,
    });
  }, [objetivo, espacios, lista, asignacionesDeHoy, salaEsSalon, sala, mesas, plano]);
  /** La mesa larga propuesta para dibujar en el Salón (eligiendo mesa o en «Organizar»). */
  const mesaPropuesta = useMemo(() => {
    if (!salaEsSalon) return null;
    const conNombre = (s: SugerenciaGrupo | null | undefined, nombre: string | null | undefined, pax: number) =>
      s?.tipo === "mesa_larga"
        ? { pos_x: s.mesaLarga.pos_x, pos_y: s.mesaLarga.pos_y, ancho: s.mesaLarga.ancho, alto: s.mesaLarga.alto, texto: `Mesa larga · ${nombre || "grupo"} (${pax} p.)` }
        : null;
    if (objetivo) return conNombre(sugerenciaObjetivo, objetivo.nombre, objetivo.numero_comensales);
    if (proponiendo) {
      const g = org.resultado?.revisarAMano.find((x) => org.sugerencias.get(x.reservaId)?.tipo === "mesa_larga");
      return g ? conNombre(org.sugerencias.get(g.reservaId), g.nombre, g.comensales) : null;
    }
    return null;
  }, [salaEsSalon, objetivo, sugerenciaObjetivo, proponiendo, org.resultado, org.sugerencias]);
  const mesasValidas = useMemo(
    () => (objetivo ? new Set(mesas.filter((m) => decidir(objetivo, m).tipo === "asignar").map((m) => m.id)) : null),
    // `decidir` depende de lo mismo que las mesas y las asignaciones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objetivo, mesas, asignacionesDeHoy, estadoPiezas, reservasEnMesas],
  );
  /** Tocar una tarjeta del panel resalta su mesa en el plano. */
  const [reservaResaltada, setReservaResaltada] = useState<string | null>(null);
  useEffect(() => setReservaResaltada(null), [sala?.id]);
  const idResaltada = reservaResaltadaExterna ?? reservaResaltada;
  const mesasResaltadas = useMemo(
    () =>
      idResaltada
        ? new Set(asignacionesSala.filter((a) => a.reserva_id === idResaltada).map((a) => a.mesa_id))
        : null,
    [idResaltada, asignacionesSala],
  );
  // La reserva señalada en la lista de la izquierda tiene la mesa en OTRA sala: el plano salta a ella (una
  // vez por reserva, y tras un momento, para que pasar el ratón por la lista no vaya cambiando de sala).
  const yaSaltada = useRef<string | null>(null);
  useEffect(() => {
    if (!fijo || !reservaResaltadaExterna) {
      yaSaltada.current = null;
      return;
    }
    if (yaSaltada.current === reservaResaltadaExterna) return;
    const r = lista.find((x) => x.id === reservaResaltadaExterna);
    if (!r) return;
    const suya = (asignacionesDeHoy ?? []).find((a) => a.reserva_id === r.id);
    const destino = (suya?.mesas as { espacio_id?: string } | undefined)?.espacio_id ?? columnaDeReserva(r, columnas);
    if (!destino || destino === sala?.id || !salas.some((s) => s.id === destino)) {
      yaSaltada.current = reservaResaltadaExterna;
      return;
    }
    const t = window.setTimeout(() => {
      yaSaltada.current = reservaResaltadaExterna;
      onCambiarSala(destino);
    }, 350);
    return () => window.clearTimeout(t);
  }, [fijo, reservaResaltadaExterna, lista, asignacionesDeHoy, columnas, sala?.id, salas, onCambiarSala]);
  const coincidentesMapa = mesasValidas ?? (mesasResaltadas?.size ? mesasResaltadas : coincidentes);
  const alEmpezarArrastre = (e: DragStartEvent) => {
    setArrastrando((e.active.data.current as ReservaServicio | undefined) ?? null);
    setEligiendoPara(null);
  };
  const alSoltar = (e: DragEndEvent) => {
    const reserva = arrastrando;
    setArrastrando(null);
    const mesaId = (e.over?.data.current as { mesaId?: string } | undefined)?.mesaId;
    const mesa = mesas.find((m) => m.id === mesaId);
    if (reserva && mesa) void soltar(reserva, mesa);
  };

  const volverABase = useVolverAPlanoBase(sala?.id ?? "", hoy, turno);
  const [confirmarBase, setConfirmarBase] = useState(false);
  const numAjustes = (ajustesQuery.data ?? []).length;
  const esTerraza = !!sala && /terraza/i.test(sala.title);
  const cierreSala = useSalaCerradaServicio(esTerraza ? (sala?.id ?? null) : null, hoy, turno);

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
      onDarMesa={
        proponiendo
          ? undefined
          : (x) => {
              setEligiendoPara(x);
              setMesaSelId(null);
              setPendientesAbiertos(false);
            }
      }
      textoDarMesa="Elegir mesa en el plano"
      textoCambiarMesa={proponiendo ? undefined : "Cambiar mesa (elegir en el plano)"}
      accionesExtra={
        haLlegado(r.estado) && mesasPorReserva.has(r.id) && puedeEditar
          ? (r as ReservaMesaServicio).salida_at
            ? [{ texto: "Deshacer liberar", onSelect: () => void servicio.deshacerLiberarMesa(r) }]
            : [{ texto: "Liberar mesa", onSelect: () => void servicio.liberarMesa(r) }]
          : undefined
      }
      sinMesa={estaSinMesa(r) || (listo && ocupaEspacio(r.estado) && !mesasPorReserva.has(r.id))}
      mesas={mesasPorReserva.get(r.id)}
      puedeEditar={puedeEditar}
      sinArrastre={proponiendo}
      telefonoEnlace
      compacta
      onFijarMesa={proponiendo ? undefined : (x, fijar) => void fijarMesa(x, fijar)}
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

  const filas = (reservasGrupo: ReservaServicio[]) => (
    <ul className="space-y-1">
      {reservasGrupo.map((r) => (
        <li
          key={r.id}
          className={cn("min-w-0", yaAtendida(r) && "opacity-60")}
          // Tocarla resalta su mesa en el plano (y la tarjeta abre sus acciones, como siempre).
          onClickCapture={() => setReservaResaltada(mesasPorReserva.has(r.id) ? r.id : null)}
        >
          {tarjeta(r)}
        </li>
      ))}
    </ul>
  );
  const cabeceraGrupo = (titulo: string, n: number) => (
    <span className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
      {titulo}
      <Badge variant="outline" className="h-5 px-1.5 text-xs tabular-nums">
        {n}
      </Badge>
    </span>
  );
  const grupo = (titulo: string, reservasGrupo: ReservaServicio[], vacio: string) => (
    <section aria-label={titulo} className="space-y-1.5">
      <h4>{cabeceraGrupo(titulo, reservasGrupo.length)}</h4>
      {reservasGrupo.length === 0 ? <p className="text-[13px] text-muted-foreground">{vacio}</p> : filas(reservasGrupo)}
    </section>
  );
  // «Sin sala» plegado si la sala ya tiene reservas: que no tape la lista de la sala.
  const [sinSalaAbierto, setSinSalaAbierto] = useState<boolean | null>(null);
  useEffect(() => setSinSalaAbierto(null), [sala?.id]);
  const salaConReservas = pendientesSala.length + conMesaSala.length > 0;
  const verSinSala = sinSalaAbierto ?? !salaConReservas;

  const panelPendientes = sala && !listo ? (errorDatos ? avisoError : esqueletoLista) : sala && (
    <div className="space-y-3 p-3">
      {grupo(`Sin mesa en ${sala.title}`, pendientesSala, `Todas las reservas de ${sala.title} tienen mesa.`)}
      {grupo(`Reservas en ${sala.title}`, conMesaSala, `Ninguna reserva de ${sala.title} tiene mesa todavía.`)}
      <section aria-label="Sin sala" className="space-y-1.5">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between rounded-md text-left"
          aria-expanded={verSinSala}
          onClick={() => setSinSalaAbierto(!verSinSala)}
        >
          {cabeceraGrupo("Sin sala", sinSala.length)}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", verSinSala && "rotate-180")} aria-hidden="true" />
        </button>
        {verSinSala &&
          (sinSala.length === 0 ? <p className="text-[13px] text-muted-foreground">No hay reservas sin sala.</p> : filas(sinSala))}
      </section>
    </div>
  );

  const datosMesa = mesaSel ? `${mesaSel.capacidad} plazas · ${sala?.title ?? ""} · ${ETIQUETA_TURNO[turno]}` : "";

  const movimientoSel = mesaSel ? (cambian.get(mesaSel.id) ?? null) : null;
  const mesaPiezasSel = mesaSel ? (mesasPiezas.find((m) => m.id === mesaSel.id) ?? null) : null;
  const panelPropuestaMesa = mesaSel && (
    <div className="space-y-3 p-3" data-testid="detalle-mesa-propuesta">
      {!enHojas && <h3 className="text-base font-semibold">{`Mesa ${mesaSel.nombre}`}</h3>}
      {movimientoSel ? (
        <>
          <p className="text-sm font-medium">{movimientoSel.texto}</p>
          {movimientoSel.detalle && movimientoSel.desde && <p className="text-[13px] text-muted-foreground">{movimientoSel.detalle}</p>}
          <Button className="h-12 w-full" disabled={org.aplicando} onClick={() => void org.aplicar([movimientoSel])}>
            Aplicar solo este
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {estados.get(mesaSel.id)?.reserva ? "Sin cambios en esta mesa." : "Libre en la propuesta."}
        </p>
      )}
    </div>
  );

  const panelMesa = proponiendo ? panelPropuestaMesa : mesaSel && (
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
          {/* Solo con «Editar» en Reservas (06/11/2026: sin él se oculta, no se desactiva). */}
          {haLlegado(r.estado) && puedeEditar && (
            r.salida_at ? (
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={servicio.estaEnCurso(r.id)}
                onClick={() => void servicio.deshacerLiberarMesa(r)}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Deshacer liberar
              </Button>
            ) : (
              <Button
                variant={estadoSel?.estado === "por_liberar" ? "default" : "outline"}
                className="h-11 w-full"
                disabled={servicio.estaEnCurso(r.id)}
                onClick={() => void servicio.liberarMesa(r)}
              >
                <LogOut className="mr-2 h-4 w-4" /> Liberar mesa
              </Button>
            )
          )}
          {tarjeta(r)}
        </div>
      ))}

      {mesaPiezasSel && (
        <PanelPiezasMesa
          mesa={mesaPiezasSel}
          mesas={mesasPiezas}
          estado={estadoPiezas}
          reservas={reservasEnMesas}
          hayServicio
          turno={turno}
          ocupado={guardandoPiezas}
          soloLectura={!puedeEditar}
          onGuardar={(cambios, mensaje) => guardarPiezas(cambios, mensaje)}
          onProponer={setPropuestaPiezas}
        />
      )}

      {estadoSel?.estado === "libre" && puedeEditar && (
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
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      className="h-11 flex-1"
                      disabled={sentando !== null}
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
                        disabled={sentando !== null}
                        onClick={() => void sentarAqui(r, false)}
                        aria-label={`Solo dar la mesa ${mesaSel.nombre} a ${nombre}, ${hora}: todavía no ha llegado`}
                      >
                        Solo dar la mesa
                      </Button>
                    )}
                  </div>
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
      <DndContext sensors={sensores} onDragStart={alEmpezarArrastre} onDragEnd={alSoltar} onDragCancel={() => setArrastrando(null)}>
      {salas.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border text-sm text-muted-foreground" role="status">
          {espacios === undefined ? "Cargando salas…" : "No hay salas de Casa Tomás activas. Se crean en Espacios."}
        </div>
      ) : (
        <>
        {proponiendo && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-primary bg-primary/5 px-3 py-2"
            data-testid="barra-propuesta"
            role="region"
            aria-label="Propuesta de Organizar"
          >
            <p className="text-xl font-bold">
              {!org.resultado ? "Calculando…" : org.resultado.resumen}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{ETIQUETA_TURNO[turno]}</span>
            </p>
            {org.resultado && org.resultado.sinSitio.length > 0 && (
              <Popover open={verSinSitio} onOpenChange={setVerSinSitio}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-11 border-amber-400 text-amber-800 dark:text-amber-300">
                    {org.resultado.sinSitio.length} sin sitio
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 text-sm">
                  <ul className="space-y-1">
                    {org.resultado.sinSitio.map((x) => (
                      <li key={x.reservaId}>
                        <span className="font-medium">{x.nombre}</span> ({x.comensales} p., {x.hora.slice(0, 5)}): {x.motivo}
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
            {org.resultado && org.resultado.revisarAMano.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-11 border-sky-400 text-sky-800 dark:text-sky-300">
                    {org.resultado.revisarAMano.length} a mano (8+)
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-96 text-sm">
                  <p className="mb-1 font-medium">Grupos de 8 o más: los asigna una persona</p>
                  <ul className="space-y-1">
                    {org.resultado.revisarAMano.map((x) => (
                      <li key={x.reservaId}>
                        <span className="font-medium">{x.nombre || "Sin nombre"}</span> ({x.comensales} p., {x.hora.slice(0, 5)}): {x.sugerencia}
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
            {org.terraza && (
              <label className="flex h-11 items-center gap-2 rounded-md border bg-background px-2 text-sm">
                <Switch checked={org.cierre.cerrada} onCheckedChange={(v) => void org.cierre.cambiar(v)} />
                {org.terraza.nombre} cerrada
              </label>
            )}
            {org.resultado && org.resultado.movimientos.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className="h-11 gap-1.5">
                    <ListChecks className="h-4 w-4" aria-hidden="true" /> Ver lista
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="max-h-[60dvh] w-[min(92vw,28rem)] overflow-y-auto">
                  <ListaPropuesta resultado={org.resultado} aplicando={org.aplicando} onAplicar={(m) => void org.aplicar([m])} />
                </PopoverContent>
              </Popover>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" className="h-12 px-5" onClick={organizar?.onSalir}>
                Descartar
              </Button>
              <Button
                className="h-12 px-6 text-base"
                disabled={!org.resultado || org.resultado.movimientos.length === 0 || org.aplicando}
                onClick={async () => {
                  await org.aplicar(org.resultado?.movimientos ?? []);
                  organizar?.onSalir();
                }}
              >
                {org.aplicando ? "Aplicando…" : "Aplicar todo"}
              </Button>
            </div>
          </div>
        )}
        <Tabs
          value={sala?.id ?? ""}
          onValueChange={(valor) => valor && onCambiarSala(valor)}
          className="flex min-h-0 flex-1 flex-col gap-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            {fijo && sala ? (
              <h2 className="flex min-w-0 items-center gap-2 text-2xl font-bold" data-testid="plano-fijo-sala" aria-live="polite">
                {sala.privada && <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />}
                <span className="truncate">{sala.title}</span>
                <span className="shrink-0 text-lg font-semibold tabular-nums text-muted-foreground">
                  {indiceSala + 1}/{salas.length}
                </span>
                <span className="shrink-0 rounded-md border px-2 py-0.5 text-[13px] font-medium" data-testid="plano-fijo-turno">
                  {etiquetaTurno}
                </span>
                {listo && (
                  <span className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground">
                    {(() => {
                      const c = resumenPorSala.get(sala.id) ?? { total: 0, sinMesa: 0 };
                      return `· ${c.total} ${c.total === 1 ? "reserva" : "reservas"}${c.sinMesa ? ` · ${c.sinMesa} sin mesa` : ""}`;
                    })()}
                  </span>
                )}
              </h2>
            ) : (
            <TabsList aria-label="Salas" className="h-auto min-h-10 min-w-0 justify-start">
              {salas.map((s) => {
                const cuenta = resumenPorSala.get(s.id) ?? { total: 0, sinMesa: 0 };
                // Sin datos completos no se dan cifras (un «0» sería falso).
                if (!listo) {
                  return (
                    <TabsTrigger key={s.id} value={s.id} className="gap-1.5" aria-label={s.title}>
                      {s.privada && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                      <span>{s.title}</span>
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
                  </TabsTrigger>
                );
              })}
            </TabsList>
            )}
            {/* «Reparto de mesas» ya no se ofrece desde Hoy (10/10/2026): lo esencial está aquí. */}
            {!proponiendo && sala && (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* Cerrar la terraza y volver al plano base escriben: solo con «Editar» (06/11/2026). Con
                    solo «Ver», si la terraza está cerrada se dice, sin interruptor. */}
                {esTerraza && puedeEditar && (
                  <label className="flex h-10 items-center gap-2 rounded-md border px-2 text-[13px]">
                    <Switch checked={cierreSala.cerrada} onCheckedChange={(v) => void cierreSala.cambiar(v)} aria-label={`${sala.title} cerrada en este servicio`} />
                    Cerrada
                  </label>
                )}
                {esTerraza && !puedeEditar && cierreSala.cerrada && (
                  <Badge variant="outline" className="h-10 px-2 text-[13px]">
                    Cerrada en este servicio
                  </Badge>
                )}
                {puedeEditar && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 gap-1.5"
                    disabled={numAjustes === 0}
                    onClick={() => setConfirmarBase(true)}
                    title={numAjustes === 0 ? "Este servicio ya está como el plano base" : "Deshacer picos, piezas prestadas y uniones de este servicio"}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden lg:inline">Plano base</span>
                  </Button>
                )}
              </div>
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
              {/* El plano: no se desplaza (se ajusta, y se acerca o se mueve con los dedos; fijo, ni eso). */}
              <ConFlechasSala
                activo={fijo && salas.length > 1}
                anterior={indiceSala >= 0 ? salas[(indiceSala - 1 + salas.length) % salas.length]?.title : undefined}
                siguiente={indiceSala >= 0 ? salas[(indiceSala + 1) % salas.length]?.title : undefined}
                onAnterior={() => irSala(-1)}
                onSiguiente={() => irSala(1)}
              >
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
                ) : fijo ? (
                  // Escritorio (07/11/2026): mesas grandes como tarjetas, sin paredes ni decoración.
                  <MesasGrandesSala
                    key={sala.id}
                    salaNombre={sala.title}
                    mesas={mesas}
                    estados={estados}
                    seleccionada={mesaSelId}
                    coincidentes={coincidentesMapa}
                    onTocarMesa={tocarMesa}
                    uniones={unionesMapa}
                  />
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
                    coincidentes={coincidentesMapa}
                    onTocarMesa={tocarMesa}
                    mesaPropuesta={mesaPropuesta}
                    uniones={unionesMapa}
                    piezas={piezasMapa}
                    fijo={fijo}
                  />
                )}
                {eligiendoPara && (
                  <div className="absolute inset-x-2 top-2 z-50 flex items-center justify-between gap-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground shadow-lg">
                    <span className="min-w-0 text-sm font-medium">
                      <span className="block truncate">
                        Toca una mesa para {eligiendoPara.nombre || "la reserva"} ({eligiendoPara.numero_comensales} p.)
                      </span>
                      {sugerenciaObjetivo && (
                        <span className="block text-xs font-normal opacity-90" data-testid="sugerencia-grupo">
                          {sugerenciaObjetivo.texto}
                        </span>
                      )}
                    </span>
                    <Button variant="secondary" className="h-10 shrink-0" onClick={() => setEligiendoPara(null)}>
                      Cancelar
                    </Button>
                  </div>
                )}
                {!fijo && (
                  <p className="pointer-events-none absolute left-2 top-2 rounded-md border bg-background/90 px-2 py-1 text-[13px] font-medium shadow-sm backdrop-blur-sm">
                    {etiquetaTurno}
                  </p>
                )}
              </section>
              </ConFlechasSala>

              {enHojas ? (
                <div className={cn("flex min-w-0 items-center gap-2", fijo && "flex-wrap")}>
                  {/* Fijo (escritorio): la leyenda se parte en dos líneas si no cabe, en vez de cortarse
                      («Por liberar» salía cortado en la captura del dueño, 07/11/2026). */}
                  {!esMovil && listo && (fijo ? <div className="min-w-0 flex-1" data-testid="leyenda-plano">{leyendaEn(false)}</div> : <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">{leyendaEn(true)}</div>)}
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
                  {/* Scroll con el dedo (10/10/2026): div nativo de alto acotado, `pan-y`, sin encadenar el gesto a
                      la página. Las tarjetas solo se arrastran con pulsación larga. */}
                  <div data-lista-desplazable className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
                    {mesaSel ? panelMesa : panelPendientes}
                  </div>
                </aside>
              )}
            </TabsContent>
          )}
        </Tabs>
        </>
      )}

      {/* Por debajo de 1280 px: la mesa tocada y la lista por sentar, en hojas (de lado en tablet, desde abajo en móvil). */}
      {enHojas && (
        <>
          <Sheet open={!!mesaSel} onOpenChange={(abierta) => !abierta && setMesaSelId(null)}>
            <SheetContent
              side={esMovil ? "bottom" : "right"}
              className={cn("touch-pan-y overflow-y-auto overscroll-contain p-0", esMovil ? "max-h-[85dvh]" : "w-[min(92vw,26rem)] sm:max-w-none")}
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
              className={cn("touch-pan-y overflow-y-auto overscroll-contain p-0", esMovil ? "max-h-[85dvh]" : "w-[min(92vw,26rem)] sm:max-w-none")}
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
      {/* La «ficha» que sigue al dedo: nombre y personas. */}
        <DragOverlay dropAnimation={null}>
          {arrastrando && (
            <div className="pointer-events-none rounded-lg border-2 border-primary bg-background px-3 py-2 text-sm font-semibold shadow-xl">
              {arrastrando.nombre || "Reserva"} · {arrastrando.numero_comensales} p.
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {dialogoEdicion}
      <DialogoPropuestaPiezas propuesta={propuestaPiezas} ocupado={guardandoPiezas} onCerrar={() => setPropuestaPiezas(null)} />
      <AlertDialog open={confirmarBase} onOpenChange={(abierto) => !abierto && setConfirmarBase(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Volver al plano base?</AlertDialogTitle>
            <AlertDialogDescription>
              Se deshacen {numAjustes} {numAjustes === 1 ? "ajuste" : "ajustes"} (picos, piezas prestadas, uniones) de{" "}
              {sala?.title}, {ETIQUETA_TURNO[turno].toLowerCase()} de hoy. Las reservas conservan su mesa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await volverABase.mutateAsync(numAjustes);
                  toast.success(`${sala?.title ?? "La sala"} vuelve al plano base`);
                } catch {
                  // El aviso lo pone el hook.
                } finally {
                  setConfirmarBase(false);
                }
              }}
            >
              Volver al plano base
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Plano fijo de escritorio: flechas grandes (64×56 px) a izquierda y derecha del plano para pasar de sala.
 * Sin `activo` (o con una sola sala) deja el plano tal cual.
 */
function ConFlechasSala({
  activo,
  anterior,
  siguiente,
  onAnterior,
  onSiguiente,
  children,
}: {
  activo: boolean;
  anterior?: string;
  siguiente?: string;
  onAnterior: () => void;
  onSiguiente: () => void;
  children: ReactNode;
}) {
  if (!activo) return <>{children}</>;
  return (
    <div className="flex min-h-0 min-w-0 items-stretch gap-2" data-testid="plano-fijo">
      <Button
        variant="outline"
        className="h-auto min-h-14 w-14 shrink-0 self-center py-6"
        onClick={onAnterior}
        aria-label={anterior ? `Sala anterior: ${anterior}` : "Sala anterior"}
        title={anterior ? `${anterior} (←)` : "Sala anterior (←)"}
      >
        <ChevronLeft className="!h-9 !w-9" aria-hidden="true" />
      </Button>
      <div className="grid min-h-0 min-w-0 flex-1">{children}</div>
      <Button
        variant="outline"
        className="h-auto min-h-14 w-14 shrink-0 self-center py-6"
        onClick={onSiguiente}
        aria-label={siguiente ? `Sala siguiente: ${siguiente}` : "Sala siguiente"}
        title={siguiente ? `${siguiente} (→)` : "Sala siguiente (→)"}
      >
        <ChevronRight className="!h-9 !w-9" aria-hidden="true" />
      </Button>
    </div>
  );
}
