// Configuración del tablero de Facturas › Análisis («Personalizar»): qué
// cifras y módulos se ven, en qué orden y de qué tamaño. Por usuario.
//
//   · Cuenta: tabla `dashboard_config` (de 2025; RLS «cada usuario la suya»,
//     única por usuario + `nombre_vista`), fila `facturas_analisis`. Sin
//     migración. Así sale igual en la tablet y en el ordenador.
//   · Navegador: copia en localStorage (para pintar al momento y por si la
//     cuenta no responde). Todo con try/catch: en modo privado se usa igual,
//     solo que no se recuerda.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  aFilaBd,
  CLAVE_CONFIG_TABLERO,
  CONFIG_TABLERO_POR_DEFECTO,
  deFilaBd,
  NOMBRE_VISTA_TABLERO,
  normalizarConfigTablero,
  type ConfigTablero,
} from "@/lib/facturas/widgetsTablero";

const CLAVE_QUERY = ["dashboard-config", NOMBRE_VISTA_TABLERO] as const;

function leerLocal(usuario: string | null): ConfigTablero | null {
  try {
    const crudo = window.localStorage.getItem(usuario ? `${CLAVE_CONFIG_TABLERO}:${usuario}` : CLAVE_CONFIG_TABLERO);
    return crudo ? normalizarConfigTablero(JSON.parse(crudo)) : null;
  } catch {
    return null;
  }
}

function guardarLocal(usuario: string | null, c: ConfigTablero) {
  try {
    const json = JSON.stringify(c);
    // La última de este navegador (para pintar al momento) y la de este usuario.
    window.localStorage.setItem(CLAVE_CONFIG_TABLERO, json);
    if (usuario) window.localStorage.setItem(`${CLAVE_CONFIG_TABLERO}:${usuario}`, json);
  } catch {
    // Modo privado o cuota llena: se aplica igual, solo que no se recuerda aquí.
  }
}

type Leido = { usuario: string | null; config: ConfigTablero | null };

/** El usuario de la sesión (sin pedir nada a la red) o null. */
async function usuarioActual(): Promise<string | null> {
  const auth = (supabase as { auth?: { getSession?: () => Promise<{ data: { session: { user?: { id?: string } } | null } }> } }).auth;
  if (!auth?.getSession) return null;
  const { data } = await auth.getSession();
  return data.session?.user?.id ?? null;
}

async function leerDeCuenta(): Promise<Leido> {
  const usuario = await usuarioActual().catch(() => null);
  if (!usuario) return { usuario: null, config: leerLocal(null) };
  try {
    const { data, error } = await supabase
      .from("dashboard_config")
      .select("widgets_activos, orden_widgets")
      .eq("user_id", usuario)
      .eq("nombre_vista", NOMBRE_VISTA_TABLERO)
      .maybeSingle();
    // Sin fila en la cuenta: la suya de este navegador o, si no hay, la última de este navegador.
    const local = leerLocal(usuario) ?? leerLocal(null);
    if (error) return { usuario, config: local };
    const deBd = deFilaBd(data as { widgets_activos?: unknown } | null);
    if (deBd) guardarLocal(usuario, deBd);
    return { usuario, config: deBd ?? local };
  } catch {
    return { usuario, config: leerLocal(usuario) ?? leerLocal(null) };
  }
}

export function useConfigTablero() {
  const qc = useQueryClient();
  // Al montar: la última de este navegador; en cuanto se sabe el usuario, la suya.
  const [inicial] = useState<ConfigTablero>(() => leerLocal(null) ?? CONFIG_TABLERO_POR_DEFECTO);
  const q = useQuery({ queryKey: CLAVE_QUERY, queryFn: leerDeCuenta, staleTime: Infinity, gcTime: Infinity, retry: false });
  const usuario = q.data?.usuario ?? null;
  const config = q.data ? (q.data.config ?? CONFIG_TABLERO_POR_DEFECTO) : inicial;

  /** Aplica y guarda. `enCuenta`: quedó en la cuenta (si no, solo en este navegador). */
  const guardar = useCallback(
    async (c: ConfigTablero): Promise<{ enCuenta: boolean }> => {
      const limpia = normalizarConfigTablero(c);
      qc.setQueryData<Leido>(CLAVE_QUERY, { usuario, config: limpia });
      guardarLocal(usuario, limpia);
      if (!usuario) return { enCuenta: false };
      try {
        const { error } = await supabase
          .from("dashboard_config")
          .upsert({ user_id: usuario, nombre_vista: NOMBRE_VISTA_TABLERO, ...aFilaBd(limpia) } as never, { onConflict: "user_id,nombre_vista" });
        return { enCuenta: !error };
      } catch {
        return { enCuenta: false };
      }
    },
    [qc, usuario],
  );

  return { config, guardar, cargando: q.isLoading };
}
