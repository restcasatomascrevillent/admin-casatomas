// ============================================================================
// «Personas» que se cambian con un toque (10/11/2026, petición del dueño: «en Hoy
// se tiene que poder cambiar el número de personas también, intuitivamente»).
// ----------------------------------------------------------------------------
// `BotonPersonas`: el número de personas de una fila o ficha de «Hoy». Al tocarlo
// se abre un selector grande: − / + con «Guardar» y números rápidos del 1 al 12,
// que guardan al instante. Con solo «Ver» en Reservas es el número de siempre,
// sin botón. La escritura y los avisos están en `useCambiarPersonas`.
// ============================================================================

import { useState, type MouseEvent } from "react";
import { Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useCambiarPersonas, type ReservaPersonas } from "@/hooks/useCambiarPersonas";
import { cn } from "@/lib/utils";

const RAPIDOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function BotonPersonas({
  reserva,
  className,
  icono = "h-5 w-5",
}: {
  reserva: ReservaPersonas;
  /** Clases del número (tamaño de letra de la fila donde va). */
  className?: string;
  /** Tamaño del icono de personas. */
  icono?: string;
}) {
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const [abierto, setAbierto] = useState(false);
  const contenido = (
    <>
      <Users className={cn(icono, "text-muted-foreground")} aria-hidden="true" />
      {reserva.numero_comensales}
    </>
  );
  if (!puedeEditar) {
    return (
      <span className={cn("flex shrink-0 items-center gap-1 tabular-nums", className)} aria-hidden="true">
        {contenido}
      </span>
    );
  }
  const abrir = (e: MouseEvent) => {
    // Va encima del botón de la fila: que no abra también la ficha.
    e.stopPropagation();
    setAbierto(true);
  };
  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label={`Personas de ${reserva.nombre?.trim() || "la reserva"}: ${reserva.numero_comensales}. Cambiar`}
        title="Cambiar el número de personas"
        data-testid="boton-personas"
        className={cn(
          "pointer-events-auto -my-1.5 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1.5 tabular-nums hover:bg-muted active:bg-muted",
          className,
        )}
      >
        {contenido}
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          {abierto && <SelectorPersonas reserva={reserva} onCerrar={() => setAbierto(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** El selector: − / + y «Guardar», o un número rápido que guarda al instante. */
export function SelectorPersonas({ reserva, onCerrar }: { reserva: ReservaPersonas; onCerrar: () => void }) {
  const cambiar = useCambiarPersonas();
  const actual = Number(reserva.numero_comensales) || 1;
  // Texto para poder escribirlo a mano (10/11/2026); los botones − / + lo cambian igual.
  const [texto, setTexto] = useState(String(actual));
  const valor = Number(texto) || 0;
  const setValor = (f: (v: number) => number) => setTexto(String(f(valor)));
  const [guardando, setGuardando] = useState(false);
  const guardar = async (n: number) => {
    setGuardando(true);
    try {
      if (await cambiar(reserva, n)) onCerrar();
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="space-y-4">
      <DialogHeader className="text-left">
        <DialogTitle>¿Cuántas personas?</DialogTitle>
        <DialogDescription>
          {reserva.nombre?.trim() || "Reserva"} · ahora {actual}
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          className="h-16 w-16"
          aria-label="Una persona menos"
          disabled={guardando || valor <= 1}
          onClick={() => setValor((v) => Math.max(1, v - 1))}
        >
          <Minus className="h-7 w-7" aria-hidden="true" />
        </Button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label="Personas"
          className="h-16 w-24 rounded-md border bg-background text-center text-5xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          value={texto}
          disabled={guardando}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTexto(e.target.value.replace(/\D/g, "").slice(0, 3))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valor >= 1 && valor !== actual) void guardar(valor);
          }}
        />
        <Button
          variant="outline"
          className="h-16 w-16"
          aria-label="Una persona más"
          disabled={guardando}
          onClick={() => setValor((v) => v + 1)}
        >
          <Plus className="h-7 w-7" aria-hidden="true" />
        </Button>
      </div>
      <Button className="h-14 w-full text-base font-semibold" disabled={guardando || valor < 1 || valor === actual} onClick={() => void guardar(valor)}>
        {valor < 1 ? "Escribe el número" : valor === actual ? "Sin cambios" : `Guardar ${valor} personas`}
      </Button>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">O toca el número (se guarda al momento):</p>
        <div className="grid grid-cols-6 gap-2">
          {RAPIDOS.map((n) => (
            <Button
              key={n}
              variant={n === actual ? "default" : "outline"}
              className="h-12 text-lg font-semibold"
              disabled={guardando}
              aria-pressed={n === actual}
              onClick={() => void guardar(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
