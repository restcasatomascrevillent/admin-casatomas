import { useId, useMemo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import { useConfiguracionTurnos } from "@/hooks/useConfiguracionTurnos";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { configServicioSalaDesde } from "@/lib/reservas/servicioSala";
import { fechaLegible } from "@/lib/reservas/solicitudPropuesta";
import { capacidadDeAforo, reservasQueConsumenAforo } from "@/lib/reservas/salaPrivada";
import {
  ETIQUETA_NIVEL,
  ETIQUETA_TURNO,
  horaCorta,
  TURNOS,
  type NivelOcupacion,
  type Turno,
} from "@/lib/reservas/ocupacionSalas";
import { estiloNivel, nivelDeOcupacion } from "@/lib/reservas/ocupacionCalendario";
import {
  construirRejillaCuartos,
  periodosDelDia,
  type FranjaCuarto,
  type RejillaCuartos,
} from "@/lib/reservas/rejillaCuartos";

// ============================================================================
// "Disponibilidad por cuartos de hora": vista INTERNA del turno de 15 en 15
// minutos (decisión del dueño 2026-09-29, reservas-sin-salas). El cliente
// reserva una hora, no una sala; esto es para que el personal vea cuándo
// llega la gente y cuánta hay sentada a cada momento. Nunca va en las webs.
//
// La lógica está en `lib/reservas/rejillaCuartos.ts` (ver su cabecera). Los
// datos son los de `useOcupacionSalasDia` (reservas y espacios del día, misma
// clave de caché y mismo realtime que la rejilla de salas), los periodos de
// `useConfiguracionTurnos` y la estancia de `useConfiguracionReservas`: dos
// consultas de configuración que ya comparte el resto del panel.
//
// Se usa en: ModalVerificacionReserva, SolicitudGestionPanel,
// FormularioReserva, VistaHoy (plegable) y DetalleDiaEspacios.
//
// Una sola rejilla, la de Casa Tomás: Touza no admite reservas (decisión del
// dueño, 2026-10-01) y sus datos ya llegan descartados de `useOcupacionSalasDia`.
//
// DOS FORMAS DE PINTARLA (mismos datos, misma cuenta):
//   · TABLA (por defecto): una columna por cuarto, filas «Llegan» y «En sala».
//     Donde cabe a lo ancho (Hoy en escritorio, diálogos) es la más densa y deja
//     elegir la hora pulsando su cabecera.
//   · BALDOSAS (`baldosas`, solo el panel del día del Calendario, 2026-10-06):
//     el panel es una columna estrecha y se gestiona desde una tablet; la tabla
//     no cabía y cada turno tenía su propia barra de scroll horizontal, con letra
//     de 12 px. Las baldosas se reparten en filas según el ancho (sin scroll
//     lateral): en cada una la hora, los comensales EN SALA en grande, teñidos
//     con la MISMA escala que las casillas del mes (`UMBRALES_OCUPACION`, azul;
//     el ámbar del Calendario es «sin sala» y el rojo no se usa), y «+N llegan»
//     solo si llega alguien. Solo consulta: no eligen hora.
// ============================================================================

export interface OpcionesRejillaCuartos {
  /** "yyyy-MM-dd" */
  fecha: string | null | undefined;
  /** Tamaño del grupo que se quiere colocar (se prueba en el aforo de su turno). */
  comensales?: number | null;
  /** Hora elegida ahora mismo (se marca en la rejilla). */
  hora?: string | null;
  /** Al editar una reserva: no contarla contra sí misma. */
  excluirReservaId?: string | null;
  enabled?: boolean;
}

/**
 * La rejilla calculada, para quien necesite las horas sin pintarlas (p. ej.
 * el desplegable de hora de un diálogo). Mismos datos que el componente.
 */
export function useRejillaCuartos({
  fecha,
  comensales,
  hora,
  excluirReservaId,
  enabled = true,
}: OpcionesRejillaCuartos) {
  const ocupacion = useOcupacionSalasDia(fecha, { enabled });
  const turnos = useConfiguracionTurnos();
  const { data: config } = useConfiguracionReservas();
  const dia = ocupacion.data;

  const rejilla = useMemo<RejillaCuartos | null>(() => {
    if (!fecha || !dia || !turnos.data) return null;
    const servicio = configServicioSalaDesde(config);
    // Salas privadas (el Reservado): FUERA DE AFORO. Ni su capacidad ni sus reservas entran en la rejilla.
    const idsPrivadas = dia.espacios.filter((e) => e.privada).map((e) => e.id);
    return construirRejillaCuartos({
      periodos: periodosDelDia(fecha, turnos.data),
      reservas: reservasQueConsumenAforo(dia.reservas, idsPrivadas),
      capacidadTurno: capacidadDeAforo(dia.espacios),
      estancia: { comida: servicio.estanciaComidaMinutos, cena: servicio.estanciaCenaMinutos },
      propuesta: { hora, comensales },
      excluirReservaId,
    });
  }, [fecha, dia, turnos.data, config, hora, comensales, excluirReservaId]);

  return {
    rejilla,
    isLoading: ocupacion.isLoading || turnos.isLoading,
    isError: ocupacion.isError || turnos.isError,
    isFetching: ocupacion.isFetching,
    refetch: () => {
      void ocupacion.refetch();
      void turnos.refetch();
    },
  };
}

const CLASES_NIVEL: Record<NivelOcupacion, string> = {
  libre: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  justo: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  lleno: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

/** Franja que no sale de los turnos: cursiva + subrayado a trazos + asterisco (no solo color). */
const CLASES_FUERA = "italic border-b border-dashed border-muted-foreground/60";

const MOTIVO_ORIGEN: Record<FranjaCuarto["origen"], string> = {
  turno: "",
  reserva: "Fuera del horario del turno: sale porque ya hay una reserva a esa hora.",
  propuesta: "Fuera del horario del turno: es la hora elegida ahora mismo.",
};

const TITULO = "Disponibilidad por cuartos de hora";

export interface DisponibilidadCuartosProps extends Omit<OpcionesRejillaCuartos, "enabled"> {
  /** Si se pasa, cada hora es un botón que la elige. */
  onSeleccionarHora?: (hora: string) => void;
  /** Sin cabecera larga ni notas: para espacios estrechos (Hoy, diálogos). */
  compacto?: boolean;
  /**
   * El contenedor ya enseña este mismo título (en «Hoy», el botón del plegable dice «Disponibilidad por
   * cuartos de hora»): no se repite a la vista. La sección conserva su nombre para los lectores de pantalla.
   * Va aparte de `compacto` porque en el panel del día y en la verificación la rejilla compacta no tiene
   * otro título que el suyo.
   */
  ocultarTitulo?: boolean;
  /**
   * Baldosas en vez de tabla (ver la cabecera): se reparten en filas según el ancho, sin scroll horizontal.
   * Para el panel del día del Calendario. Solo consulta: con baldosas `onSeleccionarHora` no se usa.
   */
  baldosas?: boolean;
  /** Solo ese turno (el filtro del panel del día). Sin él, todos los que tengan horas ese día. */
  turno?: Turno | null;
  className?: string;
}

/** Leyenda de las baldosas: lo justo para leerlas sin conocer la tabla. */
const LEYENDA_BALDOSAS = (
  <>
    En grande, los comensales <strong className="whitespace-nowrap font-semibold text-foreground">en sala</strong> en
    cada cuarto de hora; <strong className="whitespace-nowrap font-semibold text-foreground">«+4 llegan»</strong>, los
    que entran en ese cuarto. El color es la ocupación del aforo, como en las casillas del mes.
  </>
);

export function DisponibilidadCuartos({
  fecha,
  comensales,
  hora,
  excluirReservaId,
  onSeleccionarHora,
  compacto = false,
  ocultarTitulo = false,
  baldosas = false,
  turno = null,
  className,
}: DisponibilidadCuartosProps) {
  const { rejilla, isLoading, isError, isFetching, refetch } = useRejillaCuartos({
    fecha,
    comensales,
    hora,
    excluirReservaId,
  });
  const idTitulo = useId();
  const horaSel = horaCorta(hora);
  const pax = Math.max(0, Number(comensales) || 0);

  const porTurno = useMemo(() => {
    const salida = { comida: [] as FranjaCuarto[], cena: [] as FranjaCuarto[] };
    for (const f of rejilla?.franjas ?? []) salida[f.turno].push(f);
    return salida;
  }, [rejilla]);
  const turnosVisibles = TURNOS.filter((t) => (!turno || t === turno) && porTurno[t].length > 0);
  // Horas fuera del horario de los turnos (salen por una reserva o por la hora propuesta): en las baldosas,
  // su porqué va escrito debajo, no solo en el lector de pantalla (con el dedo no hay `title`).
  const origenesFuera = baldosas
    ? Array.from(new Set(turnosVisibles.flatMap((t) => porTurno[t].map((f) => f.origen)))).filter((o) => o !== "turno")
    : [];

  return (
    <section
      aria-labelledby={ocultarTitulo ? undefined : idTitulo}
      aria-label={ocultarTitulo ? TITULO : undefined}
      className={cn("space-y-2", className)}
    >
      {(!ocultarTitulo || !compacto) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {!ocultarTitulo && (
            <h3 id={idTitulo} className="text-sm font-semibold">
              {TITULO}
            </h3>
          )}
          {!compacto && (
            <p className="text-xs text-muted-foreground">
              {fecha ? fechaLegible(fecha) : "Sin día elegido"}
              {pax > 0 && <> · para {pax} pers.</>}
              {isFetching && !isLoading && <span className="ml-1">· actualizando…</span>}
            </p>
          )}
        </div>
      )}

      {!fecha ? (
        <EstadoVacio grande={baldosas}>Elige un día para ver cómo se reparte el turno.</EstadoVacio>
      ) : isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando disponibilidad">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <span className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            No se pudo cargar la disponibilidad de ese día.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={refetch}>
            <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
            Reintentar
          </Button>
        </div>
      ) : !rejilla || rejilla.franjas.length === 0 ? (
        <EstadoVacio grande={baldosas}>Ese día no hay turnos configurados (cerrado).</EstadoVacio>
      ) : (
        <>
          {baldosas && <p className="text-[13px] text-muted-foreground">{LEYENDA_BALDOSAS}</p>}
          {turno && turnosVisibles.length === 0 && (
            <EstadoVacio grande={baldosas}>Ese día no hay horas de {ETIQUETA_TURNO[turno].toLowerCase()}.</EstadoVacio>
          )}
          {turnosVisibles.map((t) =>
            baldosas ? (
              <BaldosasTurno key={t} turno={t} franjas={porTurno[t]} rejilla={rejilla} pax={pax} horaSel={horaSel} />
            ) : (
              <TablaTurno
                key={t}
                turno={t}
                franjas={porTurno[t]}
                rejilla={rejilla}
                pax={pax}
                horaSel={horaSel}
                onSeleccionarHora={onSeleccionarHora}
              />
            ),
          )}
          {origenesFuera.map((o) => (
            <p key={o} className="text-[13px] text-muted-foreground">
              <span aria-hidden="true">* </span>
              {MOTIVO_ORIGEN[o]}
            </p>
          ))}
          {!compacto && !baldosas && (
            <p className="text-[11px] text-muted-foreground">
              Todas las horas del turno de 15 en 15 minutos. «Llegan»: comensales que entran en ese cuarto. «En sala»:
              los que están sentados según la estancia estimada del turno. El aforo se cuenta por turno (corte a las
              17:00), igual que la base de datos; las salas se asignan por dentro y no limitan la hora.
              {onSeleccionarHora && " Pulsa una hora para elegirla."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

interface PropsTurno {
  turno: Turno;
  franjas: FranjaCuarto[];
  rejilla: RejillaCuartos;
  pax: number;
  horaSel: string | null;
}

/** «Cena 43/150 · quedan 107» (y, si se está probando un grupo, si cabe). La misma en la tabla y en las baldosas. */
function CabeceraTurno({ turno, franjas, rejilla, pax, horaSel, className }: PropsTurno & { className: string }) {
  const aforo = rejilla.aforo[turno];
  const quedan = aforo.capacidad - aforo.ocupados;
  const probar = pax > 0 && !!horaSel && franjas.some((f) => f.hora === horaSel);

  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2", className)}>
      <span className="font-medium">{ETIQUETA_TURNO[turno]}</span>
      <span className="tabular-nums text-muted-foreground">
        {aforo.ocupados}/{aforo.capacidad} · quedan {Math.max(0, quedan)}
      </span>
      {probar && (
        <span className={cn("font-medium", aforo.cabe ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
          {aforo.cabe ? `Caben ${pax} más` : `No caben ${pax} más (${aforo.tras}/${aforo.capacidad})`}
        </span>
      )}
    </p>
  );
}

/** «13:45: 6 en sala, llegan 4»: todo lo de la baldosa en una frase (y el porqué si está fuera del turno). */
function etiquetaBaldosa(f: FranjaCuarto): string {
  const llegadas = f.llegan === 0 ? "sin llegadas" : f.llegan === 1 ? "llega 1" : `llegan ${f.llegan}`;
  const fuera = f.origen !== "turno" ? `. ${MOTIVO_ORIGEN[f.origen]}` : "";
  return `${f.hora}: ${f.enSala} en sala, ${llegadas}${fuera}`;
}

/**
 * Un turno en baldosas: tantas por fila como quepan (mínimo 4,5 rem = 72 px, lo que pide «+26 llegan» a 13 px),
 * así que nunca hay scroll lateral. El tinte es el de las casillas del mes con los comensales EN SALA contra el
 * aforo del turno (`nivelDeOcupacion` + `estiloNivel`): mismos umbrales, mismos colores y mismos contrastes (el
 * texto pequeño va al 80 %, como en la casilla).
 */
function BaldosasTurno({ turno, franjas, rejilla, pax, horaSel }: PropsTurno) {
  const capacidad = rejilla.aforo[turno].capacidad;
  return (
    <div className="space-y-1.5" data-turno-cuartos={turno}>
      <CabeceraTurno turno={turno} franjas={franjas} rejilla={rejilla} pax={pax} horaSel={horaSel} className="text-sm" />
      <ul
        role="list"
        aria-label={`${ETIQUETA_TURNO[turno]}: comensales en sala y que llegan en cada cuarto de hora`}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(4.5rem,100%),1fr))] gap-1.5"
      >
        {franjas.map((f) => {
          const nivel = nivelDeOcupacion(f.enSala, capacidad);
          const fuera = f.origen !== "turno";
          return (
            <li
              key={f.hora}
              data-cuarto={f.hora}
              data-nivel={nivel}
              aria-label={etiquetaBaldosa(f)}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-md border px-1 py-1 text-center leading-tight tabular-nums",
                estiloNivel(nivel).celda,
                f.hora === horaSel && "ring-2 ring-primary ring-offset-1",
              )}
            >
              <span className={cn("text-[13px] opacity-80", fuera && CLASES_FUERA)}>
                {f.hora}
                {fuera && <span aria-hidden="true">*</span>}
              </span>
              <span className="text-xl font-semibold">{f.enSala}</span>
              {/* Sin llegadas, la línea queda en blanco: todas las baldosas miden lo mismo. */}
              {f.llegan > 0 ? (
                <span className="text-[13px] opacity-80">
                  +{f.llegan} {f.llegan === 1 ? "llega" : "llegan"}
                </span>
              ) : (
                <span aria-hidden="true" className="text-[13px]">
                  {"\u00a0"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TablaTurno({
  turno,
  franjas,
  rejilla,
  pax,
  horaSel,
  onSeleccionarHora,
}: PropsTurno & { onSeleccionarHora?: (hora: string) => void }) {
  const aforo = rejilla.aforo[turno];

  return (
    <div className="space-y-1">
      <CabeceraTurno turno={turno} franjas={franjas} rejilla={rejilla} pax={pax} horaSel={horaSel} className="text-xs" />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-xs tabular-nums">
          <caption className="sr-only">
            {ETIQUETA_TURNO[turno]}: comensales que llegan y que están sentados en cada cuarto de hora. Aforo del
            turno {aforo.ocupados} de {aforo.capacidad}.
          </caption>
          <thead>
            <tr className="bg-muted/40">
              <th scope="col" className="sticky left-0 z-10 bg-muted px-2 py-1 text-left font-medium">
                Hora
              </th>
              {franjas.map((f) => {
                const sel = f.hora === horaSel;
                const fuera = f.origen !== "turno";
                const etiqueta = (
                  <span className={cn(fuera && CLASES_FUERA)}>
                    {f.hora}
                    {fuera && <span aria-hidden>*</span>}
                  </span>
                );
                return (
                  <th
                    key={f.hora}
                    scope="col"
                    title={MOTIVO_ORIGEN[f.origen] || undefined}
                    className={cn("px-1 py-1 text-center font-normal", sel && "bg-primary/10 font-semibold")}
                  >
                    {onSeleccionarHora ? (
                      <button
                        type="button"
                        onClick={() => onSeleccionarHora(f.hora)}
                        aria-pressed={sel}
                        aria-label={`Elegir las ${f.hora}. ${f.enSala} en sala, ${f.llegan} llegan.${
                          fuera ? ` ${MOTIVO_ORIGEN[f.origen]}` : ""
                        }`}
                        className="rounded px-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-2 pointer-coarse:text-sm"
                      >
                        {etiqueta}
                      </button>
                    ) : (
                      etiqueta
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-normal text-muted-foreground">
                Llegan
              </th>
              {franjas.map((f) => (
                <td
                  key={f.hora}
                  className={cn("px-1 py-1 text-center", f.hora === horaSel && "bg-primary/10")}
                  title={f.reservasQueLlegan > 0 ? `${f.reservasQueLlegan} reserva(s)` : undefined}
                >
                  {f.llegan > 0 ? f.llegan : <span className="text-muted-foreground/50">·</span>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-normal text-muted-foreground">
                En sala
              </th>
              {franjas.map((f) => (
                <td
                  key={f.hora}
                  className={cn(
                    "px-1 py-1 text-center",
                    f.enSala > 0 && CLASES_NIVEL[f.nivel],
                    f.hora === horaSel && "ring-1 ring-inset ring-primary",
                  )}
                  title={`${ETIQUETA_NIVEL[f.nivel]}: ${f.enSala} de ${aforo.capacidad}`}
                >
                  {f.enSala}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** `grande`: con las baldosas (panel del día, tablet) el aviso va a 14 px como el resto del panel. */
function EstadoVacio({ children, grande = false }: { children: ReactNode; grande?: boolean }) {
  return (
    <p className={cn("rounded-md border border-dashed p-3 text-center text-muted-foreground", grande ? "text-sm" : "text-xs")}>
      {children}
    </p>
  );
}
