import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { reservaDeAviso } from "@/lib/avisos";
import { infoEstadoReserva } from "@/lib/reservas/estadosReserva";

// ============================================================================
// El estado ACTUAL de las reservas de una lista de avisos (12/11/2026, petición
// del dueño: «que aparezca en avisos si está pendiente, verificada o
// confirmada»). Una sola consulta por lista (los ids de sus avisos de reserva).
// Clave con el prefijo "reservas-lista": verificar, confirmar o cancelar desde
// la ficha la refresca al momento.
// ============================================================================

type AvisoConReserva = { referencia_tipo?: string | null; referencia_id?: string | null };

export function useEstadosReservasAvisos(avisos: readonly AvisoConReserva[]): ReadonlyMap<string, string> {
  const ids = useMemo(() => [...new Set(avisos.map(reservaDeAviso).filter((x): x is string => !!x))].sort(), [avisos]);
  const { data } = useQuery({
    queryKey: ["reservas-lista", "estados-avisos", ids],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("reservas").select("id, estado").in("id", ids);
      if (error) throw error;
      return new Map(((data ?? []) as Array<{ id: string; estado: string }>).map((r) => [r.id, r.estado]));
    },
  });
  return data ?? new Map();
}

/** Insignia del estado de la reserva de un aviso («Pendiente», «Verificada», «Confirmada»…). Nada si no es de reserva. */
export function EstadoReservaAviso({ aviso, estados, className }: { aviso: AvisoConReserva; estados: ReadonlyMap<string, string>; className?: string }) {
  const id = reservaDeAviso(aviso);
  const info = id ? infoEstadoReserva(estados.get(id)) : undefined;
  if (!info) return null;
  return (
    <Badge className={cn("shrink-0 px-1.5 py-0 text-xs leading-5", info.insignia, className)} variant={info.varianteInsignia} data-testid="estado-reserva-aviso">
      {info.etiqueta}
    </Badge>
  );
}
