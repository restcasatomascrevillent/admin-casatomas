// ============================================================================
// «HOY» DE ESCRITORIO — la lista completa del turno, por estados
// ----------------------------------------------------------------------------
// Petición del dueño (07/11/2026, al ver la v0.386 en el ordenador): «eso era para
// el móvil». En vez de las tarjetas grandes del móvil, filas compactas de UNA línea
// (≈52 px): hora · nombre · pax · mesa («Sin mesa» resaltado) · iconos (nota,
// alergia, teléfono) · estado · acción corta («Sentar», «Liberar»). Agrupadas:
// «Por llegar», «Sentadas» y, al final y plegadas, «Terminadas / No vino /
// Canceladas» (`listaHoyEscritorio`).
//
// Solo PINTA. Las acciones son las de la lista del móvil (`VistaHoyMovil`, que la
// monta en modo `columna`): «Sentar» con `decidirSentarPrevista` (y, si la mesa
// prevista está cogida o falta mesa, la ficha con el selector y el aviso de
// desplazadas), «Liberar» con el modo servicio. Tocar la fila abre la ficha. Pasar
// el ratón (o el foco) por una fila la señala en el plano (`onSeñalar`).
// ============================================================================

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Lock, Phone, StickyNote, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";
import { textoMesas, tieneAlergia, type FilaHoyMovil, type ListaHoyEscritorio as Lista } from "@/lib/reservas/hoyMovil";
import type { ReservaMesaServicio } from "@/lib/reservas/servicioSala";
import { enlaceTelefono, telefonoLegible } from "@/lib/reservas/telefono";

type Reserva = ReservaMesaServicio;


const horaCorta = (h: string) => (h ?? "").slice(0, 5);

export interface ListaHoyEscritorioProps {
  lista: Lista<Reserva>;
  /** Nombre de la sala de una reserva (para el texto de la mesa en el lector de pantalla). */
  salaDe: (r: Reserva) => string | undefined;
  onAbrir: (r: Reserva) => void;
  /** «Sentar» (por llegar). Sin él (solo «Ver») no hay botón. */
  onSentar?: (r: Reserva) => void;
  /** «Liberar» (sentadas con mesa). Sin él no hay botón. */
  onLiberar?: (r: Reserva) => void;
  /** Su mesa prevista la ocupa alguien sentado: «Sentar» abrirá el selector. */
  mesaPrevistaOcupada?: (r: Reserva) => boolean;
  /** Reserva con una acción en curso (botón desactivado). */
  ocupadaId?: string | null;
  /** La reserva señalada (resaltada aquí y en el plano). */
  señalada?: string | null;
  onSeñalar?: (id: string | null) => void;
}

