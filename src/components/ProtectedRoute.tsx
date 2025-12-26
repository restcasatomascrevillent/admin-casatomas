import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole, SectionKey } from "@/hooks/useUserRole";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredSection?: SectionKey;
}

// Mapeo de rutas a secciones
const ROUTE_TO_SECTION: Record<string, SectionKey> = {
  "/dashboard": "dashboard",
  "/": "dashboard",
  "/reservas": "reservas",
  "/espacios": "espacios",
  "/trabajadores": "trabajadores",
  "/gestor-carta": "gestor_carta",
  "/gestion-web": "gestion_web",
  "/marketing": "marketing",
  "/facturas": "facturas",
  "/analisis": "analisis",
  "/usuarios": "usuarios",
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

    const sectionKey = requiredSection || ROUTE_TO_SECTION[location.pathname];
    
    if (!sectionKey) return; // Ruta no mapeada, permitir acceso

    // Los admins tienen acceso a todo
    if (isAdmin) return;

    // La sección de usuarios es solo para admins
    if (sectionKey === "usuarios") {
      navigate("/dashboard");
      return;
    }

    // Verificar permiso de visualización
    const permission = permissions.find((p) => p.section_key === sectionKey);
    if (!permission?.can_view) {
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
