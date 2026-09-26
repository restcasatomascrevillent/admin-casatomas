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
// DE DÓNDE SALEN LOS DATOS (y por qué hay respaldo)
// ---------------------------------------------------------------------------
// La fuente buena es `useResumenAsignacionDia`, que lee la vista
// `vista_asignacion_dia` y trae los tres grados ya contados en SQL. Pero esa
// vista TODAVÍA NO ESTÁ CREADA en la base de datos (2026-09-26), así que hoy
// la consulta falla con 42P01.
//
// Para que el panel no se quede en blanco mientras eso no llegue, acepta un
// RESPALDO (`filasRespaldo`) con las reservas del día que el calendario ya ha
// traído para pintar la cuadrícula. Con el respaldo se puede medir el GRADO 1
// entero (qué hay en cada sala y qué sigue sin sala), que es justo lo que pidió
// el dueño; lo único que no se puede saber es el grado 2, y eso se dice en
// pantalla en vez de pintar "0 con mesa" y hacer creer que nadie tiene mesa.
// Cuando la vista exista, el respaldo deja de usarse solo, sin tocar código.
//
// ---------------------------------------------------------------------------
// SALAS SIN MESAS EN EL PLANO
// ---------------------------------------------------------------------------
// Caso real de producción (2026-09-26): de 7 espacios solo 3 tienen mesas
// (Comedor 2, Salón 15, Terraza 3, todas de Casa Tomás). En las otras 4 el
// grado 2 es IMPOSIBLE. Ahí no se pinta "0 %" -que dejaría al encargado
// buscando mesas que no existen- sino el aviso de que la sala no tiene mesas
// en el plano, y el salto sigue activo porque es donde se crean.
// ============================================================================

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Armchair, CalendarIcon, ChevronRight, Info, LayoutGrid, Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useMesas } from "@/hooks/useMesas";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useResumenAsignacionDia } from "@/hooks/useResumenAsignacionDia";
import { marcaDeEspacio } from "@/lib/reservas/negocios";
import {
  esTurno,
  gradoDeReserva,
  resumenDia,
  resumenPorEspacio,
  turnoDeHora,
  type FilaResumenEspacio,
  type ResumenEspacio,
  type Turno,
} from "@/lib/reservas/asignacionMesas";
import { NegocioBadge } from "./NegocioBadge";

// ── Contrato de entrada ──────────────────────────────────────────────────────
//
// Una fila por reserva no cancelada del día. Los nombres son los de
// `vista_asignacion_dia` / `FilaAsignacionDia`, así que las filas del hook
// encajan aquí tal cual; todo lo que el respaldo no puede saber es opcional.
export type FilaDiaEspacios = {
  reserva_id: string;
  hora: string;
  numero_comensales?: number | null;
  espacio_id: string | null;
  espacio_nombre?: string | null;
  /** Cuántas mesas tiene asignadas. 0 = pendiente de mesa (estado normal). */
  mesas_asignadas?: number | null;
  /** Lo trae la vista; si falta se deriva de `hora` con el corte de las 17:00. */
  turno?: string | null;
};

