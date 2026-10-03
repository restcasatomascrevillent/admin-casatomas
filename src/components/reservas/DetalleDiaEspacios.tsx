// ============================================================================
// REPARTO DE UN DÍA POR SALAS — panel del día de la pestaña Calendario
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-26):
//   "y luego en el calendario que al hacer click un día se vean los espacios
//    bien puestos"
//   Y sobre cómo trabaja:
//   "hay que permitir asignar sala sin mesa y luego mesa, para ir cerrando los
//    días poco a poco"
//
// El día se cierra EN DOS GRADOS y esto manda sobre cualquier intuición:
//   1. Reparto por SALA (`reservas.espacio_id`). Se hace ARRASTRANDO TARJETAS
//      EN EL KANBAN. Aquí NO se duplica.
//   2. Bajada al detalle de MESA (`asignaciones_mesa`). Se hace en el PLANO
//      (`PlanoEspacio2D`). Aquí NO se duplica.
//
// UNA RESERVA CON SALA Y SIN MESA ES UN ESTADO LEGÍTIMO Y NORMAL: es el estado
// en el que pasa la mayor parte de su vida. Por eso aquí `sin_mesa` se escribe
// SIEMPRE como "pendiente de mesa", nunca como fallo, y no lleva color de
// alarma. El único ámbar de la pantalla es el de `sin_sala`, porque eso sí es
// trabajo que todavía no ha empezado.
//
// ---------------------------------------------------------------------------
// QUÉ ES ESTE PANEL, Y QUÉ NO ES
// ---------------------------------------------------------------------------
// Es el CUADRO DE MANDO y el PUNTO DE ENTRADA: consulta + navegación. Enseña
// cómo está repartido el día por salas y lo que le falta, y SALTA al plano de
// la sala para asignar. NO es una segunda pantalla de asignación: no hay
// drag&drop de mesas ni edición de asignaciones, a propósito. El motivo es del
// dueño: no quiere dos pantallas que hagan lo mismo de forma distinta.
//
// El salto va por `onEspacioClick` (la prop que `Reservas.tsx` ya pasa, y que
// hasta ahora el calendario no usaba). Como esa prop solo lleva el id del
// espacio, antes de llamarla se escribe la fecha en la URL
// (`?fecha=YYYY-MM-DD`, y `turno` si hay uno filtrado) para que
// `PlanoEspacio2D` la lea como valor inicial. Va en `fecha`, NO en `date`:
// `Reservas.tsx` ya usa `tab`, `status` y `date` para el deep link de la lista
// y chocarían.
//
// ---------------------------------------------------------------------------
// DE DÓNDE SALEN LOS DATOS — una sola fuente, sin respaldo
// ---------------------------------------------------------------------------
// `useResumenAsignacionDia(fechaISO)` → vista `public.vista_asignacion_dia`
// (migración `20260926140000_asignaciones_mesa_sin_solapes.sql`, ya aplicada).
// La vista da UNA FILA POR RESERVA VIVA del día y ya trae los dos grados
// contados en SQL. Conviene saber qué filtra y qué decide ella, porque el panel
// se fía de eso y no lo recalcula:
//
//   · `estado in ('pendiente','verificada','confirmada')`. Las `completada` y
//     `no_show` quedan FUERA aunque conserven su mesa: esta pantalla es "a
//     quién me falta sentar", no un histórico. Las canceladas tampoco están.
//   · `turno`: corte a las 17:00 (`hora < '17:00:00'` → comida, si no cena).
//     Es el mismo corte del trigger de aforo, no una regla de la interfaz.
//   · `marca`: la de la SALA cuando la reserva ya tiene sala (es donde se
//     sienta la gente); solo cuando aún no hay sala se usa `reservas.marca`.
//     Nunca llega vacía: por defecto 'casa_tomas'. Las filas que no son de
//     Casa Tomás ya las descarta el hook (`admiteReservas`).
//   · `grado`: `sin_sala` → `sin_mesa` → `con_mesa`, calculado en SQL a partir
//     de `espacio_id` y del recuento de `asignaciones_mesa`.
//
// Columnas que usa este panel: `espacio_id` y `espacio_nombre` (grado 1),
// `mesas_asignadas` a través de `grado` (grado 2), `numero_comensales` (el peso
// real de cada sala), `turno` (el filtro de arriba) y `reserva_id` (identidad).
// `fecha`, `nombre`, `estado`, `marca`, `plazas_asignadas` y `mesas_nombres`
// son de la misma vista pero se leen en el plano, no aquí.
//
// HASTA EL 2026-09-26 ESTE PANEL TENÍA RESPALDO y ya no lo tiene. Aceptaba las
// reservas del mes que traía el calendario y, si la vista fallaba o venía
// vacía, pintaba solo el grado 1 y escribía "el detalle de mesa no está
// disponible". Eso mentía en lo más importante: una reserva CON SALA Y SIN MESA
// salía como dato desconocido en vez de como lo que es, trabajo pendiente. Con
// la vista aplicada la fuente es única, y a cambio hay que ser honestos con los
// tres estados de la consulta: CARGANDO (esqueleto, ni una cifra), ERROR
// (mensaje + reintentar, nada de ceros) y VACÍO DE VERDAD ("no hay reservas").
//
// ---------------------------------------------------------------------------
// SALAS SIN MESAS EN EL PLANO
// ---------------------------------------------------------------------------
// Caso real de producción (2026-09-26): de 7 espacios solo 3 tienen mesas
// (Comedor 2, Salón 15, Terraza 3, todas de Casa Tomás). En las demás el
// grado 2 es IMPOSIBLE. Ahí no se pinta "0 %" -que dejaría al encargado
// buscando mesas que no existen- sino el aviso de que la sala no tiene mesas
// en el plano, y el salto sigue activo porque es donde se crean.
//
// ---------------------------------------------------------------------------
// DISPONIBILIDAD POR CUARTOS DE HORA (reservas-sin-salas, 2026-09-29)
// ---------------------------------------------------------------------------
// Debajo del reparto va la rejilla interna del día de 15 en 15 minutos
// (`DisponibilidadCuartos`, una sola, la de Casa Tomás): cuándo llega la gente
// y cuánta hay sentada. Es solo consulta, como el resto del panel. Sus datos
// son los de `useOcupacionSalasDia` (reservas del día), no los de la vista de
// asignación.
//
// ---------------------------------------------------------------------------
// CABECERA: LOS COMENSALES EN GRANDE Y LA OCUPACIÓN (2026-10-01)
// ---------------------------------------------------------------------------
// La cabecera pone los COMENSALES como protagonista (igual que la casilla del
// mes: el dueño quiere esa cifra de un vistazo) y las reservas debajo, pequeñas.
// Debajo va el % de aforo de comida y de cena (`OcupacionDelDia`): el desglose
// del color de la casilla. Se calcula con la MISMA función que la casilla
// (`ocupacionPorTurno`) y con las filas de `vista_asignacion_dia`, que ya son
// solo las reservas vivas. El aforo sale de `useEspaciosReserva` (espacios
// activos de Casa Tomás, como el trigger). Los días pasados no llevan %: lo que
// ya ocurrió no se mide contra el aforo.
//
// Casilla y panel cuentan lo mismo MIENTRAS la marca de cada reserva sea la de
// su sala: la casilla filtra por `reservas.marca` y este panel por la marca de
// la vista, que es la de la SALA cuando la reserva tiene sala (ver la cabecera
// de `useResumenAsignacionDia`). Hoy coinciden siempre (el 2026-10-01: 0
// discrepancias de 1.241 reservas); si algún día no, una reserva de una marca
// en una sala de la otra contaría en uno y no en el otro.
//
// SOLO CASA TOMÁS: Touza ya no admite reservas (decisión del dueño, 2026-10-01).
// Ni las cifras de la cabecera, ni el %, ni las salas de debajo, ni la rejilla
// enseñan nada de otro negocio que quede en datos antiguos, igual que la casilla
// del mes: `useResumenAsignacionDia` ya descarta esas filas con `admiteReservas`.
//
// Las cifras de la cabecera (comensales, reservas, con mesa) siguen al filtro de
// turno; el desglose de ocupación enseña siempre los dos turnos.
// ============================================================================

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  Armchair,
  CalendarIcon,
  ChevronRight,
  Info,
  LayoutGrid,
  RefreshCw,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useMesas } from "@/hooks/useMesas";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useResumenAsignacionDia, type FilaAsignacionDia } from "@/hooks/useResumenAsignacionDia";
