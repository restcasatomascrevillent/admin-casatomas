// Umbrales de «Márgenes de carta» (fila única margenes_carta_config).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEdicionMargenes } from "@/hooks/useMargenesCarta";
import type { ConfigMargenes } from "@/lib/analisis/margenesCarta";

// 13/11/2026 (dueño: «explicado para tontos»; «el % coste en realidad es de venta»): cada
// umbral con un ejemplo. El coste es el de la ÚLTIMA factura (20261128140000).
const CAMPOS: { clave: keyof ConfigMargenes; etiqueta: string; ayuda: string; paso: string }[] = [
  {
    clave: "multiplicadorMinPeso",
    etiqueta: "Al peso: en rojo si cobras menos de (veces lo que pagas)",
    ayuda: "Precio del kilo en carta sin IVA entre lo que te cuesta el kilo (última factura, sin IVA). Con 2: si el kilo te cuesta 20 €, en rojo si lo vendes a menos de 40 € sin IVA.",
    paso: "0.1",
  },
  {
    clave: "costeMaxPlatoPct",
    etiqueta: "Plato: en rojo si el coste pasa del (% del precio de venta sin IVA)",
    ayuda: "De cada 100 € que cobras sin IVA, cuántos se pueden ir en ingredientes. Con 35: un plato que vendes a 22 € (20 € sin IVA) sale en rojo si hacerlo cuesta más de 7 €.",
    paso: "1",
  },
  {
    clave: "multiplicadorMinVino",
    etiqueta: "Vino: en rojo si cobras menos de (veces lo que pagas)",
    ayuda: "Precio de carta sin IVA entre lo que te cuesta la botella (última factura, sin IVA). 2,3 equivale al antiguo 2,5 sobre el precio con IVA: de cada 100 € que cobras, como mucho 43 € se van en la botella.",
    paso: "0.1",
  },
  {
    clave: "multiplicadorMinTienda",
    etiqueta: "Vino de la tienda: en rojo si cobras menos de (veces lo que pagas)",
    ayuda: "Precio de tienda (carta menos el descuento) sin IVA entre lo que te cuesta la botella sin IVA. Con 1,5: de cada 100 € que cobras, como mucho 67 € se van en la botella.",
    paso: "0.1",
  },
  {
    clave: "subidaCostePct",
    etiqueta: "Avisar si lo que te cuesta sube más del (%)",
    ayuda: "La última factura frente a la última que había hace 6 meses, si no has subido el precio de la carta desde entonces.",
    paso: "1",
  },
  { clave: "ivaPct", etiqueta: "IVA del restaurante (%)", ayuda: "Hostelería: 10 %. Se quita del precio de carta para calcular el margen.", paso: "1" },
  { clave: "ivaTiendaPct", etiqueta: "IVA de la tienda (%)", ayuda: "Venta de botellas para llevar: 21 %. Se quita del precio de tienda.", paso: "1" },
  {
    clave: "diasReferencia",
    etiqueta: "Días para la mediana (solo de referencia)",
    ayuda: "Lo que te cuesta cada cosa sale de su ÚLTIMA factura. La mediana de las compras de estos días se enseña al lado, como contexto (sin compras en ese tiempo, las 3 últimas).",
    paso: "1",
  },
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
