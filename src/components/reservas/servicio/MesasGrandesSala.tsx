// ============================================================================
// MESAS GRANDES DE UNA SALA — el plano de «Hoy» de escritorio
// ----------------------------------------------------------------------------
// Petición del dueño (07/11/2026, al ver la v0.386 en el ordenador): «eso era para
// el móvil, en ordenador se ve mal». En vez del plano realista (`MapaSalaServicio`,
// que sigue para el resto de vistas), un plano tipo programa de gestión de
// restaurante: sin paredes, sin decoración y sin cuadrícula; cada mesa es una
// TARJETA grande que ocupa el sitio de la sala, colocada más o menos donde está
// (filas y columnas derivadas de sus posiciones: `rejillaMesasGrandes`).
//
// SIN SCROLL (07/11/2026, el dueño en el Salón de la demo, v0.391): todas las
// mesas caben SIEMPRE en el hueco. El tamaño de cada tarjeta sale del ancho y el
// alto reales del contenedor (ResizeObserver, `useTamanoElemento`): filas ×
// columnas entran enteras; si no caben al tamaño cómodo, tarjetas y letras se
// reducen. El número de mesa nunca se corta. Tarjetas cuadradas o más anchas que
// altas. Sin icono de estado (se comía el número): lo dicen el color y el borde.
//
// Solo PINTA: el estado de cada mesa llega hecho (`estadoMesaServicio`, el mismo
// cálculo y los mismos colores que el plano: `CONFIG_ESTADO_MESA`). Tocar una
// tarjeta = `onTocarMesa`, con las mismas acciones de siempre (ficha, sentar,
// fijar, sentar sin reserva). Las mesas juntas de una reserva son UNA tarjeta.
// ============================================================================

import { useMemo, useState } from "react";
import { useTamanoElemento } from "@/hooks/useAlturaDisponible";
import { useDroppable } from "@dnd-kit/core";
import { Link2, Lock, MessageSquareText, Move, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Mesa } from "@/hooks/useMesas";
import type { ResultadoEstadoMesa } from "@/lib/reservas/servicioSala";
import { nombreCartelMesa, tiempoCortoMesa } from "@/lib/reservas/vistaHoy";
import type { UnionDibujo } from "@/lib/reservas/dibujoMesas";
import { medidasTarjetas, rejillaAjustada, rejillaMesasGrandes, RELLENO_MESAS_GRANDES } from "@/lib/reservas/mesasGrandes";
import { CONFIG_ESTADO_MESA, textoMinutosMesa } from "./estadosMesa";

export interface MesasGrandesSalaProps {
  salaNombre: string;
  mesas: readonly Mesa[];
  /** Estado de cada mesa en el turno que se pinta, por id de mesa. */
  estados: ReadonlyMap<string, ResultadoEstadoMesa>;
  seleccionada: string | null;
  /** Mesas a resaltar (buscador, reserva señalada en la lista…); `null` = no se atenúa nada. */
  coincidentes: ReadonlySet<string> | null;
  onTocarMesa: (mesa: Mesa) => void;
  /** Mesas juntas en este servicio (`dibujarUniones`): una tarjeta por unión. */
  uniones?: readonly UnionDibujo[];
}

