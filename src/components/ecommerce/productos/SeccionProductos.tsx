import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Wine, Beef } from "lucide-react";
import { useBebidasVenta, BebidaVenta } from "@/hooks/useBebidasVenta";
import { useComidaVenta, ComidaVenta } from "@/hooks/useComidaVenta";
import { BebidaVentaForm } from "@/components/ecommerce/BebidaVentaForm";
import { ComidaVentaForm } from "@/components/ecommerce/ComidaVentaForm";
import { ListaBebidasVenta } from "@/components/ecommerce/ListaBebidasVenta";
import { ListaComidaVenta } from "@/components/ecommerce/ListaComidaVenta";

const CATEGORIAS_BEBIDAS = [
  "Vinos Tintos",
  "Vinos Blancos",
  "Vinos Rosados",
  "Champagnes",
  "Cavas",
  "Whisky",
];

const CATEGORIAS_COMIDA = [
  "Jamón",
  "Lomo Embuchado",
  "Chorizo",
  "Quesos",
];

/** La rejilla de Bebidas/Comida: se queda con el alto que dejan los filtros y desplaza por dentro. */
const CONTENIDO_PRODUCTOS = "mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

export function SeccionProductos() {
  const [activeTab, setActiveTab] = useState("bebidas");
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  
  // Estado para edición
  const [bebidaEditando, setBebidaEditando] = useState<BebidaVenta | null>(null);
  const [comidaEditando, setComidaEditando] = useState<ComidaVenta | null>(null);

  const { bebidas, isLoading: loadingBebidas, categorias: categoriasBebidasDB } = useBebidasVenta();
  const { comidas, isLoading: loadingComidas, categorias: categoriasComidaDB } = useComidaVenta();

  const categoriasBebidas = [...new Set([...CATEGORIAS_BEBIDAS, ...categoriasBebidasDB])];
  const categoriasComida = [...new Set([...CATEGORIAS_COMIDA, ...categoriasComidaDB])];
  
  const categoriasActuales = activeTab === "bebidas" ? categoriasBebidas : categoriasComida;

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setCategoriaFiltro("");
    setBusqueda("");
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setBebidaEditando(null);
    setComidaEditando(null);
  };

  const handleEditBebida = (bebida: BebidaVenta) => {
    setBebidaEditando(bebida);
    setComidaEditando(null);
    setDialogOpen(true);
  };

  const handleEditComida = (comida: ComidaVenta) => {
    setComidaEditando(comida);
    setBebidaEditando(null);
    setDialogOpen(true);
  };

  const handleAddNew = () => {
    setBebidaEditando(null);
    setComidaEditando(null);
    setDialogOpen(true);
  };

  // Alto de la pantalla (Ecommerce.tsx le da el alto que queda bajo sus
  // pestañas): Bebidas/Comida, «Añadir» y los filtros se quedan fijos arriba y
  // la rejilla de productos hace scroll por dentro, sin scroll de página. Sin
  // alto medido todo crece como siempre.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <TabsList>
            <TabsTrigger value="bebidas" className="min-h-11 gap-2 px-4">
              <Wine className="h-4 w-4" />
              Bebidas
            </TabsTrigger>
            <TabsTrigger value="comida" className="min-h-11 gap-2 px-4">
              <Beef className="h-4 w-4" />
              Comida
            </TabsTrigger>
          </TabsList>

          <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleDialogClose(); else handleAddNew(); }}>
            <DialogTrigger asChild>
              <Button className="h-11 px-5" onClick={handleAddNew}>
                <Plus className="h-4 w-4 mr-2" />
                Añadir {activeTab === "bebidas" ? "Bebida" : "Comida"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
              {activeTab === "bebidas" ? (
                <BebidaVentaForm 
                  onSuccess={handleDialogClose} 
                  bebidaEditar={bebidaEditando}
                />
              ) : (
                <ComidaVentaForm 
                  onSuccess={handleDialogClose} 
                  comidaEditar={comidaEditando}
                />
              )}
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex shrink-0 flex-col sm:flex-row gap-2 mt-4">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar productos..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoriaFiltro || "all"} onValueChange={(v) => setCategoriaFiltro(v === "all" ? "" : v)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categoriasActuales.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* `data-[state=inactive]:hidden`: como en Ecommerce.tsx, que la pestaña oculta no ocupe sitio. */}
        <TabsContent value="bebidas" className={CONTENIDO_PRODUCTOS}>
          {loadingBebidas ? (
            <div className="text-center py-12 text-muted-foreground">Cargando bebidas...</div>
          ) : (
            <ListaBebidasVenta 
              bebidas={bebidas} 
              busqueda={busqueda} 
              categoriaFiltro={categoriaFiltro}
              onEdit={handleEditBebida}
            />
          )}
        </TabsContent>

        <TabsContent value="comida" className={CONTENIDO_PRODUCTOS}>
          {loadingComidas ? (
            <div className="text-center py-12 text-muted-foreground">Cargando productos...</div>
          ) : (
            <ListaComidaVenta 
              comidas={comidas} 
              busqueda={busqueda} 
              categoriaFiltro={categoriaFiltro}
              onEdit={handleEditComida}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
