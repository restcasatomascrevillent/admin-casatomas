import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface PedidoEcommerce {
  id: string;
  numero_pedido: string;
  user_id: string | null;
  email: string | null;
  telefono: string | null;
  nombre_completo: string | null;
  direccion_envio: string | null;
  ciudad_envio: string | null;
  codigo_postal_envio: string | null;
  pais_envio: string | null;
  subtotal: number;
  gastos_envio: number | null;
  descuento: number | null;
  iva: number | null;
  total: number;
  estado: string | null;
  metodo_pago: string | null;
  referencia_pago: string | null;
  pagado: boolean | null;
  fecha_pago: string | null;
  transportista: string | null;
  numero_seguimiento: string | null;
  fecha_envio: string | null;
  fecha_entrega: string | null;
  notas_cliente: string | null;
  notas_internas: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LineaPedido {
  id: string;
  pedido_id: string;
  producto_id: string;
  producto_tipo: string;
  nombre_producto: string;
  cantidad: number;
  precio_unitario: number;
  total_linea: number;
  created_at: string | null;
}

export type PedidoInsert = Omit<PedidoEcommerce, "id" | "created_at" | "updated_at">;

const ESTADOS_PEDIDO = [
  'pendiente',
  'confirmado', 
  'preparando',
  'enviado',
  'entregado',
  'cancelado',
  'devuelto'
] as const;

export type EstadoPedido = typeof ESTADOS_PEDIDO[number];

export function usePedidosEcommerce(filtros?: {
  estado?: string;
  fechaDesde?: string;
  fechaHasta?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ["pedidos-ecommerce", filtros],
    queryFn: async () => {
      let query = supabase
        .from("pedidos_ecommerce")
        .select("*")
        .order("created_at", { ascending: false });

      if (filtros?.estado && filtros.estado !== "all") {
        query = query.eq("estado", filtros.estado);
      }
      if (filtros?.fechaDesde) {
        query = query.gte("created_at", filtros.fechaDesde);
      }
      if (filtros?.fechaHasta) {
        query = query.lte("created_at", filtros.fechaHasta);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PedidoEcommerce[];
    },
  });

  const getLineasPedido = async (pedidoId: string): Promise<LineaPedido[]> => {
    const { data, error } = await supabase
      .from("lineas_pedido")
      .select("*")
      .eq("pedido_id", pedidoId);
    if (error) throw error;
    return data as LineaPedido[];
  };

  const addPedido = useMutation({
    mutationFn: async (pedido: PedidoInsert & { lineas: Omit<LineaPedido, "id" | "pedido_id" | "created_at">[] }) => {
      const { lineas, ...pedidoData } = pedido;
      
      const { data: nuevoPedido, error: pedidoError } = await supabase
        .from("pedidos_ecommerce")
        .insert([pedidoData])
        .select()
        .single();
      
      if (pedidoError) throw pedidoError;

      if (lineas.length > 0) {
        const lineasConPedido = lineas.map(l => ({
          ...l,
          pedido_id: nuevoPedido.id
        }));
        
        const { error: lineasError } = await supabase
          .from("lineas_pedido")
          .insert(lineasConPedido);
        
        if (lineasError) throw lineasError;
      }

      return nuevoPedido;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pedidos-ecommerce"] });
      toast({ title: "Pedido creado correctamente" });
    },
    onError: (error) => {
      toast({ title: "Error al crear pedido", description: error.message, variant: "destructive" });
    },
  });

  const updatePedido = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PedidoEcommerce> & { id: string }) => {
      const { error } = await supabase
        .from("pedidos_ecommerce")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pedidos-ecommerce"] });
      toast({ title: "Pedido actualizado" });
    },
    onError: (error) => {
      toast({ title: "Error al actualizar", description: error.message, variant: "destructive" });
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: EstadoPedido }) => {
      const updates: Partial<PedidoEcommerce> = { estado };
      
      if (estado === 'enviado') {
        updates.fecha_envio = new Date().toISOString();
      } else if (estado === 'entregado') {
        updates.fecha_entrega = new Date().toISOString();
      }

      const { error } = await supabase
        .from("pedidos_ecommerce")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pedidos-ecommerce"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error) => {
      toast({ title: "Error al cambiar estado", description: error.message, variant: "destructive" });
    },
  });

  const deletePedido = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pedidos_ecommerce")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pedidos-ecommerce"] });
      toast({ title: "Pedido eliminado" });
    },
    onError: (error) => {
      toast({ title: "Error al eliminar", description: error.message, variant: "destructive" });
    },
  });

  // Estadísticas rápidas
  const pedidosPendientes = pedidos.filter(p => p.estado === 'pendiente').length;
  const pedidosHoy = pedidos.filter(p => {
    const hoy = new Date().toISOString().split('T')[0];
    return p.created_at?.startsWith(hoy);
  }).length;

  return {
    pedidos,
    isLoading,
    pedidosPendientes,
    pedidosHoy,
    getLineasPedido,
    addPedido,
    updatePedido,
    cambiarEstado,
    deletePedido,
    ESTADOS_PEDIDO,
  };
}
