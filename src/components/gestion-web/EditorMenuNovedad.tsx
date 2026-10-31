// ---------------------------------------------------------------------------
// Menú de una novedad («Ver menú»): el menú propio de esa novedad (p. ej. el de
// Navidad) o una cata, no el menú del día ni la carta. Contrato en
// src/lib/menu-novedad.ts (v1 y v2, historia 4093221d).
//
// - Tipo «Menú» (por defecto): primero, segundo y postre con el mismo
//   EditorSeccionesMenu del menú del día; «Comida + bebidas» añade la sección
//   Bebidas, escrita a mano (ADR-3 de 4073221d); y el interruptor «Con
//   maridaje» abre «Bebida de cada plato», un bloque aparte debajo de los
//   platos (ADR-8), con una bebida por plato.
// - Tipo «Cata»: solo una lista ordenada de bebidas (de la carta o a mano).
//
// Lo del otro tipo (y los maridajes con el interruptor apagado) se conserva
// mientras se edita y se avisa de que no se guardará (E10).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { EditorSeccionesMenu } from "./EditorSeccionesMenu";
import { EditorLineaBebida, ElegirLineaBebida } from "./EditorLineaBebida";
import { useBebidasParaMenu } from "@/hooks/useBebidasParaMenu";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { ETIQUETA_SECCION, SECCIONES_MENU, itemLibre, type ItemMenu, type SeccionMenu } from "@/lib/menu-dia";
import {
  AVISO_MARIDAJE_APAGADO,
  avisosMenuNovedad,
  conservarTraduccionesLinea,
  conservarTraduccionesVigentes,
  type ItemMenuNovedad,
  type LineaBebidaNovedad,
  type MenuNovedad,
  type TipoMenuNovedad,
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

const TIPOS: { valor: TipoMenuNovedad; texto: string; detalle: string }[] = [
  { valor: "menu", texto: "Menú", detalle: "Platos por secciones, con bebidas o maridaje." },
  { valor: "cata", texto: "Cata", detalle: "Una lista ordenada de vinos y bebidas." },
];

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

function useEnfoque<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [enfoque, setEnfoque] = useState<Enfoque | null>(null);
  useEffect(() => {
    if (!enfoque) return;
    const fila = ref.current?.querySelector(`[data-clave="${enfoque.clave}"]`);
    for (const selector of enfoque.selectores) {
      const destino = fila?.querySelector<HTMLElement>(selector);
      if (destino) {
        destino.focus();
        break;
      }
    }
    setEnfoque(null);
  }, [enfoque]);
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
        <legend className="text-sm font-medium mb-2">¿Menú o cata?</legend>
        <RadioGroup
          value={menu.tipo}
          onValueChange={(valor) => onChange({ ...menu, tipo: valor === "cata" ? "cata" : "menu" })}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {TIPOS.map((opcion) => (
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
  const listaBebidasRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!enfocarBebida) return;
    listaBebidasRef.current?.querySelector<HTMLInputElement>(`[data-bebida="${enfocarBebida}"]`)?.focus();
    setEnfocarBebida(null);
  }, [enfocarBebida]);

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
    const copia = [...bebidas];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    cambiarBebidas(copia);
  };

  return (
    <>
      <EditorSeccionesMenu
        secciones={{ primero: secciones.primero, segundo: secciones.segundo, postre: secciones.postre }}
        onChange={cambiarComida}
        platos={platos}
        platosPorId={platosPorId}
        cargandoPlatos={cargandoPlatos}
      />

      <div className="space-y-2">
        <div className={CLASE_OPCION}>
          <Label htmlFor="menu-novedad-maridaje" className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center font-normal">
            <span className="block text-sm font-medium">Con maridaje</span>
            <span className="block text-xs text-muted-foreground">Una bebida para cada plato, de la carta o a mano.</span>
          </Label>
          <Switch
            id="menu-novedad-maridaje"
            checked={menu.maridaje}
            onCheckedChange={(encendido) => onChange({ ...menu, maridaje: encendido })}
          />
        </div>
        <AvisosMenu avisos={avisoMaridaje} testId="aviso-maridaje" />
        {menu.maridaje && <BebidaDeCadaPlato menu={menu} onChange={onChange} />}
      </div>

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
            <h4 className="text-sm font-semibold">Bebidas</h4>
            <span className="text-xs text-muted-foreground tabular-nums">
              {bebidas.length === 1 ? "1 línea" : `${bebidas.length} líneas`}
            </span>
          </header>

          {bebidas.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
              Sin bebidas todavía. Añade al menos una, por ejemplo «Vino de la casa, agua o refresco».
            </p>
          ) : (
            <ul ref={listaBebidasRef} className="space-y-2">
              {bebidas.map((bebida, indice) => (
                // Como las líneas de comida: si no cabe, los botones bajan a otra línea.
                <li key={bebida.id} className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-2">
                  <Input
                    data-bebida={bebida.id}
                    value={bebida.nombre}
                    onChange={(e) =>
                      cambiarBebidas(bebidas.map((b) => (b.id === bebida.id ? { ...b, nombre: e.target.value } : b)))
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
                </li>
              ))}
            </ul>
          )}

          <Button type="button" variant="ghost" size="sm" className="h-11 px-4" onClick={añadirBebida}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Añadir bebida
          </Button>
        </section>
      )}
    </>
  );
}

