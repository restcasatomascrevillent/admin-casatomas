import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfDay, startOfWeek, startOfMonth, subDays, subWeeks, subMonths, format } from "date-fns";

interface VentasDiarias {
  fecha: string;
  num_pedidos: number;
  total_ventas: number;
  ticket_medio: number;
}

interface ProductoVendido {
  producto_id: string;
  producto_tipo: string;
  nombre_producto: string;
  unidades_vendidas: number;
  total_ingresos: number;
}

interface StockConsolidado {
  id: string;
  nombre: string;
  tipo: string;
  categoria: string | null;
  stock: number | null;
  precio_eur: number | null;
  activado: boolean | null;
}

export function useEcommerceStats() {
  // Ventas diarias
  const { data: ventasDiarias = [], isLoading: loadingVentas } = useQuery({
    queryKey: ["ecommerce-ventas-diarias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_ventas_diarias")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as VentasDiarias[];
    },
  });

  // Productos más vendidos
  const { data: productosVendidos = [], isLoading: loadingProductos } = useQuery({
    queryKey: ["ecommerce-productos-vendidos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_productos_vendidos")
        .select("*")
        .order("unidades_vendidas", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as ProductoVendido[];
    },
  });

  // Stock consolidado
  const { data: stockConsolidado = [], isLoading: loadingStock } = useQuery({
    queryKey: ["ecommerce-stock-consolidado"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_stock_consolidado")
        .select("*")
        .order("stock", { ascending: true });
      if (error) throw error;
      return data as StockConsolidado[];
    },
  });

  // Pedidos para estadísticas
  const { data: pedidos = [] } = useQuery({
    queryKey: ["ecommerce-pedidos-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedidos_ecommerce")
        .select("id, total, estado, created_at, pais_envio")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Calcular métricas
  const hoy = new Date();
  const inicioHoy = startOfDay(hoy);
  const inicioSemana = startOfWeek(hoy, { weekStartsOn: 1 });
  const inicioMes = startOfMonth(hoy);

  const pedidosActivos = pedidos.filter(p => !['cancelado', 'devuelto'].includes(p.estado || ''));

  const ventasHoy = pedidosActivos
    .filter(p => new Date(p.created_at || '') >= inicioHoy)
    .reduce((sum, p) => sum + (p.total || 0), 0);

  const ventasSemana = pedidosActivos
    .filter(p => new Date(p.created_at || '') >= inicioSemana)
    .reduce((sum, p) => sum + (p.total || 0), 0);

  const ventasMes = pedidosActivos
    .filter(p => new Date(p.created_at || '') >= inicioMes)
    .reduce((sum, p) => sum + (p.total || 0), 0);

  const numPedidosHoy = pedidosActivos.filter(p => new Date(p.created_at || '') >= inicioHoy).length;
  const numPedidosSemana = pedidosActivos.filter(p => new Date(p.created_at || '') >= inicioSemana).length;
  const numPedidosMes = pedidosActivos.filter(p => new Date(p.created_at || '') >= inicioMes).length;

  const ticketMedio = pedidosActivos.length > 0 
    ? pedidosActivos.reduce((sum, p) => sum + (p.total || 0), 0) / pedidosActivos.length 
    : 0;

  // Productos con stock bajo
  const stockBajo = stockConsolidado.filter(p => (p.stock || 0) <= 5 && p.activado);
  const sinStock = stockConsolidado.filter(p => (p.stock || 0) === 0 && p.activado);

  // Pedidos pendientes
  const pedidosPendientes = pedidos.filter(p => p.estado === 'pendiente').length;

  // Ventas por país
  const ventasPorPais = pedidosActivos.reduce((acc, p) => {
    const pais = p.pais_envio || 'Sin especificar';
    acc[pais] = (acc[pais] || 0) + (p.total || 0);
    return acc;
  }, {} as Record<string, number>);

  // Preparar datos para gráficos
  const datosGraficoVentas = ventasDiarias.slice(0, 14).reverse().map(v => ({
    fecha: format(new Date(v.fecha), 'dd/MM'),
    ventas: Number(v.total_ventas) || 0,
    pedidos: v.num_pedidos,
  }));

  return {
    // Loading states
    isLoading: loadingVentas || loadingProductos || loadingStock,
    
    // Métricas principales
    ventasHoy,
    ventasSemana,
    ventasMes,
    numPedidosHoy,
    numPedidosSemana,
    numPedidosMes,
    ticketMedio,
    
    // Stock
    stockBajo,
    sinStock,
    stockConsolidado,
    
    // Pedidos
    pedidosPendientes,
    totalPedidos: pedidos.length,
    
    // Rankings
    productosVendidos,
    ventasPorPais,
    
    // Datos gráficos
    datosGraficoVentas,
    ventasDiarias,
  };
}
