import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** GoTrue no propaga las cabeceras HTTP al ejecutar sus triggers/cascadas. */
export async function ejecutarOperacionAuthAuditada<T>(
  client: SupabaseClient,
  actorId: string,
  operacion: "crear" | "eliminar",
  subject: { userId?: string; email?: string },
  ejecutar: () => Promise<T>,
): Promise<T> {
  const { data: contextId, error } = await client.rpc("preparar_contexto_auditoria_auth", {
    p_actor_id: actorId,
    p_operacion: operacion,
    p_user_id: subject.userId ?? null,
    p_email: subject.email ?? null,
  });
  if (error || !contextId) {
    throw new Error("No se pudo identificar al autor de la operación de usuarios");
  }
  try {
    return await ejecutar();
  } finally {
    // Un fallo de limpieza no oculta el resultado de Auth; el contexto caduca.
    try {
      const { error: cleanupError } = await client.from("audit_auth_context").delete().eq("id", contextId);
      if (cleanupError) console.error("Error limpiando el contexto de auditoría:", cleanupError);
    } catch (cleanupError) {
      console.error("Error limpiando el contexto de auditoría:", cleanupError);
    }
  }
}
