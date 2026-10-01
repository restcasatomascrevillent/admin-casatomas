import { useId, useMemo, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ESTADOS_RESERVA, ORDEN_ESTADOS, type EstadoReserva } from "@/lib/reservas/estadosReserva";
import { ALCANCE_HOY, contarPorEstado, type AlcanceCifras, type CifrasPorEstado } from "@/lib/reservas/cifrasPorEstado";

/**
 * Timeline de los estados de una reserva (pestañas "Hoy", 2026-09-30, y "Lista",
 * 2026-10-01): qué estados existen, cómo avanza una reserva y qué le toca hacer
 * al personal en cada paso. Es una leyenda de los badges de la lista y del kanban.
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
 * CIFRAS: DE HOY (PESTAÑA HOY) O DE LA LISTA (PESTAÑA LISTA)
 * ----------------------------------------------------------------------------
 * Opcionales y SIN consulta propia: quien monta el timeline ya tiene las
 * reservas cargadas y se las pasa. Hay dos vías:
 *   · `reservas` + `canceladas` (pestaña Hoy): `VistaHoy` ya tiene las reservas
 *     de hoy (no canceladas, con su `estado`) y la cifra de canceladas del
 *     resumen, y las pasa tal cual; el timeline las cuenta.
 *   · `cifras` (pestaña Lista): las seis cifras YA CONTADAS. Las cuenta la propia
 *     lista, porque solo ella sabe qué filtros hay puestos (ver
 *     `cifrasDeLaLista`, en `src/lib/reservas/cifrasPorEstado.ts`: cuenta las
 *     reservas que se ven en la lista SIN el filtro de estado y sin las de Touza,
 *     que no admite reservas). Si llegan, mandan sobre `reservas` y `canceladas`.
 * Si no llega ninguna (cargando o con error) no se pinta ninguna cifra: mejor
 * nada que un 0 falso.
 *
 * `alcance` dice QUÉ se está contando, y se escribe en la cabecera («cifras de
 * hoy», «cifras de la lista de hoy»…) y al leer cada cifra en voz alta («2
 * reservas hoy», «2 reservas en la lista»). Sin él, el de la pestaña Hoy.
 *
 * ----------------------------------------------------------------------------
 * NODOS PULSABLES (SOLO SI QUIEN LO MONTA LOS PIDE): `onElegirEstado`
 * ----------------------------------------------------------------------------
 * La Lista ya tiene un filtro «Estado»; con `onElegirEstado` cada estado pasa
 * a ser un botón de alternancia que lo cambia, y `estadoActivo` marca cuál está
 * puesto. El timeline NO decide nada: avisa de qué estado se ha pulsado (su clave
 * de la BD, `completada`, no «Llegó») y quien lo monta ya sabrá si eso lo activa o
 * lo desactiva (en la Lista, volver a pulsar el activo lo quita).
 *   · Es un `<button type="button" aria-pressed>`: teclado (Tab, Intro, Espacio)
 *     y lector de pantalla sin código extra.
 *   · Se pulsa en TODO el nodo (icono, nombre, cifra y frase), no solo en el texto
 *     del botón: la zona de pulsación es un pseudo-elemento que cubre el nodo
 *     (el patrón «stretched link»; el nodo es `relative`). Así el blanco es
 *     grande en el móvil y la frase sigue siendo un `<p>` normal, fuera del botón.
 *   · Marcado: el estado pulsado lleva una barra gruesa por debajo, el nombre
 *     subrayado y la cifra en negativo. NO se usa un contorno entero porque ese es
 *     el del foco del teclado, y pulsado y enfocado no se pueden confundir.
 *   · Sin `onElegirEstado` (la pestaña Hoy) el timeline es lo de siempre: una
 *     leyenda, sin botones ni nada que pulsar. `estadoActivo` solo vale con él.
 *
 * ----------------------------------------------------------------------------
 * PLEGADO: UNA SOLA PREFERENCIA PARA LAS DOS PESTAÑAS
 * ----------------------------------------------------------------------------
 * El dueño ya pidió (2026-09-25) que la parte de arriba no se coma la pantalla,
 * así que va plegable y recuerda la elección en este navegador. Abierta por
 * defecto: quien no la conoce tiene que verla sin buscarla.
 *
 * Hoy y Lista comparten la clave (`CLAVE_ABIERTO`): es el mismo componente y el
 * mismo gesto («no quiero verlo»), y si lo pliegas en una pestaña no tiene
 * sentido que reaparezca abierto en la otra. El coste: no se puede tenerlo
 * abierto en Hoy y plegado en la Lista. Si algún día el dueño lo pide, basta con
 * una prop `claveAbierto` (una línea por pestaña); hoy sería complejidad que
 * nadie ha pedido. Las pestañas se desmontan al cambiar (Radix `Tabs`), así que
 * la que se abre siempre lee la preferencia al montarse.
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

// El recuento por estado (`contarPorEstado`) vive en `src/lib/reservas/cifrasPorEstado.ts`
// junto al de la Lista (`cifrasDeLaLista`): así las dos pestañas cuentan igual y se prueba
// sin pintar nada.

// Preferencia por navegador (plegada o no), UNA para las dos pestañas (ver la cabecera:
// «Plegado»). Puede fallar —almacenamiento bloqueado, modo privado—: en ese caso
// simplemente no se recuerda.
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
   * Pestaña HOY. Reservas de HOY que no están canceladas (solo se lee `estado`).
   * Con ellas se pinta la cifra de cada nodo. Sin ellas (ni `cifras`), sin cifras.
   */
  reservas?: readonly { estado: string }[] | null;
  /** Pestaña HOY. Canceladas de hoy (no vienen en `reservas`). */
  canceladas?: number | null;
  /**
   * Pestaña LISTA. Las seis cifras ya contadas por quien monta el timeline (la
   * Lista, con sus filtros: ver `cifrasDeLaLista`). Si llegan, mandan sobre
   * `reservas` y `canceladas`; `null` = sin dato, ninguna cifra.
   */
  cifras?: CifrasPorEstado | null;
  /** Qué se está contando, para la cabecera y la lectura de cada cifra. Por defecto, el de la pestaña Hoy. */
  alcance?: AlcanceCifras;
  /**
   * Hace pulsables los nodos: cada estado es un botón de alternancia que llama a
   * esto con su clave de la BD (`completada`, no «Llegó»). Sin él, el timeline es
   * una leyenda sin botones. Quien lo monta decide qué hace pulsarlo.
   */
  onElegirEstado?: (estado: EstadoReserva) => void;
  /**
   * Con `onElegirEstado`: el estado que está elegido ahora (sale pulsado). Cualquier
   * otro valor —«all», «solicitudes», vacío— no marca ninguno.
   */
  estadoActivo?: string | null;
  className?: string;
}

