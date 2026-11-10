// ============================================================================
// CALENDARIO DEL MES — pestaña Calendario de /reservas
// ----------------------------------------------------------------------------
// La cuadrícula del mes a TODO EL ANCHO. Desde el 2026-10-15 (dueño: «para no
// duplicar cosas») ya no hay panel del día a la derecha (`DetalleDiaEspacios`,
// con el reparto por salas y los interruptores de cierre): al pulsar un día se
// abre un pop-up (`DialogoCierreDia`) para cerrar/abrir comida, cena o las dos.
// El Reservado (sala privada) solo se enseña en la pestaña Hoy (mismo encargo).
//
// ---------------------------------------------------------------------------
// QUÉ SE VE EN LA CUADRÍCULA (rediseño del 2026-10-01)
// ---------------------------------------------------------------------------
// Cada casilla enseña los COMENSALES del día en grande, un color que es el %
// de ocupación del servicio más lleno (comida o cena) y, discreto, un punto si
// hay reservas sin sala dentro de la ventana de asignación. Toda la lógica
// (umbrales, colores, qué estados cuentan, aforo de Casa Tomás, ventana) vive en
// `src/lib/reservas/ocupacionCalendario.ts`, que es puro y está testeado; la
// casilla es `CasillaOcupacion.tsx` y la leyenda `LeyendaOcupacion.tsx`.
//
// Historia: el calendario anterior coloreaba por «reservas sin sala» (verde /
// ámbar). Desde que el cliente ya no elige sala (reservas-sin-salas: la sala y
// la mesa las pone el personal en una ventana de 48 h) casi todo el futuro salía
// ámbar y el color dejó de decir nada. Antes de eso hubo un «%» que SIEMPRE
// valía 0 (`statsPerDay` lo inicializaba y no lo calculaba nunca) y se quitó.
// Ahora el porcentaje existe de verdad, medido contra el aforo de Casa Tomás.
//
// ---------------------------------------------------------------------------
// DOS CONSULTAS, DOS DUEÑOS (y no se prestan datos)
// ---------------------------------------------------------------------------
// · La CUADRÍCULA lee la tabla `reservas` del mes entero (`reservas_mes`), y el
//   aforo de Casa Tomás de `espacios_reserva` (la caché que ya usa media app: no
//   es una consulta más). Nada de N+1: una consulta por mes.
//
// CUIDADO CON LAS 1000 FILAS: PostgREST devuelve como mucho 1000 filas por
// petición (el tope por defecto de Supabase). Con ~1.000 reservas confirmadas
// en un mes, una sola consulta habría dejado sin contar el final del mes sin
// dar error. Por eso `leerReservasDelMes` pide el mes por PÁGINAS de 1000 y
// sigue hasta tener todas (con el recuento exacto que devuelve el servidor, para
// no fiarse del tamaño de la última página).
//
// `"reservas_mes"` es la clave que invalidan las mutaciones de reservas
// (`clavesCache.ts`); un test lee este fichero para comprobar que sigue aquí.
//
// ---------------------------------------------------------------------------
// SOLO CASA TOMÁS (decisión del dueño, 2026-10-01)
// ---------------------------------------------------------------------------
// Touza ya no admite reservas. El calendario mide la ocupación SOLO de Casa
// Tomás, contra su aforo por turno, sin selector de negocio ni mezcla de aforos;
// si en los datos antiguos aparece una reserva de `marca = 'touza'`, se ignora
// con la regla común de todo el panel (`admiteReservas`, en negocios.ts), igual
// que en el panel del día.
//
// ---------------------------------------------------------------------------
// ALTURA FIJA, SIN SCROLL (encargo del dueño, 2026-10-04)
// ---------------------------------------------------------------------------
// «Que esta vista calcule la altura para el tamaño de la pantalla, para que sea
// fija, sin scroll.» Las cuentas y su porqué están en
// `lib/reservas/alturaCalendario.ts`; la medida, en `useAlturaDisponible`.
//   · ≥ lg: el bloque (cabecera del mes + [calendario | panel del día] +
//     leyenda) mide justo lo que queda de ventana desde su posición. La rejilla
//     reparte ese alto entre sus semanas (5 o 6, `minmax(0,1fr)`), la casilla se
//     adapta a su fila (`medirCasilla`) y el panel del día hace scroll interno.
//   · < lg: panel del día debajo; el calendario (cabecera + mes entero) ocupa la
//     altura visible y el resto queda a un scroll de página.
//   · Sin medida (jsdom, sin ResizeObserver) o ventana muy baja (< suelo): el
//     layout de siempre / el suelo, y la página hace scroll.
// ============================================================================

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { eachDayOfInterval, endOfMonth, format, isSameDay, isSameMonth, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useIsCompactNav } from "@/hooks/use-mobile";
import { useAlturaDisponible, useTamanoElemento } from "@/hooks/useAlturaDisponible";
import {
  ALTURA_LEYENDA_COMPLETA,
  alturaTarjetaCalendario,
  medirCasilla,
  semanasDelMes,
  tamanoCasilla,
} from "@/lib/reservas/alturaCalendario";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { aforoCasaTomas, resumirMes, type ReservaCalendario } from "@/lib/reservas/ocupacionCalendario";
import { esSalaPrivada } from "@/lib/reservas/salaPrivada";
import { configAsignacionDesde, fechaMadrid } from "@/lib/reservas/ventanaAsignacion";
import { CasillaOcupacion } from "./CasillaOcupacion";
import { LeyendaOcupacion } from "./LeyendaOcupacion";
import { DialogoCierreDia } from "./DialogoCierreDia";
import { useCierresReserva } from "@/hooks/useCierresReserva";
import {
  cierresPorDia,
  diasAbiertosSinReservaOnlineDesde,
  separarCierres,
} from "../../../supabase/functions/_shared/cierres";
import { textoEvento, useSalasEvento } from "@/hooks/useSalaEvento";


