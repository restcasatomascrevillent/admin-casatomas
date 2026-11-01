// ---------------------------------------------------------------------------
// Menú de una novedad («Ver menú»): el menú propio de esa novedad (p. ej. el de
// Navidad) o una cata, no el menú del día ni la carta. Contrato en
// src/lib/menu-novedad.ts (v1 y v2, historia 4093221d).
//
// Tres opciones (petición del dueño, 31/10/2026: «Menú, cata y maridaje, tres
// opciones»), que en el modelo siguen siendo `tipo` + `maridaje`:
// - «Menú» (por defecto, tipo menu sin maridaje): primero, segundo y postre
//   con el mismo EditorSeccionesMenu del menú del día; «Comida + bebidas»
//   añade la sección Bebidas, escrita a mano (ADR-3 de 4073221d).
// - «Maridaje» (tipo menu con maridaje): los platos con su bebida dentro de
//   la tarjeta de cada uno, sin «¿Qué incluye el menú?» (no guarda Bebidas).
// - «Cata»: solo una lista ordenada de bebidas (de la carta o a mano).
//
// Lo de la otra opción (y los maridajes al pasar a «Menú») se conserva
// mientras se edita y se avisa de que no se guardará (E10).
// ---------------------------------------------------------------------------

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListaOrdenable } from "@/components/ui/lista-ordenable";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EditorSeccionesMenu, SeccionPlatos } from "./EditorSeccionesMenu";
import { EditorLineaBebida, ElegirLineaBebida } from "./EditorLineaBebida";
import { useBebidasParaMenu } from "@/hooks/useBebidasParaMenu";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { ETIQUETA_SECCION, SECCIONES_MENU, itemLibre, rotuloEnElEditor, type ItemMenu, type SeccionMenu } from "@/lib/menu-dia";
import {
  AVISO_MARIDAJE_APAGADO,
  avisosMenuNovedad,
  conservarTraduccionesLinea,
  conservarTraduccionesVigentes,
  ETIQUETA_POSICION_EXTRA,
  largoTitulo,
  MAX_TITULO_SECCION,
  moverItem,
  seccionesConTitulo,
  titulosDemasiadoLargos,
  tituloPropio,
  type SeccionMenuNovedad,
  platosEnOrden,
  POSICIONES_SECCION_EXTRA,
  seccionExtraVacia,
  type PosicionSeccionExtra,
  type SeccionExtraNovedad,
  type ItemMenuNovedad,
  type LineaBebidaNovedad,
  type MenuNovedad,
} from "@/lib/menu-novedad";

interface EditorMenuNovedadProps {
  menu: MenuNovedad;
  onChange: (menu: MenuNovedad) => void;
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
}

interface PropsBloque {
  menu: MenuNovedad;
  onChange: (menu: MenuNovedad) => void;
}

const OPCION_SOLO_COMIDA = "solo_comida";
const OPCION_CON_BEBIDAS = "con_bebidas";

/** Las tres opciones que ve el usuario. En el modelo: `tipo` + `maridaje`. */
type OpcionMenuNovedad = "menu" | "maridaje" | "cata";

const OPCIONES: { valor: OpcionMenuNovedad; texto: string; detalle: string }[] = [
  { valor: "menu", texto: "Menú", detalle: "Primero, segundo y postre." },
  { valor: "maridaje", texto: "Maridaje", detalle: "Los platos y una bebida para cada uno." },
  { valor: "cata", texto: "Cata", detalle: "Una lista ordenada de vinos y bebidas." },
];

const opcionDeMenu = (menu: MenuNovedad): OpcionMenuNovedad =>
  menu.tipo === "cata" ? "cata" : menu.maridaje ? "maridaje" : "menu";

function conOpcion(menu: MenuNovedad, opcion: OpcionMenuNovedad): MenuNovedad {
  if (opcion === "cata") return { ...menu, tipo: "cata" };
  // El Maridaje no enseña «¿Qué incluye el menú?» y no guarda la sección
  // Bebidas (limpiarMenuNovedad), pero se conserva en memoria: al volver a
  // «Menú» reaparece tal cual.
  return { ...menu, tipo: "menu", maridaje: opcion === "maridaje" };
}

// Opción de un RadioGroup o del interruptor: la tarjeta entera es la zona táctil (44 px).
const CLASE_OPCION =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 font-normal transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5";

