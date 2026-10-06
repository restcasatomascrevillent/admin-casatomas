// ============================================================================
// MODO SERVICIO (Fase 4, MVP) — el plano EN VIVO durante el servicio.
// ----------------------------------------------------------------------------
// Diseño: engram sdd/plano-espacios/design. Encargo del dueño: durante el
// servicio, el personal necesita ver de un vistazo qué mesa está libre, cuál
// tiene reserva pendiente de llegar, cuál lleva retraso, cuál está ocupada y
// cuál lleva tanto rato sentada que probablemente ya se pueda liberar — y
// actuar rápido desde una tablet.
//
// POR QUÉ UN COMPONENTE NUEVO Y NO UN MODO DENTRO DE `PlanoEspacio2D.tsx`
// ----------------------------------------------------------------------------
// `PlanoEspacio2D.tsx` ya tiene 2500+ líneas (drag&drop de mesas y reservas,
// edición de plano, dnd-kit, zoom/pan...) y OTRA sesión de Claude trabaja en
// este mismo directorio. Meter el modo servicio ahí habría significado tocar
// ese fichero entero para añadir un color/estado por mesa, un refresco cada
// 30-60s y una hoja de acciones — mucho riesgo de colisión y de bloatear un
// componente que ya hace demasiado. En vez de eso, este componente REUTILIZA
// las piezas de datos y lógica pura que ya existen (mismos hooks, mismo
// `asignacionPlano.ts` para fecha/turno) y pinta su propia vista, más simple
// a propósito: una REJILLA DE TARJETAS por mesa (no el canvas 2D con
// posiciones x/y). Es una simplificación deliberada del MVP: no hace falta
// el layout espacial exacto para decidir "esta mesa hay que liberarla", y así
// se evita duplicar los ~800 líneas de canvas/drag de `PlanoEspacio2D`. Si
// más adelante se quiere el plano real (con pos_x/pos_y) en modo servicio,
// se puede añadir sin tocar este fichero, leyendo `mesa.pos_x/pos_y/rotacion`
// (ya expuestos por `useMesas`) para posicionar estas mismas tarjetas.
//
// DATOS: `useMesas` (posiciones/capacidad, no usadas en la rejilla salvo
// capacidad), `useAsignacionesMesa` (mesa ↔ reserva del turno) y
// `useReservasServicioDia` (reserva completa con `llegada_at`/`salida_at`,
// que las otras consultas no traen). El ESTADO de cada mesa lo calcula
// `estadoMesaServicio` (puro, testeado, `src/lib/reservas/servicioSala.ts`).
//
// ACCIONES: "Ha llegado" (antes «Sentar») reutiliza
// `useAccionesServicioReserva.marcarLlegada` tal cual (no hay nada de
// servicio-específico ahí: es el mismo cambio de estado que «Ha llegado» del
// kanban, y por eso se llama igual). Qué botones hay y cuáles se pueden pulsar lo
// decide `accionesDisponibles(reserva, { vista: "hoy", canEdit })`, como en el
// kanban: sin permiso de edición salen deshabilitados con el motivo a la vista.
// "Liberar"/"Deshacer" son
// nuevas (`useAccionesModoServicio`, updates condicionados por concurrencia).
// "Mover a otra mesa" reutiliza el RPC atómico `useAsignarMesasReserva`
// (valida el solape en servidor); aquí se usa en su forma más simple —
// sustituir TODAS las mesas de la reserva por una sola— que cubre el caso de
// servicio ("está en la 4, pásala a la 7"); repartos complejos (juntar varias
// mesas) siguen siendo cosa del plano completo.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  Clock,
  Users,
  Phone,
  Utensils,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  LogOut,
  MoveRight,
  CalendarIcon,
  SquarePen,
} from "lucide-react";
import { CONFIG_ESTADO_MESA, textoMinutosMesa } from "./estadosMesa";
import { cn } from "@/lib/utils";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import { useAsignacionesMesa, useAsignarMesasReserva } from "@/hooks/useAsignacionesMesa";
import { useReservasServicioDia } from "@/hooks/useReservasServicioDia";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAccionesModoServicio } from "@/hooks/useAccionesModoServicio";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { ConMotivo } from "@/components/reservas/ConMotivo";
import { accionesDisponibles, motivoSiNoSePuede } from "@/lib/reservas/accionesReserva";
import {
  configServicioSalaDesde,
  estadoMesaServicio,
  haLlegado,
  type EstadoMesaServicio,
  type ReservaMesaServicio,
} from "@/lib/reservas/servicioSala";
import { turnoDeHora, TURNOS, type Turno } from "@/lib/reservas/asignacionMesas";
import { dateAFechaISO, esFechaISO, fechaISOaDate, hoyLocal } from "../asignacionPlano";
import { esErrorEsquemaPendiente } from "@/lib/reservas/propuestaCliente";

