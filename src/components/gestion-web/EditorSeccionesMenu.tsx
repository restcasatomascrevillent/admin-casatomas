// ---------------------------------------------------------------------------
// Edición del menú del día por LÍNEAS, no por cajas de texto.
//
// Conviven dos formas de añadir un plato, a propósito:
//   - «De la carta»: se busca entre los 128 platos y al elegirlo se copian sus
//     alérgenos, su foto y sus traducciones. Cero tecleo.
//   - «A mano»: el menú del día lleva a menudo platos que no están en la carta.
//     Se escribe el nombre y SE LE PUEDEN PONER ALÉRGENOS IGUAL, que es lo que
//     pidió el dueño: "poner alérgenos como cualquier plato".
//
// Los alérgenos salen de `src/lib/alergenos.ts` (los 14 de la UE + los
// personalizados que ya usa la carta). No hay aquí un sistema paralelo.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ImageOff,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ALERGENOS_OFICIALES, combinarAlergenos, etiquetaAlergeno, normalizarAlergeno } from "@/lib/alergenos";
import {
  ETIQUETA_SECCION,
  SECCIONES_MENU,
  difiereDeLaCarta,
  itemDesdePlato,
  itemLibre,
  type ItemMenu,
  type SeccionMenu,
} from "@/lib/menu-dia";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";

type Secciones = Record<SeccionMenu, ItemMenu[]>;

/** `object-position` a partir de `imagen_posicion_y` (0..100, 50 por defecto). */
const posicionImagen = (y: number | null) => `50% ${typeof y === "number" ? y : 50}%`;

// ---------------------------------------------------------------------------
// Miniatura
// ---------------------------------------------------------------------------

/**
 * La foto del plato, o un hueco con carácter. Que un plato no tenga foto es lo
 * normal (57 de 128 la tienen): no debe parecer un error.
 */
