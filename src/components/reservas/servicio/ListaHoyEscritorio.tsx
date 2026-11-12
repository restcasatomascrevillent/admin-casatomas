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
import { CheckCircle2, ChevronDown, Lock, Phone, StickyNote } from "lucide-react";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
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
  /** El botón azul «Sentar fuera» de las que faltan por llegar (10/11/2026; se queda en la fila, 11/11/2026). */
  sentarFuera?: (r: Reserva) => ReactNode;
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
  sentarFuera,
  señalada = null,
  onSeñalar,
  servicio = null,
}: ListaHoyEscritorioProps) {
  const [verTerminadas, setVerTerminadas] = useState(false);
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { aceptar, estaEnCurso } = useAccionesServicioReserva();
  const pax = (filas: Array<{ reserva: Reserva }>) => filas.reduce((s, f) => s + (f.reserva.numero_comensales || 0), 0);
  const fila = (f: FilaHoyMovil<Reserva> & { tarde?: boolean }, grupo: "porLlegar" | "sentadas" | "terminadas") => {
    const r = f.reserva;
    // Sin «Sentar» en la fila (11/11/2026, petición del dueño: «quita el botón de sentar»): al tocarla se abre la
    // ficha, con la información, «Verificar» / «Confirmar» y el resto de acciones. «Sentar fuera» sí se queda.
    // Pendiente (12/11/2026, petición del dueño: «en vez de botón de sentar fuera, verificar»): «Verificar» verde, la
    // misma acción que la ficha (correo al cliente y aviso). Las demás que faltan por llegar, «Sentar fuera».
    const pendiente = grupo === "porLlegar" && r.estado === "pendiente";
    const accion =
      pendiente && puedeEditar ? (
        <Button
          type="button"
          className="pointer-events-auto h-11 shrink-0 gap-1.5 bg-emerald-600 px-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          disabled={estaEnCurso(r.id)}
          onClick={() => void aceptar(r as unknown as Parameters<typeof aceptar>[0])}
          aria-label={`Verificar la reserva de ${r.nombre || "Sin nombre"}`}
          data-testid="verificar-fila"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Verificar
        </Button>
      ) : grupo === "porLlegar" ? (
        sentarFuera?.(r)
      ) : null;
    return (
      <FilaEscritorio
        key={r.id}
        reserva={r}
        mesas={f.mesas}
        sala={salaDe(r)}
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
  grupo,
  accion,
  señalada,
  onAbrir,
  onSeñalar,
}: {
  reserva: Reserva;
  mesas: string[];
  sala?: string;
  grupo: "porLlegar" | "sentadas" | "terminadas";
  /** «Sentar fuera» (solo las que faltan por llegar). */
  accion?: ReactNode;
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
  // Sin «Tarde» ni «Sin mesa» (11/11/2026, petición del dueño): junto al nombre, el estado de la reserva
  // (pendiente, verificada, confirmada…).
  const estado =
    grupo === "terminadas" && reserva.estado === "completada"
        ? { texto: "Terminada", clase: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100" }
        : info
          ? { texto: info.etiqueta, clase: info.insignia }
          : null;
  const señalar = (si: boolean) => onSeñalar?.(si ? reserva.id : null);
  return (
    <li
      // Pendientes con fondo naranja translúcido (12/11/2026, petición del dueño), para verlas de un vistazo.
      className={cn("relative", señalada ? "bg-primary/10" : reserva.estado === "pendiente" && grupo === "porLlegar" && "bg-orange-500/15 dark:bg-orange-400/15")}
      data-pendiente={reserva.estado === "pendiente" ? "true" : undefined}
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
      {/* 11/11/2026 (dueño: «mismo estilo para todos los avisos y que las filas tengan homogeneidad»): TODAS las filas
          miden lo mismo y tienen las mismas columnas: hora · (nombre, estado y mesa / observaciones) · personas. La
          segunda línea está siempre, aunque no haya observaciones, y todas las observaciones (también las alergias) van
          con el mismo estilo. */}
      <div className="pointer-events-none relative grid h-[3.75rem] grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 px-3">
        <span className="text-base font-semibold tabular-nums">{horaCorta(reserva.hora)}</span>
        <span className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-base font-semibold leading-6" title={nombre} data-testid="nombre-fila">
              {nombre}
            </span>
            {estado && (
              <span className={cn("shrink-0 rounded-full px-1.5 text-xs font-medium leading-5", estado.clase)} data-testid="estado-fila">
                {estado.texto}
              </span>
            )}
            {fuera ? (
              <EtiquetaFuera reserva={reserva} compacta className="max-w-[8rem] shrink-0 text-sm" />
            ) : (
              !sinMesa && (
                <span
                  className="inline-flex max-w-[6rem] shrink-0 items-center gap-0.5 truncate rounded-md bg-muted px-1.5 text-sm font-semibold leading-5 text-foreground"
                  data-testid="mesa-fila"
                  title={`${sala ? `${sala} · ` : ""}${textoMesas(mesas)}`}
                >
                  {fijada && <Lock className="h-3 w-3 shrink-0" aria-label="Mesa fijada" />}
                  {`M ${textoMesa}`}
                </span>
              )
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
          </span>
          {/* Sin observaciones: el mismo icono y «Sin aviso», en gris (11/11/2026, petición del dueño). */}
          <span
            className={cn(
              "flex h-5 min-w-0 items-center gap-1 text-sm",
              notas ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground",
            )}
            data-testid="notas-fila"
          >
            <StickyNote className="h-4 w-4 shrink-0" aria-label={notas ? (alergia ? "Alergia" : "Notas del cliente") : undefined} aria-hidden={notas ? undefined : true} />
            <span className="truncate" title={notas || undefined}>
              {notas || "Sin aviso"}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
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
          {/* Personas en su recuadro, con el icono y «px» (11/11/2026, petición del dueño). */}
          <BotonPersonas reserva={reserva} className="my-0 gap-0.5 rounded-md border px-1.5 text-base font-bold" icono="h-4 w-4" sufijo="px" />
          {accion}
        </span>
      </div>
    </li>
  );
}
