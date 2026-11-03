import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Loader2, Settings2, Wine } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { VinosTienda } from "@/components/tienda/VinosTienda";
import { AjustesTienda } from "@/components/tienda/AjustesTienda";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useConfiguracionTienda } from "@/hooks/useTienda";
import { porcentaje } from "@/lib/tienda";
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
 * salen y a qué precio) y Ajustes (visible sí/no, %, aviso y cómo comprar).
 * Sección de permisos «tienda»: con «Ver» se consulta; cambiar algo pide
 * «Puede editar».
 */
export default function Tienda() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pestana = pestanaDeUrl(searchParams.get("tab"));
  const cambiarPestana = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === "vinos") next.delete("tab");
    else next.set("tab", v);
    setSearchParams(next, { replace: true });
  };
  const configuracion = useConfiguracionTienda();
  const config = configuracion.data?.disponible ? configuracion.data.config : null;
  const { canAccess: puedeEditar } = useCanAccessSection("tienda", "edit");
  // Alto de la pantalla (regla del dueño para todo el panel): la barra de pestañas queda fija y
  // cada pestaña hace scroll por dentro. Sin medida (jsdom) cae al layout con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_TIENDA);

  let contenido;
  if (configuracion.isLoading) {
    contenido = (
      <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Cargando la tienda…
      </p>
    );
  } else if (configuracion.isError) {
    contenido = (
      <div role="alert" className="flex max-w-xl flex-col items-start gap-3 rounded-xl border border-destructive/40 p-4 text-sm">
        <p>No se pudo cargar la tienda. Comprueba la conexión y vuelve a intentarlo.</p>
        <Button variant="outline" onClick={() => void configuracion.refetch()}>Reintentar</Button>
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
            { valor: "ajustes", etiqueta: "Ajustes", icono: <Settings2 /> },
          ]}
          acciones={
            <span
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium",
                config.activa ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900",
              )}
            >
              {config.activa ? `Visible · ${porcentaje(config.descuento_pct)}` : "Oculta en la web"}
            </span>
          }
        />
        <TabsContent value="vinos" className={CONTENIDO_PESTANA}>
          <VinosTienda config={config} puedeEditar={puedeEditar} />
        </TabsContent>
        <TabsContent value="ajustes" className={CONTENIDO_PESTANA}>
          <AjustesTienda config={config} puedeEditar={puedeEditar} />
        </TabsContent>
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
