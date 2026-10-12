export interface ReversionDependencies {
  identify(token: string): Promise<{ id: string } | null>;
  isSuperAdmin(id: string): Promise<boolean>;
  beginValidation(actor: string, event: string): Promise<boolean>;
  verifyPassword(
    email: string,
    password: string,
  ): Promise<{ id: string } | null>;
  revert(event: string, actor: string, confirm: boolean): Promise<unknown>;
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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleReversion(
  req: Request,
  deps: ReversionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST")
    return reply(405, { error: "Método no permitido" });
  const token =
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return reply(401, { error: "Inicia sesión para continuar" });
  try {
    const actor = await deps.identify(token);
    if (!actor) return reply(401, { error: "La sesión no es válida" });
    if (!(await deps.isSuperAdmin(actor.id)))
      return reply(403, { error: "Solo el superadmin puede revertir cambios" });
    const raw = await req.text();
    if (raw.length > 8192)
      return reply(413, { error: "Petición demasiado grande" });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: "Petición no válida" });
    }
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.evento_id !== "string" ||
      !uuid.test(body.evento_id)
    )
      return reply(400, { error: "Registro de auditoría no válido" });
    if (body.confirmar !== true)
      return reply(200, {
        success: true,
        preview: await deps.revert(body.evento_id, actor.id, false),
      });
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || password.length > 4096)
      return reply(400, {
        error: "Introduce tu usuario/correo y contraseña de superadmin",
      });
    if (!(await deps.beginValidation(actor.id, body.evento_id)))
      return reply(429, { error: "Demasiados intentos. Espera un minuto" });
    const verified = await deps.verifyPassword(email, password);
    if (
      !verified ||
      verified.id !== actor.id ||
      !(await deps.isSuperAdmin(verified.id))
    )
      return reply(403, {
        error:
          "Las credenciales no corresponden al superadmin que ha iniciado sesión",
      });
    return reply(200, await deps.revert(body.evento_id, actor.id, true));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : ((error as { message?: string })?.message ??
          "No se pudo comprobar el cambio");
    // Los errores de concurrencia/relaciones del SQL son revisables; nunca se devuelve una contraseña o un token.
    const permitidos =
      /^(Hay cambios posteriores|Este cambio ya|El registro|Ya existe un registro|Hay registros relacionados|Este registro requiere|No se conservan|No se puede restaurar|No hay campos restaurables|No se puede identificar)/;
    return reply(409, {
      error: permitidos.test(message)
        ? message
        : "No se pudo revertir el cambio. Revisa los datos y vuelve a intentarlo",
    });
  }
}
