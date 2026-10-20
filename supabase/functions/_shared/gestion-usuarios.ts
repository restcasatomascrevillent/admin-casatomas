export const esIdUsuario = (valor: unknown): valor is string =>
  typeof valor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);

export async function datosUsuarios(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

export function errorAuthUsuarios(error: { code?: string; status?: number; message?: string }, alternativa: string) {
  if (error.code === "same_password") return { status: 400, error: "La nueva contraseña debe ser diferente de la actual" };
  if (error.code === "weak_password") return { status: 400, error: "La contraseña no cumple los requisitos de seguridad. Usa una contraseña más larga con letras, números y símbolos." };
  if (["email_exists", "user_already_exists"].includes(error.code ?? "") || error.message?.includes("already been registered")) {
    return { status: 409, error: "Este nombre de usuario ya está registrado" };
  }
  if (error.code === "user_not_found" || error.status === 404) return { status: 404, error: "El usuario ya no existe. Actualiza la lista." };
  return { status: error.status && error.status >= 400 && error.status < 500 ? error.status : 502, error: alternativa };
}