export function ListaHoyEscritorio({
  lista,
  salaDe,
  onAbrir,
  onSentar,
  onLiberar,
  mesaPrevistaOcupada,
  ocupadaId = null,
  señalada = null,
  onSeñalar,
}: ListaHoyEscritorioProps) {
  const [verTerminadas, setVerTerminadas] = useState(false);
  const pax = (filas: Array<{ reserva: Reserva }>) => filas.reduce((s, f) => s + (f.reserva.numero_comensales || 0), 0);
  const fila = (f: FilaHoyMovil<Reserva> & { tarde?: boolean }, grupo: "porLlegar" | "sentadas" | "terminadas") => {
    const r = f.reserva;
    let accion: ReactNode = null;
    if (grupo === "porLlegar" && onSentar) {
      const elegir = f.mesas.length === 0 || !!mesaPrevistaOcupada?.(r);
      accion = (
        <Button
          type="button"
          size="sm"
          className="pointer-events-auto h-11 w-16 shrink-0 px-2"
          disabled={ocupadaId === r.id}
          onClick={() => onSentar(r)}
          aria-label={elegir ? `Sentar a ${r.nombre || "la reserva"}: elegir mesa` : `Sentar a ${r.nombre || "la reserva"} en ${textoMesas(f.mesas).toLowerCase()}`}
        >
          Sentar
        </Button>
      );
    } else if (grupo === "sentadas" && onLiberar && f.mesas.length > 0) {
      accion = (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="pointer-events-auto h-11 w-16 shrink-0 px-2"
          disabled={ocupadaId === r.id}
          onClick={() => onLiberar(r)}
          aria-label={`Liberar ${textoMesas(f.mesas).toLowerCase()} de ${r.nombre || "la reserva"}`}
        >
          Liberar
        </Button>
      );
    }
    return (
      <FilaEscritorio
        key={r.id}
        reserva={r}
        mesas={f.mesas}
        sala={salaDe(r)}
        tarde={!!f.tarde}
        grupo={grupo}
        accion={accion}
        señalada={señalada === r.id}
        onAbrir={() => onAbrir(r)}
        onSeñalar={onSeñalar}
      />
    );
  };

  const cabecera = (titulo: string, filas: Array<{ reserva: Reserva }>) => (
    <>
      <span>{titulo}</span>
      <span className="text-xs font-normal tabular-nums text-muted-foreground">
        {filas.length} · {pax(filas)} pax
      </span>
    </>
  );
  const claseCabecera = "sticky top-0 z-10 flex min-h-11 w-full items-center justify-between gap-2 border-b bg-muted/95 px-3 py-1.5 text-sm font-semibold backdrop-blur";

  return (
    <div data-testid="lista-hoy-escritorio">
      <section aria-label="Por llegar">
        <h3 className={claseCabecera}>{cabecera("Por llegar", lista.porLlegar)}</h3>
        {lista.porLlegar.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Nadie por llegar.</p>
        ) : (
          <ul className="divide-y">{lista.porLlegar.map((f) => fila(f, "porLlegar"))}</ul>
        )}
      </section>
      <section aria-label="Sentadas">
        <h3 className={claseCabecera}>{cabecera("Sentadas", lista.sentadas)}</h3>
        {lista.sentadas.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Nadie sentado.</p>
        ) : (
          <ul className="divide-y">{lista.sentadas.map((f) => fila(f, "sentadas"))}</ul>
        )}
      </section>
      <section aria-label="Terminadas, no vino y canceladas">
        <h3>
          <button type="button" className={cn(claseCabecera, "text-left")} aria-expanded={verTerminadas} onClick={() => setVerTerminadas((v) => !v)}>
            <span className="flex items-center gap-1.5">
              <ChevronDown className={cn("h-4 w-4 transition-transform", verTerminadas && "rotate-180")} aria-hidden="true" />
              Terminadas / No vino / Canceladas
            </span>
            <span className="text-xs font-normal tabular-nums text-muted-foreground">{lista.terminadas.length}</span>
          </button>
        </h3>
        {verTerminadas &&
          (lista.terminadas.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Ninguna todavía.</p>
          ) : (
            <ul className="divide-y opacity-75">{lista.terminadas.map((f) => fila(f, "terminadas"))}</ul>
          ))}
      </section>
    </div>
  );
}

/**
 * Una fila de una línea. Un `<button>` no puede ir dentro de otro: el de la fila va por debajo, cubriéndola
 * (`absolute inset-0`), y el contenido por encima sin recibir toques, salvo el teléfono y la acción.
 */
