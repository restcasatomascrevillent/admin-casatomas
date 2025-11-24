import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useDashboardFilters, DateRange } from "@/contexts/DashboardContext";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function DashboardFilters() {
  const { filters, updateFilters } = useDashboardFilters();

  const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: "hoy", label: "Hoy" },
    { value: "ayer", label: "Ayer" },
    { value: "7dias", label: "Últimos 7 días" },
    { value: "30dias", label: "Últimos 30 días" },
    { value: "mes", label: "Mes actual" },
    { value: "personalizado", label: "Personalizado" },
  ];

  return (
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
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={filters.customStartDate}
                    onSelect={(date) => updateFilters({ customStartDate: date })}
                    locale={es}
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
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={filters.customEndDate}
                    onSelect={(date) => updateFilters({ customEndDate: date })}
                    locale={es}
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
  );
}
