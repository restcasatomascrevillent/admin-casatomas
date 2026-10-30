import { mensajeUsuario } from "@/lib/mensaje-usuario";

/** Conserva el mensaje que devuelve la función, también en respuestas HTTP de error. */
export async function mensajeErrorUsuarios(error: unknown, alternativa: string): Promise<string> {
  const respuesta = (error as { context?: unknown } | null)?.context;
  if (respuesta instanceof Response) {
    try {
      const cuerpo = await respuesta.clone().json();
      if (typeof cuerpo?.error === "string" && cuerpo.error) return cuerpo.error;
    } catch {
      // Una respuesta sin JSON utiliza el mensaje alternativo.
    }
  }
  // Un error técnico (PostgREST, red, Functions) no llega a la pantalla.
  return mensajeUsuario(error, alternativa);
}
