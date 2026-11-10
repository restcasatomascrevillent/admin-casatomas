// ============================================================================
// «HOY» EN MÓVIL (< 768 px) — para el camarero que va sentando gente
// ----------------------------------------------------------------------------
// Durante el servicio el panel se usa en el MÓVIL (cada camarero el suyo).
// UNA sola fila de controles (07/11/2026, antes eran cuatro bandas): el menú
// (en Reservas móvil no hay barra superior), «Reservas | Mesas», el turno (por
// defecto el del reloj: antes de las 17:00 comida, después cena), una lupa que
// despliega el buscador encima y «Sin reserva» (icono).
//   · RESERVAS: solo lo que está POR LLEGAR: arriba «Llegan ahora» (próximos
//     15 min y hasta 30 min tarde) y después el resto, por hora (las pasadas,
//     «Tarde»). Las ya sentadas no salen (se gestionan en «Mesas»). «No vino» y
//     canceladas tampoco. Cada fila, en grande: hora, nombre, personas y un botón
//     con la MESA de protagonista («Sentar» pequeño y «Comedor · Mesa 7» grande;
//     un toque = «Llegó» en su mesa) o «Elegir mesa» (abre el selector).
//   · MESAS: cada sala en una cuadrícula de botones grandes con su estado
//     (libre, sentada, prevista a una hora). Tocar una libre o una prevista:
//     sentar sin reserva aquí o sentar una reserva. Tocar una ocupada: su ficha.
// La ficha de una reserva (panel inferior) tiene botones grandes:
//   · «Sentar en mesa X»  → la MISMA acción «Ha llegado» del panel.
//   · «Cambiar mesa» / «Elegir mesa» → selector con las mesas de TODAS las salas
//     donde cabe: libre (verde), prevista para otra reserva (ámbar: se puede
//     elegir; a esa otra se le busca la mejor mesa libre de su sala, o se queda
//     sin mesa si no hay, y se avisa), FIJADA para otra (candado, no se puede) u
//     ocupada por alguien sentado (no se puede). Si la propia reserva tiene la
//     mesa fijada, cambiarla se pregunta y quita la fijación (07/11/2026).
//     Lógica en `src/lib/reservas/confirmarMesa.ts` y `recalcularMesas.ts`.
//   · «Recalcular mesas» (vista Mesas): recoloca las por llegar no fijadas cuya
//     mesa prevista está ocupada ahora o choca, con resumen y Confirmar.
//   · «Liberar mesa» (sentadas): la mesa queda libre para otros; con Deshacer.
//   · «No vino».
// Con solo «Ver» en Reservas (06/11/2026, decisión del dueño) las fichas enseñan los datos
// (y «Llamar») pero ningún botón que escriba: se ocultan, no se desactivan.
// Al día solo: `useAlDiaMovil` (tiempo real + al volver a primer plano + 15 s).
// Sin scroll de página: la lista ocupa el alto disponible y hace scroll dentro.
// Lógica: `src/lib/reservas/hoyMovil.ts`, `sentarAhora.ts` y `confirmarMesa.ts` (con tests).
// ============================================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Armchair,
  Clock,
  DoorOpen,
  LayoutGrid,
  List,
  Lock,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  StickyNote,
  Undo2,
  UserPlus,
  Users,
  UserX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SidebarTrigger, useSidebarOpcional } from "@/components/ui/sidebar";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import { useAsignacionesMesa, useAsignarMesasReserva, type AsignacionConDetalles } from "@/hooks/useAsignacionesMesa";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAccionesModoServicio } from "@/hooks/useAccionesModoServicio";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useAlDiaMovil } from "@/hooks/useAlDiaMovil";
import { useSalaCerradaServicio } from "@/hooks/useSalaCerradaServicio";
import { eventosDelTurno, textoEvento, useSalasEvento, type SalaCerradaEvento } from "@/hooks/useSalaEvento";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { deshacerSinReserva, useSentarSinReserva } from "@/hooks/useSentarSinReserva";
import {
  CLAVE_AJUSTES_MESA,
  useAjustesMesaDia,
  useGuardarAjustesMesa,
  type TurnoServicio,
} from "@/hooks/useAjustesMesaServicio";
import { BotonSentarSinReserva } from "@/components/reservas/SentarSinReserva";
import { InterruptoresServiciosOnline, InsigniaMenuDelDia } from "@/components/reservas/InterruptoresServiciosOnline";
import { configAsignacionDesde } from "@/lib/reservas/ventanaAsignacion";
import { configServicioSalaDesde, type ReservaMesaServicio } from "@/lib/reservas/servicioSala";
import { turnoDeHora } from "@/lib/reservas/asignacionMesas";
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";
import type { FiltroTurnoHoy } from "@/lib/reservas/vistaHoy";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import {
  estadoMesasHoy,
  candidatasParaMesa,
  estaTerminada,
  listaHoyEscritorio,
  textoMesaFijada,
  tieneAlergia,
  type CandidataMesa,
  type MesaDeReserva,
  listaHoyMovil,
  textoMesaConfirmada,
  textoMesas,
  type EstadoMesaHoy,
  type MesaOpcion,
} from "@/lib/reservas/hoyMovil";
import {
  estadoServicio,
  geometriaServicio,
  mesaPiezasDesde,
  mesasDeLaUnion,
  type AjusteMesa,
  type MesaPiezas,
} from "@/lib/reservas/piezasMesa";
import { horaActual, opcionesMesasServicio, opcionesParaSentar, type AjusteDia } from "@/lib/reservas/sentarAhora";
import {
  clasificarMesasParaSentar,
  decidirSentarPrevista,
  type DecisionSentarPrevista,
  estadoParaConfirmar,
  reemplazarMesasEnLista,
  textoDesplazamiento,
  type Desplazamiento,
  type MesaParaConfirmar,
  type SelectorMesas,
} from "@/lib/reservas/confirmarMesa";
import type { ConfigOcupacionMesa } from "@/lib/reservas/ocupacionMesa";
import { proponerRecalculo, recolocarDesplazadas, textoSinSitio } from "@/lib/reservas/recalcularMesas";
import { useFijarMesa } from "@/hooks/useMesaFijada";
import { ListaHoyEscritorio } from "@/components/reservas/servicio/ListaHoyEscritorio";
import { enlaceTelefono, telefonoLegible } from "@/lib/reservas/telefono";
import { cn } from "@/lib/utils";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

type ReservaMovil = ReservaMesaServicio;
type Vista = "reservas" | "mesas";
/** Cómo se abre la ficha: normal, con el selector de mesa abierto o con la confirmación de quitar la prevista a otra. */
type InicioFicha = "normal" | "elegir" | "confirmar";

const horaCorta = (h: string) => (h ?? "").slice(0, 5);
const ESTADOS_POR_LLEGAR = new Set(["pendiente", "verificada", "confirmada"]);
/** Igual que `CLAVE_ASIGNACIONES_MESA` (useAsignacionesMesa.ts); aquí sin importarla para el cambio local. */
const CLAVE_ASIGNACIONES = "asignaciones_mesa";

const ETIQUETA_TURNO: Record<FiltroTurnoHoy, string> = { comida: "Comida", cena: "Cena", todo: "Todo" };

function infoEstado(estado: string) {
  return ESTADOS_RESERVA[estado as EstadoReserva] ?? null;
}

