import { useState } from "react";
import { Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsignarLineas, useClasificarConIA, useLineasProducto } from "@/hooks/useProductosCatalogo";
import type { CategoriaProducto, ResumenProducto } from "@/lib/facturas/productos";
import { ListaLineas } from "./ListaLineas";
import { SelectorProducto } from "./SelectorProducto";

/**
 * Líneas que todavía no tienen producto: las nuevas que no coinciden con
 * ningún texto conocido, mientras la IA no las clasifica (cron cada 5 min o el
 * botón). Se pueden asignar a mano.
 */
export function LineasSinClasificar({
  catalogo,
  categorias,
  puedeEditar,
}: {
  catalogo: ResumenProducto[];
  categorias: CategoriaProducto[];
  puedeEditar: boolean;
}) {
  const { data: lineas = [], isLoading, error } = useLineasProducto("sin");
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [eligiendo, setEligiendo] = useState(false);
  const asignar = useAsignarLineas();
  const clasificar = useClasificarConIA();

  const alternar = (id: number) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const asignarA = async (a: { productoId?: number; nombreNuevo?: string; categoriaId?: number | null }) => {
    await asignar.mutateAsync({ lineaIds: [...seleccion], ...a });
    setSeleccion(new Set());
    setEligiendo(false);
  };
  const primera = lineas.find((l) => seleccion.has(l.id));

  if (isLoading) return <p className="p-3 text-sm text-muted-foreground">Cargando líneas sin clasificar…</p>;
  if (error) return <p className="p-3 text-sm text-destructive">No se han podido leer las líneas sin clasificar.</p>;

  return (
    <div className="space-y-3 p-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {lineas.length === 0
            ? "Todas las líneas tienen producto."
            : `${lineas.length} línea(s) sin producto. Las nuevas se clasifican solas con IA cada pocos minutos.`}
        </p>
        {puedeEditar && lineas.length > 0 && (
          <Button variant="outline" disabled={clasificar.isPending} onClick={() => clasificar.mutate()}>
            <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
            {clasificar.isPending ? "Clasificando…" : "Clasificar con IA ahora"}
          </Button>
        )}
        {puedeEditar && seleccion.size > 0 && (
          <Button onClick={() => setEligiendo((v) => !v)}>
            <Tag className="mr-1 h-4 w-4" aria-hidden="true" /> Asignar {seleccion.size} a un producto
          </Button>
        )}
      </div>
      {eligiendo && seleccion.size > 0 && (
        <SelectorProducto
          key={primera?.id}
          catalogo={catalogo}
          categorias={categorias}
          textoInicial={primera?.nombre ?? ""}
          ocupado={asignar.isPending}
          onElegir={(p) => void asignarA({ productoId: p })}
          onCrear={(n, c) => void asignarA({ nombreNuevo: n, categoriaId: c })}
        />
      )}
      <ListaLineas lineas={lineas} seleccion={seleccion} onAlternar={alternar} conCasillas={puedeEditar} />
    </div>
  );
}
