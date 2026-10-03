import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, ChevronDown, Clock, LayoutGrid, Loader2, MapPin, SquarePen, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { ConMotivo } from "./ConMotivo";
import { cn } from "@/lib/utils";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEspaciosReserva, type EspacioReserva } from "@/hooks/useEspaciosReserva";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import {
  ErrorSinPermisoSala,
  useCambiarSalaReserva,
  useReservasPorAsignar,
  type FilaAsignacionDia,
} from "@/hooks/useReservasPorAsignar";
import { configAsignacionDesde, fechaMadrid, sumarDias } from "@/lib/reservas/ventanaAsignacion";
import { LIMITE_FILAS } from "@/lib/reservas/paginarConsulta";
import {
  agruparPorFecha,
  construirDia,
  diaPorDefecto,
  diasDelRango,
  etiquetasDia,
  resolverDiaActivo,
  reservasPorVenir,
  resumirPestanas,
} from "@/lib/reservas/asignacionPorDias";
import { PanelDia } from "./asignacion/PanelDia";
import { TiraDias } from "./asignacion/TiraDias";
import { admiteReservas, salaAdmiteReservas } from "@/lib/reservas/negocios";
import { esErrorSalaPrivadaOcupada, mensajeSalaPrivadaOcupada } from "@/lib/reservas/salaPrivada";
import {
  ETIQUETA_TURNO,
  calcularOcupacionSalas,
  horaCorta,
  recomendarUbicacion,
} from "@/lib/reservas/ocupacionSalas";
import { resolverSaltoAsignacion, type DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { TEXTO_CAMBIO_INTERNO, textoQuitarMesas } from "@/lib/reservas/asignacionMesas";

// ============================================================================
// PESTAÑA "ASIGNACIÓN" (reservas-sin-salas, Fase B)
// ----------------------------------------------------------------------------
// El cliente de Casa Tomás solo reserva una hora: la sala y la mesa se deciden
// por dentro. La pantalla se organiza en PESTAÑAS POR DÍA (2026-10-01, petición
// del dueño): una por cada día del rango de «Mostrar», cada una con la cuenta
// de reservas sin mesa de ese día. Dentro de cada día, su resumen y los turnos
// (comida, cena) agrupados por grado. La ventana de `asignacion_ventana_horas`
// ya no parte la pantalla en dos bloques: solo MARCA en la tira los días que
// caen dentro. Cualquier reserva futura se puede asignar, esté o no en ella.
//
// · Solo se pinta el día activo: con 60-100 reservas al día, tener los 14 días
//   a la vez serían más de mil filas.
// · Qué cuenta cada insignia, qué día se abre solo y cómo se conserva al cambiar
//   los filtros: src/lib/reservas/asignacionPorDias.ts (puro y testeado).
// · La sala se cambia con `useCambiarSalaReserva`, que NO manda correo al
//   cliente. Si la reserva ya tiene mesas, se pide confirmación antes: el
//   trigger `trg_reservas_sincronizar_asignaciones` las borra al cambiar de
//   sala.
// · Solo se ofrecen las salas usables (config `asignacion_espacios_excluidos`).
//   Una reserva que ya está en una sala no usable se queda donde está y se
//   señala.
// · "Mesas" abre el plano de su sala (`onAsignarMesa`, el mismo salto que la
//   lista y la pestaña Hoy).
// ============================================================================

const OPCIONES_DIAS = [7, 14, 30] as const;

/**
 * PostgREST corta cada petición a 1000 filas, pero `useReservasPorAsignar` lee el rango ENTERO por
 * lotes, así que ya no hay aviso por «llegan justo 1000». Solo se avisa si el rango pasa del tope de
 * seguridad de esa lectura (`LIMITE_FILAS`, 10.000 reservas): el hook lo dice con `truncado`.
 */
const LIMITE_FILAS_TEXTO = new Intl.NumberFormat("es-ES").format(LIMITE_FILAS);

/**
 * Dónde se recuerda el último día abierto. «Mesas» abre el plano de una sala y `Reservas` pinta
 * entonces OTRA pantalla: este panel se desmonta y, al volver, se monta de nuevo. Sin memoria
 * volvería siempre al día por defecto, y quien reparte las 60 reservas de un sábado tendría que
 * buscarlo otra vez tras cada mesa. Se guarda en la caché de consultas (la misma para toda la
 * app): dura lo que `gcTime` (5 min por defecto) y una recarga de la página la borra.
 */
const CLAVE_DIA_RECORDADO = ["asignacion-dia-recordado"] as const;

interface CambioPendiente {
  fila: FilaAsignacionDia;
  destinoId: string;
  destinoNombre: string;
}

interface PanelAsignacionProps {
  /** Salto al plano de la sala de una reserva, para darle mesa. */
  onAsignarMesa: (destino: DestinoAsignacion) => void;
}

export function PanelAsignacion({ onAsignarMesa }: PanelAsignacionProps) {
  const queryClient = useQueryClient();
  const { data: config } = useConfiguracionReservas();
  const { data: espaciosData } = useEspaciosReserva();
  const cambiarSala = useCambiarSalaReserva();
  // Editar una reserva desde su fila (2026-09-30): datos, día, hora, comensales,
  // sala y notas, sea cual sea su estado.
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  const [dias, setDias] = useState<number>(14);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [cambioPendiente, setCambioPendiente] = useState<CambioPendiente | null>(null);
  // Día de la pestaña abierta. Sin nada recordado (`null`), cuando llegan los datos se fija el de
  // por defecto (el primero con reservas sin mesa), para que no se mueva solo cuando se vayan
  // asignando mesas. Cambiar de rango o ocultar las que tienen mesa no lo toca.
  const [diaElegido, setDiaElegido] = useState<string | null>(
    () => queryClient.getQueryData<string>(CLAVE_DIA_RECORDADO) ?? null,
  );
  useEffect(() => {
    if (diaElegido) queryClient.setQueryData(CLAVE_DIA_RECORDADO, diaElegido);
  }, [diaElegido, queryClient]);

  // La ventana se desliza con el reloj: se recalcula cada minuto.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const asignacion = useMemo(() => configAsignacionDesde(config), [config]);
  const excluidas = useMemo(() => new Set(asignacion.espaciosExcluidos), [asignacion.espaciosExcluidos]);
  const espacios = useMemo(() => (espaciosData ?? []) as EspacioReserva[], [espaciosData]);

  const desde = fechaMadrid(ahora);
  // Al menos toda la ventana, aunque se elija un rango más corto.
  const hasta = sumarDias(desde, Math.max(dias, Math.ceil(asignacion.ventanaHoras / 24) + 1));
  const { data: filas, isLoading, isError, refetch, truncado } = useReservasPorAsignar(desde, hasta);

  // Una pestaña por cada día del rango. Las reservas son las vivas que aún no han empezado; la
  // insignia de cada pestaña cuenta las que NO tienen mesa y no depende de «Ocultar las que ya
  // tienen mesa» (ver `asignacionPorDias.ts`).
  // Casa Tomás es el único negocio (Touza ya no admite reservas, 2026-10-01): sin filtro de negocio,
  // y si quedan reservas de otro en datos antiguos ni se muestran ni se cuentan (`admiteReservas`).
  const diasRango = useMemo(() => diasDelRango(desde, hasta), [desde, hasta]);
  const visibles = useMemo(
    () => reservasPorVenir(filas ?? [], ahora).filter((f) => admiteReservas(f.marca)),
    [filas, ahora],
  );
  const pestanas = useMemo(
    () => resumirPestanas(visibles, { dias: diasRango, ventanaHoras: asignacion.ventanaHoras, ahora }),
    [visibles, diasRango, asignacion.ventanaHoras, ahora],
  );
  const filasPorDia = useMemo(() => agruparPorFecha(visibles), [visibles]);

  const diaActivo = resolverDiaActivo({
    dias: diasRango,
    elegido: diaElegido,
    porDefecto: diaPorDefecto(pestanas, desde),
  });
  const hayDatos = !!filas && !isError;
  useEffect(() => {
    if (hayDatos && diaElegido !== diaActivo) setDiaElegido(diaActivo);
  }, [hayDatos, diaActivo, diaElegido]);

  // Solo se calcula y se pinta el día abierto.
  const datosDia = useMemo(
    () => construirDia(filasPorDia.get(diaActivo) ?? [], { fecha: diaActivo, soloPendientes }),
    [filasPorDia, diaActivo, soloPendientes],
  );

  // Al cambiar de día con la tira pegada arriba, el día nuevo se enseña desde su principio
  // (si no, se quedaría a media altura de lo que se estaba mirando).
  const tiraRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const diaMostrado = useRef<string | null>(null);
  useEffect(() => {
    const anterior = diaMostrado.current;
    diaMostrado.current = diaActivo;
    const tira = tiraRef.current;
    const panel = panelRef.current;
    if (anterior === null || anterior === diaActivo || !tira || !panel || typeof window.scrollTo !== "function") return;
    const pegadaA = parseFloat(window.getComputedStyle(tira).top) || 0;
    const limite = pegadaA + tira.offsetHeight;
    const arriba = panel.getBoundingClientRect().top;
    if (arriba < limite) window.scrollTo({ top: window.scrollY + arriba - limite - 8, behavior: "auto" });
  }, [diaActivo]);

  /** Salas activas y usables de Casa Tomás, por nombre (por id: hay dos «Terraza», una de cada negocio). */
  const salasUsables = useMemo(
    () =>
      espacios
        .filter((e) => e.activa !== false && !excluidas.has(e.id) && salaAdmiteReservas(e))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [espacios, excluidas],
  );

  const aplicarCambio = async ({ fila, destinoId, destinoNombre }: CambioPendiente) => {
    try {
      await cambiarSala.mutateAsync({ reservaId: fila.reserva_id, espacioId: destinoId });
      toast.success(`${fila.nombre || "Reserva"} → ${destinoNombre}`, {
        description: "Cambio interno: el cliente no recibe ningún correo.",
      });
    } catch (error) {
      console.error("[asignacion] Error al cambiar la sala:", error);
      toast.error(
        error instanceof ErrorSinPermisoSala
          ? error.message
          : esErrorSalaPrivadaOcupada(error)
            ? mensajeSalaPrivadaOcupada(error) // el Reservado ya tiene otra reserva en ese turno
            : "No se pudo cambiar la sala. Inténtalo de nuevo.",
      );
    }
  };

  const elegirSala = (fila: FilaAsignacionDia, destinoId: string) => {
    if (destinoId === fila.espacio_id) return;
    const destinoNombre = espacios.find((e) => e.id === destinoId)?.nombre ?? "la sala elegida";
    const cambio = { fila, destinoId, destinoNombre };
    // El trigger borra las mesas al cambiar de sala: eso se confirma antes.
    if (fila.mesas_asignadas > 0) setCambioPendiente(cambio);
    else void aplicarCambio(cambio);
  };

  const filaProps = {
    excluidas,
    salas: salasUsables,
    onElegirSala: elegirSala,
    onAsignarMesa,
    onEditar: editarReserva,
    puedeEditar,
    salaEnCurso: cambiarSala.isPending ? cambiarSala.variables?.reservaId ?? null : null,
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Asignación de salas y mesas</CardTitle>
          </div>
          <CardDescription>
            El cliente solo reserva una hora: la sala y la mesa se deciden aquí. Elige un día: el número de cada
            pestaña son sus reservas sin mesa, la marca de verificación{" "}
            <Check
              className="inline h-3.5 w-3.5 align-[-2px] text-emerald-700 dark:text-emerald-300"
              strokeWidth={3}
              aria-hidden="true"
            />{" "}
            significa que ya está todo asignado y el reloj{" "}
            <Clock className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /> señala los días de las próximas{" "}
            {asignacion.ventanaHoras}&nbsp;h, los primeros que conviene repartir. Se puede asignar cualquier reserva,
            esté o no en esa ventana.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="asignacion-dias" className="text-xs text-muted-foreground">
              Mostrar
            </Label>
            <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
              <SelectTrigger id="asignacion-dias" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPCIONES_DIAS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    Próximos {d} días
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex h-10 items-center gap-2">
            <Switch id="asignacion-solo-pendientes" checked={soloPendientes} onCheckedChange={setSoloPendientes} />
            <Label htmlFor="asignacion-solo-pendientes" className="text-sm font-normal">
              Ocultar las que ya tienen mesa
            </Label>
          </div>
        </CardContent>
      </Card>

      {!isError && !isLoading && truncado && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-medium">Puede que falten reservas.</span> Este rango tiene más de{" "}
            {LIMITE_FILAS_TEXTO} reservas y solo se han cargado las primeras {LIMITE_FILAS_TEXTO}, por fecha y hora:
            las cuentas de los últimos días pueden quedarse cortas. Elige menos días en «Mostrar».
          </p>
        </div>
      )}

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            No se pudieron cargar las reservas.
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Cargando" />
          </CardContent>
        </Card>
      ) : (
        <Tabs value={diaActivo} onValueChange={setDiaElegido} className="space-y-4">
          <TiraDias
            dias={pestanas}
            hoy={desde}
            ventanaHoras={asignacion.ventanaHoras}
            activo={diaActivo}
            tiraRef={tiraRef}
          />
          {/* Un único panel, el del día abierto: los demás días no se pintan. `scroll-mt`: al tabular
              hacia una fila, el navegador no la deja tapada por la tira fija. */}
          <TabsContent value={diaActivo} ref={panelRef} className="mt-0 [&_button]:scroll-mt-28">
            <PanelDia
              dia={datosDia}
              etiquetas={etiquetasDia(diaActivo, desde)}
              enVentana={pestanas.find((p) => p.fecha === diaActivo)?.enVentana ?? false}
              ventanaHoras={asignacion.ventanaHoras}
              renderFila={(fila: FilaAsignacionDia) => <FilaReserva key={fila.reserva_id} fila={fila} {...filaProps} />}
            />
          </TabsContent>
        </Tabs>
      )}

      <AlertDialog open={!!cambioPendiente} onOpenChange={(abierto) => !abierto && setCambioPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cambiar de sala y quitar sus mesas?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {cambioPendiente && (
                  <p>
                    {textoQuitarMesas({
                      nombre: cambioPendiente.fila.nombre,
                      cantidad: cambioPendiente.fila.mesas_asignadas,
                      mesasNombres: cambioPendiente.fila.mesas_nombres,
                      salaActual: cambioPendiente.fila.espacio_nombre,
                      destinoNombre: cambioPendiente.destinoNombre,
                    })}
                  </p>
                )}
                <p>{TEXTO_CAMBIO_INTERNO}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cambioPendiente) void aplicarCambio(cambioPendiente);
                setCambioPendiente(null);
              }}
            >
              Cambiar de sala
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Editor de la reserva elegida en «Editar». `null` hasta que se pide. */}
      {dialogoEdicion}
    </div>
  );
}

