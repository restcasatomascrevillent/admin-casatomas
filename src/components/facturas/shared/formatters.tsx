import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { Factura } from "@/hooks/useFacturas";

export const formatCurrency = (value: number | null): string => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
};

export const formatDate = (dateString: string | null): string => {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "dd/MM/yyyy", { locale: es });
  } catch {
    return dateString;
  }
};

export const formatDateTime = (dateString: string | null): string => {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "dd/MM/yyyy HH:mm", { locale: es });
  } catch {
    return dateString;
  }
};

export const truncateText = (text: string | null, maxLength: number = 40): string => {
  if (!text) return "-";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

export const getAnomaliaBadge = (doc: Factura, allDocs: Factura[]) => {
  const hasAnomalousProduct = doc.productos.some(p => {
    if (!p.precio_unitario) return false;
    const pastPrices = allDocs
      .flatMap(f => f.productos)
      .filter(past => past.id !== p.id && past.producto_nombre.toLowerCase() === p.producto_nombre.toLowerCase() && typeof past.precio_unitario === 'number')
      .map(past => past.precio_unitario as number);
    if (pastPrices.length === 0) return false;
    const avg = pastPrices.reduce((a, b) => a + b, 0) / pastPrices.length;
    return p.precio_unitario > avg * 2;
  });

  if (hasAnomalousProduct) {
    return <Badge variant="destructive" className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 text-[10px] px-1.5 py-0 gap-1 border-orange-200 shadow-none font-medium h-5"><AlertCircle className="h-3 w-3" /> Anomalía Precio</Badge>;
  }

  return null;
};
