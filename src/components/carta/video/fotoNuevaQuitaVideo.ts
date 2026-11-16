/**
 * Foto nueva en un plato que ya tenía vídeo: manda lo último que se sube en
 * el panel. La web enseña el vídeo siempre que el plato tiene `video_url`, así
 * que un vídeo antiguo tapaba la foto recién subida (16/11/2026, «Setas de
 * temporada»). Al guardar una foto NUEVA, el vídeo anterior se quita.
 *
 * No se quita si:
 *   - no es una foto nueva (cambiar solo el fondo o el encuadre de la misma);
 *   - hay un vídeo «en camino» para el plato: elegido en esta misma ficha, en
 *     la cola del panel o mandado a un dispositivo potente. Ese vídeo es
 *     posterior a la foto y se queda (la foto hace de póster).
 */
export const AVISO_FOTO_NUEVA_QUITA_VIDEO =
  "Este plato tiene un vídeo hecho con la foto anterior. Al guardar la foto nueva, el vídeo se quita y en la web se verá la foto. Si quieres vídeo, graba o elige uno nuevo.";

export const MENSAJE_VIDEO_QUITADO_POR_FOTO = "Se ha quitado el vídeo anterior: en la web se verá la foto nueva";

export function fotoNuevaQuitaVideo(o: {
  /** Se ha elegido (o pegado) un fichero de foto nuevo. */
  fotoNueva: boolean;
  /** `video_url` guardado del plato. */
  urlVideo: string | null | undefined;
  /** Hay un vídeo elegido, en cola o pendiente para este plato. */
  videoEnCamino: boolean;
}): boolean {
  return o.fotoNueva && !!o.urlVideo && !o.videoEnCamino;
}
