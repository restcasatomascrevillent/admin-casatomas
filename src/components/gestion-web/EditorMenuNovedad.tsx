// ---------------------------------------------------------------------------
// Menú de una novedad («Ver menú»): el menú propio de esa novedad (p. ej. el de
// Navidad), no el menú del día ni la carta. Contrato en src/lib/menu-novedad.ts.
//
// Primero, segundo y postre se editan con el mismo EditorSeccionesMenu del menú
// del día (de la carta o a mano, con alérgenos y foto). «Comida + bebidas»
// añade la sección Bebidas, que se escribe a mano y necesita al menos una línea
// (ADR-3 del plan).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EditorSeccionesMenu } from "./EditorSeccionesMenu";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { itemLibre, type ItemMenu, type SeccionMenu } from "@/lib/menu-dia";
import { conservarTraduccionesVigentes, type ItemMenuNovedad, type MenuNovedad } from "@/lib/menu-novedad";

interface EditorMenuNovedadProps {
  menu: MenuNovedad;
  onChange: (menu: MenuNovedad) => void;
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
}

const OPCION_SOLO_COMIDA = "solo_comida";
const OPCION_CON_BEBIDAS = "con_bebidas";

export function EditorMenuNovedad({ menu, onChange, platos, platosPorId, cargandoPlatos }: EditorMenuNovedadProps) {
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
    <div className="space-y-3 border-t pt-4" data-testid="editor-menu-novedad">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Menú de «Ver menú»</p>
        <p className="text-xs text-muted-foreground">
          Es el menú de esta novedad (por ejemplo, el de Navidad), no el menú del día. Los platos de la carta se copian
          con su foto, sus alérgenos y su traducción; lo escrito a mano se traduce al guardar.
        </p>
      </div>

      <EditorSeccionesMenu
        secciones={{ primero: secciones.primero, segundo: secciones.segundo, postre: secciones.postre }}
        onChange={cambiarComida}
        platos={platos}
        platosPorId={platosPorId}
        cargandoPlatos={cargandoPlatos}
      />

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
            <Label
              key={opcion.valor}
              htmlFor={`menu-novedad-${opcion.valor}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 font-normal transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
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
    </div>
  );
}
