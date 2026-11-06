/**
 * Errores de publicación en lenguaje llano (evaluación de diseño C6): lo que
 * guarda el programador en `ultimo_error` suele ser el mensaje o el JSON de
 * Meta («(#9004) Media download has failed», «Error validating access
 * token…»). Al dueño se le enseña qué ha pasado y qué hacer; el texto crudo
 * queda plegado en «Para Oficiosos».
 *
 * Solo traduce: la causa y los reintentos los decide el servidor.
 */
export interface ErrorExplicado {
  /** Qué ha pasado, en una frase. */
  titulo: string;
  /** Qué hacer. */
  queHacer: string;
  /** Texto original (para «Para Oficiosos»); null si no había. */
  detalle: string | null;
}

const REGLAS: ReadonlyArray<{ patron: RegExp; titulo: string; queHacer: string }> = [
  {
    patron: /access token|OAuthException|\(#190\)|code"?\s*:\s*190|token.*(caducad|expirad|inválid|invalid|expired)|session has expired/i,
    titulo: "La conexión con Instagram ha caducado.",
    queHacer: "Avisa a Oficiosos para que la renueven; después vuelve a programarla.",
  },
  {
    patron: /permission|\(#10\)|\(#200\)|code"?\s*:\s*(10|200)\b|permiso/i,
    titulo: "Instagram no nos deja publicar en esa cuenta.",
    queHacer: "Avisa a Oficiosos: falta un permiso de la cuenta.",
  },
  {
    patron: /rate limit|too many|\(#4\)|\(#17\)|\(#32\)|\(#613\)|code"?\s*:\s*(4|17|32|613)\b|limit reached|cupo|límite/i,
    titulo: "Instagram ha frenado las publicaciones por hoy.",
    queHacer: "Vuelve a programarla para dentro de unas horas.",
  },
  {
    patron: /aspect ratio|9004|2207004|2207009|media download|could not be downloaded|image.*(size|format|dimension)|medidas|formato de la imagen/i,
    titulo: "Instagram no ha podido coger la imagen.",
    queHacer: "Abre la pieza, vuelve a generar la imagen y prográmala de nuevo.",
  },
  {
    patron: /2207026|video.*(format|codec|duration)|vídeo/i,
    titulo: "Instagram no acepta el vídeo tal como está.",
    queHacer: "Vuelve a generar el vídeo del reel y prográmalo de nuevo.",
  },
  {
    patron: /timeout|timed out|tiempo (de espera|límite)|ETIMEDOUT|aborted|503|502|504|temporarily unavailable|unexpected error|try again/i,
    titulo: "Instagram tardó demasiado en responder.",
    queHacer: "Suele ser pasajero: vuelve a programarla. Antes, mira en Instagram que no haya salido ya.",
  },
];

/** Qué ha pasado y qué hacer a partir del error crudo de una publicación. */
export function explicarErrorPublicacion(crudo: string | null | undefined): ErrorExplicado {
  const detalle = typeof crudo === "string" && crudo.trim() ? crudo.trim() : null;
  const regla = detalle ? REGLAS.find((r) => r.patron.test(detalle)) : undefined;
  if (regla) return { titulo: regla.titulo, queHacer: regla.queHacer, detalle };
  return {
    titulo: "Instagram no aceptó la publicación.",
    queHacer: "Vuelve a programarla. Si se repite, avisa a Oficiosos con los detalles de abajo.",
    detalle,
  };
}
