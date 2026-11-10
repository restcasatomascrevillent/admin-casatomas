import {
  LayoutDashboard,
  ShoppingCart,
  Wallet,
  Star,
  Phone,
  Activity,
  MapPin,
  Bot,
  Users,
  LogOut,
  ArrowLeft,
  ShieldAlert,
  ScrollText,
  Server,
  FileSearch,
} from "lucide-react";
import { useEffect } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { VersionPanel } from "@/components/panel/VersionPanel";
import { cn } from "@/lib/utils";
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
import { BotonUsuarioMenu } from "@/components/cuenta/BotonUsuarioMenu";
import { MenuMasModulos, type ItemMenu } from "@/components/superadmin/MenuMasModulos";

/**
 * Menú del Super Admin (orden del 2026-11-03, petición del dueño; Costes dentro de Servicios el 2026-11-04): arriba lo de
 * uso diario agrupado por tema; abajo del todo, en el desplegable «Más módulos»,
 * Gestor Gasto (desde el 2026-11-10: «Mover gestor gasto a más módulos»), Ecommerce, Asistente Tel., Espacios y Bot Web.
 */
const gruposMenuSuperAdmin: { etiqueta: string; items: ItemMenu[] }[] = [
  {
    etiqueta: "Administración",
    items: [
      { title: "Control del Panel", url: "/super-admin", icon: LayoutDashboard },
      { title: "Usuarios", url: "/super-admin/usuarios", icon: Users },
      { title: "Auditoría", url: "/super-admin/auditoria", icon: ScrollText },
    ],
  },
  {
    etiqueta: "Costes",
    items: [
      // «Costes» es una pestaña de Servicios desde el 04/11/2026 (petición del dueño: «que sean una»).
      { title: "Servicios", url: "/super-admin/servicios", icon: Server },
    ],
  },
  {
    etiqueta: "Web y clientes",
    items: [
      { title: "Tráfico web", url: "/super-admin/trafico-web", icon: Activity },
      // Logs (18/11/2026): actividad de la web, errores e incidencias con Linear, estadísticas de comportamiento.
      { title: "Logs", url: "/super-admin/logs", icon: FileSearch },
      { title: "Reseñas Google", url: "/super-admin/resenas", icon: Star },
      // «Plantillas Email» se fue a Reservas › Configuración (04/11/2026, petición del dueño).
    ],
  },
];

const masModulosSuperAdmin: ItemMenu[] = [
  { title: "Gestor Gasto", url: "/super-admin/gestor-gasto", icon: Wallet },
  { title: "Ecommerce", url: "/super-admin/ecommerce", icon: ShoppingCart },
  { title: "Asistente Tel.", url: "/super-admin/asistente-telefonico", icon: Phone },
  { title: "Espacios", url: "/super-admin/espacios", icon: MapPin },
  { title: "Bot Web", url: "/super-admin/bot-web", icon: Bot },
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
        className={cn(
          "h-[5.5rem] shrink-0 justify-center border-b border-sidebar-border py-2 pl-[calc((var(--sidebar-width-icon)-theme(spacing.11))/2)] pr-3",
          isCollapsed && "px-0",
        )}
      >
        <div className={cn("flex w-full min-w-0 items-center gap-2", isCollapsed && "flex-col gap-1")}>
          <SidebarTrigger className="text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent" />
          {/* Versión y entorno arriba, bien a la vista (2026-11-03); con el menú plegado, solo el número. */}
          {isCollapsed && <VersionPanel colapsado />}
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              {/* Versión a la derecha del título, en pequeño (dueño, 04/11/2026): solo el
                  número, en el color del entorno (ámbar demo, verde producción); el entorno va
                  en el tooltip y para el lector de pantalla. Con «· Producción» el título se
                  cortaba en los 16rem del menú. */}
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="flex min-w-0 items-center gap-1.5 text-base font-semibold text-destructive">
                  <ShieldAlert
                    className="h-4 w-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span className="truncate">Super Admin</span>
                </h2>
                <VersionPanel colapsado className="font-medium" />
              </div>
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

      <SidebarContent className="gap-0">
        {gruposMenuSuperAdmin.map((grupo) => (
          <SidebarGroup key={grupo.etiqueta} className="py-1 first:pt-2">
            {/* En pantallas bajas (iPad apaisado, 768 px) sin etiquetas: así caben todos los
                módulos y «Más módulos» sin hacer scroll en el menú. */}
            <SidebarGroupLabel className="[@media(max-height:819px)]:hidden">{grupo.etiqueta}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu aria-label={grupo.etiqueta}>
                {grupo.items.map((item) => (
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
        ))}

        {/* Abajo del todo: los módulos de menos uso, plegados. */}
        <SidebarGroup className="mt-auto border-t border-sidebar-foreground/10 py-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <MenuMasModulos items={masModulosSuperAdmin} rutaActual={currentPath} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="shrink-0 border-t border-sidebar-border p-2">
        <SidebarMenu>
          {/* Dentro del Super Admin solo entra un super admin (SuperAdminRoute). */}
          <BotonUsuarioMenu tono="superadmin" esSuperAdmin rol="admin" permisos={[]} />
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
