// ============================================================================
// «HOY» EN MÓVIL (< 768 px) — para el camarero que va sentando gente
// ----------------------------------------------------------------------------
// Lista de las reservas de hoy agrupadas por sala («Sin mesa» arriba). Tocar
// una fila abre un panel inferior con acciones grandes:
//   · «Sentar en mesa X»  → la MISMA acción «Ha llegado» del panel
//     (`useAccionesServicioReserva.marcarLlegada`, con su aviso y «Deshacer»).
//   · «Cambiar mesa» / «Elegir mesa» → mesas libres donde caben (de su sala
//     primero); al elegir: mueve de sala si hace falta, asigna (RPC
//     `asignar_mesas_reserva`) y sienta. Si en su sala no cabe en ninguna,
//     enseña la propuesta de piezas (`piezasMesa.ts`).
//   · «No vino».
// Sin scroll de página: la lista ocupa el alto disponible y hace scroll dentro.
// Agrupado y orden: `src/lib/reservas/hoyMovil.ts` (con tests).
// ============================================================================

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Armchair, ChevronRight, Clock, MapPin, Undo2, Users, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import { useAsignacionesMesa, useAsignarMesasReserva, type AsignacionConDetalles } from "@/hooks/useAsignacionesMesa";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import {
  CLAVE_AJUSTES_MESA,
  useAjustesMesaDia,
  useGuardarAjustesMesa,
  type TurnoServicio,
} from "@/hooks/useAjustesMesaServicio";
import { configAsignacionDesde } from "@/lib/reservas/ventanaAsignacion";
import { configServicioSalaDesde, type ReservaServicio } from "@/lib/reservas/servicioSala";
import { conflictoDeMesa } from "@/lib/reservas/ocupacionMesa";
import { turnoDeHora } from "@/lib/reservas/asignacionMesas";
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";
import type { FiltroTurnoHoy } from "@/lib/reservas/vistaHoy";
import {
  agruparHoyMovil,
  estaTerminada,
  mesasQueCaben,
  textoMesas,
  type MesaOpcion,
} from "@/lib/reservas/hoyMovil";
import {
  estadoServicio,
  geometriaServicio,
  mesaPiezasDesde,
  proponerParaSentar,
  type AjusteMesa,
  type MesaPiezas,
  type Propuesta,
  type ReservaEnMesas,
} from "@/lib/reservas/piezasMesa";
import { cn } from "@/lib/utils";

type ReservaMovil = ReservaServicio;

const horaCorta = (h: string) => (h ?? "").slice(0, 5);

