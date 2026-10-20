// ============================================================================
// «HOY» EN MÓVIL (< 768 px) — para el camarero que va sentando gente
// ----------------------------------------------------------------------------
// Durante el servicio el panel se usa en el MÓVIL (cada camarero el suyo).
// Dos vistas, «Reservas | Mesas»:
//   · RESERVAS: arriba «Llegan ahora» (próximos 15 min y hasta 30 min tarde) y
//     después las de hoy agrupadas por sala («Sin mesa» arriba).
//   · MESAS: cada sala en una cuadrícula de botones grandes con su estado
//     (libre, sentada, reservada a una hora). Tocar una libre: sentar sin
//     reserva aquí (un toque con el número de personas) o sentar una reserva.
//     Tocar una ocupada: su ficha («Cambiar mesa», «Liberar mesa»).
// La ficha de una reserva (panel inferior) tiene botones grandes:
//   · «Sentar en mesa X»  → la MISMA acción «Ha llegado» del panel.
//   · «Cambiar mesa» / «Elegir mesa» → mesas libres donde caben (su sala
//     primero); si en su sala no cabe en ninguna, la propuesta de piezas.
//   · «Liberar mesa» (sentadas): la mesa queda libre para otros; con Deshacer.
//   · «No vino».
// Al día solo: `useAlDiaMovil` (tiempo real + al volver a primer plano + 15 s).
// Sin scroll de página: la lista ocupa el alto disponible y hace scroll dentro.
// Lógica: `src/lib/reservas/hoyMovil.ts` y `sentarAhora.ts` (con tests).
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Armchair, ChevronRight, Clock, DoorOpen, MapPin, Phone, Undo2, Users, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import { useAsignacionesMesa, useAsignarMesasReserva, type AsignacionConDetalles } from "@/hooks/useAsignacionesMesa";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAccionesModoServicio } from "@/hooks/useAccionesModoServicio";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useAlDiaMovil } from "@/hooks/useAlDiaMovil";
import { useSalaCerradaServicio } from "@/hooks/useSalaCerradaServicio";
import { deshacerSinReserva, useSentarSinReserva } from "@/hooks/useSentarSinReserva";
import {
  CLAVE_AJUSTES_MESA,
  useAjustesMesaDia,
  useGuardarAjustesMesa,
  type TurnoServicio,
} from "@/hooks/useAjustesMesaServicio";
import { configAsignacionDesde } from "@/lib/reservas/ventanaAsignacion";
import { configServicioSalaDesde, type ReservaMesaServicio } from "@/lib/reservas/servicioSala";
import { turnoDeHora } from "@/lib/reservas/asignacionMesas";
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";
import type { FiltroTurnoHoy } from "@/lib/reservas/vistaHoy";
import {
  agruparHoyMovil,
  estadoMesasHoy,
  estaTerminada,
  lleganAhora,
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
import { horaActual, opcionesParaSentar, type AjusteDia } from "@/lib/reservas/sentarAhora";
import { enlaceTelefono, telefonoLegible } from "@/lib/reservas/telefono";
import { cn } from "@/lib/utils";

type ReservaMovil = ReservaMesaServicio;
type Vista = "reservas" | "mesas";

const horaCorta = (h: string) => (h ?? "").slice(0, 5);
const ESTADOS_POR_LLEGAR = new Set(["pendiente", "verificada", "confirmada"]);

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

export function VistaHoyMovil({
  reservas,
  fecha,
  busqueda,
  filtroTurno,
}: {
  reservas: ReservaMovil[] | undefined;
  fecha: string;
  busqueda: string;
  filtroTurno: FiltroTurnoHoy;
}) {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, 240);
  const [vista, setVista] = useState<Vista>("reservas");
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const [mesaLibre, setMesaLibre] = useState<MesaOpcion | null>(null);
  const minutoAhora = useMinutoAhora();
  useAlDiaMovil();

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

  // Turno que pintan las mesas: el del filtro o, con «Todo el día», el del reloj.
  const turno: TurnoServicio =
    filtroTurno === "todo"
      ? turnoDeHora(`${String(Math.floor(minutoAhora / 60)).padStart(2, "0")}:${String(minutoAhora % 60).padStart(2, "0")}`)
      : filtroTurno;
  const terraza = salas.find((s) => /terraza/i.test(s.nombre)) ?? null;
  const cierre = useSalaCerradaServicio(terraza?.id ?? null, fecha, turno);

  const mesasDe = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const a of asignacionesDia) {
      const nombre = mesaPorId.get(a.mesa_id)?.nombre ?? a.mesas?.nombre ?? "?";
      mapa.set(a.reserva_id, [...(mapa.get(a.reserva_id) ?? []), nombre]);
    }
    return (id: string) => mapa.get(id) ?? [];
  }, [asignacionesDia, mesaPorId]);

  const grupos = useMemo(
    () => agruparHoyMovil(reservas ?? [], salas, mesasDe, { busqueda, filtroTurno }),
    [reservas, salas, mesasDe, busqueda, filtroTurno],
  );
  const llegan = useMemo(
    () => lleganAhora(reservas ?? [], mesasDe, minutoAhora, { busqueda, filtroTurno }),
    [reservas, mesasDe, minutoAhora, busqueda, filtroTurno],
  );

  const abierta = (reservas ?? []).find((r) => r.id === abiertaId) ?? null;

  const fila = (reserva: ReservaMovil, nombresMesa: string[], terminada: boolean, extra?: { tarde?: boolean; sala?: boolean }) => (
    <FilaReservaMovil
      key={reserva.id}
      reserva={reserva}
      nombresMesa={nombresMesa}
      terminada={terminada}
      tarde={extra?.tarde}
      sala={extra?.sala && reserva.espacio_id ? (salaPorId.get(reserva.espacio_id) ?? "") : undefined}
      onAbrir={() => setAbiertaId(reserva.id)}
    />
  );

  return (
    <div ref={setRaiz} className="flex min-h-0 flex-col gap-2" style={alto ? { height: alto } : undefined}>
      <ToggleGroup
        type="single"
        value={vista}
        onValueChange={(v) => (v === "reservas" || v === "mesas") && setVista(v)}
        variant="outline"
        className="grid shrink-0 grid-cols-2"
        aria-label="Ver reservas o mesas"
      >
        <ToggleGroupItem value="reservas" className="h-11 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          Reservas
        </ToggleGroupItem>
        <ToggleGroupItem value="mesas" className="h-11 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          Mesas
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border bg-card" data-testid="hoy-movil-lista">
        {reservas === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando reservas…</p>
        ) : vista === "mesas" ? (
          <CuadriculaMesas
            salas={salas}
            mesas={mesas ?? []}
            asignaciones={asignacionesDia}
            ajustesDia={ajustesDia ?? []}
            reservas={reservas}
            turno={turno}
            terrazaCerradaId={cierre.cerrada ? (terraza?.id ?? null) : null}
            onLibre={setMesaLibre}
            onOcupada={setAbiertaId}
          />
        ) : (
          <>
            {llegan.length > 0 && (
              <section aria-label="Llegan ahora">
                <h3 className="sticky top-0 z-10 flex items-center justify-between border-b bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
                  <span>Llegan ahora</span>
                  <span className="text-xs font-normal tabular-nums">{llegan.length}</span>
                </h3>
                <ul className="divide-y">{llegan.map((f) => fila(f.reserva, f.mesas, false, { tarde: f.tarde, sala: true }))}</ul>
              </section>
            )}
            {grupos.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No hay reservas para este filtro.</p>
            ) : (
              grupos.map((g) => (
                <section key={g.clave} aria-label={g.titulo}>
                  <h3 className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/95 px-3 py-2 text-sm font-semibold backdrop-blur">
                    <span>{g.titulo}</span>
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {g.totalReservas} {g.totalReservas === 1 ? "reserva" : "reservas"} · {g.totalPersonas} pax
                    </span>
                  </h3>
                  <ul className="divide-y">
                    {g.filas.map((f) => fila(f.reserva, f.mesas, f.terminada, { sala: g.clave === "sin-mesa" }))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>

      <Sheet open={!!abierta} onOpenChange={(o) => !o && setAbiertaId(null)}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
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
              configOcupacion={configServicioSalaDesde(config)}
              nombresMesa={mesasDe(abierta.id)}
              onCerrar={() => setAbiertaId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!mesaLibre} onOpenChange={(o) => !o && setMesaLibre(null)}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
          {mesaLibre && (
            <PanelMesaLibre
              key={mesaLibre.id}
              mesa={mesaLibre}
              fecha={fecha}
              turno={turno}
              reservas={reservas ?? []}
              minutoAhora={minutoAhora}
              onCerrar={() => setMesaLibre(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Vista «Mesas» ───────────────────────────────────────────────────────────

/**
 * Una reserva en la lista móvil de Hoy. Toda la fila abre su panel, salvo el teléfono (15/10/2026, petición del
 * dueño: «en la vista móvil de Hoy hay que añadir el teléfono»), que es un enlace `tel:` para llamar con un toque.
 * Un `<a>` no puede ir dentro de un `<button>`: el botón va por debajo, cubriendo la fila (`absolute inset-0`), y el
 * contenido por encima sin recibir toques (`pointer-events-none`), salvo el enlace del teléfono.
 */
export function FilaReservaMovil({
  reserva,
  nombresMesa,
  terminada,
  tarde,
  sala,
  onAbrir,
}: {
  reserva: ReservaMovil;
  nombresMesa: string[];
  terminada: boolean;
  tarde?: boolean;
  /** Nombre de la sala, si hay que enseñarlo junto a las mesas. */
  sala?: string;
  onAbrir: () => void;
}) {
  const info = infoEstado(reserva.estado);
  const telefono = telefonoLegible(reserva.telefono);
  const tel = enlaceTelefono(reserva.telefono);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onAbrir}
        aria-label={`${horaCorta(reserva.hora)} ${reserva.nombre || "Sin nombre"}, ${reserva.numero_comensales} personas, ${textoMesas(nombresMesa)}`}
        className="absolute inset-0 h-full w-full active:bg-muted/60"
      />
      <div
        className={cn(
          "pointer-events-none relative flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left",
          terminada && "opacity-50",
        )}
      >
        <span className="w-12 shrink-0 text-base font-semibold tabular-nums">{horaCorta(reserva.hora)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{reserva.nombre || "Sin nombre"}</span>
          {/* Mesa/sala, comensales y estado en su propia línea: los cinco en la fila de arriba dejaban el nombre con ~110px y lo truncaban enseguida («Carlos Ruiz…»). */}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("text-sm", nombresMesa.length ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
              {textoMesas(nombresMesa)}
              {sala !== undefined && ` · ${sala}`}
            </span>
            <span className="flex items-center gap-1 text-sm tabular-nums">
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
              {reserva.numero_comensales}
            </span>
            {tarde ? (
              <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Tarde</span>
            ) : (
              info && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", info.insignia)}>{info.etiqueta}</span>
            )}
          </span>
          {telefono && tel && (
            <a
              href={tel}
              aria-label={`Llamar a ${reserva.nombre || "la reserva"}: ${telefono}`}
              className="pointer-events-auto -my-1 inline-flex min-h-11 items-center gap-1.5 pr-3 text-sm font-medium tabular-nums text-primary underline-offset-2 active:underline"
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden />
              {telefono}
            </a>
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    </li>
  );
}

function CuadriculaMesas({
  salas,
  mesas,
  asignaciones,
  ajustesDia,
  reservas,
  turno,
  terrazaCerradaId,
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
  onLibre: (m: MesaOpcion) => void;
  onOcupada: (reservaId: string) => void;
}) {
  const estados = useMemo(() => estadoMesasHoy(asignaciones, reservas, turno, turnoDeHora), [asignaciones, reservas, turno]);

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
          const cerrada = sala.id === terrazaCerradaId;
          const libres = casillas.filter((c) => !estados.has(c.opcion.id)).length;
          return (
            <section key={sala.id} aria-label={sala.nombre}>
              <h3 className="mb-1 flex items-center justify-between px-1 text-sm font-semibold">
                <span>{sala.nombre}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {cerrada ? "Cerrada en este servicio" : `${libres} libres de ${casillas.length}`}
                </span>
              </h3>
              {!cerrada && (
                <div className="grid grid-cols-3 gap-2">
                  {casillas.map(({ opcion, junta }) => (
                    <CasillaMesa
                      key={opcion.id}
                      opcion={opcion}
                      junta={junta}
                      estado={estados.get(opcion.id) ?? { tipo: "libre" }}
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
  onLibre,
  onOcupada,
}: {
  opcion: MesaOpcion;
  junta: string[];
  estado: EstadoMesaHoy;
  onLibre: (m: MesaOpcion) => void;
  onOcupada: (reservaId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => (estado.tipo === "libre" ? onLibre(opcion) : onOcupada(estado.reservaId))}
      className={cn(
        "flex min-h-20 flex-col items-start justify-between rounded-lg border-2 p-2 text-left active:scale-[0.98]",
        estado.tipo === "libre" && "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
        estado.tipo === "sentada" && "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
        estado.tipo === "reservada" && "border-sky-500 bg-sky-50 dark:bg-sky-950/40",
      )}
      aria-label={`Mesa ${opcion.nombre}, ${opcion.plazas} plazas, ${estado.tipo === "libre" ? "libre" : estado.tipo === "sentada" ? `sentada: ${estado.nombre}` : `reservada a las ${horaCorta(estado.hora)}`}`}
    >
      <span className="flex w-full items-baseline justify-between gap-1">
        <span className="text-lg font-bold leading-none">{opcion.nombre}</span>
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
      {junta.length > 0 && <span className="text-[11px] text-muted-foreground">+ {junta.join(", ")}</span>}
    </button>
  );
}

/** Mover de sala si hace falta, dar la mesa y (si no había llegado) sentar. */
function useSentarReservaEnMesa() {
  const { marcarLlegada, moverEspacio } = useAccionesServicioReserva();
  const asignar = useAsignarMesasReserva();
  return async (reserva: ReservaMovil, mesa: MesaOpcion, antes?: () => Promise<void>) => {
    let actual = reserva;
    if (mesa.espacioId !== reserva.espacio_id) {
      const ok = await moverEspacio(reserva, mesa.espacioId, mesa.salaNombre);
      if (!ok) throw new Error("mover");
      actual = { ...reserva, espacio_id: mesa.espacioId };
    }
    if (antes) await antes();
    await asignar.mutateAsync({ reserva_id: reserva.id, mesa_ids: [mesa.id], silencioso: true });
    toast.success(`${reserva.nombre ?? "Reserva"} → mesa ${mesa.nombre}`);
    if (!estaTerminada(reserva.estado)) await marcarLlegada(actual);
  };
}

const PERSONAS = [1, 2, 3, 4, 5, 6, 7, 8];

function PanelMesaLibre({
  mesa,
  fecha,
  turno,
  reservas,
  minutoAhora,
  onCerrar,
}: {
  mesa: MesaOpcion;
  fecha: string;
  turno: TurnoServicio;
  reservas: ReservaMovil[];
  minutoAhora: number;
  onCerrar: () => void;
}) {
  const sentarSinReserva = useSentarSinReserva();
  const sentarReserva = useSentarReservaEnMesa();
  const [ocupado, setOcupado] = useState(false);

  // Las que aún no han llegado en este turno y caben, la más cercana a ahora primero.
  const candidatas = useMemo(() => {
    const m = (h: string) => parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3, 5), 10);
    return reservas
      .filter(
        (r) => ESTADOS_POR_LLEGAR.has(r.estado) && turnoDeHora(r.hora) === turno && r.numero_comensales <= mesa.plazas,
      )
      .sort((a, b) => Math.abs(m(a.hora) - minutoAhora) - Math.abs(m(b.hora) - minutoAhora));
  }, [reservas, turno, mesa.plazas, minutoAhora]);

  const ejecutar = async (trabajo: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await trabajo();
      onCerrar();
    } catch (e) {
      if (e instanceof Error && e.message !== "mover") toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const sinReserva = (personas: number) =>
    ejecutar(async () => {
      const r = await sentarSinReserva.mutateAsync({ fecha, hora: horaActual(), personas, mesa });
      const deshacer = {
        label: "Deshacer",
        onClick: async () => {
          if (await deshacerSinReserva(r.id)) toast.success("Deshecho");
          else toast.error("No se ha podido deshacer");
        },
      };
      if (r.errorMesa) toast.warning(`${r.nombre} sentado sin mesa: ${r.errorMesa}`, { action: deshacer });
      else toast.success(`${r.nombre} → mesa ${mesa.nombre}`, { action: deshacer });
    });

  return (
    <div className="space-y-4 pb-2">
      <SheetHeader className="text-left">
        <SheetTitle>
          Mesa {mesa.nombre} · {mesa.salaNombre}
        </SheetTitle>
        <SheetDescription>Libre · {mesa.plazas} plazas</SheetDescription>
      </SheetHeader>

      <div className="space-y-2">
        <p className="text-sm font-medium">Sentar sin reserva aquí: ¿cuántos son?</p>
        <div className="grid grid-cols-4 gap-2">
          {PERSONAS.map((n) => (
            <Button
              key={n}
              variant="outline"
              className="h-14 text-lg font-semibold"
              disabled={ocupado || n > mesa.plazas}
              onClick={() => void sinReserva(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>

      {candidatas.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Sentar una reserva</p>
          <ul className="max-h-60 space-y-2 overflow-y-auto">
            {candidatas.map((r) => (
              <li key={r.id}>
                <Button
                  variant="outline"
                  className="h-12 w-full justify-between"
                  disabled={ocupado}
                  onClick={() => void ejecutar(() => sentarReserva(r, mesa))}
                >
                  <span className="truncate">
                    <span className="font-semibold tabular-nums">{horaCorta(r.hora)}</span> {r.nombre || "Sin nombre"}
                  </span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <Users className="h-4 w-4" aria-hidden />
                    {r.numero_comensales}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="ghost" className="h-12 w-full" onClick={onCerrar}>
        Cerrar
      </Button>
    </div>
  );
}

function PanelReservaMovil({
  reserva,
  fecha,
  salas,
  mesas,
  asignaciones,
  ajustesDia,
  mesasExcluidas,
  configOcupacion,
  nombresMesa,
  onCerrar,
}: {
  reserva: ReservaMovil;
  fecha: string;
  salas: Array<{ id: string; nombre: string }>;
  mesas: Mesa[];
  asignaciones: AsignacionConDetalles[];
  ajustesDia: AjusteDia[];
  mesasExcluidas: readonly string[];
  configOcupacion: ReturnType<typeof configServicioSalaDesde>;
  nombresMesa: string[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { marcarLlegada, marcarNoShow, deshacerLlegadaONoShow } = useAccionesServicioReserva();
  const { liberarMesa } = useAccionesModoServicio();
  const sentarReserva = useSentarReservaEnMesa();
  const turno: TurnoServicio = turnoDeHora(reserva.hora);
  const guardarAjustes = useGuardarAjustesMesa(reserva.espacio_id ?? "", fecha, turno);
  const [eligiendo, setEligiendo] = useState(nombresMesa.length === 0 && !estaTerminada(reserva.estado));
  const [ocupado, setOcupado] = useState(false);

  const salaNombre = (id: string | null) => salas.find((s) => s.id === id)?.nombre ?? "Sin sala";
  const terminada = estaTerminada(reserva.estado);
  const sentada = reserva.estado === "completada";
  const puedeLiberar = sentada && nombresMesa.length > 0 && !reserva.salida_at;
  const excluidas = useMemo(() => new Set(mesasExcluidas), [mesasExcluidas]);

  // Mesas libres donde cabe (con las plazas de ESTE servicio) y, si no cabe, la propuesta de piezas.
  const { caben, propuesta } = useMemo(
    () =>
      opcionesParaSentar({
        salas,
        mesas,
        ajustesDia,
        asignaciones,
        excluidas,
        configOcupacion,
        reserva: { id: reserva.id, hora: reserva.hora, comensales: reserva.numero_comensales, espacioId: reserva.espacio_id },
      }),
    [salas, mesas, ajustesDia, asignaciones, excluidas, configOcupacion, reserva],
  );

  const ejecutar = async (trabajo: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await trabajo();
      onCerrar();
    } catch {
      // Cada paso ya avisa de su error.
    } finally {
      setOcupado(false);
    }
  };

  /** Mover de sala si hace falta, asignar la mesa y sentar. */
  const sentarEn = (mesa: MesaOpcion, cambios?: AjusteMesa[]) =>
    ejecutar(() =>
      sentarReserva(
        reserva,
        mesa,
        cambios?.length
          ? async () => {
              await guardarAjustes.mutateAsync(cambios);
              void qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA] });
            }
          : undefined,
      ),
    );

  const info = infoEstado(reserva.estado);

  return (
    <div className="space-y-4 pb-2">
      <SheetHeader className="text-left">
        <SheetTitle className="flex items-center gap-2">
          <span className="truncate">{reserva.nombre || "Sin nombre"}</span>
          {info && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", info.insignia)}>{info.etiqueta}</span>}
        </SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden />{horaCorta(reserva.hora)}</span>
            <span className="flex items-center gap-1"><Users className="h-4 w-4" aria-hidden />{reserva.numero_comensales} pax</span>
            <span className="flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden />{salaNombre(reserva.espacio_id)} · {textoMesas(nombresMesa)}</span>
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

      {terminada ? (
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
            <Button className="h-14 text-base" disabled={ocupado} onClick={() => ejecutar(() => marcarLlegada(reserva))}>
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

      {eligiendo && (!terminada || sentada) && (
        <div className="space-y-2">
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
          {caben.length === 0 && !propuesta ? (
            <p className="text-sm text-muted-foreground">
              No hay ninguna mesa libre donde quepan {reserva.numero_comensales}. Júntalas desde el plano.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {caben.map((m) => (
                <li key={m.id}>
                  <Button
                    variant="outline"
                    className="h-14 w-full flex-col gap-0"
                    disabled={ocupado}
                    onClick={() => sentarEn(m)}
                  >
                    <span className="text-base font-semibold">Mesa {m.nombre}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.plazas} plazas{m.espacioId !== reserva.espacio_id ? ` · ${m.salaNombre}` : ""}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {!terminada && (
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
        <Button variant="ghost" className={cn("h-12 min-w-0", terminada && "col-span-2")} onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