export function MesasGrandesSala({
  salaNombre,
  mesas,
  estados,
  seleccionada,
  coincidentes,
  onTocarMesa,
  uniones = [],
}: MesasGrandesSalaProps) {
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  const tamano = useTamanoElemento(caja);
  // Con el hueco medido: las filas que den tarjetas más grandes (juntando filas de la sala si hace falta).
  const ancho = tamano?.ancho ?? 0;
  const alto = tamano?.alto ?? 0;
  const rejilla = useMemo(
    () => (ancho > 0 && alto > 0 ? rejillaAjustada(mesas, uniones, ancho, alto) : rejillaMesasGrandes(mesas, uniones)),
    [mesas, uniones, ancho, alto],
  );
  const porId = useMemo(() => new Map(mesas.map((m) => [m.id, m])), [mesas]);
  const unionDe = useMemo(() => new Map(uniones.map((u) => [u.ids[0], u])), [uniones]);
  const medidas =
    tamano && rejilla.filas > 0 ? medidasTarjetas(tamano.ancho, tamano.alto, rejilla.filas, rejilla.columnas) : null;

  if (rejilla.celdas.length === 0) {
    return (
      <div
        ref={setCaja}
        className="flex h-full items-center justify-center overflow-hidden p-6 text-center text-muted-foreground"
        data-testid="mesas-grandes"
      >
        <div>
          <Move className="mx-auto mb-2 h-10 w-10 opacity-50" aria-hidden="true" />
          <p className="font-medium">{`${salaNombre} todavía no tiene mesas`}</p>
          <p className="text-sm">Se dibujan en Espacios.</p>
        </div>
      </div>
    );
  }

  return (
    // Nunca scroll: `overflow-hidden` y las medidas sacadas del propio hueco.
    <div
      ref={setCaja}
      className="flex h-full w-full items-center justify-center overflow-hidden"
      style={{ padding: RELLENO_MESAS_GRANDES }}
      data-testid="mesas-grandes"
    >
      <div
        className="grid"
        data-filas={rejilla.filas}
        data-columnas={rejilla.columnas}
        style={
          medidas
            ? {
                gridTemplateColumns: `repeat(${rejilla.columnas}, ${medidas.tarjetaAncho}px)`,
                gridTemplateRows: `repeat(${rejilla.filas}, ${medidas.tarjetaAlto}px)`,
                gap: medidas.hueco,
              }
            : {
                // Sin medidas (jsdom o antes de medir): que llene el hueco sin desbordar.
                width: "100%",
                height: "100%",
                gap: 8,
                gridTemplateColumns: `repeat(${rejilla.columnas}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rejilla.filas}, minmax(0, 1fr))`,
              }
        }
      >
        {rejilla.celdas.map((celda) => {
          const suyas = celda.ids.map((id) => porId.get(id)).filter((m): m is Mesa => !!m);
          if (suyas.length === 0) return null;
          const union = suyas.length > 1 ? (unionDe.get(suyas[0].id) ?? null) : null;
          return (
            <TarjetaMesa
              key={celda.ids.join("+")}
              mesas={suyas}
              plazas={union?.plazas ?? suyas.reduce((s, m) => s + (m.capacidad || 0), 0)}
              fila={celda.fila}
              columna={celda.columna}
              ancho={medidas?.tarjetaAncho ?? null}
              alto={medidas?.tarjetaAlto ?? null}
              resultado={estados.get(suyas[0].id) ?? null}
              seleccionada={suyas.some((m) => m.id === seleccionada)}
              atenuada={coincidentes !== null && !suyas.some((m) => coincidentes.has(m.id))}
              resaltada={coincidentes !== null && suyas.some((m) => coincidentes.has(m.id))}
              onClick={() => onTocarMesa(suyas[0])}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Una tarjeta: número grande (nunca cortado), plazas y, si hay reserva en el turno, un dato de tiempo (la hora
 * si aún no ha llegado; si no «+12 min», «45 min», «1 h 50») y el nombre corto con las personas. Lo que no cabe
 * se quita de abajo arriba, no se corta.
 */
function TarjetaMesa({
  mesas,
  plazas,
  fila,
  columna,
  ancho,
  alto,
  resultado,
  seleccionada,
  atenuada,
  resaltada,
  onClick,
}: {
  /** Una mesa, o las de una unión (la principal primero). */
  mesas: Mesa[];
  plazas: number;
  fila: number;
  columna: number;
  /** Medidas reales en px (`null` sin medir: tamaño cómodo). */
  ancho: number | null;
  alto: number | null;
  resultado: ResultadoEstadoMesa | null;
  seleccionada: boolean;
  atenuada: boolean;
  resaltada: boolean;
  onClick: () => void;
}) {
  const principal = mesas[0];
  const juntas = mesas.length > 1;
  const numero = mesas.map((m) => m.nombre).join("+");
  const estado = resultado?.estado ?? "libre";
  const { etiqueta, clases, badge } = CONFIG_ESTADO_MESA[estado];
  const reserva = resultado?.reserva ?? null;
  const detalle = resultado ? textoMinutosMesa(estado, resultado.minutos) : null;
  const tiempo = reserva ? tiempoCortoMesa(estado, resultado?.minutos ?? null, reserva.hora) : null;
  const importante = !!reserva?.importante;
  const fijada = !!reserva?.mesa_fijada;
  const nota = (reserva?.notas_cliente ?? "").trim();
  const hora = reserva ? String(reserva.hora).slice(0, 5) : "";
  const etiquetaAccesible =
    (juntas
      ? `Mesas ${numero} juntas, ${plazas} plazas, ${etiqueta}`
      : `Mesa ${principal.nombre}, ${principal.capacidad} plazas, ${etiqueta}`) +
    (reserva ? `: ${reserva.nombre || "sin nombre"} a las ${hora}, ${reserva.numero_comensales} comensales` : "") +
    (detalle ? `, ${detalle}` : "") +
    (importante ? ", importante" : "") +
    (fijada ? ", mesa fijada" : "") +
    (nota ? `, nota del cliente: ${nota}` : "");
  // Se puede SOLTAR una reserva encima (como en el plano). Sin `DndContext` alrededor no hace nada.
  const { setNodeRef, isOver } = useDroppable({ id: `mesa-grande-${principal.id}`, data: { mesaId: principal.id } });

  // Escala por tamaño: el número baja de 30 a 14 px (y cabe a lo ancho); el resto se va quitando.
  const a = ancho ?? 150;
  const h = alto ?? 120;
  const tamanoNumero = Math.round(Math.max(14, Math.min(30, h * 0.3, (a - 16) / (Math.max(2, numero.length) * 0.62))));
  const letra = a < 96 || h < 72 ? 11 : 13;
  const conPlazas = h >= 72;
  const conNombre = h >= 92 && a >= 84;
  const conJuntas = juntas && h >= 112;
  const conTiempo = h >= 50;

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-mesa-id={principal.id}
      data-mesas={mesas.map((m) => m.id).join(",")}
      data-estado={estado}
      data-atenuada={atenuada ? "true" : undefined}
      data-resaltada={resaltada ? "true" : undefined}
      aria-label={etiquetaAccesible}
      aria-pressed={seleccionada}
      onClick={onClick}
      title={nota || undefined}
      className={cn(
        "relative flex min-h-0 min-w-0 touch-manipulation flex-col overflow-hidden rounded-xl text-left text-foreground shadow-sm outline-none transition-[opacity,box-shadow]",
        h < 72 ? "p-1.5" : "p-2",
        clases,
        "hover:shadow-md",
        atenuada && "opacity-40",
        resaltada && "ring-4 ring-primary ring-offset-2 ring-offset-background",
        seleccionada && "ring-4 ring-primary ring-offset-2 ring-offset-background",
        isOver && "ring-4 ring-emerald-500 ring-offset-2 ring-offset-background",
        "focus-visible:ring-4 focus-visible:ring-ring",
      )}
      style={{ gridRow: fila, gridColumn: columna, fontSize: letra }}
    >
      {/* Mesas juntas: la misma tarjeta, con su rótulo común arriba. */}
      {conJuntas && (
        <span
          className="mb-0.5 inline-flex items-center gap-1 self-start whitespace-nowrap rounded-md bg-background/85 px-1 py-px font-semibold leading-tight ring-1 ring-border"
          data-testid="mesas-juntas"
          aria-hidden="true"
        >
          <Link2 className="h-3 w-3 shrink-0" />
          Juntas
        </span>
      )}
      <span className="flex min-w-0 items-start gap-1" aria-hidden="true">
        {/* El número entero, siempre: sin recortes ni puntos suspensivos. */}
        <span
          className="shrink-0 whitespace-nowrap font-extrabold leading-none tabular-nums"
          style={{ fontSize: tamanoNumero }}
          data-testid="numero-mesa"
        >
          {numero}
        </span>
        <span className="ml-auto flex min-w-0 shrink items-center gap-0.5 overflow-hidden">
          {fijada && <Lock data-marca="fijada" className="h-3.5 w-3.5 shrink-0" />}
          {importante && <Star data-marca="importante" className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-600" />}
          {nota && <MessageSquareText data-marca="nota" className="h-3.5 w-3.5 shrink-0" />}
        </span>
      </span>
      {conPlazas && (
        <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap font-medium text-muted-foreground" aria-hidden="true">
          <Users className="h-3 w-3 shrink-0" />
          {juntas ? plazas : principal.capacidad}
        </span>
      )}
      <span className="mt-auto flex min-w-0 flex-col gap-px" aria-hidden="true">
        {reserva ? (
          <>
            {conTiempo && tiempo && (
              <span className="flex items-center justify-between gap-1 whitespace-nowrap font-semibold tabular-nums">
                <span className={cn("shrink-0 rounded px-1 leading-tight", estado !== "reservada" && badge)}>{tiempo}</span>
                {!conNombre && <span className="shrink-0">{reserva.numero_comensales} p.</span>}
              </span>
            )}
            {conNombre && (
              <span className="flex min-w-0 items-center justify-between gap-1 whitespace-nowrap font-semibold">
                <span className="min-w-0 overflow-hidden text-ellipsis">{nombreCartelMesa(reserva.nombre)}</span>
                <span className="shrink-0 tabular-nums">{reserva.numero_comensales} p.</span>
              </span>
            )}
          </>
        ) : (
          conTiempo && <span className="whitespace-nowrap text-muted-foreground">{etiqueta}</span>
        )}
      </span>
    </button>
  );
}