function FilaEscritorio({
  reserva,
  mesas,
  sala,
  tarde,
  grupo,
  accion,
  señalada,
  onAbrir,
  onSeñalar,
}: {
  reserva: Reserva;
  mesas: string[];
  sala?: string;
  tarde: boolean;
  grupo: "porLlegar" | "sentadas" | "terminadas";
  accion: ReactNode;
  señalada: boolean;
  onAbrir: () => void;
  onSeñalar?: (id: string | null) => void;
}) {
  const info = ESTADOS_RESERVA[reserva.estado as EstadoReserva] ?? null;
  const tel = enlaceTelefono(reserva.telefono);
  const notas = (reserva.notas_cliente ?? "").trim();
  const alergia = tieneAlergia(notas);
  const sinMesa = mesas.length === 0;
  const fijada = !!reserva.mesa_fijada && !sinMesa;
  const textoMesa = sinMesa ? "Sin mesa" : mesas.join("+");
  const nombre = reserva.nombre || "Sin nombre";
  const estado =
    grupo === "porLlegar" && tarde
      ? { texto: "Tarde", clase: "bg-red-600 text-white" }
      : grupo === "terminadas" && reserva.estado === "completada"
        ? { texto: "Terminada", clase: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100" }
        : info
          ? { texto: info.etiqueta, clase: info.insignia }
          : null;
  const señalar = (si: boolean) => onSeñalar?.(si ? reserva.id : null);
  return (
    <li
      className={cn("relative", señalada && "bg-primary/10")}
      data-reserva-id={reserva.id}
      data-señalada={señalada ? "true" : undefined}
      onMouseEnter={() => señalar(true)}
      onMouseLeave={() => señalar(false)}
    >
      <button
        type="button"
        onClick={onAbrir}
        onFocus={() => señalar(true)}
        onBlur={() => señalar(false)}
        aria-label={`${horaCorta(reserva.hora)} ${nombre}, ${reserva.numero_comensales} personas, ${sinMesa ? "sin mesa" : `${sala ? `${sala}, ` : ""}${textoMesas(mesas).toLowerCase()}`}${estado ? `, ${estado.texto}` : ""}`}
        className="absolute inset-0 h-full w-full touch-manipulation select-none hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-muted/70"
      />
      <div className="pointer-events-none relative flex min-h-[3.25rem] items-center gap-1.5 px-3 py-1">
        {/* Por debajo de 1536 px no cabe la etiqueta: el estado va en un punto de color junto a la hora. */}
        {estado && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full 2xl:hidden", estado.clase)} title={estado.texto} aria-hidden="true" />}
        <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">{horaCorta(reserva.hora)}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={nombre}>
          {nombre}
        </span>
        <span className="flex shrink-0 items-center justify-end gap-0.5 text-sm font-bold tabular-nums" aria-hidden="true">
          <Users className="hidden h-3.5 w-3.5 text-muted-foreground xl:inline" />
          {reserva.numero_comensales}
        </span>
        <span
          className={cn(
            "inline-flex max-w-[5rem] shrink-0 items-center gap-0.5 truncate rounded-md px-1.5 py-0.5 text-xs font-semibold",
            sinMesa
              ? "bg-amber-100 text-amber-900 ring-1 ring-amber-400 dark:bg-amber-950/60 dark:text-amber-200"
              : "bg-muted text-foreground",
          )}
          data-testid="mesa-fila"
          title={sinMesa ? undefined : `${sala ? `${sala} · ` : ""}${textoMesas(mesas)}`}
        >
          {fijada && <Lock className="h-3 w-3 shrink-0" aria-label="Mesa fijada" />}
          {sinMesa ? textoMesa : `M ${textoMesa}`}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {alergia && <AlertTriangle className="h-4 w-4 text-red-600" aria-label="Alergia" />}
          {notas && !alergia && <StickyNote className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-label="Notas del cliente" />}
          {notas && <span className="sr-only">{notas}</span>}
          {tel && (
            <a
              href={tel}
              aria-label={`Llamar a ${nombre}`}
              title={telefonoLegible(reserva.telefono) ?? undefined}
              className="pointer-events-auto -mx-2 -my-2 hidden h-11 w-11 items-center justify-center rounded-md text-primary hover:bg-muted active:bg-muted xl:inline-flex"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
        </span>
        {estado && (
          <span className={cn("hidden w-[4.25rem] shrink-0 truncate rounded-full px-1 py-0.5 text-center text-[11px] font-medium 2xl:inline-block", estado.clase)}>
            {estado.texto}
          </span>
        )}
        {accion}
      </div>
    </li>
  );
}
