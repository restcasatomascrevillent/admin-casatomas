// ============================================================================
// ELEGIR LA MESA DE UNA RESERVA EN EL PLANO DE SU SALA — el diálogo del kanban
// ----------------------------------------------------------------------------
// Petición del dueño (2026-10-01): «si yo paso a la persona de Salón a Reservado,
// que al llevarla me enseñe el mapa de esa sala para ponerle la mesa que quiero».
//
// Qué hay y qué NO hay aquí
//   · NO se reimplementa nada de la asignación. Dentro va `PlanoEspacio2D`, el mismo
//     plano que abren «Mesas» (pestaña Asignación) y «Dar mesa» (Lista) por el salto de
//     `saltoAsignacion.ts`: reserva ya señalada («Sentando a Ana»), clic en una mesa libre
//     y guardado por el RPC `asignar_mesas_reserva` (solapes, capacidad, avisos y
//     «Deshacer» son los suyos). Esas dos entradas llevan a una PÁGINA entera (la sustituyen
//     desde `Reservas.tsx`); aquí hace falta quedarse en el kanban, de ahí el diálogo.
//   · Lo único propio: cuándo abrir, cómo se ve y cómo se cierra.
//
// CUÁNDO ABRE (y cuándo no, en silencio)
//   El kanban lo monta tras un movimiento ya GUARDADO a una sala. Este componente no pinta
//   nada hasta saber dos cosas, las dos pedidas de nuevo (no de la caché de antes):
//     1. Que la sala tiene mesas. Hay salas sin plano ni mesas (las de Touza, alguna terraza…):
//        no hay nada que elegir y se avisa al padre de que se cierre, sin ni un destello. Se
//        decide por el ID de la sala y por sus mesas; el nombre solo se usa para escribir el título
//        (hay dos «Terraza», una por negocio, y «Reservado» frente a «El Reservado»).
//     2. Que la lista de reservas de esa sala está al día. `PlanoEspacio2D` busca la reserva
//        señalada en `reservas_sala_dia` UNA sola vez, en cuanto hay datos; si arrancara con
//        la lista cacheada de antes del movimiento no la encontraría y la daría por perdida
//        («Esa reserva no está en Reservado…»). Mover ya invalidó esa clave, así que basta
//        esperar a que termine su refresco.
//   Una vez abierto no se vuelve a esconder por refrescos en segundo plano.
//
// LA URL
//   El plano apunta `?fecha=&turno=` en la URL al atender la reserva señalada. Dentro del
//   kanban eso no debe quedarse pegado: al cerrar se devuelve la URL a como estaba (si no,
//   la próxima vez que se abra el plano de una sala desde «Pendientes de mesa» saldría con el
//   turno de la última reserva movida y no con el del reloj).
//
// CERRAR
//   «Ahora no», la X, Escape o el «Volver» del plano: la reserva se queda en su sala nueva,
//   sin mesa (estado normal, nunca un error). No se cierra solo al dar mesa: si no caben,
//   el plano invita a juntar otra y cerrar de golpe lo impediría; cuando ya tiene mesa, el
//   botón de salida pasa de «Ahora no» a «Listo» y la cabecera dice cuál tiene.
//   Sí se cierra solo si la reserva deja de estar en la sala (el «Deshacer» del aviso de
//   «Ana → Reservado» la devolvió, o la movió otra persona): el mapa ya no sería suyo.
//
// TAMAÑO
//   Móvil: pantalla entera (el plano es denso; un diálogo pequeño sería inmanejable).
//   Escritorio y tablet: casi toda la ventana. Sin pie: la salida está en la cabecera porque
//   el aviso «Ana → Reservado · Deshacer» (10 s, abajo a la derecha) tapaba un botón de pie.
//   El plano está pensado como pantalla (`min-h-[calc(100vh-220px)]` en su raíz): dentro del
//   diálogo manda la altura del diálogo. Ver `AJUSTES_DEL_PLANO`.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { useMesas } from "@/hooks/useMesas";
import { horaCorta } from "@/lib/reservas/ocupacionSalas";
import { resolverSaltoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { nombreMesasJuntas, useReservasDeSala } from "./asignacionPlano";
import { PlanoEspacio2D } from "./PlanoEspacio2D";

/** Lo que hace falta saber de la reserva: sale tal cual de la tarjeta del kanban. */
export interface ReservaParaElegirMesa {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
}

export interface ElegirMesaDialogProps {
  reserva: ReservaParaElegirMesa;
  /** Día de la reserva, `YYYY-MM-DD`. */
  fecha: string;
  /** La sala a la que se acaba de mover (y de la que se elige la mesa). */
  espacioId: string;
  espacioNombre: string;
  /** El padre deja de pintar este diálogo. También se llama, sin haber abierto nada, si no hay mapa que enseñar. */
  onCerrar: () => void;
}

/** Parámetros de la URL que escribe el plano y que hay que devolver a como estaban. */
const PARAMS_DEL_PLANO = ["fecha", "turno", "reserva"] as const;

/**
 * Ajustes de la caja que envuelve al plano para que quepa en un diálogo.
 *   · `[&>div:first-child]`: la raíz del plano (el resto de hijos son los avisos ocultos de dnd-kit).
 *   · Sin `lg`: altura natural y el cuerpo del diálogo hace scroll (en una columna la lista de
 *     reservas va debajo del mapa).
 *   · Con `lg`: la raíz mide lo que el cuerpo (como mínimo 34rem, lo que necesita el mapa) y la
 *     lista de reservas se desplaza DENTRO de su panel en vez de estirar el mapa.
 */
const AJUSTES_DEL_PLANO =
  "h-full [&>div:first-child]:min-h-0 lg:[&>div:first-child]:h-full lg:[&>div:first-child]:min-h-[34rem]";

type Fase = "comprobando" | "abierto" | "descartado";

export function ElegirMesaDialog({ reserva, fecha, espacioId, espacioNombre, onCerrar }: ElegirMesaDialogProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  // La URL tal como estaba ANTES de que el plano escriba en ella (se lee en el primer render).
  const urlAlAbrir = useRef<Record<(typeof PARAMS_DEL_PLANO)[number], string | null>>({
    fecha: searchParams.get("fecha"),
    turno: searchParams.get("turno"),
    reserva: searchParams.get("reserva"),
  });

  // El mismo salto que usan «Mesas» y «Dar mesa»: decide si esta reserva se puede sentar y trae el
  // turno deducido de su hora. `espacio_id` es el de DESTINO (la `reserva` que llega es la de antes de moverla).
  const { destino } = useMemo(
    () =>
      resolverSaltoAsignacion(
        { id: reserva.id, fecha, hora: reserva.hora, espacio_id: espacioId, estado: reserva.estado },
        { yaTieneMesa: false, nombreSala: espacioNombre },
      ),
    [reserva.id, reserva.hora, reserva.estado, fecha, espacioId, espacioNombre],
  );

  // Mismas consultas (y mismas claves de caché) que hace el plano: él las reutiliza ya calientes.
  const mesas = useMesas(espacioId);
  const reservasSala = useReservasDeSala(espacioId, fecha);
  const asignaciones = useAsignacionesMesa(fecha, espacioId, destino?.turno);

  const [fase, setFase] = useState<Fase>("comprobando");
  const comprobada = !mesas.isFetching && !reservasSala.isFetching;

  useEffect(() => {
    if (fase !== "comprobando") return;
    // Reserva cancelada o sin fecha: no hay nada que sentar.
    if (!destino) {
      setFase("descartado");
      onCerrar();
      return;
    }
    if (!comprobada) return;

    if (mesas.isError) {
      setFase("descartado");
      toast.error(
        `No se pudo abrir el mapa de ${espacioNombre}. La reserva ya está en esa sala: puedes darle mesa desde «Pendientes de mesa».`,
      );
      onCerrar();
    } else if ((mesas.data?.length ?? 0) === 0) {
      // Sala sin mesas (hay salas sin plano): nada que elegir y nada que contar.
      setFase("descartado");
      onCerrar();
    } else {
      setFase("abierto");
    }
  }, [fase, destino, comprobada, mesas.isError, mesas.data, espacioNombre, onCerrar]);

  // Una sola vez: Escape + clic + el refresco que lo cierra solo no deben avisar al padre varias veces.
  const yaCerrado = useRef(false);
  const cerrar = useCallback(() => {
    if (yaCerrado.current) return;
    yaCerrado.current = true;
    const antes = urlAlAbrir.current;
    if (PARAMS_DEL_PLANO.some((clave) => searchParams.get(clave) !== antes[clave])) {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const clave of PARAMS_DEL_PLANO) {
            const valor = antes[clave];
            if (valor === null) params.delete(clave);
            else params.set(clave, valor);
          }
          return params;
        },
        { replace: true },
      );
    }
    onCerrar();
  }, [onCerrar, searchParams, setSearchParams]);

  // Si la reserva deja de estar en la sala después de haber estado, el mapa ya no es suyo.
  const estuvoEnLaSala = useRef(false);
  const enLaSala = reservasSala.data?.some((r) => r.id === reserva.id);
  useEffect(() => {
    if (fase !== "abierto" || reservasSala.isFetching || !reservasSala.data) return;
    if (enLaSala) estuvoEnLaSala.current = true;
    else if (estuvoEnLaSala.current) cerrar();
  }, [fase, reservasSala.isFetching, reservasSala.data, enLaSala, cerrar]);

  // El foco inicial va al propio diálogo y no al primer botón (el de salida, que saldría con el aro de foco
  // como si fuera la acción recomendada). Con el teclado, Tab sigue llegando a «Ahora no» el primero.
  const contenidoRef = useRef<HTMLDivElement>(null);

  if (fase !== "abierto" || !destino) return null;

  const nombre = reserva.nombre?.trim() || "esta reserva";
  const comensales = Number(reserva.numero_comensales) || 0;
  const mesasDeLaReserva = (asignaciones.data ?? [])
    .filter((a) => a.reserva_id === reserva.id)
    .map((a) => a.mesas?.nombre ?? "Mesa")
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  const conMesa = mesasDeLaReserva.length > 0;

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto) cerrar();
      }}
    >
      <DialogContent
        ref={contenidoRef}
        onOpenAutoFocus={(evento) => {
          evento.preventDefault();
          contenidoRef.current?.focus();
        }}
        className={
          // `outline-none`: el diálogo recibe el foco como contenedor (no es un control) y sin esto el
          // navegador le dibujaría un aro alrededor de toda la ventana.
          "flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 outline-none " +
          "sm:h-[min(92dvh,52rem)] sm:max-h-[92dvh] sm:w-[min(96vw,80rem)] sm:rounded-lg sm:border"
        }
      >
        {/* La salida («Ahora no» / «Listo») va ARRIBA, no en un pie: el aviso «Ana → Reservado · Deshacer»
            sale abajo a la derecha durante 10 s y tapaba justo el botón. */}
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left sm:px-6 sm:pr-14">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-balance text-base leading-snug sm:text-lg">
                Elige la mesa de {nombre} en {espacioNombre}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1 font-medium tabular-nums text-foreground">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {horaCorta(reserva.hora) ?? reserva.hora}
                  </span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    {`${comensales} ${comensales === 1 ? "comensal" : "comensales"}`}
                  </span>
                  {conMesa ? (
                    <span role="status" className="font-medium text-emerald-700 dark:text-emerald-400">
                      {`${nombreMesasJuntas(mesasDeLaReserva)} ${mesasDeLaReserva.length === 1 ? "asignada" : "asignadas"}`}
                    </span>
                  ) : (
                    <span>{`Ya está en ${espacioNombre}. Puedes darle mesa ahora o más tarde.`}</span>
                  )}
                </div>
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant={conMesa ? "default" : "outline"}
              className="h-11 w-full shrink-0 touch-manipulation sm:w-auto sm:min-w-[7rem]"
              onClick={cerrar}
            >
              {conMesa ? "Listo" : "Ahora no"}
            </Button>
          </div>
        </DialogHeader>

        {/* `overscroll-contain`: llegar al final de este scroll no arrastra la página de detrás. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className={AJUSTES_DEL_PLANO}>
            {/* `key`: otra reserva u otra sala monta un plano nuevo, con su estado limpio. */}
            <PlanoEspacio2D
              key={`${reserva.id}|${espacioId}`}
              espacioId={espacioId}
              espacioNombre={espacioNombre}
              onBack={cerrar}
              fecha={destino.fecha}
              turno={destino.turno}
              reservaId={destino.reservaId}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
