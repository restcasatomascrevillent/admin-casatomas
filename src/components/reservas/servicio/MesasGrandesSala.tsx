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
// Solo PINTA: el estado de cada mesa llega hecho (`estadoMesaServicio`, el mismo
// cálculo y los mismos colores que el plano: `CONFIG_ESTADO_MESA`). Tocar una
// tarjeta = `onTocarMesa`, con las mismas acciones de siempre (ficha, sentar,
// fijar, sentar sin reserva). Las mesas juntas de una reserva son UNA tarjeta con
// el rótulo común («3+4 · 8 plazas»).
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
import { rejillaMesasGrandes } from "@/lib/reservas/mesasGrandes";
import { CONFIG_ESTADO_MESA, textoMinutosMesa } from "./estadosMesa";

/** Tamaño mínimo de una tarjeta (px): con más mesas de las que caben, la rejilla se desplaza por dentro. */
export const MESA_GRANDE_MIN_ANCHO = 110;
export const MESA_GRANDE_MIN_ALTO = 90;
/** …y máximo, para que con 3 mesas en una sala no salgan tarjetas de medio metro. */
const MESA_GRANDE_MAX_ANCHO = 280;
const MESA_GRANDE_MAX_ALTO = 200;
/** `gap-3`. */
const HUECO = 12;

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
  // Cuántas columnas caben con el ancho mínimo de tarjeta: si la sala pide más, se comprimen (sin scroll).
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  const tamano = useTamanoElemento(caja);
  const maxColumnas = tamano ? Math.max(1, Math.floor((tamano.ancho - 24 + HUECO) / (MESA_GRANDE_MIN_ANCHO + HUECO))) : undefined;
  const rejilla = useMemo(() => rejillaMesasGrandes(mesas, uniones, maxColumnas), [mesas, uniones, maxColumnas]);
  const estrecho = maxColumnas !== undefined && rejilla.columnas > maxColumnas;
  const porId = useMemo(() => new Map(mesas.map((m) => [m.id, m])), [mesas]);
  const unionDe = useMemo(() => new Map(uniones.map((u) => [u.ids[0], u])), [uniones]);

  if (rejilla.celdas.length === 0) {
    return (
      <div ref={setCaja} className="flex h-full items-center justify-center p-6 text-center text-muted-foreground" data-testid="mesas-grandes">
        <div>
          <Move className="mx-auto mb-2 h-10 w-10 opacity-50" aria-hidden="true" />
          <p className="font-medium">{`${salaNombre} todavía no tiene mesas`}</p>
          <p className="text-sm">Se dibujan en Espacios.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={setCaja} className="flex h-full w-full overflow-auto overscroll-contain p-3" data-testid="mesas-grandes">
      {/* Las tarjetas llenan el hueco (1fr) entre un mínimo y un máximo; con pocas mesas, centradas. */}
      <div
        className="m-auto grid h-full w-full gap-3"
        data-filas={rejilla.filas}
        data-columnas={rejilla.columnas}
        style={{
          // Si ni comprimiendo caben (una fila con más mesas que hueco, p. ej. tablet a 1024 px), las tarjetas
          // se estrechan por debajo del mínimo antes que obligar a desplazar de lado.
          gridTemplateColumns: `repeat(${rejilla.columnas}, minmax(${estrecho ? 64 : MESA_GRANDE_MIN_ANCHO}px, 1fr))`,
          gridTemplateRows: `repeat(${rejilla.filas}, minmax(${MESA_GRANDE_MIN_ALTO}px, 1fr))`,
          maxWidth: rejilla.columnas * MESA_GRANDE_MAX_ANCHO + (rejilla.columnas - 1) * HUECO,
          maxHeight: rejilla.filas * MESA_GRANDE_MAX_ALTO + (rejilla.filas - 1) * HUECO,
        }}
      >
        {rejilla.celdas.map((celda) => {
          const suyas = celda.ids.map((id) => porId.get(id)).filter((m): m is Mesa => !!m);
          if (suyas.length === 0) return null;
          const union = suyas.length > 1 ? unionDe.get(suyas[0].id) ?? null : null;
          return (
            <TarjetaMesa
              key={celda.ids.join("+")}
              mesas={suyas}
              plazas={union?.plazas ?? suyas.reduce((s, m) => s + (m.capacidad || 0), 0)}
              fila={celda.fila}
              columna={celda.columna}
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

/** Una tarjeta: número grande, plazas y, si hay reserva en el turno, hora, nombre corto y personas. */
function TarjetaMesa({
  mesas,
  plazas,
  fila,
  columna,
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
  const { etiqueta, clases, badge, Icono, icono } = CONFIG_ESTADO_MESA[estado];
  const reserva = resultado?.reserva ?? null;
  const detalle = resultado ? textoMinutosMesa(estado, resultado.minutos) : null;
  // En la tarjeta, el tiempo corto («+12 min», «45 min», «1 h 50»); el largo va en el nombre accesible.
  const tiempo = reserva && estado !== "reservada" ? tiempoCortoMesa(estado, resultado?.minutos ?? null, reserva.hora) : null;
  const importante = !!reserva?.importante;
  const fijada = !!reserva?.mesa_fijada;
  const nota = (reserva?.notas_cliente ?? "").trim();
  const hora = reserva ? String(reserva.hora).slice(0, 5) : "";
  const etiquetaAccesible =
    (juntas ? `Mesas ${numero} juntas, ${plazas} plazas, ${etiqueta}` : `Mesa ${principal.nombre}, ${principal.capacidad} plazas, ${etiqueta}`) +
    (reserva ? `: ${reserva.nombre || "sin nombre"} a las ${hora}, ${reserva.numero_comensales} comensales` : "") +
    (detalle ? `, ${detalle}` : "") +
    (importante ? ", importante" : "") +
    (fijada ? ", mesa fijada" : "") +
    (nota ? `, nota del cliente: ${nota}` : "");
  // Se puede SOLTAR una reserva encima (como en el plano). Sin `DndContext` alrededor no hace nada.
  const { setNodeRef, isOver } = useDroppable({ id: `mesa-grande-${principal.id}`, data: { mesaId: principal.id } });

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
        "relative flex min-h-0 min-w-0 touch-manipulation flex-col overflow-hidden rounded-xl p-2 text-left text-foreground shadow-sm outline-none transition-[opacity,box-shadow,transform]",
        clases,
        "hover:shadow-md",
        atenuada && "opacity-40",
        resaltada && "ring-4 ring-primary ring-offset-2 ring-offset-background",
        seleccionada && "ring-4 ring-primary ring-offset-2 ring-offset-background",
        isOver && "ring-4 ring-emerald-500 ring-offset-2 ring-offset-background",
        "focus-visible:ring-4 focus-visible:ring-ring",
      )}
      style={{ gridRow: fila, gridColumn: columna }}
    >
      {/* Mesas juntas: la misma tarjeta, con su rótulo común arriba. */}
      {juntas && (
        <span className="mb-1 inline-flex max-w-full items-center gap-1 self-start truncate rounded-md bg-background/85 px-1.5 py-0.5 text-[12px] font-semibold leading-tight ring-1 ring-border" data-testid="mesas-juntas">
          <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Juntas · {plazas} plazas
        </span>
      )}
      <span className="flex items-start justify-between gap-1">
        <span className="truncate text-2xl font-extrabold leading-none tabular-nums xl:text-3xl" aria-hidden="true">
          {numero}
        </span>
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          {fijada && <Lock data-marca="fijada" className="h-4 w-4" />}
          {importante && <Star data-marca="importante" className="h-4 w-4 fill-amber-400 text-amber-600" />}
          {nota && <MessageSquareText data-marca="nota" className="h-4 w-4" />}
          <span data-glifo-estado={estado} className={cn("flex h-6 w-6 items-center justify-center rounded-full bg-background shadow ring-1 ring-border", icono)}>
            <Icono className="h-4 w-4" />
          </span>
        </span>
      </span>
      <span className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-muted-foreground" aria-hidden="true">
        <Users className="h-3.5 w-3.5" />
        {juntas ? plazas : principal.capacidad}
      </span>
      <span className="mt-auto min-w-0" aria-hidden="true">
        {reserva ? (
          <>
            <span className="flex items-baseline justify-between gap-1 text-sm font-semibold tabular-nums">
              <span>{hora}</span>
              {tiempo && <span className={cn("truncate rounded px-1 text-[12px] font-semibold", badge)}>{tiempo}</span>}
            </span>
            <span className="flex items-center justify-between gap-1 text-sm font-semibold">
              <span className="truncate">{nombreCartelMesa(reserva.nombre)}</span>
              <span className="shrink-0 tabular-nums">{reserva.numero_comensales} p.</span>
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{etiqueta}</span>
        )}
      </span>
    </button>
  );
}
