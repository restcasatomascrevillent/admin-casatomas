/**
 * Lógica pura del asistente móvil (sin React): texto inicial, firma del
 * montaje (para no gastar IA con las mismas fotos) y hora inicial al programar.
 */
import type { MarcaId } from "@/lib/instagram";
import type { RespuestaMontar } from "@/lib/instagram/montar";
import { hoyMadrid, madridAUtc, sumarDias, utcAMadrid, validarProgramacion } from "@/components/instagram/programar/logica";
import type { FotoMovil } from "./estado";

/** Texto inicial de la publicación: el de la IA y sus hashtags al final. */
export function unirCaption(r: Pick<RespuestaMontar, "caption" | "hashtags">): string {
  const tags = r.hashtags.join(" ");
  return [r.caption.trim(), tags].filter(Boolean).join("\n\n");
}

/** Firma de lo que se manda a montar: si no cambia, se reutiliza el montaje (no se gasta IA). */
export function firmaMontaje(marca: MarcaId, fotos: FotoMovil[], indicacion: string): string {
  return JSON.stringify([marca, fotos.map((f) => (f.origen === "carta" ? `carta:${f.platoId}` : `subida:${f.clave}`)), indicacion.trim()]);
}

/**
 * Fecha y hora iniciales al programar: la sugerida por la IA si es válida; si
 * no, la próxima de 13:00 o 20:30 (Madrid) con al menos 30 minutos de margen.
 */
export function horaInicial(sugerida: string | null | undefined, ahora = new Date()): { fecha: string; hora: string } {
  if (sugerida) {
    const d = new Date(sugerida);
    if (!Number.isNaN(d.getTime()) && d.getTime() >= ahora.getTime() + 15 * 60_000) {
      const m = utcAMadrid(d);
      if (validarProgramacion(m.fecha, m.hora, ahora).ok) return m;
    }
  }
  const hoy = hoyMadrid(ahora);
  for (const fecha of [hoy, sumarDias(hoy, 1)]) {
    for (const hora of ["13:00", "20:30"]) {
      const t = madridAUtc(fecha, hora);
      if (t && t.getTime() >= ahora.getTime() + 30 * 60_000) return { fecha, hora };
    }
  }
  return { fecha: sumarDias(hoy, 1), hora: "13:00" };
}

export function nombreDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return "hoy";
  if (fecha === sumarDias(hoy, 1)) return "mañana";
  const [y, m, d] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

