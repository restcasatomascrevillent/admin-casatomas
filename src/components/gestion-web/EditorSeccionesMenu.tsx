// ---------------------------------------------------------------------------
// Edición del menú del día por LÍNEAS, no por cajas de texto.
//
// Conviven dos formas de añadir un plato, a propósito:
//   - «De la carta»: se busca entre los 128 platos y al elegirlo se copian sus
//     alérgenos, su foto y sus traducciones. Cero tecleo.
//   - «A mano»: el menú del día lleva a menudo platos que no están en la carta.
//     Se escribe el nombre y SE LE PUEDEN PONER ALÉRGENOS IGUAL, que es lo que
//     pidió el dueño: "poner alérgenos como cualquier plato". Y FOTO: el hueco
//     de la miniatura de un plato «A mano» se pulsa para subir una (ver
//     `src/lib/foto-menu-dia.ts`). Los de la carta llevan la de la carta.
//
// Los alérgenos salen de `src/lib/alergenos.ts` (los 14 de la UE + los
// personalizados que ya usa la carta). No hay aquí un sistema paralelo.
// ---------------------------------------------------------------------------

import { type ReactNode, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronUp,
  ImageOff,
  ImagePlus,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
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
import { ACCEPT_FOTO_MENU, subirFotoMenu, validarFotoMenu } from "@/lib/foto-menu-dia";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { posicionImagen } from "./previewConstants";
import { SelectorPlato } from "./SelectorPlato";

type Secciones = Record<SeccionMenu, ItemMenu[]>;

/**
 * Reparto de las tres secciones según el ancho REAL del editor (ver el
 * comentario en `EditorSeccionesMenu`). Van como clases literales completas
 * para que Tailwind las genere.
 *
 * - `CONTENEDOR_SECCIONES`: el envoltorio es un *query container* de ancho.
 *   La contención de tamaño en línea hace además que su ancho NO dependa de lo
 *   que lleve dentro: nunca puede ensancharse con las secciones.
 * - `REJILLA_SECCIONES`: una columna; tres cuando el envoltorio mide ≥62rem.
 */
const CONTENEDOR_SECCIONES = "[container-type:inline-size]";
const REJILLA_SECCIONES = "grid grid-cols-1 gap-3 [@container(min-width:62rem)]:grid-cols-3";

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

/** Mismo tamaño que `Miniatura` (44px): la fila no se ensancha ni un píxel. */
const HUECO_FOTO =
  "relative h-11 w-11 shrink-0 overflow-hidden rounded-md border flex items-center justify-center transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 " +
  "disabled:cursor-wait";

interface FotoPlatoLibreProps {
  item: ItemMenu;
  /** URL pública de la foto nueva, o `null` para quitarla. */
  onFoto: (imagenUrl: string | null) => void;
}

/**
 * La miniatura de un plato «A mano», pulsable: sin foto, abre el selector de
 * archivos para subir una; con foto, un menú para cambiarla o quitarla.
 */
function FotoPlatoLibre({ item, onFoto }: FotoPlatoLibreProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  // Se recuerda QUÉ url falló, no un booleano: al subir otra se reintenta sola.
  const [urlRota, setUrlRota] = useState<string | null>(null);

  // La subida tarda: al terminar hay que aplicar la foto sobre la línea TAL Y
  // COMO ESTÉ ENTONCES (quizá ya se le cambió el nombre o se movió), no sobre la
  // de cuando se eligió el fichero. Por eso se llama a la última `onFoto`.
  const onFotoRef = useRef(onFoto);
  useEffect(() => {
    onFotoRef.current = onFoto;
  });

  // El hueco cambia de botón (subir ↔ menú) y se deshabilita mientras sube:
  // sin esto, quien va con teclado se queda con el foco en <body> tras subir
  // o quitar la foto. Solo se devuelve si nadie se lo llevó a otra parte (p. ej.
  // a escribir el nombre mientras subía).
  const botonRef = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);
  useEffect(() => {
    if (!devolverFoco.current || subiendo) return;
    devolverFoco.current = false;
    const activo = document.activeElement;
    if (!activo || activo === document.body) botonRef.current?.focus();
  }, [subiendo, item.imagenUrl]);

  const nombre = item.nombre.trim() || "este plato";
  const falló = item.imagenUrl !== null && urlRota === item.imagenUrl;

  const elegirArchivo = () => inputRef.current?.click();

  const quitarFoto = () => {
    devolverFoco.current = true;
    onFoto(null);
  };

  const alElegir = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Permite volver a elegir el mismo fichero (p. ej. tras un error).
    e.target.value = "";
    if (!file) return;

    const error = validarFotoMenu(file);
    if (error) {
      toast.error(error);
      return;
    }

    devolverFoco.current = document.activeElement === botonRef.current;
    setSubiendo(true);
    try {
      const url = await subirFotoMenu(file);
      onFotoRef.current(url);
    } catch (err) {
      console.error("Error subiendo la foto del plato del menú:", err);
      toast.error("No se pudo subir la foto. Inténtalo de nuevo.");
    } finally {
      setSubiendo(false);
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT_FOTO_MENU}
      className="hidden"
      tabIndex={-1}
      aria-hidden="true"
      data-testid="input-foto-plato"
      onChange={alElegir}
    />
  );

  const spinner = subiendo && (
    <span className="absolute inset-0 flex items-center justify-center bg-background/70">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
    </span>
  );

  if (!item.imagenUrl) {
    // Tiene que LEERSE como botón, no como el hueco gris de «sin foto» de los
    // platos de la carta: borde y color de acción, icono de cámara y la palabra
    // «Foto». Con el gris tenue de antes nadie adivinaba que se podía pulsar.
    return (
      <>
        <button
          ref={botonRef}
          type="button"
          onClick={elegirArchivo}
          disabled={subiendo}
          aria-label={subiendo ? `Subiendo foto de ${nombre}` : `Subir foto de ${nombre}`}
          aria-busy={subiendo}
          data-testid="boton-subir-foto"
          className={`${HUECO_FOTO} flex-col gap-0.5 border-dashed border-primary/50 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10`}
        >
          {subiendo ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <>
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span className="text-[10px] font-medium leading-none" aria-hidden="true">
                Foto
              </span>
            </>
          )}
        </button>
        {input}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={botonRef}
            type="button"
            disabled={subiendo}
            aria-label={subiendo ? `Subiendo foto de ${nombre}` : `Cambiar o quitar la foto de ${nombre}`}
            aria-busy={subiendo}
            title="Foto del plato"
            className={`${HUECO_FOTO} bg-muted hover:opacity-90`}
          >
            {falló ? (
              <ImageOff className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
            ) : (
              <img
                src={item.imagenUrl}
                alt=""
                loading="lazy"
                onError={() => setUrlRota(item.imagenUrl)}
                className="h-full w-full object-cover"
                style={{ objectPosition: posicionImagen(item.imagenPosicionY) }}
              />
            )}
            {spinner}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={elegirArchivo} className="min-h-11 text-base md:text-sm">
            <ImagePlus className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
            Cambiar foto
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={quitarFoto} className="min-h-11 text-base text-destructive focus:text-destructive md:text-sm">
            <Trash2 className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
            Quitar foto
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {input}
    </>
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
          className="h-11 gap-1.5 px-3 text-xs"
          aria-label={`Alérgenos de ${item.nombre || "este plato"}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Alérgenos
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto"
      >
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
                className={`flex min-h-11 items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border transition-colors text-left ${
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
              className="h-11 text-base md:text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  añadirPersonalizado();
                }
              }}
            />
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={añadirPersonalizado} disabled={!nuevo.trim()} aria-label="Añadir alérgeno">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {personalizados.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {personalizados.map((a) => (
                <span key={a} className="inline-flex items-center rounded-full bg-secondary pl-3 text-sm">
                  {a}
                  <button
                    type="button"
                    onClick={() => quitar(a)}
                    className="flex h-11 w-11 items-center justify-center rounded-full hover:text-destructive"
                    aria-label={`Quitar ${a}`}
                  >
                    <X className="h-4 w-4" />
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
  /** Lo que va debajo de la línea, a todo el ancho (la bebida del maridaje). */
  debajo?: ReactNode;
}

function LineaMenu({ item, indice, total, platoActual, onCambiar, onQuitar, onMover, debajo }: LineaMenuProps) {
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
    <li className="flex flex-wrap items-start gap-x-2.5 gap-y-1 rounded-lg border bg-card p-2">
      {/* La foto de un plato de la carta ES la de la carta: no se toca aquí. */}
      {item.origen === "libre" ? (
        <FotoPlatoLibre
          item={item}
          // Al subir otra foto el encuadre vuelve al centro: el de la anterior
          // no tiene por qué servir.
          onFoto={(imagenUrl) => onCambiar({ ...item, imagenUrl, imagenPosicionY: null })}
        />
      ) : (
        <Miniatura item={item} />
      )}

      <div className="min-w-[8rem] flex-1 space-y-1">
        {item.origen === "libre" ? (
          <Input
            value={item.nombre}
            onChange={(e) => onCambiar({ ...item, nombre: e.target.value })}
            placeholder="Nombre del plato"
            aria-label={`Nombre del plato ${indice + 1}`}
            className="h-11 text-base md:text-base"
          />
        ) : (
          <p className="min-h-11 py-2.5 text-sm font-medium leading-tight">
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
          <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            Ya no está en la carta. El menú conserva la copia.
          </p>
        )}
        {/* Se dispara tanto si cambió la carta como si se retocó aquí la copia.
            El texto no presume cuál de las dos: solo constata que difieren. */}
        {desactualizado && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
              No coincide con la carta.
            </p>
            <Button type="button" variant="link" size="sm" className="h-11 px-2 text-xs" onClick={actualizarDesdeLaCarta}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Traer de la carta
            </Button>
          </div>
        )}
      </div>

      {/* Si no cabe junto al nombre, los botones pasan a una segunda línea
          (en vez de aplastar el nombre). Cada uno mide 44x44, también en táctil. */}
      <div className="ml-auto flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          disabled={indice === 0}
          onClick={() => onMover(-1)}
          aria-label="Subir"
        >
          <ChevronUp className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          disabled={indice === total - 1}
          onClick={() => onMover(1)}
          aria-label="Bajar"
        >
          <ChevronDown className="h-5 w-5" />
        </Button>

        <EditorAlergenos item={item} onChange={(alergenos) => onCambiar({ ...item, alergenos })} />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 text-destructive hover:text-destructive"
          onClick={onQuitar}
          aria-label={`Quitar ${item.nombre || "plato"}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {debajo && <div className="basis-full min-w-0 border-t pt-2">{debajo}</div>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Una sección de platos (las tres fijas y las extra del menú de una novedad)
// ---------------------------------------------------------------------------

interface SeccionPlatosProps {
  testId: string;
  /** Rótulo. Las secciones extra ponen aquí su campo de nombre. */
  titulo: ReactNode;
  items: ItemMenu[];
  onChange: (items: ItemMenu[]) => void;
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
  debajoDePlato?: (item: ItemMenu) => ReactNode;
  /** Botones de la cabecera (p. ej. «Quitar sección»). */
  acciones?: ReactNode;
}

export function SeccionPlatos({
  testId,
  titulo,
  items,
  onChange,
  platos,
  platosPorId,
  cargandoPlatos,
  debajoDePlato,
  acciones,
}: SeccionPlatosProps) {
  const añadirDeCarta = (plato: PlatoDeCarta) => onChange([...items, itemDesdePlato(plato)]);
  const añadirAMano = () => onChange([...items, itemLibre("")]);

  return (
    <section data-testid={testId} className="rounded-lg border bg-muted/20 p-3 space-y-2.5 min-w-0">
      <header className="flex items-center justify-between gap-2">
        {typeof titulo === "string" ? <h4 className="text-sm font-semibold">{titulo}</h4> : titulo}
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {items.length === 1 ? "1 plato" : `${items.length} platos`}
          </span>
          {acciones}
        </span>
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
              debajo={debajoDePlato?.(item)}
              onCambiar={(nuevo) => onChange(items.map((x) => (x.id === item.id ? nuevo : x)))}
              onQuitar={() => onChange(items.filter((x) => x.id !== item.id))}
              onMover={(direccion) => {
                const destino = indice + direccion;
                if (destino < 0 || destino >= items.length) return;
                const copia = [...items];
                [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
                onChange(copia);
              }}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <SelectorPlato platos={platos} cargando={cargandoPlatos} onElegir={añadirDeCarta} />
        <Button type="button" variant="ghost" size="sm" className="h-11 px-4" onClick={añadirAMano}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          A mano
        </Button>
      </div>
    </section>
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
  /**
   * Opcional: algo debajo de cada plato, dentro de su tarjeta (el menú de una
   * novedad con Maridaje pone ahí la bebida de ese plato).
   */
  debajoDePlato?: (item: ItemMenu, seccion: SeccionMenu) => ReactNode;
}

export function EditorSeccionesMenu({
  secciones,
  onChange,
  platos,
  platosPorId,
  cargandoPlatos,
  debajoDePlato,
}: EditorSeccionesMenuProps) {
  const actualizarSeccion = (seccion: SeccionMenu, items: ItemMenu[]) =>
    onChange({ ...secciones, [seccion]: items });

  // Las tres secciones van EN FILA solo si el hueco REAL del editor da para
  // ello; si no, una debajo de otra. No vale un breakpoint de viewport
  // (`lg:grid-cols-3`): el editor vive en la columna izquierda de
  // EditorMenuTapasWeb y desde `xl` comparte fila con la vista previa (340px),
  // así que con el viewport MÁS ancho tenía MENOS sitio. A 1280px cada sección
  // se quedaba en ~190px, y una línea necesita 44px de foto + 92px de botones +
  // márgenes: el nombre (o el input de «A mano») se quedaba a 0px y los botones
  // se salían de la tarjeta, montándose sobre la sección de al lado.
  //
  // Se decide con una container query (`@container (min-width: 62rem)`), no
  // con media queries: mide el envoltorio, que siempre ocupa el ancho de la
  // tarjeta. Es una rejilla de 1 o 3 columnas, así que nunca hay un 2 + 1
  // descolgado. 62rem ≈ 3 columnas de 320px + 2 huecos de 12px: lo justo para
  // que el nombre de una línea tenga ~120px.
  //
  // Sustituye (2026-10-01) al truco de «flex-basis negativo»
  // (`flex-basis: calc((62rem - 100%) * 999)`): ese `100%` solo funciona si el
  // ancho del contenedor está resuelto de antemano; en cuanto algo lo mide por
  // contenido (min/max-content), la base se calcula sin él y las secciones
  // pueden acabar en fila, más anchas que la pantalla.
  return (
    <>
      <div className={CONTENEDOR_SECCIONES} data-testid="contenedor-secciones-menu">
        <div className={REJILLA_SECCIONES}>
          {SECCIONES_MENU.map((seccion) => {
            return (
              <SeccionPlatos
                key={seccion}
                testId={`seccion-menu-${seccion}`}
                titulo={ETIQUETA_SECCION[seccion]}
                items={secciones[seccion]}
                onChange={(items) => actualizarSeccion(seccion, items)}
                platos={platos}
                platosPorId={platosPorId}
                cargandoPlatos={cargandoPlatos}
                debajoDePlato={debajoDePlato ? (item) => debajoDePlato(item, seccion) : undefined}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
