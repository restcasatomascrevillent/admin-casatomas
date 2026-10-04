// ============================================================================
// Aviso de la sala privada (el Reservado) — pestaña «Hoy» y Dashboard
// ----------------------------------------------------------------------------
// El Reservado está FUERA DE AFORO (decisión del dueño, 2026-10-03: «no se tenga
// en cuenta en los aforos [...] pero que sepamos que está»): no suma capacidad ni
// sus reservas entran en las cifras de ocupación, comensales y %. Este aviso es
// lo que le dice al personal si está ocupado: «Reservado: ocupado — García, 8 pax
// (comida)» o «Reservado: libre». Va SIEMPRE aparte de las cifras de aforo.
// La lógica (qué sala, qué reserva, el texto) vive en `lib/reservas/salaPrivada.ts`.
//
// DESPLEGABLE (04/10/2026, dueño): el kanban ya no pinta columna para el Reservado
// («que salga donde ya sale y si está ocupado, al darle al desplegable veo quién
// es»). Cerrado: la línea de siempre. Abierto, si hay reservas hoy en la sala: UNA
// TARJETA POR RESERVA, la misma del kanban (`ReservaCard`: llegada / no vino /
// deshacer, estrella y menú «⋮» con mover, llamar, editar y blacklist), sin
// arrastre. Libre: la línea, sin desplegable (no hay nada que ver).
//
// `reservas`: las reservas de hoy (filas completas; las canceladas no vienen). Sin
// ellas el aviso sale como antes, sin desplegable. El detalle (y todos sus hooks)
// solo se monta con el desplegable abierto: cerrado no cuesta ni una consulta.
// ============================================================================

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { textoAvisoSalaPrivada, type AvisoSalaPrivada } from "@/lib/reservas/salaPrivada";
import { construirColumnas } from "@/lib/reservas/columnasServicio";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { mesasPorReservaDe, useMovimientoReservaServicio } from "@/hooks/useMovimientoReservaServicio";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { BlacklistModal } from "./BlacklistModal";
import { EtiquetaFueraDeAforo } from "./EtiquetaFueraDeAforo";
import { ReservaCard } from "./ReservaCard";

export function AvisoSalasPrivadas({
  avisos,
  reservas,
  className,
}: {
  avisos: readonly AvisoSalaPrivada[];
  /** Reservas de hoy (cualquier sala): de ahí salen las tarjetas del desplegable. */
  reservas?: readonly ReservaServicio[] | null;
  className?: string;
}) {
  if (avisos.length === 0) return null;
  return (
    <section
      aria-label="Salas privadas, fuera de aforo"
      data-testid="aviso-sala-privada"
      className={cn(
        "space-y-1 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900 dark:bg-violet-950/20",
        className,
      )}
    >
      {avisos.map((aviso) => (
        <AvisoDeSala
          key={aviso.espacioId}
          aviso={aviso}
          reservasDeLaSala={(reservas ?? [])
            .filter((r) => r && r.espacio_id === aviso.espacioId && r.estado !== "cancelada")
            .sort((a, b) => String(a.hora).localeCompare(String(b.hora)))}
        />
      ))}
    </section>
  );
}

function AvisoDeSala({ aviso, reservasDeLaSala }: { aviso: AvisoSalaPrivada; reservasDeLaSala: ReservaServicio[] }) {
  const [abierto, setAbierto] = useState(false);
  const contenido = (
    <>
      <Lock className="h-3.5 w-3.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
      <span className={cn("min-w-0 break-words", aviso.ocupada ? "font-medium" : "text-muted-foreground")}>
        {textoAvisoSalaPrivada(aviso)}
      </span>
      <EtiquetaFueraDeAforo />
    </>
  );

  // Libre (o sin datos de reservas): la línea de siempre, sin nada que desplegar. Si estaba abierto y se
  // acaba de mover la última reserva a otra sala se queda desplegado (y montado: el mapa para darle mesa
  // en la sala nueva vive en el detalle) hasta que se cierre.
  if (reservasDeLaSala.length === 0 && !abierto) {
    return (
      <p
        data-ocupada={aviso.ocupada ? "true" : "false"}
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      >
        {contenido}
      </p>
    );
  }

  return (
    <Collapsible open={abierto} onOpenChange={setAbierto} data-ocupada={aviso.ocupada ? "true" : "false"}>
      {/* Con dedo, 44 px de alto (`pointer-coarse:min-h-11`); con ratón, la línea compacta de siempre. */}
      <CollapsibleTrigger
        className={cn(
          "group flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-0.5 text-left text-sm",
          "pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label={`${textoAvisoSalaPrivada(aviso)}. ${abierto ? "Ocultar" : "Ver"} las reservas de ${aviso.nombre}`}
      >
        {contenido}
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <DetalleSalaPrivada reservas={reservasDeLaSala} nombreSala={aviso.nombre} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Las tarjetas de las reservas de la sala, con las mismas acciones que en el kanban. Se monta
 * solo con el desplegable abierto (Radix desmonta el contenido cerrado), así que los hooks de
 * aquí —acciones, permisos, mesas, editor— no cuestan nada mientras está plegado.
 */
function DetalleSalaPrivada({ reservas, nombreSala }: { reservas: ReservaServicio[]; nombreSala: string }) {
  const hoy = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const acciones = useAccionesServicioReserva();
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const { data: espacios } = useEspaciosReserva();
  const { data: asignaciones } = useAsignacionesMesa(hoy);
  const [blacklist, setBlacklist] = useState<ReservaServicio | null>(null);

  // Mismas columnas (destinos de «Mover a…») que el kanban: «Sin asignar», las salas y el Reservado.
  const columnas = useMemo(() => construirColumnas(espacios), [espacios]);
  const mesasPorReserva = useMemo(() => mesasPorReservaDe(asignaciones), [asignaciones]);
  const { solicitarMovimiento, dialogos } = useMovimientoReservaServicio({
    acciones,
    columnas,
    reservas,
    mesasPorReserva,
    fecha: hoy,
  });

  return (
    <div className="pt-2">
      {reservas.length === 0 && <p className="text-sm text-muted-foreground">{`Sin reservas hoy en ${nombreSala}`}</p>}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Reservas de la sala privada">
        {reservas.map((reserva) => (
          <li key={reserva.id} className="min-w-0">
            <ReservaCard
              reserva={reserva}
              columnas={columnas}
              acciones={acciones}
              onMover={solicitarMovimiento}
              onToggleImportante={(r) => void acciones.alternarImportante(r)}
              onBlacklist={setBlacklist}
              onEditar={(r) => editarReserva(r.id)}
              mesas={mesasPorReserva.get(reserva.id)}
              puedeEditar={puedeEditar}
              sinArrastre
              telefonoEnlace
            />
          </li>
        ))}
      </ul>
      {dialogos}
      <BlacklistModal
        reserva={blacklist}
        open={!!blacklist}
        onOpenChange={(open) => {
          if (!open) setBlacklist(null);
        }}
      />
      {dialogoEdicion}
    </div>
  );
}