// ----------------------------------------------------------------------------

interface PropsFila {
  excluidas: ReadonlySet<string>;
  /** Salas activas y usables de Casa Tomás. */
  salas: EspacioReserva[];
  onElegirSala: (fila: FilaAsignacionDia, espacioId: string) => void;
  onAsignarMesa: (destino: DestinoAsignacion) => void;
  /** Abre el editor de la reserva (por id). */
  onEditar: (reservaId: string) => void;
  /** Permiso de edición sobre «reservas»: sin él, «Editar» sale deshabilitado. */
  puedeEditar: boolean;
  /** Reserva cuya sala se está guardando ahora mismo. */
  salaEnCurso: string | null;
}

function FilaReserva({
  fila,
  excluidas,
  salas,
  onElegirSala,
  onAsignarMesa,
  onEditar,
  puedeEditar,
  salaEnCurso,
}: PropsFila & { fila: FilaAsignacionDia }) {
  const salaNoUsable = !!fila.espacio_id && excluidas.has(fila.espacio_id);
  const salto = resolverSaltoAsignacion(
    { id: fila.reserva_id, fecha: fila.fecha, hora: fila.hora, espacio_id: fila.espacio_id, estado: fila.estado },
    { yaTieneMesa: fila.mesas_asignadas > 0, nombreSala: fila.espacio_nombre },
  );
  // En este panel la sala se pone en la misma fila: el texto compartido
  // («usa Gestionar») no aplica aquí.
  const tituloMesas = salto.motivo === "sin_sala" ? "Primero dale sala con el botón «Sala»" : salto.titulo;
  const guardando = salaEnCurso === fila.reserva_id;

  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-12 font-semibold tabular-nums">{horaCorta(fila.hora)}</span>
        <span className="min-w-0 truncate font-medium">{fila.nombre || "Sin nombre"}</span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {fila.numero_comensales}
        </span>
        {fila.estado !== "confirmada" && (
          <span className="text-xs capitalize text-muted-foreground">{fila.estado}</span>
        )}
        {fila.espacio_nombre && (
          <span className="flex items-center gap-1 text-sm">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {fila.espacio_nombre}
            {fila.mesas_nombres.length > 0 && (
              <span className="text-muted-foreground"> · {fila.mesas_nombres.join(", ")}</span>
            )}
          </span>
        )}
        {salaNoUsable && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-400 text-[11px] text-amber-800 dark:text-amber-200"
            title="Esta sala está marcada como no usable en Configuración. La reserva sigue en ella hasta que la cambies."
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Sala no usable
          </Badge>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Editar datos, día, hora, comensales, sala o notas (2026-09-30). Sin
            mirar el estado: solo el permiso lo apaga. El botón deshabilitado no
            recibe el ratón: el motivo se ve en el envoltorio. */}
        <ConMotivo motivo={puedeEditar ? undefined : "No tienes permiso para editar reservas"}>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={!puedeEditar}
            title={puedeEditar ? "Editar datos, día, hora, comensales, sala y notas" : "No tienes permiso para editar reservas"}
            aria-label={`Editar la reserva de ${fila.nombre || "este cliente"}`}
            onClick={() => onEditar(fila.reserva_id)}
          >
            <SquarePen className="h-4 w-4" aria-hidden="true" />
            Editar
          </Button>
        </ConMotivo>
        <SelectorSala fila={fila} salas={salas} guardando={guardando} onElegir={onElegirSala} />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!salto.destino}
          title={tituloMesas}
          aria-label={tituloMesas}
          onClick={() => salto.destino && onAsignarMesa(salto.destino)}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          Mesas
        </Button>
      </div>
    </li>
  );
}

