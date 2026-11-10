// «¿Dentro o fuera?» del formulario de reserva (dueño, 10/11/2026). Va justo antes de «Asignación interna».
// Dos botones grandes, «Dentro» | «Fuera», sin ninguno marcado por defecto (= no se dice nada); volver a tocar
// el marcado lo quita. Con «Dentro» aparece «Comedor | Salón» (las salas de dentro); con «Fuera», la Terraza
// (se pone sola si es la única). Respeta el menú del día (Comedor o Terraza) y la carta (Salón, Comedor o
// Terraza): lo que no vale sale deshabilitado con el motivo. Reglas en `src/lib/reservas/zonaPreferida.ts`.
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { ServicioComida } from "@/lib/reservas/menuDelDia";
import {
  avisoZonaSala,
  opcionesSalaDeZona,
  salaAlElegirZona,
  type SalaConZona,
  type ZonaPreferida,
} from "@/lib/reservas/zonaPreferida";

type SalaSelector = SalaConZona & { id: string; nombre: string; privada?: boolean | null };

export interface SelectorZonaProps {
  zona: ZonaPreferida | null;
  espacioId: string | null;
  salas: readonly SalaSelector[];
  /** Menú del día / Carta (martes a jueves comida); null = sin regla de sala. */
  servicio: ServicioComida | null;
  /** Cambia la zona y, si toca, la sala (`salaAlElegirZona`). */
  onCambiar: (zona: ZonaPreferida | null, espacioId: string | null) => void;
  grande?: boolean;
}

const OPCIONES: ReadonlyArray<{ valor: ZonaPreferida; texto: string }> = [
  { valor: "dentro", texto: "Dentro" },
  { valor: "fuera", texto: "Fuera" },
];

export function SelectorZona({ zona, espacioId, salas, servicio, onCambiar, grande }: SelectorZonaProps) {
  const opciones = zona ? opcionesSalaDeZona(salas, zona, servicio) : [];
  const salaElegida = espacioId ? salas.find((s) => s.id === espacioId) ?? null : null;
  const aviso = avisoZonaSala(salaElegida, zona);

  return (
    <div className="space-y-4" data-testid="selector-zona">
      <p id="etiqueta-zona" className={cn("font-medium", grande ? "text-base" : "text-sm")}>
        ¿Dentro o fuera? <span className="font-normal text-muted-foreground">(opcional)</span>
      </p>
      <div role="radiogroup" aria-labelledby="etiqueta-zona" className="grid grid-cols-2 gap-3">
        {OPCIONES.map((opcion) => {
          const elegido = zona === opcion.valor;
          return (
            <Button
              key={opcion.valor}
              type="button"
              role="radio"
              aria-checked={elegido}
              variant="outline"
              data-testid={`zona-${opcion.valor}`}
              onClick={() => {
                // Volver a tocar la marcada la quita (= no se dice nada); la sala no se toca.
                const nueva = elegido ? null : opcion.valor;
                onCambiar(nueva, salaAlElegirZona(salas, nueva, servicio, espacioId));
              }}
              className={cn(
                grande ? "h-14 text-lg" : "h-12 text-base",
                elegido &&
                  (opcion.valor === "fuera"
                    ? "border-emerald-400 bg-emerald-100 font-semibold text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-200"
                    : "border-amber-400 bg-amber-100 font-semibold text-amber-900 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-200"),
              )}
            >
              {opcion.texto}
            </Button>
          );
        })}
      </div>

      {zona && opciones.length > 0 && (
        <div className="space-y-2">
          <div
            role="radiogroup"
            aria-label={zona === "dentro" ? "Sala de dentro" : "Sala de fuera"}
            className={cn("grid gap-3", opciones.length > 1 ? "grid-cols-2" : "grid-cols-1")}
          >
            {opciones.map(({ sala, habilitada, motivo }) => {
              const elegida = espacioId === sala.id;
              return (
                <Button
                  key={sala.id}
                  type="button"
                  role="radio"
                  aria-checked={elegida}
                  variant="outline"
                  disabled={!habilitada}
                  title={motivo ?? undefined}
                  data-testid={`zona-sala-${sala.nombre}`}
                  onClick={() => onCambiar(zona, elegida ? null : sala.id)}
                  className={cn(
                    "h-auto flex-col gap-0.5 px-4 py-2",
                    grande ? "min-h-14 text-lg" : "min-h-11",
                    elegida && "border-primary bg-primary/10 font-semibold hover:bg-primary/10",
                  )}
                >
                  <span>{sala.nombre}</span>
                  {motivo && <span className="whitespace-normal text-xs font-normal text-muted-foreground">{motivo}</span>}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {zona && opciones.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No hay salas de {zona === "fuera" ? "fuera" : "dentro"} activas: se guarda solo la preferencia.
        </p>
      )}

      {aviso && (
        <Alert
          data-testid="aviso-zona-sala"
          className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
