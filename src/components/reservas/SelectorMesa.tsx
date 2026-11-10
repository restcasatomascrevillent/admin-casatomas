// ============================================================================
// Selector «¿Dónde se sientan?» con TODAS las mesas (de todas las salas) y la
// confirmación «Sentar igualmente». Salió de `VistaHoyMovil.tsx` (10/11/2026)
// para usarlo igual al sentar una reserva sin mesa y a quien entra sin reserva
// (`SentarSinReserva.tsx`), petición del dueño.
// ============================================================================

import { Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MesaParaConfirmar, SelectorMesas } from "@/lib/reservas/confirmarMesa";
import { cn } from "@/lib/utils";

const horaCorta = (h: string) => (h ?? "").slice(0, 5);

/**
 * Rejilla de botones grandes con las mesas de TODAS las salas donde cabe la reserva, agrupadas por sala:
 * arriba la suya (la prevista, o donde está sentada); cada una marcada libre (verde), prevista para otra
 * reserva (ámbar, se puede elegir) u ocupada por alguien sentado (gris, no se puede).
 * Con `elegidaId` (quien entra sin reserva) la mesa marcada se resalta y cada botón dice si está pulsado.
 */
export function SelectorMesaMovil({
  selector,
  sentada,
  ocupado,
  onElegir,
  fijadaPropia = false,
  elegidaId,
}: {
  selector: SelectorMesas;
  /** La reserva ya está sentada: su mesa actual no se vuelve a ofrecer. */
  sentada: boolean;
  ocupado: boolean;
  onElegir: (m: MesaParaConfirmar) => void;
  /** La propia reserva tiene la mesa fijada: candado en «Su mesa». */
  fijadaPropia?: boolean;
  /** Mesa marcada (modo «elegir y luego sentar»). `undefined`: cada toque sienta directamente. */
  elegidaId?: string | null;
}) {
  const conMarca = elegidaId !== undefined;
  const casilla = (m: MesaParaConfirmar) => {
    // Fijada para OTRA reserva (07/11/2026): se ve, con candado, pero no se puede elegir.
    const fijadaOtra = !m.propia && m.estado.tipo === "fijada";
    const deshabilitada = ocupado || m.estado.tipo === "ocupada" || fijadaOtra || (m.propia && sentada);
    const marcada = conMarca && m.id === elegidaId;
    const detalle = m.propia && (sentada || (m.estado.tipo !== "ocupada" && m.estado.tipo !== "fijada"))
      ? sentada
        ? "Aquí está"
        : fijadaPropia
          ? "Su mesa (fijada)"
          : "Su mesa prevista"
      : m.estado.tipo === "ocupada"
        ? `Ocupada · ${m.estado.nombre}`
        : m.estado.tipo === "fijada"
          ? `Fijada · ${m.estado.nombre} ${horaCorta(m.estado.hora)}`
          : m.estado.tipo === "prevista"
            ? `Prevista: ${m.estado.desplazadas.map((d) => `${d.nombre} ${horaCorta(d.hora)}`).join(", ")}`
            : m.alFinal
              ? "Libre · Mejor dejar libre"
              : "Libre";
    const candado = fijadaOtra || (m.propia && fijadaPropia);
    return (
      <li key={m.id}>
        <button
          type="button"
          disabled={deshabilitada}
          onClick={() => onElegir(m)}
          aria-label={`Mesa ${m.nombre}, ${m.plazas} plazas, ${m.salaNombre}: ${detalle}`}
          aria-pressed={conMarca && !deshabilitada ? marcada : undefined}
          className={cn(
            "flex min-h-16 w-full flex-col items-start justify-between rounded-lg border-2 p-2 text-left active:scale-[0.98] disabled:cursor-not-allowed",
            m.propia && "border-primary bg-primary/10",
            !m.propia && m.estado.tipo === "libre" && "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
            !m.propia && m.estado.tipo === "prevista" && "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
            !m.propia && (m.estado.tipo === "ocupada" || m.estado.tipo === "fijada") && "border-muted bg-muted/60 text-muted-foreground opacity-70",
            marcada && "ring-4 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <span className="flex w-full items-baseline justify-between gap-1">
            <span className="flex items-center gap-1 text-lg font-bold leading-none">
              {m.nombre}
              {candado && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
              <Users className="h-3 w-3" aria-hidden />
              {m.plazas}
            </span>
          </span>
          <span className="line-clamp-2 w-full text-xs">{detalle}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3" data-testid="selector-mesa">
      {selector.propias.length > 0 && (
        <section aria-label={sentada ? "Su mesa" : "Prevista"}>
          <h4 className="mb-1 text-sm font-semibold">{sentada ? "Ahora en" : "Prevista"}</h4>
          <ul className="grid grid-cols-3 gap-2">{selector.propias.map(casilla)}</ul>
        </section>
      )}
      {selector.salas.map((s) => (
        <section key={s.salaId} aria-label={s.salaNombre}>
          <h4 className="mb-1 text-sm font-semibold">{s.salaNombre}</h4>
          <ul className="grid grid-cols-3 gap-2">{s.mesas.map(casilla)}</ul>
        </section>
      ))}
    </div>
  );
}

// ─── Confirmación «Sentar igualmente» ────────────────────────────────────────

export interface Pendiente {
  texto: string;
  ejecutar: () => Promise<unknown>;
  /** Texto del botón de confirmar (por defecto «Sentar igualmente»). */
  boton?: string;
}

export function ConfirmarDesplazamiento({
  pendiente,
  ocupado,
  onConfirmar,
  onCancelar,
}: {
  pendiente: Pendiente;
  ocupado: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/40">
      <p className="text-sm font-medium">{pendiente.texto}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" disabled={ocupado} onClick={onCancelar}>
          Cancelar
        </Button>
        <Button className="h-12" disabled={ocupado} onClick={onConfirmar}>
          {pendiente.boton ?? "Sentar igualmente"}
        </Button>
      </div>
    </div>
  );
}
