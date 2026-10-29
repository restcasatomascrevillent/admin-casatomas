// ---------------------------------------------------------------------------
// Bloque «Botones» del editor de novedades (historia 4073221d).
//
// «Sin botones» por defecto: una novedad sin botones se ve en la web igual que
// siempre. Se pueden añadir hasta 2 de los tipos fijos (Llamar, Ver menú,
// Échale un vistazo), sin repetir, y ordenarlos con subir/bajar (sin arrastrar:
// tiene que poder hacerse con el teclado). Las etiquetas las pone la web en
// cada idioma; aquí solo se elige el tipo.
//
// «Échale un vistazo» solo se ofrece con un plato de la carta enlazado, y
// «Ver menú» abre el editor del menú de la novedad. Las reglas y el payload
// están en src/lib/menu-novedad.ts.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Eye,
  Info,
  Phone,
  Plus,
  Unlink,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import {
  ETIQUETA_BOTON,
  MAX_BOTONES,
  TIPOS_BOTON,
  platoEnCarta,
  type ErrorBotones,
  type MenuNovedad,
  type TipoBoton,
} from "@/lib/menu-novedad";
import { EditorMenuNovedad } from "./EditorMenuNovedad";
import { posicionImagen } from "./previewConstants";
import { SelectorPlato } from "./SelectorPlato";

const ICONO_BOTON: Record<TipoBoton, ComponentType<{ className?: string }>> = {
  llamar: Phone,
  ver_menu: BookOpen,
  ver_plato: Eye,
};

export const TEXTO_AYUDA_PLATO =
  "Si el plato es nuevo en la carta, el botón aparecerá en la web tras la próxima publicación.";

export interface BloqueBotonesNovedadProps {
  botones: TipoBoton[];
  onBotonesChange: (botones: TipoBoton[]) => void;
  platoId: string | null;
  onPlatoChange: (platoId: string | null) => void;
  menu: MenuNovedad;
  onMenuChange: (menu: MenuNovedad) => void;
  platos: PlatoDeCarta[];
  platosPorId: Map<string, PlatoDeCarta>;
  cargandoPlatos: boolean;
  errorPlatos: Error | null;
  onReintentarPlatos?: () => void;
  /** Aviso «El plato ya no está en la carta» (borrado, desactivado o fuera del restaurante). */
  platoRetirado: boolean;
  /** Lo que impide guardar (validarBotonesNovedad). */
  errores: ErrorBotones[];
}

