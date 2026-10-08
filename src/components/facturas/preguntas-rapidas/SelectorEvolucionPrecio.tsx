// «Evolución de precio»: antes de consultar hay que elegir de qué producto.
// El botón de la botonera abre este selector (buscador sobre `productos_catalogo`
// + unidad opcional) y al confirmar se llama a la RPC como cualquier otra pregunta.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizarBusqueda } from "@/lib/facturas/productos";
import type { ParametrosEvolucionPrecio } from "@/lib/facturas/preguntasRapidas";

interface ProductoCatalogo {
  id: number;
  nombre: string;
  unidad_habitual: string | null;
}

const MAX_VISIBLES = 40;

function useProductosParaSelector(activo: boolean) {
  return useQuery({
    queryKey: ["productos", "selector-evolucion-precio"],
    enabled: activo,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<ProductoCatalogo[]> => {
      const { data, error } = await supabase
        .from("productos_catalogo")
        .select("id, nombre, unidad_habitual")
        .order("nombre", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as ProductoCatalogo[];
    },
  });
}

export function SelectorEvolucionPrecio({
  children,
  onElegir,
}: {
  /** El botón de la botonera (se usa como disparador del popover). */
  children: ReactNode;
  onElegir: (p: ParametrosEvolucionPrecio) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [producto, setProducto] = useState<ProductoCatalogo | null>(null);
  const [unidad, setUnidad] = useState("");
  const { data: catalogo = [], isLoading, isError } = useProductosParaSelector(abierto);

  const q = normalizarBusqueda(texto);
  const resultados = useMemo(
    () => catalogo.filter((p) => !q || normalizarBusqueda(p.nombre).includes(q)).slice(0, MAX_VISIBLES),
    [catalogo, q],
  );

  const confirmar = () => {
    if (!producto) return;
    onElegir({ producto: producto.nombre, unidad: unidad.trim() || null });
    setAbierto(false);
  };

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold">Evolución de precio</p>
          <p className="text-xs text-muted-foreground">Elige un producto del catálogo.</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setProducto(null);
            }}
            placeholder="Buscar producto"
            aria-label="Buscar producto"
            className="h-11 pl-9 text-base"
            autoFocus
          />
        </div>
        <ul className="max-h-52 overflow-y-auto rounded-md border divide-y" aria-label="Productos del catálogo">
          {isLoading && <li className="px-3 py-3 text-sm text-muted-foreground">Cargando…</li>}
          {isError && <li className="px-3 py-3 text-sm text-destructive">No se ha podido leer el catálogo.</li>}
          {!isLoading && !isError && resultados.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted-foreground">Ninguno coincide.</li>
          )}
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={producto?.id === p.id}
                onClick={() => {
                  setProducto(p);
                  setTexto(p.nombre);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50",
                  producto?.id === p.id && "bg-muted font-medium",
                )}
              >
                <span className="min-w-0 truncate">{p.nombre}</span>
                {p.unidad_habitual && <span className="shrink-0 text-xs text-muted-foreground">{p.unidad_habitual}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1">
          <label htmlFor="evolucion-unidad" className="text-xs font-medium text-muted-foreground">
            Unidad (opcional)
          </label>
          <Input
            id="evolucion-unidad"
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            placeholder="kg, l, ud… (vacío = todas)"
            className="h-11 text-base"
          />
        </div>
        <Button type="button" className="h-11 w-full" disabled={!producto} onClick={confirmar}>
          Ver evolución
        </Button>
      </PopoverContent>
    </Popover>
  );
}
