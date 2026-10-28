// ---------------------------------------------------------------------------
// Buscador de platos de la carta (Popover + cmdk).
//
// Sacado tal cual de EditorSeccionesMenu (menú del día) para reutilizarlo en el
// bloque «Botones» de las novedades (enlazar el plato de «Échale un vistazo»).
// Sin props nuevas se comporta exactamente igual que antes.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Search, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { posicionImagen } from "./previewConstants";

export interface SelectorPlatoProps {
  platos: PlatoDeCarta[];
  cargando: boolean;
  onElegir: (plato: PlatoDeCarta) => void;
  /** Texto del botón. Por defecto «De la carta» (menú del día). */
  etiqueta?: string;
  /** Texto cuando la búsqueda no encuentra nada. */
  textoSinResultados?: string;
  disabled?: boolean;
}

export function SelectorPlato({
  platos,
  cargando,
  onElegir,
  etiqueta = "De la carta",
  textoSinResultados = "Ningún plato coincide. Puedes escribirlo a mano.",
  disabled = false,
}: SelectorPlatoProps) {
  const [abierto, setAbierto] = useState(false);

  // `cmdk` filtra por el `value` de cada item: se le da nombre + categoría para
  // poder buscar también por "postres" o "entrantes".
  const opciones = useMemo(
    () =>
      platos
        .filter((plato) => (plato.nombre ?? "").trim() !== "")
        .map((plato) => ({
          plato,
          busqueda: [plato.nombre, plato.categoria, plato.descripcion].filter(Boolean).join(" "),
        })),
    [platos],
  );

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-11 px-4" disabled={disabled}>
          <Search className="h-3.5 w-3.5 mr-1.5" />
          {etiqueta}
        </Button>
      </PopoverTrigger>
      {/* En un móvil de 375px los 22rem iban pegados al borde derecho. */}
      <PopoverContent align="start" collisionPadding={12} className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <Command>
          <CommandInput placeholder="Buscar en la carta..." />
          <CommandList>
            <CommandEmpty>{cargando ? "Cargando la carta..." : textoSinResultados}</CommandEmpty>
            <CommandGroup>
              {opciones.map(({ plato, busqueda }) => (
                <CommandItem
                  key={plato.id}
                  value={`${busqueda} ${plato.id}`}
                  onSelect={() => {
                    onElegir(plato);
                    setAbierto(false);
                  }}
                  className="min-h-11 gap-2.5 items-start"
                >
                  {plato.imagen_url ? (
                    <img
                      src={plato.imagen_url}
                      alt=""
                      loading="lazy"
                      className="h-9 w-9 shrink-0 rounded object-cover border mt-0.5"
                      style={{ objectPosition: posicionImagen(plato.imagen_posicion_y) }}
                    />
                  ) : (
                    <div className="h-9 w-9 shrink-0 rounded border border-dashed bg-muted/40 flex items-center justify-center mt-0.5">
                      <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
                    </div>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{plato.nombre}</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {[plato.categoria, plato.activado === false ? "desactivado en la carta" : null]
                        .filter(Boolean)
                        .join(" · ") || "Sin categoría"}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
