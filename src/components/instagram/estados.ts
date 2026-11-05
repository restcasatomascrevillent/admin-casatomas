/**
 * Un solo juego de estados para toda la sección Instagram (evaluación de
 * diseño C5, 05/11/2026): etiqueta, tono e icono de cada estado de pieza,
 * programación (calendario), encargo y campaña, con la paleta de la maqueta
 * (`--e-publicada`, `--e-programada`, `--e-borrador`, `--e-encargo`,
 * `--e-revisar` de instagram-studio/propuesta/maqueta/estilos.css).
 *
 * Regla: el mismo color significa lo mismo en todas las pestañas.
 *  · verde   = ya está en Instagram (publicada, publicado)
 *  · oro     = tiene fecha y saldrá sola o está aprobado (programada, aprobado, en curso de campaña)
 *  · piedra  = borrador, aún no tiene fecha (borde discontinuo)
 *  · azul    = encargo en manos de Oficiosos o de la máquina (enviado, en curso…)
 *  · ámbar   = te toca a ti (para revisar, propuesta de campaña)
 *  · rojo    = error o rechazado
 *  · gris    = trabajando (publicando, procesando) o cerrado (cancelado, descartado)
 *
 * Sin React: las clases son de Tailwind (valores arbitrarios con los colores
 * de la maqueta) y el icono es el componente de lucide. La insignia está en
 * InsigniaEstado.tsx.
 */
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Eye,
  FlaskConical,
  ImageIcon,
  KanbanSquare,
  Loader2,
  PencilLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type TonoEstado = "publicada" | "programada" | "borrador" | "encargo" | "revisar" | "error" | "proceso" | "neutro";

export interface EstiloTono {
  /** Insignia: texto, borde y fondo (12 px, contraste AA sobre blanco). */
  insignia: string;
  /** Punto o barra de color (cabeceras de columna, leyenda, borde izquierdo). */
  punto: string;
  /** Borde izquierdo de una tarjeta (calendario). */
  bordeIzquierdo: string;
  /** Contorno de una miniatura (semana del Estudio). */
  contorno: string;
}

/** Paleta de la maqueta (hex) por si hace falta fuera de Tailwind (gráficas, SVG). */
export const COLOR_TONO: Record<TonoEstado, string> = {
  publicada: "#117e39",
  programada: "#926a26",
  borrador: "#9b8a7d",
  encargo: "#1b6fc2",
  revisar: "#e7b008",
  error: "#b42318",
  proceso: "#67615f",
  neutro: "#9b8a7d",
};

export const ESTILO_TONO: Record<TonoEstado, EstiloTono> = {
  publicada: {
    insignia: "border-[rgb(17_126_57/0.3)] bg-[rgb(17_126_57/0.06)] text-[#117e39]",
    punto: "bg-[#117e39]",
    bordeIzquierdo: "border-l-[#117e39]",
    contorno: "outline-[#117e39]",
  },
  programada: {
    insignia: "border-[rgb(146_106_38/0.35)] bg-[rgb(146_106_38/0.07)] text-[#7a5719]",
    punto: "bg-[#926a26]",
    bordeIzquierdo: "border-l-[#926a26]",
    contorno: "outline-[#926a26]",
  },
  borrador: {
    insignia: "border-dashed border-[#9b8a7d] bg-background text-[#5f554d]",
    punto: "bg-[#9b8a7d]",
    bordeIzquierdo: "border-l-[#9b8a7d]",
    contorno: "outline-[#9b8a7d]",
  },
  encargo: {
    insignia: "border-[rgb(27_111_194/0.3)] bg-[rgb(27_111_194/0.06)] text-[#155a9f]",
    punto: "bg-[#1b6fc2]",
    bordeIzquierdo: "border-l-[#1b6fc2]",
    contorno: "outline-[#1b6fc2]",
  },
  revisar: {
    insignia: "border-[rgb(231_176_8/0.55)] bg-[rgb(231_176_8/0.14)] text-[#5c4500]",
    punto: "bg-[#e7b008]",
    bordeIzquierdo: "border-l-[#e7b008]",
    contorno: "outline-[#e7b008]",
  },
  error: {
    insignia: "border-red-300 bg-red-50 text-red-800",
    punto: "bg-red-600",
    bordeIzquierdo: "border-l-red-600",
    contorno: "outline-red-600",
  },
  proceso: {
    insignia: "border-border bg-muted text-foreground",
    punto: "bg-[#67615f]",
    bordeIzquierdo: "border-l-[#67615f]",
    contorno: "outline-[#67615f]",
  },
  neutro: {
    insignia: "border-border bg-muted text-muted-foreground",
    punto: "bg-muted-foreground",
    bordeIzquierdo: "border-l-muted-foreground",
    contorno: "outline-muted-foreground",
  },
};

export interface InfoEstado {
  /** Texto corto de la insignia. */
  etiqueta: string;
  tono: TonoEstado;
  icono: LucideIcon;
  /** El icono gira (trabajando). */
  gira?: boolean;
}

