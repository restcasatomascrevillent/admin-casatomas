// ============================================================================
// Permiso para enviar el newsletter
// ----------------------------------------------------------------------------
// Antes enviar-newsletter solo exigía "usuario autenticado": cualquier cuenta
// del panel (cocina, sala...) podía mandar un correo a toda la lista. Se exige
// can_write_section('marketing'). La lógica vive ahora en
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
  return comprobarPermisoSeccion(cliente, SECCION_NEWSLETTER, "escribir", "No tienes permiso para enviar el newsletter");
}
