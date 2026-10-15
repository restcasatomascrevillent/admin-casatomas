import { useId } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESTADOS_RESERVA, ORDEN_ESTADOS, type EstadoReserva } from "@/lib/reservas/estadosReserva";

/**
 * Timeline de los estados de una reserva (pestaña "Lista"; estuvo también en "Hoy"
 * del 2026-09-30 al 04/10/2026): qué estados existen, cómo avanza una reserva y qué
 * le toca hacer al personal en cada paso. Es una leyenda de los badges de la lista
 * y del kanban, y en la Lista cada estado es además un filtro.
 *
 * ----------------------------------------------------------------------------
 * UNA SOLA FILA FINA (2026-10-06, petición del dueño: «achatar más lo de "Cómo
 * avanza una reserva": no pongas los totales, los números no tienen sentido»)
 * ----------------------------------------------------------------------------
 *   ▾ CÓMO AVANZA UNA RESERVA  ● Pendiente ── ● Verificada ── ● Confirmada ── ● Llegó ┆ ◌ Cancelada  ◌ No vino
 * Antes eran ~115 px de alto (cabecera de dos líneas, cifra en cada estado y una
 * frase debajo de cada uno); ahora una fila de 38 px (46 px con dedo). Sin cifras.
 * La frase de cada estado no se pierde: va en el `title` (tooltip al pasar el
 * ratón) y en `aria-description` del botón (la lee el lector de pantalla). El
 * rótulo «Cómo avanza una reserva» va en la propia fila, discreto, solo desde `xl`
 * (por debajo no cabe junto a los seis estados; sigue siendo el nombre accesible
 * de la región y de la lista).
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
 * SIN CIFRAS (2026-10-06)
 * ----------------------------------------------------------------------------
 * Hasta el 2026-10-06 cada estado llevaba su cifra (las reservas de la lista con
 * sus filtros menos el de estado; antes, las de hoy). El dueño las quitó: el
 * timeline explica y filtra, no cuenta. Se retiró también su lógica
 * (`cifrasDeLaLista`, `contarPorEstado`…): en `cifrasPorEstado.ts` solo queda la
 * cifra del botón «Por atender», que sí sigue.
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
 *     y lector de pantalla sin código extra. Se llama como el estado («Llegó»); su
 *     frase va en `aria-description` y, con lo que hace pulsarlo, en el `title`.
 *   · Se pulsa en TODO el nodo (icono y nombre), no solo en el texto del botón: la
 *     zona de pulsación es un pseudo-elemento que cubre el nodo (el patrón
 *     «stretched link»; el nodo es `relative`).
 *   · Marcado: el estado pulsado lleva una barra gruesa por debajo y el nombre
 *     subrayado. NO se usa un contorno entero porque ese es el del foco del
 *     teclado, y pulsado y enfocado no se pueden confundir.
 *   · Sin `onElegirEstado` el timeline es una leyenda, sin botones ni nada que
 *     pulsar (la frase, en el `title` del nombre y en texto para lectores de
 *     pantalla). `estadoActivo` solo vale con él.
 *
 * ----------------------------------------------------------------------------
 * SIN DESPLEGABLE (15/10/2026, petición del dueño: «en el timeline quita el
 * desplegable y deja solo el timeline»)
 * ----------------------------------------------------------------------------
 * Hasta el 15/10/2026 iba en un `Collapsible` («▸ CÓMO AVANZA UNA RESERVA») que
 * recordaba en el navegador si estaba plegado (`reservas:timeline-estados:abierto`).
 * Ya no: siempre a la vista, sin botón de plegar. El rótulo queda como texto
 * (visible desde `xl`; por debajo solo para el lector de pantalla, porque no cabe
 * junto a los seis estados). Si los estados no caben, el scroll horizontal es de
 * su propio contenedor, nunca de la página.
 */

interface NodoEstado {
  estado: EstadoReserva;
  /** Nombre tal y como sale en los badges. */
  nombre: string;
  icono: LucideIcon;
  /** Relleno y color del icono. */
  burbuja: string;
  /**
   * Qué significa y qué toca hacer, en una frase; en las salidas, con su «cuándo» delante («Antes de que llegue:
   * la cancelas tú o el cliente.»). Ya no se pinta debajo del estado: va en el tooltip y para el lector de pantalla.
   */
  frase: string;
}

const aNodo = (estado: EstadoReserva): NodoEstado => {
  const { etiqueta, Icono, burbuja, cuando, descripcion } = ESTADOS_RESERVA[estado];
  return { estado, nombre: etiqueta, icono: Icono, burbuja, frase: cuando ? `${cuando} ${descripcion}` : descripcion };
};

/** Pasos del camino principal: los cuatro primeros del ciclo de vida. Rellenos sólidos, unidos por una línea continua. */
const PASOS_DEL_CAMINO = 4;
const CAMINO: readonly NodoEstado[] = ORDEN_ESTADOS.slice(0, PASOS_DEL_CAMINO).map(aNodo);

/** Las salidas: no son un paso más, son por donde se sale del camino. Borde discontinuo. */
const SALIDAS: readonly NodoEstado[] = ORDEN_ESTADOS.slice(PASOS_DEL_CAMINO).map(aNodo);

