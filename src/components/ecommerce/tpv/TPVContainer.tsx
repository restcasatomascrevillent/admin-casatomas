import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ProductoPicker } from "./ProductoPicker";
import { CarritoTPV } from "./CarritoTPV";
import { MetodoPagoModal } from "./MetodoPagoModal";
import { TicketImprimible } from "./TicketImprimible";
import { useTPV, MetodoPago } from "@/hooks/useTPV";
import { ShoppingCart, X, Printer, Receipt } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function TPVContainer() {
  const {
    lineas,
    descuentoGlobal,
    totales,
    addProducto,
    removeLinea,
    updateCantidad,
    aplicarDescuentoLinea,
    setDescuentoGlobal,
    cancelar,
    finalizarVenta,
    isProcessing,
  } = useTPV();

  const [modalPagoOpen, setModalPagoOpen] = useState(false);
  const [ticketData, setTicketData] = useState<{
    numeroTicket: string;
    lineas: typeof lineas;
    totales: typeof totales;
    metodoPago: MetodoPago;
    importeRecibido?: number;
    cambio?: number;
    vendedor?: string;
    fecha: Date;
  } | null>(null);

  const ticketRef = useRef<HTMLDivElement>(null);

  const handleCobrar = () => {
    if (lineas.length === 0) return;
    setModalPagoOpen(true);
  };

  const handleConfirmarPago = async (datos: {
    metodo: MetodoPago;
    importeRecibido?: number;
    detallesMixto?: { efectivo?: number; tarjeta?: number; bizum?: number };
  }) => {
    try {
      const resultado = await finalizarVenta.mutateAsync(datos);
      setModalPagoOpen(false);
      setTicketData({
        numeroTicket: resultado.numeroTicket,
        lineas: resultado.lineas,
        totales: resultado.totales,
        metodoPago: resultado.metodoPago,
        importeRecibido: resultado.importeRecibido,
        cambio: resultado.cambio,
        vendedor: resultado.vendedor,
        fecha: resultado.fecha,
      });
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleImprimir = () => {
    window.print();
  };

  const handleNuevoTicket = () => {
    setTicketData(null);
  };

  return (
    <div className="h-[calc(100vh-220px)] flex flex-col overflow-hidden">
      {/* Contenido principal */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Panel izquierdo: Productos */}
        <div className="flex-1 border rounded-lg overflow-hidden bg-card">
          <ProductoPicker onSelectProducto={addProducto} />
        </div>

        {/* Panel derecho: Carrito */}
        <div className="w-[350px] lg:w-[400px] shrink-0">
          <CarritoTPV
            lineas={lineas}
            totales={totales}
            descuentoGlobal={descuentoGlobal}
            onUpdateCantidad={updateCantidad}
            onRemoveLinea={removeLinea}
            onAplicarDescuentoLinea={aplicarDescuentoLinea}
            onSetDescuentoGlobal={setDescuentoGlobal}
          />
        </div>
      </div>

      {/* Barra inferior */}
      <div className="h-16 mt-4 flex items-center justify-between gap-4 px-4 bg-card border rounded-lg">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShoppingCart className="h-5 w-5" />
          <span>
            {lineas.length} {lineas.length === 1 ? 'producto' : 'productos'}
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={cancelar}
            disabled={lineas.length === 0 || isProcessing}
          >
            <X className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
          <Button
            size="lg"
            onClick={handleCobrar}
            disabled={lineas.length === 0 || isProcessing}
            className="min-w-[200px]"
          >
            <Receipt className="mr-2 h-5 w-5" />
            Cobrar {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(totales.total)}
          </Button>
        </div>
      </div>

      {/* Modal de pago */}
      <MetodoPagoModal
        open={modalPagoOpen}
        onOpenChange={setModalPagoOpen}
        totales={totales}
        onConfirmar={handleConfirmarPago}
        isProcessing={isProcessing}
      />

      {/* Dialog con ticket impreso */}
      <Dialog open={!!ticketData} onOpenChange={() => setTicketData(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Venta Completada
            </DialogTitle>
          </DialogHeader>

          {ticketData && (
            <div>
              <div id="ticket-imprimible" ref={ticketRef}>
                <TicketImprimible
                  numeroTicket={ticketData.numeroTicket}
                  lineas={ticketData.lineas}
                  totales={ticketData.totales}
                  metodoPago={ticketData.metodoPago}
                  importeRecibido={ticketData.importeRecibido}
                  cambio={ticketData.cambio}
                  vendedor={ticketData.vendedor}
                  fecha={ticketData.fecha}
                />
              </div>

              <div className="flex gap-2 mt-4">
                <Button variant="outline" className="flex-1" onClick={handleImprimir}>
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir
                </Button>
                <Button className="flex-1" onClick={handleNuevoTicket}>
                  Nuevo Ticket
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