interface ModoServicioPlanoProps {
  espacioId: string;
  espacioNombre: string;
  fecha?: string;
  onBack?: () => void;
}

/** Refresco de "ahora": cada 45s alcanza para que los chips de minutos no se queden atrás. */
const INTERVALO_REFRESCO_MS = 45_000;

// Nombre, icono y color de cada estado de mesa, y el chip de minutos: en `./estadosMesa.ts`
// (06/10/2026), compartidos con la vista «Plano» de «Hoy».
const CONFIG_ESTADO = CONFIG_ESTADO_MESA;
const textoMinutos = textoMinutosMesa;

export function ModoServicioPlano({ espacioId, espacioNombre, fecha, onBack }: ModoServicioPlanoProps) {
  const [fechaSel, setFechaSel] = useState<string>(() => (esFechaISO(fecha) ? (fecha as string) : hoyLocal()));
  const [turnoSel, setTurnoSel] = useState<Turno>(() => turnoDeHora(new Date().toLocaleTimeString("es-ES", { hour12: false })));
  const [ahora, setAhora] = useState<Date>(() => new Date());
  const [mesaSel, setMesaSel] = useState<Mesa | null>(null);
  const [moviendoA, setMoviendoA] = useState<string>("");

  useEffect(() => {
    if (esFechaISO(fecha)) setFechaSel(fecha as string);
  }, [fecha]);

  // "ahora" se actualiza sola: es lo que hace que los chips de minutos y los
  // cambios de estado (reservada -> retrasada, ocupada -> por_liberar) se
  // pinten solos sin que nadie toque nada.
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), INTERVALO_REFRESCO_MS);
    return () => window.clearInterval(id);
  }, []);

  const mesasQuery = useMesas(espacioId);
  // `REFRESCO_PERIODICO`: la tablet del modo servicio se queda a la vista toda la noche y nunca
  // dispara el refresco por foco; sin realtime, las mesas que dé otro dispositivo llegan así.
  const asignacionesQuery = useAsignacionesMesa(fechaSel, espacioId, turnoSel, REFRESCO_PERIODICO);
  const reservasQuery = useReservasServicioDia(fechaSel, espacioId);
  const configQuery = useConfiguracionReservas();
  const { marcarLlegada, estaEnCurso: estaEnCursoLlegada } = useAccionesServicioReserva();
  const { liberarMesa, deshacerLiberarMesa, estaEnCurso: estaEnCursoServicio } = useAccionesModoServicio();
  const asignarMesas = useAsignarMesasReserva();
  // Editar la reserva de una mesa (2026-09-30): p. ej. «en realidad son 6, no 4».
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  const config = useMemo(() => configServicioSalaDesde(configQuery.data), [configQuery.data]);

  const asignaciones = useMemo(
    () => (asignacionesQuery.data ?? []).map((a) => ({ mesa_id: a.mesa_id, reserva_id: a.reserva_id })),
    [asignacionesQuery.data],
  );
  const reservasData = reservasQuery.data;
  const mesasData = mesasQuery.data;

  const filasMesas = useMemo(() => {
    const mesas = mesasData ?? [];
    const reservas: ReservaMesaServicio[] = reservasData ?? [];
    return mesas.map((mesa) => ({
      mesa,
      resultado: estadoMesaServicio(mesa.id, asignaciones, reservas, turnoSel, ahora, config),
    }));
  }, [mesasData, reservasData, asignaciones, turnoSel, ahora, config]);

  const mesas = mesasData ?? [];

  const resumen = useMemo(() => {
    const acc: Record<EstadoMesaServicio, number> = { libre: 0, reservada: 0, retrasada: 0, ocupada: 0, por_liberar: 0 };
    for (const fila of filasMesas) acc[fila.resultado.estado]++;
    return acc;
  }, [filasMesas]);

  const mesaActiva = mesaSel ? filasMesas.find((f) => f.mesa.id === mesaSel.id) ?? null : null;
  // Qué se puede hacer con la reserva de la mesa abierta (vista «Hoy»: servicio).
  const accionesReserva = mesaActiva?.resultado.reserva
    ? accionesDisponibles(mesaActiva.resultado.reserva, { vista: "hoy", canEdit: puedeEditar })
    : null;

  // Mesas candidatas para "Mover a otra mesa": del mismo espacio, distintas de
  // la actual y libres en este turno (que no es lo mismo que "activa": una
  // mesa desactivada no debería ofrecerse, pero useMesas ya solo trae activas).
  const mesasLibresParaMover = useMemo(() => {
    if (!mesaActiva) return [];
    return filasMesas.filter((f) => f.mesa.id !== mesaActiva.mesa.id && f.resultado.estado === "libre");
  }, [filasMesas, mesaActiva]);

  const cambiarDia = (delta: number) => {
    const d = fechaISOaDate(fechaSel);
    d.setDate(d.getDate() + delta);
    setFechaSel(dateAFechaISO(d));
  };

  const cerrarSheet = () => {
    setMesaSel(null);
    setMoviendoA("");
  };

  /** Cierra la hoja y abre el editor: dos capas modales encima una de otra serían un lío. */
  const handleEditar = () => {
    const reservaId = mesaActiva?.resultado.reserva?.id;
    if (!reservaId) return;
    cerrarSheet();
    editarReserva(reservaId);
  };

  const handleHaLlegado = async () => {
    if (!mesaActiva?.resultado.reserva) return;
    const ok = await marcarLlegada(mesaActiva.resultado.reserva);
    if (ok) cerrarSheet();
  };

  const handleLiberar = async () => {
    if (!mesaActiva?.resultado.reserva) return;
    await liberarMesa(mesaActiva.resultado.reserva);
    cerrarSheet();
  };

  const handleDeshacerLiberar = async () => {
    if (!mesaActiva?.resultado.reserva) return;
    await deshacerLiberarMesa(mesaActiva.resultado.reserva);
    cerrarSheet();
  };

  const handleMover = async () => {
    if (!mesaActiva?.resultado.reserva || !moviendoA) return;
    try {
      // El toast (éxito o error) lo pone el propio hook (`mensajeErrorAsignacion`);
      // aquí solo hace falta no dejar la promesa sin capturar si el RPC falla
      // (mesa ocupada entre que se abrió la hoja y se pulsó "Mover").
      await asignarMesas.mutateAsync({ reserva_id: mesaActiva.resultado.reserva.id, mesa_ids: [moviendoA] });
      cerrarSheet();
    } catch {
      // Error ya avisado por el hook; se deja la hoja abierta para reintentar
      // con otra mesa en vez de cerrarla sobre un cambio que no se guardó.
    }
  };

  const cargando = mesasQuery.isLoading || asignacionesQuery.isLoading || reservasQuery.isLoading;

  // `useReservasServicioDia` deja subir el error si `llegada_at`/`salida_at`
  // no existen todavía (migraciones 20260923180000 / 20260926150000 sin
  // aplicar): sin esas dos columnas no se puede calcular ningún estado, así
  // que se avisa en vez de enseñar un plano con todas las mesas "libre" (dato
  // falso: puede haber gente sentada).
  const migracionPendiente = reservasQuery.isError && esErrorEsquemaPendiente(reservasQuery.error as any);

  if (migracionPendiente) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="h-11 w-11" aria-label="Volver">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h2 className="text-lg font-semibold">{espacioNombre} · Servicio</h2>
        </div>
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          Falta aplicar la migración de modo servicio en la base de datos. El resto del panel funciona con normalidad;
          esta vista estará disponible en cuanto se aplique.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="h-11 w-11" aria-label="Volver">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <h2 className="text-lg font-semibold">{espacioNombre} · Servicio</h2>
            <p className="text-sm text-muted-foreground">Estado de las mesas en vivo</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-1">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => cambiarDia(-1)} aria-label="Día anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-1.5 px-2 text-sm font-medium">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              {fechaSel.split("-").reverse().join("/")}
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => cambiarDia(1)} aria-label="Día siguiente">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <ToggleGroup
            type="single"
            value={turnoSel}
            onValueChange={(v) => v && setTurnoSel(v as Turno)}
            className="rounded-md border p-1"
          >
            {TURNOS.map((t) => (
              <ToggleGroupItem key={t} value={t} className="h-9 px-3 capitalize data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                {t}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Leyenda: color + icono + texto, nunca solo color (accesibilidad). */}
      <div className="flex flex-wrap gap-2" role="list" aria-label="Leyenda de estados de mesa">
        {(Object.keys(CONFIG_ESTADO) as EstadoMesaServicio[]).map((estado) => {
          const { etiqueta, Icono, badge } = CONFIG_ESTADO[estado];
          return (
            <div
              key={estado}
              role="listitem"
              className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", badge)}
            >
              <Icono className="h-3.5 w-3.5" aria-hidden="true" />
              {etiqueta}
              <span className="opacity-80">({resumen[estado]})</span>
            </div>
          );
        })}
      </div>

      <ScrollArea className="h-[calc(100vh-320px)] min-h-[320px]">
        {cargando ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pr-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 rounded-lg border bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : mesas.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Esta sala todavía no tiene mesas. Cárgalas desde el editor de plano.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pr-2">
            {filasMesas.map(({ mesa, resultado }) => {
              const { etiqueta, Icono, clases, badge } = CONFIG_ESTADO[resultado.estado];
              const chipMinutos = textoMinutos(resultado.estado, resultado.minutos);
              const enCurso = resultado.reserva
                ? estaEnCursoLlegada(resultado.reserva.id) || estaEnCursoServicio(resultado.reserva.id)
                : false;
              return (
                <button
                  key={mesa.id}
                  type="button"
                  onClick={() => setMesaSel(mesa)}
                  disabled={enCurso}
                  className={cn(
                    "flex min-h-[112px] flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    clases,
                  )}
                  aria-label={`Mesa ${mesa.nombre}, ${etiqueta}${resultado.reserva ? `, reserva de ${resultado.reserva.nombre ?? "cliente"}` : ""}`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-semibold">{mesa.nombre}</span>
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", badge)}>
                      <Icono className="h-3 w-3" aria-hidden="true" />
                      {etiqueta}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> {mesa.capacidad}
                  </span>
                  {resultado.reserva && (
                    <span className="text-sm font-medium truncate w-full">{resultado.reserva.nombre || "Sin nombre"}</span>
                  )}
                  {chipMinutos && <span className="text-xs font-medium">{chipMinutos}</span>}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <Sheet open={!!mesaSel} onOpenChange={(open) => !open && cerrarSheet()}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {mesaActiva && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  Mesa {mesaActiva.mesa.nombre}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      CONFIG_ESTADO[mesaActiva.resultado.estado].badge,
                    )}
                  >
                    <IconoEstado estado={mesaActiva.resultado.estado} />
                    {CONFIG_ESTADO[mesaActiva.resultado.estado].etiqueta}
                  </span>
                </SheetTitle>
                <SheetDescription>
                  Capacidad {mesaActiva.mesa.capacidad} · Turno {turnoSel}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-3 py-4">
                {mesaActiva.resultado.reserva ? (
                  <div className="space-y-1.5 rounded-lg border p-3">
                    <p className="font-medium">{mesaActiva.resultado.reserva.nombre || "Sin nombre"}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" /> {mesaActiva.resultado.reserva.hora.slice(0, 5)} ·{" "}
                      <Users className="h-3.5 w-3.5" /> {mesaActiva.resultado.reserva.numero_comensales}
                    </p>
                    {mesaActiva.resultado.reserva.telefono && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" /> {mesaActiva.resultado.reserva.telefono}
                      </p>
                    )}
                    {textoMinutos(mesaActiva.resultado.estado, mesaActiva.resultado.minutos) && (
                      <p className="text-sm font-medium">
                        {textoMinutos(mesaActiva.resultado.estado, mesaActiva.resultado.minutos)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin reserva asignada este turno.</p>
                )}

                {/* Editar datos, día, hora, comensales, sala o notas de esta
                    reserva. Sin mirar el estado: solo el permiso lo apaga. El
                    botón deshabilitado no recibe el ratón: el motivo se ve en
                    el envoltorio. */}
                {accionesReserva?.editar.visible && (
                  <ConMotivo className="flex" motivo={motivoSiNoSePuede(accionesReserva.editar)}>
                    <Button
                      className="w-full h-11"
                      variant="outline"
                      disabled={!accionesReserva.editar.habilitada}
                      title={motivoSiNoSePuede(accionesReserva.editar)}
                      onClick={handleEditar}
                    >
                      <SquarePen className="mr-2 h-4 w-4" /> Editar reserva
                    </Button>
                  </ConMotivo>
                )}

                {/* Antes «Sentar»: es el mismo cambio de estado que «Ha llegado» del kanban. */}
                {accionesReserva?.haLlegado.visible && (
                  <ConMotivo className="flex" motivo={motivoSiNoSePuede(accionesReserva.haLlegado)}>
                    <Button
                      className="w-full h-11"
                      disabled={!accionesReserva.haLlegado.habilitada}
                      onClick={handleHaLlegado}
                    >
                      <Utensils className="mr-2 h-4 w-4" /> Ha llegado
                    </Button>
                  </ConMotivo>
                )}

                {mesaActiva.resultado.reserva &&
                  haLlegado(mesaActiva.resultado.reserva.estado) &&
                  !mesaActiva.resultado.reserva.salida_at && (
                    <>
                      <Button
                        className="w-full h-11"
                        variant={mesaActiva.resultado.estado === "por_liberar" ? "default" : "outline"}
                        onClick={handleLiberar}
                      >
                        <LogOut className="mr-2 h-4 w-4" /> Liberar mesa
                      </Button>

                      <div className="flex items-center gap-2">
                        <Select value={moviendoA} onValueChange={setMoviendoA}>
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="Mover a otra mesa..." />
                          </SelectTrigger>
                          <SelectContent>
                            {mesasLibresParaMover.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">No hay mesas libres en este turno</div>
                            ) : (
                              mesasLibresParaMover.map((f) => (
                                <SelectItem key={f.mesa.id} value={f.mesa.id}>
                                  {f.mesa.nombre} (cap. {f.mesa.capacidad})
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Button className="h-11 shrink-0" variant="outline" disabled={!moviendoA} onClick={handleMover}>
                          <MoveRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}

                {mesaActiva.resultado.reserva &&
                  haLlegado(mesaActiva.resultado.reserva.estado) &&
                  mesaActiva.resultado.reserva.salida_at && (
                    <Button className="w-full h-11" variant="outline" onClick={handleDeshacerLiberar}>
                      <RotateCcw className="mr-2 h-4 w-4" /> Deshacer liberar
                    </Button>
                  )}
              </div>

              <SheetFooter>
                <Button variant="ghost" className="h-11" onClick={cerrarSheet}>
                  Cerrar
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Estimaciones configurables en Configuración de reservas → «Tiempo de ocupación de mesa». Comida: {config.estanciaComidaMinutos} min ·
        cena: {config.estanciaCenaMinutos} min · margen de retraso: {config.retrasoGraciaMinutos} min.
      </p>

      {/* Editor de la reserva elegida en la hoja de una mesa. `null` hasta que se pide. */}
      {dialogoEdicion}
    </div>
  );
}

/** Icono suelto para reutilizar dentro del título del Sheet sin repetir el switch. */
function IconoEstado({ estado }: { estado: EstadoMesaServicio }) {
  const { Icono } = CONFIG_ESTADO[estado];
  return <Icono className="h-3 w-3" aria-hidden="true" />;
}
