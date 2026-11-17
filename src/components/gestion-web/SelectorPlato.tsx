// ---------------------------------------------------------------------------
// Buscador de platos de la carta (Popover + cmdk).
//
// Sacado tal cual de EditorSeccionesMenu (menú del día) para reutilizarlo en el
// bloque «Botones» de las novedades (enlazar el plato de «Échale un vistazo»).
// Sin props nuevas se comporta exactamente igual que antes.
//
// El filtro y el orden son nuestros (`coincidenciaBusqueda`), como en
// SelectorBebidaCarta, no los de `cmdk`: su puntuación difusa daba 100 platos
// al escribir «tarta» (con «Calamares encebollados» el primero), distinguía
// «atun» de «atún» y dejaba la lista desplazada, con los mejores resultados
// escondidos arriba.
// ---------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { coincidenciaBusqueda } from "@/lib/menu-novedad";
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
  const [busqueda, setBusqueda] = useState("");
  const listaRef = useRef<HTMLDivElement>(null);

  // De la mejor coincidencia a la peor (nombre exacto, empieza por, palabra,
  // contiene y, por último, la categoría: «postres», «entrantes»); a igualdad,
  // en el orden de la carta. Sin tildes ni mayúsculas. Intro elige la primera.
  const opciones = useMemo(
    () =>
      platos
        .filter((plato) => (plato.nombre ?? "").trim() !== "")
        .map((plato, indice) => ({
          plato,
          indice,
          puntos: coincidenciaBusqueda(plato.nombre ?? "", plato.categoria, busqueda),
        }))
        .filter((x): x is { plato: PlatoDeCarta; indice: number; puntos: number } => x.puntos !== null)
        .sort((a, b) => a.puntos - b.puntos || a.indice - b.indice),
    [platos, busqueda],
  );

  // Cada búsqueda empieza arriba: si no, tras desplazar la lista los primeros
  // resultados quedaban fuera de la vista.
  useLayoutEffect(() => {
    if (listaRef.current) listaRef.current.scrollTop = 0;
  }, [busqueda]);

  const cambiarAbierto = (valor: boolean) => {
    setAbierto(valor);
    if (!valor) setBusqueda("");
  };

  return (
    <Popover open={abierto} onOpenChange={cambiarAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-11 px-4" disabled={disabled}>
          <Search className="h-3.5 w-3.5 mr-1.5" />
          {etiqueta}
        </Button>
      </PopoverTrigger>
      {/* En un móvil de 375px los 22rem iban pegados al borde derecho. */}
      <PopoverContent align="start" collisionPadding={12} className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <Command label="Buscar un plato de la carta" shouldFilter={false}>
          <CommandInput placeholder="Buscar en la carta..." value={busqueda} onValueChange={setBusqueda} />
          <CommandList ref={listaRef}>
            <CommandEmpty>{cargando ? "Cargando la carta..." : textoSinResultados}</CommandEmpty>
            <CommandGroup>
              {opciones.map(({ plato }) => (
                <CommandItem
                  key={plato.id}
                  value={plato.id}
                  onSelect={() => {
                    onElegir(plato);
                    cambiarAbierto(false);
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
