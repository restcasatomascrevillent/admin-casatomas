import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, ChevronDown, LayoutGrid, Loader2, MapPin, SquarePen, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { NegocioBadge } from "./NegocioBadge";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { ConMotivo } from "./ConMotivo";
import { cn } from "@/lib/utils";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEspaciosReserva, type EspacioReserva } from "@/hooks/useEspaciosReserva";
import { datosDeNegocio, useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import {
  ErrorSinPermisoSala,
  useCambiarSalaReserva,
  useReservasPorAsignar,
  type FilaAsignacionDia,
} from "@/hooks/useReservasPorAsignar";
import {
  agruparPorTurnoYGrado,
  configAsignacionDesde,
  fechaMadrid,
  ordenarVentanaPrimero,
  sumarDias,
  type GrupoTurno,
} from "@/lib/reservas/ventanaAsignacion";
import { FILTRO_NEGOCIO_TODOS, NEGOCIOS_PANEL, marcaDeEspacio } from "@/lib/reservas/negocios";
import {
  ETIQUETA_TURNO,
  calcularOcupacionSalas,
  horaCorta,
  recomendarUbicacion,
} from "@/lib/reservas/ocupacionSalas";
import { resolverSaltoAsignacion, type DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { TEXTO_CAMBIO_INTERNO, textoQuitarMesas, type GradoAsignacion } from "@/lib/reservas/asignacionMesas";

// ============================================================================
// PESTAÑA "ASIGNACIÓN" (reservas-sin-salas, Fase B)
// ----------------------------------------------------------------------------
// El cliente de Casa Tomás solo reserva una hora: la sala y la mesa se deciden
// por dentro. Aquí se ven ARRIBA las reservas de las próximas N horas
// (`asignacion_ventana_horas`), agrupadas por día, turno y grado, y debajo las
// posteriores. La ventana solo resalta: cualquier reserva futura se puede
// asignar.
//
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

const ETIQUETA_GRADO: Record<GradoAsignacion, string> = {
  sin_sala: "Sin sala",
  sin_mesa: "Con sala, sin mesa",
  con_mesa: "Con mesa",
};

/** Pendiente no es error: tonos neutros, nunca rojo (ver saltoAsignacion.ts). */
const CLASES_GRADO: Record<GradoAsignacion, string> = {
  sin_sala: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  sin_mesa: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  con_mesa: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
};

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
  const { data: config } = useConfiguracionReservas();
  const { data: espaciosData } = useEspaciosReserva();
  const cambiarSala = useCambiarSalaReserva();
  // Editar una reserva desde su fila (2026-09-30): datos, día, hora, comensales,
  // sala y notas, sea cual sea su estado.
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();

  const [dias, setDias] = useState<number>(14);
  const [negocio, setNegocio] = useState<string>(FILTRO_NEGOCIO_TODOS);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [cambioPendiente, setCambioPendiente] = useState<CambioPendiente | null>(null);

  // La ventana se desliza con el reloj: se recalcula cada minuto.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const asignacion = useMemo(() => configAsignacionDesde(config), [config]);
  const excluidas = useMemo(() => new Set(asignacion.espaciosExcluidos), [asignacion.espaciosExcluidos]);
  const espacios = (espaciosData ?? []) as EspacioReserva[];

  const desde = fechaMadrid(ahora);
  // Al menos toda la ventana, aunque se elija un rango más corto.
  const hasta = sumarDias(desde, Math.max(dias, Math.ceil(asignacion.ventanaHoras / 24) + 1));
  const { data: filas, isLoading, isError, refetch } = useReservasPorAsignar(desde, hasta);

  const { gruposVentana, gruposDespues, pendientesVentana } = useMemo(() => {
    const visibles = (filas ?? []).filter((f) => negocio === FILTRO_NEGOCIO_TODOS || f.marca === negocio);
    const partes = ordenarVentanaPrimero(visibles, asignacion.ventanaHoras, ahora);
    const pendientes = partes.enVentana.filter((f) => f.grado !== "con_mesa").length;
    const filtrar = (lista: FilaAsignacionDia[]) =>
      soloPendientes ? lista.filter((f) => f.grado !== "con_mesa") : lista;
    return {
      gruposVentana: agruparPorTurnoYGrado(filtrar(partes.enVentana)),
      gruposDespues: agruparPorTurnoYGrado(filtrar(partes.despues)),
      pendientesVentana: pendientes,
    };
  }, [filas, negocio, soloPendientes, asignacion.ventanaHoras, ahora]);

  /** Salas activas y usables de un negocio, por nombre. */
  const salasDe = (marca: string) =>
    espacios
      .filter((e) => e.activa !== false && !excluidas.has(e.id) && marcaDeEspacio(e) === marca)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const aplicarCambio = async ({ fila, destinoId, destinoNombre }: CambioPendiente) => {
    try {
      await cambiarSala.mutateAsync({ reservaId: fila.reserva_id, espacioId: destinoId });
      toast.success(`${fila.nombre || "Reserva"} → ${destinoNombre}`, {
        description: "Cambio interno: el cliente no recibe ningún correo.",
      });
    } catch (error) {
      console.error("[asignacion] Error al cambiar la sala:", error);
      toast.error(
        error instanceof ErrorSinPermisoSala ? error.message : "No se pudo cambiar la sala. Inténtalo de nuevo.",
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
    ahora,
    excluidas,
    salasDe,
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
            El cliente solo reserva una hora: la sala y la mesa se deciden aquí. Arriba, lo de las próximas{" "}
            {asignacion.ventanaHoras} h; debajo, lo que viene después. Se puede asignar cualquier reserva, esté o no
            en la ventana.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="asignacion-negocio" className="text-xs text-muted-foreground">
              Negocio
            </Label>
            <Select value={negocio} onValueChange={setNegocio}>
              <SelectTrigger id="asignacion-negocio" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTRO_NEGOCIO_TODOS}>Todos</SelectItem>
                {NEGOCIOS_PANEL.map((n) => (
                  <SelectItem key={n.marca} value={n.marca}>
                    {n.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
        <>
          <section
            aria-labelledby="titulo-ventana-asignacion"
            className="space-y-3 rounded-lg border-2 border-primary/40 bg-primary/5 p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="titulo-ventana-asignacion" className="text-base font-semibold sm:text-lg">
                Próximas {asignacion.ventanaHoras} horas
              </h3>
              <span className="text-sm text-muted-foreground">
                {pendientesVentana === 0
                  ? "Todo asignado"
                  : `${pendientesVentana} reserva${pendientesVentana === 1 ? "" : "s"} sin mesa`}
              </span>
            </div>
            <ListaGrupos grupos={gruposVentana} vacio="No hay reservas en la ventana." {...filaProps} />
          </section>

          <section aria-labelledby="titulo-despues-asignacion" className="space-y-3">
            <h3 id="titulo-despues-asignacion" className="text-base font-semibold sm:text-lg">
              Más adelante
            </h3>
            <ListaGrupos grupos={gruposDespues} vacio="No hay más reservas en este rango." {...filaProps} />
          </section>
        </>
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
  ahora: number;
  excluidas: ReadonlySet<string>;
  salasDe: (marca: string) => EspacioReserva[];
  onElegirSala: (fila: FilaAsignacionDia, espacioId: string) => void;
  onAsignarMesa: (destino: DestinoAsignacion) => void;
  /** Abre el editor de la reserva (por id). */
  onEditar: (reservaId: string) => void;
  /** Permiso de edición sobre «reservas»: sin él, «Editar» sale deshabilitado. */
  puedeEditar: boolean;
  /** Reserva cuya sala se está guardando ahora mismo. */
  salaEnCurso: string | null;
}

function etiquetaDia(fecha: string, ahora: number): string {
  const hoy = fechaMadrid(ahora);
  if (fecha === hoy) return "Hoy";
  if (fecha === sumarDias(hoy, 1)) return "Mañana";
  const texto = format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function ListaGrupos({
  grupos,
  vacio,
  ...props
}: PropsFila & { grupos: GrupoTurno<FilaAsignacionDia>[]; vacio: string }) {
  if (grupos.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">{vacio}</p>;
  }
  return (
    <div className="space-y-3">
      {grupos.map((grupo) => (
        <Card key={`${grupo.fecha}|${grupo.turno}`}>
          <CardHeader className="px-3 pb-2 pt-3 sm:px-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle className="text-sm font-semibold sm:text-base">
                {etiquetaDia(grupo.fecha, props.ahora)} · {ETIQUETA_TURNO[grupo.turno]}
              </CardTitle>
              <span className="text-xs text-muted-foreground tabular-nums">
                {grupo.comensales} comensales
                {grupo.pendientes > 0 && ` · ${grupo.pendientes} sin mesa`}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-3 pb-3 sm:px-4">
            {grupo.grados.map(({ grado, reservas }) => (
              <div key={grado} className="space-y-1.5">
                <Badge variant="outline" className={cn("text-[11px] font-medium", CLASES_GRADO[grado])}>
                  {ETIQUETA_GRADO[grado]} · {reservas.length}
                </Badge>
                <ul className="divide-y rounded-md border">
                  {reservas.map((fila) => (
                    <FilaReserva key={fila.reserva_id} fila={fila} {...props} />
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FilaReserva({
  fila,
  excluidas,
  salasDe,
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
        <NegocioBadge marca={fila.marca} corta />
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
        <SelectorSala fila={fila} salas={salasDe(fila.marca)} guardando={guardando} onElegir={onElegirSala} />
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
  const { data, isLoading } = useOcupacionSalasDia(fila.fecha, { marca: fila.marca });

  const { ocupacion, sugerida, texto } = useMemo(() => {
    const bloque = datosDeNegocio(data, fila.marca);
    if (!bloque) return { ocupacion: null, sugerida: null, texto: null };
    const usables = new Set(salas.map((s) => s.id));
    const oc = calcularOcupacionSalas({
      espacios: bloque.espacios.filter((e) => usables.has(e.id)),
      reservas: bloque.reservas,
      horasBase: bloque.horasBase,
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
        No hay salas usables para este negocio. Revísalo en Configuración.
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
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
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
