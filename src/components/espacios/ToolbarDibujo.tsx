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
  Trash2,
  Ruler,
  Maximize,
} from "lucide-react";

export type ToolType = "select" | "wall" | "area" | "mesa-rect" | "mesa-circular" | "door";

interface ToolbarDibujoProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
  showMeasurements?: boolean;
  onToggleMeasurements?: () => void;
  onAutoFit?: () => void;
}

interface ToolButton {
  id: ToolType;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

const tools: ToolButton[] = [
  { id: "select", icon: <MousePointer className="h-4 w-4" />, label: "Seleccionar", shortcut: "S" },
  { id: "wall", icon: <Minus className="h-4 w-4" />, label: "Pared", shortcut: "W" },
  { id: "area", icon: <Square className="h-4 w-4" />, label: "Área", shortcut: "A" },
  { id: "mesa-rect", icon: <Square className="h-4 w-4 fill-current" />, label: "Mesa rectangular", shortcut: "M" },
  { id: "mesa-circular", icon: <Circle className="h-4 w-4 fill-current" />, label: "Mesa circular", shortcut: "C" },
  { id: "door", icon: <DoorOpen className="h-4 w-4" />, label: "Puerta", shortcut: "D" },
];

export function ToolbarDibujo({ 
  activeTool, 
  onToolChange, 
  onDeleteSelected, 
  hasSelection,
  showMeasurements = true,
  onToggleMeasurements,
  onAutoFit,
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
            </TooltipContent>
          </Tooltip>
        ))}

        <Separator orientation="vertical" className="h-6 mx-2" />

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

        {onAutoFit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onAutoFit}
                className="h-9 w-9 p-0"
              >
                <Maximize className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Centrar <span className="text-muted-foreground ml-1">(F)</span></p>
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
          Clic para añadir • Doble clic para terminar pared • Esc para cancelar
        </div>
      </div>
    </TooltipProvider>
  );
}
