import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Wine, Utensils } from "lucide-react";
import { useBebidasVenta, BebidaVenta } from "@/hooks/useBebidasVenta";
import { useComidaVenta, ComidaVenta } from "@/hooks/useComidaVenta";
import { LineaTPV } from "@/hooks/useTPV";

interface ProductoPickerProps {
  onSelectProducto: (producto: Omit<LineaTPV, 'cantidad'>) => void;
}

type TipoProducto = 'todos' | 'bebida' | 'comida';

export function ProductoPicker({ onSelectProducto }: ProductoPickerProps) {
  const [busqueda, setBusqueda] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<TipoProducto>('todos');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string | null>(null);

  const { bebidas, isLoading: loadingBebidas } = useBebidasVenta();
  const { comidas, isLoading: loadingComidas } = useComidaVenta();

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

  // Combinar y filtrar productos
  const productosDisponibles = useMemo(() => {
    const bebidasActivas = bebidas
      .filter(b => b.activado && (b.stock ?? 0) > 0)
      .map(b => ({
        ...b,
        tipo: 'bebida' as const,
      }));

    const comidasActivas = comidas
      .filter(c => c.activado && (c.stock ?? 0) > 0)
      .map(c => ({
        ...c,
        tipo: 'comida' as const,
      }));

    let todos = [...bebidasActivas, ...comidasActivas];

    // Filtrar por tipo
    if (tipoFiltro !== 'todos') {
      todos = todos.filter(p => p.tipo === tipoFiltro);
    }

    // Filtrar por categoría
    if (categoriaFiltro) {
      todos = todos.filter(p => p.categoria === categoriaFiltro);
    }

    // Filtrar por búsqueda
    if (busqueda) {
      const term = busqueda.toLowerCase();
      todos = todos.filter(p => 
        p.nombre.toLowerCase().includes(term) ||
        p.categoria?.toLowerCase().includes(term)
      );
    }

    return todos;
  }, [bebidas, comidas, tipoFiltro, categoriaFiltro, busqueda]);

  // Obtener categorías disponibles
  const categorias = useMemo(() => {
    const cats = new Set<string>();
    
    if (tipoFiltro === 'todos' || tipoFiltro === 'bebida') {
      bebidas.filter(b => b.activado).forEach(b => b.categoria && cats.add(b.categoria));
    }
    if (tipoFiltro === 'todos' || tipoFiltro === 'comida') {
      comidas.filter(c => c.activado).forEach(c => c.categoria && cats.add(c.categoria));
    }
    
    return Array.from(cats).sort();
  }, [bebidas, comidas, tipoFiltro]);

  const handleSelectProducto = (producto: (BebidaVenta | ComidaVenta) & { tipo: 'bebida' | 'comida' }) => {
    onSelectProducto({
      producto_id: producto.id,
      producto_tipo: producto.tipo,
      nombre: producto.nombre,
      precio: producto.precio_eur || 0,
      imagen_url: producto.imagen_url,
    });
  };

  const isLoading = loadingBebidas || loadingComidas;

  return (
    <div className="flex flex-col h-full">
      {/* Barra de búsqueda */}
      <div className="p-4 border-b space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filtros de tipo */}
        <div className="flex gap-2">
          <Button
            variant={tipoFiltro === 'todos' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setTipoFiltro('todos'); setCategoriaFiltro(null); }}
          >
            Todos
          </Button>
          <Button
            variant={tipoFiltro === 'bebida' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setTipoFiltro('bebida'); setCategoriaFiltro(null); }}
            className="gap-1"
          >
            <Wine className="h-3 w-3" />
            Bebidas
          </Button>
          <Button
            variant={tipoFiltro === 'comida' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setTipoFiltro('comida'); setCategoriaFiltro(null); }}
            className="gap-1"
          >
            <Utensils className="h-3 w-3" />
            Comida
          </Button>
        </div>

        {/* Filtros de categoría */}
        {categorias.length > 0 && (
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-1 pb-2">
              <Badge
                variant={categoriaFiltro === null ? "default" : "outline"}
                className="cursor-pointer shrink-0"
                onClick={() => setCategoriaFiltro(null)}
              >
                Todas
              </Badge>
              {categorias.map(cat => (
                <Badge
                  key={cat}
                  variant={categoriaFiltro === cat ? "default" : "outline"}
                  className="cursor-pointer shrink-0"
                  onClick={() => setCategoriaFiltro(cat)}
                >
                  {cat}
                </Badge>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Grid de productos */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground">Cargando productos...</div>
        ) : productosDisponibles.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            No hay productos disponibles
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-4">
            {productosDisponibles.map((producto) => (
              <button
                key={`${producto.tipo}-${producto.id}`}
                onClick={() => handleSelectProducto(producto)}
                className="flex flex-col items-center p-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
              >
                {producto.imagen_url ? (
                  <img
                    src={producto.imagen_url}
                    alt={producto.nombre}
                    className="w-16 h-16 object-cover rounded-md mb-2"
                  />
                ) : (
                  <div className="w-16 h-16 bg-muted rounded-md mb-2 flex items-center justify-center">
                    {producto.tipo === 'bebida' ? (
                      <Wine className="h-6 w-6 text-muted-foreground" />
                    ) : (
                      <Utensils className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                )}
                <span className="text-xs font-medium text-center line-clamp-2 mb-1">
                  {producto.nombre}
                </span>
                <span className="text-sm font-bold text-primary">
                  {formatCurrency(producto.precio_eur || 0)}
                </span>
                <Badge variant="secondary" className="text-[10px] mt-1">
                  Stock: {producto.stock}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
