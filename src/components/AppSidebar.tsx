import { LayoutDashboard, UtensilsCrossed, Globe, Megaphone, Receipt, LogOut, Shield, Settings } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole, SectionKey } from "@/hooks/useUserRole";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { SECCIONES_GESTOR_WEB } from "@/components/gestion-web/pestanasGestorWeb";

// `sectionKey` puede ser una lista: el item se ve si el usuario puede ver
// cualquiera de ellas (el Gestor Web agrupa carta, contenido web y bot).
// `toggleKey` es la clave que usa el Super Admin para activar/desactivar el
// item en el sidebar (independiente del permiso por sección): por defecto es
// el propio sectionKey cuando es uno solo, o se declara aparte cuando el item
// agrupa varias secciones o comparte permiso con otro item.
const menuItems: { title: string; url: string; icon: ComponentType<SVGProps<SVGSVGElement>>; sectionKey: SectionKey | SectionKey[]; toggleKey?: string }[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, sectionKey: "dashboard" },
  { title: "Reservas", url: "/reservas", icon: UtensilsCrossed, sectionKey: "reservas", toggleKey: "reservas" },
  // Sección "Personal" retirada el 2026-09-23 (decisión del dueño). Ver
  // docs/funcionalidades/10-retirada-seccion-personal.md.
  // Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Plantillas
  // Email, Tráfico web y Espacios se gestionan exclusivamente desde el
  // Super Admin y ya no forman parte del Admin Panel normal (ver /super-admin).
  { title: "Gestor Web", url: "/gestion-web", icon: Globe, sectionKey: SECCIONES_GESTOR_WEB, toggleKey: "gestion_web" },
  { title: "Newsletter", url: "/marketing", icon: Megaphone, sectionKey: "marketing", toggleKey: "marketing" },
  { title: "Facturas", url: "/facturas", icon: Receipt, sectionKey: "facturas", toggleKey: "facturas" },
  { title: "Usuarios", url: "/usuarios", icon: Shield, sectionKey: "usuarios", toggleKey: "usuarios" },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const { isAdmin, permissions, loading } = useUserRole();
  const { isEnabled, loading: togglesLoading } = useAdminFeatureToggles();

  const isActive = (path: string) => currentPath === path;
  const isCollapsed = state === "collapsed";

  // Filtrar items según permisos y funcionalidades activadas por el Super Admin
  const visibleItems = menuItems.filter((item) => {
    if (loading || togglesLoading) return false;
    if (item.toggleKey && !isEnabled(item.toggleKey)) return false;
    if (isAdmin) return true;
    const keys = Array.isArray(item.sectionKey) ? item.sectionKey : [item.sectionKey];
    if (keys.includes("usuarios")) return false; // Solo admins
    return keys.some((key) => permissions.find((p) => p.section_key === key)?.can_view);
  });

  return (
    <Sidebar collapsible="icon" className={isCollapsed ? "w-14" : "w-64"}>
      <SidebarHeader className="border-b border-sidebar-border p-4">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="h-6 w-6 text-sidebar-primary" />
            <div className="flex flex-col">
              <h2 className="text-lg font-semibold text-sidebar-foreground">Admin Panel</h2>
              <span className="text-xs text-muted-foreground">Gestión del Restaurante</span>
            </div>
          </div>
        )}
        {isCollapsed && <UtensilsCrossed className="h-6 w-6 text-sidebar-primary mx-auto" />}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestión</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink
                      to={item.url}
                      className="flex items-center gap-3 hover:bg-sidebar-accent rounded-md transition-colors"
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className={`flex gap-2 ${isCollapsed ? 'flex-col' : 'flex-row'}`}>
          <Button
            variant="ghost"
            className={`text-sidebar-foreground hover:bg-sidebar-accent ${isCollapsed ? 'w-full justify-center px-2' : 'flex-1 justify-start'}`}
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="ml-3">Cerrar sesión</span>}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
            onClick={() => navigate("/super-admin/login")}
            title="Super Admin"
            aria-label="Super Admin"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