function infoEstado(estado: string) {
  return ESTADOS_RESERVA[estado as EstadoReserva] ?? null;
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
  const [abiertaId, setAbiertaId] = useState<string | null>(null);

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

  const abierta = (reservas ?? []).find((r) => r.id === abiertaId) ?? null;

  return (
    <div ref={setRaiz} className="flex min-h-0 flex-col" style={alto ? { height: alto } : undefined}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border bg-card" data-testid="hoy-movil-lista">
        {reservas === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando reservas…</p>
        ) : grupos.length === 0 ? (
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
                {g.filas.map(({ reserva, mesas: nombresMesa, terminada }) => {
                  const info = infoEstado(reserva.estado);
                  return (
                    <li key={reserva.id}>
                      <button
                        type="button"
                        onClick={() => setAbiertaId(reserva.id)}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-muted/60",
                          terminada && "opacity-50",
                        )}
                      >
                        <span className="w-12 shrink-0 text-base font-semibold tabular-nums">{horaCorta(reserva.hora)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{reserva.nombre || "Sin nombre"}</span>
                          <span className={cn("block text-sm", nombresMesa.length ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
                            {textoMesas(nombresMesa)}
                            {g.clave === "sin-mesa" && reserva.espacio_id && ` · ${salaPorId.get(reserva.espacio_id) ?? ""}`}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums">
                          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                          {reserva.numero_comensales}
                        </span>
                        {info && (
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", info.insignia)}>
                            {info.etiqueta}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
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
  ajustesDia: Array<AjusteMesa & { espacioId: string; turno: string }>;
  mesasExcluidas: readonly string[];
  configOcupacion: ReturnType<typeof configServicioSalaDesde>;
  nombresMesa: string[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { marcarLlegada, marcarNoShow, deshacerLlegadaONoShow, moverEspacio } = useAccionesServicioReserva();
  const asignar = useAsignarMesasReserva();
  const turno: TurnoServicio = turnoDeHora(reserva.hora);
  const guardarAjustes = useGuardarAjustesMesa(reserva.espacio_id ?? "", fecha, turno);
  const [eligiendo, setEligiendo] = useState(nombresMesa.length === 0);
  const [ocupado, setOcupado] = useState(false);

  const salaNombre = (id: string | null) => salas.find((s) => s.id === id)?.nombre ?? "Sin sala";
  const terminada = estaTerminada(reserva.estado);
  const excluidas = useMemo(() => new Set(mesasExcluidas), [mesasExcluidas]);

  // Mesas de cada sala tal y como están en ESTE servicio (piezas, picos, plazas de la Terraza).
  const { opciones, piezasSala, estadoSala } = useMemo(() => {
    const opciones: MesaOpcion[] = [];
    let piezasSala: MesaPiezas[] = [];
    let estadoSala = estadoServicio([], []);
    for (const sala of salas) {
      const deSala = mesas.filter((m) => m.espacio_id === sala.id);
      const piezas = deSala.map(mesaPiezasDesde).filter((m): m is MesaPiezas => m !== null);
      const estado = estadoServicio(
        piezas,
        ajustesDia.filter((a) => a.espacioId === sala.id && a.turno === turno),
      );
      if (sala.id === reserva.espacio_id) {
        piezasSala = piezas;
        estadoSala = estado;
      }
      for (const m of deSala) {
        const e = estado.get(m.id);
        if (e && e.piezas <= 0) continue;
        const g = geometriaServicio(m, e);
        opciones.push({ id: m.id, nombre: m.nombre, espacioId: sala.id, salaNombre: sala.nombre, plazas: g?.capacidad ?? m.capacidad });
      }
    }
    return { opciones, piezasSala, estadoSala };
  }, [salas, mesas, ajustesDia, turno, reserva.espacio_id]);

  const libre = (mesaId: string) =>
    !excluidas.has(mesaId) && !conflictoDeMesa(asignaciones, mesaId, reserva, configOcupacion);
  const caben = mesasQueCaben(opciones, reserva.numero_comensales, reserva.espacio_id, libre);
  const cabeEnSuSala = caben.some((m) => m.espacioId === reserva.espacio_id);

  // Si en su sala no cabe en ninguna mesa libre: la propuesta de piezas de la primera que la admita.
  const propuesta = useMemo((): { mesa: MesaOpcion; propuesta: Propuesta } | null => {
    if (cabeEnSuSala || !reserva.espacio_id) return null;
    const reservasSala: ReservaEnMesas[] = [];
    const porReserva = new Map<string, ReservaEnMesas>();
    for (const a of asignaciones) {
      if (a.reserva_id === reserva.id || turnoDeHora(a.reservas?.hora ?? "") !== turno) continue;
      if (!piezasSala.some((m) => m.id === a.mesa_id)) continue;
      const r = porReserva.get(a.reserva_id) ?? { reservaId: a.reserva_id, mesaIds: [], comensales: a.reservas?.numero_comensales ?? 0 };
      r.mesaIds.push(a.mesa_id);
      porReserva.set(a.reserva_id, r);
    }
    reservasSala.push(...porReserva.values());
    for (const m of piezasSala) {
      if (!libre(m.id)) continue;
      const r = proponerParaSentar({
        mesas: piezasSala,
        estado: estadoSala,
        reservas: reservasSala,
        mesaId: m.id,
        comensales: reserva.numero_comensales,
      });
      const opcion = opciones.find((o) => o.id === m.id);
      if (r.propuestas[0] && opcion) return { mesa: opcion, propuesta: r.propuestas[0] };
    }
    return null;
    // `libre` depende de lo mismo que el resto de dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabeEnSuSala, piezasSala, estadoSala, asignaciones, reserva, turno, opciones]);

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
    ejecutar(async () => {
      let actual = reserva;
      if (mesa.espacioId !== reserva.espacio_id) {
        const ok = await moverEspacio(reserva, mesa.espacioId, mesa.salaNombre);
        if (!ok) throw new Error("mover");
        actual = { ...reserva, espacio_id: mesa.espacioId };
      }
      if (cambios?.length) {
        await guardarAjustes.mutateAsync(cambios);
        void qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA] });
      }
      await asignar.mutateAsync({ reserva_id: reserva.id, mesa_ids: [mesa.id], silencioso: true });
      toast.success(`${reserva.nombre ?? "Reserva"} → mesa ${mesa.nombre}`);
      if (!terminada) await marcarLlegada(actual);
    });

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

      {reserva.notas_cliente && (
        <p className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/40">{reserva.notas_cliente}</p>
      )}

      {terminada ? (
        <Button
          variant="outline"
          className="h-12 w-full text-base"
          disabled={ocupado}
          onClick={() => ejecutar(() => deshacerLlegadaONoShow(reserva))}
        >
          <Undo2 className="mr-2 h-5 w-5" /> Deshacer «{info?.etiqueta ?? reserva.estado}»
        </Button>
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

      {eligiendo && !terminada && (
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
            className="h-12 text-destructive"
            disabled={ocupado}
            onClick={() => ejecutar(() => marcarNoShow(reserva))}
          >
            <UserX className="mr-2 h-4 w-4" /> No vino
          </Button>
        )}
        <Button variant="ghost" className={cn("h-12", terminada && "col-span-2")} onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
