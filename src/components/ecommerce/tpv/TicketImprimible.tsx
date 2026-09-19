import { forwardRef } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { LineaTPV, TotalesTPV, MetodoPago } from "@/hooks/useTPV";
import { DATOS_FISCALES, TIPO_IVA_RESTAURACION_ETIQUETA } from "@/config/fiscal";

interface TicketImprimibleProps {
  numeroTicket: string;
  lineas: LineaTPV[];
  totales: TotalesTPV;
  metodoPago: MetodoPago;
  importeRecibido?: number;
  cambio?: number;
  vendedor?: string;
  fecha: Date;
}

export const TicketImprimible = forwardRef<HTMLDivElement, TicketImprimibleProps>(
  ({ numeroTicket, lineas, totales, metodoPago, importeRecibido, cambio, vendedor, fecha }, ref) => {
    const formatCurrency = (value: number) =>
      new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

    const metodoPagoTexto: Record<MetodoPago, string> = {
      efectivo: 'Efectivo',
      tarjeta: 'Tarjeta',
      bizum: 'Bizum',
      mixto: 'Mixto',
    };

    return (
      <div
        ref={ref}
        className="bg-white text-black p-4 font-mono text-sm max-w-[300px] mx-auto"
        style={{ fontFamily: 'monospace' }}
      >
        {/* Cabecera: solo se imprimen los datos fiscales configurados (ver
            src/config/fiscal.ts). Sin configuración no se imprime la línea. */}
        <div className="text-center mb-4">
          <h1 className="text-lg font-bold uppercase">{DATOS_FISCALES.nombre}</h1>
          {DATOS_FISCALES.cif && <p className="text-xs">CIF: {DATOS_FISCALES.cif}</p>}
          {DATOS_FISCALES.direccion && <p className="text-xs">{DATOS_FISCALES.direccion}</p>}
          {DATOS_FISCALES.telefono && <p className="text-xs">Tel: {DATOS_FISCALES.telefono}</p>}
        </div>

        <div className="border-t border-dashed border-black my-2" />

        {/* Info ticket */}
        <div className="text-xs mb-3">
          <div className="flex justify-between">
            <span>Ticket:</span>
            <span className="font-bold">{numeroTicket}</span>
          </div>
          <div className="flex justify-between">
            <span>Fecha:</span>
            <span>{format(fecha, "dd/MM/yyyy HH:mm", { locale: es })}</span>
          </div>
          {vendedor && (
            <div className="flex justify-between">
              <span>Vendedor:</span>
              <span>{vendedor}</span>
            </div>
          )}
        </div>

        <div className="border-t border-dashed border-black my-2" />

        {/* Líneas de productos */}
        <div className="mb-3">
          {lineas.map((linea, index) => (
            <div key={index} className="mb-1">
              <div className="flex justify-between">
                <span className="truncate flex-1 pr-2">{linea.nombre}</span>
                <span>{formatCurrency(linea.precio * linea.cantidad * (1 - (linea.descuento || 0) / 100))}</span>
              </div>
              <div className="text-xs text-gray-600 pl-2">
                {linea.cantidad} x {formatCurrency(linea.precio)}
                {linea.descuento && linea.descuento > 0 && ` (-${linea.descuento}%)`}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-black my-2" />

        {/* Totales */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Subtotal:</span>
            <span>{formatCurrency(totales.subtotal)}</span>
          </div>
          {totales.descuentoTotal > 0 && (
            <div className="flex justify-between text-xs">
              <span>Descuento:</span>
              <span>-{formatCurrency(totales.descuentoTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span>Base imponible:</span>
            <span>{formatCurrency(totales.baseImponible)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span>IVA ({TIPO_IVA_RESTAURACION_ETIQUETA}):</span>
            <span>{formatCurrency(totales.iva)}</span>
          </div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-black">
            <span>TOTAL:</span>
            <span>{formatCurrency(totales.total)}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-black my-2" />

        {/* Pago */}
        <div className="text-xs space-y-1">
          <div className="flex justify-between">
            <span>Forma de pago:</span>
            <span>{metodoPagoTexto[metodoPago]}</span>
          </div>
          {metodoPago === 'efectivo' && importeRecibido !== undefined && (
            <>
              <div className="flex justify-between">
                <span>Recibido:</span>
                <span>{formatCurrency(importeRecibido)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Cambio:</span>
                <span>{formatCurrency(cambio || 0)}</span>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-dashed border-black my-2" />

        {/* Pie */}
        <div className="text-center text-xs mt-4">
          <p>¡Gracias por su compra!</p>
          <p className="mt-1">Conserve este ticket</p>
          <p className="mt-2 text-[10px] text-gray-500">
            IVA incluido en los precios
          </p>
        </div>

        {/* Estilos para impresión */}
        <style>{`
          @media print {
            body * {
              visibility: hidden;
            }
            #ticket-imprimible, #ticket-imprimible * {
              visibility: visible;
            }
            #ticket-imprimible {
              position: absolute;
              left: 0;
              top: 0;
              width: 80mm;
              font-size: 12px;
            }
          }
        `}</style>
      </div>
    );
  }
);

TicketImprimible.displayName = "TicketImprimible";
