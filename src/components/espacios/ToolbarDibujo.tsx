import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  MousePointer,
  Minus,
  Square,
  Circle,
  DoorOpen,
  Frame,
  Trash2,
  Ruler,
  Focus,
  Undo2,
  Redo2,
  Hand,
  Layers,
  Spline,
  Check,
  X,
} from "lucide-react";

export type ToolType = "select" | "wall" | "area" | "mesa-rect" | "mesa-circular" | "door" | "room";

interface ToolbarDibujoProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
  showMeasurements?: boolean;
  onToggleMeasurements?: () => void;
  onCenterPlan?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  puedeDeshacer?: boolean;
  puedeRehacer?: boolean;
  /** Modo «mano»: alternativa táctil a Espacio+arrastrar. */
  modoMano?: boolean;
  onToggleModoMano?: () => void;
  /** Selección múltiple: alternativa táctil a Mayús+clic (para elegir dos mesas y unirlas). */
  seleccionMultiple?: boolean;
  onToggleSeleccionMultiple?: () => void;
  /** Paredes sin imán de ángulo: alternativa táctil a mantener Mayús. */
  anguloLibre?: boolean;
  onToggleAnguloLibre?: () => void;
  /** Puntos de la pared en curso (0 = ninguna). Con ≥ 2 se puede terminar. */
  puntosPared?: number;
  /** Cierra la pared en curso: sin ratón no hay doble clic. */
  onTerminarPared?: () => void;
  /** Descarta la pared (o sala) a medias: sin teclado no hay Esc. */
  onCancelarDibujo?: () => void;
}

interface ToolButton {
  id: ToolType;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  /** Segunda línea del tooltip (ratón). La misma idea sale SIEMPRE visible en la pista de debajo. */
  descripcion?: string;
}

// El número de la mesa (que vive en `mesas.nombre`) es el dato con el que el
// personal la identifica en la sala, así que la herramienta lo dice en claro:
// el que se pone al dibujar es solo el primer número libre y hay que
// corregirlo por el real.
const NUMERO_PROPUESTO = "Se numera con el primer número libre: corrígelo en el panel.";

const ICONO = "h-5 w-5";

const tools: ToolButton[] = [
  { id: "select", icon: <MousePointer className={ICONO} />, label: "Seleccionar", shortcut: "S" },
  {
    id: "room",
    icon: <Frame className={ICONO} />,
    label: "Sala",
    shortcut: "R",
    descripcion: "Arrastra en diagonal y se dibujan las 4 paredes de la sala de una vez.",
  },
  { id: "wall", icon: <Minus className={ICONO} />, label: "Pared", shortcut: "W" },
  { id: "area", icon: <Square className={ICONO} />, label: "Área", shortcut: "A" },
  { id: "mesa-rect", icon: <Square className={cn(ICONO, "fill-current")} />, label: "Mesa", shortcut: "M", descripcion: NUMERO_PROPUESTO },
  { id: "mesa-circular", icon: <Circle className={cn(ICONO, "fill-current")} />, label: "Redonda", shortcut: "C", descripcion: NUMERO_PROPUESTO },
  { id: "door", icon: <DoorOpen className={ICONO} />, label: "Puerta", shortcut: "D" },
];

/**
 * Pista SIEMPRE visible de la herramienta activa. Antes lo que no era obvio
 * (arrastrar para la sala, doble clic para cerrar la pared…) solo salía en un
 * tooltip de ratón, que en una tablet no existe.
 */
export function pistaDeHerramienta(tool: ToolType, puntosPared = 0): string {
  switch (tool) {
    case "select":
      return "Toca una mesa para seleccionarla y arrástrala para moverla. Dos dedos: acercar, alejar y mover el plano.";
    case "room":
      return "Arrastra en diagonal y se dibujan las 4 paredes de la sala.";
    case "wall":
      return puntosPared >= 2
        ? `${puntosPared} puntos puestos. Sigue tocando para continuar la pared o pulsa «Terminar pared».`
        : "Toca para poner cada punto de la pared; al acabar pulsa «Terminar pared».";
    case "area":
      return "Toca donde quieras colocar el área.";
    case "mesa-rect":
    case "mesa-circular":
      return "Toca para colocar una mesa; sigue activa para poner varias. Se numera con el primer número libre: corrígelo en el panel.";
    case "door":
      return "Toca sobre una pared para colocar la puerta.";
    default:
      return "";
  }
}

