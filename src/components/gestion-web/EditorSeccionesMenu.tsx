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
//
// Menos scroll (petición del dueño, 01/11/2026: «hay que hacer mucho scroll»):
//   - Cada plato ocupa UNA fila: foto, nombre y un botón «⋮» con Alérgenos,
//     Subir, Bajar y Quitar. Antes los cuatro botones no cabían junto al nombre
//     en el móvil y bajaban a una segunda fila en cada plato.
//   - Con `plegable`, cada sección se pliega a una cabecera con su resumen
//     («Segundo · 3 platos» y sus nombres). El menú del día la usa.
// ---------------------------------------------------------------------------

import { type ReactNode, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { PopoverAnchor } from "@radix-ui/react-popover";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronUp,
  ImageOff,
  ImagePlus,
  Info,
  Loader2,
  MoreVertical,
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
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  type SeccionMenuDia,
} from "@/lib/menu-dia";
import { ACCEPT_FOTO_MENU, subirFotoMenu, validarFotoMenu } from "@/lib/foto-menu-dia";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { ListaOrdenable } from "@/components/ui/lista-ordenable";
import { moverEnLista } from "@/lib/mover-en-lista";
import { posicionImagen } from "./previewConstants";
import { SelectorPlato } from "./SelectorPlato";

/**
 * Reparto de las secciones según el ancho REAL del editor (ver el comentario
 * en `EditorSeccionesMenu`). Van como clases literales completas para que
 * Tailwind las genere.
 *
 * - `CONTENEDOR_SECCIONES`: el envoltorio es un *query container* de ancho.
 *   La contención de tamaño en línea hace además que su ancho NO dependa de lo
 *   que lleve dentro: nunca puede ensancharse con las secciones.
 * - `REJILLA_SECCIONES`: una columna; tres cuando el envoltorio mide ≥62rem.
 * - `REJILLA_CUATRO_SECCIONES` (menú del día con entrante): una columna;
 *   cuatro a partir de ≥82rem (4 × 320px + 3 huecos). Nunca 3 + 1.
 */
const CONTENEDOR_SECCIONES = "[container-type:inline-size]";
const REJILLA_SECCIONES = "grid grid-cols-1 gap-3 [@container(min-width:62rem)]:grid-cols-3";
const REJILLA_CUATRO_SECCIONES = "grid grid-cols-1 items-start gap-3 [@container(min-width:82rem)]:grid-cols-4";

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
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Dónde se ancla el desplegable (el botón «⋮» de la línea). */
  ancla: ReactNode;
  /** Al cerrarse, el foco vuelve aquí (no hay disparador propio al que volver). */
  alCerrar: () => void;
}

/**
 * Los 14 oficiales como interruptores + los personalizados como texto. Es la
 * misma gramática que `PlatoForm`, para que quien edita la carta no tenga que
 * aprender dos interfaces. Se abre desde «Alérgenos…» del menú «⋮» del plato.
 */
function EditorAlergenos({ item, onChange, abierto, onAbiertoChange, ancla, alCerrar }: EditorAlergenosProps) {
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
    <Popover open={abierto} onOpenChange={onAbiertoChange}>
      <PopoverAnchor asChild>{ancla}</PopoverAnchor>
      <PopoverContent
        align="end"
        collisionPadding={12}
        aria-label={`Alérgenos de ${item.nombre || "este plato"}`}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          alCerrar();
        }}
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
  /**
   * Dentro de una lista ordenable la línea es un `div`: el `li`, el asa y los
   * botones subir y bajar los pone la lista, así que «Subir» y «Bajar» salen
   * del menú «⋮».
   */
  enListaOrdenable?: boolean;
}

const CLASE_LINEA = "flex flex-wrap items-start gap-x-2.5 gap-y-1 rounded-lg border bg-card p-2";

