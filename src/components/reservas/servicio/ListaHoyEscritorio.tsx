// ============================================================================
// «HOY» DE ESCRITORIO — la lista completa del turno, por estados
// ----------------------------------------------------------------------------
// Petición del dueño (07/11/2026, al ver la v0.386 en el ordenador): «eso era para
// el móvil». En vez de las tarjetas grandes del móvil, filas compactas de 56 px en
// dos líneas (10/11/2026, para que el nombre se lea entero): arriba hora · NOMBRE ·
// pax · acción corta («Fuera» en icono, «Sentar», «Liberar»); debajo mesa («Sin
// mesa» resaltado) · iconos (menú, alergia, nota) · estado. Agrupadas:
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
import { formatearPrecioMenu, textoInsigniaMenu } from "@/lib/reservas/menuCerrado";
import { InsigniaZona } from "@/components/reservas/InterruptoresServiciosOnline";
import { AlertTriangle, ChevronDown, Lock, Phone, StickyNote, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BotonPersonas } from "@/components/reservas/CambiarPersonas";
import { cn } from "@/lib/utils";
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";
import { textoMesas, tieneAlergia, type FilaHoyMovil, type ListaHoyEscritorio as Lista } from "@/lib/reservas/hoyMovil";
import type { ReservaMesaServicio } from "@/lib/reservas/servicioSala";
import { enlaceTelefono, telefonoLegible } from "@/lib/reservas/telefono";
import { estaSentadaFuera } from "@/lib/reservas/sentarFuera";
import { EtiquetaFuera } from "@/components/reservas/SentarFuera";
import { FilasPorMenu, type ServicioMostrado } from "./FilasPorMenu";

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
  /** El botón azul «Sentar fuera» (por llegar, 10/11/2026). Sin él (solo «Ver») no hay botón. */
  sentarFuera?: (r: Reserva) => ReactNode;
  /** Su mesa prevista la ocupa alguien sentado: «Sentar» abrirá el selector. */
  mesaPrevistaOcupada?: (r: Reserva) => boolean;
  /** Reserva con una acción en curso (botón desactivado). */
  ocupadaId?: string | null;
  /** La reserva señalada (resaltada aquí y en el plano). */
  señalada?: string | null;
  onSeñalar?: (id: string | null) => void;
  /** Fecha y turno a la vista: la comida de martes a jueves va en «Menú del día» / «Carta» / «Resto» (10/11/2026). */
  servicio?: ServicioMostrado | null;
}

