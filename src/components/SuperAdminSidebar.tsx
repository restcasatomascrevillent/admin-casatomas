import {
  LayoutDashboard,
  ShoppingCart,
  Wallet,
  Coins,
  Star,
  Phone,
  Mail,
  Activity,
  MapPin,
  Bot,
  Users,
  LogOut,
  ArrowLeft,
  ShieldAlert,
  ScrollText,
} from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";

const menuItems: {
  title: string;
  url: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { title: "Control del Panel", url: "/super-admin", icon: LayoutDashboard },
  { title: "Usuarios", url: "/super-admin/usuarios", icon: Users },
  { title: "Ecommerce", url: "/super-admin/ecommerce", icon: ShoppingCart },
  {
    title: "Asistente Tel.",
    url: "/super-admin/asistente-telefonico",
    icon: Phone,
  },
  { title: "Gestor Gasto", url: "/super-admin/gestor-gasto", icon: Wallet },
  { title: "Costes", url: "/super-admin/costes", icon: Coins },
  { title: "Reseñas Google", url: "/super-admin/resenas", icon: Star },
  {
    title: "Plantillas Email",
    url: "/super-admin/plantillas-email",
    icon: Mail,
  },
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
      <SidebarHeader className="h-20 shrink-0 justify-center border-b border-sidebar-border py-2 pl-[calc((var(--sidebar-width-icon)-theme(spacing.11))/2)] pr-3">
        <div className="flex w-full min-w-0 items-center gap-2">
          <SidebarTrigger className="text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent" />
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-base font-semibold text-sidebar-foreground">
                <ShieldAlert
                  className="h-4 w-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <span className="truncate">Super Admin</span>
              </h2>
              <p
                className="truncate text-xs text-sidebar-foreground/70"
                title="Control total del sistema"
              >
                Control total del sistema
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Super Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                    className="rounded-lg"
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/super-admin"}
                      aria-label={item.title}
                      className="flex items-center gap-3 rounded-lg hover:bg-sidebar-accent"
                    >
                      <item.icon
                        className="h-5 w-5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="shrink-0 border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Volver al Admin Panel"
              aria-label="Volver al Admin Panel"
              className="rounded-lg gap-3"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft aria-hidden="true" />
              <span>Volver al Admin Panel</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="rounded-lg gap-3"
              onClick={() => void signOut()}
            >
              <LogOut aria-hidden="true" />
              <span>Cerrar sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