/** Filas por petición de PostgREST (el tope por defecto de Supabase). */
const FILAS_POR_PAGINA = 1000;
/** Freno de seguridad: 20.000 reservas en un mes no existen; si llega, algo va mal. */
const PAGINAS_MAXIMAS = 20;

/**
 * Todas las reservas NO canceladas del mes, página a página. Las canceladas
 * nunca cuentan; el resto (incluidas completadas y «No vino») se trae porque
 * los días pasados se enseñan como histórico: el filtro por estado vivo lo hace
 * `resumirMes`, que es lo que se testea.
 *
 * `as any` en la tabla: `marca` no está en los tipos generados para `reservas`.
 * Mismo recurso que `useDisponibilidad.ts`.
 */
async function leerReservasDelMes(inicio: string, fin: string): Promise<ReservaCalendario[]> {
  const filas: ReservaCalendario[] = [];
  let total: number | null = null;

  for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
    const desde = pagina * FILAS_POR_PAGINA;
    const { data, error, count } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `marca` no está en los tipos generados (ver arriba)
      .from("reservas" as any)
      .select("id, fecha, hora, numero_comensales, estado, marca, espacio_id", { count: "exact" })
      .gte("fecha", inicio)
      .lte("fecha", fin)
      .neq("estado", "cancelada")
      // `id` desempata: sin un orden total, dos páginas pueden repetir o saltarse filas.
      .order("fecha")
      .order("hora")
      .order("id")
      .range(desde, desde + FILAS_POR_PAGINA - 1);

    if (error) throw error;
    const lote = (data ?? []) as unknown as ReservaCalendario[];
    filas.push(...lote);
    if (typeof count === "number") total = count;

    // Se acaba cuando ya están todas (según el recuento del servidor) o, si el
    // servidor no lo da, cuando una página llega corta. Una página vacía corta
    // siempre: no hay nada más que pedir.
    if (lote.length === 0) break;
    if (total !== null ? filas.length >= total : lote.length < FILAS_POR_PAGINA) break;
  }

  return filas;
}

/**
 * Qué día se selecciona al entrar en un mes: hoy si cae dentro (lo normal al
 * abrir la pestaña), y si no el día 1. Nunca se queda sin selección: el panel
 * del día tiene que traer información desde el primer render, que es justo lo
 * que antes no pasaba (había que pulsar para ver algo).
 */
