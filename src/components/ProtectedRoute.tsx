import { auditDeniedAccess } from "@/lib/audit-access";
import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole, SectionKey } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Loader2 } from "lucide-react";
import { SECCIONES_GESTOR_WEB } from "@/components/gestion-web/pestanasGestorWeb";
import { esEntradaAlPanel, rutaDeInicio } from "@/lib/seccionInicio";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Sección necesaria; con una lista basta con poder ver CUALQUIERA de ellas. */
  requiredSection?: SectionKey | SectionKey[];
}

// Mapeo de rutas a secciones
const ROUTE_TO_SECTION: Record<string, SectionKey | SectionKey[]> = {
  "/dashboard": "dashboard",
  "/": "dashboard",
  "/reservas": "reservas",
  // "/trabajadores" ya no requiere permiso: la ruta solo redirige a "/".
  "/marketing": "marketing",
  // RRSS (antes Instagram): mismo permiso que Newsletter. La agencia
  // (Oficiosos, «instagram_agencia») entra solo a Instagram › Encargos.
  "/rrss": ["marketing", "instagram_agencia"],
  "/instagram": ["marketing", "instagram_agencia"],
  "/tienda": "tienda",
  // «Facturas · Subida» (06/11/2026) entra también, solo a la pestaña Cargar.
  "/facturas": ["facturas", "facturas_subida"],
  // «Subir albaranes» (10/11/2026): solo «Facturas · Solo fotos (albaranes)».
  "/albaranes": "facturas_albaranes",
  "/usuarios": "usuarios",
};
// Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Tráfico web y
// Espacios ya no tienen ruta aquí: viven bajo /super-admin/* protegidas por
// SuperAdminRoute. Plantillas Email es desde el 04/11/2026 una subpestaña de
// Reservas › Configuración (sección «reservas»).

// Destino al rechazar: la primera sección que el usuario sí puede ver, en el
// orden del menú. Antes se mandaba siempre a /dashboard, y quien no tenía
// permiso de dashboard (p. ej. solo carta y facturas) entraba en un bucle de
// redirecciones infinito y no podía entrar al panel (10/10/2026).
const DESTINOS_RECHAZO: { ruta: string; secciones: SectionKey[] }[] = [
  { ruta: "/dashboard", secciones: ["dashboard"] },
  { ruta: "/reservas", secciones: ["reservas"] },
  { ruta: "/gestion-web", secciones: SECCIONES_GESTOR_WEB },
  { ruta: "/marketing", secciones: ["marketing"] },
  { ruta: "/cheques", secciones: ["cheques"] },
  { ruta: "/tienda", secciones: ["tienda"] },
  { ruta: "/facturas", secciones: ["facturas", "facturas_subida"] },
  { ruta: "/rrss", secciones: ["instagram_agencia"] },
  // Tipo de usuario «Albaranes» (10/11/2026): sin otras secciones, entra directo a subir fotos.
  { ruta: "/albaranes", secciones: ["facturas_albaranes"] },
];

/**
 * Pantallas por las que se entra al panel (Auth lleva a /dashboard). Quien no tiene Dashboard —el tipo
 * «Reservas» o «Albaranes», 10/11/2026— pasa a su sección sin que cuente como acceso denegado: no lo ha
 * intentado, es la puerta de entrada.
 */
const RUTAS_ENTRADA = new Set(["/", "/dashboard"]);

