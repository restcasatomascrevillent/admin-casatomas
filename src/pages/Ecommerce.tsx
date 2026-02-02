import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, Package, ShoppingCart, Boxes, Users, BarChart3 } from "lucide-react";
import { DashboardEcommerce } from "@/components/ecommerce/dashboard/DashboardEcommerce";
import { SeccionProductos } from "@/components/ecommerce/productos/SeccionProductos";
import { ListaPedidos } from "@/components/ecommerce/pedidos/ListaPedidos";
import { TablaStock } from "@/components/ecommerce/stock/TablaStock";
import { HistorialMovimientos } from "@/components/ecommerce/stock/HistorialMovimientos";

export default function Ecommerce() {
  const [seccionActiva, setSeccionActiva] = useState("dashboard");
  const [subSeccionStock, setSubSeccionStock] = useState("inventario");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Ecommerce</h1>
          <p className="text-muted-foreground">
            Gestiona tu tienda online: productos, pedidos, stock y analíticas
          </p>
        </div>

        <Tabs value={seccionActiva} onValueChange={setSeccionActiva}>
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 h-auto">
            <TabsTrigger value="dashboard" className="gap-2 py-2">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="productos" className="gap-2 py-2">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Productos</span>
            </TabsTrigger>
            <TabsTrigger value="pedidos" className="gap-2 py-2">
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">Pedidos</span>
            </TabsTrigger>
            <TabsTrigger value="stock" className="gap-2 py-2">
              <Boxes className="h-4 w-4" />
              <span className="hidden sm:inline">Stock</span>
            </TabsTrigger>
            <TabsTrigger value="clientes" className="gap-2 py-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Clientes</span>
            </TabsTrigger>
            <TabsTrigger value="analiticas" className="gap-2 py-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Analíticas</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-6">
            <DashboardEcommerce />
          </TabsContent>

          <TabsContent value="productos" className="mt-6">
            <SeccionProductos />
          </TabsContent>

          <TabsContent value="pedidos" className="mt-6">
            <ListaPedidos />
          </TabsContent>

          <TabsContent value="stock" className="mt-6">
            <Tabs value={subSeccionStock} onValueChange={setSubSeccionStock}>
              <TabsList>
                <TabsTrigger value="inventario">Inventario</TabsTrigger>
                <TabsTrigger value="movimientos">Historial</TabsTrigger>
              </TabsList>
              <TabsContent value="inventario" className="mt-4">
                <TablaStock />
              </TabsContent>
              <TabsContent value="movimientos" className="mt-4">
                <HistorialMovimientos />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="clientes" className="mt-6">
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Gestión de Clientes</h3>
              <p className="text-sm">Próximamente: historial de compras, segmentación y más</p>
            </div>
          </TabsContent>

          <TabsContent value="analiticas" className="mt-6">
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Analíticas Avanzadas</h3>
              <p className="text-sm">Próximamente: márgenes, tendencias, comparativas y más</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
