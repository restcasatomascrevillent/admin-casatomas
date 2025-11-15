import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { PlatoForm } from "@/components/carta/PlatoForm";
import { BebidaForm } from "@/components/carta/BebidaForm";
import { VinoForm } from "@/components/carta/VinoForm";
import { ListaPlatos } from "@/components/carta/ListaPlatos";
import { ListaBebidas } from "@/components/carta/ListaBebidas";
import { ListaVinos } from "@/components/carta/ListaVinos";

export default function GestorCarta() {
  const { platos, isLoading: isLoadingPlatos, categorias: categoriasPlatos } = usePlatos();
  const { bebidas, isLoading: isLoadingBebidas, categorias: categoriasBebidas } = useBebidas();
  const { vinos, isLoading: isLoadingVinos, categorias: categoriasVinos } = useVinos();

  const [seccionActiva, setSeccionActiva] = useState<"platos" | "bebidas" | "vinos">("platos");
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string>("");
  
  const [dialogPlatoOpen, setDialogPlatoOpen] = useState(false);
  const [dialogBebidaOpen, setDialogBebidaOpen] = useState(false);
  const [dialogVinoOpen, setDialogVinoOpen] = useState(false);

  const isLoading = isLoadingPlatos || isLoadingBebidas || isLoadingVinos;

  const getPlatosPorCategoria = (categoria: string) => {
    return platos?.filter((p) => p.categoria === categoria) || [];
  };

  const getBebidasPorCategoria = (categoria: string) => {
    return bebidas?.filter((b) => b.categoria === categoria) || [];
  };

  const getVinosPorCategoria = (categoria: string) => {
    return vinos?.filter((v) => v.categoria === categoria) || [];
  };

  const handleAñadir = () => {
    if (seccionActiva === "platos") {
      setDialogPlatoOpen(true);
    } else if (seccionActiva === "bebidas") {
      setDialogBebidaOpen(true);
    } else {
      setDialogVinoOpen(true);
    }
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
              Gestiona el menú, bebidas y vinos de tu restaurante
            </p>
          </div>
          <Button onClick={handleAñadir}>
            <Plus className="mr-2 h-4 w-4" />
            Añadir
          </Button>
        </div>

        <Tabs 
          defaultValue="platos" 
          className="w-full"
          onValueChange={(value) => setSeccionActiva(value as "platos" | "bebidas" | "vinos")}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="platos">Platos</TabsTrigger>
            <TabsTrigger value="bebidas">Bebidas</TabsTrigger>
            <TabsTrigger value="vinos">Vinos</TabsTrigger>
          </TabsList>

          {/* PLATOS */}
          <TabsContent value="platos" className="space-y-4">
            {categoriasPlatos.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    No hay platos todavía. Haz clic en "Añadir" para comenzar.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Tabs 
                defaultValue={categoriasPlatos[0]} 
                className="w-full"
                onValueChange={setCategoriaSeleccionada}
              >
                <TabsList className="w-full flex flex-wrap justify-start">
                  {categoriasPlatos.map((categoria) => (
                    <TabsTrigger key={categoria} value={categoria || ""} className="capitalize">
                      {categoria}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {categoriasPlatos.map((categoria) => (
                  <TabsContent key={categoria} value={categoria || ""} className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="capitalize">{categoria}</CardTitle>
                        <CardDescription>
                          Gestiona los platos de {categoria}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ListaPlatos platos={getPlatosPorCategoria(categoria || "")} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </TabsContent>

          {/* BEBIDAS */}
          <TabsContent value="bebidas" className="space-y-4">
            {categoriasBebidas.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    No hay bebidas todavía. Haz clic en "Añadir" para comenzar.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Tabs 
                defaultValue={categoriasBebidas[0]} 
                className="w-full"
                onValueChange={setCategoriaSeleccionada}
              >
                <TabsList className="w-full flex flex-wrap justify-start">
                  {categoriasBebidas.map((categoria) => (
                    <TabsTrigger key={categoria} value={categoria || ""} className="capitalize">
                      {categoria}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {categoriasBebidas.map((categoria) => (
                  <TabsContent key={categoria} value={categoria || ""} className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="capitalize">{categoria}</CardTitle>
                        <CardDescription>
                          Gestiona las bebidas de {categoria}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ListaBebidas bebidas={getBebidasPorCategoria(categoria || "")} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </TabsContent>

          {/* VINOS */}
          <TabsContent value="vinos" className="space-y-4">
            {categoriasVinos.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    No hay vinos todavía. Haz clic en "Añadir" para comenzar.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Tabs 
                defaultValue={categoriasVinos[0]} 
                className="w-full"
                onValueChange={setCategoriaSeleccionada}
              >
                <TabsList className="w-full flex flex-wrap justify-start">
                  {categoriasVinos.map((categoria) => (
                    <TabsTrigger key={categoria} value={categoria || ""} className="capitalize">
                      {categoria}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {categoriasVinos.map((categoria) => (
                  <TabsContent key={categoria} value={categoria || ""} className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="capitalize">{categoria}</CardTitle>
                        <CardDescription>
                          Gestiona los vinos de {categoria}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ListaVinos vinos={getVinosPorCategoria(categoria || "")} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </TabsContent>
        </Tabs>

        <PlatoForm 
          open={dialogPlatoOpen} 
          onOpenChange={setDialogPlatoOpen}
          categoriaInicial={categoriaSeleccionada}
        />
        <BebidaForm 
          open={dialogBebidaOpen} 
          onOpenChange={setDialogBebidaOpen}
          categoriaInicial={categoriaSeleccionada}
        />
        <VinoForm 
          open={dialogVinoOpen} 
          onOpenChange={setDialogVinoOpen}
          categoriaInicial={categoriaSeleccionada}
        />
      </div>
    </DashboardLayout>
  );
}
