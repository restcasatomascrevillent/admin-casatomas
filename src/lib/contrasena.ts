import { supabase } from "@/integrations/supabase/client";

/**
 * Reglas y llamada del cambio de la PROPIA contraseña («Mi cuenta» y Super Admin ›
 * Usuarios). La comprobación de verdad la hace la Edge Function
 * `cambiar-mi-contrasena`; aquí se repiten las reglas para avisar antes de enviar.
 * Mismos límites que la función (handler.ts): mínimo 10 (como el resto de cuentas
 * del panel) y máximo 72 bytes (bcrypt de Auth).
 */
export const LONGITUD_MINIMA_CONTRASENA = 10;
export const LONGITUD_MAXIMA_CONTRASENA = 72;

export interface ReglaContrasena {
  id: "longitud" | "variedad" | "distinta" | "coincide";
  texto: string;
  cumple: boolean;
  /** Las no obligatorias son consejos: no impiden guardar. */
  obligatoria: boolean;
}

const bytes = (texto: string) => new TextEncoder().encode(texto).length;

export function reglasContrasena({ actual, nueva, repetir }: { actual: string; nueva: string; repetir: string }): ReglaContrasena[] {
  const larga = bytes(nueva) > LONGITUD_MAXIMA_CONTRASENA;
  return [
    {
      id: "longitud",
      texto: larga
        ? `Como mucho ${LONGITUD_MAXIMA_CONTRASENA} caracteres`
        : `Al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres`,
      cumple: nueva.length >= LONGITUD_MINIMA_CONTRASENA && !larga,
      obligatoria: true,
    },
    { id: "distinta", texto: "Distinta de la contraseña actual", cumple: nueva.length > 0 && nueva !== actual, obligatoria: true },
    { id: "coincide", texto: "Las dos nuevas coinciden", cumple: repetir.length > 0 && repetir === nueva, obligatoria: true },
    {
      id: "variedad",
      texto: "Recomendado: mezcla letras, números y algún símbolo",
      cumple: /\p{L}/u.test(nueva) && /\d/.test(nueva) && /[^\p{L}\d\s]/u.test(nueva),
      obligatoria: false,
    },
  ];
}

export type CodigoCambioContrasena =
  | "sesion_no_valida"
  | "peticion_invalida"
  | "falta_actual"
  | "contrasena_corta"
  | "contrasena_larga"
  | "misma_contrasena"
  | "demasiados_intentos"
  | "contrasena_actual_incorrecta"
  | "contrasena_debil"
  | "reautenticacion_necesaria"
  | "error_servicio"
  | "sin_conexion";

/** `ok` o el motivo (`codigo`) con el mensaje para la persona. */
export interface ResultadoCambioContrasena {
  ok: boolean;
  codigo?: CodigoCambioContrasena;
  mensaje?: string;
}

const MENSAJE_GENERICO = "No se pudo cambiar la contraseña. Inténtalo de nuevo en unos minutos.";

const CODIGOS = new Set<string>([
  "sesion_no_valida", "peticion_invalida", "falta_actual", "contrasena_corta", "contrasena_larga",
  "misma_contrasena", "demasiados_intentos", "contrasena_actual_incorrecta", "contrasena_debil",
  "reautenticacion_necesaria", "error_servicio",
]);

/**
 * Cambia la contraseña de quien ha iniciado sesión. Nunca guarda ni registra las
 * contraseñas: solo viajan en el cuerpo de la petición a la función.
 */
export async function cambiarMiContrasena(actual: string, nueva: string): Promise<ResultadoCambioContrasena> {
  let respuesta: Awaited<ReturnType<typeof supabase.functions.invoke<{ success?: boolean; codigo?: string; error?: string }>>>;
  try {
    respuesta = await supabase.functions.invoke<{ success?: boolean; codigo?: string; error?: string }>("cambiar-mi-contrasena", {
      body: { actual, nueva },
    });
  } catch {
    return { ok: false, codigo: "sin_conexion", mensaje: "No hay conexión. Comprueba la red y vuelve a intentarlo." };
  }
  if (!respuesta.error && respuesta.data?.success) return { ok: true };

  let cuerpo: { codigo?: unknown; error?: unknown } | null = respuesta.data ?? null;
  let status = 200;
  const contexto = (respuesta.error as { context?: unknown } | null)?.context;
  if (contexto instanceof Response) {
    status = contexto.status;
    cuerpo = await contexto.clone().json().catch(() => null);
  } else if (respuesta.error) {
    // Sin respuesta de la función (red, pasarela): solo el nombre del error, nunca el cuerpo.
    console.error("cambiar-mi-contrasena: sin respuesta", respuesta.error.name);
    return { ok: false, codigo: "sin_conexion", mensaje: "No se pudo conectar con el servidor. Comprueba la red y vuelve a intentarlo." };
  }
  if (status === 401 && !(typeof cuerpo?.codigo === "string" && CODIGOS.has(cuerpo.codigo))) {
    // La pasarela o el envoltorio de auditoría rechazan el JWT antes de la función.
    return { ok: false, codigo: "sesion_no_valida", mensaje: "Tu sesión ha caducado. Vuelve a iniciar sesión." };
  }
  const codigo = typeof cuerpo?.codigo === "string" && CODIGOS.has(cuerpo.codigo) ? (cuerpo.codigo as CodigoCambioContrasena) : "error_servicio";
  const mensaje = typeof cuerpo?.error === "string" && cuerpo.error && codigo !== "error_servicio" ? cuerpo.error : MENSAJE_GENERICO;
  return { ok: false, codigo, mensaje };
}
