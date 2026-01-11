import { LayoutDashboard, UtensilsCrossed, Users, MapPin, BookOpen, Globe, Megaphone, Receipt, LogOut, Shield } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
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

const menuItems: { title: string; url: string; icon: React.ComponentType<any>; sectionKey: SectionKey }[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, sectionKey: "dashboard" },
  { title: "Reservas", url: "/reservas", icon: UtensilsCrossed, sectionKey: "reservas" },
  { title: "Espacios", url: "/espacios", icon: MapPin, sectionKey: "espacios" },
  { title: "Personal", url: "/trabajadores", icon: Users, sectionKey: "trabajadores" },
  { title: "Gestor Carta", url: "/gestor-carta", icon: BookOpen, sectionKey: "gestor_carta" },
  { title: "Gestión Web", url: "/gestion-web", icon: Globe, sectionKey: "gestion_web" },
  { title: "Marketing", url: "/marketing", icon: Megaphone, sectionKey: "marketing" },
  { title: "Facturas", url: "/facturas", icon: Receipt, sectionKey: "facturas" },
  { title: "Usuarios", url: "/usuarios", icon: Shield, sectionKey: "usuarios" },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { signOut } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;
  const { isAdmin, permissions, loading } = useUserRole();

  const isActive = (path: string) => currentPath === path;
  const isCollapsed = state === "collapsed";

  // Filtrar items según permisos
  const visibleItems = menuItems.filter((item) => {
    if (loading) return false;
    if (isAdmin) return true;
    if (item.sectionKey === "usuarios") return false; // Solo admins
    const permission = permissions.find((p) => p.section_key === item.sectionKey);
    return permission?.can_view ?? false;
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
        <Button
          variant="ghost"
          className={`w-full text-sidebar-foreground hover:bg-sidebar-accent ${isCollapsed ? 'justify-center px-2' : 'justify-start'}`}
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="ml-3">Cerrar sesión</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
