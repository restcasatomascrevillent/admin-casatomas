import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

/**
 * Facturas › Productos: umbral del aviso automático de subida de precio
 * (migración 20261007170000, tabla `configuracion_facturas`). Si la migración
 * no está aplicada (no hay fila) no se pinta nada. Sin permiso de edición se
 * ve el valor pero no se cambia (la RLS lo impide igualmente).
 */
interface ConfigAvisos {
  umbral_subida_precio_pct: number;
  avisos_subida_precio: boolean;
}

const CLAVE = ["productos", "configuracion-avisos"];
// types.ts (a mano) no conoce aún la tabla nueva.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = () => (supabase.from as any)("configuracion_facturas");

export function AvisosPrecio({ puedeEditar, soloIcono = false }: { puedeEditar: boolean; soloIcono?: boolean }) {
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: CLAVE,
    queryFn: async (): Promise<ConfigAvisos | null> => {
      const { data, error } = await tabla().select("umbral_subida_precio_pct, avisos_subida_precio").maybeSingle();
      if (error) return null; // sin la migración: el control no aparece
      if (!data) return null;
      return { umbral_subida_precio_pct: Number(data.umbral_subida_precio_pct), avisos_subida_precio: !!data.avisos_subida_precio };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [umbral, setUmbral] = useState("");
  const [activos, setActivos] = useState(true);
  useEffect(() => {
    if (config.data) {
      setUmbral(String(config.data.umbral_subida_precio_pct).replace(".", ","));
      setActivos(config.data.avisos_subida_precio);
    }
  }, [config.data]);

  const valor = Number(umbral.replace(",", "."));
  const valido = umbral.trim() !== "" && Number.isFinite(valor) && valor > 0 && valor <= 500;

  const guardar = useMutation({
    mutationFn: async () => {
      const { data, error } = await tabla()
        .update({ umbral_subida_precio_pct: valor, avisos_subida_precio: activos })
        .eq("id", true)
        .select("id");
      if (error) throw error;
      if (Array.isArray(data) && data.length === 0) throw new Error("No tienes permiso para cambiar los avisos.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLAVE });
      toast.success("Avisos de precio guardados");
    },
    onError: (e) => toast.error("No se ha guardado", { description: mensajeUsuario(e) }),
  });

  if (!config.data) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {soloIcono ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label="Avisos de subida de precio"
            title={
              config.data.avisos_subida_precio
                ? `Avisos de precio: más de ${String(config.data.umbral_subida_precio_pct).replace(".", ",")} %`
                : "Avisos de precio: desactivados"
            }
          >
            <BellRing className={`h-4 w-4 ${config.data.avisos_subida_precio ? "" : "text-muted-foreground"}`} aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="outline" aria-label="Avisos de subida de precio">
            <BellRing className="mr-1 h-4 w-4" aria-hidden="true" />
            {config.data.avisos_subida_precio
              ? `Avisos > ${String(config.data.umbral_subida_precio_pct).replace(".", ",")} %`
              : "Avisos de precio: no"}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <p className="text-sm">
          Aviso en la campana cuando llega un producto más caro que su precio de referencia (media de las compras
          anteriores, sin IVA).
        </p>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="avisos-precio-activos">Avisar</Label>
          <Switch id="avisos-precio-activos" checked={activos} onCheckedChange={setActivos} disabled={!puedeEditar} />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="avisos-precio-umbral" className="flex-1">Si sube más de</Label>
          <Input
            id="avisos-precio-umbral"
            inputMode="decimal"
            value={umbral}
            onChange={(e) => setUmbral(e.target.value)}
            disabled={!puedeEditar || !activos}
            aria-invalid={!valido}
            className="w-20 text-right tabular-nums"
          />
          <span className="text-sm">%</span>
        </div>
        {puedeEditar && (
          <Button className="w-full" disabled={!valido || guardar.isPending} onClick={() => guardar.mutate()}>
            {guardar.isPending ? "Guardando…" : "Guardar"}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
