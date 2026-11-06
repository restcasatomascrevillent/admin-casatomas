// ============================================================================
// Permiso para enviar el newsletter
// ----------------------------------------------------------------------------
// Antes enviar-newsletter solo exigía "usuario autenticado": cualquier cuenta
// del panel (cocina, sala...) podía mandar un correo a toda la lista. Se exigía
// can_write_section('marketing'); desde el 06/11/2026 (decisión del dueño: con
// solo «Ver» el newsletter se consulta) se exige «Editar»:
// can_edit_section('marketing'), también para la prueba. La lógica vive ahora en
// ../_shared/permiso-marketing.ts (la usa también newsletter-sync-resend);
// aquí queda el nombre de siempre para no romper a nadie.
// ============================================================================

import {
  comprobarPermisoSeccion,
  SECCION_MARKETING,
  type ClientePermiso,
  type ResultadoPermiso,
} from "../_shared/permiso-marketing.ts";

export type { ClientePermiso, ResultadoPermiso };

export const SECCION_NEWSLETTER = SECCION_MARKETING;

export function comprobarPermisoNewsletter(cliente: ClientePermiso): Promise<ResultadoPermiso> {
  return comprobarPermisoSeccion(
    cliente,
    SECCION_NEWSLETTER,
    "editar",
    "No tienes permiso para enviar el newsletter (hace falta «Editar» en Newsletter, no solo «Ver»)",
  );
}
