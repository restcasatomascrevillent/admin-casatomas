import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBorrarCosteMes, useGuardarCosteMes } from "@/hooks/useServicios";
import { textoMes } from "@/lib/informeServicios";
import { leerNumero } from "@/lib/servicios";

/** Qué se va a meter: el servicio, el mes y, si ya había, lo metido. */
export interface CosteMesEditando {
  proveedor: string;
  nombre: string;
  mes: string;
  /** Meses entre los que elegir (el primero, el más reciente). */
  meses: string[];
  /** Moneda del plan, para proponerla. */
  moneda: string;
  actual?: { importe: number; moneda: string; nota: string | null } | null;
}

interface Props {
  editando: CosteMesEditando | null;
  onCerrar: () => void;
}

const MONEDAS = [
  { valor: "EUR", texto: "Euros (€)" },
  { valor: "USD", texto: "Dólares (US$)" },
];

/**
 * Servicios › Costes › «Meter coste»: lo que se pagó por un servicio en un mes
 * (de su factura o del cargo en la tarjeta). Manda sobre la estimación en el
 * informe mensual. «Quitar» lo borra y vuelve a la estimación.
 */
export function DialogoCosteMes({ editando, onCerrar }: Props) {
  const guardar = useGuardarCosteMes();
  const borrar = useBorrarCosteMes();
  const [mes, setMes] = useState("");
  const [importe, setImporte] = useState("");
  const [moneda, setMoneda] = useState("EUR");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editando) return;
    setMes(editando.mes);
    setImporte(editando.actual ? String(editando.actual.importe).replace(".", ",") : "");
    setMoneda(editando.actual?.moneda ?? (editando.moneda.toUpperCase() === "USD" ? "USD" : "EUR"));
    setNota(editando.actual?.nota ?? "");
    setError(null);
  }, [editando]);

  const ocupado = guardar.isPending || borrar.isPending;
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    const n = leerNumero(importe);
    if (n == null || n < 0) {
      setError("Escribe el importe (0 o más), por ejemplo 12,50.");
      return;
    }
    try {
      await guardar.mutateAsync({ proveedor: editando.proveedor, mes, importe: Math.round(n * 100) / 100, moneda, nota: nota.trim() || null });
      toast.success(`${editando.nombre}: coste de ${textoMes(mes)} guardado`);
      onCerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido guardar el coste.");
    }
  };
  const quitar = async () => {
    if (!editando) return;
    try {
      await borrar.mutateAsync({ proveedor: editando.proveedor, mes });
      toast.success(`${editando.nombre}: quitado el coste de ${textoMes(mes)}`);
      onCerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido quitar el coste.");
    }
  };

  return (
    <Dialog open={!!editando} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Coste de {editando?.nombre}</DialogTitle>
          <DialogDescription>Lo que se pagó ese mes, de su factura o del cargo en la tarjeta. Manda sobre la estimación.</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(e) => void enviar(e)} noValidate>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="coste-mes-mes">Mes</Label>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger id="coste-mes-mes" aria-label="Mes"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(editando?.meses ?? []).map((m) => <SelectItem key={m} value={m}>{textoMes(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="coste-mes-importe">Importe</Label>
              <Input
                id="coste-mes-importe"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={importe}
                onChange={(e) => { setImporte(e.target.value); setError(null); }}
                aria-invalid={!!error}
                aria-describedby={error ? "coste-mes-error" : undefined}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="coste-mes-moneda">Moneda</Label>
              <Select value={moneda} onValueChange={setMoneda}>
                <SelectTrigger id="coste-mes-moneda" aria-label="Moneda"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONEDAS.map((m) => <SelectItem key={m.valor} value={m.valor}>{m.texto}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="coste-mes-nota">Nota (opcional)</Label>
            <Input id="coste-mes-nota" maxLength={300} placeholder="Nº de factura, de dónde sale…" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
          {error && <p id="coste-mes-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            {editando?.actual && mes === editando.mes && (
              <Button type="button" variant="ghost" className="h-11 gap-2 text-destructive sm:mr-auto" onClick={() => void quitar()} disabled={ocupado}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Quitar
              </Button>
            )}
            <Button type="button" variant="outline" className="h-11" onClick={onCerrar}>Cancelar</Button>
            <Button type="submit" className="h-11 gap-2" disabled={ocupado}>
              {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
