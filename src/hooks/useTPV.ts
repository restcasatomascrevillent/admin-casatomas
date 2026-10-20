import { useState, useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { desglosarIvaIncluido, redondearCentimos } from "@/config/fiscal";

export interface LineaTPV {
  producto_id: string;
  producto_tipo: 'bebida' | 'comida';
  nombre: string;
  precio: number;
  cantidad: number;
  descuento?: number;
  imagen_url?: string | null;
}

export interface TotalesTPV {
  subtotal: number;
  descuentoTotal: number;
  baseImponible: number;
  iva: number;
  total: number;
}

export type MetodoPago = 'efectivo' | 'tarjeta' | 'bizum' | 'mixto';

interface DatosPago {
  metodo: MetodoPago;
  importeRecibido?: number;
  detallesMixto?: {
    efectivo?: number;
    tarjeta?: number;
    bizum?: number;
  };
}

export function useTPV() {
  const queryClient = useQueryClient();
  
  const [lineas, setLineas] = useState<LineaTPV[]>([]);
  const [descuentoGlobal, setDescuentoGlobal] = useState(0);
  const [caja, setCaja] = useState("CAJA-1");

  // Generar número de ticket único
  const generarNumeroTicket = useCallback(async (): Promise<string> => {
    const fecha = format(new Date(), 'yyyyMMdd');
    const prefijo = `TPV-${fecha}`;
    
    // Buscar el último ticket del día
    const { data } = await supabase
      .from("pedidos_ecommerce")
      .select("numero_ticket")
      .like("numero_ticket", `${prefijo}%`)
      .order("numero_ticket", { ascending: false })
      .limit(1);
    
    let siguiente = 1;
    if (data && data.length > 0 && data[0].numero_ticket) {
      const ultimo = data[0].numero_ticket;
      const numParte = ultimo.split('-').pop();
      if (numParte) {
        siguiente = parseInt(numParte, 10) + 1;
      }
    }
    
    return `${prefijo}-${String(siguiente).padStart(3, '0')}`;
  }, []);

  // Añadir producto al carrito
  const addProducto = useCallback((producto: Omit<LineaTPV, 'cantidad'>) => {
    setLineas(prev => {
      const existente = prev.findIndex(
        l => l.producto_id === producto.producto_id && l.producto_tipo === producto.producto_tipo
      );
      
      if (existente >= 0) {
        const nuevas = [...prev];
        nuevas[existente] = {
          ...nuevas[existente],
          cantidad: nuevas[existente].cantidad + 1
        };
        return nuevas;
      }
      
      return [...prev, { ...producto, cantidad: 1 }];
    });
  }, []);

  // Eliminar línea
  const removeLinea = useCallback((index: number) => {
    setLineas(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Actualizar cantidad
  const updateCantidad = useCallback((index: number, cantidad: number) => {
    if (cantidad < 1) {
      removeLinea(index);
      return;
    }
    setLineas(prev => {
      const nuevas = [...prev];
      nuevas[index] = { ...nuevas[index], cantidad };
      return nuevas;
    });
  }, [removeLinea]);

  // Aplicar descuento a línea específica
  const aplicarDescuentoLinea = useCallback((index: number, descuento: number) => {
    setLineas(prev => {
      const nuevas = [...prev];
      nuevas[index] = { ...nuevas[index], descuento: Math.min(100, Math.max(0, descuento)) };
      return nuevas;
    });
  }, []);

  // Calcular totales
  // Los precios de ComidaVENTA / BebidasVENTA son PVP: ya llevan el IVA incluido.
  // Por eso el importe de las líneas es lo que paga el cliente (total) y el IVA
  // se desglosa hacia atrás; sumarlo encima cobraría de más.
  const totales = useMemo((): TotalesTPV => {
    const subtotalBruto = lineas.reduce((acc, linea) => {
      const precioLinea = linea.precio * linea.cantidad;
      const descuentoLinea = linea.descuento ? (precioLinea * linea.descuento / 100) : 0;
      return acc + (precioLinea - descuentoLinea);
    }, 0);

    // Se redondea antes de desglosar para que el ticket cuadre también en la
    // resta de arriba: subtotal - descuento === total.
    const subtotal = redondearCentimos(subtotalBruto);
    const descuentoTotal = redondearCentimos(subtotalBruto * descuentoGlobal / 100);
    const { baseImponible, iva, total } = desglosarIvaIncluido(subtotal - descuentoTotal);

    return {
      subtotal,
      descuentoTotal,
      baseImponible,
      iva,
      total,
    };
  }, [lineas, descuentoGlobal]);

  // Calcular cambio
  const calcularCambio = useCallback((importeRecibido: number): number => {
    return redondearCentimos(Math.max(0, importeRecibido - totales.total));
  }, [totales.total]);

  // Limpiar carrito
  const cancelar = useCallback(() => {
    setLineas([]);
    setDescuentoGlobal(0);
  }, []);

  // Finalizar venta
  const finalizarVenta = useMutation({
    mutationFn: async (datosPago: DatosPago) => {
      if (lineas.length === 0) {
        throw new Error("El carrito está vacío");
      }

      const { data: user } = await supabase.auth.getUser();
      if (!user?.user?.id) {
        throw new Error("Debes iniciar sesión para realizar ventas");
      }

      const numeroTicket = await generarNumeroTicket();
      const numeroPedido = `PED-${Date.now()}`;

      // Crear pedido
      const { data: pedido, error: pedidoError } = await supabase
        .from("pedidos_ecommerce")
        .insert([{
          numero_pedido: numeroPedido,
          tipo_venta: 'presencial',
          vendedor_id: user.user.id,
          caja,
          numero_ticket: numeroTicket,
          // `subtotal` guarda la base imponible (sin IVA); `total` es el PVP que
          // paga el cliente. Con el desglose hacia atrás se cumple siempre
          // subtotal + iva === total.
          subtotal: totales.baseImponible,
          iva: totales.iva,
          total: totales.total,
          descuento: totales.descuentoTotal,
          estado: 'entregado',
          pagado: true,
          fecha_pago: new Date().toISOString(),
          fecha_entrega: new Date().toISOString(),
          metodo_pago: datosPago.metodo,
          notas_internas: datosPago.metodo === 'efectivo' && datosPago.importeRecibido 
            ? `Recibido: ${datosPago.importeRecibido}€ - Cambio: ${calcularCambio(datosPago.importeRecibido)}€`
            : datosPago.metodo === 'mixto' && datosPago.detallesMixto
            ? `Mixto: Efectivo ${datosPago.detallesMixto.efectivo || 0}€, Tarjeta ${datosPago.detallesMixto.tarjeta || 0}€, Bizum ${datosPago.detallesMixto.bizum || 0}€`
            : undefined,
        }])
        .select()
        .single();

      if (pedidoError) throw pedidoError;

      // Crear líneas de pedido
      const lineasPedido = lineas.map(linea => ({
        pedido_id: pedido.id,
        producto_id: linea.producto_id,
        producto_tipo: linea.producto_tipo,
        nombre_producto: linea.nombre,
        cantidad: linea.cantidad,
        precio_unitario: linea.precio,
        total_linea: redondearCentimos(
          linea.precio * linea.cantidad * (1 - (linea.descuento || 0) / 100)
        ),
      }));

      const { error: lineasError } = await supabase
        .from("lineas_pedido")
        .insert(lineasPedido);

      if (lineasError) throw lineasError;

      // Actualizar stock de cada producto
      for (const linea of lineas) {
        const tabla = linea.producto_tipo === 'bebida' ? 'BebidasVENTA' : 'ComidaVENTA';
        
        // Obtener stock actual
        const { data: producto } = await supabase
          .from(tabla)
          .select("stock")
          .eq("id", linea.producto_id)
          .single();

        const stockAnterior = producto?.stock || 0;
        const stockNuevo = Math.max(0, stockAnterior - linea.cantidad);

        // Actualizar stock
        await supabase
          .from(tabla)
          .update({ stock: stockNuevo })
          .eq("id", linea.producto_id);

        // Registrar movimiento
        await supabase
          .from("movimientos_stock")
          .insert([{
            producto_id: linea.producto_id,
            producto_tipo: linea.producto_tipo,
            tipo_movimiento: 'venta',
            cantidad: linea.cantidad,
            stock_anterior: stockAnterior,
            stock_nuevo: stockNuevo,
            motivo: 'Venta TPV',
            referencia: numeroTicket,
            usuario_id: user.user.id,
          }]);
      }

      return {
        pedido,
        numeroTicket,
        totales,
        lineas: [...lineas],
        metodoPago: datosPago.metodo,
        importeRecibido: datosPago.importeRecibido,
        cambio: datosPago.importeRecibido ? calcularCambio(datosPago.importeRecibido) : 0,
        vendedor: user.user.email,
        fecha: new Date(),
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pedidos-ecommerce"] });
      queryClient.invalidateQueries({ queryKey: ["bebidas-venta"] });
      queryClient.invalidateQueries({ queryKey: ["comida-venta"] });
      queryClient.invalidateQueries({ queryKey: ["movimientos-stock"] });
      queryClient.invalidateQueries({ queryKey: ["ecommerce-stock-consolidado"] });
      toast.success("Venta completada", {
        description:
          `Ticket ${data.numeroTicket} · ${data.totales.total.toFixed(2)}€` +
          (data.cambio > 0 ? ` · Cambio ${data.cambio.toFixed(2)}€` : ""),
      });
      cancelar();
    },
    onError: (error) => {
      toast.error("No se pudo completar la venta", { description: error.message });
    },
  });

  return {
    // Estado
    lineas,
    descuentoGlobal,
    caja,
    totales,
    
    // Acciones carrito
    addProducto,
    removeLinea,
    updateCantidad,
    aplicarDescuentoLinea,
    setDescuentoGlobal,
    setCaja,
    cancelar,
    
    // Cálculos
    calcularCambio,
    
    // Venta
    finalizarVenta,
    isProcessing: finalizarVenta.isPending,
  };
}
