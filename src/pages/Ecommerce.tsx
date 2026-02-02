import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Wine, Beef } from "lucide-react";
import { useBebidasVenta } from "@/hooks/useBebidasVenta";
import { useComidaVenta } from "@/hooks/useComidaVenta";
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
  "Espumosos",
  "Whisky",
];

const CATEGORIAS_COMIDA = [
  "Jamón",
  "Lomo Embuchado",
  "Chorizo",
  "Quesos",
];

export default function Ecommerce() {
  const [activeTab, setActiveTab] = useState("bebidas");
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Ecommerce</h1>
            <p className="text-muted-foreground">
              Gestiona los productos para la tienda online
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Añadir {activeTab === "bebidas" ? "Bebida" : "Comida"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              {activeTab === "bebidas" ? (
                <BebidaVentaForm onSuccess={() => setDialogOpen(false)} />
              ) : (
                <ComidaVentaForm onSuccess={() => setDialogOpen(false)} />
              )}
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <TabsList>
              <TabsTrigger value="bebidas" className="gap-2">
                <Wine className="h-4 w-4" />
                Bebidas
              </TabsTrigger>
              <TabsTrigger value="comida" className="gap-2">
                <Beef className="h-4 w-4" />
                Comida
              </TabsTrigger>
            </TabsList>

            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
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
          </div>

          <TabsContent value="bebidas" className="mt-6">
            {loadingBebidas ? (
              <div className="text-center py-12 text-muted-foreground">Cargando bebidas...</div>
            ) : (
              <ListaBebidasVenta 
                bebidas={bebidas} 
                busqueda={busqueda} 
                categoriaFiltro={categoriaFiltro} 
              />
            )}
          </TabsContent>

          <TabsContent value="comida" className="mt-6">
            {loadingComidas ? (
              <div className="text-center py-12 text-muted-foreground">Cargando productos...</div>
            ) : (
              <ListaComidaVenta 
                comidas={comidas} 
                busqueda={busqueda} 
                categoriaFiltro={categoriaFiltro} 
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
