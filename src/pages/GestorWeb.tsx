import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, CalendarDays, Loader2, Newspaper, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { useUserRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";
import { esCambioDePestanaDelTour } from "@/lib/ayuda/tours";
import {
  PESTANAS_GESTOR_WEB,
  esPestanaGestorWeb,
  puedeVerSeccion,
  type PestanaGestorWeb,
} from "@/components/gestion-web/pestanasGestorWeb";

// ---------------------------------------------------------------------------
// Gestor Web: todo lo que se ve en las webs públicas.
//
// Antes eran tres entradas del menú (Gestor Carta, Gestor Web y Gestor Bot
// Web). Ahora es una página con pestañas; la pestaña va en la URL
// (?tab=carta|novedades|menus|tapas|tienda) para que recargar o compartir el
// enlace abra la misma pestaña. /gestor-carta redirige aquí. El Bot Web se
// retiró de aquí el 2026-09-26 y pasó a /super-admin/bot-web (exclusivo de
// Super Admin); /gestion-bot ya no redirige a esta página.
//
// Permisos: cada pestaña conserva la sección de permisos que tenía su página
// (gestor_carta, gestion_web). Solo se muestran las pestañas que el usuario
// puede ver; no se amplía el acceso de nadie. «Tienda» (10/11/2026) pide el
// permiso de Tienda, que por sí solo no abre esta página.
//
// Las pestañas se cargan bajo demanda (lazy) y, una vez abiertas, se quedan
// montadas aunque cambies a otra: así no se pierde lo que estuvieras
// escribiendo.
// ---------------------------------------------------------------------------

const TabCarta = lazy(() => import("@/components/gestion-web/tabs/TabCarta"));
const TabNovedades = lazy(() => import("@/components/gestion-web/tabs/TabNovedades"));
const TabMenus = lazy(() => import("@/components/gestion-web/tabs/TabMenusTapas").then((m) => ({ default: m.TabMenus })));
const TabTapas = lazy(() => import("@/components/gestion-web/tabs/TabMenusTapas").then((m) => ({ default: m.TabTapas })));
const TabTienda = lazy(() => import("@/components/gestion-web/tabs/TabTienda"));

const COMPONENTES: Record<PestanaGestorWeb, ComponentType> = {
  carta: TabCarta,
  novedades: TabNovedades,
  menus: TabMenus,
  tapas: TabTapas,
  tienda: TabTienda,
};

const ICONOS: Record<PestanaGestorWeb, ComponentType<{ className?: string }>> = {
  carta: BookOpen,
  novedades: Newspaper,
  menus: UtensilsCrossed,
  tapas: CalendarDays,
  tienda: ShoppingBag,
};

/** Etiqueta del móvil cuando la normal no cabe en la barra a 390 px. */
const ETIQUETA_CORTA: Partial<Record<PestanaGestorWeb, string>> = {
  menus: "Menús",
};

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página. Con 420 px
 * caben el subtítulo, la barra de pestañas y unos 280 px de pestaña con scroll.
 */
const ALTURA_MINIMA_GESTOR_WEB = 420;

const Cargando = () => (
  <div className="flex items-center justify-center min-h-[300px]">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

export default function GestorWeb() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { permissions, loading: roleLoading } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();
  const loading = roleLoading || superAdminLoading;

  // Ser "admin" ya no da acceso a todas las pestañas (2026-09-26): solo un
  // super admin las ve todas pase lo que pase en la tabla de permisos.
  const pestanasVisibles = useMemo(
    () => PESTANAS_GESTOR_WEB.filter((p) => puedeVerSeccion(p.seccion, isSuperAdmin, permissions)),
    [isSuperAdmin, permissions],
  );

  const tabParam = searchParams.get("tab");
  const pestanaActiva: PestanaGestorWeb | null =
    esPestanaGestorWeb(tabParam) && pestanasVisibles.some((p) => p.id === tabParam)
      ? tabParam
      : pestanasVisibles[0]?.id ?? null;

  // Normaliza la URL (sin ?tab, pestaña inexistente o sin permiso) sin
  // añadir una entrada al historial.
  useEffect(() => {
    if (loading || !pestanaActiva || tabParam === pestanaActiva) return;
    const next = new URLSearchParams(searchParams);
    next.set("tab", pestanaActiva);
    setSearchParams(next, { replace: true });
  }, [loading, pestanaActiva, tabParam, searchParams, setSearchParams]);

  // Pestañas ya abiertas: se quedan montadas (ocultas) para no perder borradores.
  const [visitadas, setVisitadas] = useState<Set<PestanaGestorWeb>>(new Set());
  useEffect(() => {
    if (!pestanaActiva) return;
    setVisitadas((prev) => (prev.has(pestanaActiva) ? prev : new Set(prev).add(pestanaActiva)));
  }, [pestanaActiva]);

  const cambiarPestana = (value: string) => {
    if (!esPestanaGestorWeb(value)) return;
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    // Los saltos del tour guiado no apilan historial (si no, «Atrás» repite el tour).
    setSearchParams(next, { replace: esCambioDePestanaDelTour() });
  };

  // Alto de la pantalla, calculado solo (regla del dueño, 2026-10-07: la página
  // no hace scroll, mide lo que se ve): el mismo patrón que Newsletter y
  // Facturas (`useAlturaDisponible`). El subtítulo y la barra de pestañas quedan
  // fijos arriba y la pestaña activa hace scroll por dentro; Novedades, Menús y
  // Tapas, desde `xl`, reparten además ese alto en dos columnas con su propio
  // scroll. Sin medida (jsdom, primer pintado sin layout) cae al layout de
  // siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_GESTOR_WEB);

  return (
    <DashboardLayout>
      {/* Sin `space-y-6` (dueño, 04/11/2026: «arregla el hueco»): entre la barra de pestañas y
          las subpestañas de cada sección sumaba 8 + 24 + 8 px. Queda el `mb-2` de la barra y el
          `pt-2` de la sección, 16 px, como en el resto de páginas con pestañas. */}
      <div ref={setRaiz} className="flex flex-col" style={alto ? { height: alto } : undefined}>
        {loading ? (
          <Cargando />
        ) : !pestanaActiva ? (
          <p className="text-sm text-muted-foreground">No tienes acceso a ninguna parte del Gestor Web.</p>
        ) : (
          <Tabs value={pestanaActiva} onValueChange={cambiarPestana} className="shrink-0">
            <PestanasPagina
              // QA-MDN-03: a 390 px las cuatro pestañas con icono no cabían y «Tapas» quedaba fuera.
              iconosSoloEscritorio
              pestanas={pestanasVisibles.map((p) => {
                const Icono = ICONOS[p.id];
                return {
                  valor: p.id,
                  etiqueta: p.label,
                  // QA-MDN-03: a 390 px «Menús diarios» se cortaba y «Tapas» quedaba fuera.
                  etiquetaCorta: ETIQUETA_CORTA[p.id],
                  icono: <Icono />,
                  tour: `gw-pestana-${p.id}`,
                };
              })}
              acciones={
                // Sin título "Gestor Web" (2026-09-25): ya lo dice la pestaña activa del menú
                // lateral. Sin subtítulo (2026-10-17): el recorrido de ayuda ya explica que la
                // página cubre Casa Tomás y Touza. `data-tour="gw-intro"` es el arranque del
                // recorrido; se queda en este botón al no haber ya una franja propia para él.
                <span data-tour="gw-intro">
                  <BotonAyuda seccion="gestor-web" />
                </span>
              }
            />
          </Tabs>
        )}

        {pestanaActiva &&
          pestanasVisibles
            .filter((p) => visitadas.has(p.id) || p.id === pestanaActiva)
            .map((p) => {
              const Componente = COMPONENTES[p.id];
              const activa = p.id === pestanaActiva;
              // La región con scroll de la pestaña: ocupa el alto que queda bajo
              // la barra. Sin clases de `display`: le ganarían al atributo
              // `hidden` y la pestaña oculta seguiría ocupando sitio.
              return (
                <section
                  key={p.id}
                  hidden={!activa}
                  role="tabpanel"
                  aria-label={p.label}
                  className="pt-2 flex-1 min-h-0 overflow-y-auto overscroll-contain"
                >
                  <Suspense fallback={<Cargando />}>
                    <Componente />
                  </Suspense>
                </section>
              );
            })}
      </div>
    </DashboardLayout>
  );
}
