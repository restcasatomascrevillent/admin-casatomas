import { useId, useMemo, type ReactNode } from "react";
import { AlertTriangle, Check, Lightbulb, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import {
  calcularOcupacionSalas,
  ETIQUETA_NIVEL,
  ETIQUETA_ORIGEN_FRANJA,
  ETIQUETA_TURNO,
  horaCorta,
  MOTIVO_ORIGEN_FRANJA,
  recomendarUbicacion,
  TURNOS,
  type CeldaTurno,
  type FilaSala,
  type NivelOcupacion,
  type OcupacionSalasDia,
  type OrigenFranja,
  type Turno,
} from "@/lib/reservas/ocupacionSalas";
import { fechaLegible } from "@/lib/reservas/solicitudPropuesta";

// ============================================================================
// "Ocupación de salas": rejilla salas × franjas de un día para decidir dónde
// y a qué hora cabe un grupo. La lógica está en `lib/reservas/ocupacionSalas`
// (ver su cabecera: cómo se cuenta y por qué coincide con el trigger).
// Se usa en el diálogo de solicitudes del bot y en FormularioReserva.
//
// Una sola rejilla, la de las salas de Casa Tomás con SU aforo por turno, igual
// que el trigger. Touza no admite reservas (decisión del dueño, 2026-10-01): sus
// salas y reservas ya llegan descartadas de `useOcupacionSalasDia`.
//
// POR QUÉ ESTÁ CADA COLUMNA (2026-09-28). El dueño preguntó "no sé por qué
// salen 15:30 y no a las y media": unas horas llevan media y otras no, y eso
// parecía arbitrario. No lo es, pero la rejilla no lo enseñaba. Una columna
// puede venir de tres sitios (`origenFranja` en `lib/reservas/ocupacionSalas`):
// la ofrece el motor ese día ("turno", según la escalera de
// `configuracion_turnos`), ya hay una reserva a esa hora aunque el motor no la
// ofrezca ("reserva"), o es la hora que se está proponiendo ("propuesta").
// Las dos últimas se marcan en cursiva, con subrayado a trazos y un asterisco
// —nunca solo con color—, con su motivo en el `title`, en la leyenda, en el
// `<caption>` y en el `aria-label` de cada celda. Las columnas son las MISMAS
// de siempre: lo único que cambia es que ahora se ve de dónde sale cada una.
// ============================================================================

/**
 * Marca sobria de una columna que el motor NO ofrece ese día (origen
 * "reserva" o "propuesta"). Cursiva + subrayado a trazos + asterisco: tres
 * pistas que no dependen del color.
 */
const CLASES_FRANJA_FUERA = "italic border-b border-dashed border-muted-foreground/60";

/** Coletilla corta para `title`/`aria-label` de las celdas de esa columna. */
const notaOrigen = (origen: OrigenFranja) =>
  origen === "turno" ? "" : ` ${ETIQUETA_ORIGEN_FRANJA[origen]}: el sistema no ofrece esa hora ese día.`;

const CLASES_NIVEL: Record<NivelOcupacion, string> = {
  libre: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  justo: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  lleno: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

const PUNTO_NIVEL: Record<NivelOcupacion, string> = {
  libre: "bg-emerald-500",
  justo: "bg-amber-500",
  lleno: "bg-red-500",
};

export interface OcupacionSalasProps {
  /** "yyyy-MM-dd" */
  fecha: string | null;
  comensales: number;
  hora: string | null;
  espacioId: string | null;
  /** Si se pasa, cada celda es un botón que fija sala + hora. */
  onSeleccionar?: (espacioId: string | null, hora: string) => void;
  excluirReservaId?: string | null;
  className?: string;
}

export function OcupacionSalas({
  fecha,
  comensales,
  hora,
  espacioId,
  onSeleccionar,
  excluirReservaId,
  className,
}: OcupacionSalasProps) {
  const { data, isLoading, error, refetch, isFetching } = useOcupacionSalasDia(fecha);

  const ocupacion = useMemo<OcupacionSalasDia | null>(() => {
    if (!data) return null;
    return calcularOcupacionSalas({
      espacios: data.espacios,
      reservas: data.reservas,
      horasBase: data.horasBase,
      horasExtra: [hora],
      comensales,
      excluirReservaId,
    });
  }, [data, hora, comensales, excluirReservaId]);

  const recomendacion = useMemo(
    () => (ocupacion ? recomendarUbicacion(ocupacion, { espacioId, hora }) : null),
    [ocupacion, espacioId, hora],
  );

  // ¿Hay alguna columna que el motor no ofrezca ese día? Solo entonces tiene
  // sentido explicar el asterisco (leyenda, pie y `<caption>`).
  const hayFueraDeRejilla = useMemo(
    () => !!ocupacion && Object.values(ocupacion.origenFranja).some((o) => o !== "turno"),
    [ocupacion],
  );

  const horaSel = horaCorta(hora);
  const idTitulo = useId();

  return (
    <section aria-labelledby={idTitulo} className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h3 id={idTitulo} className="text-sm font-semibold">
            Ocupación de salas
          </h3>
          <p className="text-xs text-muted-foreground">
            {fecha ? fechaLegible(fecha) : "Sin día elegido"}
            {comensales > 0 && <> · para {comensales} pers.</>}
            {isFetching && !isLoading && <span className="ml-1">· actualizando…</span>}
          </p>
        </div>
        <Leyenda marcaFueraDeRejilla={hayFueraDeRejilla} />
      </div>

      {!fecha ? (
        <EstadoVacio>Elige un día para ver la ocupación de cada sala.</EstadoVacio>
      ) : isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando ocupación">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            No se pudo cargar la ocupación de ese día.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
            Reintentar
          </Button>
        </div>
      ) : !ocupacion || (ocupacion.salas.length === 0 && !ocupacion.sinAsignar) ? (
        <EstadoVacio>No hay salas activas configuradas.</EstadoVacio>
      ) : (
        <>
          {recomendacion && (
            <div
              role="status"
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm",
                recomendacion.tipo === "cabe" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
                recomendacion.tipo === "sugerencia" && "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
                recomendacion.tipo === "sin_hueco" && "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
              )}
            >
              {recomendacion.tipo === "cabe" ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden />
              ) : recomendacion.tipo === "sugerencia" ? (
                <Lightbulb className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1">{recomendacion.texto}</span>
              {recomendacion.tipo === "sugerencia" && onSeleccionar && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 bg-background text-xs"
                  onClick={() => onSeleccionar(recomendacion.espacioId, recomendacion.hora)}
                >
                  Usar esta opción
                </Button>
              )}
            </div>
          )}

          <TablaSalas
            ocupacion={ocupacion}
            cerrado={!!data?.cerrado}
            hayFueraDeRejilla={hayFueraDeRejilla}
            horaSel={horaSel}
            espacioSel={espacioId}
            onSeleccionar={onSeleccionar}
          />
          <p className="text-[11px] text-muted-foreground">
            Las columnas son las horas que el sistema ofrece ese día —con el turno vacío, solo las horas en punto; a
            medida que se llena, se abren las y media y después los cuartos—, más las horas que ya tienen alguna
            reserva y la hora que estés proponiendo.
            {hayFueraDeRejilla && (
              <>
                {" "}
                Estas dos últimas se marcan con <span className={cn(CLASES_FRANJA_FUERA)}>hora*</span>: no las ofrece
                el sistema ese día, salen porque ya hay una reserva a esa hora (sus comensales cuentan en el aforo del
                turno, así que tienes que ver dónde están sentados) o porque es la hora que estás proponiendo.
              </>
            )}
          </p>
          {onSeleccionar && (
            <p className="text-[11px] text-muted-foreground">
              Pulsa una hora de una sala para proponerla. El aforo se cuenta por turno (corte a las 17:00), igual
              que la base de datos.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function TablaSalas({
  ocupacion,
  cerrado,
  hayFueraDeRejilla,
  horaSel,
  espacioSel,
  onSeleccionar,
}: {
  ocupacion: OcupacionSalasDia;
  /** Ese día no hay turnos configurados. */
  cerrado: boolean;
  /** Alguna columna no la ofrece el motor ese día. */
  hayFueraDeRejilla: boolean;
  horaSel: string | null;
  espacioSel: string | null;
  onSeleccionar?: (espacioId: string | null, hora: string) => void;
}) {
  const sinFranjas = ocupacion.franjas.comida.length + ocupacion.franjas.cena.length === 0;

  return (
    <div className="space-y-1.5">
      {sinFranjas ? (
        <EstadoVacio>
          {cerrado
            ? "Ese día no hay turnos configurados (cerrado). Puedes indicar una hora personalizada."
            : "No hay franjas horarias para ese día."}
        </EstadoVacio>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-xs tabular-nums">
            <caption className="sr-only">
              Comensales por sala y franja horaria. Cada turno muestra ocupadas sobre capacidad; cada hora, los
              comensales ya reservados a esa hora
              {ocupacion.comensales > 0 ? ` y si caben ${ocupacion.comensales} más` : ""}.
              {hayFueraDeRejilla &&
                " Las horas marcadas con asterisco no las ofrece el sistema ese día: salen porque ya hay una reserva a esa hora o porque es la hora que estás proponiendo."}
            </caption>
            <thead>
              <tr className="bg-muted/50">
                <th scope="col" rowSpan={2} className="sticky left-0 z-10 bg-muted px-2 py-1.5 text-left font-medium">
                  Sala
                </th>
                {TURNOS.filter((t) => ocupacion.franjas[t].length > 0).map((t) => (
                  <th
                    key={t}
                    scope="colgroup"
                    colSpan={ocupacion.franjas[t].length + 1}
                    className="border-l px-2 py-1.5 text-left font-medium"
                  >
                    <span>{ETIQUETA_TURNO[t]}</span>
                    <AforoTurno ocupacion={ocupacion} turno={t} />
                  </th>
                ))}
              </tr>
              <tr className="bg-muted/30 text-muted-foreground">
                {TURNOS.filter((t) => ocupacion.franjas[t].length > 0).map((t) => [
                  <th key={`${t}-turno`} scope="col" className="border-l px-2 py-1 text-left font-normal">
                    Turno
                  </th>,
                  ...ocupacion.franjas[t].map((h) => {
                    const origen = ocupacion.origenFranja[h] ?? "turno";
                    const fuera = origen !== "turno";
                    return (
                      <th
                        key={`${t}-${h}`}
                        scope="col"
                        className={cn(
                          "px-1 py-1 text-center font-normal",
                          h === horaSel && "font-semibold text-foreground",
                        )}
                        title={fuera ? `${h} · ${ETIQUETA_ORIGEN_FRANJA[origen]}. ${MOTIVO_ORIGEN_FRANJA[origen]}` : undefined}
                      >
                        <span className={cn("inline-block", fuera && CLASES_FRANJA_FUERA)}>
                          {h}
                          {fuera && <span aria-hidden>*</span>}
                        </span>
                        {/* Corto a propósito: el lector de pantalla repite la cabecera en cada celda. */}
                        {fuera && <span className="sr-only"> ({ETIQUETA_ORIGEN_FRANJA[origen]})</span>}
                      </th>
                    );
                  }),
                ])}
              </tr>
            </thead>
            <tbody>
              {[...ocupacion.salas, ...(ocupacion.sinAsignar ? [ocupacion.sinAsignar] : [])].map((sala) => (
                <FilaRejilla
                  key={sala.espacioId ?? "sin-asignar"}
                  sala={sala}
                  ocupacion={ocupacion}
                  horaSel={horaSel}
                  espacioSel={espacioSel}
                  onSeleccionar={onSeleccionar}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EstadoVacio({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>;
}

function Leyenda({ marcaFueraDeRejilla }: { marcaFueraDeRejilla: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Leyenda">
      {(Object.keys(ETIQUETA_NIVEL) as NivelOcupacion[]).map((n) => (
        <li key={n} className="flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", PUNTO_NIVEL[n])} aria-hidden />
          {ETIQUETA_NIVEL[n]}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <Check className="h-3 w-3 text-emerald-600" aria-hidden /> cabe
      </li>
      <li className="flex items-center gap-1">
        <X className="h-3 w-3 text-red-600" aria-hidden /> no cabe
      </li>
      {marcaFueraDeRejilla && (
        <li className="flex items-center gap-1">
          <span className={cn(CLASES_FRANJA_FUERA)} aria-hidden>
            hora*
          </span>
          hora que el sistema no ofrece ese día (ya hay una reserva a esa hora, o es la que estás proponiendo)
        </li>
      )}
    </ul>
  );
}

function AforoTurno({ ocupacion, turno }: { ocupacion: OcupacionSalasDia; turno: Turno }) {
  const a = ocupacion.aforo[turno];
  return (
    <span
      className={cn(
        "ml-2 rounded px-1.5 py-0.5 text-[11px] font-normal",
        a.cabe ? "bg-background text-muted-foreground" : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
      )}
      title="Aforo total del turno: es lo que valida la base de datos al crear la reserva"
    >
      aforo {a.ocupados}/{a.capacidad}
      {!a.cabe && " · completo"}
    </span>
  );
}

function CeldaTurnoView({ celda }: { celda: CeldaTurno }) {
  if (celda.capacidad == null) {
    return <span className="text-muted-foreground">{celda.ocupados} pax</span>;
  }
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="font-medium">
        {celda.ocupados}/{celda.capacidad}
      </span>
      <span className="text-[10px] opacity-80">{ETIQUETA_NIVEL[celda.nivel]}</span>
    </span>
  );
}

function FilaRejilla({
  sala,
  ocupacion,
  horaSel,
  espacioSel,
  onSeleccionar,
}: {
  sala: FilaSala;
  ocupacion: OcupacionSalasDia;
  horaSel: string | null;
  espacioSel: string | null;
  onSeleccionar?: (espacioId: string | null, hora: string) => void;
}) {
  const esSinAsignar = sala.espacioId === null;
  return (
    <tr className="border-t">
      <th scope="row" className="sticky left-0 z-10 bg-background px-2 py-1.5 text-left font-medium">
        <span className={cn("block whitespace-nowrap", esSinAsignar && "italic text-muted-foreground")}>
          {sala.nombre}
        </span>
        {sala.capacidad != null && (
          <span className="block text-[10px] font-normal text-muted-foreground">{sala.capacidad} plazas</span>
        )}
      </th>
      {TURNOS.filter((t) => ocupacion.franjas[t].length > 0).map((t) => {
        const celda = sala.turnos[t];
        // Cabe de verdad = cabe en la sala Y el turno tiene aforo (si no, la BD lo rechaza).
        const cabe = celda.cabe && ocupacion.aforo[t].cabe;
        return [
          <td
            key={`${t}-turno`}
            className={cn("border-l px-2 py-1.5", sala.capacidad != null && CLASES_NIVEL[celda.nivel])}
          >
            <CeldaTurnoView celda={celda} />
          </td>,
          ...ocupacion.franjas[t].map((h) => {
            const enHora = sala.porHora[h];
            const seleccionada = h === horaSel && (espacioSel ?? null) === sala.espacioId;
            const origen = ocupacion.origenFranja[h] ?? "turno";
            const descripcion = `${sala.nombre}, ${h}: ${enHora?.pax ?? 0} comensales reservados a esa hora; turno de ${t} ${celda.ocupados}${celda.capacidad != null ? `/${celda.capacidad}` : ""}. ${cabe ? `Caben ${ocupacion.comensales} más.` : `No caben ${ocupacion.comensales} más.`}${notaOrigen(origen)}`;
            const contenido = (
              <>
                <span>{enHora?.pax ? enHora.pax : "·"}</span>
                {ocupacion.comensales > 0 &&
                  (cabe ? (
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  ) : (
                    <X className="h-3 w-3 text-red-600 dark:text-red-400" aria-hidden />
                  ))}
              </>
            );
            const clases = cn(
              "flex h-8 w-full min-w-[3rem] items-center justify-center gap-1 rounded border text-xs",
              onSeleccionar && "pointer-coarse:h-11 pointer-coarse:min-w-[3.25rem] pointer-coarse:text-sm",
              cabe
                ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
                : "border-red-200 bg-red-50/60 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
              seleccionada && "ring-2 ring-primary ring-offset-1 ring-offset-background font-semibold",
            );
            return (
              <td key={`${t}-${h}`} className="px-0.5 py-1">
                {onSeleccionar ? (
                  <button
                    type="button"
                    className={cn(clases, "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                    aria-pressed={seleccionada}
                    aria-label={`${descripcion} Pulsa para proponer ${sala.nombre} a las ${h}.`}
                    title={descripcion}
                    onClick={() => onSeleccionar(sala.espacioId, h)}
                  >
                    {contenido}
                  </button>
                ) : (
                  <div className={clases} title={descripcion}>
                    <span className="sr-only">{descripcion}</span>
                    <span aria-hidden className="flex items-center gap-1">
                      {contenido}
                    </span>
                  </div>
                )}
              </td>
            );
          }),
        ];
      })}
    </tr>
  );
}
