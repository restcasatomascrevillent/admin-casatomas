import { LayoutDashboard, ShoppingCart, Wallet, Coins, Star, Phone, Mail, Activity, MapPin, Bot, Users, LogOut, ArrowLeft, ShieldAlert, ScrollText } from "lucide-react";
import { useEffect, type ComponentType, type SVGProps } from "react";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const menuItems: { title: string; url: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { title: "Control del Panel", url: "/super-admin", icon: LayoutDashboard },
  { title: "Usuarios", url: "/super-admin/usuarios", icon: Users },
  { title: "Ecommerce", url: "/super-admin/ecommerce", icon: ShoppingCart },
  { title: "Asistente Tel.", url: "/super-admin/asistente-telefonico", icon: Phone },
  { title: "Gestor Gasto", url: "/super-admin/gestor-gasto", icon: Wallet },
  { title: "Costes", url: "/super-admin/costes", icon: Coins },
  { title: "Reseñas Google", url: "/super-admin/resenas", icon: Star },
  { title: "Plantillas Email", url: "/super-admin/plantillas-email", icon: Mail },
  { title: "Tráfico web", url: "/super-admin/trafico-web", icon: Activity },
  { title: "Espacios", url: "/super-admin/espacios", icon: MapPin },
  { title: "Bot Web", url: "/super-admin/bot-web", icon: Bot },
  { title: "Auditoría", url: "/super-admin/auditoria", icon: ScrollText },
];

export function SuperAdminSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;
  // Dentro del panel deslizante (tablet vertical) el menú siempre se ve expandido.
  const isCollapsed = state === "collapsed" && !isMobile;

  // Al navegar, el panel deslizante se cierra solo.
  useEffect(() => {
    setOpenMobile(false);
  }, [currentPath, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      {/* El plegador vive aquí desde que SuperAdminLayout quitó su cabecera
          de escritorio (2026-10-09); mismo patrón que AppSidebar. */}
      <SidebarHeader
        className={`border-b border-sidebar-border transition-[padding] duration-200 ease-in-out ${isCollapsed ? "px-0 py-4" : "p-4"}`}
      >
        <div className={`flex items-center gap-2 ${isCollapsed ? "flex-col justify-center" : ""}`}>
          <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <h2 className="text-lg font-semibold text-sidebar-foreground truncate">Super Admin</h2>
              <span className="text-xs text-sidebar-foreground/70 truncate">Control total del sistema</span>
            </div>
          )}
          <SidebarTrigger
            className={`text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent shrink-0 ${!isCollapsed ? "ml-auto" : ""}`}
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Super Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/super-admin"}
                      className="flex items-center gap-3 hover:bg-sidebar-accent rounded-md transition-colors"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className={`border-t border-sidebar-border space-y-2 ${isCollapsed ? "px-2 py-4" : "p-4"}`}>
        <Button
          variant="ghost"
          className={`w-full text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent ${isCollapsed ? 'justify-center px-2' : 'justify-start'}`}
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="ml-3">Volver al Admin Panel</span>}
        </Button>
        <Button
          variant="ghost"
          className={`w-full text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent ${isCollapsed ? 'justify-center px-2' : 'justify-start'}`}
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="ml-3">Cerrar sesión</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
