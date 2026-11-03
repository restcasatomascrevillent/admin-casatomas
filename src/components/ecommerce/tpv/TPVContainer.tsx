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
    <div className="flex flex-col [@media(min-width:768px)_and_(min-height:521px)]:h-full [@media(min-width:768px)_and_(min-height:521px)]:min-h-0 [@media(min-width:768px)_and_(min-height:521px)]:overflow-hidden">
      {/* Contenido principal */}
      {/* Por debajo de 1024 px (tablet vertical, con el menú lateral) los dos paneles
          no caben en fila: productos arriba y carrito debajo. */}
      <div className="flex flex-col gap-4 [@media(min-width:768px)_and_(min-height:521px)]:min-h-0 [@media(min-width:768px)_and_(min-height:521px)]:flex-1 [@media(min-width:768px)_and_(min-height:521px)]:overflow-hidden [@media(min-width:1024px)_and_(min-height:521px)]:flex-row">
        {/* Panel izquierdo: Productos */}
        <div className="h-[32rem] shrink-0 border rounded-lg overflow-hidden bg-card [@media(min-width:768px)_and_(min-height:521px)]:h-auto [@media(min-width:768px)_and_(min-height:521px)]:min-h-0 [@media(min-width:768px)_and_(min-height:521px)]:flex-1 [@media(min-width:768px)_and_(min-height:521px)]:shrink">
          <ProductoPicker onSelectProducto={addProducto} />
        </div>

        {/* Panel derecho: Carrito */}
        <div className="shrink-0 [@media(min-width:768px)_and_(max-width:1023px)_and_(min-height:521px)]:h-[45%] [@media(min-width:768px)_and_(min-height:521px)]:min-h-0 [@media(min-width:1024px)_and_(min-height:521px)]:h-auto [@media(min-width:1024px)_and_(min-height:521px)]:w-[400px]">
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
      <div className="sticky bottom-0 z-10 min-h-16 mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 bg-card border rounded-lg min-[360px]:px-4 [@media(min-width:768px)_and_(min-height:521px)]:static">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShoppingCart className="h-5 w-5" />
          <span>
            {lineas.length} {lineas.length === 1 ? 'producto' : 'productos'}
          </span>
        </div>

        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="outline"
            className="h-12 shrink-0 px-3 min-[360px]:px-5"
            onClick={cancelar}
            disabled={lineas.length === 0 || isProcessing}
          >
            <X className="mr-2 hidden h-4 w-4 min-[360px]:block" />
            Cancelar
          </Button>
          <Button
            size="lg"
            onClick={handleCobrar}
            disabled={lineas.length === 0 || isProcessing}
            className="h-12 min-w-0 flex-1 px-3 text-sm min-[360px]:px-8 min-[360px]:text-base sm:min-w-[200px] sm:flex-none"
          >
            <Receipt className="mr-2 hidden h-5 w-5 min-[360px]:block" />
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
        <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
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
                <Button variant="outline" className="h-11 flex-1" onClick={handleImprimir}>
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir
                </Button>
                <Button className="h-11 flex-1" onClick={handleNuevoTicket}>
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
