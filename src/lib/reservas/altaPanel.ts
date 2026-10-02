// ============================================================================
// ALTA DE RESERVAS DESDE EL PANEL — reglas puras, sin I/O.
//
// Decisiones del dueño (2026-09-23), para toda reserva creada desde el panel
// (alta manual, "Convertir en reserva" o "Registrar que aceptó por teléfono"):
//   · Nunca nace 'confirmada' en silencio (se ignora
//     configuracion_reservas.auto_confirmar): nace 'verificada' y se dispara
//     notify-reservation-change -> emails-reserva manda la plantilla
//     'propuesta' ("Confirma tu reserva"); el cliente confirma desde el enlace.
//   · Teléfono Y email obligatorios (sin email no hay a quién pedírselo).
//   · Cliente en lista negra: 'pendiente' + en_blacklist, sin correo.
//
// Cambio (2026-09-30): en el FORMULARIO del alta manual (FormularioReserva, que
// también sirve a "Convertir en reserva") el email pasa a ser OPCIONAL:
// `errorEmailOpcional` no lo exige y `emailParaGuardar` lo deja en null si no
// hay. El estado inicial NO cambia (sigue naciendo 'verificada') y sin email no
// se manda el correo "Confirma tu reserva". Sigue siendo obligatorio al
// "Registrar que aceptó por teléfono" (SolicitudGestionPanel y la RPC
// fn_aceptar_propuesta_solicitud): ahí siguen `errorEmail`/`validarContactoReserva`.
// ============================================================================
import { formatearTelefonoReserva, telefonoValido } from "./telefono";

/** Estado con el que nace una reserva creada desde el panel. */
export function estadoInicialAltaPanel(enListaNegra: boolean): "pendiente" | "verificada" {
  return enListaNegra ? "pendiente" : "verificada";
}

/** Si hay que disparar notify-reservation-change tras el alta (correo "Confirma tu reserva"). */
export function debeNotificarAltaPanel(estado: string): boolean {
  return estado === "verificada";
}

export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MENSAJES_CONTACTO = {
  telefonoObligatorio: "El teléfono es obligatorio",
  telefonoInvalido: "Teléfono no válido (mínimo 9 cifras)",
  emailObligatorio: "El email es obligatorio: el cliente recibe un correo para confirmar la reserva",
  emailInvalido: "Email no válido",
} as const;

export function emailValido(email: string | null | undefined): boolean {
  return RE_EMAIL.test((email ?? "").trim());
}

/** Mensaje de error del teléfono (obligatorio), o null si vale. */
export function errorTelefono(telefono: string | null | undefined): string | null {
  if (!(telefono ?? "").trim()) return MENSAJES_CONTACTO.telefonoObligatorio;
  if (!telefonoValido(telefono)) return MENSAJES_CONTACTO.telefonoInvalido;
  return null;
}

/** Mensaje de error del email (obligatorio), o null si vale. */
export function errorEmail(email: string | null | undefined): string | null {
  if (!(email ?? "").trim()) return MENSAJES_CONTACTO.emailObligatorio;
  if (!emailValido(email)) return MENSAJES_CONTACTO.emailInvalido;
  return null;
}

/**
 * Mensaje de error del email en el alta manual, donde es OPCIONAL: vacío o
 * solo espacios no es un error; si se rellena, tiene que ser un email.
 * (`errorEmail` es la versión obligatoria, la de los flujos de solicitud.)
 */
export function errorEmailOpcional(email: string | null | undefined): string | null {
  if (!(email ?? "").trim()) return null;
  return emailValido(email) ? null : MENSAJES_CONTACTO.emailInvalido;
}

/** Valor para `reservas.email`: el email recortado, o null si no hay (nunca ''). */
export function emailParaGuardar(email: string | null | undefined): string | null {
  return (email ?? "").trim() || null;
}

/**
 * ¿La RLS de `reservas` ha rechazado la escritura? Crear o modificar una reserva exige
 * permiso de EDICIÓN en «Reservas» (migración 20261001170000). Un INSERT o un UPDATE
 * rechazado llega como 42501 («new row violates row-level security policy…»); se mira
 * también el texto por si llega sin código. Un UPDATE que la RLS filtra en silencio no
 * da error, devuelve 0 filas: eso lo resuelven `escribirReserva` y `ErrorSinFilasEdicion`.
 */
export function esErrorSinPermiso(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  return e.code === "42501" || /row[- ]level security/i.test(String(e.message ?? ""));
}

/** Qué hacer sin permiso: «Puede editar» solo lo concede un super admin (pantalla Usuarios). */
export const PEDIR_PERMISO_EDICION = "Pide a un super admin que te dé «Puede editar» en Reservas.";

/** Aviso del alta (también «Convertir en reserva») cuando la RLS no deja crear la reserva. */
export const MENSAJE_SIN_PERMISO_ALTA = `No tienes permiso para crear reservas. ${PEDIR_PERMISO_EDICION}`;

export interface ContactoReserva {
  /** Formato del bot: "+34XXXXXXXXX". */
  telefono: string;
  email: string;
}

/**
 * Valida y normaliza teléfono + email. `contacto` es null si algo falla y
 * `errores` trae el mensaje de cada campo. Un solo shape (sin unión
 * discriminada por booleano): con strictNullChecks:false el compilador no
 * la estrecha bien (ver useVerificacionReservas.ts).
 */
export function validarContactoReserva(entrada: {
  telefono: string | null | undefined;
  email: string | null | undefined;
}): { contacto: ContactoReserva | null; errores: { telefono: string | null; email: string | null } } {
  const telefono = errorTelefono(entrada.telefono);
  const email = errorEmail(entrada.email);
  if (telefono || email) return { contacto: null, errores: { telefono, email } };
  return {
    contacto: {
      telefono: formatearTelefonoReserva(entrada.telefono) as string,
      email: (entrada.email ?? "").trim(),
    },
    errores: { telefono: null, email: null },
  };
}
