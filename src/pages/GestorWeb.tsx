import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Bot, CalendarDays, Loader2, Newspaper, UtensilsCrossed } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import {
  PESTANAS_GESTOR_WEB,
  esPestanaGestorWeb,
  puedeVerSeccion,
  type PestanaGestorWeb,
} from "@/components/gestion-web/pestanasGestorWeb";

// ---------------------------------------------------------------------------
// Gestor Web: todo lo que se ve en las webs públicas y en el bot de la web.
//
// Antes eran tres entradas del menú (Gestor Carta, Gestor Web y Gestor Bot
// Web). Ahora es una página con pestañas; la pestaña va en la URL
// (?tab=carta|novedades|menus|tapas|bot) para que recargar o compartir el
// enlace abra la misma pestaña. /gestor-carta y /gestion-bot redirigen aquí.
//
// Permisos: cada pestaña conserva la sección de permisos que tenía su página
// (gestor_carta, gestion_web, gestion_bot). Solo se muestran las pestañas que
// el usuario puede ver; no se amplía el acceso de nadie.
//
// Las pestañas se cargan bajo demanda (lazy) y, una vez abiertas, se quedan
// montadas aunque cambies a otra: así no se pierde lo que estuvieras
// escribiendo (p. ej. los borradores de los 3 idiomas del bot).
// ---------------------------------------------------------------------------

const TabCarta = lazy(() => import("@/components/gestion-web/tabs/TabCarta"));
const TabNovedades = lazy(() => import("@/components/gestion-web/tabs/TabNovedades"));
const TabMenus = lazy(() => import("@/components/gestion-web/tabs/TabMenusTapas").then((m) => ({ default: m.TabMenus })));
const TabTapas = lazy(() => import("@/components/gestion-web/tabs/TabMenusTapas").then((m) => ({ default: m.TabTapas })));
const TabBotWeb = lazy(() => import("@/components/gestion-web/tabs/TabBotWeb"));

const COMPONENTES: Record<PestanaGestorWeb, ComponentType> = {
  carta: TabCarta,
  novedades: TabNovedades,
  menus: TabMenus,
  tapas: TabTapas,
  bot: TabBotWeb,
};

const ICONOS: Record<PestanaGestorWeb, ComponentType<{ className?: string }>> = {
  carta: BookOpen,
  novedades: Newspaper,
  menus: UtensilsCrossed,
  tapas: CalendarDays,
  bot: Bot,
};

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
    setSearchParams(next);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Sin título "Gestor Web" (2026-09-25): ya lo dice la pestaña activa
            del menú lateral. Se conserva el subtítulo: no es relleno, aclara
            que la página cubre DOS webs distintas (Casa Tomás y Touza), algo
            que el menú no dice. */}
        <p className="text-muted-foreground">
          Todo lo que aparece en las webs de Casa Tomás y Touza y en el bot de la web: carta, novedades, menús,
          tapas y asistente.
        </p>

        {loading ? (
          <Cargando />
        ) : !pestanaActiva ? (
          <p className="text-sm text-muted-foreground">No tienes acceso a ninguna parte del Gestor Web.</p>
        ) : (
          <Tabs value={pestanaActiva} onValueChange={cambiarPestana}>
            <div className="-mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto">
              <TabsList className="h-auto p-1 gap-1 w-max">
                {pestanasVisibles.map((p) => {
                  const Icono = ICONOS[p.id];
                  return (
                    <TabsTrigger key={p.id} value={p.id} className="gap-2 px-3 py-2">
                      <Icono className="h-4 w-4" />
                      {p.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </Tabs>
        )}

        {pestanaActiva &&
          pestanasVisibles
            .filter((p) => visitadas.has(p.id) || p.id === pestanaActiva)
            .map((p) => {
              const Componente = COMPONENTES[p.id];
              const activa = p.id === pestanaActiva;
              return (
                <section
                  key={p.id}
                  hidden={!activa}
                  role="tabpanel"
                  aria-label={p.label}
                  className="pt-2"
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
