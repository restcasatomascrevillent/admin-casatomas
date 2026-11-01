/**
 * Cola de vídeos del plato a nivel de app (lógica pura, sin React ni DOM).
 * El estado lo guarda ColaVideosProvider; aquí solo las transiciones y los
 * textos, para poder probarlos.
 *
 * Reglas:
 *   - Se procesa UN vídeo cada vez (memoria y CPU), en orden de llegada.
 *   - Un vídeo nuevo de un plato que ya tenía otro esperando o en marcha
 *     sustituye al anterior (se cancela).
 *   - Al terminar se guarda solo (sube el vídeo y escribe video_url).
 */
import type { NombreTema } from "../composicionCarta";
import type { ProgresoVideo } from "./videoPlato";

export type EstadoTrabajoVideo = "esperando" | "procesando" | "guardando" | "listo" | "fallo" | "cancelado";

export interface TrabajoVideo {
  id: string;
  platoId: string;
  /** Nombre del plato para el indicador y la notificación. */
  nombre: string;
  archivo: File;
  tema: NombreTema;
  /** video_url que tenía el plato al encolar (por si no está en la caché al guardar). */
  urlActual: string | null;
  estado: EstadoTrabajoVideo;
  progreso: ProgresoVideo | null;
  mensaje?: string;
  /** La pestaña estuvo en segundo plano mientras se procesaba. */
  seOculto?: boolean;
  /** Vista previa del vídeo generado (object URL), solo cuando está listo. */
  urlVista?: string;
}

export type NuevoTrabajoVideo = Pick<TrabajoVideo, "platoId" | "nombre" | "archivo" | "tema" | "urlActual">;

const ACTIVOS: ReadonlySet<EstadoTrabajoVideo> = new Set(["esperando", "procesando", "guardando"]);
export const estaActivo = (t: TrabajoVideo) => ACTIVOS.has(t.estado);

/** Trabajos terminados (listo/fallo/cancelado) que se conservan para enseñar su resultado. */
export const MAX_TERMINADOS = 10;

/**
 * Añade un trabajo al final. Si el plato ya tenía uno activo, ese pasa a
 * «cancelado» (devuelve sus ids en `cancelados` para cortar el procesado).
 */
export function encolarTrabajo(
  lista: readonly TrabajoVideo[],
  nuevo: NuevoTrabajoVideo,
  id: string,
): { lista: TrabajoVideo[]; cancelados: string[] } {
  const cancelados: string[] = [];
  const resto = lista.map((t) => {
    if (t.platoId === nuevo.platoId && estaActivo(t)) {
      cancelados.push(t.id);
      return { ...t, estado: "cancelado" as const };
    }
    return t;
  });
  return { lista: recortarTerminados([...resto, { ...nuevo, id, estado: "esperando", progreso: null }]), cancelados };
}

/** El siguiente a procesar: el primero esperando, solo si no hay otro procesándose o guardándose. */
export function siguienteTrabajo(lista: readonly TrabajoVideo[]): TrabajoVideo | undefined {
  if (lista.some((t) => t.estado === "procesando" || t.estado === "guardando")) return undefined;
  return lista.find((t) => t.estado === "esperando");
}

export function actualizarTrabajo(lista: readonly TrabajoVideo[], id: string, cambios: Partial<TrabajoVideo>): TrabajoVideo[] {
  return lista.map((t) => (t.id === id ? { ...t, ...cambios } : t));
}

export function cancelarTrabajo(lista: readonly TrabajoVideo[], id: string): TrabajoVideo[] {
  return lista.map((t) => (t.id === id && estaActivo(t) ? { ...t, estado: "cancelado" as const, progreso: null } : t));
}

/** Vuelve a poner en cola un trabajo fallido (mismo vídeo y fondo). */
export function reintentarTrabajo(lista: readonly TrabajoVideo[], id: string): TrabajoVideo[] {
  return lista.map((t) =>
    t.id === id && t.estado === "fallo" ? { ...t, estado: "esperando" as const, progreso: null, mensaje: undefined, seOculto: false } : t,
  );
}

/** Deja como mucho MAX_TERMINADOS terminados (los más antiguos fuera); los activos nunca se quitan. */
export function recortarTerminados(lista: readonly TrabajoVideo[], max = MAX_TERMINADOS): TrabajoVideo[] {
  const terminados = lista.filter((t) => !estaActivo(t));
  const sobran = new Set(terminados.slice(0, Math.max(0, terminados.length - max)).map((t) => t.id));
  return lista.filter((t) => !sobran.has(t.id));
}

/** El trabajo más reciente de un plato que no esté cancelado (para su ficha). */
export function trabajoDePlato(lista: readonly TrabajoVideo[], platoId: string): TrabajoVideo | undefined {
  for (let i = lista.length - 1; i >= 0; i--) {
    const t = lista[i];
    if (t.platoId === platoId && t.estado !== "cancelado") return t;
  }
  return undefined;
}

export const trabajosActivos = (lista: readonly TrabajoVideo[]) => lista.filter(estaActivo);

/** Texto corto del indicador global: «Vídeo de Arroz meloso 23/48». */
export function textoIndicador(t: TrabajoVideo): string {
  const de = `Vídeo de ${t.nombre}`;
  if (t.estado === "esperando") return `${de}: en cola`;
  if (t.estado === "guardando") return `${de}: guardando`;
  if (t.estado === "listo") return `${de}: listo`;
  if (t.estado === "fallo") return `${de}: no se pudo generar`;
  const p = t.progreso;
  switch (p?.fase) {
    case "convirtiendo":
      return p.pct < 0 ? `${de}: convirtiendo` : `${de}: convirtiendo ${p.pct} %`;
    case "descargando":
      return `${de}: descargando modelo ${p.pct} %`;
    case "recortando":
    case "componiendo":
      return `${de} ${p.hecho}/${p.total}`;
    case "codificando":
      return `${de}: codificando`;
    default:
      return `${de}: preparando`;
  }
}

/** Ruta del panel que abre la ficha del plato (Gestión web → Carta → editar). */
export function rutaPlatoEnPanel(platoId: string): string {
  return `/gestion-web?tab=carta&plato=${encodeURIComponent(platoId)}`;
}

export function contenidoNotificacion(nombre: string, resultado: "listo" | "fallo", mensaje?: string): { titulo: string; cuerpo: string } {
  if (resultado === "listo") return { titulo: `Vídeo listo: ${nombre}`, cuerpo: "Ya está guardado en la carta. Toca para verlo." };
  return { titulo: `No se pudo generar el vídeo: ${nombre}`, cuerpo: mensaje ? `${mensaje.replace(/[.\s]+$/, "")}. Toca para reintentarlo.` : "Toca para reintentarlo." };
}
