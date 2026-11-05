import { useEffect, useState } from "react";
import { Merge } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { formatImporte, plural } from "@/components/facturas/shared/formatters";
import { useFusionarProductos } from "@/hooks/useProductosCatalogo";
import { destinoFusionSugerido, type ResumenProducto } from "@/lib/facturas/productos";

/** Fusionar varios productos duplicados en uno: se elige cuál se queda. */
export function FusionarDialog({
  productos,
  onCerrar,
  onHecho,
}: {
  productos: ResumenProducto[];
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [destino, setDestino] = useState<number | null>(() => destinoFusionSugerido(productos));
  useEffect(() => setDestino(destinoFusionSugerido(productos)), [productos]);
  const fusionar = useFusionarProductos();
  const elegido = productos.find((p) => p.producto_id === destino);
  const resto = productos.filter((p) => p.producto_id !== destino);
  const lineas = resto.reduce((a, p) => a + p.compras, 0);

  return (
    <AlertDialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <AlertDialogContent className="max-h-[92dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Fusionar {productos.length} productos</AlertDialogTitle>
          <AlertDialogDescription>
            Elige el que se queda. Las líneas de los demás pasan a él (también las que lleguen después con el mismo texto) y
            los demás se borran del catálogo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup value={destino === null ? "" : String(destino)} onValueChange={(v) => setDestino(Number(v))} className="gap-1">
          {productos.map((p) => (
            <Label
              key={p.producto_id}
              htmlFor={`fusion-${p.producto_id}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 font-normal has-[:checked]:border-primary"
            >
              <RadioGroupItem id={`fusion-${p.producto_id}`} value={String(p.producto_id)} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.nombre}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {plural(p.compras, "compra", "compras")} · {formatImporte(p.gasto)}
              </span>
            </Label>
          ))}
        </RadioGroup>
        {elegido && (
          <p className="text-sm text-muted-foreground">
            Queda «{elegido.nombre}»; se le mueven {lineas} línea(s) del periodo visible y se borran {resto.length} producto(s).
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!elegido || resto.length === 0 || fusionar.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!elegido) return;
              fusionar.mutate(
                { origenIds: resto.map((p) => p.producto_id), destinoId: elegido.producto_id },
                { onSuccess: onHecho },
              );
            }}
          >
            <Merge className="mr-1 h-4 w-4" aria-hidden="true" /> Fusionar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