import {
  resumenDia,
  resumenPorEspacio,
  type FilaResumenEspacio,
  type ResumenEspacio,
  type Turno,
} from "@/lib/reservas/asignacionMesas";
import { aforoCasaTomas, ocupacionPorTurno } from "@/lib/reservas/ocupacionCalendario";
import { estaFueraDeAforo, idsSalasPrivadasActivas } from "@/lib/reservas/salaPrivada";
import { EtiquetaFueraDeAforo } from "./EtiquetaFueraDeAforo";
import { fechaMadrid } from "@/lib/reservas/ventanaAsignacion";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { DisponibilidadCuartos } from "./DisponibilidadCuartos";
import { OcupacionDelDia } from "./OcupacionDelDia";

export interface DetalleDiaEspaciosProps {
  /** Día que se está mirando. */
  fecha: Date;
  /** Salta al plano de esa sala. La pasa `Reservas.tsx`. */
  onEspacioClick?: (espacioId: string) => void;
}

/** "todos" = sin filtrar; el reparto se cierra por turnos, pero se puede ver el día entero. */
type FiltroTurno = Turno | "todos";

const ETIQUETA_TURNO: Record<FiltroTurno, string> = {
  todos: "Todo el día",
  comida: "Comida",
  cena: "Cena",
};