export function BloqueBotonesNovedad({
  botones,
  onBotonesChange,
  platoId,
  onPlatoChange,
  menu,
  onMenuChange,
  platos,
  platosPorId,
  cargandoPlatos,
  errorPlatos,
  onReintentarPlatos,
  platoRetirado,
  errores,
}: BloqueBotonesNovedadProps) {
  const plato = platoId ? platosPorId.get(platoId) : undefined;
  const nombrePlato = plato?.nombre?.trim() || null;
  const lleno = botones.length >= MAX_BOTONES;
  const disponibles = TIPOS_BOTON.filter((tipo) => !botones.includes(tipo));
  const tieneVerPlato = botones.includes("ver_plato");
  const platosEnCarta = platos.filter(platoEnCarta);
  // El plato importa si ya hay «Échale un vistazo» o aún se puede añadir.
  const mostrarPlato = tieneVerPlato || (!lleno && disponibles.includes("ver_plato")) || !!platoId;

  // Al añadir, quitar o mover, el control pulsado desaparece o se mueve de
  // sitio: el foco se lleva a donde sigue teniendo sentido, no se pierde en <body>.
  // `enfocar` es una lista de candidatos por orden de preferencia.
  const raizRef = useRef<HTMLElement>(null);
  const [enfocar, setEnfocar] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enfocar) return;
    const destino = [...enfocar, "titulo"]
      .map((clave) => raizRef.current?.querySelector<HTMLElement>(`[data-foco="${clave}"]:not(:disabled)`))
      .find(Boolean);
    destino?.focus();
    setEnfocar(null);
  }, [enfocar]);

  const añadir = (tipo: TipoBoton) => {
    if (lleno || botones.includes(tipo)) return;
    onBotonesChange([...botones, tipo]);
    setEnfocar([`fila-${tipo}`]);
  };

  const quitar = (tipo: TipoBoton) => {
    onBotonesChange(botones.filter((b) => b !== tipo));
    setEnfocar(["titulo"]);
  };

  const mover = (indice: number, direccion: -1 | 1) => {
    const destino = indice + direccion;
    if (destino < 0 || destino >= botones.length) return;
    const copia = [...botones];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    onBotonesChange(copia);
    // Sigue en el mismo control; si al llegar al extremo se deshabilita, en el otro.
    const tipo = botones[indice];
    setEnfocar(direccion === -1 ? [`subir-${tipo}`, `bajar-${tipo}`] : [`bajar-${tipo}`, `subir-${tipo}`]);
  };

  const descripcion = (tipo: TipoBoton) => {
    if (tipo === "llamar") return "Abre el marcador con el teléfono del restaurante.";
    if (tipo === "ver_menu") return "Abre el menú de esta novedad (lo compones abajo).";
    return nombrePlato ? `Lleva a «${nombrePlato}» en la carta.` : "Lleva al plato enlazado en la carta.";
  };

  return (
    <section
      ref={raizRef}
      aria-labelledby="nov-botones-titulo"
      className="rounded-lg border p-3 sm:p-4 space-y-4"
      data-testid="bloque-botones-novedad"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            id="nov-botones-titulo"
            tabIndex={-1}
            data-foco="titulo"
            className="text-sm font-medium rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Botones
          </h3>
          <p className="text-xs text-muted-foreground">
            Opcional. Hasta {MAX_BOTONES} al pie de la tarjeta, en el orden de esta lista. La web pone el texto en
            cada idioma.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 tabular-nums font-normal">
          {botones.length}/{MAX_BOTONES}
        </Badge>
      </div>

      {botones.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          Sin botones: la tarjeta se ve como hasta ahora.
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Botones de la tarjeta, en orden">
          {botones.map((tipo, indice) => {
            const Icono = ICONO_BOTON[tipo];
            return (
              // En un móvil estrecho los controles pasan a una segunda línea en vez de
              // aplastar la descripción.
              <li key={tipo} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card p-2">
                <span
                  tabIndex={-1}
                  data-foco={`fila-${tipo}`}
                  className="flex min-w-[11rem] flex-1 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                    <Icono className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      <span className="sr-only">{`${indice + 1}. `}</span>
                      {ETIQUETA_BOTON[tipo]}
                    </span>
                    <span className="block text-xs text-muted-foreground break-words">{descripcion(tipo)}</span>
                  </span>
                </span>
                <div className="ml-auto flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    data-foco={`subir-${tipo}`}
                    disabled={indice === 0}
                    onClick={() => mover(indice, -1)}
                    aria-label={`Subir «${ETIQUETA_BOTON[tipo]}»`}
                  >
                    <ChevronUp className="h-5 w-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    data-foco={`bajar-${tipo}`}
                    disabled={indice === botones.length - 1}
                    onClick={() => mover(indice, 1)}
                    aria-label={`Bajar «${ETIQUETA_BOTON[tipo]}»`}
                  >
                    <ChevronDown className="h-5 w-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-destructive hover:text-destructive"
                    onClick={() => quitar(tipo)}
                    aria-label={`Quitar «${ETIQUETA_BOTON[tipo]}»`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {lleno ? (
        <p className="text-xs text-muted-foreground">Ya tiene los {MAX_BOTONES} botones. Quita uno para poner otro.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground" id="nov-botones-anadir">
            Añadir botón
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="nov-botones-anadir">
            {disponibles.map((tipo) => {
              const Icono = ICONO_BOTON[tipo];
              const sinPlato = tipo === "ver_plato" && !platoId;
              return (
                <Button
                  key={tipo}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 px-3"
                  disabled={sinPlato}
                  aria-describedby={sinPlato ? "nov-botones-ayuda-plato" : undefined}
                  onClick={() => añadir(tipo)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  <Icono className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  {ETIQUETA_BOTON[tipo]}
                </Button>
              );
            })}
          </div>
          {disponibles.includes("ver_plato") && !platoId && (
            <p id="nov-botones-ayuda-plato" className="text-xs text-muted-foreground">
              «Échale un vistazo» se puede añadir cuando enlaces un plato de la carta aquí debajo.
            </p>
          )}
        </div>
      )}

      {errorPlatos && (mostrarPlato || botones.includes("ver_menu")) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              No se ha podido cargar la carta: ahora no se puede enlazar un plato ni elegir platos «De la carta» para
              el menú.
            </p>
            {onReintentarPlatos && (
              <Button size="sm" variant="outline" className="h-11 bg-background" onClick={onReintentarPlatos}>
                Reintentar
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {mostrarPlato && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3" data-testid="plato-enlazado">
          <p className="text-sm font-medium">Plato de la carta</p>

          {platoId ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex min-w-[10rem] flex-1 items-center gap-2.5">
                {plato?.imagen_url ? (
                  <img
                    src={plato.imagen_url}
                    alt=""
                    loading="lazy"
                    className="h-11 w-11 shrink-0 rounded-md border object-cover bg-muted"
                    style={{ objectPosition: posicionImagen(plato.imagen_posicion_y) }}
                  />
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/40">
                    <UtensilsCrossed className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-medium break-words">
                    {nombrePlato ?? (cargandoPlatos ? "Cargando la carta..." : "Plato desconocido")}
                  </span>
                  {plato?.categoria && <span className="block text-xs text-muted-foreground">{plato.categoria}</span>}
                </span>
              </span>
              <div className="flex flex-wrap gap-1">
                <SelectorPlato
                  platos={platosEnCarta}
                  cargando={cargandoPlatos}
                  onElegir={(elegido) => onPlatoChange(elegido.id)}
                  etiqueta="Cambiar plato"
                  textoSinResultados="Ningún plato de la carta coincide."
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 px-3"
                  onClick={() => onPlatoChange(null)}
                  aria-label={nombrePlato ? `Quitar el enlace a «${nombrePlato}»` : "Quitar el enlace al plato"}
                >
                  <Unlink className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  Quitar enlace
                </Button>
              </div>
            </div>
          ) : (
            <SelectorPlato
              platos={platosEnCarta}
              cargando={cargandoPlatos}
              onElegir={(elegido) => onPlatoChange(elegido.id)}
              etiqueta="Enlazar un plato"
              textoSinResultados="Ningún plato de la carta coincide."
              disabled={!!errorPlatos}
            />
          )}

          {platoRetirado && (
            <p className="flex items-start gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-500" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                El plato ya no está en la carta
                <span className="block text-xs font-normal">
                  En la web no sale «Échale un vistazo». Enlaza otro plato o quita el botón.
                </span>
              </span>
            </p>
          )}

          {platoId && !tieneVerPlato && (
            <p className="text-xs text-muted-foreground">
              Añade «Échale un vistazo» para que la tarjeta lleve a este plato; sin el botón, el enlace no se guarda.
            </p>
          )}

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {TEXTO_AYUDA_PLATO}
          </p>
        </div>
      )}

      {botones.includes("ver_menu") && (
        <EditorMenuNovedad
          menu={menu}
          onChange={onMenuChange}
          platos={platos}
          platosPorId={platosPorId}
          cargandoPlatos={cargandoPlatos}
        />
      )}

      {errores.length > 0 && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          data-testid="errores-botones"
        >
          <p className="text-xs font-semibold">Para poder guardar:</p>
          <ul className="mt-1 space-y-1 text-sm">
            {errores.map((error) => (
              <li key={`${error.codigo}-${error.mensaje}`} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{error.mensaje}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
