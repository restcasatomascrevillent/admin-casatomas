import {
  UtensilsCrossed,
  LogOut,
  Settings,
} from "lucide-react";
import { useEffect } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { VersionPanel } from "@/components/panel/VersionPanel";
import { cn } from "@/lib/utils";
import { precargarSeccion } from "@/lib/precargaSecciones";
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
import { useUserRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { itemMenuVisible, MENU_PANEL } from "@/components/menuPanel";
import { IndicadorSubidasFacturas } from "@/components/facturas/IndicadorSubidasFacturas";
import { BotonUsuarioMenu } from "@/components/cuenta/BotonUsuarioMenu";

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const { isAdmin, role, permissions, loading } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();
  const { isEnabled, loading: togglesLoading } = useAdminFeatureToggles();

  // También en sus subrutas: /facturas/ia (la IA a pantalla completa) sigue marcando «Facturas».
  const isActive = (path: string) => currentPath === path || (path !== "/" && currentPath.startsWith(`${path}/`));
  // En el panel deslizante (tablet vertical) `state` sigue siendo el del menú de escritorio,
  // pero dentro del Sheet siempre se ve expandido: no confundir con el carril de iconos.
  const isCollapsed = state === "collapsed" && !isMobile;

  // Al navegar, el panel deslizante se cierra solo (si no, tapaba la página nueva).
  useEffect(() => {
    setOpenMobile(false);
  }, [currentPath, setOpenMobile]);

  // Filtrar items según permisos y funcionalidades activadas por el Super Admin (regla en menuPanel.ts,
  // la misma que usa la «Pestaña al iniciar sesión» de Usuarios).
  const visibleItems =
    loading || togglesLoading || superAdminLoading
      ? []
      : MENU_PANEL.filter((item) => itemMenuVisible(item, { permisos: permissions, esSuperAdmin: isSuperAdmin, isEnabled }));

  return (
    <Sidebar collapsible="icon">
      {/* El plegador vivía en la cabecera de página, que se eliminó para
          recuperar alto (ver DashboardLayout.tsx); aquí no gasta ni un píxel
          del área de contenido y sigue presente en TODAS las secciones.
          La campana pasó a la tarjeta "Reservas de Hoy" del Dashboard (ver
          ReservasHoy.tsx) para que el cubierto decorativo pudiera volver:
          con los dos dentro no cabía todo y "Gestión del Restaurante" se
          cortaba a media palabra (11px medidos). */}
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
                <h2 className="flex min-w-0 items-center gap-1.5 text-base font-semibold text-sidebar-foreground">
                  <UtensilsCrossed
                    className="h-4 w-4 shrink-0 text-sidebar-primary"
                    aria-hidden="true"
                  />
                  <span className="truncate">Admin Panel</span>
                </h2>
                <VersionPanel colapsado className="font-medium" />
              </div>
              <p
                className="truncate text-xs text-sidebar-foreground/70"
                title="Gestión del Restaurante"
              >
                Gestión del Restaurante
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestión</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                    className="rounded-lg"
                  >
                    <NavLink
                      to={item.url}
                      aria-label={item.title}
                      // Al acercar el ratón o el dedo, empieza a bajar el fichero de la sección (07/11/2026).
                      onMouseEnter={() => precargarSeccion(item.url)}
                      onTouchStart={() => precargarSeccion(item.url)}
                      onFocus={() => precargarSeccion(item.url)}
                      className="flex items-center gap-3 rounded-lg hover:bg-sidebar-accent"
                    >
                      <item.icon
                        className="h-5 w-5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="shrink-0 border-t border-sidebar-border p-2">
        {!isMobile && (
          <IndicadorSubidasFacturas
            variante="menu"
            colapsado={isCollapsed}
            className={isCollapsed ? "flex justify-center" : ""}
          />
        )}
        <SidebarMenu>
          {/* Quién ha iniciado sesión; abre «Mi cuenta» (datos, permisos y contraseña). */}
          <BotonUsuarioMenu
            tono="panel"
            esSuperAdmin={!superAdminLoading && isSuperAdmin}
            rol={role ?? null}
            permisos={permissions ?? []}
          />
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
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Super Admin"
              aria-label="Super Admin"
              className="rounded-lg gap-3"
              onClick={() => navigate("/super-admin/login")}
            >
              <Settings aria-hidden="true" />
              <span>Super Admin</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
