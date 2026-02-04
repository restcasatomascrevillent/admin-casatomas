import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, ShoppingCart, Boxes, Users, BarChart3, Receipt } from "lucide-react";
import { TPVContainer } from "@/components/ecommerce/tpv/TPVContainer";
import { SeccionProductos } from "@/components/ecommerce/productos/SeccionProductos";
import { ListaPedidos } from "@/components/ecommerce/pedidos/ListaPedidos";
import { TablaStock } from "@/components/ecommerce/stock/TablaStock";
import { HistorialMovimientos } from "@/components/ecommerce/stock/HistorialMovimientos";
import { SeccionAnaliticas } from "@/components/ecommerce/analiticas/SeccionAnaliticas";
import { cn } from "@/lib/utils";

export default function Ecommerce() {
  const [seccionActiva, setSeccionActiva] = useState("productos");
  const [subSeccionStock, setSubSeccionStock] = useState("inventario");

  const isTPV = useMemo(() => seccionActiva === "tpv", [seccionActiva]);

  return (
    <DashboardLayout>
      <div className={cn(isTPV ? "h-full min-h-0 flex flex-col" : "space-y-6")}>
        <div className={cn(isTPV ? "shrink-0" : "")}>
          <h1 className="text-3xl font-bold">Ecommerce</h1>
          <p className="text-muted-foreground">
            Gestiona tu tienda online: productos, pedidos, stock y analíticas
          </p>
        </div>

        <Tabs
          value={seccionActiva}
          onValueChange={setSeccionActiva}
          className={cn(isTPV ? "flex-1 min-h-0 flex flex-col" : "")}
        >
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 h-auto">
            <TabsTrigger value="tpv" className="gap-2 py-2">
              <Receipt className="h-4 w-4" />
              <span className="hidden sm:inline">TPV</span>
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

          <TabsContent
            value="tpv"
            className={cn("mt-6", isTPV ? "flex-1 min-h-0 overflow-hidden" : "")}
          >
            <TPVContainer />
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
            <SeccionAnaliticas />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}