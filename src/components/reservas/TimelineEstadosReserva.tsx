import { useId, useMemo, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ESTADOS_RESERVA, ORDEN_ESTADOS, type EstadoReserva } from "@/lib/reservas/estadosReserva";

/**
 * Timeline de los estados de una reserva (pestaña "Hoy", 2026-09-30): qué
 * estados existen, cómo avanza una reserva y qué le toca hacer al personal en
 * cada paso. Es una leyenda de los badges de la lista y del kanban.
 *
 * ----------------------------------------------------------------------------
 * LOS SEIS ESTADOS Y QUIÉN MUEVE CADA UNO (comprobado en el código, no en la doc)
 * ----------------------------------------------------------------------------
 * CHECK `reservas_estado_check`: pendiente | verificada | confirmada |
 * cancelada | completada | no_show. "rechazada" NO existe: el botón «Rechazar»
 * del modal de verificación deja la reserva en `cancelada`.
 *
 *   pendiente → verificada   Personal, con «Aceptar» (un clic, tal como está, sin
 *                            tocar hora ni sala) o «Verificar» (modal, otra hora). Sale
 *                            el correo «Confirma tu reserva»; si el cliente no
 *                            tiene email, hay que avisarle por teléfono
 *                            (`useVerificacionReservas.ts`).
 *   verificada → confirmada  El cliente, desde el botón del correo
 *                            (`emails-reserva`, acción "aceptar"), o el personal
 *                            con «Confirmar» (`ListaReservasAvanzada`).
 *   viva → completada        Personal, con «Ha llegado» (`ControlLlegada`), desde
 *                            pendiente, verificada o confirmada. Se muestra como
 *                            «Llegó»: es el nombre de los badges.
 *   viva → cancelada         Personal («Cancelar», o «Rechazar» si estaba
 *                            pendiente) o el cliente (correo o teléfono). Solo
 *                            mientras está viva: una reserva «Llegó» o «No vino»
 *                            ya no se cancela (decisión del dueño).
 *   viva → no_show           Personal, con «No vino». Además, el cron
 *                            nocturno `emails-reserva/detectar-ausencias` marca
 *                            así toda `confirmada` con más de 3 h de retraso que
 *                            nadie marcó como llegada.
 *
 * («viva» = pendiente, verificada o confirmada: las que cuentan para el aforo.)
 *
 * Diferencia con lo que se supone a simple vista: una reserva dada de alta a
 * mano desde el panel NO nace `pendiente`, nace `verificada` (decisión del
 * dueño 2026-09-23, `altaPanel.ts`); solo la web y el teléfono entran en
 * `pendiente`.
 *
 * ----------------------------------------------------------------------------
 * ETIQUETAS, ICONOS Y COLORES: LOS DE `ESTADOS_RESERVA`
 * ----------------------------------------------------------------------------
 * Salen de `ESTADOS_RESERVA` (src/lib/reservas/estadosReserva.ts), la fuente única
 * que también lee el kanban: mismos nombres —«Llegó», «No vino»—, mismos iconos y
 * los tokens `status-*` del tema. Aquí solo se decide el DIBUJO: los cuatro
 * primeros estados, en orden, son el camino y los dos últimos las salidas.
 *
 * Contraste: el token `status-pending-foreground` es blanco en oscuro y sobre el
 * ámbar no llega ni a 2:1; en `ESTADOS_RESERVA.pendiente.burbuja` el icono de
 * «Pendiente» pasa a `text-background` en oscuro (~7:1). Los demás iconos rondan 3,3–3,8:1 o más, y ninguno va solo:
 * el estado siempre lleva su nombre escrito al lado. (Hoy el panel no enciende
 * el modo oscuro —el bloque `.dark` de index.css se purga en el build y nada
 * añade la clase—, pero las clases `dark:` ya están por si se activa.)
 *
 * ----------------------------------------------------------------------------
 * CIFRAS DE HOY
 * ----------------------------------------------------------------------------
 * Opcionales y SIN consulta propia. `VistaHoy` ya tiene las reservas de hoy
 * (no canceladas, con su `estado`) y la cifra de canceladas del resumen, y las
 * pasa tal cual. Si `reservas` no llega (cargando o con error) no se pinta
 * ninguna cifra: mejor nada que un 0 falso.
 *
 * ALTURA: el dueño ya pidió (2026-09-25) que la parte de arriba no se coma la
 * pantalla, así que va plegable y recuerda la elección en este navegador.
 * Abierta por defecto: quien no la conoce tiene que verla sin buscarla.
 */

