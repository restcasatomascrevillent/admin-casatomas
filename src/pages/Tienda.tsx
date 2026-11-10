import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Settings2, Wine, WifiOff } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { VinosTienda } from "@/components/tienda/VinosTienda";
import { AjustesTienda } from "@/components/tienda/AjustesTienda";
import { InterruptorTiendaWeb } from "@/components/tienda/InterruptorTiendaWeb";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useConfiguracionTienda } from "@/hooks/useTienda";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { cn } from "@/lib/utils";

/** Suelo (px) del alto: por debajo (teclado abierto, ventana muy baja) vuelve el scroll de página. */
const ALTURA_MINIMA_TIENDA = 360;

/**
 * Contenido de cada pestaña: ocupa el alto que queda bajo la barra y hace scroll por dentro.
 * `data-[state=inactive]:hidden` imprescindible (como en Newsletter/Cheques): Radix deja montadas
 * las pestañas inactivas con `hidden`, y una clase `flex` le gana a ese atributo.
 */
const CONTENIDO_PESTANA = "mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

const PESTANAS = ["vinos", "ajustes"] as const;
type Pestana = (typeof PESTANAS)[number];
const pestanaDeUrl = (v: string | null): Pestana => (PESTANAS as readonly string[]).includes(v ?? "") ? (v as Pestana) : "vinos";

/**
 * Tienda (petición del dueño, 03/11/2026): los vinos de la carta en la web con
 * un descuento sobre el precio de carta. Es un ESCAPARATE («no puede permitir
 * pago por internet, solo vista»): se compran en el restaurante. Vinos (cuáles
 * salen y a qué precio) y Ajustes (%, aviso y cómo comprar). Arriba, junto a las
 * pestañas, el interruptor «Visible en la web» (10/11/2026, petición del dueño:
 * enciende o apaga la tienda de la web al momento; ver `InterruptorTiendaWeb`).
 * Sección de permisos «tienda»: con «Ver» se consulta; cambiar algo pide
 * «Puede editar» (también en la BD: la RLS de configuracion_tienda exige
 * can_write_section('tienda')). Con solo «Ver» (06/11/2026, decisión del dueño)
 * no sale la pestaña Ajustes ni los interruptores «A la venta» (se ocultan, no
 * se desactivan) y junto a las pestañas aparece la etiqueta «Solo lectura».
 * En el móvil el interruptor baja a su fila, a todo el ancho, para no tapar las
 * pestañas (10/11/2026, repaso de estética; sin botón «Ver la tienda en la web»).
 */
export default function Tienda() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pestanaPedida = pestanaDeUrl(searchParams.get("tab"));
  const cambiarPestana = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === "vinos") next.delete("tab");
    else next.set("tab", v);
    setSearchParams(next, { replace: true });
  };
  const configuracion = useConfiguracionTienda();
  const config = configuracion.data?.disponible ? configuracion.data.config : null;
  const { canAccess: puedeEditar, loading: cargandoPermisos } = useCanAccessSection("tienda", "edit");
  const soloLectura = !cargandoPermisos && !puedeEditar;
  // «Ajustes» es configuración: sin «Editar», ni pestaña ni enlace (`?tab=ajustes` cae en Vinos).
  const pestana: Pestana = pestanaPedida === "ajustes" && !puedeEditar ? "vinos" : pestanaPedida;
  // Alto de la pantalla (regla del dueño para todo el panel): la barra de pestañas queda fija y
  // cada pestaña hace scroll por dentro. Sin medida (jsdom) cae al layout con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_TIENDA);

  let contenido;
  if (configuracion.isLoading) {
    // La silueta de la barra de pestañas y de la tabla: sin saltos cuando llega la configuración.
    contenido = (
      <div role="status" aria-label="Cargando la tienda" className="flex flex-col gap-3">
        <span className="sr-only">Cargando la tienda…</span>
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="hidden h-9 w-48 rounded-full sm:block" />
        </div>
        <Skeleton className="h-11 w-full max-w-lg" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  } else if (configuracion.isError) {
    contenido = (
      <div role="alert" className="mx-auto mt-6 flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-10 text-center">
        <WifiOff className="mb-1 h-8 w-8 text-destructive/60" aria-hidden="true" />
        <p className="text-sm font-medium">No se pudo cargar la tienda</p>
        <p className="text-xs text-muted-foreground">Comprueba la conexión y vuelve a intentarlo.</p>
        <Button variant="outline" className="mt-2 h-11" onClick={() => void configuracion.refetch()}>Reintentar</Button>
      </div>
    );
  } else if (!config) {
    contenido = (
      <div role="alert" className="flex max-w-xl items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>La tienda todavía no está instalada en la base de datos (falta aplicar la migración «tienda_vinos»). Avisa al equipo técnico.</p>
      </div>
    );
  } else {
    contenido = (
      <Tabs value={pestana} onValueChange={cambiarPestana} className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
        <PestanasPagina
          pestanas={[
            { valor: "vinos", etiqueta: "Vinos", icono: <Wine /> },
            ...(puedeEditar ? [{ valor: "ajustes", etiqueta: "Ajustes", icono: <Settings2 /> }] : []),
          ]}
          accionesDebajoEnMovil
          acciones={
            <span className="flex w-full items-center gap-2 sm:w-auto">
              {soloLectura && <EtiquetaSoloLectura />}
              {!cargandoPermisos && <InterruptorTiendaWeb config={config} puedeEditar={puedeEditar} className="flex-1 sm:flex-none" />}
            </span>
          }
        />
        {/* Columna flexible: la tabla de Vinos se queda con el alto que dejan los filtros y hace scroll por dentro. */}
        <TabsContent value="vinos" className={cn(CONTENIDO_PESTANA, "flex flex-col")}>
          <VinosTienda config={config} puedeEditar={puedeEditar} />
        </TabsContent>
        {puedeEditar && (
          <TabsContent value="ajustes" className={CONTENIDO_PESTANA}>
            <AjustesTienda config={config} puedeEditar={puedeEditar} />
          </TabsContent>
        )}
      </Tabs>
    );
  }

  return (
    <DashboardLayout>
      <div ref={setRaiz} data-testid="tienda" className="flex min-w-0 flex-col" style={alto ? { height: alto } : undefined}>
        {contenido}
      </div>
    </DashboardLayout>
  );
}
