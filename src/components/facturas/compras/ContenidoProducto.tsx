import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useContenidoProducto,
  useGuardarContenidoProducto,
  type UnidadContenido,
} from "@/hooks/useProductosCatalogo";
import { leerContenido } from "@/lib/facturas/contenido";

const UNIDADES: { valor: UnidadContenido; texto: string }[] = [
  { valor: "kg", texto: "kg" },
  { valor: "l", texto: "litros" },
  { valor: "ud", texto: "unidades" },
];

const aTexto = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

/**
 * Compras › ficha de producto: cuánto trae cada caja/envase («caja de 10 kg»,
 * «cubo de 5 l»). Es el contenido por defecto del producto (productos_catalogo):
 * se usa para pasar los precios a €/kg o €/l y compararlos cuando la línea de la
 * factura no dice el suyo. Todo táctil (44 px).
 */
export function ContenidoProducto({ productoId, puedeEditar }: { productoId: number; puedeEditar: boolean }) {
  const contenidoQ = useContenidoProducto(productoId);
  const guardar = useGuardarContenidoProducto();
  const guardada = contenidoQ.data?.cantidad ?? null;
  const unidadGuardada = contenidoQ.data?.unidad ?? null;
  const [texto, setTexto] = useState("");
  const [unidad, setUnidad] = useState<UnidadContenido>("kg");

  useEffect(() => {
    setTexto(aTexto(guardada));
    setUnidad(unidadGuardada ?? "kg");
  }, [productoId, guardada, unidadGuardada]);

  const cantidad = leerContenido(texto);
  const cambiado = cantidad !== guardada || (cantidad !== null && unidad !== unidadGuardada);
  const puedeGuardar = puedeEditar && cantidad !== null && cambiado && !guardar.isPending;
  const textoInvalido = texto.trim() !== "" && cantidad === null;

  return (
    <section aria-label="Contenido por caja o unidad" className="space-y-2 rounded-lg border p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contenido por caja o unidad</h3>
      <p className="text-xs text-muted-foreground">
        Cuánto trae cada caja o envase de este producto. Sirve para comparar proveedores en €/kg o €/l cuando la línea de la
        factura no lo dice.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          aria-label="Contenido por caja o unidad"
          aria-invalid={textoInvalido}
          placeholder="Ej.: 10"
          value={texto}
          disabled={!puedeEditar || contenidoQ.isLoading}
          onChange={(e) => setTexto(e.target.value)}
          className="h-11 w-28 text-base tabular-nums"
        />
        <div role="group" aria-label="Unidad del contenido" className="flex gap-1">
          {UNIDADES.map((u) => (
            <Button
              key={u.valor}
              type="button"
              variant={unidad === u.valor ? "default" : "outline"}
              aria-pressed={unidad === u.valor}
              disabled={!puedeEditar}
              onClick={() => setUnidad(u.valor)}
              className="h-11 min-w-11 px-3"
            >
              {u.texto}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          className="h-11"
          disabled={!puedeGuardar}
          onClick={() => cantidad !== null && guardar.mutate({ id: productoId, cantidad, unidad })}
        >
          Guardar
        </Button>
        {guardada !== null && (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={!puedeEditar || guardar.isPending}
            onClick={() => guardar.mutate({ id: productoId, cantidad: null, unidad: null })}
          >
            Quitar
          </Button>
        )}
      </div>
      {textoInvalido && (
        <p role="alert" className="text-xs text-destructive">
          Escribe un número mayor que 0 (hasta 1.000), por ejemplo 10 o 0,75.
        </p>
      )}
      {!puedeEditar && <p className="text-xs text-muted-foreground">Solo quien edita Facturas puede cambiarlo.</p>}
    </section>
  );
}
