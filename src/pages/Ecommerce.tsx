import { useMemo, useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
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
    <SuperAdminLayout>
      <div className={cn(isTPV ? "h-full min-h-0 flex flex-col" : "space-y-6")}>
        {/* Sin título de página (2026-09-25): la pestaña "Ecommerce" activa en
            el menú lateral ya dice dónde estás, y el subtítulo repetía las
            pestañas de abajo (Productos, Pedidos, Stock...). */}

        <Tabs
          value={seccionActiva}
          onValueChange={setSeccionActiva}
          className={cn(isTPV ? "flex-1 min-h-0 flex flex-col" : "")}
        >
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 h-auto">
            <TabsTrigger value="tpv" className="min-h-11 gap-2 py-2">
              <Receipt className="h-4 w-4" />
              <span className="hidden sm:inline">TPV</span>
            </TabsTrigger>
            <TabsTrigger value="productos" className="min-h-11 gap-2 py-2">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Productos</span>
            </TabsTrigger>
            <TabsTrigger value="pedidos" className="min-h-11 gap-2 py-2">
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">Pedidos</span>
            </TabsTrigger>
            <TabsTrigger value="stock" className="min-h-11 gap-2 py-2">
              <Boxes className="h-4 w-4" />
              <span className="hidden sm:inline">Stock</span>
            </TabsTrigger>
            <TabsTrigger value="clientes" className="min-h-11 gap-2 py-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Clientes</span>
            </TabsTrigger>
            <TabsTrigger value="analiticas" className="min-h-11 gap-2 py-2">
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
                <TabsTrigger value="inventario" className="min-h-11 px-4">Inventario</TabsTrigger>
                <TabsTrigger value="movimientos" className="min-h-11 px-4">Historial</TabsTrigger>
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
    </SuperAdminLayout>
  );
}