export function ListaHoyEscritorio({
  lista,
  salaDe,
  onAbrir,
  onSentar,
  onLiberar,
  sentarFuera,
  mesaPrevistaOcupada,
  ocupadaId = null,
  señalada = null,
  onSeñalar,
  servicio = null,
}: ListaHoyEscritorioProps) {
  const [verTerminadas, setVerTerminadas] = useState(false);
  const pax = (filas: Array<{ reserva: Reserva }>) => filas.reduce((s, f) => s + (f.reserva.numero_comensales || 0), 0);
  const fila = (f: FilaHoyMovil<Reserva> & { tarde?: boolean }, grupo: "porLlegar" | "sentadas" | "terminadas") => {
    const r = f.reserva;
    let accion: ReactNode = null;
    if (grupo === "porLlegar" && onSentar) {
      const elegir = f.mesas.length === 0 || !!mesaPrevistaOcupada?.(r);
      accion = (
        <>
        {sentarFuera?.(r)}
        <Button
          type="button"
          size="sm"
          className="pointer-events-auto h-11 w-[4.25rem] shrink-0 px-1 text-sm font-semibold"
          disabled={ocupadaId === r.id}
          onClick={() => onSentar(r)}
          aria-label={elegir ? `Sentar a ${r.nombre || "la reserva"}: elegir mesa` : `Sentar a ${r.nombre || "la reserva"} en ${textoMesas(f.mesas).toLowerCase()}`}
        >
          Sentar
        </Button>
        </>
      );
    } else if (grupo === "sentadas" && onLiberar && f.mesas.length > 0) {
      accion = (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="pointer-events-auto h-11 w-[4.25rem] shrink-0 px-1 text-sm font-semibold"
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
      <span className="text-sm font-normal tabular-nums text-muted-foreground">
        {filas.length} · {pax(filas)} pax
      </span>
    </>
  );
  const claseCabecera = "sticky top-0 z-10 flex min-h-11 w-full items-center justify-between gap-2 border-b bg-muted/95 px-3 py-1.5 text-base font-semibold backdrop-blur";

  return (
    <div data-testid="lista-hoy-escritorio">
      <section aria-label="Por llegar">
        <h3 className={claseCabecera}>{cabecera("Por llegar", lista.porLlegar)}</h3>
        {lista.porLlegar.length === 0 ? (
          <p className="px-3 py-2 text-base text-muted-foreground">Nadie por llegar.</p>
        ) : (
          <FilasPorMenu filas={lista.porLlegar} servicio={servicio} pintar={(f) => fila(f, "porLlegar")} />
        )}
      </section>
      <section aria-label="Sentadas">
        <h3 className={claseCabecera}>{cabecera("Sentadas", lista.sentadas)}</h3>
        {lista.sentadas.length === 0 ? (
          <p className="px-3 py-2 text-base text-muted-foreground">Nadie sentado.</p>
        ) : (
          <FilasPorMenu filas={lista.sentadas} servicio={servicio} pintar={(f) => fila(f, "sentadas")} />
        )}
      </section>
      <section aria-label="Terminadas, no vino y canceladas">
        <h3>
          <button type="button" className={cn(claseCabecera, "text-left")} aria-expanded={verTerminadas} onClick={() => setVerTerminadas((v) => !v)}>
            <span className="flex items-center gap-1.5">
              <ChevronDown className={cn("h-4 w-4 transition-transform", verTerminadas && "rotate-180")} aria-hidden="true" />
              Terminadas / No vino / Canceladas
            </span>
            <span className="text-sm font-normal tabular-nums text-muted-foreground">{lista.terminadas.length}</span>
          </button>
        </h3>
        {verTerminadas &&
          (lista.terminadas.length === 0 ? (
            <p className="px-3 py-2 text-base text-muted-foreground">Ninguna todavía.</p>
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
  // Sentada fuera de las salas (Touza…): en vez de la mesa, la etiqueta azul (10/11/2026).
  const fuera = estaSentadaFuera(reserva);
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
        aria-label={`${horaCorta(reserva.hora)} ${nombre}, ${reserva.numero_comensales} personas, ${fuera ? `fuera, ${reserva.fuera_lugar}` : sinMesa ? "sin mesa" : `${sala ? `${sala}, ` : ""}${textoMesas(mesas).toLowerCase()}`}${estado ? `, ${estado.texto}` : ""}`}
        className="absolute inset-0 h-full w-full touch-manipulation select-none hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-muted/70"
      />
      {/* 10/11/2026 («los nombres no se ven, y eso es lo primordial»): DOS líneas. Arriba, la hora y el nombre
          con todo el ancho que dejan las personas y los botones; debajo, la mesa, los avisos y el estado. Así el
          nombre ya no compite con «Sin mesa», el estado y los iconos (antes se quedaba en 3-6 letras). */}
      <div className="pointer-events-none relative flex min-h-14 items-center gap-1 px-2 py-1">
        <span className="w-11 shrink-0 self-start pt-0.5 text-base font-semibold tabular-nums">{horaCorta(reserva.hora)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-semibold leading-6" title={nombre} data-testid="nombre-fila">
            {nombre}
          </span>
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {fuera ? (
              <EtiquetaFuera reserva={reserva} compacta className="max-w-[8rem] shrink-0 text-sm" />
            ) : (
              <span
                className={cn(
                  "inline-flex max-w-[6rem] shrink-0 items-center gap-0.5 truncate rounded-md px-1.5 text-sm font-semibold leading-5",
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
            )}
            {reserva.menu_del_dia && (
              <span className="shrink-0 rounded-full bg-violet-100 px-1.5 text-xs font-medium leading-5 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200" title="Menú del día">
                Menú
              </span>
            )}
            {reserva.menu_cerrado && (
              <span
                className="shrink-0 rounded-full bg-teal-100 px-1.5 text-xs font-medium leading-5 text-teal-900 dark:bg-teal-950/60 dark:text-teal-200"
                title={`Menú cerrado${formatearPrecioMenu(reserva.menu_precio) ? ` · ${formatearPrecioMenu(reserva.menu_precio)}` : ""}`}
              >
                {textoInsigniaMenu(reserva.menu_precio)}
              </span>
            )}
            <InsigniaZona reserva={reserva} className="px-1.5 py-0 leading-5" />
            {alergia && <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-label="Alergia" />}
            {notas && !alergia && <StickyNote className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-label="Notas del cliente" />}
            {notas && <span className="sr-only">{notas}</span>}
            {estado && (
              <span className={cn("min-w-0 truncate rounded-full px-1.5 text-xs font-medium leading-5", estado.clase)} data-testid="estado-fila">
                {estado.texto}
              </span>
            )}
          </span>
        </span>
        {tel && (
          <a
            href={tel}
            aria-label={`Llamar a ${nombre}`}
            title={telefonoLegible(reserva.telefono) ?? undefined}
            className="pointer-events-auto hidden h-11 w-11 shrink-0 items-center justify-center rounded-md text-primary hover:bg-muted active:bg-muted 2xl:inline-flex"
          >
            <Phone className="h-5 w-5" aria-hidden="true" />
          </a>
        )}
        {/* Tocar el número cambia las personas (10/11/2026). */}
        <BotonPersonas reserva={reserva} className="my-0 gap-0.5 text-base font-bold" icono="hidden h-4 w-4 2xl:inline" />
        {accion}
      </div>
    </li>
  );
}
