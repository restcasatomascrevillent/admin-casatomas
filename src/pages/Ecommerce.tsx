import { useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { Package, ShoppingCart, Boxes, Users, BarChart3, Receipt } from "lucide-react";
import { TPVContainer } from "@/components/ecommerce/tpv/TPVContainer";
import { SeccionProductos } from "@/components/ecommerce/productos/SeccionProductos";
import { ListaPedidos } from "@/components/ecommerce/pedidos/ListaPedidos";
import { TablaStock } from "@/components/ecommerce/stock/TablaStock";
import { HistorialMovimientos } from "@/components/ecommerce/stock/HistorialMovimientos";
import { SeccionAnaliticas } from "@/components/ecommerce/analiticas/SeccionAnaliticas";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la página: por debajo (móvil apaisado, teclado
 * abierto) deja de encoger y la página hace scroll. Con 420 px caben la barra
 * de pestañas, los filtros y unas cuantas filas de la tabla, o la barra
 * «Cobrar» del TPV con algo de catálogo encima.
 */
const ALTURA_MINIMA_ECOMMERCE = 420;

/**
 * Contenido de cada pestaña: se queda con el alto que deja la barra de
 * pestañas (`flex-1 min-h-0`). `data-[state=inactive]:hidden` imprescindible
 * (como en Marketing y Facturas): Radix deja montadas las pestañas inactivas
 * con el atributo `hidden`, y un `flex` le gana a ese atributo — la pestaña
 * oculta seguiría ocupando sitio.
 */
const CONTENIDO_PESTANA = "mt-3 min-h-0 flex-1 data-[state=inactive]:hidden";
/** TPV, Productos, Pedidos y Stock reparten el alto por dentro: filtros fijos arriba y la tabla o la rejilla con su propio scroll. */
const PESTANA_REPARTIDA = `${CONTENIDO_PESTANA} flex flex-col`;
/** Clientes y Analíticas: la pestaña entera desplaza por dentro; la barra de pestañas se queda fija. */
const PESTANA_CON_SCROLL = `${CONTENIDO_PESTANA} overflow-y-auto overscroll-contain`;
/** Inventario e Historial (dentro de Stock): igual, bajo su propia fila de pestañas. */
const SUBPESTANA_STOCK = "mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden";

export default function Ecommerce() {
  const [seccionActiva, setSeccionActiva] = useState("productos");
  const [subSeccionStock, setSubSeccionStock] = useState("inventario");

  // Alto de la pantalla, sin scroll de página (regla del dueño para todo el
  // panel, uso en tablet): el mismo patrón que Newsletter y Facturas
  // (`useAlturaDisponible`: alto del viewport visual − posición del bloque −
  // relleno del <main>, recalculado al redimensionar, girar la tablet, abrir el
  // teclado o plegar el menú). La barra de pestañas queda fija arriba y cada
  // pestaña usa el resto: las tablas y la rejilla de productos hacen scroll por
  // dentro y la barra «Cobrar» del TPV queda siempre a la vista. Antes solo el
  // TPV intentaba ocupar el alto (`h-full`), pero sin un alto real arriba no
  // servía. Sin medida (jsdom, primer pintado sin layout) cae al layout de
  // siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_ECOMMERCE);

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        data-testid="ecommerce"
        className="flex flex-col"
        style={alto ? { height: alto } : undefined}
      >
        {/* Sin título de página (2026-09-25): la pestaña "Ecommerce" activa en
            el menú lateral ya dice dónde estás, y el subtítulo repetía las
            pestañas de abajo (Productos, Pedidos, Stock...). */}

        <Tabs
          value={seccionActiva}
          onValueChange={setSeccionActiva}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Un solo nivel de pestañas (PestanasPagina, como Facturas); Inventario/Historial y Bebidas/Comida son
              chips dentro de su pestaña. */}
          <PestanasPagina
            pestanas={[
              { valor: "tpv", etiqueta: "TPV", icono: <Receipt /> },
              { valor: "productos", etiqueta: "Productos", icono: <Package /> },
              { valor: "pedidos", etiqueta: "Pedidos", icono: <ShoppingCart /> },
              { valor: "stock", etiqueta: "Stock", icono: <Boxes /> },
              { valor: "clientes", etiqueta: "Clientes", icono: <Users /> },
              { valor: "analiticas", etiqueta: "Analíticas", icono: <BarChart3 /> },
            ]}
          />

          <TabsContent value="tpv" className={`${PESTANA_REPARTIDA} overflow-hidden`}>
            <TPVContainer />
          </TabsContent>

          <TabsContent value="productos" className={PESTANA_REPARTIDA}>
            <SeccionProductos />
          </TabsContent>

          <TabsContent value="pedidos" className={PESTANA_REPARTIDA}>
            <ListaPedidos />
          </TabsContent>

          <TabsContent value="stock" className={PESTANA_REPARTIDA}>
            <Tabs
              value={subSeccionStock}
              onValueChange={setSubSeccionStock}
              className="flex min-h-0 flex-1 flex-col"
            >
              <ChipsSubnivel
                chips={[
                  { valor: "inventario", etiqueta: "Inventario" },
                  { valor: "movimientos", etiqueta: "Historial" },
                ]}
              />
              <TabsContent value="inventario" className={SUBPESTANA_STOCK}>
                <TablaStock />
              </TabsContent>
              <TabsContent value="movimientos" className={SUBPESTANA_STOCK}>
                <HistorialMovimientos />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="clientes" className={PESTANA_CON_SCROLL}>
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Gestión de Clientes</h3>
              <p className="text-sm">Próximamente: historial de compras, segmentación y más</p>
            </div>
          </TabsContent>

          <TabsContent value="analiticas" className={PESTANA_CON_SCROLL}>
            <SeccionAnaliticas />
          </TabsContent>
        </Tabs>
      </div>
    </SuperAdminLayout>
  );
}