function plural(n: number, singular: string, plural_: string) {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * Una fila de la vista reducida a lo justo para agrupar por sala. `turno` y
 * `grado` se cogen TAL CUAL de la fila (los calcula la vista en SQL y el hook ya
 * los ha saneado: volver a derivarlos aquí sería una segunda regla que podría
 * discrepar de la base de datos). El nombre de la sala sí tiene respaldo local
 * (`espaciosPorId`) porque es solo una etiqueta: si la vista lo trae vacío,
 * enseñar "Sala sin nombre" teniendo el nombre a mano en caché no ayuda a nadie.
 */
const aFilaResumen =
  (espaciosPorId: ReadonlyMap<string, { nombre: string }>) =>
  (f: FilaAsignacionDia): FilaResumenEspacio => ({
    grado: f.grado,
    espacio_id: f.espacio_id,
    espacio_nombre: f.espacio_nombre ?? (f.espacio_id ? espaciosPorId.get(f.espacio_id)?.nombre : null) ?? null,
    numero_comensales: f.numero_comensales,
  });

/** Lo legible de un error de PostgREST/red, para poder reportarlo sin mirar logs. */
function mensajeDeError(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message).trim();
  }
  return "";
}

// ── Barra de cierre ──────────────────────────────────────────────────────────
//
// `aria-hidden`: la cifra va SIEMPRE escrita al lado, así que la barra es
// decoración y un lector de pantalla no gana nada leyéndola.
function BarraCierre({ porcentaje }: { porcentaje: number }) {
  const valor = Math.max(0, Math.min(100, Math.round(porcentaje)));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          valor >= 100 ? "bg-green-600 dark:bg-green-500" : "bg-primary",
        )}
        style={{ width: `${valor}%` }}
      />
    </div>
  );
}

