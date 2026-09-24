import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { negocioDeMarca, normalizarMarca } from "@/lib/reservas/negocios";

// Insignia pequeña con el negocio de una reserva / solicitud / espacio
// ("Casa Tomás" | "Touza · El Reservado"). Ver src/lib/reservas/negocios.ts.
const CLASES_POR_MARCA: Record<string, string> = {
  casa_tomas: "border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300",
  touza: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
};

export function NegocioBadge({
  marca,
  corta = false,
  className,
}: {
  marca: string | null | undefined;
  /** Solo el nombre ("Touza") en vez de la etiqueta completa. */
  corta?: boolean;
  className?: string;
}) {
  const negocio = negocioDeMarca(marca);
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 whitespace-nowrap px-1.5 py-0 text-[10px] font-medium",
        CLASES_POR_MARCA[normalizarMarca(marca)] ?? "text-muted-foreground",
        className,
      )}
      title={`Negocio: ${negocio.etiqueta}`}
    >
      {corta ? negocio.nombre : negocio.etiqueta}
    </Badge>
  );
}