/** «Bebida de cada plato» (ADR-8): una línea por plato con nombre, por id del plato. */
function BebidaDeCadaPlato({ menu, onChange }: PropsBloque) {
  const carta = useBebidasParaMenu();
  const { ref, enfocar } = useEnfoque<HTMLElement>();
  const [cambiando, setCambiando] = useState<string | null>(null);

  // Un plato sin nombre no se guarda (ni su bebida): no se ofrece hasta que lo tenga.
  const grupos = SECCIONES_MENU.map((seccion) => ({
    seccion,
    platos: menu.secciones[seccion].filter((item) => item.nombre.trim() !== ""),
  })).filter((grupo) => grupo.platos.length > 0);
  const total = grupos.reduce((suma, grupo) => suma + grupo.platos.length, 0);
  const conBebida = grupos.reduce((suma, grupo) => suma + grupo.platos.filter((p) => menu.maridajes[p.id]).length, 0);

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

  return (
    <section
      ref={ref}
      data-testid="bebida-de-cada-plato"
      aria-labelledby="menu-novedad-bebida-de-cada-plato"
      className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="menu-novedad-bebida-de-cada-plato" className="text-sm font-semibold">
          Bebida de cada plato
        </h4>
        {total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {conBebida} de {total} con bebida
          </span>
        )}
      </header>

      <AvisoCartaTruncada truncado={carta.truncado} />

      {total === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
          Añade platos arriba para elegir la bebida de cada uno.
        </p>
      ) : (
        grupos.map(({ seccion, platos }) => (
          <div key={seccion} className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {ETIQUETA_SECCION[seccion]}
            </h5>
            <ul className="space-y-2">
              {platos.map((plato) => {
                const nombre = plato.nombre.trim();
                const linea = menu.maridajes[plato.id];
                return (
                  <li key={plato.id} data-clave={plato.id} className="min-w-0 space-y-2 rounded-lg border bg-card p-2.5">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">{nombre}</p>
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
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** La cata: lista ordenada de bebidas, sin platos, sin «Comida + bebidas» y sin maridaje. */
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
    const copia = [...cata];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    cambiarCata(copia);
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
        <ol className="space-y-2">
          {cata.map((linea, indice) => {
            const nombre = linea.nombre.trim() || "bebida sin nombre";
            return (
              <li key={linea.id} data-clave={linea.id} className="flex min-w-0 items-start gap-1">
                <div className="flex shrink-0 flex-col" role="group" aria-label={`Orden de «${nombre}»`}>
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
              </li>
            );
          })}
        </ol>
      )}

      <div data-clave={CLAVE_AÑADIR_CATA} className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Añadir bebida</p>
        <ElegirBebida carta={carta} titulo="Añadir bebida a la cata" onElegir={añadir} />
      </div>
    </section>
  );
}
