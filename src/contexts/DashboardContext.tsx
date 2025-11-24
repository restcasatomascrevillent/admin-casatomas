import { createContext, useContext, useState, ReactNode } from "react";
import { startOfMonth, endOfDay, startOfDay, subDays } from "date-fns";

export type DateRange = "hoy" | "ayer" | "7dias" | "30dias" | "mes" | "personalizado";
export type ServiceFilter = "todos" | "comida" | "cena";
export type RoleFilter = "todos" | "cocina" | "sala" | "otros";

interface DashboardFilters {
  dateRange: DateRange;
  customStartDate?: Date;
  customEndDate?: Date;
  service: ServiceFilter;
  role: RoleFilter;
  compareWithPrevious: boolean;
}

interface DashboardContextType {
  filters: DashboardFilters;
  updateFilters: (filters: Partial<DashboardFilters>) => void;
  getDateRange: () => { start: Date; end: Date };
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<DashboardFilters>({
    dateRange: "mes",
    service: "todos",
    role: "todos",
    compareWithPrevious: false,
  });

  const updateFilters = (newFilters: Partial<DashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const getDateRange = () => {
    const now = new Date();
    let start: Date;
    let end: Date = endOfDay(now);

    switch (filters.dateRange) {
      case "hoy":
        start = startOfDay(now);
        break;
      case "ayer":
        start = startOfDay(subDays(now, 1));
        end = endOfDay(subDays(now, 1));
        break;
      case "7dias":
        start = startOfDay(subDays(now, 6));
        break;
      case "30dias":
        start = startOfDay(subDays(now, 29));
        break;
      case "mes":
        start = startOfMonth(now);
        break;
      case "personalizado":
        start = filters.customStartDate || startOfMonth(now);
        end = filters.customEndDate || endOfDay(now);
        break;
      default:
        start = startOfMonth(now);
    }

    return { start, end };
  };

  return (
    <DashboardContext.Provider value={{ filters, updateFilters, getDateRange }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboardFilters() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboardFilters must be used within DashboardProvider");
  }
  return context;
}