interface NodoEstado {
  estado: EstadoReserva;
  /** Nombre tal y como sale en los badges. */
  nombre: string;
  icono: LucideIcon;
  /** Relleno y color del icono. */
  burbuja: string;
  /** Solo las salidas: cuándo se da, en negrita delante del texto. */
  cuando?: string;
  /** Qué significa y qué toca hacer, en una frase. */
  texto: string;
}

const aNodo = (estado: EstadoReserva): NodoEstado => {
  const { etiqueta, Icono, burbuja, cuando, descripcion } = ESTADOS_RESERVA[estado];
  return { estado, nombre: etiqueta, icono: Icono, burbuja, cuando, texto: descripcion };
};

/** Pasos del camino principal: los cuatro primeros del ciclo de vida. Rellenos sólidos, unidos por una línea continua. */
const PASOS_DEL_CAMINO = 4;
const CAMINO: readonly NodoEstado[] = ORDEN_ESTADOS.slice(0, PASOS_DEL_CAMINO).map(aNodo);

/** Las salidas: no son un paso más, son por donde se sale del camino. Borde discontinuo. */
const SALIDAS: readonly NodoEstado[] = ORDEN_ESTADOS.slice(PASOS_DEL_CAMINO).map(aNodo);

const ESTADOS_CONOCIDOS: ReadonlySet<string> = new Set(ORDEN_ESTADOS);

type CifrasPorEstado = Record<EstadoReserva, number>;

/**
 * Cuenta las reservas de hoy por estado. `null` si las reservas no han llegado:
 * sin dato no hay cifras. `canceladas` manda sobre lo que se cuente en las
 * filas, porque quien llama excluye las canceladas de la consulta y la cifra
 * real la trae el resumen. Un estado que no es de los seis (no debería existir
 * por el CHECK) no se cuenta en ninguno.
 */
function contarPorEstado(
  reservas: readonly { estado: string }[] | null | undefined,
  canceladas: number | null | undefined,
): CifrasPorEstado | null {
  if (!reservas) return null;
  const cifras: CifrasPorEstado = {
    pendiente: 0,
    verificada: 0,
    confirmada: 0,
    completada: 0,
    cancelada: 0,
    no_show: 0,
  };
  for (const r of reservas) {
    if (ESTADOS_CONOCIDOS.has(r.estado)) cifras[r.estado as EstadoReserva] += 1;
  }
  if (typeof canceladas === "number") cifras.cancelada = canceladas;
  return cifras;
}

// Preferencia por navegador (plegada o no). Puede fallar —almacenamiento
// bloqueado, modo privado—: en ese caso simplemente no se recuerda.
const CLAVE_ABIERTO = "reservas:timeline-estados:abierto";

function leerAbierto(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_ABIERTO) !== "0";
  } catch {
    return true;
  }
}

function guardarAbierto(abierto: boolean) {
  try {
    window.localStorage.setItem(CLAVE_ABIERTO, abierto ? "1" : "0");
  } catch {
    // Sin almacenamiento: la próxima vez vuelve a salir abierta.
  }
}

export interface TimelineEstadosReservaProps {
  /**
   * Reservas de HOY que no están canceladas (solo se lee `estado`). Con ellas
   * se pinta la cifra de cada nodo. Sin ellas, sin cifras.
   */
  reservas?: readonly { estado: string }[] | null;
  /** Canceladas de hoy (no vienen en `reservas`). */
  canceladas?: number | null;
  className?: string;
}

