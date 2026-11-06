import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AyudaPopover } from "@/components/AyudaPopover";
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

const TEXTO_UNIDAD: Record<UnidadContenido, string> = { kg: "kg", l: "l", ud: "unidades" };

/**
 * Compras › ficha de producto: cuánto trae cada caja/envase. Una sola línea
 * («Caja de 6 kg · Editar» o «Sin contenido · Añadir»); el editor (cantidad,
 * unidad, Guardar, Quitar) se abre en un popover. Es el contenido por defecto
 * del producto (productos_catalogo): se usa para pasar los precios a €/kg o €/l
 * y compararlos cuando la línea de la factura no dice el suyo. Todo táctil (44 px).
 */
export function ContenidoProducto({ productoId, puedeEditar }: { productoId: number; puedeEditar: boolean }) {
  const contenidoQ = useContenidoProducto(productoId);
  const guardar = useGuardarContenidoProducto();
  const guardada = contenidoQ.data?.cantidad ?? null;
  const unidadGuardada = contenidoQ.data?.unidad ?? null;
  const [abierto, setAbierto] = useState(false);
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
  const cerrarAlTerminar = { onSuccess: () => setAbierto(false) };

  const resumen =
    guardada !== null ? `Caja de ${aTexto(guardada)} ${unidadGuardada ? TEXTO_UNIDAD[unidadGuardada] : ""}`.trim() : "Sin contenido por caja";

  return (
    <section
      aria-label="Contenido por caja o unidad"
      className="flex min-h-11 flex-wrap items-center gap-x-1.5 text-sm"
    >
      <span className={guardada !== null ? "font-medium" : "text-muted-foreground"}>{resumen}</span>
      {/* La explicación, con un toque (antes solo en `title`, que en la tablet no se ve: QA M2). */}
      <AyudaPopover etiqueta="Para qué sirve lo que trae cada caja" className="-my-3.5 mx-0">
        Cuánto trae cada caja o envase: sirve para comparar proveedores en €/kg o €/l cuando la línea de la factura no lo dice.
      </AyudaPopover>
      {puedeEditar && (
        <>
          <span className="text-muted-foreground/60" aria-hidden="true">·</span>
          <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="link"
                className="h-11 px-1.5"
                aria-label={guardada !== null ? "Editar contenido por caja" : "Añadir contenido por caja"}
              >
                {guardada !== null ? "Editar" : "Añadir"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] space-y-2">
              <p className="text-sm font-semibold">Contenido por caja o unidad</p>
              <p className="text-xs text-muted-foreground">
                Cuánto trae cada caja o envase. Sirve para comparar proveedores en €/kg o €/l cuando la línea de la factura no lo dice.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label="Contenido por caja o unidad"
                  aria-invalid={textoInvalido}
                  placeholder="Ej.: 10"
                  value={texto}
                  disabled={contenidoQ.isLoading}
                  onChange={(e) => setTexto(e.target.value)}
                  className="h-11 w-24 text-base tabular-nums"
                />
                <div role="group" aria-label="Unidad del contenido" className="flex gap-1">
                  {UNIDADES.map((u) => (
                    <Button
                      key={u.valor}
                      type="button"
                      variant={unidad === u.valor ? "default" : "outline"}
                      aria-pressed={unidad === u.valor}
                      onClick={() => setUnidad(u.valor)}
                      className="h-11 min-w-11 px-3"
                    >
                      {u.texto}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="h-11 flex-1"
                  disabled={!puedeGuardar}
                  onClick={() => cantidad !== null && guardar.mutate({ id: productoId, cantidad, unidad }, cerrarAlTerminar)}
                >
                  Guardar
                </Button>
                {guardada !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11"
                    disabled={guardar.isPending}
                    onClick={() => guardar.mutate({ id: productoId, cantidad: null, unidad: null }, cerrarAlTerminar)}
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
            </PopoverContent>
          </Popover>
        </>
      )}
    </section>
  );
}
