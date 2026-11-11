// Umbrales de «Márgenes de carta» (fila única margenes_carta_config).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEdicionMargenes } from "@/hooks/useMargenesCarta";
import type { ConfigMargenes } from "@/lib/analisis/margenesCarta";

const CAMPOS: { clave: keyof ConfigMargenes; etiqueta: string; ayuda: string; paso: string }[] = [
  { clave: "multiplicadorMinPeso", etiqueta: "Al peso en rojo si el multiplicador baja de (×)", ayuda: "Precio del kilo en carta sin IVA entre lo que cuesta el kilo comprado sin IVA.", paso: "0.1" },
  { clave: "costeMaxPlatoPct", etiqueta: "Plato en rojo si el coste pasa del (%)", ayuda: "Del precio sin IVA.", paso: "1" },
  { clave: "multiplicadorMinVino", etiqueta: "Vino en rojo si el multiplicador baja de (×)", ayuda: "Precio de carta sin IVA entre el coste de la botella sin IVA. 2,3× equivale al antiguo 2,5× sobre el precio con IVA.", paso: "0.1" },
  { clave: "multiplicadorMinTienda", etiqueta: "Vino de la tienda en rojo si el multiplicador baja de (×)", ayuda: "Precio de tienda (carta menos el descuento) sin IVA entre el coste de la botella sin IVA. 1,5× = 33 % de margen.", paso: "0.1" },
  { clave: "subidaCostePct", etiqueta: "Avisar si el coste sube más del (%)", ayuda: "Frente a hace 6 meses, si el precio de la carta no se ha subido.", paso: "1" },
  { clave: "ivaPct", etiqueta: "IVA del restaurante (%)", ayuda: "Hostelería: 10 %. Se quita del precio de carta para calcular el margen.", paso: "1" },
  { clave: "ivaTiendaPct", etiqueta: "IVA de la tienda (%)", ayuda: "Venta de botellas para llevar: 21 %. Se quita del precio de tienda.", paso: "1" },
  { clave: "diasReferencia", etiqueta: "Días de compras para el coste actual", ayuda: "Mediana de ese periodo; sin compras en él, las 3 últimas.", paso: "1" },
];

export function DialogoUmbrales({ abierto, config, puedeEditar, onCerrar }: { abierto: boolean; config: ConfigMargenes; puedeEditar: boolean; onCerrar: () => void }) {
  const { config: guardar } = useEdicionMargenes();
  const [valores, setValores] = useState<ConfigMargenes>(config);
  useEffect(() => {
    if (abierto) setValores(config);
  }, [abierto, config]);

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Umbrales de los márgenes</DialogTitle>
          <DialogDescription>Valen para toda la carta.{puedeEditar ? "" : " Para cambiarlos hace falta «Editar» en Facturas."}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto overscroll-contain pr-1">
          {CAMPOS.map((c) => (
            <div key={c.clave} className="space-y-1">
              <Label htmlFor={`umbral-${c.clave}`}>{c.etiqueta}</Label>
              <Input
                id={`umbral-${c.clave}`}
                type="number"
                inputMode="decimal"
                step={c.paso}
                value={valores[c.clave]}
                disabled={!puedeEditar}
                onChange={(e) => setValores((v) => ({ ...v, [c.clave]: Number(e.target.value) }))}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">{c.ayuda}</p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>Cerrar</Button>
          {puedeEditar && (
            <Button
              disabled={guardar.isPending}
              onClick={() =>
                guardar.mutate(valores, {
                  onSuccess: () => { toast.success("Umbrales guardados"); onCerrar(); },
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Guardar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
