import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole, SectionKey } from "@/hooks/useUserRole";
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
  "/espacios": "espacios",
  // "/trabajadores" ya no requiere permiso: la ruta solo redirige a "/".
  "/ecommerce": "ecommerce",
  "/asistente-telefonico": "asistente_telefonico",
  "/resenas": "resenas",
  "/marketing": "marketing",
  "/facturas": "facturas",
  "/usuarios": "usuarios",
  "/gestor-gasto": "gestor_gasto",
};

export const ProtectedRoute = ({ children, requiredSection }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, permissions, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const location = useLocation();

  const loading = authLoading || roleLoading;

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

    // Los admins tienen acceso a todo
    if (isAdmin) return;

    // La sección de usuarios es solo para admins
    if (sectionKeys.includes("usuarios")) {
      navigate("/dashboard");
      return;
    }

    // Verificar permiso de visualización (basta con una de las secciones:
    // p. ej. el Gestor Web agrupa carta, contenido web y bot, y cada pestaña
    // vuelve a comprobar la suya).
    const puedeVer = sectionKeys.some(
      (key) => permissions.find((p) => p.section_key === key)?.can_view,
    );
    if (!puedeVer) {
      navigate("/dashboard");
    }
  }, [user, loading, isAdmin, permissions, location.pathname, requiredSection, navigate]);

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

  return <>{children}</>;
};