/** Minuto del día de ahora; se actualiza cada 30 s. */
function useMinutoAhora(): number {
  const calcular = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [minuto, setMinuto] = useState(calcular);
  useEffect(() => {
    const t = window.setInterval(() => setMinuto(calcular()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return minuto;
}

/** Tras un error de mesas (MESA_OCUPADA, otro camarero se adelantó…): releer lo de hoy enseguida. */
function refrescarTrasError(qc: QueryClient) {
  for (const clave of CLAVES_POR_CAMBIO.ocupacion) void qc.invalidateQueries({ queryKey: [clave] });
}

/**
 * «Hoy» de ESCRITORIO (07/11/2026, petición del dueño): la MISMA lista, como columna a la izquierda del plano.
 * El buscador y el turno los manda la fila de filtros de `VistaHoy`; sin la fila de controles del móvil ni
 * la vista «Mesas» (las mesas están en el plano). La ficha se abre en una hoja lateral.
 */
export interface ColumnaHoy {
  busqueda: string;
  filtroTurno: FiltroTurnoHoy;
  /** Canceladas de hoy (la lista de escritorio las enseña plegadas al final; el resto de Hoy no las usa). */
  canceladas?: ReservaMovil[];
  /** La reserva señalada en la lista (ratón encima, foco o ficha abierta), para resaltarla en el plano. */
  onSeñalar?: (id: string | null) => void;
}

export function VistaHoyMovil({
  reservas,
  fecha,
  columna,
}: {
  reservas: ReservaMovil[] | undefined;
  fecha: string;
  columna?: ColumnaHoy;
}) {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, 240);
  const [vistaPropia, setVista] = useState<Vista>("reservas");
  const vista: Vista = columna ? "reservas" : vistaPropia;
  // El turno del reloj por defecto: la lista sale corta (solo el servicio en curso). Se puede cambiar.
  const [filtroTurnoPropio, setFiltroTurno] = useState<FiltroTurnoHoy>(() => turnoDeHora(horaActual()));
  const [busquedaPropia, setBusqueda] = useState("");
  const filtroTurno = columna?.filtroTurno ?? filtroTurnoPropio;
  const busqueda = columna?.busqueda ?? busquedaPropia;
  const [buscando, setBuscando] = useState(false);
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const [inicioFicha, setInicioFicha] = useState<InicioFicha>("normal");
  const [mesaLibre, setMesaLibre] = useState<{ mesa: MesaOpcion; prevista: PrevistaMesa | null } | null>(null);
  const [sentandoId, setSentandoId] = useState<string | null>(null);
  const minutoAhora = useMinutoAhora();
  useAlDiaMovil();
  const { marcarLlegada } = useAccionesServicioReserva();
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");

  const { data: espacios } = useEspaciosReserva();
  const { data: mesas } = useMesas();
  const { data: asignaciones } = useAsignacionesMesa(fecha);
  const { data: ajustesDia } = useAjustesMesaDia(fecha);
  const { data: config } = useConfiguracionReservas();

  const salas = useMemo(
    () => ((espacios ?? []) as Array<{ id: string; nombre: string }>).map((e) => ({ id: e.id, nombre: e.nombre })),
    [espacios],
  );
  const salaPorId = useMemo(() => new Map(salas.map((s) => [s.id, s.nombre])), [salas]);
  const asignacionesDia = useMemo(() => asignaciones ?? [], [asignaciones]);
  const mesaPorId = useMemo(() => new Map((mesas ?? []).map((m) => [m.id, m])), [mesas]);
  const configOcupacion = useMemo(() => configServicioSalaDesde(config), [config]);

  // Turno que pintan las mesas: el del filtro o, con «Todo el día», el del reloj.
  const turno: TurnoServicio =
    filtroTurno === "todo"
      ? turnoDeHora(`${String(Math.floor(minutoAhora / 60)).padStart(2, "0")}:${String(minutoAhora % 60).padStart(2, "0")}`)
      : filtroTurno;
  const terraza = salas.find((s) => /terraza/i.test(s.nombre)) ?? null;
  const cierre = useSalaCerradaServicio(terraza?.id ?? null, fecha, turno);
  // «Evento: sala entera» (20261119100000): esas salas salen como «Evento: <nombre>».
  const { data: eventosDia } = useSalasEvento(fecha);
  const salasEvento = useMemo(() => eventosDelTurno(eventosDia, fecha, turno), [eventosDia, fecha, turno]);

  const mesasDe = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const a of asignacionesDia) {
      const nombre = mesaPorId.get(a.mesa_id)?.nombre ?? a.mesas?.nombre ?? "?";
      mapa.set(a.reserva_id, [...(mapa.get(a.reserva_id) ?? []), nombre]);
    }
    return (id: string) => mapa.get(id) ?? [];
  }, [asignacionesDia, mesaPorId]);

  const lista = useMemo(
    () => listaHoyMovil(reservas ?? [], mesasDe, minutoAhora, { busqueda, filtroTurno }),
    [reservas, mesasDe, minutoAhora, busqueda, filtroTurno],
  );
  // Escritorio (07/11/2026, «eso era para el móvil»): TODAS las del turno, por estados, en filas de una línea.
  const canceladas = columna?.canceladas;
  const listaEscritorio = useMemo(
    () =>
      columna ? listaHoyEscritorio([...(reservas ?? []), ...(canceladas ?? [])], mesasDe, minutoAhora, { busqueda, filtroTurno }) : null,
    [columna, reservas, canceladas, mesasDe, minutoAhora, busqueda, filtroTurno],
  );
  const { liberarMesa, estaEnCurso: liberando } = useAccionesModoServicio();
  const [señaladaRaton, setSeñaladaRaton] = useState<string | null>(null);
  // Solo lo que está POR LLEGAR (07/11/2026, petición del dueño): las ya sentadas no salen en la lista; liberar o
  // cambiar su mesa sigue en «Mesas».
  const vacia = lista.llegan.length + lista.porLlegar.length === 0;
  // El menú lateral: en Reservas › móvil no hay barra superior (DashboardLayout `sinCabeceraMovil`), así que su
  // botón va aquí, el primero de la fila. Fuera de un SidebarProvider (tests sueltos) no se pinta.
  const hayMenu = useSidebarOpcional() !== null;

  const abierta = [...(reservas ?? []), ...(canceladas ?? [])].find((r) => r.id === abiertaId) ?? null;
  // La señalada para el plano: la del ratón (o el foco) y, si no, la de la ficha abierta.
  const señalada = señaladaRaton ?? abiertaId;
  const onSeñalar = columna?.onSeñalar;
  useEffect(() => {
    onSeñalar?.(señalada);
  }, [onSeñalar, señalada]);

  const abrirFicha = (id: string, inicio: InicioFicha = "normal") => {
    setInicioFicha(inicio);
    setAbiertaId(id);
  };

  /**
   * «Sentar · Mesa 7»: un toque = «Llegó» en su mesa prevista, SI sigue libre en su franja. Ocupada por alguien
   * sentado (o sin mesa): la ficha con el selector. Prevista para otra reserva: la ficha con la confirmación.
   */
  const sentarDesdeFila = async (reserva: ReservaMovil, decision: DecisionSentarPrevista) => {
    if (decision.tipo === "elegir") return abrirFicha(reserva.id, "elegir");
    if (decision.tipo === "confirmar") return abrirFicha(reserva.id, "confirmar");
    setSentandoId(reserva.id);
    try {
      await marcarLlegada(reserva);
    } finally {
      setSentandoId(null);
    }
  };

  const fila = (reserva: ReservaMovil, nombresMesa: string[], extra: { tarde?: boolean; sentada?: boolean }) => {
    const decision = decidirSentarPrevista(asignacionesDia, reserva, configOcupacion);
    return (
      <FilaReservaMovil
        key={reserva.id}
        reserva={reserva}
        nombresMesa={nombresMesa}
        terminada={!!extra.sentada}
        tarde={extra.tarde}
        sala={reserva.espacio_id ? (salaPorId.get(reserva.espacio_id) ?? "") : undefined}
        onAbrir={() => abrirFicha(reserva.id)}
        onSentar={puedeEditar && !extra.sentada ? () => void sentarDesdeFila(reserva, decision) : undefined}
        mesaPrevistaOcupada={nombresMesa.length > 0 && decision.tipo === "elegir"}
        sentando={sentandoId === reserva.id}
      />
    );
  };

  const pax = (filas: Array<{ reserva: ReservaMovil }>) => filas.reduce((s, f) => s + (f.reserva.numero_comensales || 0), 0);

  return (
    <div
      ref={setRaiz}
      className="flex min-h-0 flex-col gap-2"
      style={alto ? { height: alto } : undefined}
      data-testid={columna ? "hoy-columna" : undefined}
    >
      {!columna && buscando && (
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            placeholder="Buscar por nombre o teléfono…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-11 pl-9 pr-12"
            aria-label="Buscar reservas"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-11 w-11"
            aria-label="Cerrar la búsqueda"
            onClick={() => {
              setBusqueda("");
              setBuscando(false);
            }}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      )}

      {!columna && (
      <div className="flex shrink-0 items-center gap-1" data-testid="hoy-movil-controles">
        {hayMenu && <SidebarTrigger className="shrink-0" />}
        <ToggleGroup
          type="single"
          value={vista}
          onValueChange={(v) => (v === "reservas" || v === "mesas") && setVista(v)}
          variant="outline"
          className="grid min-w-0 flex-1 grid-cols-2"
          aria-label="Ver reservas o mesas"
        >
          {/* Con el botón del menú en la fila, a menos de 390 px el texto no cabe: solo el icono (el nombre
              sigue para el lector de pantalla). */}
          <ToggleGroupItem value="reservas" aria-label="Reservas" className="h-11 min-w-0 px-1 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground pointer-coarse:h-11 pointer-coarse:px-1">
            <List className="h-5 w-5 min-[390px]:hidden" aria-hidden="true" />
            <span className="hidden min-[390px]:inline">Reservas</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="mesas" aria-label="Mesas" className="h-11 min-w-0 px-1 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground pointer-coarse:h-11 pointer-coarse:px-1">
            <LayoutGrid className="h-5 w-5 min-[390px]:hidden" aria-hidden="true" />
            <span className="hidden min-[390px]:inline">Mesas</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <Select value={filtroTurno} onValueChange={(v) => setFiltroTurno(v as FiltroTurnoHoy)}>
          <SelectTrigger className="h-11 w-[5.5rem] shrink-0 gap-1 px-2 text-sm [&>svg]:shrink-0" aria-label="Turno">
            <SelectValue>{ETIQUETA_TURNO[filtroTurno]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="comida">Comida</SelectItem>
            <SelectItem value="cena">Cena</SelectItem>
            <SelectItem value="todo">Todo el día</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={busqueda ? "default" : "outline"}
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={busqueda ? `Buscar (filtrando por «${busqueda}»)` : "Buscar"}
          aria-expanded={buscando}
          onClick={() => setBuscando((v) => !v)}
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </Button>
        <BotonSentarSinReserva soloIcono className="shrink-0" />
      </div>
      )}
      {!columna && <InterruptoresServiciosOnline fecha={fecha} className="shrink-0 px-1" />}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border bg-card" data-testid="hoy-movil-lista">
        {reservas === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando reservas…</p>
        ) : vista === "mesas" ? (
          <>
          {puedeEditar && (
            <RecalcularMesasMovil
              fecha={fecha}
              turno={turno}
              salas={salas}
              mesas={mesas ?? []}
              asignaciones={asignacionesDia}
              ajustesDia={ajustesDia ?? []}
              mesasExcluidas={configAsignacionDesde(config).mesasExcluidas}
              mesasAlFinal={configAsignacionDesde(config).mesasAlFinal}
              configOcupacion={configOcupacion}
            />
          )}
          <CuadriculaMesas
            salas={salas}
            mesas={mesas ?? []}
            asignaciones={asignacionesDia}
            ajustesDia={ajustesDia ?? []}
            reservas={reservas}
            turno={turno}
            terrazaCerradaId={cierre.cerrada ? (terraza?.id ?? null) : null}
            salasEvento={salasEvento}
            onLibre={(mesa, prevista) => setMesaLibre({ mesa, prevista })}
            onOcupada={(id) => abrirFicha(id)}
          />
          </>
        ) : listaEscritorio ? (
          <ListaHoyEscritorio
            lista={listaEscritorio}
            salaDe={(r) => (r.espacio_id ? salaPorId.get(r.espacio_id) : undefined)}
            onAbrir={(r) => abrirFicha(r.id)}
            onSentar={puedeEditar ? (r) => void sentarDesdeFila(r, decidirSentarPrevista(asignacionesDia, r, configOcupacion)) : undefined}
            onLiberar={puedeEditar ? (r) => void liberarMesa(r) : undefined}
            mesaPrevistaOcupada={(r) => decidirSentarPrevista(asignacionesDia, r, configOcupacion).tipo === "elegir"}
            ocupadaId={sentandoId ?? (señalada && liberando?.(señalada) ? señalada : null)}
            señalada={señalada}
            onSeñalar={setSeñaladaRaton}
          />
        ) : vacia ? (
          <p className="p-4 text-sm text-muted-foreground">No hay reservas para este filtro.</p>
        ) : (
          <>
            {lista.llegan.length > 0 && (
              <section aria-label="Llegan ahora">
                <h3 className="sticky top-0 z-10 flex items-center justify-between border-b bg-primary px-3 py-2 text-base font-semibold text-primary-foreground">
                  <span>Llegan ahora</span>
                  <span className="text-xs font-normal tabular-nums">
                    {lista.llegan.length} · {pax(lista.llegan)} pax
                  </span>
                </h3>
                <ul className="divide-y">{lista.llegan.map((f) => fila(f.reserva, f.mesas, { tarde: f.tarde }))}</ul>
              </section>
            )}
            {lista.porLlegar.length > 0 && (
              <section aria-label="Por llegar">
                <h3 className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/95 px-3 py-2 text-base font-semibold backdrop-blur">
                  <span>Por llegar</span>
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {lista.porLlegar.length} {lista.porLlegar.length === 1 ? "reserva" : "reservas"} · {pax(lista.porLlegar)} pax
                  </span>
                </h3>
                <ul className="divide-y">{lista.porLlegar.map((f) => fila(f.reserva, f.mesas, { tarde: f.tarde }))}</ul>
              </section>
            )}
          </>
        )}
      </div>

      <Sheet open={!!abierta} onOpenChange={(o) => !o && setAbiertaId(null)}>
        <SheetContent
          side={columna ? "left" : "bottom"}
          className={columna ? "w-[min(92vw,28rem)] overflow-y-auto sm:max-w-none" : "max-h-[85dvh] overflow-y-auto rounded-t-2xl"}
        >
          {abierta && (
            <PanelReservaMovil
              key={abierta.id}
              reserva={abierta}
              fecha={fecha}
              salas={salas}
              mesas={mesas ?? []}
              asignaciones={asignacionesDia}
              ajustesDia={ajustesDia ?? []}
              mesasExcluidas={configAsignacionDesde(config).mesasExcluidas}
              mesasAlFinal={configAsignacionDesde(config).mesasAlFinal}
              configOcupacion={configOcupacion}
              nombresMesa={mesasDe(abierta.id)}
              inicio={inicioFicha}
              onCerrar={() => setAbiertaId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!mesaLibre} onOpenChange={(o) => !o && setMesaLibre(null)}>
        <SheetContent side="bottom" className="flex h-[92dvh] max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0">
          {mesaLibre && (
            <PanelMesaLibre
              key={mesaLibre.mesa.id}
              mesa={mesaLibre.mesa}
              prevista={mesaLibre.prevista}
              fecha={fecha}
              turno={turno}
              reservas={reservas ?? []}
              mesas={mesas ?? []}
              asignaciones={asignacionesDia}
              configOcupacion={configOcupacion}
              minutoAhora={minutoAhora}
              salas={salas}
              ajustesDia={ajustesDia ?? []}
              mesasExcluidas={configAsignacionDesde(config).mesasExcluidas}
              mesasAlFinal={configAsignacionDesde(config).mesasAlFinal}
              onVerReserva={(id) => {
                setMesaLibre(null);
                abrirFicha(id);
              }}
              onCerrar={() => setMesaLibre(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Fila de la lista ────────────────────────────────────────────────────────

/**
 * Una reserva en la lista móvil de Hoy, en grande para leerla de un vistazo (07/11/2026): hora, nombre y
 * personas arriba; debajo la mesa («Prevista: Mesa 7» / «En mesa 9» / «Sin mesa»), el estado y, si las
 * hay, las notas del cliente. Toda la fila abre su ficha, salvo el botón «Sentar», que es la acción directa.
 * El teléfono (15/10/2026) es un icono «Llamar» de 44 px en la línea del nombre, desde 375 px de ancho.
 * Un `<button>` no puede ir dentro de otro: el de la fila va por debajo, cubriéndola (`absolute inset-0`), y
 * el contenido por encima sin recibir toques (`pointer-events-none`), salvo el botón «Sentar».
 */
export function FilaReservaMovil({
  reserva,
  nombresMesa,
  terminada,
  tarde,
  sala,
  onAbrir,
  onSentar,
  mesaPrevistaOcupada = false,
  sentando = false,
}: {
  reserva: ReservaMovil;
  nombresMesa: string[];
  /** Ya sentada: «En mesa 9» y sin botón. */
  terminada: boolean;
  tarde?: boolean;
  /** Nombre de la sala, junto a la mesa. */
  sala?: string;
  onAbrir: () => void;
  /** «Sentar · Mesa 7» / «Sentar». Sin él (solo «Ver», o ya sentada) no hay botón. */
  onSentar?: () => void;
  /** Su mesa prevista la ocupa alguien sentado: el botón dice «Sentar» (abre el selector). */
  mesaPrevistaOcupada?: boolean;
  sentando?: boolean;
}) {
  const info = infoEstado(reserva.estado);
  const tel = enlaceTelefono(reserva.telefono);
  const directo = nombresMesa.length > 0 && !mesaPrevistaOcupada;
  const botonDirecto = !!onSentar && directo;
  const sentada = reserva.estado === "completada";
  const textoMesa = textoMesaConfirmada(nombresMesa, sentada);
  const fijada = !!reserva.mesa_fijada && nombresMesa.length > 0;
  const notas = (reserva.notas_cliente ?? "").trim();
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onAbrir}
        aria-label={`${horaCorta(reserva.hora)} ${reserva.nombre || "Sin nombre"}, ${reserva.numero_comensales} personas, ${textoMesa}`}
        className="absolute inset-0 h-full w-full active:bg-muted/60"
      />
      <div className={cn("pointer-events-none relative flex flex-col gap-1.5 px-3 py-2.5 text-left", terminada && "opacity-75")}>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-lg font-semibold leading-tight tabular-nums">{horaCorta(reserva.hora)}</span>
          <span className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight">{reserva.nombre || "Sin nombre"}</span>
          <span className="flex shrink-0 items-center gap-1 text-xl font-bold leading-none tabular-nums" aria-hidden="true">
            <Users className="h-5 w-5 text-muted-foreground" />
            {reserva.numero_comensales}
          </span>
          {/* Teléfono (15/10/2026, petición del dueño): icono de 44 px con márgenes negativos para no
              hacer la fila más alta. Desde 375 px: a 320 px dejaba el nombre en ~100 px. */}
          {tel && (
            <a
              href={tel}
              aria-label={`Llamar a ${reserva.nombre || "la reserva"}`}
              title={telefonoLegible(reserva.telefono) ?? undefined}
              className="pointer-events-auto -my-2 hidden h-11 w-11 shrink-0 items-center justify-center rounded-md text-primary active:bg-muted min-[375px]:inline-flex"
            >
              <Phone className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {/* Sala y mesa, en grande y con el mismo peso (07/11/2026). Con el botón directo ya van en él. */}
            {!botonDirecto && (
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-lg font-semibold leading-tight">
                {sala && <span>{sala}</span>}
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5",
                    nombresMesa.length === 0
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                      : sentada
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
                        : "bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200",
                  )}
                >
                  {fijada && <Lock className="mr-1 h-4 w-4" aria-label="Mesa fijada" />}
                  {textoMesa}
                </span>
              </span>
            )}
            {tarde ? (
              <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Tarde</span>
            ) : (
              info && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", info.insignia)}>{info.etiqueta}</span>
            )}
            <InsigniaMenuDelDia reserva={reserva} />
          </span>
          {/* La protagonista es la MESA (07/11/2026, petición del dueño): «Sentar» pequeño encima y debajo, en
              grande, sala y mesa. Un toque = sentar en ella (con `decidirSentarPrevista`). Sin mesa (o con la
              prevista ocupada), «Elegir mesa» abre el selector. */}
          {onSentar && (
            <Button
              type="button"
              className="pointer-events-auto h-auto min-h-14 max-w-[72%] shrink-0 flex-col items-start justify-center gap-0 px-3 py-1.5 text-left pointer-coarse:px-3"
              disabled={sentando}
              onClick={onSentar}
              aria-label={directo ? `Sentar a ${reserva.nombre || "la reserva"} en ${textoMesas(nombresMesa).toLowerCase()}` : `Sentar a ${reserva.nombre || "la reserva"}: elegir mesa`}
            >
              <span className="flex items-center gap-1 text-xs font-medium leading-tight opacity-90">
                <Armchair className="h-3.5 w-3.5" aria-hidden="true" />
                Sentar
              </span>
              <span className="flex max-w-full items-center gap-1 truncate text-lg font-bold leading-tight" data-testid="boton-mesa">
                {directo && fijada && <Lock className="h-4 w-4 shrink-0" aria-label="Mesa fijada" />}
                <span className="truncate">{directo ? `${sala ? `${sala} · ` : ""}${textoMesas(nombresMesa)}` : "Elegir mesa"}</span>
              </span>
            </Button>
          )}
        </div>
        {notas && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
            <StickyNote className="h-4 w-4 shrink-0" aria-label="Notas del cliente" />
            <span className="truncate">{notas}</span>
          </p>
        )}
      </div>
    </li>
  );
}

// ─── Vista «Mesas» ───────────────────────────────────────────────────────────

/** Una mesa prevista para una reserva que aún no ha llegado (vista «Mesas»). */
export interface PrevistaMesa {
  reservaId: string;
  nombre: string;
  hora: string;
  /** Esa reserva tiene la mesa fijada (candado). */
  fijada?: boolean;
}

function CuadriculaMesas({
  salas,
  mesas,
  asignaciones,
  ajustesDia,
  reservas,
  turno,
  terrazaCerradaId,
  salasEvento,
  onLibre,
  onOcupada,
}: {
  salas: Array<{ id: string; nombre: string }>;
  mesas: Mesa[];
  asignaciones: AsignacionConDetalles[];
  ajustesDia: AjusteDia[];
  reservas: ReservaMovil[];
  turno: TurnoServicio;
  terrazaCerradaId: string | null;
  /** «Evento: sala entera» (20261119100000): salas de un evento en este turno. */
  salasEvento?: ReadonlyMap<string, SalaCerradaEvento>;
  /** Libre o solo prevista para alguien que no ha llegado: sentar aquí. */
  onLibre: (m: MesaOpcion, prevista: PrevistaMesa | null) => void;
  onOcupada: (reservaId: string) => void;
}) {
  const estados = useMemo(() => estadoMesasHoy(asignaciones, reservas, turno, turnoDeHora), [asignaciones, reservas, turno]);
  const fijadas = useMemo(() => new Set(reservas.filter((r) => r.mesa_fijada).map((r) => r.id)), [reservas]);

  const porSala = useMemo(
    () =>
      salas.map((sala) => {
        const deSala = mesas.filter((m) => m.espacio_id === sala.id);
        const piezas = deSala.map(mesaPiezasDesde).filter((m): m is MesaPiezas => m !== null);
        const estado = estadoServicio(
          piezas,
          ajustesDia.filter((a) => a.espacioId === sala.id && a.turno === turno),
        );
        const nombre = new Map(deSala.map((m) => [m.id, m.nombre]));
        const casillas = deSala
          .filter((m) => (estado.get(m.id)?.piezas ?? 1) > 0)
          .map((m) => {
            const union = estado.has(m.id) ? mesasDeLaUnion(estado, m.id) : [m.id];
            return {
              opcion: {
                id: m.id,
                nombre: m.nombre,
                espacioId: sala.id,
                salaNombre: sala.nombre,
                plazas: geometriaServicio(m, estado.get(m.id))?.capacidad ?? m.capacidad,
              } satisfies MesaOpcion,
              junta: union.filter((id) => id !== m.id).map((id) => nombre.get(id) ?? "?"),
            };
          })
          .sort((a, b) => (parseInt(a.opcion.nombre, 10) || 999) - (parseInt(b.opcion.nombre, 10) || 999));
        return { sala, casillas };
      }),
    [salas, mesas, ajustesDia, turno],
  );

  return (
    <div className="space-y-3 p-2">
      {porSala
        .filter((s) => s.casillas.length > 0)
        .map(({ sala, casillas }) => {
          const evento = salasEvento?.get(sala.id) ?? null;
          const cerrada = sala.id === terrazaCerradaId || !!evento;
          const libres = casillas.filter((c) => !estados.has(c.opcion.id)).length;
          return (
            <section key={sala.id} aria-label={sala.nombre}>
              <h3 className="mb-1 flex items-center justify-between gap-2 px-1 text-sm font-semibold">
                <span>{sala.nombre}</span>
                {evento ? (
                  <span
                    className="min-w-0 truncate rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"
                    data-testid="movil-evento-sala"
                  >
                    {textoEvento(evento)}
                  </span>
                ) : (
                  <span className="text-xs font-normal text-muted-foreground">
                    {cerrada ? "Cerrada en este servicio" : `${libres} libres de ${casillas.length}`}
                  </span>
                )}
              </h3>
              {!cerrada && (
                <div className="grid grid-cols-3 gap-2">
                  {casillas.map(({ opcion, junta }) => (
                    <CasillaMesa
                      key={opcion.id}
                      opcion={opcion}
                      junta={junta}
                      estado={estados.get(opcion.id) ?? { tipo: "libre" }}
                      fijadas={fijadas}
                      onLibre={onLibre}
                      onOcupada={onOcupada}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}

function CasillaMesa({
  opcion,
  junta,
  estado,
  fijadas,
  onLibre,
  onOcupada,
}: {
  opcion: MesaOpcion;
  junta: string[];
  estado: EstadoMesaHoy;
  /** Reservas con la mesa fijada: su casilla lleva candado. */
  fijadas?: ReadonlySet<string>;
  onLibre: (m: MesaOpcion, prevista: PrevistaMesa | null) => void;
  onOcupada: (reservaId: string) => void;
}) {
  const fijada = estado.tipo !== "libre" && !!fijadas?.has(estado.reservaId);
  const pulsar = () => {
    if (estado.tipo === "libre") onLibre(opcion, null);
    else if (estado.tipo === "reservada") onLibre(opcion, { reservaId: estado.reservaId, nombre: estado.nombre, hora: estado.hora, fijada });
    else onOcupada(estado.reservaId);
  };
  return (
    <button
      type="button"
      onClick={pulsar}
      className={cn(
        "flex min-h-20 flex-col items-start justify-between rounded-lg border-2 p-2 text-left active:scale-[0.98]",
        estado.tipo === "libre" && "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
        estado.tipo === "sentada" && "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
        estado.tipo === "reservada" && "border-sky-500 bg-sky-50 dark:bg-sky-950/40",
      )}
      aria-label={`Mesa ${opcion.nombre}, ${opcion.plazas} plazas, ${estado.tipo === "libre" ? "libre" : estado.tipo === "sentada" ? `sentada: ${estado.nombre}` : `${fijada ? "fijada" : "prevista"} a las ${horaCorta(estado.hora)} para ${estado.nombre || "una reserva"}`}`}
    >
      <span className="flex w-full items-baseline justify-between gap-1">
        <span className="flex items-center gap-1 text-lg font-bold leading-none">
          {opcion.nombre}
          {fijada && <Lock className="h-3.5 w-3.5" aria-hidden="true" data-testid="candado-mesa" />}
        </span>
        <span className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
          <Users className="h-3 w-3" aria-hidden />
          {opcion.plazas}
        </span>
      </span>
      <span className="w-full truncate text-xs">
        {estado.tipo === "libre"
          ? "Libre"
          : estado.tipo === "sentada"
            ? `${estado.nombre || "Sentada"} · ${estado.comensales}`
            : `${horaCorta(estado.hora)} · ${estado.nombre || "Reserva"}`}
      </span>
      {junta.length > 0 && <span className="text-[11px] pointer-coarse:text-xs text-muted-foreground">+ {junta.join(", ")}</span>}
    </button>
  );
}

// ─── Leyenda de colores (vista Mesas) ─────────────────────────────────────────
// Pedida por el dueño el 08/11/2026: en el móvil no se sabía qué era cada color. Mismos colores que `CasillaMesa`.
const LEYENDA_MOVIL = [
  { texto: "Libre", clase: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" },
  { texto: "Reservada", clase: "border-sky-500 bg-sky-50 dark:bg-sky-950/40" },
  { texto: "Sentada", clase: "border-amber-500 bg-amber-50 dark:bg-amber-950/40" },
] as const;

export function LeyendaMesasMovil() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs text-muted-foreground" aria-label="Leyenda de colores de las mesas" data-testid="leyenda-mesas-movil">
      {LEYENDA_MOVIL.map((l) => (
        <li key={l.texto} className="flex items-center gap-1">
          <span className={cn("inline-block h-3.5 w-3.5 rounded border-2", l.clase)} aria-hidden="true" />
          {l.texto}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        Fijada
      </li>
    </ul>
  );
}

// ─── «Recalcular mesas» (vista Mesas) ────────────────────────────────────────

/**
 * Botón discreto encima de la cuadrícula (07/11/2026): recoloca las reservas POR LLEGAR y NO fijadas del turno
 * cuya mesa prevista está ocupada ahora o choca, a la mejor mesa libre de su sala (`proponerRecalculo`). Antes
 * enseña el resumen («Se moverán 3 reservas: García 7→9, …») con Confirmar/Cancelar. No toca las fijadas ni las
 * sentadas. Se aplica una a una; si una falla, se para y se avisa (las anteriores quedan hechas).
 */
function RecalcularMesasMovil({
  fecha,
  turno,
  salas,
  mesas,
  asignaciones,
  ajustesDia,
  mesasExcluidas,
  mesasAlFinal = [],
  configOcupacion,
}: {
  fecha: string;
  turno: TurnoServicio;
  salas: Array<{ id: string; nombre: string }>;
  mesas: Mesa[];
  asignaciones: AsignacionConDetalles[];
  ajustesDia: AjusteDia[];
  mesasExcluidas: readonly string[];
  /** Mesas que se usan solo como último recurso (para dejar paso). */
  mesasAlFinal?: readonly string[];
  configOcupacion: ConfigOcupacionMesa;
}) {
  const asignarLocal = useAsignarConCambioLocal(fecha, mesas);
  const [propuesta, setPropuesta] = useState<ReturnType<typeof proponerRecalculo> | null>(null);
  const [aplicando, setAplicando] = useState(false);

  const calcular = () =>
    setPropuesta(
      proponerRecalculo({
        opciones: opcionesMesasServicio({ salas, mesas, ajustesDia, turno }),
        asignaciones,
        turno,
        excluidas: new Set(mesasExcluidas),
        alFinal: new Set(mesasAlFinal),
        config: configOcupacion,
      }),
    );

  const aplicar = async () => {
    if (!propuesta) return;
    setAplicando(true);
    let hechas = 0;
    try {
      for (const m of propuesta.movimientos) {
        await asignarLocal(m.reservaId, [m.hacia.id]);
        hechas++;
      }
      toast.success(hechas === 1 ? "1 reserva cambiada de mesa" : `${hechas} reservas cambiadas de mesa`, {
        description: propuesta.movimientos.map((m) => m.texto).join(", "),
      });
      setPropuesta(null);
    } catch (e) {
      toast.error(`Se han cambiado ${hechas} de ${propuesta.movimientos.length}. ${mensajeUsuario(e)}`);
      setPropuesta(null);
    } finally {
      setAplicando(false);
    }
  };

  if (!propuesta) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-2 px-2 pt-2">
        <LeyendaMesasMovil />
        <Button variant="ghost" size="sm" className="ml-auto h-11 text-muted-foreground" onClick={calcular}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Recalcular mesas
        </Button>
      </div>
    );
  }
  const nada = propuesta.movimientos.length === 0;
  return (
    <div role="status" className="m-2 space-y-2 rounded-lg border-2 border-sky-400 bg-sky-50 p-3 dark:bg-sky-950/40" data-testid="recalcular-mesas">
      <p className="text-sm font-medium">{propuesta.resumen}</p>
      {propuesta.sinSitio.map((s) => (
        <p key={s.reservaId} className="text-xs text-muted-foreground">
          {textoSinSitio(s)}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">No se tocan las sentadas ni las que tienen la mesa fijada.</p>
      {nada ? (
        <Button variant="outline" className="h-11 w-full" onClick={() => setPropuesta(null)}>
          Cerrar
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" disabled={aplicando} onClick={() => setPropuesta(null)}>
            Cancelar
          </Button>
          <Button className="h-12" disabled={aplicando} onClick={() => void aplicar()}>
            Confirmar
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Escribir mesas (con cambio local inmediato) ─────────────────────────────

/**
 * `asignar_mesas_reserva` con el cambio aplicado YA en la lista de asignaciones de hoy (la de esta vista),
 * para que la vista «Mesas» y las demás filas lo enseñen al momento; la invalidación del hook trae después
 * la verdad. Si falla (MESA_OCUPADA…), el propio hook avisa con el mensaje en español y aquí se relee todo.
 */
function useAsignarConCambioLocal(fecha: string, mesas: readonly Mesa[]) {
  const qc = useQueryClient();
  const asignar = useAsignarMesasReserva();
  return useCallback(
    async (reservaId: string, mesaIds: string[], reserva?: ReservaMovil) => {
      const mapa = new Map(mesas.map((m) => [m.id, m]));
      const datosReserva = reserva
        ? {
            id: reserva.id,
            nombre: reserva.nombre ?? "",
            hora: reserva.hora,
            numero_comensales: reserva.numero_comensales,
            estado: reserva.estado,
            fecha,
            salida_at: reserva.salida_at ?? null,
          }
        : null;
      qc.setQueriesData<AsignacionConDetalles[]>(
        { predicate: (q) => q.queryKey[0] === CLAVE_ASIGNACIONES && q.queryKey[1] === fecha && q.queryKey[2] == null },
        (antes) => (Array.isArray(antes) ? reemplazarMesasEnLista(antes, reservaId, mesaIds, { mesas: mapa, reserva: datosReserva }) : antes),
      );
      try {
        await asignar.mutateAsync({ reserva_id: reservaId, mesa_ids: mesaIds, silencioso: true });
      } catch (e) {
        refrescarTrasError(qc);
        throw e;
      }
    },
    [asignar, fecha, mesas, qc],
  );
}

/** Quitarles la mesa a las reservas desplazadas; si algo falla después, `deshacer` se las devuelve. */
function useDesplazar(asignarLocal: ReturnType<typeof useAsignarConCambioLocal>) {
  return useCallback(
    async (desplazadas: readonly Desplazamiento[]) => {
      const hechas: Desplazamiento[] = [];
      for (const d of desplazadas) {
        await asignarLocal(d.reservaId, d.mesaIdsQuedan);
        hechas.push(d);
      }
      return async () => {
        for (const d of hechas) await asignarLocal(d.reservaId, d.mesaIdsAntes).catch(() => undefined);
      };
    },
    [asignarLocal],
  );
}

/** «García se queda sin mesa prevista.» / «García sigue con la mesa 8.» para el aviso de después. */
function textoDesplazadas(desplazadas: readonly Desplazamiento[], nombreMesa: (id: string) => string): string | undefined {
  if (desplazadas.length === 0) return undefined;
  return desplazadas
    .map((d) =>
      d.recolocadaEn
        ? `${d.nombre} (${horaCorta(d.hora)}) pasa a la mesa ${d.recolocadaEn.mesaNombre}.`
        : d.mesaIdsQuedan.length === 0
          ? `${d.nombre} (${horaCorta(d.hora)}) se queda sin mesa${d.recolocadaEn === null ? ": no hay ninguna libre" : " prevista"}.`
          : `${d.nombre} (${horaCorta(d.hora)}) sigue con ${textoMesas(d.mesaIdsQuedan.map(nombreMesa)).toLowerCase()}.`,
    )
    .join(" ");
}

/** Mover de sala si hace falta, quitar la mesa a quien la tuviera prevista, dar la mesa y (si no había llegado) sentar. */
function useSentarReservaEnMesa(fecha: string, mesas: readonly Mesa[]) {
  const { marcarLlegada, moverEspacio } = useAccionesServicioReserva();
  const asignarLocal = useAsignarConCambioLocal(fecha, mesas);
  const desplazar = useDesplazar(asignarLocal);
  const fijarMesa = useFijarMesa();
  const nombreMesa = (id: string) => mesas.find((m) => m.id === id)?.nombre ?? "?";
  return async (
    reserva: ReservaMovil,
    mesa: MesaOpcion,
    opciones: { antes?: () => Promise<void>; desplazadas?: readonly Desplazamiento[]; quitarFijacion?: boolean } = {},
  ) => {
    let actual = reserva;
    if (mesa.espacioId !== reserva.espacio_id) {
      const ok = await moverEspacio(reserva, mesa.espacioId, mesa.salaNombre);
      if (!ok) throw new Error("mover");
      actual = { ...reserva, espacio_id: mesa.espacioId };
    }
    if (opciones.antes) await opciones.antes();
    const deshacer = await desplazar(opciones.desplazadas ?? []);
    try {
      await asignarLocal(reserva.id, [mesa.id], reserva);
    } catch (e) {
      await deshacer();
      throw e;
    }
    // Cambiada de mesa a sabiendas («¿Cambiarla igualmente?»): ya no está fijada.
    if (opciones.quitarFijacion) await fijarMesa(reserva, false, { silencioso: true });
    toast.success(`${reserva.nombre || "Reserva"} → mesa ${mesa.nombre}`, {
      description: [opciones.quitarFijacion ? "Ya no tiene la mesa fijada." : "", textoDesplazadas(opciones.desplazadas ?? [], nombreMesa) ?? ""]
        .filter(Boolean)
        .join(" ") || undefined,
    });
    if (!estaTerminada(reserva.estado)) await marcarLlegada(actual);
  };
}

// ─── Confirmación «Sentar igualmente» ────────────────────────────────────────

interface Pendiente {
  texto: string;
  ejecutar: () => Promise<unknown>;
  /** Texto del botón de confirmar (por defecto «Sentar igualmente»). */
  boton?: string;
}

const AVISO_FIJADA = "Esta reserva tiene la mesa fijada. ¿Cambiarla igualmente?";

function ConfirmarDesplazamiento({
  pendiente,
  ocupado,
  onConfirmar,
  onCancelar,
}: {
  pendiente: Pendiente;
  ocupado: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/40">
      <p className="text-sm font-medium">{pendiente.texto}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" disabled={ocupado} onClick={onCancelar}>
          Cancelar
        </Button>
        <Button className="h-12" disabled={ocupado} onClick={onConfirmar}>
          {pendiente.boton ?? "Sentar igualmente"}
        </Button>
      </div>
    </div>
  );
}

// ─── Ficha de una mesa libre (o solo prevista) ───────────────────────────────

/** Botones de «Sentar sin reserva» en la hoja de una mesa (10/11/2026: de 1 a 12, más un campo para otro número). */
const PERSONAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Hoja de una mesa LIBRE o solo PREVISTA (10/11/2026, petición del dueño: «al hacer clic en la mesa tiene que ser
 * para sentar a alguien, con o sin reserva»). De arriba abajo:
 *   1. Prevista para una reserva: «Sentar a <nombre>» (llegó) en grande.
 *   2. «Sentar sin reserva»: abre cuántos son (1-12 o un número) y el nombre opcional; crea la reserva walk-in
 *      (`useSentarSinReserva`, el mismo flujo que el botón «Sin reserva») ya sentada en ESTA mesa.
 *   3. Las reservas del turno que aún no han llegado, para sentarlas aquí con un toque.
 * `extra`: botones al final (escritorio: «Ver detalle de la mesa», lo que hacía antes el clic).
 */
export function PanelMesaLibre({
  mesa,
  prevista = null,
  fecha,
  turno,
  reservas,
  mesas = [],
  asignaciones = [],
  configOcupacion,
  minutoAhora,
  salas,
  ajustesDia = [],
  mesasExcluidas = [],
  mesasAlFinal = [],
  onVerReserva,
  extra,
  onCerrar,
}: {
  mesa: MesaOpcion;
  /** La mesa está prevista para una reserva que aún no ha llegado. */
  prevista?: PrevistaMesa | null;
  fecha: string;
  turno: TurnoServicio;
  reservas: ReservaMovil[];
  mesas?: Mesa[];
  asignaciones?: AsignacionConDetalles[];
  configOcupacion?: ConfigOcupacionMesa;
  minutoAhora: number;
  /** Con las salas (y los ajustes del día) se recoloca a quien pierde su mesa prevista; sin ellas, se queda sin mesa. */
  salas?: Array<{ id: string; nombre: string }>;
  ajustesDia?: AjusteDia[];
  mesasExcluidas?: readonly string[];
  mesasAlFinal?: readonly string[];
  onVerReserva?: (reservaId: string) => void;
  /** Acciones de más al pie del contenido (escritorio: «Ver detalle de la mesa»). */
  extra?: ReactNode;
  onCerrar: () => void;
}) {
  const sentarSinReserva = useSentarSinReserva();
  const sentarReserva = useSentarReservaEnMesa(fecha, mesas);
  const desplazar = useDesplazar(useAsignarConCambioLocal(fecha, mesas));
  const [ocupado, setOcupado] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  // Sentar (con o sin reserva) escribe: solo con «Editar» en Reservas.
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const nombreMesa = (id: string) => mesas.find((m) => m.id === id)?.nombre ?? "?";
  const opciones = useMemo(
    () => (salas ? opcionesMesasServicio({ salas, mesas, ajustesDia, turno }) : null),
    [salas, mesas, ajustesDia, turno],
  );
  /** A quien pierde su única mesa prevista se le busca la mejor libre de su sala (07/11/2026). */
  const recolocar = (desplazadas: readonly Desplazamiento[]): Desplazamiento[] =>
    opciones
      ? recolocarDesplazadas({
          desplazadas,
          opciones,
          asignaciones,
          mesasElegidas: [mesa.id],
          excluidas: new Set(mesasExcluidas),
          alFinal: new Set(mesasAlFinal),
          config: configOcupacion,
        })
      : [...desplazadas];

  // A quién sentar aquí (08/11/2026, «grande y claro»): «Encajan aquí» (caben y sin mesa o con esta prevista;
  // retrasadas arriba), «Otras» por hora y, al final y atenuadas, las que tienen FIJADA otra mesa.
  const mesasDeReserva = useMemo(() => {
    const salaDe = new Map((salas ?? []).map((s) => [s.id, s.nombre]));
    const mapa = new Map<string, MesaDeReserva[]>();
    for (const a of asignaciones) {
      const m = mesas.find((x) => x.id === a.mesa_id);
      const espacio = m?.espacio_id ?? a.mesas?.espacio_id;
      const fila = { id: a.mesa_id, nombre: m?.nombre ?? a.mesas?.nombre ?? "?", sala: espacio ? salaDe.get(espacio) : undefined };
      mapa.set(a.reserva_id, [...(mapa.get(a.reserva_id) ?? []), fila]);
    }
    return mapa;
  }, [asignaciones, mesas, salas]);
  const candidatas = useMemo(
    () =>
      candidatasParaMesa(reservas, {
        mesaId: mesa.id,
        plazas: mesa.plazas,
        turno,
        turnoDe: turnoDeHora,
        minutoAhora,
        mesasDe: (id) => mesasDeReserva.get(id) ?? [],
      }),
    [reservas, mesa.id, mesa.plazas, turno, minutoAhora, mesasDeReserva],
  );
  // La reserva prevista va arriba, en su propio botón: no se repite en la lista.
  const sinPrevista = <T extends { reserva: ReservaMovil }>(filas: readonly T[]) => filas.filter((c) => c.reserva.id !== prevista?.reservaId);
  const grupos = [
    ["Encajan aquí", sinPrevista(candidatas.encajan), false],
    ["Otras", sinPrevista(candidatas.otras), false],
    ["Con otra mesa fijada", sinPrevista(candidatas.fijadasOtra), true],
  ] as const;
  const hayCandidatas = grupos.some(([, filas]) => filas.length > 0);
  const reservaPrevista = prevista ? (reservas.find((r) => r.id === prevista.reservaId) ?? null) : null;

  // «Sentar sin reserva»: cerrado hasta tocarlo; dentro, cuántos son y el nombre (opcional).
  const [sinReservaAbierto, setSinReservaAbierto] = useState(false);
  const [personasSR, setPersonasSR] = useState<number | null>(null);
  const [otrasSR, setOtrasSR] = useState("");
  const [nombreSR, setNombreSR] = useState("");

  // Para quien entra sin reserva: ¿pisa la franja de ahora a alguien?
  const [horaAhora] = useState(() => horaActual());
  const estadoSinReserva = useMemo(
    () => estadoParaConfirmar(asignaciones, mesa.id, { id: "", hora: horaAhora }, configOcupacion),
    [asignaciones, mesa.id, horaAhora, configOcupacion],
  );

  const ejecutar = async (trabajo: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await trabajo();
      onCerrar();
    } catch (e) {
      if (e instanceof Error && e.message !== "mover") toast.error(mensajeUsuario(e));
    } finally {
      setOcupado(false);
      setPendiente(null);
    }
  };

  const sinReservaYa = (personas: number, desplazadas: readonly Desplazamiento[]) =>
    ejecutar(async () => {
      const deshacerDesplazar = await desplazar(desplazadas);
      const r = await sentarSinReserva.mutateAsync({ fecha, hora: horaActual(), personas, nombre: nombreSR, mesa });
      if (r.errorMesa) await deshacerDesplazar();
      const deshacer = {
        label: "Deshacer",
        onClick: async () => {
          if (await deshacerSinReserva(r.id)) toast.success("Deshecho");
          else toast.error("No se ha podido deshacer");
        },
      };
      if (r.errorMesa) toast.warning(`${r.nombre} sentado sin mesa: ${r.errorMesa}`, { action: deshacer });
      else toast.success(`${r.nombre} → mesa ${mesa.nombre}`, { action: deshacer, description: textoDesplazadas(desplazadas, nombreMesa) });
    });

  const sinReserva = (personas: number) => {
    if (estadoSinReserva.tipo !== "prevista" && estadoSinReserva.tipo !== "libre") return;
    const desplazadas = estadoSinReserva.tipo === "prevista" ? recolocar(estadoSinReserva.desplazadas) : [];
    const textos = [
      personas > mesa.plazas ? `Son ${personas} y la mesa ${mesa.nombre} es de ${mesa.plazas}.` : "",
      desplazadas.length > 0 ? textoDesplazamiento(mesa.nombre, desplazadas, nombreMesa) : "",
    ].filter(Boolean);
    if (textos.length > 0) setPendiente({ texto: textos.join(" "), ejecutar: () => sinReservaYa(personas, desplazadas) });
    else void sinReservaYa(personas, []);
  };

  const sentarUna = (r: ReservaMovil) => {
    const estado = estadoParaConfirmar(asignaciones, mesa.id, { id: r.id, hora: r.hora }, configOcupacion);
    if (estado.tipo === "ocupada") {
      toast.error(`La mesa ${mesa.nombre} está ocupada por ${estado.nombre}.`);
      return;
    }
    if (estado.tipo === "fijada") {
      toast.error(`La mesa ${mesa.nombre} está fijada para ${estado.nombre} (${horaCorta(estado.hora)}).`);
      return;
    }
    const desplazadas = estado.tipo === "prevista" ? recolocar(estado.desplazadas) : [];
    // Su mesa fijada es OTRA: se pregunta antes y, al cambiarla, se quita la fijación.
    const propias = asignaciones.filter((a) => a.reserva_id === r.id).map((a) => a.mesa_id);
    const quitarFijacion = !!r.mesa_fijada && propias.length > 0 && !propias.includes(mesa.id);
    const hacer = () => ejecutar(() => sentarReserva(r, mesa, { desplazadas, quitarFijacion }));
    const suyas = mesasDeReserva.get(r.id) ?? [];
    const pax = r.numero_comensales || 0;
    const textos = [
      quitarFijacion
        ? suyas.length > 0
          ? `Tiene fijada ${textoMesaFijada(suyas)}. ¿Sentarla aquí y quitar la fijación?`
          : AVISO_FIJADA
        : "",
      pax > mesa.plazas ? `Son ${pax} y la mesa ${mesa.nombre} es de ${mesa.plazas}.` : "",
      desplazadas.length > 0 ? textoDesplazamiento(mesa.nombre, desplazadas, nombreMesa) : "",
    ].filter(Boolean);
    if (textos.length > 0) setPendiente({ texto: textos.join(" "), ejecutar: hacer, boton: quitarFijacion ? "Cambiar igualmente" : undefined });
    else void hacer();
  };

  const ocupadaAhora = estadoSinReserva.tipo === "ocupada" || estadoSinReserva.tipo === "fijada";

  return (
    // Hoja casi a pantalla completa (08/11/2026): cabecera fija arriba, UN solo scroll en el contenido y «Cerrar»
    // abajo. Fuera de una hoja de altura fija (tests) se ve igual, sin scroll.
    <div className="flex h-full min-h-0 flex-col" data-testid="hoja-mesa-libre">
      <SheetHeader className="shrink-0 border-b px-4 pb-3 pt-4 text-left">
        <SheetTitle className="text-2xl font-bold">
          Mesa {mesa.nombre} · {mesa.salaNombre}
        </SheetTitle>
        <SheetDescription>
          {prevista
            ? `${prevista.fijada ? "Fijada" : "Prevista"} para ${prevista.nombre || "una reserva"} (${horaCorta(prevista.hora)}) · ${mesa.plazas} plazas`
            : `Libre · ${mesa.plazas} plazas`}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3" data-testid="hoja-mesa-contenido">
      {estadoSinReserva.tipo === "fijada" && (
        <p className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Mesa fijada para {estadoSinReserva.nombre} ({horaCorta(estadoSinReserva.hora)}): no se puede sentar a otro aquí.
        </p>
      )}

      {pendiente ? (
        <ConfirmarDesplazamiento
          pendiente={pendiente}
          ocupado={ocupado}
          onCancelar={() => setPendiente(null)}
          onConfirmar={() => void pendiente.ejecutar()}
        />
      ) : (
        <>
          {puedeEditar && reservaPrevista && (
            <Button
              className="h-auto min-h-16 w-full flex-col gap-0.5 py-2 text-lg font-bold"
              disabled={ocupado}
              onClick={() => sentarUna(reservaPrevista)}
              data-testid="sentar-prevista"
            >
              <span>Sentar a {reservaPrevista.nombre || "la reserva"}</span>
              <span className="text-sm font-normal opacity-90">
                {horaCorta(reservaPrevista.hora)} · {reservaPrevista.numero_comensales} personas · ha llegado
              </span>
            </Button>
          )}

          {puedeEditar && !ocupadaAhora && (
            <section aria-label="Sentar sin reserva" className="space-y-3">
              <Button
                variant={reservaPrevista ? "secondary" : "default"}
                className="h-16 w-full gap-2 text-lg font-bold"
                aria-expanded={sinReservaAbierto}
                disabled={ocupado}
                onClick={() => setSinReservaAbierto((v) => !v)}
              >
                <UserPlus className="h-6 w-6" aria-hidden="true" />
                Sentar sin reserva
              </Button>
              {sinReservaAbierto && (
                <div className="space-y-3 rounded-lg border p-3" data-testid="sin-reserva-mesa">
                  <p className="text-base font-semibold">¿Cuántos son?</p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {PERSONAS.map((n) => (
                      <Button
                        key={n}
                        variant={personasSR === n && !otrasSR ? "default" : "outline"}
                        className="h-14 text-lg font-semibold"
                        disabled={ocupado}
                        aria-pressed={personasSR === n && !otrasSR}
                        onClick={() => {
                          setPersonasSR(n);
                          setOtrasSR("");
                        }}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="Otro número…"
                    value={otrasSR}
                    className="h-12 text-base"
                    aria-label="Número de personas"
                    onChange={(e) => {
                      setOtrasSR(e.target.value);
                      const n = parseInt(e.target.value, 10);
                      setPersonasSR(Number.isFinite(n) && n > 0 ? n : null);
                    }}
                  />
                  <Input
                    value={nombreSR}
                    onChange={(e) => setNombreSR(e.target.value)}
                    placeholder="Nombre (opcional)"
                    className="h-12 text-base"
                    aria-label="Nombre (opcional)"
                  />
                  {personasSR !== null && personasSR > mesa.plazas && (
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      Son {personasSR} y la mesa es de {mesa.plazas}: quizá haya que juntar mesas.
                    </p>
                  )}
                  <Button
                    className="h-14 w-full text-base font-semibold"
                    disabled={ocupado || personasSR === null}
                    onClick={() => personasSR !== null && sinReserva(personasSR)}
                  >
                    {personasSR === null ? "Elige cuántos son" : `Sentar ${personasSR} en mesa ${mesa.nombre}`}
                  </Button>
                </div>
              )}
            </section>
          )}

          {puedeEditar && hayCandidatas && (
            <section aria-label="Sentar una reserva" className="space-y-3 border-t pt-4">
              <p className="text-base font-semibold">{reservaPrevista ? "Otra reserva" : "Sentar una reserva"}</p>
              {grupos.map(
                ([titulo, filas, atenuadas]) =>
                  filas.length > 0 && (
                    <div key={titulo} className="space-y-1.5" data-grupo={titulo}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
                      <ul className="space-y-2">
                        {filas.map((c) => (
                          <FilaCandidataMesa
                            key={c.reserva.id}
                            candidata={c}
                            plazasMesa={mesa.plazas}
                            atenuada={atenuadas}
                            destacada={false}
                            disabled={ocupado}
                            onSentar={() => sentarUna(c.reserva)}
                          />
                        ))}
                      </ul>
                    </div>
                  ),
              )}
            </section>
          )}
        </>
      )}

      {prevista && onVerReserva && (
        <Button variant="outline" className="h-11 w-full" onClick={() => onVerReserva(prevista.reservaId)}>
          Ver la ficha de {prevista.nombre || "la reserva"}
        </Button>
      )}
      {extra}
      </div>

      <div className="shrink-0 border-t px-4 py-2">
        <Button variant="ghost" className="h-12 w-full" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}

/**
 * `PanelMesaLibre` con sus datos (10/11/2026): para el plano de «Hoy» de escritorio, que solo sabe la mesa tocada.
 * Lee salas, mesas, asignaciones, ajustes y configuración con las MISMAS consultas que la lista de la izquierda
 * (misma caché: no pide nada nuevo).
 */
export function HojaMesaSentar({
  mesa,
  prevista,
  fecha,
  turno,
  reservas,
  extra,
  onCerrar,
}: {
  mesa: MesaOpcion;
  prevista: PrevistaMesa | null;
  fecha: string;
  turno: TurnoServicio;
  reservas: ReservaMovil[];
  extra?: ReactNode;
  onCerrar: () => void;
}) {
  const minutoAhora = useMinutoAhora();
  const { data: espacios } = useEspaciosReserva();
  const { data: mesas } = useMesas();
  const { data: asignaciones } = useAsignacionesMesa(fecha);
  const { data: ajustesDia } = useAjustesMesaDia(fecha);
  const { data: config } = useConfiguracionReservas();
  const salas = useMemo(
    () => ((espacios ?? []) as Array<{ id: string; nombre: string }>).map((e) => ({ id: e.id, nombre: e.nombre })),
    [espacios],
  );
  const asignacion = configAsignacionDesde(config);
  return (
    <PanelMesaLibre
      mesa={mesa}
      prevista={prevista}
      fecha={fecha}
      turno={turno}
      reservas={reservas}
      mesas={mesas ?? []}
      asignaciones={asignaciones ?? []}
      configOcupacion={configServicioSalaDesde(config)}
      minutoAhora={minutoAhora}
      salas={salas}
      ajustesDia={ajustesDia ?? []}
      mesasExcluidas={asignacion.mesasExcluidas}
      mesasAlFinal={asignacion.mesasAlFinal}
      extra={extra}
      onCerrar={onCerrar}
    />
  );
}

/**
 * Una reserva en la hoja de una mesa libre (08/11/2026): fila grande (≥ 64 px) con hora, nombre y personas y,
 * debajo, su situación («Sin mesa», «Prevista: Comedor 7», «Fijada · Comedor 7» con candado), nota, alergia y,
 * si no caben, «Son 6 · mesa de 4» en ámbar.
 */
function FilaCandidataMesa({
  candidata,
  plazasMesa,
  atenuada,
  destacada,
  disabled,
  onSentar,
}: {
  candidata: CandidataMesa<ReservaMovil>;
  plazasMesa: number;
  atenuada: boolean;
  destacada: boolean;
  disabled: boolean;
  onSentar: () => void;
}) {
  const { reserva: r, situacion, textoSituacion, noCaben, retrasada } = candidata;
  const notas = (r.notas_cliente ?? "").trim();
  const alergia = tieneAlergia(notas);
  return (
    <li data-reserva-id={r.id} data-situacion={situacion} data-atenuada={atenuada ? "true" : undefined}>
      <Button
        variant={destacada ? "default" : "outline"}
        className={cn("h-auto min-h-16 w-full flex-col items-stretch gap-1 px-3 py-2 text-left", atenuada && "opacity-60")}
        disabled={disabled}
        onClick={onSentar}
        aria-label={`${horaCorta(r.hora)} ${r.nombre || "Sin nombre"}, ${r.numero_comensales} personas, ${textoSituacion}${noCaben ? `, son ${r.numero_comensales} y la mesa es de ${plazasMesa}` : ""}`}
      >
        <span className="flex w-full items-center gap-2">
          <span className="text-lg font-bold tabular-nums">{horaCorta(r.hora)}</span>
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{r.nombre || "Sin nombre"}</span>
          <span className="flex shrink-0 items-center gap-1 text-lg font-bold tabular-nums">
            <Users className="h-5 w-5" aria-hidden />
            {r.numero_comensales}
          </span>
        </span>
        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium" data-testid="situacion-reserva">
          <span className={cn("inline-flex items-center gap-1", !destacada && "text-muted-foreground")}>
            {(situacion === "fijada" || textoSituacion.startsWith("Fijada")) && <Lock className="h-3.5 w-3.5" aria-label="Mesa fijada" />}
            {textoSituacion}
          </span>
          {retrasada && <span className="rounded-full bg-red-600 px-1.5 text-white">Tarde</span>}
          {noCaben && (
            <span className="rounded-full bg-amber-100 px-1.5 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200" data-testid="aviso-no-caben">
              Son {r.numero_comensales} · mesa de {plazasMesa}
            </span>
          )}
          {alergia && <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-label="Alergia" />}
          {notas && !alergia && <StickyNote className="h-3.5 w-3.5" aria-label="Notas del cliente" />}
        </span>
      </Button>
    </li>
  );
}

// ─── Selector de mesa («¿Dónde se sientan?») ─────────────────────────────────

/**
 * Rejilla de botones grandes con las mesas de TODAS las salas donde cabe la reserva, agrupadas por sala:
 * arriba la suya (la prevista, o donde está sentada); cada una marcada libre (verde), prevista para otra
 * reserva (ámbar, se puede elegir) u ocupada por alguien sentado (gris, no se puede).
 */
export function SelectorMesaMovil({
  selector,
  sentada,
  ocupado,
  onElegir,
  fijadaPropia = false,
}: {
  selector: SelectorMesas;
  /** La reserva ya está sentada: su mesa actual no se vuelve a ofrecer. */
  sentada: boolean;
  ocupado: boolean;
  onElegir: (m: MesaParaConfirmar) => void;
  /** La propia reserva tiene la mesa fijada: candado en «Su mesa». */
  fijadaPropia?: boolean;
}) {
  const casilla = (m: MesaParaConfirmar) => {
    // Fijada para OTRA reserva (07/11/2026): se ve, con candado, pero no se puede elegir.
    const fijadaOtra = !m.propia && m.estado.tipo === "fijada";
    const deshabilitada = ocupado || m.estado.tipo === "ocupada" || fijadaOtra || (m.propia && sentada);
    const detalle = m.propia && (sentada || (m.estado.tipo !== "ocupada" && m.estado.tipo !== "fijada"))
      ? sentada
        ? "Aquí está"
        : fijadaPropia
          ? "Su mesa (fijada)"
          : "Su mesa prevista"
      : m.estado.tipo === "ocupada"
        ? `Ocupada · ${m.estado.nombre}`
        : m.estado.tipo === "fijada"
          ? `Fijada · ${m.estado.nombre} ${horaCorta(m.estado.hora)}`
          : m.estado.tipo === "prevista"
            ? `Prevista: ${m.estado.desplazadas.map((d) => `${d.nombre} ${horaCorta(d.hora)}`).join(", ")}`
            : m.alFinal
              ? "Libre · Mejor dejar libre"
              : "Libre";
    const candado = fijadaOtra || (m.propia && fijadaPropia);
    return (
      <li key={m.id}>
        <button
          type="button"
          disabled={deshabilitada}
          onClick={() => onElegir(m)}
          aria-label={`Mesa ${m.nombre}, ${m.plazas} plazas, ${m.salaNombre}: ${detalle}`}
          className={cn(
            "flex min-h-16 w-full flex-col items-start justify-between rounded-lg border-2 p-2 text-left active:scale-[0.98] disabled:cursor-not-allowed",
            m.propia && "border-primary bg-primary/10",
            !m.propia && m.estado.tipo === "libre" && "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
            !m.propia && m.estado.tipo === "prevista" && "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
            !m.propia && (m.estado.tipo === "ocupada" || m.estado.tipo === "fijada") && "border-muted bg-muted/60 text-muted-foreground opacity-70",
          )}
        >
          <span className="flex w-full items-baseline justify-between gap-1">
            <span className="flex items-center gap-1 text-lg font-bold leading-none">
              {m.nombre}
              {candado && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
              <Users className="h-3 w-3" aria-hidden />
              {m.plazas}
            </span>
          </span>
          <span className="line-clamp-2 w-full text-xs">{detalle}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3" data-testid="selector-mesa">
      {selector.propias.length > 0 && (
        <section aria-label={sentada ? "Su mesa" : "Prevista"}>
          <h4 className="mb-1 text-sm font-semibold">{sentada ? "Ahora en" : "Prevista"}</h4>
          <ul className="grid grid-cols-3 gap-2">{selector.propias.map(casilla)}</ul>
        </section>
      )}
      {selector.salas.map((s) => (
        <section key={s.salaId} aria-label={s.salaNombre}>
          <h4 className="mb-1 text-sm font-semibold">{s.salaNombre}</h4>
          <ul className="grid grid-cols-3 gap-2">{s.mesas.map(casilla)}</ul>
        </section>
      ))}
    </div>
  );
}

// ─── Ficha de una reserva ────────────────────────────────────────────────────

export function PanelReservaMovil({
  reserva,
  fecha,
  salas,
  mesas,
  asignaciones,
  ajustesDia,
  mesasExcluidas,
  mesasAlFinal = [],
  configOcupacion,
  nombresMesa,
  inicio = "normal",
  onCerrar,
}: {
  reserva: ReservaMovil;
  fecha: string;
  salas: Array<{ id: string; nombre: string }>;
  mesas: Mesa[];
  asignaciones: AsignacionConDetalles[];
  ajustesDia: AjusteDia[];
  mesasExcluidas: readonly string[];
  mesasAlFinal?: readonly string[];
  configOcupacion: ReturnType<typeof configServicioSalaDesde>;
  nombresMesa: string[];
  /** Desde el botón «Sentar» de la fila: con el selector abierto o con la confirmación de quitar la prevista a otra. */
  inicio?: InicioFicha;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { marcarLlegada, marcarNoShow, deshacerLlegadaONoShow } = useAccionesServicioReserva();
  const { liberarMesa } = useAccionesModoServicio();
  const sentarReserva = useSentarReservaEnMesa(fecha, mesas);
  const turno: TurnoServicio = turnoDeHora(reserva.hora);
  const guardarAjustes = useGuardarAjustesMesa(reserva.espacio_id ?? "", fecha, turno);
  // Todo lo de esta ficha que escribe (sentar, cambiar o liberar mesa, deshacer, «No vino») exige «Editar».
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const [eligiendo, setEligiendo] = useState(
    (nombresMesa.length === 0 || inicio === "elegir") && !estaTerminada(reserva.estado),
  );
  const [ocupado, setOcupado] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const desplazar = useDesplazar(useAsignarConCambioLocal(fecha, mesas));

  const salaNombre = (id: string | null) => salas.find((s) => s.id === id)?.nombre ?? "Sin sala";
  const terminada = estaTerminada(reserva.estado);
  const sentada = reserva.estado === "completada";
  const puedeLiberar = sentada && nombresMesa.length > 0 && !reserva.salida_at;
  const excluidas = useMemo(() => new Set(mesasExcluidas), [mesasExcluidas]);
  const alFinal = useMemo(() => new Set(mesasAlFinal), [mesasAlFinal]);
  const nombreMesa = (id: string) => mesas.find((m) => m.id === id)?.nombre ?? "?";

  // Si no cabe en ninguna mesa de su sala, la propuesta de piezas (juntar/separar) de siempre.
  const { propuesta } = useMemo(
    () =>
      opcionesParaSentar({
        salas,
        mesas,
        ajustesDia,
        asignaciones,
        excluidas,
        alFinal,
        configOcupacion,
        reserva: { id: reserva.id, hora: reserva.hora, comensales: reserva.numero_comensales, espacioId: reserva.espacio_id },
      }),
    [salas, mesas, ajustesDia, asignaciones, excluidas, alFinal, configOcupacion, reserva],
  );

  const opciones = useMemo(() => opcionesMesasServicio({ salas, mesas, ajustesDia, turno }), [salas, mesas, ajustesDia, turno]);
  const propiasIds = useMemo(
    () => asignaciones.filter((a) => a.reserva_id === reserva.id).map((a) => a.mesa_id),
    [asignaciones, reserva.id],
  );
  const fijada = !!reserva.mesa_fijada && propiasIds.length > 0;
  /** A quien pierde su única mesa prevista se le busca la mejor libre de su sala (07/11/2026). */
  const recolocar = (desplazadas: readonly Desplazamiento[], mesasElegidas: readonly string[]) =>
    recolocarDesplazadas({ desplazadas, opciones, asignaciones, mesasElegidas, excluidas, alFinal, config: configOcupacion });

  // El selector: todas las mesas donde cabe, de todas las salas, con su estado para la franja de la reserva.
  const selector = useMemo(
    () =>
      clasificarMesasParaSentar({
        opciones,
        asignaciones,
        reserva: { id: reserva.id, hora: reserva.hora, comensales: reserva.numero_comensales, espacioId: reserva.espacio_id },
        propias: asignaciones.filter((a) => a.reserva_id === reserva.id).map((a) => a.mesa_id),
        excluidas,
        alFinal,
        config: configOcupacion,
      }),
    [opciones, asignaciones, reserva, excluidas, alFinal, configOcupacion],
  );
  const hayMesas = selector.propias.length + selector.salas.length > 0;

  const ejecutar = async (trabajo: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await trabajo();
      onCerrar();
    } catch {
      // Cada paso ya avisa de su error.
    } finally {
      setOcupado(false);
      setPendiente(null);
    }
  };

  /** Mover de sala si hace falta, asignar la mesa y sentar. Si tenía la mesa fijada, se le quita la fijación. */
  const sentarEn = (mesa: MesaOpcion, cambios?: AjusteMesa[], desplazadas?: readonly Desplazamiento[]) =>
    ejecutar(() =>
      sentarReserva(reserva, mesa, {
        desplazadas,
        quitarFijacion: fijada && !propiasIds.includes(mesa.id),
        antes: cambios?.length
          ? async () => {
              await guardarAjustes.mutateAsync(cambios);
              void qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA] });
            }
          : undefined,
      }),
    );

  /** Sentar en SU mesa prevista quitándosela antes a quien la pisa (y devolviéndosela si «Llegó» no se guarda). */
  const sentarEnPrevista = (desplazadas: readonly Desplazamiento[]) =>
    ejecutar(async () => {
      const deshacer = await desplazar(desplazadas);
      if (!(await marcarLlegada(reserva))) {
        await deshacer();
        throw new Error("llegada");
      }
    });

  const confirmarPrevista = (desplazadasAntes: readonly Desplazamiento[]) => {
    const desplazadas = recolocar(desplazadasAntes, propiasIds);
    setPendiente({
      texto: textoDesplazamiento(textoMesas(nombresMesa).replace(/^Mesas? /, ""), desplazadas, nombreMesa),
      ejecutar: () => sentarEnPrevista(desplazadas),
    });
  };

  // Desde el botón «Sentar · Mesa 7» de la fila con la prevista pisada por otra reserva: la confirmación directamente.
  useEffect(() => {
    if (inicio !== "confirmar" || terminada) return;
    const decision = decidirSentarPrevista(asignaciones, reserva, configOcupacion);
    if (decision.tipo === "confirmar") confirmarPrevista(decision.desplazadas);
    // Solo al abrir la ficha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elegir = (m: MesaParaConfirmar) => {
    if (m.propia) {
      if (terminada || m.estado.tipo === "ocupada" || m.estado.tipo === "fijada") return;
      if (m.estado.tipo === "prevista") confirmarPrevista(m.estado.desplazadas);
      else void ejecutar(() => marcarLlegada(reserva));
      return;
    }
    if (m.estado.tipo === "ocupada" || m.estado.tipo === "fijada") return;
    const desplazadas = m.estado.tipo === "prevista" ? recolocar(m.estado.desplazadas, [m.id]) : [];
    // Con su mesa fijada, cambiarla se pregunta antes (y al hacerlo se quita la fijación).
    const textos = [fijada ? AVISO_FIJADA : "", desplazadas.length > 0 ? textoDesplazamiento(m.nombre, desplazadas, nombreMesa) : ""].filter(Boolean);
    if (textos.length > 0) {
      setPendiente({
        texto: textos.join(" "),
        ejecutar: () => sentarEn(m, undefined, desplazadas),
        boton: fijada ? "Cambiar igualmente" : undefined,
      });
      return;
    }
    void sentarEn(m);
  };

  const info = infoEstado(reserva.estado);

  return (
    <div className="space-y-4 pb-2">
      <SheetHeader className="text-left">
        <SheetTitle className="flex items-center gap-2">
          <span className="truncate">{reserva.nombre || "Sin nombre"}</span>
          {info && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", info.insignia)}>{info.etiqueta}</span>}
          <InsigniaMenuDelDia reserva={reserva} />
        </SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden />{horaCorta(reserva.hora)}</span>
            <span className="flex items-center gap-1"><Users className="h-4 w-4" aria-hidden />{reserva.numero_comensales} pax</span>
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" aria-hidden />
              {salaNombre(reserva.espacio_id)} · {textoMesaConfirmada(nombresMesa, sentada)}
              {fijada && (
                <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> fijada
                </span>
              )}
            </span>
          </div>
        </SheetDescription>
      </SheetHeader>

      {telefonoLegible(reserva.telefono) && (
        <Button asChild variant="outline" className="h-11 w-full justify-start text-base tabular-nums">
          <a href={enlaceTelefono(reserva.telefono) ?? undefined}>
            <Phone className="mr-2 h-5 w-5" aria-hidden /> Llamar · {telefonoLegible(reserva.telefono)}
          </a>
        </Button>
      )}

      {reserva.notas_cliente && (
        <p className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/40">{reserva.notas_cliente}</p>
      )}

      {pendiente && puedeEditar ? (
        <ConfirmarDesplazamiento
          pendiente={pendiente}
          ocupado={ocupado}
          onCancelar={() => setPendiente(null)}
          onConfirmar={() => void pendiente.ejecutar()}
        />
      ) : (
        <>
          {!puedeEditar ? null : terminada ? (
            <div className="grid gap-2">
              {puedeLiberar && (
                <Button className="h-14 text-base" disabled={ocupado} onClick={() => ejecutar(() => liberarMesa(reserva))}>
                  <DoorOpen className="mr-2 h-5 w-5" /> Liberar {textoMesas(nombresMesa).toLowerCase()}
                </Button>
              )}
              {sentada && !reserva.salida_at && (
                <Button
                  variant="outline"
                  className="h-14 text-base"
                  disabled={ocupado}
                  onClick={() => setEligiendo((v) => !v)}
                  aria-expanded={eligiendo}
                >
                  Cambiar mesa
                </Button>
              )}
              <Button
                variant="outline"
                className="h-12 w-full"
                disabled={ocupado}
                onClick={() => ejecutar(() => deshacerLlegadaONoShow(reserva))}
              >
                <Undo2 className="mr-2 h-5 w-5" /> Deshacer «{info?.etiqueta ?? reserva.estado}»
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              {nombresMesa.length > 0 && (
                <Button
                  className="h-14 text-base"
                  disabled={ocupado}
                  onClick={() => {
                    const decision = decidirSentarPrevista(asignaciones, reserva, configOcupacion);
                    if (decision.tipo === "confirmar") confirmarPrevista(decision.desplazadas);
                    else if (decision.tipo === "elegir") setEligiendo(true);
                    else void ejecutar(() => marcarLlegada(reserva));
                  }}
                >
                  <Armchair className="mr-2 h-5 w-5" /> Sentar en {textoMesas(nombresMesa).toLowerCase()}
                </Button>
              )}
              <Button
                variant={nombresMesa.length > 0 ? "outline" : "default"}
                className="h-14 text-base"
                disabled={ocupado}
                onClick={() => setEligiendo((v) => !v)}
                aria-expanded={eligiendo}
              >
                {nombresMesa.length > 0 ? "Cambiar mesa" : "Elegir mesa"}
              </Button>
            </div>
          )}

          {puedeEditar && eligiendo && (!terminada || sentada) && (
            <div className="space-y-3">
              {propuesta && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/40">
                  <p className="text-sm">{propuesta.propuesta.texto}</p>
                  <Button
                    className="mt-2 h-12 w-full"
                    disabled={ocupado}
                    onClick={() => sentarEn(propuesta.mesa, propuesta.propuesta.cambios)}
                  >
                    Hacer y sentar en la {propuesta.mesa.nombre}
                  </Button>
                </div>
              )}
              {!hayMesas && !propuesta ? (
                <p className="text-sm text-muted-foreground">
                  No hay ninguna mesa donde quepan {reserva.numero_comensales}. Júntalas desde el plano.
                </p>
              ) : (
                <SelectorMesaMovil selector={selector} sentada={sentada} ocupado={ocupado} onElegir={elegir} fijadaPropia={fijada} />
              )}
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        {puedeEditar && !terminada && (
          <Button
            variant="outline"
            className="h-12 min-w-0 text-destructive"
            disabled={ocupado}
            onClick={() => ejecutar(() => marcarNoShow(reserva))}
          >
            <UserX className="h-4 w-4" />
            <span className="truncate">No vino</span>
          </Button>
        )}
        <Button variant="ghost" className={cn("h-12 min-w-0", (terminada || !puedeEditar) && "col-span-2")} onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
