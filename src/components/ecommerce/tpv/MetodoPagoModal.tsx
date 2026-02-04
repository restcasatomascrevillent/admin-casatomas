import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Banknote, CreditCard, Smartphone, Shuffle, Loader2 } from "lucide-react";
import { MetodoPago, TotalesTPV } from "@/hooks/useTPV";

interface MetodoPagoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totales: TotalesTPV;
  onConfirmar: (datos: {
    metodo: MetodoPago;
    importeRecibido?: number;
    detallesMixto?: { efectivo?: number; tarjeta?: number; bizum?: number };
  }) => void;
  isProcessing: boolean;
}

export function MetodoPagoModal({
  open,
  onOpenChange,
  totales,
  onConfirmar,
  isProcessing,
}: MetodoPagoModalProps) {
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [importeRecibido, setImporteRecibido] = useState<string>('');
  const [mixtoEfectivo, setMixtoEfectivo] = useState<string>('');
  const [mixtoTarjeta, setMixtoTarjeta] = useState<string>('');
  const [mixtoBizum, setMixtoBizum] = useState<string>('');

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

  const cambio = metodo === 'efectivo' && importeRecibido
    ? Math.max(0, parseFloat(importeRecibido) - totales.total)
    : 0;

  const totalMixto = (parseFloat(mixtoEfectivo) || 0) + (parseFloat(mixtoTarjeta) || 0) + (parseFloat(mixtoBizum) || 0);
  const mixtoValido = metodo !== 'mixto' || Math.abs(totalMixto - totales.total) < 0.01;
  
  const efectivoValido = metodo !== 'efectivo' || 
    (parseFloat(importeRecibido) || 0) >= totales.total;

  const puedeConfirmar = mixtoValido && efectivoValido && !isProcessing;

  const handleConfirmar = () => {
    if (!puedeConfirmar) return;

    if (metodo === 'efectivo') {
      onConfirmar({
        metodo,
        importeRecibido: parseFloat(importeRecibido) || totales.total,
      });
    } else if (metodo === 'mixto') {
      onConfirmar({
        metodo,
        detallesMixto: {
          efectivo: parseFloat(mixtoEfectivo) || 0,
          tarjeta: parseFloat(mixtoTarjeta) || 0,
          bizum: parseFloat(mixtoBizum) || 0,
        },
      });
    } else {
      onConfirmar({ metodo });
    }
  };

  const handleMetodoChange = (value: string) => {
    setMetodo(value as MetodoPago);
    setImporteRecibido('');
    setMixtoEfectivo('');
    setMixtoTarjeta('');
    setMixtoBizum('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Método de Pago</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Total a cobrar */}
          <div className="p-4 bg-primary/10 rounded-lg text-center">
            <p className="text-sm text-muted-foreground">Total a cobrar</p>
            <p className="text-3xl font-bold text-primary">{formatCurrency(totales.total)}</p>
          </div>

          {/* Selector de método */}
          <RadioGroup value={metodo} onValueChange={handleMetodoChange} className="grid grid-cols-2 gap-2">
            <div>
              <RadioGroupItem value="efectivo" id="efectivo" className="peer sr-only" />
              <Label
                htmlFor="efectivo"
                className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
              >
                <Banknote className="mb-2 h-6 w-6" />
                <span className="text-sm font-medium">Efectivo</span>
              </Label>
            </div>

            <div>
              <RadioGroupItem value="tarjeta" id="tarjeta" className="peer sr-only" />
              <Label
                htmlFor="tarjeta"
                className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
              >
                <CreditCard className="mb-2 h-6 w-6" />
                <span className="text-sm font-medium">Tarjeta</span>
              </Label>
            </div>

            <div>
              <RadioGroupItem value="bizum" id="bizum" className="peer sr-only" />
              <Label
                htmlFor="bizum"
                className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
              >
                <Smartphone className="mb-2 h-6 w-6" />
                <span className="text-sm font-medium">Bizum</span>
              </Label>
            </div>

            <div>
              <RadioGroupItem value="mixto" id="mixto" className="peer sr-only" />
              <Label
                htmlFor="mixto"
                className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
              >
                <Shuffle className="mb-2 h-6 w-6" />
                <span className="text-sm font-medium">Mixto</span>
              </Label>
            </div>
          </RadioGroup>

          {/* Opciones específicas por método */}
          {metodo === 'efectivo' && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="recibido">Importe recibido</Label>
                <Input
                  id="recibido"
                  type="number"
                  step="0.01"
                  min={totales.total}
                  placeholder={formatCurrency(totales.total)}
                  value={importeRecibido}
                  onChange={(e) => setImporteRecibido(e.target.value)}
                  className="text-lg"
                />
              </div>
              {importeRecibido && parseFloat(importeRecibido) >= totales.total && (
                <div className="p-3 bg-green-500/10 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Cambio a devolver</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(cambio)}</p>
                </div>
              )}
              {importeRecibido && parseFloat(importeRecibido) < totales.total && (
                <p className="text-sm text-destructive text-center">
                  El importe recibido es inferior al total
                </p>
              )}
            </div>
          )}

          {metodo === 'mixto' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="mixtoEfectivo" className="text-xs">Efectivo</Label>
                  <Input
                    id="mixtoEfectivo"
                    type="number"
                    step="0.01"
                    min="0"
                    value={mixtoEfectivo}
                    onChange={(e) => setMixtoEfectivo(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="mixtoTarjeta" className="text-xs">Tarjeta</Label>
                  <Input
                    id="mixtoTarjeta"
                    type="number"
                    step="0.01"
                    min="0"
                    value={mixtoTarjeta}
                    onChange={(e) => setMixtoTarjeta(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="mixtoBizum" className="text-xs">Bizum</Label>
                  <Input
                    id="mixtoBizum"
                    type="number"
                    step="0.01"
                    min="0"
                    value={mixtoBizum}
                    onChange={(e) => setMixtoBizum(e.target.value)}
                  />
                </div>
              </div>
              <div className={`text-center text-sm ${mixtoValido ? 'text-green-600' : 'text-destructive'}`}>
                Total: {formatCurrency(totalMixto)} / {formatCurrency(totales.total)}
                {!mixtoValido && ' (debe coincidir)'}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmar} disabled={!puedeConfirmar}>
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Procesando...
              </>
            ) : (
              `Cobrar ${formatCurrency(totales.total)}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
