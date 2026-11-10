// ============================================================================
// «SENTAR FUERA» — botón azul, diálogo y etiqueta (10/11/2026)
// ----------------------------------------------------------------------------
// Petición del dueño: «Añade un botón en hoy de reservas azul chillón que sea sentar fuera y sean mesas que
// no cuenten en los espacios predefinidos pero sí que se guarde esa info, por lo general se sientan en Touza
// o Terraza Touza».
//
//   · `BotonSentarFuera`: azul eléctrico (#0050FF, blanco encima: contraste 5,9:1), distinto de todos los
//     demás botones del panel. Abre el diálogo.
//   · `DialogoSentarFuera`: dónde (Touza y Terraza Touza en grande, «Otro» con texto libre) y, opcional,
//     mesa o nota. Con una reserva ya fuera: cambiar el sitio o «Sentar dentro».
//   · `EtiquetaFuera`: «Fuera · Touza · Mesa 4», en el mismo azul, para tarjetas, filas, Lista y editor.
// Reglas: `src/lib/reservas/sentarFuera.ts`. Escritura: `useAccionesServicioReserva` (`sentarFuera`,
// `quitarFuera`). Quién: el que lo pinta solo lo ofrece con «Editar» en Reservas; la BD lo exige igual (RLS).
// ============================================================================

import { useEffect, useId, useState, type ReactNode, type SyntheticEvent } from "react";
import { Loader2, LogIn, Trees } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { cn } from "@/lib/utils";
import {
  LUGARES_FUERA_RAPIDOS,
  MAX_LUGAR_FUERA,
  MAX_MESA_FUERA,
  estaSentadaFuera,
  etiquetaFuera,
  limpiarTextoFuera,
} from "@/lib/reservas/sentarFuera";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";

/** El azul chillón de «Sentar fuera» (blanco encima: 5,9:1). Hover y pulsado, más oscuros. */
export const CLASE_AZUL_FUERA =
  "bg-[#0050FF] text-white shadow-[0_0_0_2px_rgba(0,80,255,0.25)] hover:bg-[#0043D6] active:bg-[#0037B0] focus-visible:ring-[#0050FF] disabled:bg-[#0050FF]/60";

type ReservaFuera = ReservaServicio & { salida_at?: string | null };

/** Dentro de una tarjeta arrastrable o de una fila que se abre al tocarla: el toque es solo del botón. */
const aislar = {
  "data-sin-menu-tarjeta": "",
  onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
};

/** «Fuera · Touza · Mesa 4» en azul. Nada si la reserva no está fuera. */
export function EtiquetaFuera({
  reserva,
  className,
  compacta = false,
}: {
  reserva: { estado: string; fuera_lugar?: string | null; fuera_mesa?: string | null };
  className?: string;
  /** Sin la mesa (filas estrechas); el texto entero va en el `title`. */
  compacta?: boolean;
}) {
  if (!estaSentadaFuera(reserva)) return null;
  const completa = etiquetaFuera(reserva);
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-md bg-[#0050FF] px-2 py-0.5 text-xs font-bold text-white",
        className,
      )}
      title={completa}
      data-testid="etiqueta-fuera"
    >
      <Trees className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{compacta ? etiquetaFuera(reserva, { conMesa: false }) : completa}</span>
    </span>
  );
}

/**
 * El botón azul. `variante`:
 *   · `grande`: ancho completo, 56 px (ficha de la reserva);
 *   · `fila`: cuadrado de 56 px con «Fuera» debajo del icono (fila del móvil);
 *   · `compacto`: 44 px de alto, «Fuera» (fila de escritorio, tarjeta).
 */
export function BotonSentarFuera({
  reserva,
  variante = "grande",
  disabled,
  className,
  onHecho,
}: {
  reserva: ReservaFuera;
  variante?: "grande" | "fila" | "compacto";
  disabled?: boolean;
  className?: string;
  /** Tras guardar (p. ej. cerrar la ficha). */
  onHecho?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const yaFuera = estaSentadaFuera(reserva);
  const nombre = reserva.nombre || "la reserva";
  const etiqueta = yaFuera ? "Cambiar sitio de fuera" : "Sentar fuera";
  return (
    <>
      <Button
        type="button"
        {...aislar}
        className={cn(
          "pointer-events-auto touch-manipulation font-bold",
          CLASE_AZUL_FUERA,
          variante === "grande" && "h-14 w-full text-base",
          variante === "fila" && "h-14 w-14 shrink-0 flex-col gap-0 px-0 text-xs leading-tight pointer-coarse:h-14 pointer-coarse:w-14 pointer-coarse:px-0",
          // Fila de escritorio: solo el icono (44 × 44), a cualquier ancho: el sitio es para el nombre (10/11/2026).
          // Lo dicen el `title` y el `aria-label`.
          variante === "compacto" && "h-11 w-11 shrink-0 gap-1 px-0 text-sm pointer-coarse:px-0",
          className,
        )}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setAbierto(true);
        }}
        aria-label={`${etiqueta}: ${nombre}`}
        title={etiqueta}
        data-testid="boton-sentar-fuera"
      >
        <Trees className={variante === "fila" ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
        {variante === "grande" ? (
          yaFuera ? "Cambiar sitio de fuera" : "Sentar fuera"
        ) : (
          <span className={variante === "compacto" ? "sr-only" : undefined}>Fuera</span>
        )}
      </Button>
      <DialogoSentarFuera
        reserva={reserva}
        abierto={abierto}
        onOpenChange={setAbierto}
        onHecho={() => {
          setAbierto(false);
          onHecho?.();
        }}
      />
    </>
  );
}

