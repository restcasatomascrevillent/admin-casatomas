import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { elegirPestanaInicial } from "@/components/menuPanel";
import { esEntradaAlPanel } from "@/lib/pestanaInicial";

/** Pestaña guardada del usuario (tabla user_pestana_inicial). Cualquier fallo = sin elección. */
function usePestanaInicialGuardada(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["pestana-inicial", userId],
    enabled: !!userId,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      try {
        const { data, error } = await supabase
          .from("user_pestana_inicial")
          .select("ruta")
          .eq("user_id", userId as string)
          .maybeSingle();
        if (error) return null;
        return data?.ruta ?? null;
      } catch {
        return null;
      }
    },
  });
}

/**
 * Con todo leído del servidor (permisos confirmados, super admin, interruptores y la pestaña guardada), abre la
 * pestaña elegida si el usuario aún la ve en el menú. Si no, no hace nada: se queda donde le ha dejado el panel.
 * Solo se monta mientras hay una entrada pendiente (no pide nada al navegar).
 */
function ResolverPestanaInicial({ onTerminar }: { onTerminar: () => void }) {
  const { user } = useAuth();
  const { permissions, loading, verificado = true } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading, verificado: superVerificado = true } = useSuperAdmin();
  const { isEnabled, loading: togglesLoading } = useAdminFeatureToggles();
  const guardada = usePestanaInicialGuardada(user?.id);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const listo =
    !!user &&
    !loading &&
    verificado &&
    !superAdminLoading &&
    superVerificado &&
    !togglesLoading &&
    // Leída en ESTA entrada (no la copia de una entrada anterior: el super admin pudo cambiarla).
    (guardada.isFetchedAfterMount || guardada.status === "error");

  const hecho = useRef(false);
  useEffect(() => {
    if (!listo || hecho.current) return;
    hecho.current = true;
    const destino = elegirPestanaInicial(guardada.data, {
      permisos: permissions,
      esSuperAdmin: isSuperAdmin,
      isEnabled,
    });
    onTerminar();
    if (destino && destino !== pathname) navigate(destino, { replace: true });
  }, [listo, guardada.data, permissions, isSuperAdmin, isEnabled, onTerminar, pathname, navigate]);

  return null;
}

/**
 * «Pestaña al iniciar sesión» (11/11/2026, la elige un super admin en Usuarios › Permisos).
 *
 * Al ENTRAR al panel (ver `esEntradaAlPanel`) queda una entrada pendiente hasta tener los datos. Mientras tanto
 * el panel hace lo de siempre: pinta el Dashboard o, sin permiso, `ProtectedRoute` lleva a la primera sección que
 * se ve (con `replace`). Si el usuario navega él mismo antes (PUSH/POP), la entrada se olvida.
 */
export function AbrirPestanaInicial() {
  const location = useLocation();
  const tipoNavegacion = useNavigationType();
  const [pendiente, setPendiente] = useState(false);

  useEffect(() => {
    if (esEntradaAlPanel(location.pathname, location.state)) setPendiente(true);
    else if (tipoNavegacion !== "REPLACE") setPendiente(false);
  }, [location.key, location.pathname, location.state, tipoNavegacion]);

  const terminar = useRef(() => setPendiente(false)).current;
  return pendiente ? <ResolverPestanaInicial onTerminar={terminar} /> : null;
}
