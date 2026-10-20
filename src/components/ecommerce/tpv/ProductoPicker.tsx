import { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Wine, Utensils, ChevronLeft, ChevronRight } from "lucide-react";
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
  const [pagina, setPagina] = useState(0);
  const PRODUCTOS_POR_PAGINA = 12;

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
            className="h-11 pl-9 text-base md:text-base"
            type="search"
            autoComplete="off"
            aria-label="Buscar producto"
          />
        </div>

        {/* Filtros de tipo */}
        <div className="flex gap-2">
          <Button
            variant={tipoFiltro === 'todos' ? 'default' : 'outline'}
            size="sm"
            className="h-11 px-4"
            onClick={() => { setTipoFiltro('todos'); setCategoriaFiltro(null); setPagina(0); }}
          >
            Todos
          </Button>
          <Button
            variant={tipoFiltro === 'bebida' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setTipoFiltro('bebida'); setCategoriaFiltro(null); setPagina(0); }}
            className="h-11 gap-1.5 px-4"
          >
            <Wine className="h-4 w-4" />
            Bebidas
          </Button>
          <Button
            variant={tipoFiltro === 'comida' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setTipoFiltro('comida'); setCategoriaFiltro(null); setPagina(0); }}
            className="h-11 gap-1.5 px-4"
          >
            <Utensils className="h-4 w-4" />
            Comida
          </Button>
        </div>

        {/* Filtros de categoría */}
        {categorias.length > 0 && (
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-2 pb-2">
              {/* Botones de 44 px (antes eran Badges de ~22 px con onClick) */}
              <Button
                type="button"
                size="sm"
                variant={categoriaFiltro === null ? "default" : "outline"}
                className="h-11 shrink-0 rounded-full px-4"
                onClick={() => { setCategoriaFiltro(null); setPagina(0); }}
              >
                Todas
              </Button>
              {categorias.map(cat => (
                <Button
                  key={cat}
                  type="button"
                  size="sm"
                  variant={categoriaFiltro === cat ? "default" : "outline"}
                  className="h-11 shrink-0 rounded-full px-4"
                  onClick={() => { setCategoriaFiltro(cat); setPagina(0); }}
                >
                  {cat}
                </Button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Grid de productos */}
      <div className="flex-1 flex flex-col min-h-0">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground">Cargando productos...</div>
        ) : productosDisponibles.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            No hay productos disponibles
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 p-3 content-start overflow-y-auto">
              {productosDisponibles
                .slice(pagina * PRODUCTOS_POR_PAGINA, (pagina + 1) * PRODUCTOS_POR_PAGINA)
                .map((producto) => (
                <button
                  type="button"
                  key={`${producto.tipo}-${producto.id}`}
                  onClick={() => handleSelectProducto(producto)}
                  className="flex flex-col items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent transition-colors text-left h-[130px] w-full"
                >
                  <div className="w-10 h-10 shrink-0 rounded-md overflow-hidden mb-1">
                    {producto.imagen_url ? (
                      <img
                        src={producto.imagen_url}
                        alt={producto.nombre}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        {producto.tipo === 'bebida' ? (
                          <Wine className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <Utensils className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-medium text-center line-clamp-1 mb-1">
                    {producto.nombre}
                  </span>
                  <span className="text-sm font-bold text-primary">
                    {formatCurrency(producto.precio_eur || 0)}
                  </span>
                  <Badge variant="secondary" className="text-xs mt-1">
                    Stock: {producto.stock}
                  </Badge>
                </button>
              ))}
            </div>
            {productosDisponibles.length > PRODUCTOS_POR_PAGINA && (
              <div className="flex items-center justify-between px-3 py-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 px-4"
                  disabled={pagina === 0}
                  onClick={() => setPagina(p => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
                </Button>
                <span className="text-sm text-muted-foreground">
                  {pagina + 1} / {Math.ceil(productosDisponibles.length / PRODUCTOS_POR_PAGINA)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 px-4"
                  disabled={(pagina + 1) * PRODUCTOS_POR_PAGINA >= productosDisponibles.length}
                  onClick={() => setPagina(p => p + 1)}
                >
                  Siguiente <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