/** Elegir dónde se sientan fuera (o cambiarlo, o volver dentro). */
export function DialogoSentarFuera({
  reserva,
  abierto,
  onOpenChange,
  onHecho,
}: {
  reserva: ReservaFuera;
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  onHecho?: () => void;
}) {
  const { sentarFuera, quitarFuera } = useAccionesServicioReserva();
  const yaFuera = estaSentadaFuera(reserva);
  const idOtro = useId();
  const idMesa = useId();
  const lugarActual = limpiarTextoFuera(reserva.fuera_lugar, MAX_LUGAR_FUERA);
  const esRapido = (l: string) => (LUGARES_FUERA_RAPIDOS as readonly string[]).includes(l);
  // Por defecto, Touza (lo más habitual); si ya está fuera, lo que tiene.
  const [opcion, setOpcion] = useState<string>("Touza");
  const [otro, setOtro] = useState("");
  const [mesa, setMesa] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    if (yaFuera && lugarActual) {
      setOpcion(esRapido(lugarActual) ? lugarActual : "otro");
      setOtro(esRapido(lugarActual) ? "" : lugarActual);
    } else {
      setOpcion("Touza");
      setOtro("");
    }
    setMesa(yaFuera ? limpiarTextoFuera(reserva.fuera_mesa, MAX_MESA_FUERA) : "");
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const lugar = opcion === "otro" ? limpiarTextoFuera(otro, MAX_LUGAR_FUERA) : opcion;
  const nombre = reserva.nombre || "la reserva";

  const guardar = async () => {
    if (!lugar) return;
    setGuardando(true);
    try {
      if (await sentarFuera(reserva, { lugar, mesa })) onHecho?.();
    } finally {
      setGuardando(false);
    }
  };
  const volverDentro = async () => {
    setGuardando(true);
    try {
      if (await quitarFuera(reserva)) onHecho?.();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !guardando && onOpenChange(o)}>
      <DialogContent className="max-w-md" {...aislar} onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{yaFuera ? "Cambiar sitio de fuera" : "Sentar fuera"}</DialogTitle>
          <DialogDescription>
            {nombre} · {reserva.numero_comensales} pax. Fuera de las salas: no ocupa mesa ni cuenta en ningún espacio,
            pero queda apuntado dónde se sientan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">¿Dónde?</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Dónde se sientan">
              {LUGARES_FUERA_RAPIDOS.map((l) => (
                <OpcionLugar key={l} activa={opcion === l} onClick={() => setOpcion(l)}>
                  {l}
                </OpcionLugar>
              ))}
              <OpcionLugar activa={opcion === "otro"} onClick={() => setOpcion("otro")} className="col-span-2">
                Otro sitio
              </OpcionLugar>
            </div>
            {opcion === "otro" && (
              <div className="space-y-1">
                <label htmlFor={idOtro} className="text-sm text-muted-foreground">
                  Escribe dónde
                </label>
                <Input
                  id={idOtro}
                  autoFocus
                  value={otro}
                  maxLength={MAX_LUGAR_FUERA}
                  onChange={(e) => setOtro(e.target.value)}
                  placeholder="Barra, terraza de enfrente…"
                  className="h-12 text-base"
                />
              </div>
            )}
          </fieldset>

          <div className="space-y-1">
            <label htmlFor={idMesa} className="text-sm font-semibold">
              Mesa o nota <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Input
              id={idMesa}
              value={mesa}
              maxLength={MAX_MESA_FUERA}
              onChange={(e) => setMesa(e.target.value)}
              placeholder="Mesa 4, junto a la puerta…"
              className="h-12 text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter" && lugar) void guardar();
              }}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            className={cn("h-14 w-full text-base font-bold", CLASE_AZUL_FUERA)}
            disabled={!lugar || guardando}
            onClick={() => void guardar()}
          >
            {guardando ? <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden /> : <Trees className="mr-2 h-5 w-5" aria-hidden />}
            {lugar ? `${yaFuera ? "Guardar" : "Sentar fuera"} · ${lugar}` : "Elige dónde"}
          </Button>
          {yaFuera && (
            <Button type="button" variant="outline" className="h-12 w-full" disabled={guardando} onClick={() => void volverDentro()}>
              <LogIn className="mr-2 h-5 w-5" aria-hidden /> Sentar dentro (vuelve a su sala, sin mesa)
            </Button>
          )}
          <Button type="button" variant="ghost" className="h-11 w-full" disabled={guardando} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpcionLugar({
  activa,
  onClick,
  className,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      onClick={onClick}
      className={cn(
        "flex h-14 touch-manipulation items-center justify-center rounded-lg border-2 px-3 text-base font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0050FF] focus-visible:ring-offset-2",
        activa
          ? "border-[#0050FF] bg-[#0050FF] text-white"
          : "border-[#0050FF]/40 bg-background text-[#0040D0] hover:bg-[#0050FF]/10 dark:text-[#8fb0ff]",
        className,
      )}
    >
      {children}
    </button>
  );
}