export const ProtectedRoute = ({ children, requiredSection }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, permissions, loading: roleLoading, verificado: rolVerificado = true, seccionInicio } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading, verificado: superVerificado = true } = useSuperAdmin();
  // Rol y permisos pueden venir de lo recordado en el dispositivo (09/11/2026, `lib/cachePermisos.ts`):
  // sirven para DEJAR PASAR al momento, pero no para echar a nadie hasta confirmarlos con el servidor
  // (un permiso recién dado no estaría en la copia).
  const verificado = rolVerificado && superVerificado;
  const navigate = useNavigate();
  const location = useLocation();

  const denegado = useRef<string | null>(null);
  // Entrada (location.key) en la que ya se decidió, con datos del servidor, quedarse: no se vuelve a mirar.
  const inicioDecidido = useRef<string | null>(null);
  const loading = authLoading || roleLoading || superAdminLoading;

  // Sección de inicio (11/11/2026, petición del dueño: «qué pestaña se le va a abrir por defecto cuando
  // inician sesión»): al entrar, la elegida si puede verla (null = lo de siempre). Sin saberla aún (sin
  // copia en el dispositivo ni respuesta del servidor) se espera a la lectura. El marco del panel
  // (`requiredSection={[]}`, solo sesión) no decide: lo hace la página.
  const esMarco = Array.isArray(requiredSection) && requiredSection.length === 0;
  const enEntrada = !esMarco && esEntradaAlPanel(location.pathname, location.state) && inicioDecidido.current !== location.key;
  const esperandoInicio = enEntrada && seccionInicio === undefined && !verificado;
  const destinoInicio = enEntrada && !esperandoInicio ? rutaDeInicio(seccionInicio, permissions, isSuperAdmin) : null;
  const vaAlInicio = destinoInicio !== null && destinoInicio !== location.pathname;

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Verificar permisos de sección
  useEffect(() => {
    if (loading || !user) return;

    // Al entrar, la sección de inicio del usuario manda (también sobre «lo de siempre» de abajo).
    if (enEntrada) {
      if (esperandoInicio) return;
      if (vaAlInicio && destinoInicio) {
        inicioDecidido.current = location.key;
        navigate(destinoInicio, { replace: true });
        return;
      }
      // Con lo recordado en el dispositivo aún puede cambiar al llegar lo del servidor.
      if (verificado) inicioDecidido.current = location.key;
    }

    const required = requiredSection ?? ROUTE_TO_SECTION[location.pathname];
    const sectionKeys = Array.isArray(required) ? required : required ? [required] : [];

    if (sectionKeys.length === 0) return; // Ruta no mapeada, permitir acceso

    // Los super admins tienen acceso a todo, pase lo que pase en la tabla de
    // permisos (2026-09-26). Ser "admin" ya no basta: un admin ahora solo ve
    // lo que le marquen sus permisos, salvo la sección de usuarios (abajo).
    if (isSuperAdmin) return;

    const rechazar = () => {
      const key = `${user.id}:${location.key}`;
      if (denegado.current !== key && !RUTAS_ENTRADA.has(location.pathname)) {
        denegado.current = key;
        void auditDeniedAccess(location.pathname);
      }
      const destino = DESTINOS_RECHAZO.find(
        (d) => d.ruta !== location.pathname
          && d.secciones.some((key) => permissions.find((p) => p.section_key === key)?.can_view),
      )?.ruta ?? "/ayuda"; // /ayuda no exige permisos: nunca rebota
      navigate(destino, { replace: true });
    };
    // «Usuarios» se configura por permisos como las demás (06/11/2026; antes, rol admin).

    // Verificar permiso de visualización (basta con una de las secciones:
    // p. ej. el Gestor Web agrupa carta, contenido web y bot, y cada pestaña
    // vuelve a comprobar la suya).
    const puedeVer = sectionKeys.some(
      (key) => permissions.find((p) => p.section_key === key)?.can_view,
    );
    if (!puedeVer && verificado) {
      rechazar();
    }
  }, [user, loading, verificado, isAdmin, isSuperAdmin, permissions, location.pathname, location.key, requiredSection, navigate, enEntrada, esperandoInicio, vaAlInicio, destinoInicio]);

  if (loading || esperandoInicio || vaAlInicio) {
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
  if (!isSuperAdmin && keys.length && !keys.some(key => permissions.some(p => p.section_key === key && p.can_view))) {
    // Sin permiso según lo recordado: se espera a la lectura del servidor antes de decidir.
    return verificado ? null : (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  return <>{children}</>;
};
