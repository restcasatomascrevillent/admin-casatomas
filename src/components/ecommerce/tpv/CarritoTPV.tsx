import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Plus, Minus, Percent, Wine, Utensils } from "lucide-react";
import { LineaTPV, TotalesTPV } from "@/hooks/useTPV";
import { TIPO_IVA_RESTAURACION_ETIQUETA } from "@/config/fiscal";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CarritoTPVProps {
  lineas: LineaTPV[];
  totales: TotalesTPV;
  descuentoGlobal: number;
  numeroTicket?: string;
  onUpdateCantidad: (index: number, cantidad: number) => void;
  onRemoveLinea: (index: number) => void;
  onAplicarDescuentoLinea: (index: number, descuento: number) => void;
  onSetDescuentoGlobal: (descuento: number) => void;
}

export function CarritoTPV({
  lineas,
  totales,
  descuentoGlobal,
  numeroTicket,
  onUpdateCantidad,
  onRemoveLinea,
  onAplicarDescuentoLinea,
  onSetDescuentoGlobal,
}: CarritoTPVProps) {
  const [descuentoTemp, setDescuentoTemp] = useState<{ index: number; valor: string } | null>(null);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

  const handleDescuentoLinea = (index: number) => {
    if (descuentoTemp && descuentoTemp.index === index) {
      const valor = parseFloat(descuentoTemp.valor) || 0;
      onAplicarDescuentoLinea(index, valor);
      setDescuentoTemp(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card border rounded-lg">
      {/* Cabecera */}
      <div className="p-4 border-b">
        <h3 className="font-bold text-lg">
          {numeroTicket ? `Ticket ${numeroTicket}` : 'Nuevo Ticket'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {lineas.length} {lineas.length === 1 ? 'producto' : 'productos'}
        </p>
      </div>

      {/* Lista de productos */}
      <ScrollArea className="flex-1">
        {lineas.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p>Carrito vacío</p>
            <p className="text-sm">Añade productos desde la izquierda</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {lineas.map((linea, index) => (
              <div
                key={`${linea.producto_id}-${index}`}
                className="space-y-1 p-2 bg-muted/50 rounded-md"
              >
                {/* Fila 1: qué es, cuánto cuesta y quitarlo */}
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-background flex items-center justify-center shrink-0">
                    {linea.producto_tipo === 'bebida' ? (
                      <Wine className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Utensils className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{linea.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(linea.precio)} x {linea.cantidad}
                      {linea.descuento && linea.descuento > 0 && (
                        <span className="text-destructive ml-1">(-{linea.descuento}%)</span>
                      )}
                    </p>
                  </div>

                  <span className="text-sm font-bold text-right whitespace-nowrap">
                    {formatCurrency(
                      linea.precio * linea.cantidad * (1 - (linea.descuento || 0) / 100)
                    )}
                  </span>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0 text-destructive"
                    onClick={() => onRemoveLinea(index)}
                    aria-label={`Quitar ${linea.nombre}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Fila 2: cantidad y descuento, con botones de 44 px (se pulsan con el dedo) */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11"
                      onClick={() => onUpdateCantidad(index, linea.cantidad - 1)}
                      aria-label={`Quitar una unidad de ${linea.nombre}`}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-9 text-center text-base font-semibold tabular-nums" aria-live="polite">
                      {linea.cantidad}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11"
                      onClick={() => onUpdateCantidad(index, linea.cantidad + 1)}
                      aria-label={`Añadir una unidad de ${linea.nombre}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-11 gap-1.5 px-3" aria-label={`Descuento de ${linea.nombre}`}>
                        <Percent className="h-4 w-4" />
                        Descuento
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3" collisionPadding={12}>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Descuento %</p>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            value={descuentoTemp?.index === index ? descuentoTemp.valor : (linea.descuento || '')}
                            onChange={(e) => setDescuentoTemp({ index, valor: e.target.value })}
                            className="h-11 text-base md:text-base"
                            aria-label="Porcentaje de descuento"
                          />
                          <Button
                            className="h-11 px-5"
                            onClick={() => handleDescuentoLinea(index)}
                          >
                            OK
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Totales */}
      <div className="p-4 border-t space-y-2 bg-muted/30">
        {/* Descuento global */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Descuento global</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              value={descuentoGlobal || ''}
              onChange={(e) => onSetDescuentoGlobal(parseFloat(e.target.value) || 0)}
              className="w-20 h-11 text-right text-base md:text-base"
              aria-label="Descuento global en porcentaje"
            />
            <span>%</span>
          </div>
        </div>

        <div className="space-y-1 pt-2 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(totales.subtotal)}</span>
          </div>
          {totales.descuentoTotal > 0 && (
            <div className="flex justify-between text-sm text-destructive">
              <span>Descuento</span>
              <span>-{formatCurrency(totales.descuentoTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Base imponible</span>
            <span>{formatCurrency(totales.baseImponible)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IVA ({TIPO_IVA_RESTAURACION_ETIQUETA})</span>
            <span>{formatCurrency(totales.iva)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold pt-2 border-t">
            <span>TOTAL</span>
            <span className="text-primary">{formatCurrency(totales.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