function LineaMenu({
  item,
  indice,
  total,
  platoActual,
  onCambiar,
  onQuitar,
  onMover,
  debajo,
  enListaOrdenable = false,
}: LineaMenuProps) {
  const Raiz = enListaOrdenable ? "div" : "li";
  const enlazado = item.origen === "carta" && item.platoId !== null;
  const desaparecido = enlazado && !platoActual;
  const desactualizado = difiereDeLaCarta(item, platoActual);
  const nombre = item.nombre.trim() || "este plato";

  // «Alérgenos…» se elige en el menú «⋮», pero el desplegable de alérgenos no
  // puede abrirse mientras ese menú se cierra: el menú devuelve el foco a su
  // botón y el desplegable, al perderlo, se cerraría solo. Se abre cuando el
  // menú ya ha terminado de cerrarse (`onCloseAutoFocus`).
  const [alergenosAbiertos, setAlergenosAbiertos] = useState(false);
  const abrirAlergenosAlCerrar = useRef(false);
  const opcionesRef = useRef<HTMLButtonElement>(null);

  const actualizarDesdeLaCarta = () => {
    if (!platoActual) return;
    // Se conserva el id de la línea para no romper el emparejado con las filas
    // en/fr de un menú que ya estuviera guardado.
    onCambiar({ ...itemDesdePlato(platoActual), id: item.id });
  };

  return (
    <Raiz className={enListaOrdenable ? `min-w-0 flex-1 ${CLASE_LINEA}` : CLASE_LINEA}>
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

      <div className="min-w-[6rem] flex-1 space-y-1">
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

      {/* Un solo botón de 44x44 con todo lo demás: así cabe junto al nombre
          también en un móvil de 375px y cada plato ocupa una sola fila. */}
      <EditorAlergenos
        item={item}
        onChange={(alergenos) => onCambiar({ ...item, alergenos })}
        abierto={alergenosAbiertos}
        onAbiertoChange={setAlergenosAbiertos}
        alCerrar={() => opcionesRef.current?.focus()}
        ancla={
          <div className="ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={opcionesRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  aria-label={`Opciones de ${nombre}`}
                >
                  <MoreVertical className="h-5 w-5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(e) => {
                  if (!abrirAlergenosAlCerrar.current) return;
                  abrirAlergenosAlCerrar.current = false;
                  e.preventDefault();
                  setAlergenosAbiertos(true);
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    abrirAlergenosAlCerrar.current = true;
                  }}
                  className="min-h-11 text-base md:text-sm"
                >
                  <Pencil className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
                  Alérgenos…
                </DropdownMenuItem>
                {!enListaOrdenable && (
                  <>
                    <DropdownMenuItem
                      disabled={indice === 0}
                      onSelect={() => onMover(-1)}
                      className="min-h-11 text-base md:text-sm"
                    >
                      <ArrowUp className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
                      Subir
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={indice === total - 1}
                      onSelect={() => onMover(1)}
                      className="min-h-11 text-base md:text-sm"
                    >
                      <ArrowDown className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
                      Bajar
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onQuitar}
                  className="min-h-11 text-base text-destructive focus:text-destructive md:text-sm"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
                  Quitar del menú
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {debajo && <div className="basis-full min-w-0 border-t pt-2">{debajo}</div>}
    </Raiz>
  );
}