const CAMPO_EDITABLE = "input:not([readonly]):not([disabled])";
const BOTON_ACTIVO = "button:not([disabled])";
const CLAVE_AÑADIR_CATA = "añadir-cata";

/**
 * Lleva el foco a un elemento de la fila `[data-clave]` después de pintar.
 * Al elegir, cambiar, quitar o mover una línea, el botón pulsado desaparece o
 * se mueve: sin esto, quien usa el teclado volvería al principio de la página.
 */
interface Enfoque {
  clave: string;
  /** Se prueban en orden; el primero que exista recibe el foco. */
  selectores: string[];
}

function useEnfoque<T extends HTMLElement>(atributo = "data-clave") {
  const ref = useRef<T>(null);
  const [enfoque, setEnfoque] = useState<Enfoque | null>(null);
  useEffect(() => {
    if (!enfoque) return;
    const fila = ref.current?.querySelector(`[${atributo}="${enfoque.clave}"]`);
    for (const selector of enfoque.selectores) {
      const destino = fila?.querySelector<HTMLElement>(selector);
      if (destino) {
        destino.focus();
        break;
      }
    }
    setEnfoque(null);
  }, [enfoque, atributo]);
  return { ref, enfocar: setEnfoque };
}

/** Avisos de E10. Siempre montado: así el lector de pantalla anuncia el aviso cuando aparece. */
function AvisosMenu({ avisos, testId }: { avisos: string[]; testId: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 empty:hidden dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      {avisos.length > 0 && (
        <ul className="space-y-1 text-sm">
          {avisos.map((aviso) => (
            <li key={aviso} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {aviso} <span className="text-xs">Mientras no guardes, si vuelves atrás lo recuperas.</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** La carta de vinos pasa del tope que lee el buscador (`truncado` de useBebidasParaMenu). */
function AvisoCartaTruncada({ truncado }: { truncado: boolean }) {
  if (!truncado) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="aviso-carta-truncada">
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      La carta tiene más vinos de los que caben en el buscador. Si no encuentras uno, añádelo a mano con «Vino, cava
      o champagne».
    </p>
  );
}

type CartaDeBebidas = ReturnType<typeof useBebidasParaMenu>;

/** ElegirLineaBebida con la carta ya leída y, al cambiar una línea, «Cancelar». */
function ElegirBebida({
  carta,
  titulo,
  onElegir,
  onCancelar,
}: {
  carta: CartaDeBebidas;
  titulo: string;
  onElegir: (linea: LineaBebidaNovedad) => void;
  onCancelar?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <ElegirLineaBebida
        vinos={carta.vinos}
        bebidas={carta.bebidas}
        cargando={carta.isLoading}
        error={carta.error !== null}
        onElegir={onElegir}
        titulo={titulo}
      />
      {onCancelar && (
        <Button type="button" variant="ghost" size="sm" className="h-11 px-3" onClick={onCancelar}>
          Cancelar
        </Button>
      )}
    </div>
  );
}

export function EditorMenuNovedad({ menu, onChange, platos, platosPorId, cargandoPlatos }: EditorMenuNovedadProps) {
  const avisos = avisosMenuNovedad(menu);

  return (
    <div className="min-w-0 space-y-3 border-t pt-4" data-testid="editor-menu-novedad">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Menú de «Ver menú»</p>
        <p className="text-xs text-muted-foreground">
          Es el menú de esta novedad (por ejemplo, el de Navidad) o una cata, no el menú del día. Los platos y las
          bebidas de la carta se copian con su traducción; lo escrito a mano se traduce al guardar.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium mb-2">¿Qué es?</legend>
        <RadioGroup
          value={opcionDeMenu(menu)}
          onValueChange={(valor) => onChange(conOpcion(menu, valor as OpcionMenuNovedad))}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {OPCIONES.map((opcion) => (
            <Label key={opcion.valor} htmlFor={`menu-novedad-tipo-${opcion.valor}`} className={CLASE_OPCION}>
              <RadioGroupItem value={opcion.valor} id={`menu-novedad-tipo-${opcion.valor}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opcion.texto}</span>
                <span className="block text-xs text-muted-foreground">{opcion.detalle}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <AvisosMenu avisos={avisos.filter((aviso) => aviso !== AVISO_MARIDAJE_APAGADO)} testId="avisos-tipo-menu" />

      {menu.tipo === "cata" ? (
        <EditorCata menu={menu} onChange={onChange} />
      ) : (
        <EditorMenuPlatos
          menu={menu}
          onChange={onChange}
          platos={platos}
          platosPorId={platosPorId}
          cargandoPlatos={cargandoPlatos}
          avisoMaridaje={avisos.filter((aviso) => aviso === AVISO_MARIDAJE_APAGADO)}
        />
      )}
    </div>
  );
}

function EditorMenuPlatos({
  menu,
  onChange,
  platos,
  platosPorId,
  cargandoPlatos,
  avisoMaridaje,
}: EditorMenuNovedadProps & { avisoMaridaje: string[] }) {
  const { secciones } = menu;
  const bebidas = secciones.bebidas;

  // La bebida recién añadida recibe el foco (el botón «Añadir bebida» sigue en
  // su sitio, pero lo siguiente que se hace es escribirla).
  const [enfocarBebida, setEnfocarBebida] = useState<string | null>(null);
  const listaBebidasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enfocarBebida) return;
    listaBebidasRef.current?.querySelector<HTMLInputElement>(`[data-bebida="${enfocarBebida}"]`)?.focus();
    setEnfocarBebida(null);
  }, [enfocarBebida]);
  // Subir y bajar: el foco sigue a la línea (o pasa a la otra flecha si ya no puede ir más allá).
  const { ref: refOrdenBebidas, enfocar: enfocarOrdenBebida } = useEnfoque<HTMLDivElement>();

  const cambiarComida = (siguientes: Record<SeccionMenu, ItemMenu[]>) =>
    onChange({
      ...menu,
      secciones: {
        ...secciones,
        primero: conservarTraduccionesVigentes(secciones.primero, siguientes.primero),
        segundo: conservarTraduccionesVigentes(secciones.segundo, siguientes.segundo),
        postre: conservarTraduccionesVigentes(secciones.postre, siguientes.postre),
      },
    });

  const cambiarBebidas = (siguientes: ItemMenuNovedad[]) =>
    onChange({ ...menu, secciones: { ...secciones, bebidas: conservarTraduccionesVigentes(bebidas, siguientes) } });

  const añadirBebida = () => {
    const nueva = itemLibre("");
    cambiarBebidas([...bebidas, nueva]);
    setEnfocarBebida(nueva.id);
  };

  const moverBebida = (indice: number, direccion: -1 | 1) => {
    const destino = indice + direccion;
    if (destino < 0 || destino >= bebidas.length) return;
    onChange(moverItem(menu, "bebidas", indice, destino));
    const sentido = direccion === -1 ? "arriba" : "abajo";
    enfocarOrdenBebida({
      clave: bebidas[indice].id,
      selectores: [`[data-mover="${sentido}"]:not([disabled])`, "[data-mover]:not([disabled])"],
    });
  };

  return (
    <>
      {menu.maridaje ? (
        <PlatosConMaridaje
          menu={menu}
          onChange={onChange}
          onCambiarComida={cambiarComida}
          platos={platos}
          platosPorId={platosPorId}
          cargandoPlatos={cargandoPlatos}
        />
      ) : (
        <>
          <EditorSeccionesMenu
            ordenable
            secciones={{ primero: secciones.primero, segundo: secciones.segundo, postre: secciones.postre }}
            titulos={titulosEditor(menu)}
            onChange={cambiarComida}
            platos={platos}
            platosPorId={platosPorId}
            cargandoPlatos={cargandoPlatos}
          />
          <SeccionesExtra
            menu={menu}
            onChange={onChange}
            platos={platos}
            platosPorId={platosPorId}
            cargandoPlatos={cargandoPlatos}
          />
        </>
      )}

      <AvisosMenu avisos={avisoMaridaje} testId="aviso-maridaje" />

      {/* «¿Qué incluye el menú?» solo en Menú: el Maridaje ya lleva la bebida en cada plato. */}
      {!menu.maridaje && (
      <>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium mb-2">¿Qué incluye el menú?</legend>
        <RadioGroup
          value={menu.incluye_bebidas ? OPCION_CON_BEBIDAS : OPCION_SOLO_COMIDA}
          onValueChange={(valor) => onChange({ ...menu, incluye_bebidas: valor === OPCION_CON_BEBIDAS })}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {[
            { valor: OPCION_SOLO_COMIDA, texto: "Solo comida", detalle: "Primero, segundo y postre." },
            { valor: OPCION_CON_BEBIDAS, texto: "Comida + bebidas", detalle: "Añade la sección Bebidas." },
          ].map((opcion) => (
            <Label key={opcion.valor} htmlFor={`menu-novedad-${opcion.valor}`} className={CLASE_OPCION}>
              <RadioGroupItem value={opcion.valor} id={`menu-novedad-${opcion.valor}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opcion.texto}</span>
                <span className="block text-xs text-muted-foreground">{opcion.detalle}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      {menu.incluye_bebidas && (
        <section data-testid="seccion-menu-bebidas" className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
          <header className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{tituloPropio(menu, "bebidas") ?? "Bebidas"}</h4>
            <span className="text-xs text-muted-foreground tabular-nums">
              {bebidas.length === 1 ? "1 línea" : `${bebidas.length} líneas`}
            </span>
          </header>

          {bebidas.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
              Sin bebidas todavía. Añade al menos una, por ejemplo «Vino de la casa, agua o refresco».
            </p>
          ) : (
            <div ref={refOrdenBebidas}>
              <div ref={listaBebidasRef}>
                <ListaOrdenable
                  ids={bebidas.map((bebida) => bebida.id)}
                  nombre={(id) => {
                    const indice = bebidas.findIndex((bebida) => bebida.id === id);
                    return bebidas[indice]?.nombre.trim() || `bebida ${indice + 1}`;
                  }}
                  onMover={(desde, hasta) => onChange(moverItem(menu, "bebidas", desde, hasta))}
                  className="space-y-2"
                  // Como las líneas de comida: si no cabe, los botones bajan a otra línea.
                  claseElemento="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-2"
                  aria-label="Bebidas del menú, en orden"
                >
                  {(_id, indice, { asa }) => {
                    const bebida = bebidas[indice];
                    return (
                      <>
                        {asa}
                        <Input
                          data-bebida={bebida.id}
                          value={bebida.nombre}
                          onChange={(e) =>
                            cambiarBebidas(
                              bebidas.map((b) => (b.id === bebida.id ? { ...b, nombre: e.target.value } : b)),
                            )
                          }
                          placeholder="Ej: Vino de la casa, agua o refresco"
                          aria-label={`Bebida ${indice + 1}`}
                          className="h-11 min-w-[11rem] flex-1 text-base md:text-base"
                        />
                        <div className="ml-auto flex shrink-0 items-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            data-mover="arriba"
                            disabled={indice === 0}
                            onClick={() => moverBebida(indice, -1)}
                            aria-label={`Subir bebida ${indice + 1}`}
                          >
                            <ChevronUp className="h-5 w-5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            data-mover="abajo"
                            disabled={indice === bebidas.length - 1}
                            onClick={() => moverBebida(indice, 1)}
                            aria-label={`Bajar bebida ${indice + 1}`}
                          >
                            <ChevronDown className="h-5 w-5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                            onClick={() => cambiarBebidas(bebidas.filter((b) => b.id !== bebida.id))}
                            aria-label={`Quitar bebida ${indice + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    );
                  }}
                </ListaOrdenable>
              </div>
            </div>
          )}

          <Button type="button" variant="ghost" size="sm" className="h-11 px-4" onClick={añadirBebida}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Añadir bebida
          </Button>
        </section>
      )}
      </>
      )}

      <NombresSecciones menu={menu} onChange={onChange} />
    </>
  );
}

const ETIQUETA_SECCION_NOVEDAD: Record<SeccionMenuNovedad, string> = { ...ETIQUETA_SECCION, bebidas: "Bebidas" };
const IDIOMAS_TITULO = [
  { idioma: "es", texto: "Español" },
  { idioma: "en", texto: "Inglés" },
  { idioma: "fr", texto: "Francés" },
] as const;

/**
 * Los rótulos de primero, segundo y postre en el editor: el nombre propio si lo
 * hay y, si no, el de siempre con el que pondrá la web cuando difiere
 * («Primero · en la web: Entrantes», QA-MDN-04).
 */
const titulosEditor = (menu: MenuNovedad): Partial<Record<SeccionMenu, string>> =>
  Object.fromEntries(
    SECCIONES_MENU.map((seccion) => [seccion, tituloPropio(menu, seccion) ?? rotuloEnElEditor(seccion, menu.secciones, null)]),
  );

/**
 * Nombres propios de las secciones (tarea «Cambiar en el panel el nombre de
 * las secciones»): solo de esta novedad, en español y, si se quiere, en inglés
 * y francés escritos a mano. Vacío = el nombre de siempre. Plegado de entrada
 * salvo que ya haya alguno.
 */
function NombresSecciones({ menu, onChange }: PropsBloque) {
  const secciones = seccionesConTitulo(menu);
  const propios = secciones.filter((seccion) => tituloPropio(menu, seccion));
  const [abierto, setAbierto] = useState(propios.length > 0);
  const largos = titulosDemasiadoLargos(menu);
  const idCuerpo = useId();

  const cambiar = (seccion: SeccionMenuNovedad, idioma: "es" | "en" | "fr", valor: string) => {
    const actual = menu.titulos[seccion] ?? { es: "" };
    onChange({ ...menu, titulos: { ...menu.titulos, [seccion]: { ...actual, [idioma]: valor } } });
  };

  return (
    <section data-testid="nombres-secciones" className="rounded-lg border bg-muted/20 px-3 py-1">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={abierto ? idCuerpo : undefined}
        onClick={() => setAbierto((valor) => !valor)}
        className="flex min-h-11 w-full items-center gap-2 rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${abierto ? "" : "-rotate-90"}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Nombres de las secciones</span>
          <span className="block text-xs text-muted-foreground">
            {propios.length === 0
              ? "Opcional: los de siempre (Primero, Segundo…)"
              : propios.map((seccion) => tituloPropio(menu, seccion)).join(" · ")}
          </span>
        </span>
      </button>
      {abierto && (
        <div id={idCuerpo} className="space-y-3 pb-3 pt-1">
          <p className="text-xs text-muted-foreground">
            Solo para esta novedad. Si dejas el español vacío se usa el nombre de siempre. Si no escribes el inglés o el
            francés, en esos idiomas se verá el nombre en español. Como mucho {MAX_TITULO_SECCION} caracteres.
          </p>
          {secciones.map((seccion) => (
            <fieldset key={seccion} className="min-w-0 space-y-1.5" data-testid={`nombre-seccion-${seccion}`}>
              <legend className="text-xs font-medium">{ETIQUETA_SECCION_NOVEDAD[seccion]}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {IDIOMAS_TITULO.map(({ idioma, texto }) => {
                  const id = `${idCuerpo}-${seccion}-${idioma}`;
                  const largo = largos.some((l) => l.seccion === seccion && l.idioma === idioma);
                  const sinEspañol = idioma !== "es" && !tituloPropio(menu, seccion);
                  return (
                    <div key={idioma} className="min-w-0 space-y-1">
                      <Label htmlFor={id} className="text-xs text-muted-foreground">
                        {texto}
                        {idioma !== "es" && " (opcional)"}
                      </Label>
                      <Input
                        id={id}
                        value={menu.titulos[seccion]?.[idioma] ?? ""}
                        onChange={(e) => cambiar(seccion, idioma, e.target.value)}
                        placeholder={
                          idioma === "es" ? ETIQUETA_SECCION_NOVEDAD[seccion] : tituloPropio(menu, seccion) ?? "Como en español"
                        }
                        aria-label={`Nombre de «${ETIQUETA_SECCION_NOVEDAD[seccion]}» en ${texto.toLowerCase()}`}
                        aria-invalid={largo || undefined}
                        aria-describedby={largo ? `${id}-aviso` : undefined}
                        className="h-11 text-base md:text-sm"
                      />
                      {largo && (
                        <p id={`${id}-aviso`} className="text-xs text-destructive">
                          Pasa de {MAX_TITULO_SECCION} caracteres ({largoTitulo(menu.titulos[seccion]?.[idioma])}).
                        </p>
                      )}
                      {sinEspañol && (menu.titulos[seccion]?.[idioma] ?? "").trim() !== "" && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Sin nombre en español no se guarda: escribe también el español.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Maridaje: los platos (primero, segundo y postre) con la bebida de cada uno
 * DENTRO de su tarjeta, justo debajo (petición del dueño, 31/10/2026: «más
 * fácil añadir el maridaje por plato»). Antes iba en un bloque aparte debajo
 * de todos los platos (ADR-8). Se guarda igual: `maridajes[id del plato]`.
 */
function PlatosConMaridaje({
  menu,
  onChange,
  onCambiarComida,
  platos,
  platosPorId,
  cargandoPlatos,
}: PropsBloque & {
  onCambiarComida: (secciones: Record<SeccionMenu, ItemMenu[]>) => void;
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
}) {
  const carta = useBebidasParaMenu();
  // La fila del plato (en la lista ordenable) ya lleva `data-clave` con su id:
  // la bebida usa otro atributo para que el foco no caiga en el plato.
  const { ref, enfocar } = useEnfoque<HTMLElement>("data-clave-maridaje");
  const [cambiando, setCambiando] = useState<string | null>(null);
  const { secciones } = menu;

  // Un plato sin nombre no se guarda (ni su bebida): no se ofrece hasta que lo tenga.
  const conNombre = platosEnOrden(menu).filter((item) => item.nombre.trim() !== "");
  const total = conNombre.length;
  const conBebida = conNombre.filter((p) => menu.maridajes[p.id]).length;

  const ponerBebida = (platoId: string, linea: LineaBebidaNovedad) =>
    onChange({
      ...menu,
      maridajes: { ...menu.maridajes, [platoId]: conservarTraduccionesLinea(menu.maridajes[platoId], linea) },
    });

  const elegir = (platoId: string, linea: LineaBebidaNovedad) => {
    ponerBebida(platoId, linea);
    setCambiando(null);
    enfocar({ clave: platoId, selectores: [CAMPO_EDITABLE] });
  };

  const quitar = (platoId: string) => {
    const maridajes = { ...menu.maridajes };
    delete maridajes[platoId];
    onChange({ ...menu, maridajes });
    enfocar({ clave: platoId, selectores: [BOTON_ACTIVO] });
  };

  const bebidaDe = (plato: ItemMenu) => {
    const nombre = plato.nombre.trim();
    if (!nombre) {
      return <p className="text-xs text-muted-foreground">Escribe el nombre del plato para elegir su bebida.</p>;
    }
    const linea = menu.maridajes[plato.id];
    return (
      <div data-clave-maridaje={plato.id} className="min-w-0 space-y-1.5">
        {linea && cambiando !== plato.id ? (
          <EditorLineaBebida
            linea={linea}
            titulo="Bebida del maridaje"
            onChange={(siguiente) => ponerBebida(plato.id, siguiente)}
            onQuitar={() => quitar(plato.id)}
            onCambiar={() => {
              setCambiando(plato.id);
              enfocar({ clave: plato.id, selectores: [BOTON_ACTIVO] });
            }}
          />
        ) : (
          <ElegirBebida
            carta={carta}
            titulo={`Bebida para «${nombre}»`}
            onElegir={(nueva) => elegir(plato.id, nueva)}
            onCancelar={
              linea
                ? () => {
                    setCambiando(null);
                    enfocar({ clave: plato.id, selectores: ['button[aria-label^="Cambiar"]'] });
                  }
                : undefined
            }
          />
        )}
      </div>
    );
  };

  return (
    <section
      ref={ref}
      data-testid="bebida-de-cada-plato"
      aria-labelledby="menu-novedad-bebida-de-cada-plato"
      className="min-w-0 space-y-2"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="menu-novedad-bebida-de-cada-plato" className="text-sm font-semibold">
          Platos y su bebida
        </h4>
        {total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {conBebida} de {total} con bebida
          </span>
        )}
      </header>
      <AvisoCartaTruncada truncado={carta.truncado} />
      <EditorSeccionesMenu
        ordenable
        secciones={{ primero: secciones.primero, segundo: secciones.segundo, postre: secciones.postre }}
        titulos={titulosEditor(menu)}
        onChange={onCambiarComida}
        platos={platos}
        platosPorId={platosPorId}
        cargandoPlatos={cargandoPlatos}
        debajoDePlato={bebidaDe}
      />
      <SeccionesExtra
        menu={menu}
        onChange={onChange}
        platos={platos}
        platosPorId={platosPorId}
        cargandoPlatos={cargandoPlatos}
        debajoDePlato={bebidaDe}
      />
    </section>
  );
}

/**
 * Secciones con nombre libre (Aperitivo, Entrantes, Prepostre…): cada una con
 * su nombre, dónde va respecto a primero, segundo y postre, y sus platos.
 */
function SeccionesExtra({
  menu,
  onChange,
  platos,
  platosPorId,
  cargandoPlatos,
  debajoDePlato,
}: PropsBloque & {
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
  debajoDePlato?: (item: ItemMenu) => ReactNode;
}) {
  const [enfocar, setEnfocar] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enfocar) return;
    listaRef.current?.querySelector<HTMLInputElement>(`[data-seccion-extra="${enfocar}"]`)?.focus();
    setEnfocar(null);
  }, [enfocar]);

  const cambiar = (id: string, cambio: (seccion: SeccionExtraNovedad) => SeccionExtraNovedad) =>
    onChange({ ...menu, extras: menu.extras.map((s) => (s.id === id ? cambio(s) : s)) });

  const añadir = () => {
    const nueva = seccionExtraVacia();
    onChange({ ...menu, extras: [...menu.extras, nueva] });
    setEnfocar(nueva.id);
  };

  return (
    <div ref={listaRef} className="space-y-2" data-testid="secciones-extra">
      {menu.extras.map((seccion, indice) => {
        const nombre = seccion.nombre.trim() || `sección ${indice + 1}`;
        return (
          <SeccionPlatos
            ordenable
            key={seccion.id}
            testId={`seccion-extra-${indice + 1}`}
            titulo={
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <Input
                  data-seccion-extra={seccion.id}
                  value={seccion.nombre}
                  maxLength={40}
                  // Cambia el castellano: su traducción ya no vale (se rehace al guardar).
                  onChange={(e) => cambiar(seccion.id, (s) => ({ ...s, nombre: e.target.value, traducciones: undefined }))}
                  placeholder="Ej: Aperitivo"
                  aria-label={`Nombre de la sección ${indice + 1}`}
                  className="h-11 min-w-0 flex-1 basis-40 font-semibold"
                />
                <select
                  value={seccion.posicion}
                  onChange={(e) => cambiar(seccion.id, (s) => ({ ...s, posicion: e.target.value as PosicionSeccionExtra }))}
                  aria-label={`Dónde va «${nombre}»`}
                  className="h-11 min-w-0 rounded-md border bg-background px-2 text-sm"
                >
                  {POSICIONES_SECCION_EXTRA.map((posicion) => (
                    <option key={posicion} value={posicion}>
                      {ETIQUETA_POSICION_EXTRA[posicion]}
                    </option>
                  ))}
                </select>
              </div>
            }
            acciones={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 text-destructive hover:text-destructive"
                onClick={() => onChange({ ...menu, extras: menu.extras.filter((s) => s.id !== seccion.id) })}
                aria-label={`Quitar la sección «${nombre}»`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            }
            items={seccion.items}
            onChange={(items) =>
              cambiar(seccion.id, (s) => ({ ...s, items: conservarTraduccionesVigentes(s.items, items) }))
            }
            platos={platos}
            platosPorId={platosPorId}
            cargandoPlatos={cargandoPlatos}
            debajoDePlato={debajoDePlato}
          />
        );
      })}
      <Button type="button" variant="outline" size="sm" className="h-11 px-4" onClick={añadir}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Añadir sección
      </Button>
      <p className="text-xs text-muted-foreground">
        Para más tiempos aparte de primero, segundo y postre: aperitivo, entrantes, prepostre…
      </p>
    </div>
  );
}

const nombreDe = (linea: LineaBebidaNovedad | undefined) => linea?.nombre.trim() || "bebida sin nombre";

/**
 * La cata: lista ordenada de bebidas, sin platos, sin «Comida + bebidas» y sin
 * maridaje. Se reordena arrastrando desde el asa o con subir y bajar.
 */
function EditorCata({ menu, onChange }: PropsBloque) {
  const carta = useBebidasParaMenu();
  const { ref, enfocar } = useEnfoque<HTMLElement>();
  const [cambiando, setCambiando] = useState<string | null>(null);
  const { cata } = menu;

  const cambiarCata = (siguientes: LineaBebidaNovedad[]) => onChange({ ...menu, cata: siguientes });

  const reemplazar = (indice: number, nueva: LineaBebidaNovedad) =>
    cambiarCata(cata.map((linea, i) => (i === indice ? conservarTraduccionesLinea(linea, nueva) : linea)));

  const añadir = (linea: LineaBebidaNovedad) => {
    cambiarCata([...cata, linea]);
    enfocar({ clave: linea.id, selectores: [CAMPO_EDITABLE] });
  };

  const elegirEnLugarDe = (indice: number, nueva: LineaBebidaNovedad) => {
    reemplazar(indice, nueva);
    setCambiando(null);
    enfocar({ clave: nueva.id, selectores: [CAMPO_EDITABLE] });
  };

  const mover = (indice: number, direccion: "arriba" | "abajo") => {
    const destino = direccion === "arriba" ? indice - 1 : indice + 1;
    if (destino < 0 || destino >= cata.length) return;
    onChange(moverItem(menu, "cata", indice, destino));
    // El foco sigue a la línea; si ya no puede ir más allá, pasa a la otra flecha.
    enfocar({
      clave: cata[indice].id,
      selectores: [`[data-mover="${direccion}"]:not([disabled])`, "[data-mover]:not([disabled])"],
    });
  };

  const quitar = (indice: number) => {
    const siguientes = cata.filter((_, i) => i !== indice);
    cambiarCata(siguientes);
    const vecina = siguientes[Math.min(indice, siguientes.length - 1)];
    enfocar({ clave: vecina ? vecina.id : CLAVE_AÑADIR_CATA, selectores: [BOTON_ACTIVO] });
  };

  return (
    <section
      ref={ref}
      data-testid="editor-cata"
      aria-labelledby="menu-novedad-cata"
      className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h4 id="menu-novedad-cata" className="text-sm font-semibold">
          Cata
        </h4>
        <span className="text-xs text-muted-foreground tabular-nums">
          {cata.length === 1 ? "1 bebida" : `${cata.length} bebidas`}
        </span>
      </header>

      <AvisoCartaTruncada truncado={carta.truncado} />

      {cata.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
          Sin bebidas todavía. Añade la primera de la carta o a mano; se sirven en el orden de la lista.
        </p>
      ) : (
        <ListaOrdenable
          ids={cata.map((linea) => linea.id)}
          nombre={(id) => nombreDe(cata.find((linea) => linea.id === id))}
          onMover={(desde, hasta) => onChange(moverItem(menu, "cata", desde, hasta))}
          className="space-y-2"
          claseElemento="flex min-w-0 items-start gap-1"
          aria-label="Bebidas de la cata, en orden"
        >
          {(_id, indice, { asa }) => {
            const linea = cata[indice];
            const nombre = nombreDe(linea);
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
                    onClick={() => mover(indice, "arriba")}
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
                    disabled={indice === cata.length - 1}
                    onClick={() => mover(indice, "abajo")}
                    aria-label={`Bajar «${nombre}»`}
                  >
                    <ChevronDown className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  {cambiando === linea.id ? (
                    <div className="space-y-1.5 rounded-md border bg-card p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Cambiar «{nombre}» (bebida {indice + 1})
                      </p>
                      <ElegirBebida
                        carta={carta}
                        titulo={`Bebida ${indice + 1} de la cata, en lugar de «${nombre}»`}
                        onElegir={(nueva) => elegirEnLugarDe(indice, nueva)}
                        onCancelar={() => {
                          setCambiando(null);
                          enfocar({ clave: linea.id, selectores: ['button[aria-label^="Cambiar"]'] });
                        }}
                      />
                    </div>
                  ) : (
                    <EditorLineaBebida
                      linea={linea}
                      titulo={`Bebida ${indice + 1} de la cata`}
                      onChange={(siguiente) => reemplazar(indice, siguiente)}
                      onQuitar={() => quitar(indice)}
                      onCambiar={() => {
                        setCambiando(linea.id);
                        enfocar({ clave: linea.id, selectores: [BOTON_ACTIVO] });
                      }}
                    />
                  )}
                </div>
              </>
            );
          }}
        </ListaOrdenable>
      )}

      <div data-clave={CLAVE_AÑADIR_CATA} className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Añadir bebida</p>
        <ElegirBebida carta={carta} titulo="Añadir bebida a la cata" onElegir={añadir} />
      </div>
    </section>
  );
}
