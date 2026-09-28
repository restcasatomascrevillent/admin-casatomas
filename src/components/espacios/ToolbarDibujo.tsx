import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
}

interface ToolButton {
  id: ToolType;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  /** Segunda línea del tooltip, para explicar lo que no es obvio al pulsar. */
  descripcion?: string;
}

// El número de la mesa (que vive en `mesas.nombre`) es el dato con el que el
// personal la identifica en la sala, así que la herramienta lo dice en claro:
// el que se pone al dibujar es solo el primer número libre y hay que
// corregirlo por el real.
const NUMERO_PROPUESTO = "Se numera con el primer número libre: corrígelo en el panel de la derecha.";

const tools: ToolButton[] = [
  { id: "select", icon: <MousePointer className="h-4 w-4" />, label: "Seleccionar", shortcut: "S" },
  {
    id: "room",
    icon: <Frame className="h-4 w-4" />,
    label: "Sala rectangular",
    shortcut: "R",
    descripcion: "Arrastra en diagonal y se dibujan las 4 paredes de la sala de una vez.",
  },
  { id: "wall", icon: <Minus className="h-4 w-4" />, label: "Pared", shortcut: "W" },
  { id: "area", icon: <Square className="h-4 w-4" />, label: "Área", shortcut: "A" },
  { id: "mesa-rect", icon: <Square className="h-4 w-4 fill-current" />, label: "Mesa rectangular", shortcut: "M", descripcion: NUMERO_PROPUESTO },
  { id: "mesa-circular", icon: <Circle className="h-4 w-4 fill-current" />, label: "Mesa circular", shortcut: "C", descripcion: NUMERO_PROPUESTO },
  { id: "door", icon: <DoorOpen className="h-4 w-4" />, label: "Puerta", shortcut: "D" },
];

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
}: ToolbarDibujoProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1 bg-card rounded-lg border p-2">
        {tools.map((tool) => (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === tool.id ? "default" : "ghost"}
                size="sm"
                onClick={() => onToolChange(tool.id)}
                className="h-9 w-9 p-0"
              >
                {tool.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{tool.label} {tool.shortcut && <span className="text-muted-foreground ml-1">({tool.shortcut})</span>}</p>
              {tool.descripcion && (
                <p className="text-xs text-muted-foreground max-w-56">{tool.descripcion}</p>
              )}
            </TooltipContent>
          </Tooltip>
        ))}

        <Separator orientation="vertical" className="h-6 mx-2" />

        {(onUndo || onRedo) && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onUndo}
                  disabled={!puedeDeshacer}
                  className="h-9 w-9 p-0"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Deshacer <span className="text-muted-foreground ml-1">(Ctrl+Z)</span></p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRedo}
                  disabled={!puedeRehacer}
                  className="h-9 w-9 p-0"
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Rehacer <span className="text-muted-foreground ml-1">(Ctrl+Shift+Z)</span></p>
              </TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="h-6 mx-2" />
          </>
        )}

        {onToggleMeasurements && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showMeasurements ? "secondary" : "ghost"}
                size="sm"
                onClick={onToggleMeasurements}
                className="h-9 w-9 p-0"
              >
                <Ruler className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{showMeasurements ? "Ocultar medidas" : "Mostrar medidas"}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {onCenterPlan && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCenterPlan}
                className="h-9 w-9 p-0"
              >
                <Focus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Centrar plano</p>
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeleteSelected}
              disabled={!hasSelection}
              className="h-9 w-9 p-0 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Eliminar selección <span className="text-muted-foreground ml-1">(Del)</span></p>
          </TooltipContent>
        </Tooltip>

        <div className="ml-auto text-xs text-muted-foreground px-2">
          La herramienta sigue activa: coloca varios seguidos • Doble clic para terminar pared • Esc vuelve a Seleccionar
        </div>
      </div>
    </TooltipProvider>
  );
}
