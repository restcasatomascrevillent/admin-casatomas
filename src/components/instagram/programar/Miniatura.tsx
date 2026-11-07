/**
 * Miniatura y título corto de un evento del calendario. Viven aparte de
 * CalendarioInstagram (que los reexporta) para que el Estudio de Instagram
 * los use sin cargar el calendario entero en el paquete inicial de /instagram
 * (docs/instagram-rendimiento.md).
 */
import { useState } from "react";
import { ImageOff } from "lucide-react";
import { baseFotosPublica, obtenerPlantilla, urlRecurso } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import type { EventoCalendario } from "./logica";

const BASE_FOTOS = baseFotosPublica(String(import.meta.env.VITE_SUPABASE_URL ?? ""));

/** Título corto de la pieza: titular o cita, o el nombre de la plantilla. */
export function tituloEvento(e: EventoCalendario): string {
  const datos = e.pieza?.datos ?? null;
  const texto = [datos?.titular, datos?.cita].find((t): t is string => typeof t === "string" && !!t.trim());
  if (texto) return texto;
  const plantilla = e.pieza?.plantilla ? obtenerPlantilla(e.pieza.plantilla)?.nombre ?? e.pieza.plantilla : "Pieza";
  return plantilla.replace(/^Touza · /, "");
}

export function urlMiniatura(e: EventoCalendario): string | null {
  const ruta = e.pieza?.imagen_ruta;
  if (!ruta || e.tipo === "publicada") return null; // publicada: el JPEG ya no está en el bucket
  const url = /^https?:\/\//.test(ruta) ? ruta : urlRecurso(BASE_FOTOS, ruta);
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(e.pieza?.updated_at ?? "")}`;
}

export function Miniatura({ evento, className }: { evento: EventoCalendario; className?: string }) {
  const [fallo, setFallo] = useState(false);
  const url = urlMiniatura(evento);
  const proporcion = evento.pieza?.formato === "story" ? "aspect-[9/16]" : "aspect-[4/5]";
  if (!url || fallo) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded bg-muted text-muted-foreground", proporcion, className)}>
        <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  return <img src={url} alt="" loading="lazy" onError={() => setFallo(true)} className={cn("shrink-0 rounded object-cover", proporcion, className)} />;
}
