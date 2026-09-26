import { LayoutDashboard, ShoppingCart, Wallet, Star, Phone, Mail, Activity, MapPin, Bot, Users, LogOut, ArrowLeft, ShieldAlert } from "lucide-react";
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

const menuItems: { title: string; url: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { title: "Control del Panel", url: "/super-admin", icon: LayoutDashboard },
  { title: "Usuarios", url: "/super-admin/usuarios", icon: Users },
  { title: "Ecommerce", url: "/super-admin/ecommerce", icon: ShoppingCart },
  { title: "Asistente Tel.", url: "/super-admin/asistente-telefonico", icon: Phone },
  { title: "Gestor Gasto", url: "/super-admin/gestor-gasto", icon: Wallet },
  { title: "Reseñas Google", url: "/super-admin/resenas", icon: Star },
  { title: "Plantillas Email", url: "/super-admin/plantillas-email", icon: Mail },
  { title: "Tráfico web", url: "/super-admin/trafico-web", icon: Activity },
  { title: "Espacios", url: "/super-admin/espacios", icon: MapPin },
  { title: "Bot Web", url: "/super-admin/bot-web", icon: Bot },
];

export function SuperAdminSidebar() {
  const { state } = useSidebar();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className={isCollapsed ? "w-14" : "w-64"}>
      <SidebarHeader className="border-b border-sidebar-border p-4">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-destructive" />
            <div className="flex flex-col">
              <h2 className="text-lg font-semibold text-sidebar-foreground">Super Admin</h2>
              <span className="text-xs text-muted-foreground">Control total del sistema</span>
            </div>
          </div>
        )}
        {isCollapsed && <ShieldAlert className="h-6 w-6 text-destructive mx-auto" />}
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

      <SidebarFooter className="border-t border-sidebar-border p-4 space-y-2">
        <Button
          variant="ghost"
          className={`w-full text-sidebar-foreground hover:bg-sidebar-accent ${isCollapsed ? 'justify-center px-2' : 'justify-start'}`}
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="ml-3">Volver al Admin Panel</span>}
        </Button>
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
