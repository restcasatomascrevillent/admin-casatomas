import { useEffect, useState } from "react";
import { BadgeCheck, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGuardarServicio } from "@/hooks/useServicios";
import { type BorradorPrecio, borradorPrecioDe, cambiosConfirmarPrecio } from "@/lib/costesServicios";
import { type ServicioContratado, diaIso } from "@/lib/servicios";

interface Props {
  servicio: ServicioContratado | null;
  onCerrar: () => void;
  /** false si falta 20261129153000: se confirma igual, pero sin guardar el día. */
  inventario: boolean;
  /** false si falta 20261103160000 (no hay «por confirmar»). */
  costes: boolean;
}

function Enlace({ href, children }: { href: string; children: string }) {
  return (
    <Button asChild variant="outline" className="h-11 gap-1.5">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">(se abre en otra pestaña)</span>
      </a>
    </Button>
  );
}

/**
 * Servicios › Costes › «Confirmar precio» (13/11/2026): el plan, la forma de
 * pago, el precio y su página oficial, con los enlaces para comprobarlo en la
 * web del proveedor o en su panel de facturación. Al guardar queda confirmado
 * con la fecha de hoy. Lo demás de la ficha, en Configurar › Editar.
 */
export function DialogoConfirmarPrecio({ servicio, onCerrar, inventario, costes }: Props) {
  const guardar = useGuardarServicio();
  const [b, setB] = useState<BorradorPrecio | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  useEffect(() => {
    setB(servicio ? borradorPrecioDe(servicio) : null);
    setErrores({});
  }, [servicio]);

  if (!servicio || !b) return null;
  const id = (campo: string) => `confirmar-${servicio.proveedor}-${campo}`;
  const cambiar = (campo: keyof BorradorPrecio, valor: string) => setB((x) => (x ? { ...x, [campo]: valor } : x));
  const anual = b.ciclo === "anual";
  const etiquetaPrecio = anual ? "Precio al año" : b.ciclo === "por_uso" ? "Cuota al mes (si la hay)" : "Precio al mes";

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = cambiosConfirmarPrecio(b, diaIso(new Date()));
    // `in` y no `!r.ok`: sin strictNullChecks TS no estrecha la rama `false`.
    if ("errores" in r) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    try {
      await guardar.mutateAsync({ proveedor: servicio.proveedor, cambios: r.cambios, costes, inventario });
      toast.success(`${servicio.nombre}: precio confirmado`);
      onCerrar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el precio.");
    }
  };

  return (
    <Dialog open onOpenChange={(abierto) => { if (!abierto) onCerrar(); }}>
      <DialogContent className="max-w-[calc(100vw-1rem)] p-4 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle>Precio de {servicio.nombre}</DialogTitle>
          <DialogDescription>
            Compruébalo en su página de precios o en la última factura y corrige lo que no cuadre. Al guardar queda confirmado con la fecha de hoy.
          </DialogDescription>
        </DialogHeader>
        {(servicio.fuente_precio || servicio.panel_url) && (
          <div className="flex min-w-0 flex-wrap gap-2">
            {servicio.fuente_precio && <Enlace href={servicio.fuente_precio}>Página de precios</Enlace>}
            {servicio.panel_url && <Enlace href={servicio.panel_url}>Su panel (factura)</Enlace>}
          </div>
        )}
        <form onSubmit={enviar} className="flex min-w-0 flex-col gap-3" noValidate>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("plan")}>Plan</Label>
              <Input id={id("plan")} value={b.plan} maxLength={80} placeholder="Free, Pro, Hobby…" onChange={(e) => cambiar("plan", e.target.value)} aria-invalid={!!errores.plan} aria-describedby={errores.plan ? id("plan-error") : undefined} />
              {errores.plan && <p id={id("plan-error")} className="text-xs text-destructive">{errores.plan}</p>}
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("ciclo")}>Forma de pago</Label>
              <Select value={b.ciclo} onValueChange={(v) => cambiar("ciclo", v)}>
                <SelectTrigger id={id("ciclo")} aria-label="Forma de pago"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gratuito">Gratis</SelectItem>
                  <SelectItem value="mensual">Cada mes</SelectItem>
                  <SelectItem value="anual">Cada año</SelectItem>
                  <SelectItem value="por_uso">Según uso (sin cuota)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("precio")}>{etiquetaPrecio}</Label>
              <Input id={id("precio")} value={b.precio} inputMode="decimal" placeholder={b.ciclo === "gratuito" ? "0" : ""} onChange={(e) => cambiar("precio", e.target.value)} aria-invalid={!!errores.precio} aria-describedby={errores.precio ? id("precio-error") : undefined} />
              {errores.precio && <p id={id("precio-error")} className="text-xs text-destructive">{errores.precio}</p>}
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={id("moneda")}>Moneda</Label>
              <Select value={b.moneda} onValueChange={(v) => cambiar("moneda", v)}>
                <SelectTrigger id={id("moneda")} aria-label="Moneda"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">Euros (EUR)</SelectItem>
                  <SelectItem value="USD">Dólares (USD)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={id("fuente")}>Página oficial del precio</Label>
            <Input id={id("fuente")} type="url" inputMode="url" value={b.fuente_precio} placeholder="https://" onChange={(e) => cambiar("fuente_precio", e.target.value)} aria-invalid={!!errores.fuente_precio} aria-describedby={errores.fuente_precio ? id("fuente-error") : undefined} />
            {errores.fuente_precio && <p id={id("fuente-error")} className="text-xs text-destructive">{errores.fuente_precio}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onCerrar}>Cancelar</Button>
            <Button type="submit" className="h-11 gap-2" disabled={guardar.isPending}>
              {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BadgeCheck className="h-4 w-4" aria-hidden="true" />}
              Confirmar precio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
