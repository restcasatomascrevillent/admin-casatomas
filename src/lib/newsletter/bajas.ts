// ============================================================================
// Bajas del newsletter — textos y agrupación para el panel (lógica pura)
// ----------------------------------------------------------------------------
// `origen_baja` lo escribe SIEMPRE el sistema, nunca el personal:
//   · newsletter-baja       -> enlace_email, cabecera_one_click
//   · resend-webhook        -> queja_spam, rebote_permanente, suprimido_resend,
//                              resend_baja_nativa (fase 2, Broadcasts)
//   · trigger de la BD      -> panel_manual si alguien da de baja sin origen
// Ver supabase/migrations/20261003171500_newsletter_baja_automatica.sql.
// ============================================================================

export type OrigenBaja =
  | "enlace_email"
  | "cabecera_one_click"
  | "panel_manual"
  | "queja_spam"
  | "rebote_permanente"
  | "suprimido_resend"
  | "resend_baja_nativa";

export interface SuscriptorNewsletter {
  id: string;
  email: string;
  nombre: string | null;
  activo: boolean;
  created_at: string;
  fecha_baja: string | null;
  origen_baja: string | null;
  origen_alta?: string | null;
  fecha_consentimiento?: string | null;
}

const ETIQUETAS_ORIGEN_BAJA: Record<OrigenBaja, string> = {
  enlace_email: "Se dio de baja desde el email",
  cabecera_one_click: "Pulsó «Cancelar suscripción» en su correo",
  panel_manual: "Dado de baja desde el panel",
  queja_spam: "Marcó el correo como spam",
  rebote_permanente: "Email inexistente o rechazado",
  suprimido_resend: "Email rechazado por el servicio de envío",
  resend_baja_nativa: "Se dio de baja desde la página de baja del correo",
};

/** Texto para el personal. Las bajas de antes de septiembre de 2026 no guardaban el origen. */
export function etiquetaOrigenBaja(origen: string | null | undefined): string {
  if (!origen) return "Motivo no registrado (baja antigua)";
  return ETIQUETAS_ORIGEN_BAJA[origen as OrigenBaja] ?? "Otro motivo";
}

const ETIQUETAS_ORIGEN_ALTA: Record<string, string> = {
  reserva_web: "Reserva web",
  reserva_telefono: "Reserva por teléfono",
  reserva_manual: "Reserva manual",
  solicitud_web: "Solicitud web",
  panel_manual: "Añadido desde el panel",
};

/** De dónde vino el suscriptor. Vacío si no se guardó. */
export function etiquetaOrigenAlta(origen: string | null | undefined): string {
  if (!origen) return "";
  return ETIQUETAS_ORIGEN_ALTA[origen] ?? "Otro origen";
}

/** Las que se producen sin que el cliente pulse nada: el panel las marca distinto. */
export function esBajaPorEntrega(origen: string | null | undefined): boolean {
  return origen === "queja_spam" || origen === "rebote_permanente" || origen === "suprimido_resend";
}

export function formatearFechaBaja(fecha: string | null | undefined): string {
  if (!fecha) return "Fecha no registrada";
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "Fecha no registrada";
  return d.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" });
}

export interface SuscriptoresAgrupados {
  activos: SuscriptorNewsletter[];
  bajas: SuscriptorNewsletter[];
}

/**
 * Activos (más recientes primero) y bajas (baja más reciente primero; las que
 * no tienen fecha, al final). Una fila con activo = false es SIEMPRE baja,
 * tenga o no fecha_baja.
 */
export function agruparSuscriptores(filas: SuscriptorNewsletter[]): SuscriptoresAgrupados {
  const activos = filas.filter((f) => f.activo).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const bajas = filas
    .filter((f) => !f.activo)
    .sort((a, b) => {
      if (a.fecha_baja && b.fecha_baja) return b.fecha_baja.localeCompare(a.fecha_baja);
      if (a.fecha_baja) return -1;
      if (b.fecha_baja) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  return { activos, bajas };
}
