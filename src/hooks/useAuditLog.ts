import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLogEntry {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_label?: string;
  actor_origin?: "usuario" | "servicio" | "base_de_datos" | "historico";
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

    const desde = pagina * PAGE_SIZE;
    const consultar = (columnaActor: "actor_label" | "actor_email") => {
      let query = supabase.from("audit_log").select("*", { count: "exact" });
      if (filtros.actor?.trim()) query = query.ilike(columnaActor, `%${filtros.actor.trim()}%`);
      if (filtros.accion) query = query.eq("accion", filtros.accion);
      if (filtros.tabla) query = query.eq("tabla", filtros.tabla);
      if (filtros.desde) query = query.gte("created_at", filtros.desde);
      if (filtros.hasta) query = query.lte("created_at", filtros.hasta);
      return query.order("created_at", { ascending: false }).range(desde, desde + PAGE_SIZE - 1);
    };
    let resultado = await consultar("actor_label");
    // Mantiene el filtro de emails operativo durante el despliegue del SQL.
    if (resultado.error?.code === "42703" && resultado.error.message.includes("actor_label")) {
      resultado = await consultar("actor_email");
    }
    const { data, error: queryError, count } = resultado;

    if (queryError) {
      setError(queryError.message);
      setEntradas([]);
      setTotal(0);
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

/** Nombre legible de cada tabla auditada, para no enseñar el nombre crudo de la tabla SQL. */
export const TABLA_LABEL: Record<string, string> = {
  user_roles: "Roles de usuario",
  user_permissions: "Permisos de usuario",
  super_admins: "Super admins",
  admin_feature_toggles: "Secciones activas del panel",
  sell_users: "Usuarios de venta",
  configuracion_reservas: "Configuración de reservas",
  configuracion_web: "Configuración de la web",
  configBotWeb: "Configuración del bot web",
  chat_web_config: "Configuración del chat web",
  gdpr_config: "Configuración RGPD",
  dashboard_config: "Configuración del panel",
  phone_system_config: "Configuración de telefonía",
  user_role_presets: "Plantillas de rol",
};

export interface AuditLogGrupo {
  /** Clave estable para `key` de React: no cambia al reordenar ni al re-renderizar. */
  key: string;
  actor_email: string | null;
  actor_user_id: string | null;
  actor_label: string;
  actor_origin: AuditLogEntry["actor_origin"];
  accion: AuditLogEntry["accion"];
  tabla: string | null;
  created_at: string;
  entradas: AuditLogEntry[];
}

/**
 * Agrupa filas consecutivas de la misma operación en bloque: un alta de
 * usuario, por ejemplo, inserta varias filas en `user_permissions` (una por
 * sección) EN LA MISMA TRANSACCIÓN, así que comparten el mismo actor, acción,
 * tabla y `created_at` exacto (`now()` es constante dentro de una
 * transacción en Postgres, no hace falta redondear). Sin agrupar, esas
 * operaciones de alta inundan la lista con 5-10 filas idénticas y entierran
 * el resto — el motivo original de que "no se entienda bien".
 */
export interface CambioCampo {
  campo: string;
  antes: unknown;
  despues: unknown;
}

const CAMPOS_IGNORADOS_EN_DIFF = new Set(["updated_at", "created_at"]);

/**
 * De `{antes, despues}` (lo que guarda `fn_registrar_auditoria` en un
 * "actualizar") saca solo los campos que de verdad cambiaron — para no
 * obligar a leer el JSON entero cuando solo cambió un campo de ocho.
 * Devuelve [] si no hay antes/después que comparar (p. ej. en "crear").
 */
export function resumirCambios(detalles: Record<string, unknown> | null): CambioCampo[] {
  if (!detalles) return [];
  // Conceder/retirar un permiso tiene un estado efectivo anterior y posterior
  // aunque la fila SQL sea nueva o se haya borrado. Los snapshots se conservan.
  const antes = (detalles.permiso_antes ?? detalles.antes) as Record<string, unknown> | null | undefined;
  const despues = (detalles.permiso_despues ?? detalles.despues) as Record<string, unknown> | null | undefined;
  if (!antes || !despues) return [];

  const campos = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const cambios: CambioCampo[] = [];
  for (const campo of campos) {
    if (CAMPOS_IGNORADOS_EN_DIFF.has(campo)) continue;
    const valorAntes = antes[campo];
    const valorDespues = despues[campo];
    if (JSON.stringify(valorAntes) !== JSON.stringify(valorDespues)) {
      cambios.push({ campo, antes: valorAntes, despues: valorDespues });
    }
  }
  return cambios;
}

export function agruparEntradas(entradas: AuditLogEntry[]): AuditLogGrupo[] {
  const grupos: AuditLogGrupo[] = [];

  for (const entrada of entradas) {
    const anterior = grupos[grupos.length - 1];
    const mismoBloque =
      anterior &&
      anterior.actor_user_id === entrada.actor_user_id &&
      anterior.actor_label === identificarActor(entrada) &&
      anterior.actor_origin === entrada.actor_origin &&
      anterior.accion === entrada.accion &&
      anterior.tabla === entrada.tabla &&
      anterior.created_at === entrada.created_at;

    if (mismoBloque) {
      anterior.entradas.push(entrada);
    } else {
      grupos.push({
        key: entrada.id,
        actor_email: entrada.actor_email,
        actor_user_id: entrada.actor_user_id,
        actor_label: identificarActor(entrada),
        actor_origin: entrada.actor_origin,
        accion: entrada.accion,
        tabla: entrada.tabla,
        created_at: entrada.created_at,
        entradas: [entrada],
      });
    }
  }

  return grupos;
}

/** Compatible con históricos y con datos leídos antes de aplicar la migración. */
export function identificarActor(entrada: AuditLogEntry): string {
  return entrada.actor_label?.trim() || entrada.actor_email?.trim()
    || (entrada.actor_user_id ? `Usuario · ${entrada.actor_user_id}` : `Registro histórico · ${entrada.id}`);
}
