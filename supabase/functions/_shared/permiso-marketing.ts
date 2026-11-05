// ============================================================================
// Permiso de la sección Marketing — lógica pura (testeable con vitest)
// ----------------------------------------------------------------------------
// Movido aquí desde enviar-newsletter/permiso.ts (que ahora lo reexporta) para
// que lo usen también newsletter-sync-resend y quien venga detrás.
//
// Se pasa el cliente de Supabase creado con el JWT del usuario:
// can_read_section()/can_write_section() resuelven auth.uid() de la llamada
// (mismas funciones que las políticas RLS de newsletter_suscriptores; mismo
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

export const SECCION_MARKETING = "marketing";

/**
 * «escribir» = can_write_section (hoy mira «Ver», a propósito, en todo el
 * panel); «editar» = can_edit_section («Editar» de verdad: Instagram desde
 * 20261111000000); «leer» = can_read_section.
 */
export type ModoPermiso = "leer" | "escribir" | "editar";

export async function comprobarPermisoSeccion(
  cliente: ClientePermiso,
  seccion: string,
  modo: ModoPermiso,
  mensajeSinPermiso = "No tienes permiso para esta sección",
): Promise<ResultadoPermiso> {
  const { data, error: errorUsuario } = await cliente.auth.getUser();
  const user = data?.user ?? null;
  if (errorUsuario || !user) return { ok: false, status: 401, error: "Unauthorized" };

  const fn = modo === "editar" ? "can_edit_section" : modo === "escribir" ? "can_write_section" : "can_read_section";
  const { data: permitido, error } = await cliente.rpc(fn, { _section: seccion });
  if (error) return { ok: false, status: 500, error: "No se pudo comprobar el permiso" };
  if (permitido !== true) return { ok: false, status: 403, error: mensajeSinPermiso };

  return { ok: true, userId: user.id };
}
