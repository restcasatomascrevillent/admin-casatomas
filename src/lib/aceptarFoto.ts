import { toast } from "sonner";
import { mensajeErrorStorage, validarFoto } from "./validarFoto";

/** Lo que se tarda en quitar el aviso (más que el normal: hay que leerlo entero). */
const MS_AVISO_FOTO = 9000;

/**
 * Al elegir una foto en un formulario: si no vale, avisa (en castellano, con
 * el motivo) y vacía el `<input>` para poder elegir otra. Devuelve true si vale.
 */
export async function aceptarFoto(file: File, input?: HTMLInputElement | null): Promise<boolean> {
  const r = await validarFoto(file);
  if (r.ok) return true;
  if (input) input.value = "";
  toast.error(r.mensaje, { duration: MS_AVISO_FOTO, id: "foto-no-valida" });
  return false;
}

/** Aviso de un fallo al subir: el motivo si es de tamaño/tipo, si no `porDefecto`. */
export function avisarFalloSubida(error: unknown, porDefecto: string): void {
  toast.error(mensajeErrorStorage(error) ?? porDefecto, { duration: MS_AVISO_FOTO });
}
