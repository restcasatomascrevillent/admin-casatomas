// ============================================================================
//  cambiar-mi-contrasena · «Mi cuenta» › Cambiar contraseña (la PROPIA cuenta)
// ----------------------------------------------------------------------------
//  Orden (cada paso solo si el anterior ha ido bien):
//    1. Usuario por su JWT (nunca por el cuerpo). Sin sesión válida -> 401.
//    2. Reglas de la nueva contraseña que no dependen de la guardada
//       (longitud, distinta de la actual escrita). No gastan intentos.
//    3. Intento en SQL (iniciar_cambio_contrasena): límite compartido con el
//       login de la cuenta. Si no se puede registrar -> 503, sin comprobar nada.
//    4. Contraseña actual comprobada en Auth con un cliente aislado; la sesión
//       de comprobación se revoca (no sustituye ni cierra la del navegador).
//    5. Cambio con el JWT del propio usuario: Auth conserva ESTA sesión y
//       cierra las de sus otros dispositivos.
//    6. Resultado en SQL (finalizar_cambio_contrasena).
//  Ni la contraseña actual ni la nueva salen de esta función hacia el registro,
//  los logs o la respuesta.
// ============================================================================

/** Lo que la pantalla necesita saber para dar un mensaje claro. */
export type CodigoCambio =
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
  | "error_servicio";

export type ResultadoIntento = "correcto" | "contrasena_actual_incorrecta" | "contrasena_rechazada" | "error_servicio";

export type Verificacion = { resultado: "correcta"; id: string } | { resultado: "incorrecta" } | { resultado: "limite" };

export interface CambioContrasenaDeps {
  /** Usuario del JWT, o null si no es válido. */
  identificar(token: string): Promise<{ id: string; email?: string | null } | null>;
  /** Registra el intento y dice si el límite lo permite. Lanza si no se puede registrar. */
  iniciar(actorId: string): Promise<{ id: string; permitido: boolean; motivo?: string }>;
  finalizar(intentoId: string, actorId: string, resultado: ResultadoIntento): Promise<void>;
  /** Comprueba la contraseña en Auth. Lanza si Auth no responde. */
  verificar(email: string, contrasena: string): Promise<Verificacion>;
  /**
   * Cambia la contraseña con el JWT del usuario. Recibe también la actual: si algún
   * día se activa en Auth «exigir la contraseña actual», Auth la vuelve a comprobar.
   */
  actualizar(actorId: string, token: string, nueva: string, actual: string): Promise<{ error: { code?: string; status?: number } | null }>;
}

/** Igual que admin-update-user-password y el alta de usuarios (CT-REM-FN-03). */
export const LONGITUD_MINIMA_CONTRASENA = 10;
/** Auth guarda la contraseña con bcrypt, que solo usa 72 bytes: rechaza las más largas. */
export const LONGITUD_MAXIMA_CONTRASENA = 72;

const MENSAJES: Record<CodigoCambio, string> = {
  sesion_no_valida: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
  peticion_invalida: "Petición no válida.",
  falta_actual: "Escribe tu contraseña actual.",
  contrasena_corta: `La nueva contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`,
  contrasena_larga: `La nueva contraseña no puede tener más de ${LONGITUD_MAXIMA_CONTRASENA} caracteres.`,
  misma_contrasena: "La nueva contraseña debe ser diferente de la actual.",
  demasiados_intentos: "Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.",
  contrasena_actual_incorrecta: "La contraseña actual no es correcta.",
  contrasena_debil: "La nueva contraseña es demasiado fácil de adivinar. Usa una más larga, con letras, números y símbolos.",
  reautenticacion_necesaria: "Por seguridad, cierra sesión y vuelve a entrar antes de cambiar la contraseña.",
  error_servicio: "No se pudo cambiar la contraseña. Inténtalo de nuevo en unos minutos.",
};

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
const fallo = (status: number, codigo: CodigoCambio) => reply(status, { success: false, codigo, error: MENSAJES[codigo] });

