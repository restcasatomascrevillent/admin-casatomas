import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ExternalLink, ImageOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { explicarErrorPublicacion } from "@/components/instagram/errores";
import { MARCAS, obtenerPlantilla, urlRecurso, type MarcaId } from "@/lib/instagram";
import { usePiezasInstagram, type EstadoPieza, type PiezaInstagram } from "./usePiezasInstagram";
import { ESTADOS_PIEZA, ESTILO_TONO } from "@/components/instagram/estados";
import { InsigniaEstado } from "@/components/instagram/InsigniaEstado";

/** Texto y clases de cada estado: los del módulo único de estados (components/instagram/estados.ts). */
export const ETIQUETA_ESTADO = Object.fromEntries(
  (Object.keys(ESTADOS_PIEZA) as EstadoPieza[]).map((e) => [e, { texto: ESTADOS_PIEZA[e].etiqueta, clase: `border ${ESTILO_TONO[ESTADOS_PIEZA[e].tono].insignia}` }]),
) as Record<EstadoPieza, { texto: string; clase: string }>;

export const NOMBRE_MARCA_CORTO: Record<MarcaId, string> = { "casa-tomas": "Casa Tomás", touza: "Touza" };

/**
 * URL del JPEG de una pieza (bucket «instagram»), con ?v= para no ver una versión vieja de la caché.
 * null si no tiene o si la limpieza diaria lo borró por no publicarse (imagen_borrada_at).
 */
export function urlImagenPieza(baseFotos: string, p: Pick<PiezaInstagram, "imagen_ruta" | "updated_at"> & { imagen_borrada_at?: string | null }): string | null {
  if (!p.imagen_ruta || p.imagen_borrada_at) return null;
  const url = /^https?:\/\//.test(p.imagen_ruta) ? p.imagen_ruta : urlRecurso(baseFotos, p.imagen_ruta);
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(p.updated_at ?? "")}`;
}

interface Props {
  baseFotos: string;
  /** Pieza abierta en el editor (se marca). */
  actual: string | null;
  onAbrir: (p: PiezaInstagram) => void;
}

export function HistorialPiezas({ baseFotos, actual, onAbrir }: Props) {
  const { data: piezas, isLoading, error } = usePiezasInstagram();

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">No se pudo cargar el historial.</p>;
  // Los reels se abren en la pestaña Reels (docs/instagram-video.md), no en este editor.
  const imagenes = (piezas ?? []).filter((p) => (p as { tipo_medio?: string | null }).tipo_medio !== "reel");
  if (!imagenes.length) return <p className="text-sm text-muted-foreground">Todavía no has generado ninguna pieza.</p>;

  return (
    <ul className="space-y-1.5" data-testid="historial-instagram">
      {imagenes.map((p) => {
        const img = urlImagenPieza(baseFotos, p);
        const marca = NOMBRE_MARCA_CORTO[p.marca as MarcaId] ?? MARCAS[p.marca as MarcaId]?.nombre ?? p.marca;
        // Los nombres de las plantillas de Touza ya empiezan por «Touza · ».
        const plantilla = (obtenerPlantilla(p.plantilla)?.nombre ?? p.plantilla).replace(/^Touza · /, "");
        const titulo = [p.datos?.titular, p.datos?.cita].find((t): t is string => typeof t === "string" && !!t.trim()) ?? plantilla;
        return (
          <li key={p.id} className="flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => onAbrir(p)}
              aria-current={actual === p.id ? "true" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md border p-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                actual === p.id && "border-primary bg-primary/5",
              )}
            >
              {img ? (
                <img src={img} alt="" loading="lazy" className={cn("w-10 shrink-0 rounded object-cover", p.formato === "story" ? "aspect-[9/16]" : "aspect-[4/5]")} />
              ) : (
                <span className="flex aspect-[4/5] w-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  <ImageOff className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{titulo}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {marca} · {plantilla} · {p.formato === "story" ? "Story" : "Post"}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <InsigniaEstado dominio="pieza" estado={p.estado} />
                  <time dateTime={p.created_at}>{format(new Date(p.created_at), "d MMM, HH:mm", { locale: es })}</time>
                </span>
                {p.estado === "error" && p.error && (
                  <span className="mt-0.5 block truncate text-xs text-destructive" title={p.error}>
                    {explicarErrorPublicacion(p.error).titulo}
                  </span>
                )}
                {p.imagen_borrada_at && p.estado !== "publicada" && (
                  <span className="mt-0.5 block text-xs text-amber-700">Imagen borrada por no publicarse: vuelve a generarla.</span>
                )}
              </span>
            </button>
            {p.permalink && (
              <a
                href={p.permalink}
                target="_blank"
                rel="noreferrer"
                aria-label="Ver la publicación en Instagram"
                title="Ver en Instagram"
                className="flex w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:w-11"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
