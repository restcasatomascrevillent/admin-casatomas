import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ruler } from "lucide-react";

interface ConfiguracionEscalaProps {
  realDimensions: { width: number; height: number };
  onApply: (width: number, height: number) => void;
}

export function ConfiguracionEscala({ realDimensions, onApply }: ConfiguracionEscalaProps) {
  const [width, setWidth] = useState(realDimensions.width);
  const [height, setHeight] = useState(realDimensions.height);

  const handleApply = () => {
    if (width > 0 && height > 0) {
      onApply(width, height);
    }
  };

  return (
    <div className="flex items-center gap-4 bg-card rounded-lg border p-3">
      <Ruler className="h-5 w-5 text-muted-foreground" />
      <span className="text-sm font-medium">Dimensiones reales:</span>
      
      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">Ancho</Label>
        <Input
          type="number"
          min={1}
          max={100}
          step={0.5}
          className="w-20 h-8"
          value={width}
          onChange={(e) => setWidth(parseFloat(e.target.value) || 1)}
        />
        <span className="text-sm text-muted-foreground">m</span>
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">Alto</Label>
        <Input
          type="number"
          min={1}
          max={100}
          step={0.5}
          className="w-20 h-8"
          value={height}
          onChange={(e) => setHeight(parseFloat(e.target.value) || 1)}
        />
        <span className="text-sm text-muted-foreground">m</span>
      </div>

      <Button size="sm" onClick={handleApply}>
        Aplicar Escala
      </Button>

      <div className="ml-auto text-sm text-muted-foreground">
        Área: <span className="font-medium">{(width * height).toFixed(1)} m²</span>
      </div>
    </div>
  );
}
