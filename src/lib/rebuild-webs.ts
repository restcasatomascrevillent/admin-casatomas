// Publicación en las webs públicas
// ---------------------------------------------------------------------------
// casa-tomas-story y touza-restaurant-website prerenderizan la carta en tiempo
// de build: guardar en el panel NO cambia la web hasta que se dispara un
// deploy. De eso se encarga la Edge Function `rebuild-webs`.
//
// PROBLEMA QUE RESUELVE ESTE MÓDULO
// Cada hook de carta tenía su propia copia de un `dispararRebuildWebs` que
// invocaba la función y se tragaba cualquier fallo con un `.catch(console.error)`,
// mientras el panel ya había mostrado "Se publicará en la web en unos minutos".
// Como `rebuild-webs` no está desplegada (404), el mensaje era mentira: el
// cambio se guardaba pero nunca se publicaba, y nadie se enteraba.
//
// Ahora el aviso se decide DESPUÉS de saber cómo fue la invocación, sobre el
// mismo toast (mismo `id`), así que no se apilan dos mensajes. El guardado no
// cambia en absoluto: esto solo informa.
//
// Nota sobre `en_cooldown`: `rebuild-webs` aplica un antirrebote de 10 minutos
// y marca el sitio como pendiente para dispararlo más tarde. Eso NO es un
// fallo, así que se sigue considerando publicación en curso.
// ---------------------------------------------------------------------------
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type MotivoNoPublicado =
  | "invocacion_fallida"
  | "sin_hook_configurado"
  | "error_hook";

export interface ResultadoPublicacion {
  publicado: boolean;
  motivo?: MotivoNoPublicado;
}

interface ResultadoSitio {
  sitio?: unknown;
  disparado?: unknown;
  motivo?: unknown;
}

/**
 * Invoca `rebuild-webs` y traduce su respuesta a "¿se va a publicar o no?".
 * Nunca lanza: el guardado ya ocurrió antes de llegar aquí.
 */
export async function solicitarRepublicacion(origen: string): Promise<ResultadoPublicacion> {
  try {
    const { data, error } = await supabase.functions.invoke("rebuild-webs", {
      body: { origen },
    });

    // Función no desplegada (404), sin permisos (403), origen inválido (400)...
    if (error) {
      console.error("rebuild-webs no disponible:", error);
      return { publicado: false, motivo: "invocacion_fallida" };
    }

    const cuerpo = (data ?? {}) as Record<string, unknown>;

    // La función devuelve 200 con { ok: false, error } si revienta por dentro.
    if (cuerpo.ok === false) {
      console.error("rebuild-webs devolvió un error:", cuerpo.error);
      return { publicado: false, motivo: "invocacion_fallida" };
    }

    const resultados = Array.isArray(cuerpo.resultados)
      ? (cuerpo.resultados as ResultadoSitio[])
      : [];

    // "en_cooldown" queda pendiente y se dispara solo: no es un fallo.
    const fallido = resultados.find(
      (resultado) =>
        resultado?.disparado === false &&
        (resultado?.motivo === "sin_hook_configurado" || resultado?.motivo === "error_hook"),
    );

    if (fallido) {
      console.error("rebuild-webs no pudo publicar:", fallido);
      return { publicado: false, motivo: fallido.motivo as MotivoNoPublicado };
    }

    return { publicado: true };
  } catch (err) {
    console.error("Error llamando a rebuild-webs:", err);
    return { publicado: false, motivo: "invocacion_fallida" };
  }
}

const avisoNoPublicado = (motivo?: MotivoNoPublicado) =>
  motivo === "sin_hook_configurado"
    ? "Falta configurar el deploy hook de Vercel."
    : "El servicio de publicación no ha respondido.";

/**
 * Notifica el guardado y, cuando se sabe el resultado de `rebuild-webs`,
 * sustituye ese mismo toast por la confirmación de publicación o por un aviso
 * de que el cambio está guardado pero NO publicado.
 *
 * @param origen        plato | vino | bebida | coctel | menu | tapas
 * @param mensajeBase   qué se acaba de guardar, p. ej. "Plato creado".
 */
export function notificarGuardadoYPublicacion(origen: string, mensajeBase: string): void {
  const id = toast.loading(`${mensajeBase}. Publicando en la web...`);

  void solicitarRepublicacion(origen).then((resultado) => {
    if (resultado.publicado) {
      toast.success(`${mensajeBase}. Se publicará en la web en unos minutos.`, { id });
      return;
    }
    toast.warning(
      `${mensajeBase}, pero NO se ha publicado en la web. ${avisoNoPublicado(resultado.motivo)} El cambio está guardado y se verá cuando se republique.`,
      { id, duration: 12000 },
    );
  });
}
