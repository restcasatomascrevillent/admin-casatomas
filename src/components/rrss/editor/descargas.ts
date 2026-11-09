import { toast } from "sonner";
import { descargar, mensajeError, nombreDescarga, type Proyecto, type Resultado } from "@/components/rrss/api";

export async function descargarResultado(p: Proyecto, r: Resultado) {
  try {
    await descargar(r.ruta, nombreDescarga(p, r));
  } catch (e) {
    toast.error(mensajeError(e));
  }
}