export function TimelineEstadosReserva({ reservas, canceladas, className }: TimelineEstadosReservaProps) {
  const idTitulo = useId();
  const [abierto, setAbierto] = useState(leerAbierto);
  const cifras = useMemo(() => contarPorEstado(reservas, canceladas), [reservas, canceladas]);

  const alCambiar = (valor: boolean) => {
    setAbierto(valor);
    guardarAbierto(valor);
  };

  return (
    <Collapsible open={abierto} onOpenChange={alCambiar} asChild>
      <section
        aria-labelledby={idTitulo}
        className={cn("rounded-xl border bg-card/50 px-3 py-1.5 sm:px-4", className)}
      >
        <h3 id={idTitulo}>
          <CollapsibleTrigger
            className={cn(
              "group flex min-h-7 w-full items-center justify-between gap-2 rounded-md text-left touch-manipulation",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cómo avanza una reserva
              {cifras && <span className="ml-1 font-normal normal-case tracking-normal"> · cifras de hoy</span>}
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
        </h3>

        <CollapsibleContent>
          {/* Por debajo de `xl` (unos 976px de contenido con el menú abierto) los
              seis nodos no caben con su frase: la lista mantiene un ancho mínimo y
              ESTE contenedor —no la página— hace scroll. Desde `xl` cabe todo y
              no hay barra. `overscroll-x-contain` evita que el gesto de deslizar
              llegue al final y dispare el "atrás" del navegador.

              `relative` NO es decorativo: los `sr-only` son `position:absolute`, y
              sin un ancestro posicionado su bloque contenedor es la ventana, no
              este scroller — no los recorta y los que caen fuera de la vista
              ensanchan el documento entero (medido: 1213px en una ventana de
              1024, con barra de scroll horizontal en toda la página). */}
          <div className="relative overflow-x-auto overscroll-x-contain pb-1.5 pt-0.5 xl:overflow-visible">
            <ol aria-labelledby={idTitulo} className="flex min-w-[60rem] gap-3 xl:min-w-0">
              {CAMINO.map((nodo, i) => (
                <Nodo
                  key={nodo.estado}
                  nodo={nodo}
                  cifra={cifras?.[nodo.estado]}
                  paso={{ n: i + 1, de: CAMINO.length }}
                  conConector={i < CAMINO.length - 1}
                />
              ))}
              {SALIDAS.map((nodo, i) => (
                <Nodo key={nodo.estado} nodo={nodo} cifra={cifras?.[nodo.estado]} abreSalidas={i === 0} />
              ))}
            </ol>
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function Nodo({
  nodo,
  cifra,
  paso,
  conConector,
  abreSalidas,
}: {
  nodo: NodoEstado;
  cifra?: number;
  /** Solo el camino principal: "paso n de N" para lectores de pantalla. */
  paso?: { n: number; de: number };
  /** Línea continua hasta el siguiente paso. */
  conConector?: boolean;
  /** Primera salida: lleva la raya discontinua que la separa del camino. */
  abreSalidas?: boolean;
}) {
  const Icono = nodo.icono;

  return (
    <li
      data-estado={nodo.estado}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1",
        abreSalidas && "border-l-2 border-dashed border-muted-foreground/40 pl-3",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", nodo.burbuja)}>
          <Icono className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="sr-only">{paso ? `Paso ${paso.n} de ${paso.de}: ` : "Salida: "}</span>
          <span className="text-sm font-semibold leading-tight text-foreground">{nodo.nombre}</span>
          {cifra !== undefined && <Cifra n={cifra} />}
        </span>
        {conConector && (
          // `-mr-3` alarga la línea a lo largo del hueco entre nodos (`gap-3`)
          // hasta tocar el círculo del siguiente.
          <span aria-hidden="true" className="-mr-3 h-0.5 min-w-3 flex-1 rounded-full bg-muted-foreground/35" />
        )}
      </div>
      <p className="text-pretty text-xs leading-snug text-muted-foreground">
        {nodo.cuando && <span className="font-medium text-foreground">{nodo.cuando} </span>}
        {nodo.texto}
      </p>
    </li>
  );
}

function Cifra({ n }: { n: number }) {
  return (
    <span
      data-cifra={n}
      className={cn(
        "rounded-full px-1.5 text-[11px] font-semibold leading-5 tabular-nums",
        n > 0 ? "bg-muted text-foreground" : "text-muted-foreground",
      )}
    >
      {n}
      <span className="sr-only"> {n === 1 ? "reserva" : "reservas"} hoy</span>
    </span>
  );
}