export interface DetalleDiaEspaciosProps {
  /** Día que se está mirando. */
  fecha: Date;
  /**
   * Reservas no canceladas de ese día que ya tiene el calendario. Se usan
   * cuando `vista_asignacion_dia` no responde (ver cabecera).
   */
  filasRespaldo?: readonly FilaDiaEspacios[];
  /** El calendario todavía está trayendo sus reservas. */
  cargandoRespaldo?: boolean;
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

/** En qué situación está el conocimiento del GRADO 2 (mesa) en este render. */
type EstadoDetalleMesa = "cargando" | "disponible" | "no_disponible";

function plural(n: number, singular: string, plural_: string) {
  return `${n} ${n === 1 ? singular : plural_}`;
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

// ── Tarjeta de una sala ──────────────────────────────────────────────────────
//
// Toda la tarjeta es el botón que salta al plano: así la acción está SIEMPRE en
// el mismo sitio y no baila entre filas según lo que tenga cada sala. El
// chevron de la derecha es solo la pista visual, y va en la cabecera -no al
// final del bloque- para que no se mueva cuando una sala tiene más texto que
// otra.
function TarjetaSala({
  grupo,
  marca,
  tieneMesas,
  estadoMesa,
  onIr,
}: {
  grupo: ResumenEspacio;
  marca: string | null;
  /** ¿La sala tiene alguna mesa activa en el plano? Si no, el grado 2 es imposible. */
  tieneMesas: boolean;
  estadoMesa: EstadoDetalleMesa;
  onIr: (espacioId: string) => void;
}) {
  const espacioId = grupo.espacio_id as string;
  // Solo se puede hablar de cierre a nivel de mesa si la sala tiene mesas Y se
  // han podido leer las asignaciones.
  const mideCierre = tieneMesas && estadoMesa === "disponible";
  const cerrada = mideCierre && grupo.conMesa === grupo.total;

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
          <NegocioBadge corta marca={marca} className="shrink-0" />
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
      ) : estadoMesa === "no_disponible" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          El detalle de mesa no está disponible: solo se ve el reparto por sala.
        </p>
      ) : estadoMesa === "cargando" ? (
        // Ni cifras ni barra mientras no se sepa: una barra a 0 % que luego
        // salta a 80 % es peor que no pintar nada durante un instante.
        <p className="mt-2 text-xs text-muted-foreground">Comprobando las mesas…</p>
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
              // normal de una reserva, no algo que avisar en ámbar.
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

export function DetalleDiaEspacios({
  fecha,
  filasRespaldo = [],
  cargandoRespaldo = false,
  onEspacioClick,
}: DetalleDiaEspaciosProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [turno, setTurno] = useState<FiltroTurno>("todos");

  const fechaISO = format(fecha, "yyyy-MM-dd");

  // El turno NO se le pasa al hook aunque lo acepte: filtrando en cliente el
  // botón responde al instante (sin ir al servidor por cada cambio) y además se
  // puede saber si el otro turno tiene reservas, que es lo que evita el
  // "no hay reservas" engañoso cuando el filtro está puesto.
  const vista = useResumenAsignacionDia(fechaISO);

  // Solo lectura y compartidas con media app: react-query las sirve de caché.
  const { data: espacios } = useEspaciosReserva();
  // Mesas ACTIVAS de todas las salas: una sala cuyas mesas están todas
  // desactivadas está, para asignar, igual que una sala sin mesas.
  const { data: mesas } = useMesas();

  // ── Qué filas se usan y qué se sabe del grado 2 ────────────────────────────
  const { filas, estadoMesa, cargando } = useMemo(() => {
    const respaldo = filasRespaldo ?? [];
    if (vista.isError) {
      return { filas: respaldo as readonly FilaDiaEspacios[], estadoMesa: "no_disponible" as const, cargando: cargandoRespaldo };
    }
    if (vista.isLoading) {
      // Se pinta ya el grado 1 con el respaldo en vez de un spinner: las
      // cifras de reservas y comensales son las mismas por las dos vías, así
      // que lo único que cambia al llegar la vista es que aparecen las mesas.
      return { filas: respaldo as readonly FilaDiaEspacios[], estadoMesa: "cargando" as const, cargando: cargandoRespaldo };
    }
    // Guarda contra dejar el panel en blanco: si la vista responde vacía pero
    // el calendario sí tiene reservas de ese día, manda el calendario (la vista
    // puede ir por detrás o filtrar de otra forma) y se dice que no hay mesa.
    if (vista.filas.length === 0 && respaldo.length > 0) {
      return { filas: respaldo as readonly FilaDiaEspacios[], estadoMesa: "no_disponible" as const, cargando: false };
    }
    return { filas: vista.filas as readonly FilaDiaEspacios[], estadoMesa: "disponible" as const, cargando: false };
  }, [vista.isError, vista.isLoading, vista.filas, filasRespaldo, cargandoRespaldo]);

  const espaciosPorId = useMemo(() => {
    const mapa = new Map<string, { nombre: string; marca: string }>();
    for (const e of (espacios ?? []) as Array<{ id: string; nombre: string }>) {
      if (!e?.id) continue;
      mapa.set(e.id, { nombre: e.nombre, marca: marcaDeEspacio(e) });
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

  /** Reservas del turno elegido, ya con grado y nombre de sala resueltos. */
  const filasFiltradas = useMemo<FilaResumenEspacio[]>(() => {
    return filas
      .filter((f) => {
        if (turno === "todos") return true;
        const suyo = esTurno(f.turno) ? f.turno : turnoDeHora(f.hora);
        return suyo === turno;
      })
      .map((f) => ({
        grado: gradoDeReserva({
          espacio_id: f.espacio_id,
          // Sin detalle de mesa fiable no se puede afirmar "con_mesa": cuenta
          // como `sin_mesa` y el aviso de la tarjeta explica por qué.
          mesas_asignadas: estadoMesa === "disponible" ? Number(f.mesas_asignadas ?? 0) : 0,
        }),
        espacio_id: f.espacio_id,
        espacio_nombre:
          f.espacio_nombre ??
          (f.espacio_id ? espaciosPorId.get(f.espacio_id)?.nombre : null) ??
          null,
        numero_comensales: f.numero_comensales,
      }));
  }, [filas, turno, estadoMesa, espaciosPorId]);

  const resumen = useMemo(() => resumenDia(filasFiltradas), [filasFiltradas]);
  const { porEspacio, sinSala } = useMemo(() => resumenPorEspacio(filasFiltradas), [filasFiltradas]);
  const comensales = useMemo(
    () => filasFiltradas.reduce((s, f) => s + (Number(f.numero_comensales) || 0), 0),
    [filasFiltradas],
  );

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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="whitespace-nowrap tabular-nums">
            {plural(resumen.total, "reserva", "reservas")}
          </span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap tabular-nums">
            {plural(comensales, "comensal", "comensales")}
          </span>
          {estadoMesa === "disponible" && resumen.total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap tabular-nums">
                {resumen.conMesa} de {resumen.total} con mesa
              </span>
            </>
          )}
        </div>
      </div>

      {/* Cuerpo desplazable. `min-h-0` es lo que impide que el contenido empuje
          la tarjeta y se salga: sin él `overflow-y-auto` no recorta nada. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {cargando ? (
          <div className="flex justify-center py-8">
            <Loader2
              className="h-6 w-6 animate-spin text-muted-foreground"
              aria-label="Cargando el reparto del día"
            />
          </div>
        ) : resumen.total === 0 ? (
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
                  Todavía no se han repartido por sala. Se hace arrastrando sus
                  tarjetas en la pestaña Hoy.
                </p>
              </div>
            )}

            {porEspacio.map((grupo) => {
              const id = grupo.espacio_id as string;
              return (
                <TarjetaSala
                  key={id}
                  grupo={grupo}
                  marca={espaciosPorId.get(id)?.marca ?? null}
                  tieneMesas={salasConMesas.has(id)}
                  estadoMesa={estadoMesa}
                  onIr={irAlPlano}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
