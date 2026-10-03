// ============================================================================
// Permiso para enviar el newsletter — lógica pura (testeable con vitest)
// ----------------------------------------------------------------------------
// Antes enviar-newsletter solo exigía "usuario autenticado": cualquier cuenta
// del panel (cocina, sala...) podía mandar un correo a toda la lista. Ahora se
// exige can_write_section('marketing'), la misma función de las políticas RLS
// de newsletter_suscriptores. Se pasa el cliente de Supabase creado con el JWT
// del usuario: can_write_section() resuelve auth.uid() de la llamada (mismo
// patrón que emails-reserva/index.ts:autenticarUsuarioPanel).
// ============================================================================

export interface ClientePermiso {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export type ResultadoPermiso =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

export const SECCION_NEWSLETTER = "marketing";

export async function comprobarPermisoNewsletter(cliente: ClientePermiso): Promise<ResultadoPermiso> {
  const { data, error: errorUsuario } = await cliente.auth.getUser();
  const user = data?.user ?? null;
  if (errorUsuario || !user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: permitido, error } = await cliente.rpc("can_write_section", { _section: SECCION_NEWSLETTER });
  if (error) return { ok: false, status: 500, error: "No se pudo comprobar el permiso" };
  if (permitido !== true) return { ok: false, status: 403, error: "No tienes permiso para enviar el newsletter" };

  return { ok: true, userId: user.id };
}
