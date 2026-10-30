import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export interface MovimientoStock {
  id: string;
  producto_id: string;
  producto_tipo: string;
  tipo_movimiento: string;
  cantidad: number;
  stock_anterior: number | null;
  stock_nuevo: number | null;
  motivo: string | null;
  referencia: string | null;
  usuario_id: string | null;
  created_at: string | null;
}

export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'venta' | 'devolucion';

export function useMovimientosStock(productoId?: string, productoTipo?: string) {
  const queryClient = useQueryClient();

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey: ["movimientos-stock", productoId, productoTipo],
    queryFn: async () => {
      let query = supabase
        .from("movimientos_stock")
        .select("*")
        .order("created_at", { ascending: false });

      if (productoId) {
        query = query.eq("producto_id", productoId);
      }
      if (productoTipo) {
        query = query.eq("producto_tipo", productoTipo);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data as MovimientoStock[];
    },
  });

  const registrarMovimiento = useMutation({
    mutationFn: async ({
      productoId,
      productoTipo,
      tipoMovimiento,
      cantidad,
      motivo,
      referencia,
    }: {
      productoId: string;
      productoTipo: 'bebida' | 'comida';
      tipoMovimiento: TipoMovimiento;
      cantidad: number;
      motivo?: string;
      referencia?: string;
    }) => {
      // Obtener stock actual
      const tabla = productoTipo === 'bebida' ? 'BebidasVENTA' : 'ComidaVENTA';
      const { data: producto, error: prodError } = await supabase
        .from(tabla)
        .select("stock")
        .eq("id", productoId)
        .single();

      if (prodError) throw prodError;

      const stockAnterior = producto?.stock || 0;
      let stockNuevo = stockAnterior;

      // Calcular nuevo stock según tipo
      if (tipoMovimiento === 'entrada' || tipoMovimiento === 'devolucion') {
        stockNuevo = stockAnterior + cantidad;
      } else if (tipoMovimiento === 'salida' || tipoMovimiento === 'venta') {
        stockNuevo = Math.max(0, stockAnterior - cantidad);
      } else if (tipoMovimiento === 'ajuste') {
        stockNuevo = cantidad; // El ajuste establece el valor directamente
      }

      // Actualizar stock del producto
      const { error: updateError } = await supabase
        .from(tabla)
        .update({ stock: stockNuevo })
        .eq("id", productoId);

      if (updateError) throw updateError;

      // Registrar movimiento
      const { data: user } = await supabase.auth.getUser();
      
      const { error: movError } = await supabase
        .from("movimientos_stock")
        .insert([{
          producto_id: productoId,
          producto_tipo: productoTipo,
          tipo_movimiento: tipoMovimiento,
          cantidad: tipoMovimiento === 'ajuste' ? cantidad : Math.abs(cantidad),
          stock_anterior: stockAnterior,
          stock_nuevo: stockNuevo,
          motivo,
          referencia,
          usuario_id: user?.user?.id,
        }]);

      if (movError) throw movError;

      return { stockAnterior, stockNuevo };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["movimientos-stock"] });
      queryClient.invalidateQueries({ queryKey: ["bebidas-venta"] });
      queryClient.invalidateQueries({ queryKey: ["comida-venta"] });
      queryClient.invalidateQueries({ queryKey: ["ecommerce-stock-consolidado"] });
      toast.success("Stock actualizado", {
        description: `De ${data.stockAnterior} a ${data.stockNuevo} unidades.`,
      });
    },
    onError: (error) => {
      toast.error("No se pudo actualizar el stock", { description: mensajeUsuario(error) });
    },
  });

  const ajustarStock = (
    productoId: string,
    productoTipo: 'bebida' | 'comida',
    nuevoStock: number,
    motivo?: string
  ) => {
    return registrarMovimiento.mutateAsync({
      productoId,
      productoTipo,
      tipoMovimiento: 'ajuste',
      cantidad: nuevoStock,
      motivo: motivo || 'Ajuste manual de inventario',
    });
  };

  const agregarStock = (
    productoId: string,
    productoTipo: 'bebida' | 'comida',
    cantidad: number,
    motivo?: string
  ) => {
    return registrarMovimiento.mutateAsync({
      productoId,
      productoTipo,
      tipoMovimiento: 'entrada',
      cantidad,
      motivo: motivo || 'Entrada de mercancía',
    });
  };

  const retirarStock = (
    productoId: string,
    productoTipo: 'bebida' | 'comida',
    cantidad: number,
    motivo?: string
  ) => {
    return registrarMovimiento.mutateAsync({
      productoId,
      productoTipo,
      tipoMovimiento: 'salida',
      cantidad,
      motivo: motivo || 'Salida de mercancía',
    });
  };

  return {
    movimientos,
    isLoading,
    registrarMovimiento,
    ajustarStock,
    agregarStock,
    retirarStock,
  };
}
