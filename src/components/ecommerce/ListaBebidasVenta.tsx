import { ListaPlana } from "@/components/panel/ListaPlana";
import { useBebidasVenta, BebidaVenta } from "@/hooks/useBebidasVenta";
import { FilaProductoVenta } from "@/components/ecommerce/FilaProductoVenta";
import { formatearPrecio, rentabilidadProducto } from "@/components/ecommerce/formatoProducto";

interface Props {
  bebidas: BebidaVenta[];
  busqueda: string;
  categoriaFiltro: string;
  onEdit?: (bebida: BebidaVenta) => void;
}

export function ListaBebidasVenta({ bebidas, busqueda, categoriaFiltro, onEdit }: Props) {
  const { deleteBebida, toggleActivado, toggleFeatured } = useBebidasVenta();

  const filtradas = bebidas.filter((bebida) => {
    const matchBusqueda =
      !busqueda ||
      bebida.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      bebida.descripcion?.toLowerCase().includes(busqueda.toLowerCase());
    const matchCategoria = !categoriaFiltro || bebida.categoria === categoriaFiltro;
    return matchBusqueda && matchCategoria;
  });

  if (filtradas.length === 0) {
    return <div className="py-12 text-center text-muted-foreground">No hay bebidas que coincidan con los filtros</div>;
  }

  return (
    <ListaPlana aria-label="Bebidas">
      {filtradas.map((bebida) => (
        <FilaProductoVenta
          key={bebida.id}
          tipo="bebida"
          nombre={bebida.nombre}
          imagenUrl={bebida.imagen_url}
          detalles={[
            bebida.categoria,
            `${bebida.stock ?? 0} uds`,
            [bebida.denominacion_origen, bebida.ubicacion_region].filter(Boolean).join(", "),
            rentabilidadProducto(bebida.precio_coste, bebida.precio_eur),
          ]}
          precio={formatearPrecio(bebida.precio_eur)}
          activo={bebida.activado ?? false}
          destacado={bebida.featured ?? false}
          stockBajo={!(bebida.stock && bebida.stock > 5)}
          onEditar={() => onEdit?.(bebida)}
          onCambiarActivo={(v) => toggleActivado(bebida.id, v)}
          onCambiarDestacado={(v) => toggleFeatured(bebida.id, v)}
          onEliminar={() => deleteBebida.mutate(bebida.id)}
        />
      ))}
    </ListaPlana>
  );
}
