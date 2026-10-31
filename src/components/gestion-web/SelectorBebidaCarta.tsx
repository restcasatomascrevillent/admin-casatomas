// ---------------------------------------------------------------------------
// Buscador de vinos y bebidas de la carta (Popover + cmdk), a imagen de
// SelectorPlato. Para el maridaje de un plato y la cata de las novedades
// (historia 4093221d). Al elegir, la línea se COPIA de la carta (E5):
// `lineaDesdeVino` (sulfitos de la carta, fijos) o `lineaDesdeBebida` (casilla
// editable, marcada si la bebida es vino: Copas, Tintos de verano, cava…).
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
  coincidenciaBusqueda,
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

/**
 * Las opciones que coinciden con la búsqueda, de la mejor a la peor
 * (`coincidenciaBusqueda`); a igualdad, en el orden de la carta.
 */
function filtrarYOrdenar<T>(
  opciones: T[],
  datos: (opcion: T) => { nombre: string | null; categoria: string | null },
  busqueda: string,
): { opcion: T; puntos: number }[] {
  return opciones
    .map((opcion, indice) => {
      const { nombre, categoria } = datos(opcion);
      return { opcion, indice, puntos: coincidenciaBusqueda(nombre ?? "", categoria, busqueda) };
    })
    .filter((x): x is { opcion: T; indice: number; puntos: number } => x.puntos !== null)
    .sort((a, b) => a.puntos - b.puntos || a.indice - b.indice)
    .map(({ opcion, puntos }) => ({ opcion, puntos }));
}

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
  const [busqueda, setBusqueda] = useState("");

  // El filtro y el orden son nuestros, no los de `cmdk` (su puntuación difusa
  // ponía vinos sin relación delante de «Lagavulin 8» y la cerveza «Sol» en el
  // puesto 130): exacta, empieza por, palabra, contiene y, por último, la
  // categoría («tintos», «licores»). Intro elige la primera, que es la mejor.
  const vinosVisibles = useMemo(
    () =>
      filtrarYOrdenar(vinos.filter(bebidaElegibleParaMenu), (vino) => vino, busqueda).map(({ opcion, puntos }) => ({
        vino: opcion,
        sulfitos: sulfitosDeVino(opcion.alergenos_oficiales),
        puntos,
      })),
    [vinos, busqueda],
  );
  const bebidasVisibles = useMemo(
    () =>
      filtrarYOrdenar(bebidas.filter(bebidaElegibleParaMenu), (bebida) => bebida, busqueda).map(
        ({ opcion, puntos }) => ({ bebida: opcion, puntos }),
      ),
    [bebidas, busqueda],
  );
  // El grupo con la mejor coincidencia va primero (a igualdad, los vinos).
  const bebidasPrimero =
    bebidasVisibles.length > 0 && (vinosVisibles.length === 0 || bebidasVisibles[0].puntos < vinosVisibles[0].puntos);

  const cambiarAbierto = (valor: boolean) => {
    setAbierto(valor);
    if (!valor) setBusqueda("");
  };

  const elegir = (linea: LineaBebidaNovedad) => {
    onElegir(linea);
    cambiarAbierto(false);
  };

  const grupoBebidas = bebidasVisibles.length > 0 && (
  <CommandGroup heading="Bebidas">
    {bebidasVisibles.map(({ bebida }) => (
      <CommandItem
        key={`bebida-${bebida.id}`}
        value={`bebida-${bebida.id}`}
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
  );

  const textoVacio = cargando
    ? "Cargando la carta..."
    : error
      ? "No se pudo cargar la carta. Puedes escribir la bebida a mano."
      : "Ninguna bebida coincide. Puedes escribirla a mano.";

  return (
    <Popover open={abierto} onOpenChange={cambiarAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-11 px-4" disabled={disabled}>
          <Search className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          {etiqueta}
        </Button>
      </PopoverTrigger>
      {/* En un móvil de 375-390 px no puede pasar del ancho de la pantalla. */}
      <PopoverContent align="start" collisionPadding={12} className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        {/* `label` da nombre accesible al buscador (cmdk lo enlaza con aria-labelledby). */}
        <Command label="Buscar vino o bebida en la carta" shouldFilter={false}>
          <CommandInput placeholder="Buscar vino o bebida..." value={busqueda} onValueChange={setBusqueda} />
          <CommandList>
            <CommandEmpty>{textoVacio}</CommandEmpty>
            {bebidasPrimero && grupoBebidas}
            {vinosVisibles.length > 0 && (
              <CommandGroup heading="Vinos">
                {vinosVisibles.map(({ vino, sulfitos }) => (
                  <CommandItem
                    key={`vino-${vino.id}`}
                    value={`vino-${vino.id}`}
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
            {!bebidasPrimero && grupoBebidas}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