function SelectorSala({
  fila,
  salas,
  guardando,
  onElegir,
}: {
  fila: FilaAsignacionDia;
  salas: EspacioReserva[];
  guardando: boolean;
  onElegir: (fila: FilaAsignacionDia, espacioId: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button variant={fila.espacio_id ? "outline" : "default"} size="sm" className="gap-1.5" disabled={guardando}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MapPin className="h-4 w-4" aria-hidden="true" />}
          {fila.espacio_id ? "Sala" : "Dar sala"}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        {/* Montado solo con el popover abierto: la ocupación del día se pide
            al abrirlo, no por cada fila de la lista. */}
        {abierto && (
          <OpcionesSala
            fila={fila}
            salas={salas}
            onElegir={(id) => {
              setAbierto(false);
              onElegir(fila, id);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function OpcionesSala({
  fila,
  salas,
  onElegir,
}: {
  fila: FilaAsignacionDia;
  salas: EspacioReserva[];
  onElegir: (espacioId: string) => void;
}) {
  const { data, isLoading } = useOcupacionSalasDia(fila.fecha);

  const { ocupacion, sugerida, texto } = useMemo(() => {
    if (!data) return { ocupacion: null, sugerida: null, texto: null };
    const usables = new Set(salas.map((s) => s.id));
    const oc = calcularOcupacionSalas({
      espacios: data.espacios.filter((e) => usables.has(e.id)),
      reservas: data.reservas,
      horasBase: data.horasBase,
      comensales: fila.numero_comensales,
      excluirReservaId: fila.reserva_id,
    });
    const rec = recomendarUbicacion(oc, { espacioId: fila.espacio_id, hora: fila.hora });
    // Aquí solo se decide la sala: una sugerencia que cambie la hora no aplica.
    const valida = rec.tipo !== "sin_hueco" && rec.hora === horaCorta(fila.hora);
    return {
      ocupacion: oc,
      sugerida: valida ? rec.espacioId : null,
      texto: rec.tipo === "sin_hueco" ? rec.texto : null,
    };
  }, [data, fila, salas]);

  if (salas.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        No hay salas usables. Revísalo en Configuración.
      </p>
    );
  }

  return (
    <div className="py-1">
      <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
        {fila.numero_comensales} comensales · {ETIQUETA_TURNO[fila.turno]} del {fila.fecha.split("-").reverse().join("/")}
      </p>
      <ul aria-label="Salas" className="max-h-72 overflow-y-auto">
        {salas.map((sala) => {
          const celda = ocupacion?.salas.find((s) => s.espacioId === sala.id)?.turnos[fila.turno];
          const actual = sala.id === fila.espacio_id;
          return (
            <li key={sala.id}>
              <button
                type="button"
                disabled={actual}
                aria-current={actual ? "true" : undefined}
                onClick={() => onElegir(sala.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted pointer-coarse:min-h-11 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {actual ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : <span className="w-4" />}
                  <span className="truncate">{sala.nombre}</span>
                  {sala.id === sugerida && !actual && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      Sugerida
                    </Badge>
                  )}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums",
                    celda && !celda.cabe ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
                  )}
                  title={celda && !celda.cabe ? "Con este grupo la sala pasaría de su capacidad" : undefined}
                >
                  {isLoading || !celda ? "…" : `${celda.ocupados}/${celda.capacidad ?? "—"}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {texto && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{texto}</p>}
    </div>
  );
}