/** Longitud en bytes UTF-8 (lo que cuenta bcrypt). */
const bytes = (texto: string) => new TextEncoder().encode(texto).length;

export async function handleCambioContrasena(req: Request, deps: CambioContrasenaDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply(405, { success: false, error: "Método no permitido" });
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return fallo(401, "sesion_no_valida");

  const raw = await req.text();
  if (raw.length > 8192) return reply(413, { success: false, error: "Petición demasiado grande" });
  let body: Record<string, unknown> | null = null;
  try {
    const valor = JSON.parse(raw);
    if (valor && typeof valor === "object" && !Array.isArray(valor)) body = valor;
  } catch { /* cuerpo no JSON */ }
  if (!body) return fallo(400, "peticion_invalida");
  const actual = typeof body.actual === "string" ? body.actual : "";
  const nueva = typeof body.nueva === "string" ? body.nueva : "";

  let actor: { id: string; email?: string | null } | null;
  try { actor = await deps.identificar(token); }
  catch { return fallo(503, "error_servicio"); }
  if (!actor?.id || !actor.email) return fallo(401, "sesion_no_valida");

  if (!actual || actual.length > 4096) return fallo(400, "falta_actual");
  if (nueva.length < LONGITUD_MINIMA_CONTRASENA) return fallo(400, "contrasena_corta");
  if (bytes(nueva) > LONGITUD_MAXIMA_CONTRASENA) return fallo(400, "contrasena_larga");
  if (nueva === actual) return fallo(400, "misma_contrasena");

  let intento: { id: string; permitido: boolean };
  try { intento = await deps.iniciar(actor.id); }
  catch { return fallo(503, "error_servicio"); }
  if (!intento?.id) return fallo(503, "error_servicio");
  if (!intento.permitido) return fallo(429, "demasiados_intentos");

  // Desde aquí el intento existe: se cierra siempre con su resultado. Si no se
  // puede cerrar queda «pendiente», que cuenta como fallo (fail-closed).
  const terminar = async (resultado: ResultadoIntento) => {
    try { await deps.finalizar(intento.id, actor!.id, resultado); }
    catch { console.error("cambiar-mi-contrasena: no se pudo cerrar el intento", resultado); }
  };

  let verificacion: Verificacion;
  try { verificacion = await deps.verificar(actor.email, actual); }
  catch {
    await terminar("error_servicio");
    return fallo(503, "error_servicio");
  }
  if (verificacion.resultado === "limite") {
    await terminar("error_servicio");
    return fallo(429, "demasiados_intentos");
  }
  if (verificacion.resultado !== "correcta" || verificacion.id !== actor.id) {
    await terminar("contrasena_actual_incorrecta");
    return fallo(400, "contrasena_actual_incorrecta");
  }

  let error: { code?: string; status?: number } | null;
  try { ({ error } = await deps.actualizar(actor.id, token, nueva, actual)); }
  catch { error = { status: 503 }; }
  if (error) {
    const codigo: CodigoCambio =
      error.code === "current_password_mismatch" || error.code === "current_password_required" ? "contrasena_actual_incorrecta"
      : error.code === "same_password" ? "misma_contrasena"
      : error.code === "weak_password" ? "contrasena_debil"
      : error.code === "reauthentication_needed" ? "reautenticacion_necesaria"
      : "error_servicio";
    await terminar(
      codigo === "error_servicio" ? "error_servicio"
      : codigo === "contrasena_actual_incorrecta" ? "contrasena_actual_incorrecta"
      : "contrasena_rechazada",
    );
    return fallo(codigo === "error_servicio" ? 502 : 400, codigo);
  }

  // El cambio ya está hecho y auditado por el trigger de auth.users; si no se
  // pudiera cerrar el intento, no se dice que ha fallado.
  await terminar("correcto");
  return reply(200, { success: true });
}
