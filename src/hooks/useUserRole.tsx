import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useSuperAdmin } from "./useSuperAdmin";
import { precargarFeatureToggles } from "@/lib/precargaToggles";
import { alRevalidarSesion } from "@/lib/revalidacion-sesion";
import { SUPER_ADMIN_EMAILS, isSuperAdmin as checkIsSuperAdmin } from "@/config/permissions";
import { guardarPermisosRecordados, leerPermisosRecordados } from "@/lib/cachePermisos";

export type AppRole = "admin" | "manager" | "staff";

export interface UserPermissions {
  section_key: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface UserRoleData {
  role: AppRole | null;
  isAdmin: boolean;
  permissions: UserPermissions[];
  loading: boolean;
  /**
   * Ya se han leído del servidor (o se intentó) para este usuario. Con `false` lo que hay puede ser lo
   * recordado en el dispositivo (`lib/cachePermisos.ts`): vale para dejar pasar, no para echar a nadie.
   */
  verificado?: boolean;
}

export const SECTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "reservas", label: "Reservas" },
  // Pestaña «Configuración» de Reservas (reglas, mesas, turnos y plantillas de
  // correo), con permiso propio desde el 04/11/2026, como las pestañas del
  // Gestor Web. Sin «Ver» en «Reservas» no se llega a ella (está en /reservas).
  { key: "reservas_configuracion", label: "Reservas · Configuración" },
  // Crear reservas sin «Editar» (10/11/2026, tipo de usuario «Reservas»): con
  // «Ver» en Reservas, «Nueva reserva» y nada más (ni modificar, ni cambiar el
  // estado, ni mesas). Un solo interruptor («Puede crear», en can_view). En la
  // BD: reservas_puede_crear() (migración 20261122143000).
  { key: "reservas_crear", label: "Reservas · Crear" },
  // "trabajadores" (Personal) retirada el 2026-09-23 (decisión del dueño).
  // Filas de user_permissions con section_key="trabajadores" que puedan
  // quedar en la BD se ignoran sin más: ningún componente busca ya esa key.
  { key: "gestor_carta", label: "Gestor Web · Carta" },
  { key: "gestion_web", label: "Gestor Web · Novedades, menús y tapas" },
  { key: "marketing", label: "Newsletter y RRSS" },
  // Usuarios de la agencia (Oficiosos) en los encargos de Instagram, 10/11/2026:
  // aceptan, entregan versiones y comentan (pestaña Instagram › Encargos). Ver
  // docs/instagram-encargos.md. Con «Marketing» se es el restaurante.
  { key: "instagram_agencia", label: "RRSS · Instagram · Agencia (Oficiosos)" },
  // Usuario del equipo que genera los vídeos de los reels (scripts/instagram/
  // render-reels.mjs), 11/11/2026: con «Editar» solo reclama, genera, sube y
  // cierra sus trabajos. Sin Marketing. Ver docs/instagram-video.md.
  { key: "instagram_render", label: "RRSS · Instagram · Render (equipo de vídeo)" },
  { key: "cheques", label: "Cheques regalo" },
  // Tienda de vinos de la web (escaparate: se compra en el restaurante), 2026-11-03.
  { key: "tienda", label: "Tienda" },
  { key: "facturas", label: "Facturas" },
  // Subir facturas y albaranes (pestaña Cargar) y corregir lo que sube uno
  // mismo, 06/11/2026 (dueño). Va por libre: no necesita «Ver» en Facturas.
  // Un solo interruptor («Puede subir», guardado en can_view). En la BD:
  // facturas_puede_subir() (migración 20261106510000).
  { key: "facturas_subida", label: "Facturas · Subida" },
  // Solo subir fotos de albaranes y facturas (10/11/2026, tipo de usuario
  // «Albaranes»): pantalla /albaranes, pensada para el móvil. Sin ver lo leído
  // ni importes ni el resto de Facturas. Un solo interruptor («Puede subir
  // fotos», en can_view). En la BD: facturas_puede_subir_fotos() y
  // albaranes_mis_subidas() (migración 20261122143000).
  { key: "facturas_albaranes", label: "Facturas · Solo fotos (albaranes)" },
  { key: "usuarios", label: "Usuarios" },
] as const;
// Nota: Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Tráfico web,
// Espacios y Bot Web se gestionan exclusivamente desde el Super Admin y ya no
// forman parte del Admin Panel normal. Plantillas Email volvió al panel el
// 04/11/2026, dentro de Reservas › Configuración (sección
// «reservas_configuracion»).