// ── Esqueleto de carga ───────────────────────────────────────────────────────
//
// Sin respaldo, mientras la vista viaja NO SE SABE NADA del día. Se pintan
// siluetas y ni una cifra: un "0 reservas · 0 %" que un instante después salta
// a "5 reservas · 80 %" es peor que no enseñar nada, porque el encargado ya ha
// leído el cero y se lo ha creído.
function EsqueletoDia() {
  return (
    <div className="space-y-2" role="status" aria-label="Cargando el reparto del día">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border p-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-2 h-3 w-2/3" />
          <Skeleton className="mt-3 h-1.5 w-full" />
        </div>
      ))}
    </div>
  );
}

// ── Error de la consulta ─────────────────────────────────────────────────────
//
// No se reutiliza `EstadoErrorCarga` (el bloque de error compartido) por tres
// motivos concretos, no por gusto: aquí no hay ningún dato pintado debajo -así
// que su "los datos que ves pueden estar incompletos" no describe esta
// pantalla-, el panel vive en una columna estrecha junto al calendario, y hace
// falta que el botón diga que está reintentando (`isFetching`), cosa que aquel
// no hace. El lenguaje visual sí es el mismo a propósito.
function BloqueErrorDia({
  error,
  reintentando,
  onReintentar,
}: {
  error: unknown;
  /** La consulta ya está en vuelo otra vez: el botón no debe repetirla. */
  reintentando: boolean;
  onReintentar: () => void;
}) {
  const detalle = mensajeDeError(error);

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">No se ha podido leer el reparto de este día</p>
          <p className="text-xs text-muted-foreground">
            No se enseña ninguna cifra para no dar por buenos unos datos que no se han
            llegado a leer. Vuelve a intentarlo.
          </p>
          {detalle && <p className="break-words text-xs text-muted-foreground/80">{detalle}</p>}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 gap-2"
        onClick={onReintentar}
        disabled={reintentando}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", reintentando && "animate-spin")} aria-hidden="true" />
        {reintentando ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  );
}