function diaPorDefectoDelMes(mes: Date): Date {
  const hoy = new Date();
  return isSameMonth(hoy, mes) ? hoy : startOfMonth(mes);
}

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

/**
 * La consulta del mes ha fallado. Antes un fallo dejaba la cuadrícula VACÍA y
 * sin avisar —«no hay reservas en todo el mes», que es mentira—; ahora se dice
 * y se ofrece reintentar. Mismo lenguaje que el error del panel del día.
 */
function BloqueErrorMes({
  error,
  reintentando,
  onReintentar,
}: {
  error: unknown;
  reintentando: boolean;
  onReintentar: () => void;
}) {
  const detalle = mensajeDeError(error);
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-base font-medium">No se han podido leer las reservas de este mes</p>
          <p className="text-sm text-muted-foreground">
            No se enseña ninguna cifra para no dar por buenos unos datos que no se han llegado a leer. Vuelve a
            intentarlo.
          </p>
          {detalle && <p className="break-words text-sm text-muted-foreground">{detalle}</p>}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-3 h-12 gap-2 text-base"
        onClick={onReintentar}
        disabled={reintentando}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", reintentando && "animate-spin")} aria-hidden="true" />
        {reintentando ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  );
}

export function CalendarioOcupacion() {
  // Nodos medidos (ref de callback + estado: el raíz no existe mientras carga el mes).
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const [rejilla, setRejilla] = useState<HTMLDivElement | null>(null);
  const alturaBloque = useAlturaDisponible(raiz);
  const tamanoRejilla = useTamanoElemento(rejilla);
  // Menú fijo desde 1024 px (= `lg`).
  const apilado = useIsCompactNav();

  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  // Día del pop-up de cierre (YYYY-MM-DD); null = cerrado.
  const [diaDialogo, setDiaDialogo] = useState<string | null>(null);

  // El reloj de la pantalla: una vez por minuto, para que «hoy» y la ventana de
  // asignación se muevan solos si la pestaña se queda abierta (p. ej. toda la noche).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // «Hoy» es el de Madrid, no el del navegador: los días pasados y la ventana de
  // asignación se miden con la hora del restaurante.
  const hoy = fechaMadrid(ahora);

  // Cambios de `reservas` hechos en otro dispositivo: refrescan la cuadrícula.
  useReservasEnVivo();

  // Reservas del mes: la consulta de la CUADRÍCULA. Con el respaldo de cada
  // minuto (solo con la pestaña a la vista) mientras no llegue realtime.
  const {
    data: reservasMes,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    ...REFRESCO_PERIODICO,
    queryKey: ["reservas_mes", format(currentMonth, "yyyy-MM")],
    queryFn: () =>
      leerReservasDelMes(
        format(startOfMonth(currentMonth), "yyyy-MM-dd"),
        format(endOfMonth(currentMonth), "yyyy-MM-dd"),
      ),
  });

  // El aforo de Casa Tomás: de sus espacios activos (caché compartida con media
  // app). La ventana de asignación: de la configuración (48 h por defecto
  // mientras carga o si falla).
  const { data: espacios, isLoading: cargandoEspacios, isError: errorEspacios } = useEspaciosReserva();
  const { data: configuracion } = useConfiguracionReservas();
  const { ventanaHoras } = configAsignacionDesde(configuracion);
  const aforo = useMemo(() => aforoCasaTomas(espacios), [espacios]);
  // Las salas privadas (el Reservado) están fuera de aforo: no suman en las cifras.
  // Desde el 2026-10-15 la casilla ya no las marca (el Reservado solo se ve en Hoy).
  const salasPrivadas = useMemo(
    () =>
      ((espacios ?? []) as Array<{ id?: string; nombre?: string }>)
        .filter((e) => e?.id && esSalaPrivada(e as Parameters<typeof esSalaPrivada>[0]))
        .map((e) => ({ id: e.id as string, nombre: (e.nombre ?? "").trim() || "Sala privada" })),
    [espacios],
  );

  // Cierres de reservas del mes (lunes, jueves, domingo noche + los manuales). Los jueves, sin
  // reservas web/teléfono pero con el local abierto: ver `cierresCasilla`.
  const { data: cierresMes } = useCierresReserva(
    format(startOfMonth(currentMonth), "yyyy-MM-dd"),
    format(endOfMonth(currentMonth), "yyyy-MM-dd"),
  );
  const cierresDia = useMemo(() => cierresPorDia(cierresMes?.cierres ?? []), [cierresMes]);
  // Jueves de tapas (dueño, 2026-11-10: «Abierto, sin reservas web»): la regla los da sin reservas
  // web/teléfono, pero el local abre. La casilla no dice «Cerrado»: dice «Sin reservas web».
  const abiertosSinOnline = useMemo(() => diasAbiertosSinReservaOnlineDesde(configuracion), [configuracion]);
  const cierresCasilla = useMemo(() => {
    const mapa: Record<string, ReturnType<typeof separarCierres>> = {};
    for (const [fecha, lista] of Object.entries(cierresDia)) mapa[fecha] = separarCierres(lista, abiertosSinOnline);
    return mapa;
  }, [cierresDia, abiertosSinOnline]);

  // «Evento: sala entera» del mes (20261119100000): «Evento: Boda (Salón, comida)».
  const { data: eventosMes } = useSalasEvento(
    format(startOfMonth(currentMonth), "yyyy-MM-dd"),
    format(endOfMonth(currentMonth), "yyyy-MM-dd"),
  );
  const eventosDia = useMemo(() => {
    const nombres = new Map(((espacios ?? []) as Array<{ id?: string; nombre?: string }>).map((e) => [e.id, e.nombre ?? "Sala"]));
    const mapa: Record<string, string[]> = {};
    for (const e of eventosMes ?? []) {
      (mapa[e.fecha] ??= []).push(`${textoEvento(e)} (${nombres.get(e.espacio_id) ?? "sala"}, ${e.turno})`);
    }
    return mapa;
  }, [eventosMes, espacios]);

  // Cifras y nivel de cada día del mes.
  const resumenes = useMemo(
    () => {
      if (!reservasMes) return {};
      // El Reservado sale de las cifras (`salasPrivadas`) y además no se avisa de él
      // en la casilla ni en su tooltip: solo se ve en Hoy (dueño, 2026-10-15).
      const mes = resumirMes(reservasMes, aforo, { hoy, ahora, ventanaHoras, salasPrivadas });
      return Object.fromEntries(Object.entries(mes).map(([f, r]) => [f, { ...r, salasPrivadas: [] }]));
    },
    [reservasMes, aforo, hoy, ahora, ventanaHoras, salasPrivadas],
  );

  /**
   * Cambia de mes. Si el día seleccionado se queda fuera del mes nuevo hay que
   * mover la selección: los datos cargados son los del mes visible, así que un
   * día de otro mes pintaría "no hay reservas" siendo mentira.
   */
  // Pulsar un día lo selecciona y abre el pop-up de cierre.
  const elegirDia = (dia: Date) => {
    setSelectedDate(dia);
    setDiaDialogo(format(dia, "yyyy-MM-dd"));
  };

  const cambiarMes = (offset: number) => {
    const nuevo = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    setCurrentMonth(nuevo);
    setSelectedDate((sel) => (isSameMonth(sel, nuevo) ? sel : diaPorDefectoDelMes(nuevo)));
  };

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const huecosIniciales = (startOfMonth(currentMonth).getDay() + 6) % 7;
  const semanas = semanasDelMes(huecosIniciales, daysInMonth.length);

  // Altura fija: `alturaBloque` es null hasta medir (y siempre en jsdom).
  const tamano = tamanoRejilla ? tamanoCasilla(tamanoRejilla, semanas) : null;
  const { densidad, fuenteComensales } = medirCasilla(tamano ?? { ancho: 100, alto: 80 });

  // Los espacios casi siempre ya están en caché (la página los pide al montarse):
  // solo se espera por ellos si de verdad faltan, para no pintar el mes en gris
  // un instante y que luego salte a color.
  if (isLoading || (cargandoEspacios && !espacios)) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              aria-label="Cargando el calendario"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  const medida = alturaBloque !== null;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        ref={setRaiz}
        data-testid="calendario-ocupacion"
        data-altura-fija={medida ? String(alturaBloque) : undefined}
        className={cn("flex flex-col", medida ? "gap-3 lg:h-[var(--alto-bloque)]" : "gap-4 sm:gap-6")}
        style={
          medida
            ? ({
                "--alto-bloque": `${alturaBloque}px`,
                "--alto-calendario": `${alturaTarjetaCalendario(alturaBloque)}px`,
              } as CSSProperties)
            : undefined
        }
      >
        {/* Navegación del mes */}
        <Card className={cn(medida && "h-14 shrink-0")}>
          <CardContent className={cn("p-4", medida && "flex h-full items-center px-2 py-0")}>
            <div className="flex w-full items-center justify-between">
              <Button variant="ghost" className="h-12 w-12" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </Button>
              <h3 className="text-2xl font-semibold capitalize">
                {format(currentMonth, "MMMM yyyy", { locale: es })}
              </h3>
              <Button variant="ghost" className="h-12 w-12" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* El mes a todo el ancho (sin panel del día desde el 2026-10-15). Con
            altura fija la tarjeta llena el alto que queda (`flex-1`). */}
        <div className={cn("grid grid-cols-1", medida && "min-h-0 flex-1 grid-rows-[minmax(0,1fr)]")}>
          {/* Calendario. Apilado (< lg) con altura fija: cabecera + mes entero a la vista. */}
          <Card
            data-testid="tarjeta-mes"
            className={cn("min-w-0", medida && "flex min-h-0 flex-col max-lg:h-[var(--alto-calendario)]")}
          >
            <CardContent className={cn("p-2 sm:p-4", medida && "flex min-h-0 flex-1 flex-col p-2 sm:p-3")}>
              {isError ? (
                <BloqueErrorMes
                  error={error}
                  reintentando={isFetching}
                  onReintentar={() => {
                    void refetch();
                  }}
                />
              ) : (
                <>
                  {/* Header días de la semana */}
                  <div className={cn("grid grid-cols-7 gap-0.5 sm:gap-1", medida ? "mb-1 shrink-0" : "mb-1 sm:mb-2")}>
                    {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
                      <div
                        key={day}
                        className={cn(
                          "text-center text-sm font-semibold text-foreground sm:text-base",
                          medida ? "py-0.5" : "py-1 sm:py-2",
                        )}
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Días del mes. Con altura fija las filas se reparten el alto (5 o 6 semanas). */}
                  <div
                    ref={setRejilla}
                    data-testid="rejilla-mes"
                    className={cn("grid grid-cols-7 gap-1", medida && "min-h-0 flex-1")}
                    style={medida ? { gridTemplateRows: `repeat(${semanas}, minmax(0, 1fr))` } : undefined}
                  >
                    {/* Espacios vacíos para alinear el primer día */}
                    {Array.from({ length: huecosIniciales }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}

                    {daysInMonth.map((day) => {
                      const dateKey = format(day, "yyyy-MM-dd");
                      return (
                        <CasillaOcupacion
                          key={dateKey}
                          dia={day}
                          fechaISO={dateKey}
                          resumen={resumenes[dateKey]}
                          cierres={cierresCasilla[dateKey]?.cerrados}
                          sinReservaWeb={cierresCasilla[dateKey]?.sinReservaOnline}
                          eventos={eventosDia[dateKey]}
                          esPasado={dateKey < hoy}
                          esHoy={dateKey === hoy}
                          seleccionada={isSameDay(day, selectedDate)}
                          ventanaHoras={ventanaHoras}
                          onSeleccionar={elegirDia}
                          densidad={medida ? densidad : undefined}
                          fuenteComensales={medida ? fuenteComensales : undefined}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

        </div>

        <LeyendaOcupacion
          ventanaHoras={ventanaHoras}
          aforo={aforo}
          aforoNoDisponible={errorEspacios}
          compacta={medida && !apilado && alturaBloque < ALTURA_LEYENDA_COMPLETA}
        />

        <DialogoCierreDia
          fecha={diaDialogo}
          onClose={() => setDiaDialogo(null)}
          cierres={diaDialogo ? (cierresDia[diaDialogo] ?? []) : []}
          esPasado={!!diaDialogo && diaDialogo < hoy}
          esquemaPendiente={cierresMes?.esquemaPendiente}
        />
      </div>
    </TooltipProvider>
  );
}
