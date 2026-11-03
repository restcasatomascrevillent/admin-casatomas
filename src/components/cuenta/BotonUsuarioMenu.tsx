import { lazy, Suspense, useState } from "react";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import type { AppRole, UserPermissions } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import { etiquetaRol, nombreVisible } from "@/lib/usuario-actual";
import { AvatarUsuario } from "./AvatarUsuario";

// Bajo demanda: el diálogo (permisos, formulario de contraseña) no pesa en el menú
// ni se evalúa hasta que alguien abre «Mi cuenta».
const MiCuentaDialog = lazy(() => import("./MiCuentaDialog").then((m) => ({ default: m.MiCuentaDialog })));

interface BotonUsuarioMenuProps {
  /** «panel» (Admin Panel, dorado) o «superadmin» (rojo). */
  tono: "panel" | "superadmin";
  esSuperAdmin: boolean;
  rol: AppRole | null;
  permisos: UserPermissions[];
}

/**
 * Pie del menú lateral: quién ha iniciado sesión (avatar con iniciales, nombre o
 * email y rol). Es un botón que abre «Mi cuenta». En modo iconos solo queda el
 * avatar, con el nombre y el rol en el tooltip (y en el nombre accesible).
 * Va dentro de un `SidebarMenu`.
 */
export function BotonUsuarioMenu({ tono, esSuperAdmin, rol, permisos }: BotonUsuarioMenuProps) {
  const { user } = useAuth();
  const { state, isMobile } = useSidebar();
  const [abierto, setAbierto] = useState(false);
  // Una vez abierto se queda montado: así se ve la animación de cierre.
  const [montado, setMontado] = useState(false);
  if (!user) return null;

  const colapsado = state === "collapsed" && !isMobile;
  const nombre = nombreVisible(user);
  const rolTexto = etiquetaRol({ esSuperAdmin, rol });

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        tooltip={`Mi cuenta · ${nombre} (${rolTexto})`}
        aria-label={`Mi cuenta: ${nombre}, ${rolTexto}`}
        aria-haspopup="dialog"
        data-testid="boton-mi-cuenta"
        className={cn("gap-3 rounded-lg pl-2", colapsado && "justify-center")}
        onClick={() => {
          setMontado(true);
          setAbierto(true);
        }}
      >
        <AvatarUsuario nombre={nombre} tono={tono} />
        <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
          <span className="truncate text-sm font-medium">{nombre}</span>
          <span className="truncate text-xs text-sidebar-foreground/70">{rolTexto}</span>
        </span>
      </SidebarMenuButton>
      {montado && (
        <Suspense fallback={null}>
          <MiCuentaDialog
            open={abierto}
            onOpenChange={setAbierto}
            user={user}
            esSuperAdmin={esSuperAdmin}
            rol={rol}
            permisos={permisos}
            tono={tono}
          />
        </Suspense>
      )}
    </SidebarMenuItem>
  );
}
