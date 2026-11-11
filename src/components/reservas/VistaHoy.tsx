import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, Wand2 } from "lucide-react";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { supabase } from "@/integrations/supabase/client";
import { ReservasEnVivoContexto, useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { AvisoSinConexion } from "@/components/panel/AvisoSinConexion";
import { esErrorDeRed } from "@/hooks/useEnLinea";
import { useHoyLocal } from "@/hooks/useHoyLocal";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { admiteReservas } from "@/lib/reservas/negocios";
import {
  COLUMNAS_RESERVAS_HOY,
  etiquetaDiaReservas,
  guardarSalaPlanoHoy,
  leerSalaPlanoHoy,
  sumarDias,
  turnoPorDefecto,
  type FiltroTurnoHoy,
} from "@/lib/reservas/vistaHoy";
import { VistaPlanoHoy, type ReservaPlanoHoy } from "./servicio/VistaPlanoHoy";
import { consultaReservasHoy } from "@/lib/reservas/consultaReservasHoy";
import { AvisoActualizando } from "@/components/panel/AvisoActualizando";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { VistaHoyMovil } from "./movil/VistaHoyMovil";
import { BotonSentarSinReserva } from "./SentarSinReserva";
import { InterruptoresServiciosOnline } from "./InterruptoresServiciosOnline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Sin relectura periódica (el móvil ya tiene la suya, `useAlDiaMovil`). */
const SIN_SONDEO = { refetchInterval: false } as const;

/**
 * Pestaña "Hoy" (rediseñada 2026-09-25, petición del dueño): antes esto era
 * 4 tarjetas grandes de ocupación + una tabla "Reservas de Hoy" + el kanban
 * escondido detrás de un botón "Gestor de reservas" — en 1366px las 4
 * tarjetas solas ya llenaban la pantalla y no se veía ni una reserva.
 *
 * Ahora: una franja compacta con los mismos 4 datos y, justo debajo, el
 * kanban por espacios como protagonista — es la vista de servicio, así que
 * es lo primero que se ve. Solo Casa Tomás: Touza no admite reservas
 * (decisión del dueño, 2026-10-01), así que lo que quede de Touza en la base
 * de datos no sale ni cuenta en ninguna parte de esta pestaña.
 *
 * Ojo: NO hay lista/tabla de reservas de hoy aquí (decisión explícita del
 * dueño — "quita la lista de reservas de hoy, solo el kanban"). Buscar por
 * nombre/teléfono, marcar importante y añadir a blacklist siguen
 * disponibles, pero dentro del propio kanban (GestorReservasKanban.tsx) en
 * vez de en una tabla aparte. Las reservas que NO son de hoy están en la
 * pestaña "Lista".
 *
 * Retirado el 04/10/2026, por petición del dueño, porque duplicaban lo que ya
 * se ve en el kanban (ruido visual que agrandaba la pantalla): la franja
 * «Pendientes de mesa» (el kanban marca ahora cada tarjeta «Sin mesa» y su menú
 * «⋮» tiene «Dar mesa») y la línea «Cómo avanza una reserva» (esa vive en la
 * pestaña «Lista», como filtro por estado).
 *
 * DOS VISTAS (06/10/2026, petición del dueño: «montar aquí DOS VISTAS: una de kanban y luego
 * montar la vista con los planos del local»): «Kanban | Plano», en la fila del buscador y del
 * turno, sin alto de más. Por defecto el kanban; la elección (y la sala del plano) se recuerda
 * en este navegador. Lo de arriba —cifras, cuartos de hora, buscador y
 * «Todo el día / Comida / Cena»— es UNO para las dos: el buscador y el turno viven aquí (antes
 * dentro del kanban) y filtran igual el kanban y el plano (`coincideFiltroHoy`). El plano está en
 * `servicio/VistaPlanoHoy.tsx`. Tocar el nombre de una sala en el kanban abre su plano.
 *
 * ORGANIZAR (10/10/2026): botón en la fila de filtros (tablet y escritorio). Con «Todo el día» pregunta
 * «¿Comida o Cena?»; después la vista pasa a Plano en MODO PROPUESTA (`VistaPlanoHoy`, prop `organizar`).
 * «Reparto de mesas» (`PlanoEspacio2D`) ya no se ofrece desde Hoy: lo esencial está en el Plano.
 *
 * SOLO «VER» (06/11/2026, decisión del dueño): sin «Editar» en Reservas no salen «Organizar» ni «Sin
 * reserva» (se ocultan, no se desactivan); el kanban, el plano y la vista de móvil tampoco ofrecen
 * nada que escriba. La etiqueta «Solo lectura» la pone la página, junto a las pestañas.
 *
 * ESCRITORIO SIN KANBAN (07/11/2026, petición del dueño): a la izquierda la lista del móvil (lo que falta por
 * llegar, con «Sentar · Comedor · Mesa 12», `VistaHoyMovil` en modo `columna`) con su scroll; a la derecha el
 * plano FIJO, una sala a la vez con flechas (`VistaPlanoHoy` `fijo`). El kanban (`GestorReservasKanban`) sigue
 * en el código pero ya no se pinta en Hoy; tampoco el selector «Kanban | Plano» ni los cuartos de hora
 * plegados (iban con el kanban). Lo de arriba sobre el kanban queda como historia.
 *
 * `onAbrirSala` (sin uso desde el 10/10/2026): abría el reparto de mesas de una sala (`Reservas.tsx`, el
 * mismo salto que el Calendario: `PlanoEspacio2D`, con su conmutador al modo servicio).
 */
/**
 * Turno elegido en Reservas (11/11/2026, petición del dueño): sale «Comida» y, desde las 18:00, pasa sola a
 * «Cena». Si alguien elige otro a mano, se respeta y ya no cambia solo.
 */
function useTurnoAutomatico() {
  const [filtroTurno, setFiltroTurno] = useState<FiltroTurnoHoy>(() => turnoPorDefecto());
  const aMano = useRef(false);
  useEffect(() => {
    const comprobar = () => {
      if (!aMano.current) setFiltroTurno((actual) => (actual === turnoPorDefecto() ? actual : turnoPorDefecto()));
    };
    const id = window.setInterval(comprobar, 60_000);
    document.addEventListener("visibilitychange", comprobar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", comprobar);
    };
  }, []);
  const elegir = useCallback((t: FiltroTurnoHoy) => {
    aMano.current = true;
    setFiltroTurno(t);
  }, []);
  return [filtroTurno, elegir] as const;
}

export function VistaHoy(_props: { onAbrirSala?: (espacioId: string) => void } = {}) {
  // Lo que comparten las dos vistas: el buscador y el turno de la fila de filtros, y la vista elegida.
  const [busqueda, setBusqueda] = useState("");
  const [filtroTurno, setFiltroTurno] = useTurnoAutomatico();
  const [salaPlano, setSalaPlano] = useState<string | null>(leerSalaPlanoHoy);
  // Móvil (< 768 px): vista propia para el camarero (`movil/VistaHoyMovil.tsx`). Tablet y escritorio, igual.
  const esMovil = useIsMobile();
  // «Organizar» mueve reservas y da mesas: solo con «Editar» en Reservas.
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  // «Organizar»: turno de la propuesta en curso (o `null`) y la pregunta «¿Comida o Cena?».
  const [organizando, setOrganizando] = useState<"comida" | "cena" | null>(null);
  const [preguntarTurno, setPreguntarTurno] = useState(false);
  const empezarOrganizar = (turno: "comida" | "cena") => {
    setPreguntarTurno(false);
    setFiltroTurno(turno);
    setOrganizando(turno);
  };
  const pulsarOrganizar = () => (filtroTurno === "todo" ? setPreguntarTurno(true) : empezarOrganizar(filtroTurno));
  const cambiarTurno = (t: FiltroTurnoHoy) => {
    setFiltroTurno(t);
    if (t !== organizando) setOrganizando(null);
  };
  const cambiarSala = useCallback((salaId: string) => {
    setSalaPlano(salaId);
    guardarSalaPlanoHoy(salaId);
  }, []);
  const [bloqueEscritorio, setBloqueEscritorio] = useState<HTMLDivElement | null>(null);
  const altoEscritorio = useAlturaDisponible(bloqueEscritorio, 420);
  /** Escritorio: la reserva señalada en la lista (ratón, foco o ficha abierta), que el plano resalta. */
  const [señalada, setSeñalada] = useState<string | null>(null);

  // 07/11/2026: ya no se espera al «resumen de ocupación» (2 consultas cada minuto que bloqueaban toda la
  // pestaña con un esqueleto y cuyas cifras no se pintan desde el 17/10). Cada vista enseña lo suyo según llega.
  // Cambios de `reservas` y de mesas hechos en otro dispositivo: UNA suscripción
  // para toda la pestaña (kanban, cifras y la rejilla
  // por cuartos, que no abre la suya: `ReservasEnVivoContexto`).
  useReservasEnVivo();
  // Reservas con días (11/11/2026, petición del dueño: «en vez de Hoy que sea Reservas, que tenga para pasar
  // días»): `hoy` es el día que se ve; sin elegir ninguno, el de hoy (cambia a medianoche: la tablet se queda
  // toda la noche en Reservas).
  const hoyReal = useHoyLocal();
  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  const hoy = diaElegido ?? hoyReal;
  const irADia = (clave: string) => setDiaElegido(clave === hoyReal ? null : clave);
  /**
   * Reservas de hoy de Casa Tomás, para el plano del servicio y la vista de hoy en móvil
   * (`marca`, para quedarse con las de Casa Tomás: `admiteReservas`).
   *
   * Columnas explícitas (`COLUMNAS_RESERVAS_HOY`, 07/11/2026: antes `select("*")`), las mismas que el kanban.
   * NO se reutiliza
   * `useReservasServicioDia`: ese pide `llegada_at` y `salida_at` por nombre, y su error subiría hasta
   * aquí y tumbaría la pestaña entera. (`"reservas" as any` porque `espacio_id` no está en los tipos generados.)
   *
   * CLAVE: empieza por "reservas-hoy", prefijo de `CLAVES_LISTAS_RESERVAS` (`clavesCache.ts`):
   * las acciones de reserva y el alta/edición la refrescan (y la actualizan de forma optimista).
   * Lo que cambie OTRO dispositivo llega por `useReservasEnVivo` y, sin realtime, con el refresco
   * de cada minuto (`REFRESCO_PERIODICO`). El nombre "pendientes-mesa" es herencia de la franja
   * retirada: se conserva porque otros hooks y tests la usan como clave.
   */
  const {
    data: reservasHoy,
    isError: falloReservasHoy,
    error: errorDetalleReservasHoy,
    refetch: refetchReservasHoy,
    dataUpdatedAt: reservasHoyActualizadas,
    fetchStatus: estadoPeticionReservasHoy,
  } = useQuery({
    // En el móvil ya las relee `useAlDiaMovil` (cada 30 s): sin el sondeo de cada minuto, para no pedirlas dos veces.
    ...(esMovil ? SIN_SONDEO : REFRESCO_PERIODICO),
    // Clave y lectura en `consultaReservasHoy` (la misma que precarga `App.tsx` al abrir el panel en «Hoy»).
    ...consultaReservasHoy(hoy),
  });

  /**
   * Canceladas de hoy, solo para la lista de escritorio (plegadas al final, 07/11/2026). Aparte de la de
   * arriba para no meterlas en el plano ni en el móvil. Clave con el prefijo "reservas-hoy": se refresca igual.
   */
  const { data: canceladasHoy } = useQuery({
    ...REFRESCO_PERIODICO,
    enabled: !esMovil,
    queryKey: ["reservas-hoy", "canceladas", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `espacio_id` no está en los tipos generados (como la de arriba).
        .from("reservas" as any)
        .select(COLUMNAS_RESERVAS_HOY)
        .eq("fecha", hoy)
        .eq("estado", "cancelada")
        .order("hora");
      if (error) throw error;
      return ((data ?? []) as unknown as ReservaPlanoHoy[]).filter((r) => admiteReservas(r.marca));
    },
  });

  // Con datos guardados (caché o copia sin conexión, `cacheOffline.ts`) un fallo de red NO tapa la lista:
  // se siguen viendo las reservas que había y `AvisoSinConexion` dice de qué hora son.
  const errorReservasHoy = falloReservasHoy && !reservasHoy;
  // Con la copia del dispositivo en pantalla mientras se vuelve a pedir: «Actualizando…» (pastilla flotante).
  const avisoRed = (
    <>
      <AvisoSinConexion
        actualizadoEn={reservasHoyActualizadas}
        falloRed={(falloReservasHoy && esErrorDeRed(errorDetalleReservasHoy)) || estadoPeticionReservasHoy === "paused"}
      />
      <AvisoActualizando actualizadoEn={reservasHoyActualizadas} pidiendo={estadoPeticionReservasHoy === "fetching"} />
    </>
  );

  if (esMovil) {
    // Móvil (07/11/2026): los controles (Reservas|Mesas, turno, buscador y «Sin reserva») van en UNA fila
    // dentro de `VistaHoyMovil`, que guarda su propio buscador y turno (por defecto el del reloj).
    return (
      <ReservasEnVivoContexto.Provider value={true}>
        <div className="flex min-h-0 flex-col gap-1">
          {avisoRed}
          {errorReservasHoy ? (
            <EstadoErrorCarga titulo="las reservas de hoy" onReintentar={() => void refetchReservasHoy()} />
          ) : (
            <VistaHoyMovil reservas={reservasHoy} fecha={hoy} />
          )}
        </div>
      </ReservasEnVivoContexto.Provider>
    );
  }

  return (
    // `ReservasEnVivoContexto`: lo de dentro ya lo refresca `useReservasEnVivo` y no abre su propio canal a
    // `reservas`.
    <ReservasEnVivoContexto.Provider value={true}>
      {/* Nunca más alto que la pantalla (07/11/2026: en la captura del dueño la página hacía scroll y se cortaban
          «Nueva Reserva» arriba y la leyenda y la última fila abajo): el bloque mide lo que queda y recorta. */}
      <div
        ref={setBloqueEscritorio}
        className="flex min-h-0 flex-col gap-2 overflow-hidden"
        style={altoEscritorio ? { height: altoEscritorio } : undefined}
        data-testid="hoy-escritorio"
      >
        {avisoRed}
        <BarraFiltrosHoy
          dia={{ fecha: hoy, hoy: hoyReal, onCambiar: irADia }}
          // Bloqueo de comida / cena online del día elegido (10/11/2026), en la misma barra (11/11/2026).
          servicios={<InterruptoresServiciosOnline fecha={hoy} />}
          busqueda={busqueda}
          onBusqueda={setBusqueda}
          filtroTurno={filtroTurno}
          onFiltroTurno={cambiarTurno}
          accion={
            puedeEditar ? (
              <div className="flex shrink-0 gap-2">
                <Button className="touch-hit h-11 gap-1.5 px-4" onClick={pulsarOrganizar} disabled={!!organizando}>
                  <Wand2 className="h-4 w-4" aria-hidden="true" />
                  Organizar
                </Button>
                <BotonSentarSinReserva className="touch-hit h-11 shrink-0" />
              </div>
            ) : undefined
          }
        />

        {/* 07/11/2026: a la izquierda la lista completa del turno, por estados, en filas de una línea (con su
            scroll); a la derecha el plano de mesas grandes, una sala a la vez. Cada columna mide lo que queda de
            pantalla. 10/11/2026 («los nombres no se ven, y eso es lo primordial»): la lista crece a costa de las
            mesas (más pequeñas): 25 rem (tablet vertical), 30 rem (480 px, desde 1024), 32 rem (512 px, desde
            1280), 36 rem (576 px, desde 1536) y 42 rem (672 px, desde 1800). */}
        {/* 11/11/2026 («que la lista sea más ancha»): mitad y mitad en la tablet vertical; 36 rem desde 1024, 40 rem
            desde 1280, 44 rem desde 1536 y 48 rem desde 1800. */}
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)] xl:grid-cols-[40rem_minmax(0,1fr)] 2xl:grid-cols-[44rem_minmax(0,1fr)] min-[1800px]:grid-cols-[48rem_minmax(0,1fr)]">
          <section aria-label="Reservas por llegar" className="min-w-0">
            {errorReservasHoy ? (
              <EstadoErrorCarga titulo="las reservas de hoy" onReintentar={() => void refetchReservasHoy()} />
            ) : (
              <VistaHoyMovil
                reservas={reservasHoy}
                fecha={hoy}
                columna={{ busqueda, filtroTurno, canceladas: canceladasHoy, onSeñalar: setSeñalada }}
              />
            )}
          </section>
          <VistaPlanoHoy
            fijo
            reservas={reservasHoy}
            busqueda={busqueda}
            filtroTurno={filtroTurno}
            salaId={salaPlano}
            onCambiarSala={cambiarSala}
            organizar={organizando && puedeEditar ? { turno: organizando, onSalir: () => setOrganizando(null) } : null}
            reservasError={errorReservasHoy}
            onReintentarReservas={() => void refetchReservasHoy()}
            reservaResaltada={señalada}
            fecha={hoy}
          />
        </div>
      </div>
      <Dialog open={preguntarTurno && puedeEditar} onOpenChange={setPreguntarTurno}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Qué servicio organizo?</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {(["comida", "cena"] as const).map((t) => (
              <Button
                key={t}
                variant={t === turnoSiguiente() ? "default" : "outline"}
                className="h-16 text-lg"
                onClick={() => empezarOrganizar(t)}
              >
                {t === "comida" ? "Comida" : "Cena"}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </ReservasEnVivoContexto.Provider>
  );
}

/** El turno en curso o el siguiente: comida hasta las 16:00, después cena. */
function turnoSiguiente(): "comida" | "cena" {
  return new Date().getHours() < 16 ? "comida" : "cena";
}

/**
 * La fila de filtros de «Hoy» de escritorio: buscador, «Todo el día / Comida / Cena», las acciones y la ayuda.
 * Mandan a la vez en la lista de la izquierda y en el plano. (Hasta el 07/11/2026 llevaba el selector
 * «Kanban | Plano»; el kanban ya no sale en Hoy.)
 */
function BarraFiltrosHoy({
  dia,
  servicios,
  busqueda,
  onBusqueda,
  filtroTurno,
  onFiltroTurno,
  accion,
}: {
  /** El día que se ve, con flechas para pasar al anterior o al siguiente (11/11/2026). */
  dia?: { fecha: string; hoy: string; onCambiar: (fecha: string) => void };
  /** «Cerrar comida / Cerrar cena» del día elegido: a la derecha de las acciones. */
  servicios?: ReactNode;
  /** Botones de acción junto al turno («Organizar», «Sin reserva»). */
  accion?: ReactNode;
  busqueda: string;
  onBusqueda: (texto: string) => void;
  filtroTurno: FiltroTurnoHoy;
  onFiltroTurno: (turno: FiltroTurnoHoy) => void;
}) {
  // 11/11/2026 (dueño: «reestructura cómo se ven los botones… para que se vea toda la vista»): dos filas.
  // Arriba, qué se ve (día, turno y buscador); debajo, qué se hace (Organizar, Sin reserva) y, a la derecha,
  // «Cerrar comida / Cerrar cena». Cada fila salta de línea si no cabe, nunca se corta.
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {dia && (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Día">
            <Button type="button" variant="outline" size="icon" className="touch-hit h-11 w-11" aria-label="Día anterior" onClick={() => dia.onCambiar(sumarDias(dia.fecha, -1))}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <span className="min-w-[10.5rem] px-1 text-center text-base font-semibold" aria-live="polite" data-testid="dia-reservas">
              {etiquetaDiaReservas(dia.fecha, dia.hoy)}
            </span>
            <Button type="button" variant="outline" size="icon" className="touch-hit h-11 w-11" aria-label="Día siguiente" onClick={() => dia.onCambiar(sumarDias(dia.fecha, 1))}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
            {dia.fecha !== dia.hoy && (
              <Button type="button" variant="ghost" className="touch-hit h-11 px-3" onClick={() => dia.onCambiar(dia.hoy)}>
                Hoy
              </Button>
            )}
          </div>
        )}
        <ToggleGroup
          type="single"
          value={filtroTurno}
          onValueChange={(v) => v && onFiltroTurno(v as FiltroTurnoHoy)}
          variant="outline"
          className="shrink-0"
          aria-label="Filtrar por turno"
        >
          <ToggleGroupItem value="todo" className="touch-hit h-11 whitespace-nowrap">Todo el día</ToggleGroupItem>
          <ToggleGroupItem value="comida" className="touch-hit h-11 whitespace-nowrap">Comida</ToggleGroupItem>
          <ToggleGroupItem value="cena" className="touch-hit h-11 whitespace-nowrap">Cena</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative min-w-[12rem] flex-1 basis-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por nombre, email o teléfono…"
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            className="h-11 pl-9"
            aria-label="Buscar reservas"
          />
        </div>
      </div>
      {(accion || servicios) && (
        <div className="flex flex-wrap items-center gap-2">
          {accion}
          {servicios && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{servicios}</div>}
        </div>
      )}
    </div>
  );
}
