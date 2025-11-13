import { LayoutDashboard, Users, CalendarDays, Home, UtensilsCrossed, BarChart3 } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const menuItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Reservas", url: "/reservas", icon: UtensilsCrossed },
  { title: "Trabajadores", url: "/trabajadores", icon: Users },
  { title: "Turnos", url: "/turnos", icon: CalendarDays },
  { title: "Salas", url: "/salas", icon: Home },
  { title: "Análisis", url: "/analisis", icon: BarChart3 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { signOut } = useAuth();
  const location = useLocation();
  const [nombreRestaurante, setNombreRestaurante] = useState("Mi Restaurante");
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;
  const isCollapsed = state === "collapsed";

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from("profiles" as any)
          .select("nombre_restaurante")
          .eq("id", user.id)
          .maybeSingle();
        
        if (!error && data !== null && 'nombre_restaurante' in data) {
          setNombreRestaurante((data as any).nombre_restaurante);
        }
      }
    };

    fetchProfile();
  }, []);

  return (
    <Sidebar collapsible="icon" className={isCollapsed ? "w-14" : "w-64"}>
      <SidebarHeader className="border-b border-sidebar-border p-4">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="h-6 w-6 text-sidebar-primary" />
            <div className="flex flex-col">
              <h2 className="text-lg font-semibold text-sidebar-foreground">{nombreRestaurante}</h2>
              <span className="text-xs text-muted-foreground">Panel de Gestión</span>
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
              {menuItems.map((item) => (
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
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => signOut()}
        >
          {!isCollapsed && <span className="ml-3">Cerrar sesión</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