// ---------------------------------------------------------------------------
// Una sección de platos (las fijas y las extra del menú de una novedad)
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
  /**
   * La cabecera pliega y despliega la sección. Plegada enseña solo el rótulo,
   * cuántos platos lleva y sus nombres en una línea. Solo con `titulo` de texto.
   */
  plegable?: boolean;
  /** Con `plegable`: si empieza desplegada. */
  abiertaAlInicio?: boolean;
  /** Con `plegable`: lo que pone la cabecera sin platos (por defecto «Sin platos»). */
  detalleVacia?: string;
  /** Lo primero de la sección desplegada (p. ej. «¿Qué entra?» del postre). */
  cabecera?: ReactNode;
  /**
   * Cada plato se arrastra desde un asa y tiene subir y bajar a la vista
   * (menú de una novedad). Sin esto, subir y bajar van en el menú «⋮».
   */
  ordenable?: boolean;
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
  plegable = false,
  abiertaAlInicio = true,
  detalleVacia = "Sin platos",
  cabecera,
  ordenable = false,
}: SeccionPlatosProps) {
  const [abierta, setAbierta] = useState(!plegable || abiertaAlInicio);
  const idCuerpo = useId();
  const listaRef = useRef<HTMLDivElement>(null);
  // Tras subir o bajar, el foco sigue al plato; si ya no puede ir más allá, a la otra flecha.
  const [enfoque, setEnfoque] = useState<{ id: string; direccion: "arriba" | "abajo" } | null>(null);
  useEffect(() => {
    if (!enfoque) return;
    const fila = listaRef.current?.querySelector(`[data-clave="${enfoque.id}"]`);
    const destino =
      fila?.querySelector<HTMLElement>(`[data-mover="${enfoque.direccion}"]:not([disabled])`) ??
      fila?.querySelector<HTMLElement>("[data-mover]:not([disabled])");
    destino?.focus();
    setEnfoque(null);
  }, [enfoque]);
  const mover = (desde: number, hasta: number) => {
    const siguientes = moverEnLista(items, desde, hasta);
    if (siguientes !== items) onChange([...siguientes]);
  };
  const subirOBajar = (indice: number, direccion: "arriba" | "abajo") => {
    mover(indice, direccion === "arriba" ? indice - 1 : indice + 1);
    setEnfoque({ id: items[indice].id, direccion });
  };
  const añadirDeCarta = (plato: PlatoDeCarta) => onChange([...items, itemDesdePlato(plato)]);
  const añadirAMano = () => onChange([...items, itemLibre("")]);

  const recuento = items.length === 1 ? "1 plato" : `${items.length} platos`;
  const resumen = items
    .map((item) => item.nombre.trim())
    .filter(Boolean)
    .join(" · ");

  const cuerpo = (
    <>
      {cabecera}
      {items.length === 0 ? (
        // Plegable y vacía ya lo dice la cabecera: el hueco de «Sin platos
        // todavía» solo añadía alto.
        plegable ? null : (
          <p className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
            Sin platos todavía
          </p>
        )
      ) : (
        ordenable ? (
          <div ref={listaRef}>
            <ListaOrdenable
              ids={items.map((item) => item.id)}
              nombre={(id) => items.find((item) => item.id === id)?.nombre.trim() || "plato sin nombre"}
              onMover={mover}
              className="space-y-2"
              claseElemento="flex min-w-0 items-start gap-1"
              aria-label={typeof titulo === "string" ? `Platos de ${titulo}, en orden` : "Platos, en orden"}
            >
              {(_id, indice, { asa }) => {
                const item = items[indice];
                const nombre = item.nombre.trim() || "plato sin nombre";
                return (
                  <>
                    <div className="flex shrink-0 flex-col" role="group" aria-label={`Orden de «${nombre}»`}>
                      {asa}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        data-mover="arriba"
                        disabled={indice === 0}
                        onClick={() => subirOBajar(indice, "arriba")}
                        aria-label={`Subir «${nombre}»`}
                      >
                        <ChevronUp className="h-5 w-5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        data-mover="abajo"
                        disabled={indice === items.length - 1}
                        onClick={() => subirOBajar(indice, "abajo")}
                        aria-label={`Bajar «${nombre}»`}
                      >
                        <ChevronDown className="h-5 w-5" aria-hidden="true" />
                      </Button>
                    </div>
                    <LineaMenu
                      enListaOrdenable
                      item={item}
                      indice={indice}
                      total={items.length}
                      platoActual={item.platoId ? platosPorId.get(item.platoId) : undefined}
                      debajo={debajoDePlato?.(item)}
                      onCambiar={(nuevo) => onChange(items.map((x) => (x.id === item.id ? nuevo : x)))}
                      onQuitar={() => onChange(items.filter((x) => x.id !== item.id))}
                      onMover={(direccion) => mover(indice, indice + direccion)}
                    />
                  </>
                );
              }}
            </ListaOrdenable>
          </div>
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
              onMover={(direccion) => mover(indice, indice + direccion)}
            />
          ))}
        </ul>
        )
      )}

      <div className="flex flex-wrap gap-2">
        <SelectorPlato platos={platos} cargando={cargandoPlatos} onElegir={añadirDeCarta} />
        <Button type="button" variant="ghost" size="sm" className="h-11 px-4" onClick={añadirAMano}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          A mano
        </Button>
      </div>
    </>
  );

  if (plegable) {
    return (
      <section data-testid={testId} className="rounded-lg border bg-muted/20 px-3 py-1 min-w-0">
        <header className="flex items-center gap-1">
          <button
            type="button"
            aria-expanded={abierta}
            aria-controls={abierta ? idCuerpo : undefined}
            onClick={() => setAbierta((valor) => !valor)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${abierta ? "" : "-rotate-90"}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold">{titulo}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {items.length === 0 ? detalleVacia : recuento}
                </span>
              </span>
              {!abierta && resumen && (
                <span className="block truncate text-xs text-muted-foreground">{resumen}</span>
              )}
            </span>
          </button>
          {acciones}
        </header>
        {abierta && (
          <div id={idCuerpo} className="space-y-2.5 pb-2 pt-1">
            {cuerpo}
          </div>
        )}
      </section>
    );
  }

  return (
    <section data-testid={testId} className="rounded-lg border bg-muted/20 p-3 space-y-2.5 min-w-0">
      <header className="flex items-center justify-between gap-2">
        {typeof titulo === "string" ? <h4 className="text-sm font-semibold">{titulo}</h4> : titulo}
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground tabular-nums">{recuento}</span>
          {acciones}
        </span>
      </header>
      {cuerpo}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Las secciones
// ---------------------------------------------------------------------------

interface EditorSeccionesMenuProps<S extends SeccionMenuDia> {
  secciones: Record<S, ItemMenu[]>;
  onChange: (secciones: Record<S, ItemMenu[]>) => void;
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
  /**
   * Opcional: algo debajo de cada plato, dentro de su tarjeta (el menú de una
   * novedad con Maridaje pone ahí la bebida de ese plato).
   */
  debajoDePlato?: (item: ItemMenu, seccion: S) => ReactNode;
  /**
   * Qué secciones y en qué orden. Por defecto primero, segundo y postre (el
   * menú de una novedad); el menú del día pasa también el entrante.
   */
  orden?: readonly S[];
  /** Rótulos que cambian los de `ETIQUETA_SECCION` (p. ej. «Postre y café»). */
  titulos?: Partial<Record<S, string>>;
  /** Secciones plegables con resumen (ver `SeccionPlatos`). */
  plegable?: boolean;
  /** Con `plegable`: qué secciones empiezan desplegadas. Por defecto, todas. */
  abiertaAlInicio?: (seccion: S, items: ItemMenu[]) => boolean;
  /** Con `plegable`: lo que pone la cabecera de cada sección sin platos. */
  detalleVacia?: Partial<Record<S, string>>;
  /** Lo primero de cada sección desplegada. */
  cabeceraDe?: (seccion: S) => ReactNode;
  /** Platos que se arrastran y con subir y bajar a la vista (ver `SeccionPlatos`). */
  ordenable?: boolean;
}

export function EditorSeccionesMenu<S extends SeccionMenuDia = SeccionMenu>({
  secciones,
  onChange,
  platos,
  platosPorId,
  cargandoPlatos,
  debajoDePlato,
  orden = SECCIONES_MENU as unknown as readonly S[],
  titulos,
  plegable = false,
  abiertaAlInicio,
  detalleVacia,
  cabeceraDe,
  ordenable = false,
}: EditorSeccionesMenuProps<S>) {
  const actualizarSeccion = (seccion: S, items: ItemMenu[]) =>
    onChange({ ...secciones, [seccion]: items } as Record<S, ItemMenu[]>);

  // Las secciones van EN FILA solo si el hueco REAL del editor da para ello;
  // si no, una debajo de otra. No vale un breakpoint de viewport
  // (`lg:grid-cols-3`): el editor vive en la columna izquierda de
  // EditorMenuTapasWeb y desde `xl` comparte fila con la vista previa (340px),
  // así que con el viewport MÁS ancho tenía MENOS sitio. A 1280px cada sección
  // se quedaba en ~190px, y una línea necesita 44px de foto + botones +
  // márgenes: el nombre (o el input de «A mano») se quedaba a 0px y los botones
  // se salían de la tarjeta, montándose sobre la sección de al lado.
  //
  // Se decide con una container query (`@container (min-width: 62rem)`), no
  // con media queries: mide el envoltorio, que siempre ocupa el ancho de la
  // tarjeta. Es una rejilla de 1 o 3 columnas (1 o 4 con el entrante), así que
  // nunca hay una sección descolgada. 62rem ≈ 3 columnas de 320px + 2 huecos de
  // 12px: lo justo para que el nombre de una línea tenga ~120px.
  //
  // Sustituye (2026-10-01) al truco de «flex-basis negativo»
  // (`flex-basis: calc((62rem - 100%) * 999)`): ese `100%` solo funciona si el
  // ancho del contenedor está resuelto de antemano; en cuanto algo lo mide por
  // contenido (min/max-content), la base se calcula sin él y las secciones
  // pueden acabar en fila, más anchas que la pantalla.
  return (
    <>
      <div className={CONTENEDOR_SECCIONES} data-testid="contenedor-secciones-menu">
        <div className={orden.length === 4 ? REJILLA_CUATRO_SECCIONES : REJILLA_SECCIONES}>
          {orden.map((seccion) => {
            const items = secciones[seccion];
            return (
              <SeccionPlatos
                key={seccion}
                testId={`seccion-menu-${seccion}`}
                titulo={titulos?.[seccion] ?? ETIQUETA_SECCION[seccion]}
                items={items}
                onChange={(siguientes) => actualizarSeccion(seccion, siguientes)}
                platos={platos}
                platosPorId={platosPorId}
                cargandoPlatos={cargandoPlatos}
                debajoDePlato={debajoDePlato ? (item) => debajoDePlato(item, seccion) : undefined}
                plegable={plegable}
                abiertaAlInicio={abiertaAlInicio ? abiertaAlInicio(seccion, items) : true}
                detalleVacia={detalleVacia?.[seccion]}
                cabecera={cabeceraDe?.(seccion)}
                ordenable={ordenable}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
