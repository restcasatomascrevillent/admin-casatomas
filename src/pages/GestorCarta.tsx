import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, ChefHat } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function GestorCarta() {
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
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Añadir Plato
          </Button>
        </div>

        <Tabs defaultValue="entrantes" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="entrantes">Entrantes</TabsTrigger>
            <TabsTrigger value="principales">Principales</TabsTrigger>
            <TabsTrigger value="postres">Postres</TabsTrigger>
            <TabsTrigger value="bebidas">Bebidas</TabsTrigger>
            <TabsTrigger value="especiales">Especiales</TabsTrigger>
          </TabsList>

          <TabsContent value="entrantes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Entrantes</CardTitle>
                <CardDescription>
                  Gestiona los entrantes de tu carta
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <ChefHat className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      No hay platos todavía. Haz clic en "Añadir Plato" para comenzar.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="principales" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Platos Principales</CardTitle>
                <CardDescription>
                  Gestiona los platos principales de tu carta
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <ChefHat className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      No hay platos todavía. Haz clic en "Añadir Plato" para comenzar.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="postres" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Postres</CardTitle>
                <CardDescription>
                  Gestiona los postres de tu carta
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <ChefHat className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      No hay platos todavía. Haz clic en "Añadir Plato" para comenzar.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bebidas" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Bebidas</CardTitle>
                <CardDescription>
                  Gestiona las bebidas de tu carta
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <ChefHat className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      No hay bebidas todavía. Haz clic en "Añadir Plato" para comenzar.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="especiales" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Platos Especiales</CardTitle>
                <CardDescription>
                  Gestiona los platos especiales del día o temporada
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <ChefHat className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      No hay platos especiales todavía. Haz clic en "Añadir Plato" para comenzar.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
