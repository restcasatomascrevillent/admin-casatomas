import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLogEntry {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  accion: "login" | "logout" | "crear" | "actualizar" | "eliminar";
  tabla: string | null;
  registro_id: string | null;
  detalles: Record<string, unknown> | null;
  user_agent: string | null;
}

export interface AuditLogFiltros {
  actor?: string;
  accion?: string;
  tabla?: string;
  desde?: string;
  hasta?: string;
}

const PAGE_SIZE = 25;

/**
 * Lista paginada de `audit_log` para /super-admin/auditoria. Solo
 * super_admins pueden leer esta tabla (política RLS), así que un error aquí
 * para cualquier otro usuario es síntoma de que algo le dio acceso a esta
 * pantalla por error, no un fallo de red a tratar en silencio.
 */
export function useAuditLog(filtros: AuditLogFiltros, pagina: number) {
  const [entradas, setEntradas] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntradas = useCallback(async () => {
    setLoading(true);
    setError(null);

    let query = supabase.from("audit_log").select("*", { count: "exact" });

    if (filtros.actor?.trim()) query = query.ilike("actor_email", `%${filtros.actor.trim()}%`);
    if (filtros.accion) query = query.eq("accion", filtros.accion);
    if (filtros.tabla) query = query.eq("tabla", filtros.tabla);
    if (filtros.desde) query = query.gte("created_at", filtros.desde);
    if (filtros.hasta) query = query.lte("created_at", filtros.hasta);

    const desde = pagina * PAGE_SIZE;
    const { data, error: queryError, count } = await query
      .order("created_at", { ascending: false })
      .range(desde, desde + PAGE_SIZE - 1);

    if (queryError) {
      setError(queryError.message);
      setEntradas([]);
    } else {
      setEntradas((data ?? []) as AuditLogEntry[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [filtros.actor, filtros.accion, filtros.tabla, filtros.desde, filtros.hasta, pagina]);

  useEffect(() => {
    fetchEntradas();
  }, [fetchEntradas]);

  return { entradas, total, pageSize: PAGE_SIZE, loading, error, refetch: fetchEntradas };
}

/** Tablas que de verdad tienen auditoría (ver migración `audit_log`) — para el <select> de filtro. */
export const TABLAS_AUDITADAS = [
  "user_roles",
  "user_permissions",
  "super_admins",
  "admin_feature_toggles",
  "sell_users",
  "configuracion_reservas",
  "configuracion_web",
  "configBotWeb",
  "chat_web_config",
  "gdpr_config",
  "dashboard_config",
  "phone_system_config",
  "user_role_presets",
] as const;
