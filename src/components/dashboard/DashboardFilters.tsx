import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDashboardFilters, DateRange } from "@/contexts/DashboardContext";
import { CalendarIcon, ChevronDown, Filter } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function DashboardFilters() {
  const { filters, updateFilters } = useDashboardFilters();
  const [isOpen, setIsOpen] = useState(false);

  const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: "hoy", label: "Hoy" },
    { value: "ayer", label: "Ayer" },
    { value: "7dias", label: "Últimos 7 días" },
    { value: "30dias", label: "Últimos 30 días" },
    { value: "mes", label: "Mes actual" },
    { value: "personalizado", label: "Personalizado" },
  ];

  const getRangeLabel = () => {
    const option = dateRangeOptions.find((o) => o.value === filters.dateRange);
    return option?.label || "Seleccionar período";
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between">
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            Filtros: {getRangeLabel()}
            <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="mt-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">Período</Label>
              <Select value={filters.dateRange} onValueChange={(value: DateRange) => updateFilters({ dateRange: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dateRangeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filters.dateRange === "personalizado" && (
              <>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Fecha inicio</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.customStartDate
                          ? format(filters.customStartDate, "PPP", { locale: es })
                          : "Seleccionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.customStartDate}
                        onSelect={(date) => updateFilters({ customStartDate: date })}
                        locale={es}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">Fecha fin</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.customEndDate
                          ? format(filters.customEndDate, "PPP", { locale: es })
                          : "Seleccionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.customEndDate}
                        onSelect={(date) => updateFilters({ customEndDate: date })}
                        locale={es}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}

            <div>
              <Label className="text-sm font-medium mb-2 block">Servicio</Label>
              <Select value={filters.service} onValueChange={(value: any) => updateFilters({ service: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="comida">Comida</SelectItem>
                  <SelectItem value="cena">Cena</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Rol</Label>
              <Select value={filters.role} onValueChange={(value: any) => updateFilters({ role: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="cocina">Cocina</SelectItem>
                  <SelectItem value="sala">Sala</SelectItem>
                  <SelectItem value="otros">Otros</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="compare"
              checked={filters.compareWithPrevious}
              onCheckedChange={(checked) => updateFilters({ compareWithPrevious: !!checked })}
            />
            <Label htmlFor="compare" className="text-sm cursor-pointer">
              Comparar con período anterior
            </Label>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
