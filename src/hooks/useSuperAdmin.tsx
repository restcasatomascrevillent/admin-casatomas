import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { alRevalidarSesion } from "@/lib/revalidacion-sesion";
import { guardarPermisosRecordados, leerPermisosRecordados } from "@/lib/cachePermisos";

interface SuperAdminData {
  isSuperAdmin: boolean;
  loading: boolean;
  /** Ya se ha leído del servidor para este usuario (si no, puede ser lo recordado: `lib/cachePermisos.ts`). */
  verificado?: boolean;
}

const SuperAdminContext = createContext<SuperAdminData | null>(null);

/**
 * Única consulta de "¿es super admin?" para toda la app (2026-09-25).
 *
 * Mismo problema que useAuth/useUserRole: SuperAdminRoute, SuperAdminSidebar
 * y SuperAdminLogin llamaban cada uno a su propio useSuperAdmin(), así que
 * entrar a /super-admin disparaba dos o tres consultas independientes a
 * super_admins en paralelo, con su propio `loading` cada una — parte del
 * lag y el parpadeo al entrar al Super Admin. Ahora vive una sola vez aquí.
 */
export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  // Se depende del id (un string), NO del objeto `user`: supabase-js re-emite
  // SIGNED_IN / TOKEN_REFRESHED al volver a la app y eso no debe relanzar la
  // consulta ni poner loading=true (desmontaría la página protegida).
  const userId = user?.id ?? null;
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verificado, setVerificado] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (authLoading) return;

    if (!userId) {
      setIsSuperAdmin(false);
      setLoading(false);
      setVerificado(true);
      return;
    }
    setVerificado(false);

    // Lo recordado para ESTE usuario se usa ya y se vuelve a leer igualmente (09/11/2026, `lib/cachePermisos.ts`).
    const recordado = leerPermisosRecordados(userId)?.superAdmin;
    if (recordado !== undefined) {
      setIsSuperAdmin(recordado);
      setLoading(false);
    } else {
      setLoading(true);
    }
    supabase
      .from("super_admins")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        setVerificado(true);
        if (!error) guardarPermisosRecordados(userId, { superAdmin: !!data });
        // Con algo recordado, un fallo de red no cambia lo conocido (como la relectura de abajo).
        if (error && recordado !== undefined) return;
        setIsSuperAdmin(!error && !!data);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [userId, authLoading]);

  // CT-REM-FE-02: relectura silenciosa al revalidar la sesión.
  useEffect(() => {
    if (authLoading || !userId) return;
    let vivo = true;
    const baja = alRevalidarSesion(() => {
      void supabase
        .from("super_admins")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!vivo || error) return; // un fallo no cambia el estado conocido
          guardarPermisosRecordados(userId, { superAdmin: !!data });
          setIsSuperAdmin(!!data);
        });
    });
    return () => {
      vivo = false;
      baja();
    };
  }, [userId, authLoading]);

  const value: SuperAdminData = { isSuperAdmin, loading: authLoading || loading, verificado };

  return <SuperAdminContext.Provider value={value}>{children}</SuperAdminContext.Provider>;
}

export function useSuperAdmin(): SuperAdminData {
  const context = useContext(SuperAdminContext);
  if (!context) {
    throw new Error("useSuperAdmin debe usarse dentro de <SuperAdminProvider>");
  }
  return context;
}