/** Botón de la barra: icono + etiqueta SIEMPRE visible, mínimo 44 px de lado. */
function BotonBarra({
  icono,
  etiqueta,
  activo,
  onClick,
  disabled,
  pulsado,
  destructivo,
  tooltip,
  descripcion,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  activo?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /** Para interruptores: `aria-pressed`. */
  pulsado?: boolean;
  destructivo?: boolean;
  tooltip?: React.ReactNode;
  descripcion?: string;
}) {
  const boton = (
    <Button
      type="button"
      variant={activo ? "default" : "ghost"}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pulsado}
      aria-label={etiqueta}
      className={cn(
        "h-14 min-w-[56px] touch-manipulation flex-col gap-1 px-2 py-1 text-xs font-medium leading-none",
        destructivo && "text-destructive hover:text-destructive",
        pulsado && !activo && "bg-secondary",
      )}
    >
      {icono}
      <span>{etiqueta}</span>
    </Button>
  );
  if (!tooltip && !descripcion) return boton;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{boton}</TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{tooltip ?? etiqueta}</p>
        {descripcion && <p className="text-xs text-muted-foreground max-w-56">{descripcion}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function Tecla({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground ml-1">({children})</span>;
}

export function ToolbarDibujo({
  activeTool,
  onToolChange,
  onDeleteSelected,
  hasSelection,
  showMeasurements = true,
  onToggleMeasurements,
  onCenterPlan,
  onUndo,
  onRedo,
  puedeDeshacer = false,
  puedeRehacer = false,
  modoMano = false,
  onToggleModoMano,
  seleccionMultiple = false,
  onToggleSeleccionMultiple,
  anguloLibre = false,
  onToggleAnguloLibre,
  puntosPared = 0,
  onTerminarPared,
  onCancelarDibujo,
}: ToolbarDibujoProps) {
  const hayHistorial = !!(onUndo || onRedo);
  const dibujandoPared = activeTool === "wall" && puntosPared > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-1 bg-card rounded-lg border p-2">
        {/* flex-wrap: en vertical (820 px) la barra baja a dos filas en vez de salirse de la pantalla */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1" role="toolbar" aria-label="Herramientas de dibujo">
          {tools.map((tool) => (
            <BotonBarra
              key={tool.id}
              icono={tool.icon}
              etiqueta={tool.label}
              activo={activeTool === tool.id}
              pulsado={activeTool === tool.id}
              onClick={() => onToolChange(tool.id)}
              tooltip={
                <>
                  {tool.label}
                  {tool.shortcut && <Tecla>{tool.shortcut}</Tecla>}
                </>
              }
              descripcion={tool.descripcion}
            />
          ))}

          <Separator orientation="vertical" className="h-10 mx-1 hidden sm:block" />

          {hayHistorial && (
            <>
              <BotonBarra
                icono={<Undo2 className={ICONO} />}
                etiqueta="Deshacer"
                onClick={onUndo}
                disabled={!puedeDeshacer}
                tooltip={
                  <>
                    Deshacer<Tecla>Ctrl+Z</Tecla>
                  </>
                }
              />
              <BotonBarra
                icono={<Redo2 className={ICONO} />}
                etiqueta="Rehacer"
                onClick={onRedo}
                disabled={!puedeRehacer}
                tooltip={
                  <>
                    Rehacer<Tecla>Ctrl+Shift+Z</Tecla>
                  </>
                }
              />
              <Separator orientation="vertical" className="h-10 mx-1 hidden sm:block" />
            </>
          )}

          {onToggleMeasurements && (
            <BotonBarra
              icono={<Ruler className={ICONO} />}
              etiqueta="Medidas"
              pulsado={showMeasurements}
              onClick={onToggleMeasurements}
              tooltip={showMeasurements ? "Ocultar medidas" : "Mostrar medidas"}
            />
          )}

          {onCenterPlan && (
            <BotonBarra
              icono={<Focus className={ICONO} />}
              etiqueta="Centrar"
              onClick={onCenterPlan}
              tooltip="Centrar plano"
            />
          )}

          {(onToggleModoMano || onToggleSeleccionMultiple || onToggleAnguloLibre) && (
            <Separator orientation="vertical" className="h-10 mx-1 hidden sm:block" />
          )}

          {onToggleModoMano && (
            <BotonBarra
              icono={<Hand className={ICONO} />}
              etiqueta="Mano"
              pulsado={modoMano}
              onClick={onToggleModoMano}
              tooltip={
                <>
                  Mover el plano arrastrando<Tecla>Espacio</Tecla>
                </>
              }
              descripcion="Con la mano activa, arrastrar con un dedo mueve el plano en vez de seleccionar o dibujar."
            />
          )}

          {onToggleSeleccionMultiple && (
            <BotonBarra
              icono={<Layers className={ICONO} />}
              etiqueta="Varias"
              pulsado={seleccionMultiple}
              onClick={onToggleSeleccionMultiple}
              tooltip={
                <>
                  Seleccionar varias mesas<Tecla>Mayús+clic</Tecla>
                </>
              }
              descripcion="Con «Varias» activo, tocar otra mesa la añade a la selección (por ejemplo para unir dos mesas)."
            />
          )}

          {onToggleAnguloLibre && (
            <BotonBarra
              icono={<Spline className={ICONO} />}
              etiqueta="Ángulo libre"
              pulsado={anguloLibre}
              onClick={onToggleAnguloLibre}
              tooltip={
                <>
                  Paredes sin imán de ángulo<Tecla>Mayús</Tecla>
                </>
              }
              descripcion="Por defecto las paredes se ajustan a pasos de 15°. Con esto activo salen en el ángulo exacto."
            />
          )}

          <Separator orientation="vertical" className="h-10 mx-1 hidden sm:block" />

          <BotonBarra
            icono={<Trash2 className={ICONO} />}
            etiqueta="Eliminar"
            onClick={onDeleteSelected}
            disabled={!hasSelection}
            destructivo
            tooltip={
              <>
                Eliminar selección<Tecla>Supr</Tecla>
              </>
            }
          />
        </div>

        {/* Pista de la herramienta activa (visible sin ratón) + acciones de la pared en curso */}
        <div className="flex flex-wrap items-center gap-2 px-1">
          <p className="min-w-[14rem] flex-1 text-sm text-muted-foreground" aria-live="polite">
            {pistaDeHerramienta(activeTool, puntosPared)}
            {activeTool !== "select" && " Vuelve a «Seleccionar» cuando termines."}
          </p>
          {dibujandoPared && (
            <div className="flex items-center gap-2">
              {onTerminarPared && (
                <Button
                  type="button"
                  className="h-11 touch-manipulation px-4"
                  onClick={onTerminarPared}
                  disabled={puntosPared < 2}
                >
                  <Check className="h-5 w-5 mr-2" />
                  Terminar pared
                </Button>
              )}
              {onCancelarDibujo && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 touch-manipulation px-4"
                  onClick={onCancelarDibujo}
                >
                  <X className="h-5 w-5 mr-2" />
                  Cancelar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