export function TimelineEstadosReserva({
  reservas,
  canceladas,
  cifras: cifrasDadas,
  alcance = ALCANCE_HOY,
  onElegirEstado,
  estadoActivo,
  className,
}: TimelineEstadosReservaProps) {
  const idTitulo = useId();
  const [abierto, setAbierto] = useState(leerAbierto);
  const cifras = useMemo(
    () => (cifrasDadas !== undefined ? cifrasDadas : contarPorEstado(reservas, canceladas)),
    [cifrasDadas, reservas, canceladas],
  );
  const pulsables = onElegirEstado !== undefined;

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
              {cifras && (
                <span className="ml-1 font-normal normal-case tracking-normal">{` · ${alcance.cabecera}`}</span>
              )}
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
              1024, con barra de scroll horizontal en toda la página).

              `-mx-1 px-1` SOLO con nodos pulsables: la zona de pulsación (y su
              anillo de foco) sobresale 4px del nodo por los lados, y este
              contenedor, al hacer scroll, recorta lo que se sale de su caja.
              Con 4px de relleno propio —y el margen negativo que lo compensa,
              dentro del relleno de la tarjeta— el anillo del primer nodo no
              queda cortado y nada se mueve de sitio. */}
          <div
            className={cn(
              "relative overflow-x-auto overscroll-x-contain pb-1.5 pt-0.5 xl:overflow-visible",
              pulsables && "-mx-1 px-1",
            )}
          >
            <ol aria-labelledby={idTitulo} className="flex min-w-[60rem] gap-3 xl:min-w-0">
              {CAMINO.map((nodo, i) => (
                <Nodo
                  key={nodo.estado}
                  nodo={nodo}
                  cifra={cifras?.[nodo.estado]}
                  lectura={alcance.lectura}
                  paso={{ n: i + 1, de: CAMINO.length }}
                  conConector={i < CAMINO.length - 1}
                  onElegir={onElegirEstado}
                  activo={pulsables && nodo.estado === estadoActivo}
                />
              ))}
              {SALIDAS.map((nodo, i) => (
                <Nodo
                  key={nodo.estado}
                  nodo={nodo}
                  cifra={cifras?.[nodo.estado]}
                  lectura={alcance.lectura}
                  abreSalidas={i === 0}
                  onElegir={onElegirEstado}
                  activo={pulsables && nodo.estado === estadoActivo}
                />
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
  lectura,
  paso,
  conConector,
  abreSalidas,
  activo = false,
  onElegir,
}: {
  nodo: NodoEstado;
  cifra?: number;
  /** Lo que sigue a «N reservas» al leer la cifra: «hoy», «en la lista»… */
  lectura: string;
  /** Solo el camino principal: "paso n de N" para lectores de pantalla. */
  paso?: { n: number; de: number };
  /** Línea continua hasta el siguiente paso. */
  conConector?: boolean;
  /** Primera salida: lleva la raya discontinua que la separa del camino. */
  abreSalidas?: boolean;
  /** Solo con `onElegir`: este estado es el que está elegido ahora. */
  activo?: boolean;
  /** Si llega, el nodo es un botón de alternancia que avisa con su estado; si no, es una leyenda. */
  onElegir?: (estado: EstadoReserva) => void;
}) {
  const Icono = nodo.icono;

  const nombre = (
    <span
      className={cn(
        "text-sm font-semibold leading-tight text-foreground",
        activo && "underline decoration-2 underline-offset-4",
      )}
    >
      {nodo.nombre}
    </span>
  );
  const pastilla = cifra !== undefined && <Cifra n={cifra} lectura={lectura} activa={activo} />;

  return (
    <li
      data-estado={nodo.estado}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1",
        abreSalidas && "border-l-2 border-dashed border-muted-foreground/40 pl-3",
        // Ancla de la zona de pulsación (el pseudo-elemento del botón): ver más abajo.
        onElegir && "relative",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", nodo.burbuja)}>
          <Icono className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="sr-only">{paso ? `Paso ${paso.n} de ${paso.de}: ` : "Salida: "}</span>
          {onElegir ? (
            // Botón de alternancia. Solo contiene el nombre y la cifra (así se llama el botón: «Llegó 30
            // reservas en la lista»); el «Paso n de N» queda fuera y la frase de abajo sigue siendo un `<p>`.
            // `{" "}` separa nombre y cifra para el lector de pantalla (en un flex el espacio no se pinta).
            //
            // La zona de pulsación es el `::after`, que cubre TODO el nodo (el `<li>` es `relative`): blanco
            // grande en el móvil, y la frase sigue siendo un `<p>` normal fuera del botón. Se pasa 4px por los
            // lados, 2px por arriba y 4px por abajo (el scroller de arriba deja ese hueco: `-mx-1 px-1`
            // a los lados, su `pt-0.5` arriba y su `pb-1.5` abajo).
            // Estados, cada uno distinto de los demás para que pulsado y enfocado no se confundan:
            //   · pasar el ratón: contorno suave;
            //   · foco de teclado: anillo entero (`ring-ring`, el de toda la app) — el contorno del botón se
            //     quita porque lo sustituye este;
            //   · pulsado: barra gruesa recta por debajo del nodo, que es el `::before` (+ nombre subrayado y
            //     cifra en negativo, arriba). Va aparte del `::after` para que no herede sus esquinas
            //     redondeadas y quede como un trazo recto de lado a lado.
            <button
              type="button"
              aria-pressed={activo}
              title={activo ? `Quitar el filtro «${nodo.nombre}»` : `Ver solo las reservas «${nodo.nombre}»`}
              onClick={() => onElegir(nodo.estado)}
              className={cn(
                "flex min-w-0 cursor-pointer touch-manipulation items-center gap-1.5 text-left",
                "after:absolute after:-inset-x-1 after:-top-0.5 after:-bottom-1 after:rounded-lg",
                "hover:after:ring-1 hover:after:ring-inset hover:after:ring-border",
                "focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring",
                "aria-pressed:before:absolute aria-pressed:before:inset-x-0 aria-pressed:before:-bottom-[5px] aria-pressed:before:h-[3px] aria-pressed:before:rounded-full aria-pressed:before:bg-primary",
              )}
            >
              {nombre} {pastilla}
            </button>
          ) : (
            <>
              {nombre}
              {pastilla}
            </>
          )}
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

function Cifra({ n, lectura, activa = false }: { n: number; lectura: string; activa?: boolean }) {
  return (
    <span
      data-cifra={n}
      className={cn(
        "rounded-full px-1.5 text-[11px] font-semibold leading-5 tabular-nums",
        // Estado pulsado (solo con nodos pulsables): en negativo, también con un 0.
        activa ? "bg-foreground text-background" : n > 0 ? "bg-muted text-foreground" : "text-muted-foreground",
      )}
    >
      {n}
      {/* El espacio va FUERA del `sr-only`: dentro, el cálculo del nombre accesible lo recorta y el lector
          oiría «2reservas». Al final de línea (lo que sigue es `position: absolute`) no se pinta. */}
      {" "}
      <span className="sr-only">{n === 1 ? "reserva" : "reservas"} {lectura}</span>
    </span>
  );
}
