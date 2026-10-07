// ============================================================================
// MAPA DE UNA SALA EN SERVICIO — la sala dibujada con sus mesas de colores
// ----------------------------------------------------------------------------
// Lo usa la vista «Plano» de «Hoy» (`VistaPlanoHoy`). Solo PINTA: qué estado
// tiene cada mesa lo calcula quien lo usa (`estadoMesaServicio`, el mismo cálculo
// y los mismos umbrales que el modo servicio de una sala) y aquí llega hecho.
//
//   · La sala (paredes, áreas, puertas…) y el encuadre son los del plano de
//     reparto (`../elementosPlano.tsx`): misma geometría, mismas convenciones.
//   · Mesas en su sitio (posición en METROS, tamaño en CM, giro alrededor del
//     centro), con el número SIEMPRE derecho y legible, el color del estado
//     (`./estadosMesa.ts`) y, si cabe, la hora o los minutos y un cartel con el
//     nombre.
//   · Se ajusta solo al hueco que tiene (sin scroll). Con el dedo: pellizco para
//     acercar y arrastrar para mover (`crearGestosTactiles`, lo mismo que el
//     plano de reparto); con ratón, la rueda y arrastrar sobre el vacío. Botones
//     «Alejar / Acercar / Ajustar» de 44 px para quien no quiera gestos.
//   · Tocar una mesa = `onTocarMesa`. Un toque que acaba en arrastre o pellizco
//     no cuenta como toque.
// ============================================================================

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Maximize2, MessageSquareText, Move, Star, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Mesa } from "@/hooks/useMesas";
import { useTamanoElemento } from "@/hooks/useAlturaDisponible";
import {
  crearGestosTactiles,
  vptZoomHaciaPunto,
  type ControladorGestos,
  type Vpt,
} from "@/components/espacios/gestosTactiles";
import type { ResultadoEstadoMesa } from "@/lib/reservas/servicioSala";
import { nombreCartelMesa, tiempoCortoMesa } from "@/lib/reservas/vistaHoy";
import { limitesContenidoPlano, renderElementoPlano, type ElementoPlano } from "../elementosPlano";
import { CONFIG_ESTADO_MESA, textoMinutosMesa } from "./estadosMesa";

/** Margen alrededor del plano encuadrado, en px (el mismo total que el plano de reparto). */
const MARGEN_ENCUADRE = 32;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;
/** Desde este lado (px en pantalla) la mesa lleva dentro la hora o los minutos. */
const UMBRAL_TIEMPO_PX = 34;
/** …y de ancho al menos esto, para que «14:30» o «45 min» quepan en una línea. */
const ANCHO_MIN_TIEMPO_PX = 46;
/** Desde este lado lleva encima el cartel con el nombre (la elegida y las del buscador, siempre). */
const UMBRAL_CARTEL_PX = 28;

export interface MapaSalaServicioProps {
  salaNombre: string;
  mesas: readonly Mesa[];
  elementos: readonly ElementoPlano[];
  /** `planos_espacio.pixels_per_meter` (escena), 50 si la sala no tiene plano. */
  pixelsPorMetro: number;
  anchoMetros: number;
  altoMetros: number;
  /** Estado de cada mesa en el turno que se pinta, por id de mesa. */
  estados: ReadonlyMap<string, ResultadoEstadoMesa>;
  /** Mesas que llevan el cartel con el nombre (la primera de las que comparte una reserva). */
  conCartel: ReadonlySet<string>;
  seleccionada: string | null;
  /** Mesas cuya reserva coincide con la búsqueda; `null` = no hay búsqueda y no se atenúa nada. */
  coincidentes: ReadonlySet<string> | null;
  onTocarMesa: (mesa: Mesa) => void;
}

