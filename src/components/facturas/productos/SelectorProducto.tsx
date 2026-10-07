import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  indexarCategorias,
  normalizarBusqueda,
  rutaCategoria,
  type CategoriaProducto,
  type ResumenProducto,
} from "@/lib/facturas/productos";
import { SelectorCategoria } from "./SelectorCategoria";

/**
 * Elegir el producto al que van unas líneas: uno del catálogo (buscando) o uno
 * NUEVO con el nombre escrito y su categoría.
 */
export function SelectorProducto({
  catalogo,
  categorias,
  excluir,
  textoInicial = "",
  ocupado,
  onElegir,
  onCrear,
}: {
  catalogo: ResumenProducto[];
  categorias: CategoriaProducto[];
  /** Producto que no se ofrece (el actual). */
  excluir?: number | null;
  textoInicial?: string;
  ocupado?: boolean;
  onElegir: (productoId: number) => void;
  onCrear: (nombre: string, categoriaId: number | null) => void;
}) {
  const [texto, setTexto] = useState(textoInicial);
  const [categoriaNueva, setCategoriaNueva] = useState<number | null>(null);
  const mapa = useMemo(() => indexarCategorias(categorias), [categorias]);
  const q = normalizarBusqueda(texto);
  const resultados = useMemo(
    () =>
      catalogo
        .filter((p) => p.producto_id !== excluir && (!q || normalizarBusqueda(p.nombre).includes(q)))
        .slice(0, 40),
    [catalogo, excluir, q],
  );
  const existeExacto = catalogo.some((p) => normalizarBusqueda(p.nombre) === q);
  const nombreNuevo = texto.replace(/\s+/g, " ").trim();

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar producto o escribir uno nuevo"
          aria-label="Buscar producto"
          className="pl-9"
          autoFocus
        />
      </div>
      <ul className="max-h-64 min-h-0 overflow-y-auto rounded-md border divide-y" aria-label="Productos del catálogo">
        {resultados.map((p) => (
          <li key={p.producto_id}>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onElegir(p.producto_id)}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
            >
              <span className="min-w-0 truncate font-medium">{p.nombre}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{rutaCategoria(mapa, p.categoria_id) ?? "Sin categoría"}</span>
            </button>
          </li>
        ))}
        {resultados.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Ninguno coincide.</li>}
      </ul>
      {nombreNuevo && !existeExacto && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2 sm:flex-row sm:items-center">
          <SelectorCategoria
            categorias={categorias}
            valor={categoriaNueva}
            onCambiar={setCategoriaNueva}
            etiqueta="Categoría del producto nuevo"
            className="sm:w-64"
          />
          <Button type="button" disabled={ocupado} onClick={() => onCrear(nombreNuevo, categoriaNueva)} className="sm:flex-1">
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            <span className="truncate">Crear «{nombreNuevo}»</span>
          </Button>
        </div>
      )}
    </div>
  );
}
