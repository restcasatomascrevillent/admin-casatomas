export interface UserAccessDependencies {
  currentUser(): Promise<{ id: string } | null>;
  isSuperAdmin(userId: string): Promise<boolean>;
  targetUser(
    userId: string,
  ): Promise<{ id: string; isSuperAdmin: boolean } | null>;
  setBlocked(actorId: string, userId: string, blocked: boolean): Promise<void>;
}

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers });

export async function handleUserAccess(
  req: Request,
  deps: UserAccessDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST")
    return reply(405, { error: "Método no permitido" });
  try {
    const actor = await deps.currentUser();
    if (!actor) return reply(401, { error: "Usuario no autenticado" });
    if (!(await deps.isSuperAdmin(actor.id)))
      return reply(403, {
        error: "Solo un super admin puede bloquear o desbloquear usuarios",
      });
    const raw = await req.text();
    if (raw.length > 4096)
      return reply(413, { error: "Petición demasiado grande" });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: "Petición inválida" });
    }
    const { userId, blocked } = body ?? {};
    if (
      typeof userId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        userId,
      ) ||
      typeof blocked !== "boolean"
    ) {
      return reply(400, {
        error: "Indica un usuario y si debe quedar bloqueado",
      });
    }
    if (userId === actor.id)
      return reply(400, {
        error: "No puedes bloquear ni cambiar el acceso de tu propia cuenta",
      });
    const target = await deps.targetUser(userId);
    if (!target) return reply(404, { error: "Usuario no encontrado" });
    if (blocked && target.isSuperAdmin)
      return reply(400, {
        error:
          "Quita primero el acceso de super admin antes de bloquear esta cuenta",
      });
    await deps.setBlocked(actor.id, userId, blocked);
    return reply(200, { success: true, access_blocked: blocked });
  } catch (error) {
    console.error("Error cambiando el bloqueo de acceso:", error);
    return reply(503, {
      error:
        "No se pudo confirmar el cambio de acceso. Actualiza la lista antes de volver a intentarlo.",
    });
  }
}
