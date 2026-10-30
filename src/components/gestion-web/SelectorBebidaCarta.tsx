// ---------------------------------------------------------------------------
// Buscador de vinos y bebidas de la carta (Popover + cmdk), a imagen de
// SelectorPlato. Para el maridaje de un plato y la cata de las novedades
// (historia 4093221d). Al elegir, la línea se COPIA de la carta (E5):
// `lineaDesdeVino` (sulfitos de la carta, fijos) o `lineaDesdeBebida` (casilla
// desmarcada y editable).
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { GlassWater, Search, Wine } from "lucide-react";
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
import type { BebidaDeCarta, VinoDeCarta } from "@/hooks/useBebidasParaMenu";
import {
  bebidaElegibleParaMenu,
  lineaDesdeBebida,
  lineaDesdeVino,
  sulfitosDeVino,
  type LineaBebidaNovedad,
} from "@/lib/menu-novedad";

export interface SelectorBebidaCartaProps {
  vinos: VinoDeCarta[];
  bebidas: BebidaDeCarta[];
  cargando: boolean;
  /** La carta no se pudo leer: se dice y se ofrece escribirla a mano. */
  error?: boolean;
  onElegir: (linea: LineaBebidaNovedad) => void;
  /** Texto del botón. Por defecto «De la carta». */
  etiqueta?: string;
  disabled?: boolean;
}

const detalle = (categoria: string | null, extra: string | null) =>
  [categoria, extra].filter(Boolean).join(" · ") || "Sin categoría";

export function SelectorBebidaCarta({
  vinos,
  bebidas,
  cargando,
  error = false,
  onElegir,
  etiqueta = "De la carta",
  disabled = false,
}: SelectorBebidaCartaProps) {
  const [abierto, setAbierto] = useState(false);

  // `cmdk` filtra por el `value`: nombre + categoría, para poder buscar también
  // por «tintos» o «licores».
  const opcionesVinos = useMemo(
    () =>
      vinos.filter(bebidaElegibleParaMenu).map((vino) => ({
        vino,
        sulfitos: sulfitosDeVino(vino.alergenos_oficiales),
        busqueda: [vino.nombre, vino.categoria].filter(Boolean).join(" "),
      })),
    [vinos],
  );
  const opcionesBebidas = useMemo(
    () =>
      bebidas.filter(bebidaElegibleParaMenu).map((bebida) => ({
        bebida,
        busqueda: [bebida.nombre, bebida.categoria].filter(Boolean).join(" "),
      })),
    [bebidas],
  );

  const elegir = (linea: LineaBebidaNovedad) => {
    onElegir(linea);
    setAbierto(false);
  };

  const textoVacio = cargando
    ? "Cargando la carta..."
    : error
      ? "No se pudo cargar la carta. Puedes escribir la bebida a mano."
      : "Ninguna bebida coincide. Puedes escribirla a mano.";

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-11 px-4" disabled={disabled}>
          <Search className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          {etiqueta}
        </Button>
      </PopoverTrigger>
      {/* En un móvil de 375-390 px no puede pasar del ancho de la pantalla. */}
      <PopoverContent align="start" collisionPadding={12} className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        {/* `label` da nombre accesible al buscador (cmdk lo enlaza con aria-labelledby). */}
        <Command label="Buscar vino o bebida en la carta">
          <CommandInput placeholder="Buscar vino o bebida..." />
          <CommandList>
            <CommandEmpty>{textoVacio}</CommandEmpty>
            {opcionesVinos.length > 0 && (
              <CommandGroup heading="Vinos">
                {opcionesVinos.map(({ vino, sulfitos, busqueda }) => (
                  <CommandItem
                    key={`vino-${vino.id}`}
                    value={`${busqueda} vino-${vino.id}`}
                    onSelect={() => elegir(lineaDesdeVino(vino))}
                    className="min-h-11 gap-2.5 items-start"
                  >
                    <Wine className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm [overflow-wrap:anywhere]">{vino.nombre}</span>
                      <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {detalle(vino.categoria, sulfitos ? "contiene sulfitos" : null)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {opcionesBebidas.length > 0 && (
              <CommandGroup heading="Bebidas">
                {opcionesBebidas.map(({ bebida, busqueda }) => (
                  <CommandItem
                    key={`bebida-${bebida.id}`}
                    value={`${busqueda} bebida-${bebida.id}`}
                    onSelect={() => elegir(lineaDesdeBebida(bebida))}
                    className="min-h-11 gap-2.5 items-start"
                  >
                    <GlassWater className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm [overflow-wrap:anywhere]">{bebida.nombre}</span>
                      <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {detalle(bebida.categoria, null)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