export type SectionKey = typeof SECTIONS[number]["key"];

const UserRoleContext = createContext<UserRoleData | null>(null);

/** Guarda rol y permisos en el dispositivo solo si las DOS lecturas fueron bien (PGRST116 = sin rol, vale). */
function recordarSiCompleto(
  userId: string,
  roleData: { role: string } | null,
  roleError: { code?: string } | null,
  permData: UserPermissions[] | null,
  permError: unknown,
) {
  if (permError || !permData) return;
  if (roleError && roleError.code !== "PGRST116") return;
  guardarPermisosRecordados(userId, { role: (roleData?.role as AppRole | undefined) ?? null, permissions: permData });
}

/**
 * Única consulta de rol/permisos para toda la app (2026-09-25).
 *
 * Mismo problema que useAuth: ProtectedRoute y AppSidebar llamaban cada uno
 * a su propio useUserRole(), así que cada carga de página disparaba DOS
 * consultas independientes a user_roles y user_permissions, con dos
 * `loading` que resolvían en momentos distintos — parte del lag y el
 * parpadeo al entrar. Ahora la consulta vive una sola vez aquí, en
 * UserRoleProvider, y useUserRole()/useCanAccessSection() solo leen ese
 * contexto.
 */
export function UserRoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [verificado, setVerificado] = useState(false);

  // Se depende de valores primitivos (id, email), NO del objeto `user`:
  // supabase-js re-emite SIGNED_IN / TOKEN_REFRESHED al volver a la app y eso
  // no debe relanzar la consulta ni poner loading=true (desmontaría la página
  // protegida, con sus formularios y diálogos). Un usuario distinto sí cambia
  // el id y recarga rol y permisos.
  const userId = user?.id ?? null;
  const isSuperAdminUser = checkIsSuperAdmin(user?.email);

  useEffect(() => {
    // Espera a que useAuth resuelva del todo antes de decidir nada. Sin este
    // guard, en el instante en que `user` todavía es null (useAuth sigue
    // validando la sesión) este efecto ya resolvía loading=false; cuando
    // `user` llegaba un instante después, había un render en el que TANTO
    // authLoading como este loading leían false a la vez → se veía el
    // contenido de la página → y acto seguido este efecto volvía a poner
    // loading=true para pedir el rol → aparecía el spinner encima. Ese
    // "página y luego spinner" era exactamente esta carrera.
    if (authLoading) return;

    if (!userId) {
      setRole(null);
      setPermissions([]);
      setLoading(false);
      setVerificado(true);
      return;
    }

    let isMounted = true;
    setVerificado(false);

    // Este efecto solo corre al cargar o al cambiar de usuario (nunca en un
    // refresco de token), así que es seguro descartar lo del usuario anterior.
    setRole(null);
    setPermissions([]);

    // Si es super admin, acceso inmediato
    if (isSuperAdminUser) {
      setRole("admin");
      setLoading(false);
    }

    // Lo último que se leyó para ESTE usuario en este dispositivo (09/11/2026, mala cobertura): se pinta
    // ya y se vuelve a leer abajo igualmente; si ha cambiado, se corrige al llegar (`lib/cachePermisos.ts`).
    const recordado = leerPermisosRecordados(userId);
    if (recordado?.permissions) {
      setRole(recordado.role ?? (isSuperAdminUser ? "admin" : null));
      setPermissions(recordado.permissions);
      setLoading(false);
    }

    // El menú lateral los necesita en cuanto pase ProtectedRoute: se piden ya, en paralelo.
    precargarFeatureToggles();

    const fetchRoleAndPermissions = async () => {
      // Si no es super admin (ni hay nada recordado), mostramos loading
      if (!isSuperAdminUser && !recordado?.permissions) setLoading(true);

      try {
        // Rol y permisos A LA VEZ (07/11/2026): no dependen uno del otro y en serie eran dos
        // viajes seguidos al entrar (con cobertura de móvil se notaba). Se aplican igual que antes.
        const [{ data: roleData, error: roleError }, { data: permData, error: permError }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", userId).single(),
          supabase.from("user_permissions").select("section_key, can_view, can_edit").eq("user_id", userId),
        ]);
        if (!isMounted) return;
        recordarSiCompleto(userId, roleData, roleError, permData, permError);

        if (roleData) {
          setRole(roleData.role as AppRole);
        } else if (isSuperAdminUser) {
          setRole("admin");
        }

        if (permData) {
          setPermissions(permData);
        }
      } catch (error) {
        console.error("Error fetching role/permissions:", error);
      } finally {
        if (isMounted && !isSuperAdminUser) setLoading(false);
        if (isMounted) setVerificado(true);
      }
    };

    fetchRoleAndPermissions();

    return () => {
      isMounted = false;
    };
  }, [userId, authLoading, isSuperAdminUser]);

  // CT-REM-FE-02: relectura silenciosa de rol y permisos cuando AuthProvider
  // revalida la sesión (TOKEN_REFRESHED, foco y sondeo de 15 s). No toca
  // `loading`, así que no desmonta la página; si falla la lectura se conserva
  // lo último conocido (un corte de red no debe quitar permisos).
  useEffect(() => {
    if (authLoading || !userId) return;
    let vivo = true;
    let enCurso = false;
    const releer = async () => {
      if (enCurso) return;
      enCurso = true;
      try {
        const [{ data: roleData, error: roleError }, { data: permData, error: permError }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", userId).single(),
          supabase.from("user_permissions").select("section_key, can_view, can_edit").eq("user_id", userId),
        ]);
        if (!vivo) return;
        recordarSiCompleto(userId, roleData, roleError, permData, permError);
        // PGRST116 = sin fila: el rol se ha retirado de verdad.
        const roleOk = !roleError || roleError.code === "PGRST116";
        if (roleOk) {
          const nuevo = (roleData?.role as AppRole | undefined) ?? (isSuperAdminUser ? "admin" : null);
          setRole((previo) => (previo === nuevo ? previo : nuevo));
        }
        if (!permError && permData) {
          setPermissions((previo) =>
            JSON.stringify(previo) === JSON.stringify(permData) ? previo : permData,
          );
        }
      } catch (error) {
        console.error("Error revalidando rol/permisos:", error);
      } finally {
        enCurso = false;
      }
    };
    const baja = alRevalidarSesion(() => void releer());
    return () => {
      vivo = false;
      baja();
    };
  }, [userId, authLoading, isSuperAdminUser]);

  const isAdmin = role === "admin" || isSuperAdminUser;

  const value: UserRoleData = {
    role: isSuperAdminUser ? "admin" : role,
    isAdmin,
    permissions,
    loading,
    verificado,
  };

  return <UserRoleContext.Provider value={value}>{children}</UserRoleContext.Provider>;
}

export function useUserRole(): UserRoleData {
  const context = useContext(UserRoleContext);
  if (!context) {
    throw new Error("useUserRole debe usarse dentro de <UserRoleProvider>");
  }
  return context;
}

export function useCanAccessSection(sectionKey: SectionKey, permissionType: "view" | "edit" = "view") {
  const { permissions, loading } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();

  if (loading || superAdminLoading) return { canAccess: false, loading: true };

  // Ser "admin" ya no da acceso automático a todo (2026-09-26): un admin solo
  // ve lo que le marquen sus permisos, igual que un manager o un staff. El
  // único acceso incondicional es el de super admin (tabla super_admins),
  // igual que en has_section_permission() del lado de la base de datos.
  if (isSuperAdmin) return { canAccess: true, loading: false };

  const permission = permissions.find(p => p.section_key === sectionKey);

  if (!permission) return { canAccess: false, loading: false };

  const canAccess = permissionType === "view" ? permission.can_view : permission.can_edit;

  return { canAccess, loading: false };
}

