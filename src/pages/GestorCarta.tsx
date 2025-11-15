import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlatos } from "@/hooks/usePlatos";
import { PlatoForm } from "@/components/carta/PlatoForm";
import { ListaPlatos } from "@/components/carta/ListaPlatos";

export default function GestorCarta() {
  const { platos, isLoading, categorias } = usePlatos();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string>("entrantes");

  const categoriasDisponibles = ["entrantes", "principales", "postres", "bebidas", "especiales"];
  
  const getPlatosPorCategoria = (categoria: string) => {
    return platos?.filter((p) => p.categoria === categoria) || [];
  };

  const handleAñadirPlato = () => {
    setDialogOpen(true);
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestor de Carta</h2>
            <p className="text-muted-foreground">
              Gestiona el menú y los platos de tu restaurante
            </p>
          </div>
          <Button onClick={handleAñadirPlato}>
            <Plus className="mr-2 h-4 w-4" />
            Añadir Plato
          </Button>
        </div>

        <Tabs 
          defaultValue="entrantes" 
          className="w-full"
          onValueChange={setCategoriaSeleccionada}
        >
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="entrantes">Entrantes</TabsTrigger>
            <TabsTrigger value="principales">Principales</TabsTrigger>
            <TabsTrigger value="postres">Postres</TabsTrigger>
            <TabsTrigger value="bebidas">Bebidas</TabsTrigger>
            <TabsTrigger value="especiales">Especiales</TabsTrigger>
          </TabsList>

          {categoriasDisponibles.map((categoria) => (
            <TabsContent key={categoria} value={categoria} className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="capitalize">{categoria}</CardTitle>
                  <CardDescription>
                    Gestiona los {categoria} de tu carta
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ListaPlatos platos={getPlatosPorCategoria(categoria)} />
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        <PlatoForm 
          open={dialogOpen} 
          onOpenChange={setDialogOpen}
          categoriaInicial={categoriaSeleccionada}
        />
      </div>
    </DashboardLayout>
  );
}
