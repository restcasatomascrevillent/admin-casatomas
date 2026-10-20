import { ListaPlana } from "@/components/panel/ListaPlana";
import { useComidaVenta, ComidaVenta } from "@/hooks/useComidaVenta";
import { FilaProductoVenta } from "@/components/ecommerce/FilaProductoVenta";
import { formatearPrecio, rentabilidadProducto } from "@/components/ecommerce/formatoProducto";

interface Props {
  comidas: ComidaVenta[];
  busqueda: string;
  categoriaFiltro: string;
  onEdit?: (comida: ComidaVenta) => void;
}

export function ListaComidaVenta({ comidas, busqueda, categoriaFiltro, onEdit }: Props) {
  const { deleteComida, toggleActivado, toggleFeatured } = useComidaVenta();

  const filtradas = comidas.filter((comida) => {
    const matchBusqueda =
      !busqueda ||
      comida.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      comida.descripcion?.toLowerCase().includes(busqueda.toLowerCase());
    const matchCategoria = !categoriaFiltro || comida.categoria === categoriaFiltro;
    return matchBusqueda && matchCategoria;
  });

  if (filtradas.length === 0) {
    return <div className="py-12 text-center text-muted-foreground">No hay productos que coincidan con los filtros</div>;
  }

  return (
    <ListaPlana aria-label="Comida">
      {filtradas.map((comida) => (
        <FilaProductoVenta
          key={comida.id}
          tipo="comida"
          nombre={comida.nombre}
          imagenUrl={comida.imagen_url}
          detalles={[
            comida.categoria,
            comida.peso,
            `${comida.stock ?? 0} uds`,
            comida.origen && `Origen ${comida.origen}`,
            rentabilidadProducto(comida.precio_coste, comida.precio_eur),
          ]}
          precio={formatearPrecio(comida.precio_eur)}
          activo={comida.activado ?? false}
          destacado={comida.featured ?? false}
          stockBajo={!(comida.stock && comida.stock > 5)}
          onEditar={() => onEdit?.(comida)}
          onCambiarActivo={(v) => toggleActivado(comida.id, v)}
          onCambiarDestacado={(v) => toggleFeatured(comida.id, v)}
          onEliminar={() => deleteComida.mutate(comida.id)}
        />
      ))}
    </ListaPlana>
  );
}