// ── Tarjeta de una sala ──────────────────────────────────────────────────────
//
// Toda la tarjeta es el botón que salta al plano: así la acción está SIEMPRE en
// el mismo sitio y no baila entre filas según lo que tenga cada sala. El
// chevron de la derecha es solo la pista visual, y va en la cabecera -no al
// final del bloque- para que no se mueva cuando una sala tiene más texto que
// otra.
function TarjetaSala({
  grupo,
  tieneMesas,
  onIr,
  fueraDeAforo = false,
}: {
  grupo: ResumenEspacio;
  /** ¿La sala tiene alguna mesa activa en el plano? Si no, el grado 2 es imposible. */
  tieneMesas: boolean;
  onIr: (espacioId: string) => void;
  /** Sala privada (el Reservado): sus reservas no cuentan en las cifras de arriba. */
  fueraDeAforo?: boolean;
}) {
  const espacioId = grupo.espacio_id as string;
  // Solo se puede hablar de "cerrada" si la sala tiene mesas que asignar.
  const cerrada = tieneMesas && grupo.conMesa === grupo.total;

  return (
    <button
      type="button"
      onClick={() => onIr(espacioId)}
      aria-label={`Abrir el plano de ${grupo.espacio_nombre}`}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        "hover:border-primary/50 hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate font-medium" title={grupo.espacio_nombre}>
            {grupo.espacio_nombre}
          </span>
          {fueraDeAforo && <EtiquetaFueraDeAforo />}
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
          <CalendarIcon className="h-3 w-3" aria-hidden="true" />
          {plural(grupo.total, "reserva", "reservas")}
        </span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
          <Users className="h-3 w-3" aria-hidden="true" />
          {plural(grupo.comensales, "comensal", "comensales")}
        </span>
      </div>

      {!tieneMesas ? (
        // Aviso, NO error: la sala funciona igual, simplemente no se puede
        // bajar al grado de mesa hasta que alguien dé de alta mesas.
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Esta sala no tiene mesas en el plano: entra para crearlas.</span>
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {grupo.conMesa > 0 && (
              <Badge
                variant="outline"
                className="gap-1 whitespace-nowrap border-green-300 bg-green-50 text-[10px] tabular-nums text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200"
              >
                <Armchair className="h-3 w-3" aria-hidden="true" />
                {grupo.conMesa} con mesa
              </Badge>
            )}
            {grupo.sinMesa > 0 && (
              // Tono neutro a propósito: "pendiente de mesa" es el estado
              // normal de una reserva, no algo que avisar en ámbar. El dato es
              // real (lo cuenta la vista), así que se escribe tal cual.
              <Badge
                variant="outline"
                className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground"
              >
                {grupo.sinMesa} pendiente{grupo.sinMesa === 1 ? "" : "s"} de mesa
              </Badge>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <BarraCierre porcentaje={grupo.porcentajeCerrado} />
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                cerrada
                  ? "font-medium text-green-700 dark:text-green-400"
                  : "text-muted-foreground",
              )}
            >
              {cerrada ? "Cerrada" : `${grupo.porcentajeCerrado}%`}
            </span>
          </div>
        </>
      )}
    </button>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function DetalleDiaEspacios({ fecha, onEspacioClick }: DetalleDiaEspaciosProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [turno, setTurno] = useState<FiltroTurno>("todos");

  const fechaISO = format(fecha, "yyyy-MM-dd");

  // El turno NO se le pasa al hook aunque lo acepte: filtrando en cliente el
  // botón responde al instante (sin ir al servidor por cada cambio) y además se
  // puede saber si el otro turno tiene reservas, que es lo que evita el
  // "no hay reservas" engañoso cuando el filtro está puesto.
  // `REFRESCO_PERIODICO`: sin realtime, una mesa o una sala dada en otro
  // dispositivo llega como mucho al minuto (con la pestaña a la vista).
  const { filas, isLoading, isError, error, isFetching, refetch } = useResumenAsignacionDia(fechaISO, {
    refresco: REFRESCO_PERIODICO,
  });

  // Solo lectura y compartidas con media app: react-query las sirve de caché.
  const { data: espacios } = useEspaciosReserva();
  // Mesas ACTIVAS de todas las salas: una sala cuyas mesas están todas
  // desactivadas está, para asignar, igual que una sala sin mesas.
  const { data: mesas } = useMesas();

  const espaciosPorId = useMemo(() => {
    const mapa = new Map<string, { nombre: string }>();
    for (const e of (espacios ?? []) as Array<{ id: string; nombre: string }>) {
      if (!e?.id) continue;
      mapa.set(e.id, { nombre: e.nombre });
    }
    return mapa;
  }, [espacios]);

  const salasConMesas = useMemo(() => {
    const set = new Set<string>();
    for (const m of mesas ?? []) {
      if (m?.espacio_id) set.add(m.espacio_id);
    }
    return set;
  }, [mesas]);

  /**
   * Reservas del turno elegido, con lo justo para agrupar por sala.
   *
   * `turno` y `grado` se cogen TAL CUAL de la fila: los calcula la vista en SQL
   * y el hook ya los ha saneado. Volver a derivarlos aquí sería una segunda
   * regla que podría discrepar de la base de datos.
   *
   * El nombre de la sala sí tiene respaldo local (`espaciosPorId`) porque es
   * solo una etiqueta: si la vista lo trae vacío, enseñar "Sala sin nombre"
   * teniendo el nombre a mano en caché no ayuda a nadie.
   */
  const filasFiltradas = useMemo<FilaResumenEspacio[]>(() => {
    return filas.filter((f) => turno === "todos" || f.turno === turno).map(aFilaResumen(espaciosPorId));
  }, [filas, turno, espaciosPorId]);

  // Salas privadas (el Reservado): FUERA DE AFORO. Su tarjeta sale en el reparto (con su etiqueta),
  // pero sus reservas no entran en las cifras de la cabecera ni en la ocupación, igual que en la casilla.
  const privadas = useMemo(() => new Set(idsSalasPrivadasActivas(espacios as Array<{ id?: string }> | undefined)), [espacios]);
  const filasAforo = useMemo(
    () => filasFiltradas.filter((f) => !estaFueraDeAforo(f, privadas)),
    [filasFiltradas, privadas],
  );

  const resumen = useMemo(() => resumenDia(filasAforo), [filasAforo]);
  const { porEspacio, sinSala } = useMemo(() => resumenPorEspacio(filasFiltradas), [filasFiltradas]);

  // Las CIFRAS DE LA CABECERA (comensales, reservas, con mesa) son las de las
  // mismas filas, todas de Casa Tomás (el hook descarta las de otro negocio), así
  // que coinciden siempre con las salas de debajo. Con la casilla del mes
  // coinciden mientras la marca de cada reserva sea la de su sala: la casilla
  // filtra por `reservas.marca` y la vista da la de la SALA (ver la cabecera de
  // este fichero y la de `useResumenAsignacionDia`).
  const comensales = useMemo(
    () => filasAforo.reduce((s, f) => s + (Number(f.numero_comensales) || 0), 0),
    [filasAforo],
  );

  // Ocupación del día por turno: con TODAS las filas (el filtro de turno no la
  // recorta, enseña siempre comida y cena) y contra el aforo de Casa Tomás.
  // Hasta que no llegan los espacios no se sabe el aforo, y enseñar "aforo sin
  // configurar" un instante sería mentira.
  const aforo = useMemo(() => aforoCasaTomas(espacios), [espacios]);
  const ocupacion = useMemo(
    () =>
      ocupacionPorTurno(
        filas
          .filter((f) => !estaFueraDeAforo(f, privadas))
          .map((f) => ({ marca: f.marca, turno: f.turno, comensales: f.numero_comensales })),
        aforo,
      ),
    [filas, aforo, privadas],
  );
  // Un día pasado no se mide contra el aforo: ya ocurrió.
  const esPasado = fechaISO < fechaMadrid(Date.now());
  const mostrarOcupacion = !esPasado && Array.isArray(espacios) && ocupacion.reservas > 0;

  // ¿Hay algo en el otro turno? Evita que un "no hay reservas" engañe cuando en
  // realidad lo que pasa es que el filtro está puesto en Comida.
  const hayEnOtroTurno = turno !== "todos" && filas.length > filasFiltradas.length;

  /**
   * Salta al plano de la sala. La fecha (y el turno, si hay uno filtrado) se
   * escriben en la URL ANTES de avisar al padre, porque `onEspacioClick` solo
   * lleva el id del espacio y `PlanoEspacio2D` lee esos parámetros al montarse.
   */
  const irAlPlano = (espacioId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("fecha", fechaISO);
    if (turno === "todos") params.delete("turno");
    else params.set("turno", turno);
    setSearchParams(params, { replace: true });
    onEspacioClick?.(espacioId);
  };

  return (
    // `flex-1 min-h-0`: el padre (`CardContent`) es una columna flex con el alto
    // acotado, y sin esto este bloque se quedaría del alto de su contenido. Su
    // hijo desplazable calcula el `flex-1` sobre ESTE alto, así que sin los dos
    // el contenido no se desplazaría: se CORTARÍA contra el `overflow-hidden`
    // de la tarjeta.
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="panel-dia">
      {/* Cabecera: qué día es, el filtro de turno y el resumen del turno */}
      <div className="flex-shrink-0 space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <h4 className="min-w-0 truncate font-semibold capitalize">
            {format(fecha, "EEEE, d 'de' MMMM", { locale: es })}
          </h4>
        </div>

        <ToggleGroup
          type="single"
          value={turno}
          // Radix devuelve "" al pulsar el que ya está activo: eso no debe
          // dejar el filtro en un valor que no existe.
          onValueChange={(v) => setTurno(v === "comida" || v === "cena" ? v : "todos")}
          className="justify-start"
          aria-label="Filtrar por turno"
        >
          {(["todos", "comida", "cena"] as FiltroTurno[]).map((t) => (
            <ToggleGroupItem key={t} value={t} className="h-7 px-2 text-xs">
              {ETIQUETA_TURNO[t]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/* Ni cifras ni porcentajes mientras no se sepa: cargando y error tienen
            su propia frase, y el recuento solo aparece cuando es de verdad. */}
        {isError ? (
          <p className="text-xs text-muted-foreground">El reparto de este día no se ha podido leer.</p>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground">Leyendo el reparto del día…</p>
        ) : (
          <div className="space-y-2">
            <div>
              {/* Los COMENSALES, protagonistas. Sin `tabular-nums`: es un número
                  grande suelto, no una columna. */}
              <p className="flex items-baseline gap-1.5">
                <span
                  data-testid="comensales-dia"
                  className="text-3xl font-semibold leading-none"
                >
                  {comensales}
                </span>
                {/* El espacio de texto no se ve (es un flex con `gap`) pero hace que el
                    lector de pantalla y el texto copiado digan «35 comensales». */}{" "}
                <span className="text-sm text-muted-foreground">{comensales === 1 ? "comensal" : "comensales"}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="whitespace-nowrap tabular-nums">
                  {plural(resumen.total, "reserva", "reservas")}
                </span>
                {resumen.total > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="whitespace-nowrap tabular-nums">
                      {resumen.conMesa} de {resumen.total} con mesa
                    </span>
                  </>
                )}
              </p>
            </div>
            {mostrarOcupacion && <OcupacionDelDia turnos={ocupacion.turnos} aforo={aforo} />}
          </div>
        )}
      </div>

      {/* Cuerpo desplazable. `min-h-0` es lo que impide que el contenido empuje
          la tarjeta y se salga: sin él `overflow-y-auto` no recorta nada. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {isError ? (
          <BloqueErrorDia
            error={error}
            reintentando={isFetching}
            onReintentar={() => {
              void refetch();
            }}
          />
        ) : isLoading ? (
          <EsqueletoDia />
        ) : filasFiltradas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {hayEnOtroTurno
              ? `No hay reservas en el turno de ${ETIQUETA_TURNO[turno].toLowerCase()}.`
              : "No hay reservas para este día"}
          </p>
        ) : (
          <>
            {/* Grado 1 pendiente: ni han empezado a repartirse. Va ARRIBA y
                aparte porque es el trabajo que toca antes que nada. */}
            {sinSala.total > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                <div className="flex min-w-0 items-center gap-1.5">
                  <LayoutGrid
                    className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium text-amber-900 dark:text-amber-100">
                    Sin sala
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-800 dark:text-amber-200">
                  <span className="whitespace-nowrap tabular-nums">
                    {plural(sinSala.total, "reserva", "reservas")}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="whitespace-nowrap tabular-nums">
                    {plural(sinSala.comensales, "comensal", "comensales")}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-200">
                  Todavía no se han repartido por sala. Se hace en la pestaña Hoy,
                  arrastrando sus tarjetas o con ⋮ → «Mover a…».
                </p>
              </div>
            )}

            {porEspacio.map((grupo) => {
              const id = grupo.espacio_id as string;
              return (
                <TarjetaSala
                  key={id}
                  grupo={grupo}
                  tieneMesas={salasConMesas.has(id)}
                  onIr={irAlPlano}
                  fueraDeAforo={privadas.has(id)}
                />
              );
            })}
          </>
        )}

        <div className="space-y-3 border-t pt-3">
          <DisponibilidadCuartos fecha={fechaISO} compacto />
        </div>
      </div>
    </div>
  );
}