export interface TimelineEstadosReservaProps {
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

export function TimelineEstadosReserva({ onElegirEstado, estadoActivo, className }: TimelineEstadosReservaProps) {
  const idTitulo = useId();
  const pulsables = onElegirEstado !== undefined;

  return (
    // UNA fila: el rótulo y los seis estados a su derecha (36 px por dentro; 44 con dedo).
    <section
      aria-labelledby={idTitulo}
      className={cn("flex min-w-0 items-center gap-2 rounded-xl border bg-card/50 px-2 sm:px-3", className)}
    >
      {/* El rótulo: siempre el nombre de la región y de la lista. Se VE desde `xl` (por debajo no cabe junto a
          los seis estados sin empujarlos a un scroll). */}
      <h3
        id={idTitulo}
        className="sr-only shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted-foreground xl:not-sr-only"
      >
        Cómo avanza una reserva
      </h3>

      <div className="min-w-0 flex-1">
        {/* Si los seis estados no caben (móvil, tablet vertical), ESTE contenedor —no la página— hace scroll
            horizontal. `overscroll-x-contain` evita que el gesto de deslizar llegue al final y dispare el
            "atrás" del navegador.

            `relative` NO es decorativo: los `sr-only` son `position:absolute`, y sin un ancestro posicionado
            su bloque contenedor es la ventana, no este scroller — no los recorta y los que caen fuera de la
            vista ensanchan el documento entero (medido: 1213px en una ventana de 1024, con barra de scroll
            horizontal en toda la página).

            El relleno (`py-1.5`, y `px-1` con nodos pulsables) es el hueco que necesitan la zona de
            pulsación, su anillo de foco y la barra de «pulsado», que sobresalen del nodo: al hacer scroll,
            este contenedor recorta lo que se sale de su caja. Con dedo el botón ya mide 44 px y todo cabe
            dentro: sin relleno vertical. */}
        <div
          className={cn(
            "relative overflow-x-auto overscroll-x-contain py-1.5 pointer-coarse:py-0",
            pulsables && "px-1",
          )}
        >
          <ol aria-labelledby={idTitulo} className="flex w-max min-w-full items-center gap-1.5 xl:gap-3">
            {CAMINO.map((nodo, i) => (
              <Nodo
                key={nodo.estado}
                nodo={nodo}
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
                abreSalidas={i === 0}
                onElegir={onElegirEstado}
                activo={pulsables && nodo.estado === estadoActivo}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Nodo({
  nodo,
  paso,
  conConector,
  abreSalidas,
  activo = false,
  onElegir,
}: {
  nodo: NodoEstado;
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
        "whitespace-nowrap text-sm font-semibold leading-tight text-foreground",
        activo && "underline decoration-2 underline-offset-4",
      )}
    >
      {nodo.nombre}
    </span>
  );

  return (
    <li
      data-estado={nodo.estado}
      className={cn(
        "flex shrink-0 items-center gap-1.5 xl:gap-3",
        // Los pasos con conector se estiran: la línea ocupa el sitio que sobre hasta el siguiente.
        conConector && "flex-1",
        abreSalidas && "border-l-2 border-dashed border-muted-foreground/40 pl-2 xl:pl-3",
      )}
    >
      {/* El nodo (burbuja + nombre). Con `onElegir` es el ancla (`relative`) de la zona de pulsación del botón. */}
      <span className={cn("flex shrink-0 items-center gap-1.5", onElegir && "relative")}>
        <span aria-hidden="true" className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", nodo.burbuja)}>
          <Icono className="h-3.5 w-3.5" />
        </span>
        <span className="sr-only">{paso ? `Paso ${paso.n} de ${paso.de}: ` : "Salida: "}</span>
        {onElegir ? (
          // Botón de alternancia. Se llama como el estado («Llegó»); el «Paso n de N» queda fuera. Su frase,
          // en `aria-description` (lector de pantalla) y en el `title` con lo que hace pulsarlo (ratón).
          //
          // La zona de pulsación es el `::after`, que cubre TODO el nodo (burbuja y nombre): se pasa 4px por los
          // lados y 2px por arriba y por abajo (el scroller deja ese hueco). Con dedo, el botón ya mide 44 px y
          // la zona se queda en su alto.
          // Estados, cada uno distinto de los demás para que pulsado y enfocado no se confundan:
          //   · pasar el ratón: contorno suave;
          //   · foco de teclado: anillo entero (`ring-ring`, el de toda la app) — el contorno del botón se
          //     quita porque lo sustituye este;
          //   · pulsado: barra gruesa recta por debajo del nodo, que es el `::before` (+ nombre subrayado). Va
          //     aparte del `::after` para que no herede sus esquinas redondeadas.
          <button
            type="button"
            aria-pressed={activo}
            aria-description={nodo.frase}
            title={`${nodo.frase}\n${activo ? `Quitar el filtro «${nodo.nombre}»` : `Ver solo las reservas «${nodo.nombre}»`}`}
            onClick={() => onElegir(nodo.estado)}
            className={cn(
              "flex cursor-pointer touch-manipulation items-center text-left pointer-coarse:min-h-11",
              "after:absolute after:-inset-x-1 after:-inset-y-0.5 after:rounded-lg pointer-coarse:after:inset-y-0",
              "hover:after:ring-1 hover:after:ring-inset hover:after:ring-border",
              "focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring",
              "aria-pressed:before:absolute aria-pressed:before:inset-x-0 aria-pressed:before:-bottom-1 aria-pressed:before:h-[3px] aria-pressed:before:rounded-full aria-pressed:before:bg-primary pointer-coarse:aria-pressed:before:bottom-1",
            )}
          >
            {nombre}
          </button>
        ) : (
          // Leyenda (sin filtro): la frase, en el tooltip del nombre y en texto para el lector de pantalla.
          <span title={nodo.frase}>
            {nombre}
            <span className="sr-only">{`: ${nodo.frase}`}</span>
          </span>
        )}
      </span>
      {conConector && <span aria-hidden="true" className="h-0.5 min-w-3 flex-1 rounded-full bg-muted-foreground/35" />}
    </li>
  );
}