const info = (etiqueta: string, tono: TonoEstado, icono: LucideIcon, gira = false): InfoEstado => ({ etiqueta, tono, icono, ...(gira ? { gira } : {}) });

// ── Piezas (instagram_piezas.estado) ─────────────────────────────────────────

export type EstadoPiezaIG = "borrador" | "generada" | "procesando" | "prueba_ok" | "publicada" | "error";

export const ESTADOS_PIEZA: Record<EstadoPiezaIG, InfoEstado> = {
  borrador: info("Borrador", "borrador", PencilLine),
  generada: info("Imagen lista", "borrador", ImageIcon),
  procesando: info("Instagram procesando", "proceso", Loader2, true),
  prueba_ok: info("Lista para publicar", "neutro", FlaskConical),
  publicada: info("Publicada", "publicada", CheckCircle2),
  error: info("Error", "error", AlertTriangle),
};

// ── Calendario (programaciones, publicadas y borradores con fecha) ───────────

export type EstadoCalendarioIG = "programada" | "publicando" | "publicada" | "error" | "cancelada" | "borrador";

export const ESTADOS_CALENDARIO: Record<EstadoCalendarioIG, InfoEstado> = {
  programada: info("Programada", "programada", CalendarClock),
  publicando: info("Publicando…", "proceso", Loader2, true),
  publicada: info("Publicada", "publicada", CheckCircle2),
  error: info("Error", "error", AlertTriangle),
  cancelada: info("Cancelada", "neutro", CircleSlash),
  borrador: info("Borrador", "borrador", PencilLine),
};

/** Hueco de encargo en el calendario (fecha deseada de un encargo vivo). */
export const ESTADO_HUECO_ENCARGO: InfoEstado = info("Encargo", "encargo", KanbanSquare);

// ── Encargos (instagram_encargos.estado) ─────────────────────────────────────

export type EstadoEncargoIG =
  | "borrador"
  | "enviado"
  | "aceptado"
  | "en_curso"
  | "para_revisar"
  | "cambios_pedidos"
  | "aprobado"
  | "publicado"
  | "rechazado"
  | "cancelado";

export const ESTADOS_ENCARGO: Record<EstadoEncargoIG, InfoEstado> = {
  borrador: info("Borrador", "borrador", PencilLine),
  enviado: info("Enviado", "encargo", KanbanSquare),
  aceptado: info("Aceptado", "encargo", KanbanSquare),
  en_curso: info("En curso", "encargo", Loader2),
  para_revisar: info("Para revisar", "revisar", Eye),
  cambios_pedidos: info("Cambios pedidos", "encargo", PencilLine),
  aprobado: info("Aprobado", "programada", CheckCircle2),
  publicado: info("Publicado", "publicada", CheckCircle2),
  rechazado: info("Rechazado", "error", AlertTriangle),
  cancelado: info("Cancelado", "neutro", CircleSlash),
};

// ── Campañas (instagram_campanas.estado) ─────────────────────────────────────

export type EstadoCampanaIG = "propuesta" | "aceptada" | "en_curso" | "cerrada" | "descartada";

export const ESTADOS_CAMPANA: Record<EstadoCampanaIG, InfoEstado> = {
  propuesta: info("Propuesta nueva", "revisar", Sparkles),
  aceptada: info("En el calendario", "borrador", CircleDashed),
  en_curso: info("En curso", "programada", CalendarClock),
  cerrada: info("Cerrada", "neutro", CheckCircle2),
  descartada: info("Descartada", "neutro", CircleSlash),
};

// ── Búsqueda segura ──────────────────────────────────────────────────────────

export type DominioEstado = "pieza" | "calendario" | "encargo" | "campana";

const TABLAS: Record<DominioEstado, Record<string, InfoEstado>> = {
  pieza: ESTADOS_PIEZA,
  calendario: ESTADOS_CALENDARIO,
  encargo: ESTADOS_ENCARGO,
  campana: ESTADOS_CAMPANA,
};

/**
 * Info de un estado; si llega uno que no conocemos (migración nueva), sale en
 * gris con el texto en limpio («en_revision» → «En revision»), sin romper.
 */
export function infoEstado(dominio: DominioEstado, estado: string | null | undefined): InfoEstado {
  const e = TABLAS[dominio][estado ?? ""];
  if (e) return e;
  const texto = String(estado ?? "").replace(/[_-]+/g, " ").trim();
  return info(texto ? texto[0].toLocaleUpperCase("es") + texto.slice(1) : "Sin estado", "neutro", CircleDashed);
}

/** Leyenda del calendario (y filtros): un estado por tono, en el orden de la maqueta. */
export const LEYENDA_CALENDARIO: ReadonlyArray<{ id: "publicada" | "programada" | "borrador" | "encargo" | "error"; etiqueta: string; tono: TonoEstado }> = [
  { id: "publicada", etiqueta: "Publicada", tono: "publicada" },
  { id: "programada", etiqueta: "Programada", tono: "programada" },
  { id: "borrador", etiqueta: "Borrador", tono: "borrador" },
  { id: "encargo", etiqueta: "Encargo", tono: "encargo" },
  { id: "error", etiqueta: "Con error", tono: "error" },
];
