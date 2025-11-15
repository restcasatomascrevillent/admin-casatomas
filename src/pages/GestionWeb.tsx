import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Eye, FileText, Image, Layout, Settings } from "lucide-react";

export default function GestionWeb() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Gestión Web</h2>
            <p className="text-muted-foreground">
              Gestiona el contenido y la configuración de tu sitio web
            </p>
          </div>
          <Button>
            <Eye className="mr-2 h-4 w-4" />
            Vista Previa
          </Button>
        </div>

        <Tabs defaultValue="contenido" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="contenido">Contenido</TabsTrigger>
            <TabsTrigger value="paginas">Páginas</TabsTrigger>
            <TabsTrigger value="imagenes">Imágenes</TabsTrigger>
            <TabsTrigger value="configuracion">Configuración</TabsTrigger>
          </TabsList>

          <TabsContent value="contenido" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Página Principal</CardTitle>
                    <Badge variant="secondary">Publicado</Badge>
                  </div>
                  <CardDescription>
                    Última actualización: Hoy, 10:30
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Gestiona el contenido de la página de inicio de tu restaurante
                  </p>
                  <Button variant="outline" className="w-full">
                    <FileText className="mr-2 h-4 w-4" />
                    Editar Contenido
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Sobre Nosotros</CardTitle>
                    <Badge variant="secondary">Publicado</Badge>
                  </div>
                  <CardDescription>
                    Última actualización: Ayer, 16:45
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Información sobre tu restaurante, historia y equipo
                  </p>
                  <Button variant="outline" className="w-full">
                    <FileText className="mr-2 h-4 w-4" />
                    Editar Contenido
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Nuestra Carta</CardTitle>
                    <Badge variant="secondary">Publicado</Badge>
                  </div>
                  <CardDescription>
                    Sincronizado automáticamente
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Muestra automáticamente los platos de tu carta
                  </p>
                  <Button variant="outline" className="w-full">
                    <Layout className="mr-2 h-4 w-4" />
                    Configurar Diseño
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Contacto</CardTitle>
                    <Badge variant="outline">Borrador</Badge>
                  </div>
                  <CardDescription>
                    Sin publicar
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Información de contacto, ubicación y horarios
                  </p>
                  <Button variant="outline" className="w-full">
                    <FileText className="mr-2 h-4 w-4" />
                    Editar Contenido
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="paginas" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Páginas del Sitio</CardTitle>
                <CardDescription>
                  Gestiona las páginas públicas de tu restaurante
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <Layout className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Próximamente: Editor de páginas personalizado
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="imagenes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Galería de Imágenes</CardTitle>
                <CardDescription>
                  Gestiona las imágenes de tu restaurante y platos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <Image className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Próximamente: Gestor de imágenes
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configuracion" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Configuración del Sitio</CardTitle>
                <CardDescription>
                  Ajustes generales de tu sitio web
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
                  <div className="text-center">
                    <Settings className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Próximamente: Panel de configuración
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
