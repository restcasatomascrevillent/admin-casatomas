import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ConfigServicios, useGuardarTipoCambio } from "@/hooks/useServicios";
import { fechaCorta, leerNumero } from "@/lib/servicios";

export const formatearCambio = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 4, maximumFractionDigits: 6 });

/**
 * «1 US$ = 0,8938 €», editable (solo super admin; se guarda en
 * servicios_config) y con el último del Banco Central Europeo al lado.
 * Vive en Configurar: pasa a euros todos los precios en dólares.
 */
export function TipoCambio({ config, editable }: { config: ConfigServicios | null; editable: boolean }) {
  const guardar = useGuardarTipoCambio();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cambio = config?.eurPorUsd ?? null;

  const enviar = async (valor: number) => {
    setError(null);
    try {
      await guardar.mutateAsync(valor);
      toast.success("Tipo de cambio guardado");
      setEditando(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el tipo de cambio.");
    }
  };
  const alEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    const n = leerNumero(texto);
    if (n == null || Number.isNaN(n) || n <= 0.2 || n >= 5) {
      setError("Escribe cuántos euros vale un dólar (por ejemplo 0,92).");
      return;
    }
    void enviar(n);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      {editando ? (
        <form onSubmit={alEnviar} className="flex min-w-0 flex-wrap items-end gap-2" noValidate>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="servicios-tipo-cambio">Euros por 1 dólar</Label>
            <Input
              id="servicios-tipo-cambio"
              inputMode="decimal"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-11 w-32"
              aria-invalid={!!error}
              aria-describedby={error ? "servicios-tipo-cambio-error" : undefined}
              autoFocus
            />
          </div>
          <Button type="submit" className="h-11 gap-1.5" disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => { setEditando(false); setError(null); }}>Cancelar</Button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Tipo de cambio: <span className="font-medium tabular-nums text-foreground">1 US$ = {cambio == null ? "…" : `${formatearCambio(cambio)} €`}</span>
          </span>
          {editable && cambio != null && (
            <Button type="button" variant="outline" className="h-11 gap-1.5 px-3" onClick={() => { setTexto(formatearCambio(cambio)); setEditando(true); }} aria-label="Cambiar el tipo de cambio del dólar">
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Cambiar
            </Button>
          )}
        </div>
      )}
      {error && <p id="servicios-tipo-cambio-error" className="text-xs text-destructive">{error}</p>}
      {config?.bce && editable && (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Último del Banco Central Europeo: {formatearCambio(config.bce.eurPorUsd)} € ({fechaCorta(config.bce.fecha)}).</span>
          {cambio != null && Math.abs(config.bce.eurPorUsd - cambio) >= 0.000001 && (
            <Button type="button" variant="ghost" className="h-11 px-2 text-xs underline underline-offset-2" disabled={guardar.isPending} onClick={() => void enviar(config.bce!.eurPorUsd)}>
              Usar el del BCE
            </Button>
          )}
        </p>
      )}
      {!editable && <p className="text-xs text-muted-foreground">Falta la migración de costes: se usa 0,92 € por dólar.</p>}
    </div>
  );
}