function Miniatura({ item }: { item: ItemMenu }) {
  const [falló, setFalló] = useState(false);

  if (!item.imagenUrl || falló) {
    return (
      <div className="h-11 w-11 shrink-0 rounded-md border border-dashed bg-muted/40 flex items-center justify-center">
        {falló ? (
          <ImageOff className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
        ) : (
          <UtensilsCrossed className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <img
      src={item.imagenUrl}
      alt=""
      loading="lazy"
      onError={() => setFalló(true)}
      className="h-11 w-11 shrink-0 rounded-md border object-cover bg-muted"
      style={{ objectPosition: posicionImagen(item.imagenPosicionY) }}
    />
  );
}

// ---------------------------------------------------------------------------
// Alérgenos de una línea
// ---------------------------------------------------------------------------

interface EditorAlergenosProps {
  item: ItemMenu;
  onChange: (alergenos: string[]) => void;
}

/**
 * Los 14 oficiales como interruptores + los personalizados como texto. Es la
 * misma gramática que `PlatoForm`, para que quien edita la carta no tenga que
 * aprender dos interfaces.
 */
function EditorAlergenos({ item, onChange }: EditorAlergenosProps) {
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState("");

  const seleccionados = item.alergenos;
  const oficialesMarcados = new Set(seleccionados.map((a) => normalizarAlergeno(a) ?? a));
  const personalizados = seleccionados.filter((a) => normalizarAlergeno(a) === null);

  const alternar = (id: string) => {
    const yaEsta = oficialesMarcados.has(id);
    const siguientes = yaEsta
      ? seleccionados.filter((a) => (normalizarAlergeno(a) ?? a) !== id)
      : [...seleccionados, id];
    onChange(combinarAlergenos(siguientes));
  };

  const añadirPersonalizado = () => {
    const limpio = nuevo.trim();
    if (!limpio) return;
    onChange(combinarAlergenos([...seleccionados, limpio]));
    setNuevo("");
  };

  const quitar = (valor: string) => onChange(seleccionados.filter((a) => a !== valor));

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Alérgenos de ${item.nombre || "este plato"}`}
          title="Alérgenos"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium leading-none">Alérgenos</p>
          <p className="text-xs text-muted-foreground mt-1 truncate">{item.nombre || "Sin nombre"}</p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {ALERGENOS_OFICIALES.map((alergeno) => {
            const marcado = oficialesMarcados.has(alergeno.id);
            return (
              <button
                key={alergeno.id}
                type="button"
                aria-pressed={marcado}
                onClick={() => alternar(alergeno.id)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors text-left ${
                  marcado
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                }`}
              >
                <span className="truncate">{alergeno.label}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`alergeno-libre-${item.id}`} className="text-xs text-muted-foreground">
            Otro alérgeno
          </Label>
          <div className="flex gap-2">
            <Input
              id={`alergeno-libre-${item.id}`}
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              placeholder="Ej: marisco"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  añadirPersonalizado();
                }
              }}
            />
            <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={añadirPersonalizado} disabled={!nuevo.trim()} aria-label="Añadir alérgeno">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {personalizados.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {personalizados.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {a}
                  <button type="button" onClick={() => quitar(a)} className="hover:text-destructive" aria-label={`Quitar ${a}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Los inferidos se enseñan pero NO se editan aquí: son deducciones de
            los ingredientes que pertenecen a la carta, no al menú del día. */}
        {item.alergenosInferidos.length > 0 && (
          <div className="rounded-md bg-muted/50 p-2 space-y-1">
            <p className="text-[11px] font-medium flex items-center gap-1 text-muted-foreground">
              <Info className="h-3 w-3" aria-hidden="true" />
              Deducidos de los ingredientes
            </p>
            <p className="text-xs">{item.alergenosInferidos.map((a) => etiquetaAlergeno(a)).join(" · ")}</p>
            <p className="text-[11px] text-muted-foreground">Se arrastran de la carta. Para cambiarlos, edita el plato.</p>
          </div>
        )}

        {item.alergenosNotas && (
          <p className="text-xs text-muted-foreground border-t pt-2">{item.alergenosNotas}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Selector de plato de la carta
// ---------------------------------------------------------------------------

interface SelectorPlatoProps {
  platos: PlatoDeCarta[];
  cargando: boolean;
  onElegir: (plato: PlatoDeCarta) => void;
}

function SelectorPlato({ platos, cargando, onElegir }: SelectorPlatoProps) {
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
        <Button type="button" variant="outline" size="sm" className="h-8">
          <Search className="h-3.5 w-3.5 mr-1.5" />
          De la carta
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <Command>
          <CommandInput placeholder="Buscar en la carta..." />
          <CommandList>
            <CommandEmpty>
              {cargando ? "Cargando la carta..." : "Ningún plato coincide. Puedes escribirlo a mano."}
            </CommandEmpty>
            <CommandGroup>
              {opciones.map(({ plato, busqueda }) => (
                <CommandItem
                  key={plato.id}
                  value={`${busqueda} ${plato.id}`}
                  onSelect={() => {
                    onElegir(plato);
                    setAbierto(false);
                  }}
                  className="gap-2.5 items-start"
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

// ---------------------------------------------------------------------------
// Una línea del menú
// ---------------------------------------------------------------------------

interface LineaMenuProps {
  item: ItemMenu;
  indice: number;
  total: number;
  platoActual: PlatoDeCarta | undefined;
  onCambiar: (item: ItemMenu) => void;
  onQuitar: () => void;
  onMover: (direccion: -1 | 1) => void;
}

function LineaMenu({ item, indice, total, platoActual, onCambiar, onQuitar, onMover }: LineaMenuProps) {
  const enlazado = item.origen === "carta" && item.platoId !== null;
  const desaparecido = enlazado && !platoActual;
  const desactualizado = difiereDeLaCarta(item, platoActual);

  const actualizarDesdeLaCarta = () => {
    if (!platoActual) return;
    // Se conserva el id de la línea para no romper el emparejado con las filas
    // en/fr de un menú que ya estuviera guardado.
    onCambiar({ ...itemDesdePlato(platoActual), id: item.id });
  };

  return (
    <li className="flex items-start gap-2.5 rounded-lg border bg-card p-2">
      <Miniatura item={item} />

      <div className="min-w-0 flex-1 space-y-1">
        {item.origen === "libre" ? (
          <Input
            value={item.nombre}
            onChange={(e) => onCambiar({ ...item, nombre: e.target.value })}
            placeholder="Nombre del plato"
            aria-label={`Nombre del plato ${indice + 1}`}
            className="h-8 text-sm"
          />
        ) : (
          <p className="text-sm font-medium leading-tight truncate" title={item.nombre}>
            {item.nombre}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] text-muted-foreground">
            {item.origen === "carta" ? "De la carta" : "A mano"}
          </span>

          {item.alergenos.length > 0 ? (
            <span className="text-[11px] text-muted-foreground truncate">
              · {item.alergenos.map((a) => etiquetaAlergeno(a)).join(", ")}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">· sin alérgenos</span>
          )}

          {item.alergenosInferidos.length > 0 && (
            <span className="text-[11px] text-muted-foreground/70">(+{item.alergenosInferidos.length} deducidos)</span>
          )}
        </div>

        {/* Un plato copiado no cambia solo: el aviso deja la decisión en manos
            de quien edita, que es justo lo que se quiere de un menú publicado. */}
        {desaparecido && (
          <p className="text-[11px] text-amber-600 dark:text-amber-500 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            Ya no está en la carta. El menú conserva la copia.
          </p>
        )}
        {/* Se dispara tanto si cambió la carta como si se retocó aquí la copia.
            El texto no presume cuál de las dos: solo constata que difieren. */}
        {desactualizado && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
              No coincide con la carta.
            </p>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={actualizarDesdeLaCarta}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Traer de la carta
            </Button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-4 w-7"
            disabled={indice === 0}
            onClick={() => onMover(-1)}
            aria-label="Subir"
            title="Subir"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-4 w-7"
            disabled={indice === total - 1}
            onClick={() => onMover(1)}
            aria-label="Bajar"
            title="Bajar"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>

        <EditorAlergenos item={item} onChange={(alergenos) => onCambiar({ ...item, alergenos })} />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onQuitar}
          aria-label={`Quitar ${item.nombre || "plato"}`}
          title="Quitar"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Las tres secciones
// ---------------------------------------------------------------------------

interface EditorSeccionesMenuProps {
  secciones: Secciones;
  onChange: (secciones: Secciones) => void;
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
}

export function EditorSeccionesMenu({
  secciones,
  onChange,
  platos,
  platosPorId,
  cargandoPlatos,
}: EditorSeccionesMenuProps) {
  const actualizarSeccion = (seccion: SeccionMenu, items: ItemMenu[]) =>
    onChange({ ...secciones, [seccion]: items });

  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {SECCIONES_MENU.map((seccion) => {
          const items = secciones[seccion];

          const añadirDeCarta = (plato: PlatoDeCarta) =>
            actualizarSeccion(seccion, [...items, itemDesdePlato(plato)]);

          const añadirAMano = () => actualizarSeccion(seccion, [...items, itemLibre("")]);

          return (
            <section key={seccion} className="rounded-lg border bg-muted/20 p-3 space-y-2.5 min-w-0">
              <header className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{ETIQUETA_SECCION[seccion]}</h4>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground tabular-nums cursor-default">
                      {items.length}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {items.length === 1 ? "1 plato" : `${items.length} platos`}
                  </TooltipContent>
                </Tooltip>
              </header>

              {items.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
                  Sin platos todavía
                </p>
              ) : (
                <ul className="space-y-2">
                  {items.map((item, indice) => (
                    <LineaMenu
                      key={item.id}
                      item={item}
                      indice={indice}
                      total={items.length}
                      platoActual={item.platoId ? platosPorId.get(item.platoId) : undefined}
                      onCambiar={(nuevo) =>
                        actualizarSeccion(
                          seccion,
                          items.map((x) => (x.id === item.id ? nuevo : x)),
                        )
                      }
                      onQuitar={() => actualizarSeccion(seccion, items.filter((x) => x.id !== item.id))}
                      onMover={(direccion) => {
                        const destino = indice + direccion;
                        if (destino < 0 || destino >= items.length) return;
                        const copia = [...items];
                        [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
                        actualizarSeccion(seccion, copia);
                      }}
                    />
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2">
                <SelectorPlato platos={platos} cargando={cargandoPlatos} onElegir={añadirDeCarta} />
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={añadirAMano}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  A mano
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
