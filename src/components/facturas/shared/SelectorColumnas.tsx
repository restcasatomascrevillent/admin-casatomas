import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";

export type ColumnaType = {
  key: string;
  label: string;
};

export const SelectorColumnas = ({
  columnas,
  visibles,
  onChange,
}: {
  columnas: ColumnaType[];
  visibles: Record<string, boolean>;
  onChange: (key: string, checked: boolean) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="gap-1.5 border-border/50 shadow-sm hover:bg-muted/50 transition-colors">
        <Settings2 className="h-4 w-4" />
        Columnas
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-52" align="end">
      <p className="text-sm font-medium mb-3">Columnas visibles</p>
      <div className="space-y-2">
        {columnas.map((col) => (
          <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={visibles[col.key]}
              onCheckedChange={(checked) => onChange(col.key, !!checked)}
            />
            {col.label}
          </label>
        ))}
      </div>
    </PopoverContent>
  </Popover>
);