export function MapaSalaServicio({
  salaNombre,
  mesas,
  elementos,
  pixelsPorMetro,
  anchoMetros,
  altoMetros,
  estados,
  conCartel,
  seleccionada,
  coincidentes,
  onTocarMesa,
}: MapaSalaServicioProps) {
  const [contenedor, setContenedor] = useState<HTMLDivElement | null>(null);
  const tamano = useTamanoElemento(contenedor);
  const [zoomManual, setZoomManual] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const limites = useMemo(
    () =>
      limitesContenidoPlano(elementos, mesas, pixelsPorMetro, anchoMetros * pixelsPorMetro, altoMetros * pixelsPorMetro),
    [elementos, mesas, pixelsPorMetro, anchoMetros, altoMetros],
  );

  // Encuadre automático: la sala entera en el hueco, con margen. Sin medida (jsdom), 1.
  const escalaAuto = useMemo(() => {
    if (!tamano || limites.width <= 0 || limites.height <= 0) return 1;
    const escala = Math.min(
      (tamano.ancho - MARGEN_ENCUADRE) / limites.width,
      (tamano.alto - MARGEN_ENCUADRE) / limites.height,
    );
    return escala > 0 ? escala : 1;
  }, [tamano, limites.width, limites.height]);
  const escala = zoomManual ?? escalaAuto;

  // ── Gestos (mismo controlador que el plano de reparto) ─────────────────────
  // Los valores vivos van en refs para no volver a montar los listeners en cada render.
  const escalaViva = useRef(escala);
  const panVivo = useRef(pan);
  escalaViva.current = escala;
  panVivo.current = pan;
  const controlador = useRef<ControladorGestos | null>(null);
  /** El ratón bajó sobre el vacío (no sobre una mesa): arrastrar mueve el plano. */
  const ratonSobreVacio = useRef(false);

  useEffect(() => {
    if (!contenedor) return;
    const vptActual = (): Vpt => {
      const r = contenedor.getBoundingClientRect();
      const z = escalaViva.current;
      return [z, 0, 0, z, r.width / 2 + panVivo.current.x, r.height / 2 + panVivo.current.y];
    };
    const aplicarVpt = (v: Vpt) => {
      const r = contenedor.getBoundingClientRect();
      setZoomManual(v[0]);
      setPan({ x: v[4] - r.width / 2, y: v[5] - r.height / 2 });
    };
    // Antes que el controlador (mismo elemento y fase: se ejecutan por orden de alta).
    const alBajar = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      ratonSobreVacio.current = e.button === 0 && !(e.target as HTMLElement | null)?.closest?.("[data-mesa-id],[data-halo-mesa]");
    };
    contenedor.addEventListener("pointerdown", alBajar, true);
    controlador.current = crearGestosTactiles({
      elemento: contenedor,
      zoomMin: ZOOM_MIN,
      zoomMax: ZOOM_MAX,
      obtenerVpt: vptActual,
      aplicarVpt,
      // Un dedo arrastra el plano también sobre una mesa: aquí las mesas no se arrastran, y un
      // toque quieto sigue llegando como clic.
      decidirUnDedo: () => "pan-umbral",
      panConRaton: () => ratonSobreVacio.current,
    });
    // Rueda del ratón: acercar o alejar hacia el puntero (como el plano de reparto). Con
    // `passive: false` para poder evitar que la página haga scroll mientras tanto.
    const alGirarRueda = (e: WheelEvent) => {
      e.preventDefault();
      const r = contenedor.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      aplicarVpt(
        vptZoomHaciaPunto(
          vptActual(),
          { x: e.clientX - r.left, y: e.clientY - r.top },
          escalaViva.current * factor,
          ZOOM_MIN,
          ZOOM_MAX,
        ),
      );
    };
    contenedor.addEventListener("wheel", alGirarRueda, { passive: false });
    return () => {
      contenedor.removeEventListener("pointerdown", alBajar, true);
      contenedor.removeEventListener("wheel", alGirarRueda);
      controlador.current?.destruir();
      controlador.current = null;
    };
  }, [contenedor]);

  const acercar = () => setZoomManual(Math.min(escala * 1.25, ZOOM_MAX));
  const alejar = () => setZoomManual(Math.max(escala * 0.8, ZOOM_MIN));
  const ajustar = () => {
    setZoomManual(null);
    setPan({ x: 0, y: 0 });
  };

  /** Tocar una mesa. Si ese toque acabó siendo un arrastre o un pellizco del plano, no cuenta. */
  const tocar = (mesa: Mesa) => (e: MouseEvent) => {
    const estado = controlador.current?.estado;
    // `detail === 0`: clic de teclado (Intro/Espacio), que nunca es un gesto.
    if (e.detail !== 0 && estado?.esToque && estado.gestoEnCurso) return;
    onTocarMesa(mesa);
  };

  const offsetX = limites.minX;
  const offsetY = limites.minY;
  const metroEnPantalla = pixelsPorMetro * escala;
  const sinNada = mesas.length === 0 && elementos.length === 0;

  return (
    <div
      ref={setContenedor}
      data-testid="mapa-sala"
      className="relative h-full w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      style={{
        backgroundImage: `
          linear-gradient(to right, hsl(var(--border) / 0.25) 1px, transparent 1px),
          linear-gradient(to bottom, hsl(var(--border) / 0.25) 1px, transparent 1px)
        `,
        backgroundSize: `${metroEnPantalla}px ${metroEnPantalla}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {sinNada ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted-foreground">
          <div>
            <Move className="mx-auto mb-2 h-10 w-10 opacity-50" aria-hidden="true" />
            <p className="font-medium">{`${salaNombre} todavía no tiene plano ni mesas`}</p>
            <p className="text-sm">Se dibujan en Espacios.</p>
          </div>
        </div>
      ) : (
        <div
          className="absolute"
          style={{
            width: limites.width * escala,
            height: limites.height * escala,
            left: `calc(50% + ${pan.x}px)`,
            top: `calc(50% + ${pan.y}px)`,
            transform: "translate(-50%, -50%)",
          }}
        >
          {elementos.map((elem) => renderElementoPlano(elem, { offsetX, offsetY, scale: escala }))}
          {mesas.map((mesa) => (
            <MesaServicio
              key={mesa.id}
              mesa={mesa}
              x={((mesa.pos_x || 0) * pixelsPorMetro - offsetX) * escala}
              y={((mesa.pos_y || 0) * pixelsPorMetro - offsetY) * escala}
              ancho={((mesa.ancho || 80) / 100) * pixelsPorMetro * escala}
              alto={((mesa.alto || 80) / 100) * pixelsPorMetro * escala}
              resultado={estados.get(mesa.id) ?? null}
              cartel={conCartel.has(mesa.id)}
              seleccionada={seleccionada === mesa.id}
              atenuada={coincidentes !== null && !coincidentes.has(mesa.id)}
              resaltada={coincidentes !== null && coincidentes.has(mesa.id)}
              onClick={tocar(mesa)}
            />
          ))}
        </div>
      )}

      {/* Zoom: 44 px (además del pellizco y la rueda) y «Ajustar» para volver al encuadre. */}
      {!sinNada && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
          <Button variant="ghost" size="icon" className="h-11 w-11 touch-manipulation" onClick={alejar} aria-label="Alejar el plano">
            <ZoomOut className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-11 w-11 touch-manipulation" onClick={acercar} aria-label="Acercar el plano">
            <ZoomIn className="h-5 w-5" />
          </Button>
          <Button variant="ghost" className="h-11 touch-manipulation gap-1.5 px-3" onClick={ajustar} aria-label="Ajustar el plano a la pantalla">
            <Maximize2 className="h-5 w-5" />
            <span className="text-sm">Ajustar</span>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Una mesa, en TRES capas (revisión de diseño, 07/10/2026: con el halo táctil de 44 px pegado al botón,
 * el 57 % de la mesa 7 abría la 8, que va después en el DOM):
 *   1. HALO (z 1): el área táctil ampliada a 44 px, por DEBAJO de todas las mesas. Solo cuenta donde no
 *      hay ninguna mesa dibujada.
 *   2. BOTÓN (z 10+): la mesa con su forma EXACTA (girada, redonda si es redonda). Un toque dentro de una
 *      mesa visible abre SIEMPRE esa mesa.
 *   3. ROTULACIÓN (encima, sin eventos): número derecho, hora o minutos, icono del estado en la esquina,
 *      estrella / nota del cliente y el cartel con el nombre.
 */
function MesaServicio({
  mesa,
  x,
  y,
  ancho,
  alto,
  resultado,
  cartel,
  seleccionada,
  atenuada,
  resaltada,
  onClick,
}: {
  mesa: Mesa;
  /** Esquina y tamaño YA en píxeles de pantalla. */
  x: number;
  y: number;
  ancho: number;
  alto: number;
  resultado: ResultadoEstadoMesa | null;
  /** Lleva el cartel con el nombre de su reserva (la primera de unas mesas juntas), si cabe. */
  cartel: boolean;
  seleccionada: boolean;
  atenuada: boolean;
  resaltada: boolean;
  onClick: (e: MouseEvent) => void;
}) {
  const estado = resultado?.estado ?? "libre";
  const { etiqueta, clases, badge, Icono, icono } = CONFIG_ESTADO_MESA[estado];
  const reserva = resultado?.reserva ?? null;
  const lado = Math.min(ancho, alto);
  // Halo de 44 px REALES como mínimo alrededor de la mesa (14 px por lado como mucho).
  const relleno = Math.min(14, Math.max(4, (44 - lado) / 2));
  const tamanoNumero = Math.max(14, Math.min(22, lado * 0.42));
  const tiempo = tiempoCortoMesa(estado, resultado?.minutos ?? null, reserva?.hora);
  // Solo si cabe en UNA línea a 13 px («14:30», «45 min» ≈ 40 px): partida en dos no se lee.
  const conTiempo = !!tiempo && lado >= UMBRAL_TIEMPO_PX && ancho >= ANCHO_MIN_TIEMPO_PX;
  // Un cartel por reserva (en la primera de unas mesas juntas: dos iguales se pisarían). Con el plano muy
  // alejado se pisarían entre sí: entonces solo salen en la mesa elegida y en las que encuentra el buscador.
  const conCartel = !!reserva && cartel && (lado >= UMBRAL_CARTEL_PX || seleccionada || resaltada);
  const detalle = resultado ? textoMinutosMesa(estado, resultado.minutos) : null;
  const importante = !!reserva?.importante;
  const nota = (reserva?.notas_cliente ?? "").trim();
  const etiquetaAccesible =
    `Mesa ${mesa.nombre}, ${mesa.capacidad} plazas, ${etiqueta}` +
    (reserva
      ? `: ${reserva.nombre || "sin nombre"} a las ${String(reserva.hora).slice(0, 5)}, ${reserva.numero_comensales} comensales`
      : "") +
    (detalle ? `, ${detalle}` : "") +
    (importante ? ", importante" : "") +
    (nota ? `, nota del cliente: ${nota}` : "");
  const z = seleccionada ? 30 : resaltada ? 20 : 10;
  const caja = { left: x, top: y, width: ancho, height: alto };

  return (
    <>
      <div
        aria-hidden="true"
        data-halo-mesa={mesa.id}
        onClick={onClick}
        className="absolute touch-manipulation"
        style={{ left: x - relleno, top: y - relleno, width: ancho + relleno * 2, height: alto + relleno * 2, zIndex: 1 }}
      />
      <button
        type="button"
        data-mesa-id={mesa.id}
        data-estado={estado}
        data-atenuada={atenuada ? "true" : undefined}
        aria-label={etiquetaAccesible}
        aria-pressed={seleccionada}
        onClick={onClick}
        className={cn(
          "absolute touch-manipulation shadow-sm outline-none transition-[opacity,box-shadow]",
          mesa.forma === "circular" ? "rounded-full" : "rounded-lg",
          clases,
          atenuada && "opacity-35",
          resaltada && "ring-2 ring-primary/70",
          seleccionada && "ring-4 ring-primary ring-offset-2 ring-offset-background",
          "focus-visible:ring-4 focus-visible:ring-ring",
        )}
        style={{ ...caja, zIndex: z, transform: `rotate(${mesa.rotacion || 0}deg)`, transformOrigin: "center center" }}
      />
      <div
        aria-hidden="true"
        className={cn("pointer-events-none absolute", atenuada && "opacity-40")}
        style={{ ...caja, zIndex: z + 1 }}
      >
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-none text-foreground">
          <span className="font-bold tabular-nums" style={{ fontSize: tamanoNumero }}>
            {mesa.nombre}
          </span>
          {conTiempo && <span className="mt-0.5 whitespace-nowrap text-[13px] font-semibold tabular-nums">{tiempo}</span>}
        </span>
        {/* El estado también con forma (icono), no solo con color. */}
        <span
          data-glifo-estado={estado}
          className={cn("absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-background shadow ring-1 ring-border", icono)}
        >
          <Icono className="h-3 w-3" />
        </span>
        {(importante || nota) && (
          <span className="absolute -left-1.5 -top-1.5 flex items-center gap-px rounded-full bg-background px-0.5 shadow ring-1 ring-border">
            {importante && <Star data-marca="importante" className="h-3 w-3 fill-amber-400 text-amber-600" />}
            {nota && <MessageSquareText data-marca="nota" className="h-3 w-3 text-foreground" />}
          </span>
        )}
        {conCartel && reserva && (
          <span
            className={cn(
              "absolute left-1/2 max-w-[9rem] -translate-x-1/2 truncate whitespace-nowrap rounded-md px-1.5 py-0.5 text-[13px] font-semibold leading-tight shadow",
              badge,
            )}
            style={{ bottom: "calc(100% + 4px)" }}
          >
            {nombreCartelMesa(reserva.nombre)}
          </span>
        )}
      </div>
    </>
  );
}
