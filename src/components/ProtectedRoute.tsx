import { auditDeniedAccess } from "@/lib/audit-access";
import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole, SectionKey } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Sección necesaria; con una lista basta con poder ver CUALQUIERA de ellas. */
  requiredSection?: SectionKey | SectionKey[];
}

// Mapeo de rutas a secciones
const ROUTE_TO_SECTION: Record<string, SectionKey> = {
  "/dashboard": "dashboard",
  "/": "dashboard",
  "/reservas": "reservas",
  // "/trabajadores" ya no requiere permiso: la ruta solo redirige a "/".
  "/marketing": "marketing",
  "/facturas": "facturas",
  "/usuarios": "usuarios",
};
// Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Plantillas Email,
// Tráfico web y Espacios ya no tienen ruta aquí: viven bajo /super-admin/*
// protegidas por SuperAdminRoute.

export const ProtectedRoute = ({ children, requiredSection }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, permissions, loading: roleLoading } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();
  const navigate = useNavigate();
  const location = useLocation();

  const denegado = useRef<string | null>(null);
  const loading = authLoading || roleLoading || superAdminLoading;

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Verificar permisos de sección
  useEffect(() => {
    if (loading || !user) return;

    const required = requiredSection ?? ROUTE_TO_SECTION[location.pathname];
    const sectionKeys = Array.isArray(required) ? required : required ? [required] : [];

    if (sectionKeys.length === 0) return; // Ruta no mapeada, permitir acceso

    // Los super admins tienen acceso a todo, pase lo que pase en la tabla de
    // permisos (2026-09-26). Ser "admin" ya no basta: un admin ahora solo ve
    // lo que le marquen sus permisos, salvo la sección de usuarios (abajo).
    if (isSuperAdmin) return;

    const rechazar = () => {
      const key = `${user.id}:${location.key}`;
      if (denegado.current !== key) {
        denegado.current = key;
        void auditDeniedAccess(location.pathname);
      }
      navigate("/dashboard");
    };
    // La sección de usuarios es solo para admins (no configurable por
    // permisos, igual que antes).
    if (sectionKeys.includes("usuarios")) {
      if (!isAdmin) rechazar();
      return;
    }

    // Verificar permiso de visualización (basta con una de las secciones:
    // p. ej. el Gestor Web agrupa carta, contenido web y bot, y cada pestaña
    // vuelve a comprobar la suya).
    const puedeVer = sectionKeys.some(
      (key) => permissions.find((p) => p.section_key === key)?.can_view,
    );
    if (!puedeVer) {
      rechazar();
    }
  }, [user, loading, isAdmin, isSuperAdmin, permissions, location.pathname, location.key, requiredSection, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const required = requiredSection ?? ROUTE_TO_SECTION[location.pathname];
  const keys = Array.isArray(required) ? required : required ? [required] : [];
  if (!isSuperAdmin && keys.length && (keys.includes("usuarios") ? !isAdmin : !keys.some(key => permissions.some(p => p.section_key === key && p.can_view)))) return null;
  return <>{children}</>;
};
