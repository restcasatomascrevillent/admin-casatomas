import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Loader2, PencilLine } from "lucide-react";
import { generacionActiva, type Generacion, type Proyecto } from "@/components/rrss/api";
import type { InfoEstado } from "@/components/instagram/estados";

/** Estado que se enseña en la lista: el de la última generación si la hay; si no, el del trabajo. */
export function infoEstadoTrabajo(p: Pick<Proyecto, "estado">, g: Generacion | null | undefined): InfoEstado {
  if (g && generacionActiva(g)) return { etiqueta: "Generando", tono: "proceso", icono: Loader2, gira: true };
  if (g?.estado === "error") return { etiqueta: "Error al generar", tono: "error", icono: AlertTriangle };
  if (p.estado === "listo") return { etiqueta: "Listo", tono: "publicada", icono: CheckCircle2 };
  if (g?.estado === "listo") return { etiqueta: "Generado", tono: "programada", icono: CheckCircle2 };
  if (g?.estado === "cancelado") return { etiqueta: "Cancelado", tono: "neutro", icono: CircleSlash };
  return { etiqueta: "Borrador", tono: "borrador", icono: p.estado === "borrador" ? PencilLine : CircleDashed };
}

