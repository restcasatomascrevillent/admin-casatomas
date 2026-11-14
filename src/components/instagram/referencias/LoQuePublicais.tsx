/**
 * «Lo que publicáis ahora»: stories activas y últimas publicaciones de la
 * cuenta de Instagram de la marca, como referencia de estilo. No llama a Meta
 * al montar: solo al pulsar «Cargar» / «Actualizar». Las URLs de Meta caducan:
 * no se guardan (viven en el estado de la mutación mientras se ve).
 * Scroll solo dentro del componente (el panel no hace scroll de página).
 */
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, ImageOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ParaOficiosos } from "@/components/instagram/ParaOficiosos";
import { ErrorInstagram } from "@/components/marketing/instagram/api";
import { leerReferencias, type MarcaReferencias, type MedioReferencia, type TipoReferencia } from "./api";

const ETIQUETA: Record<TipoReferencia, string> = {
  imagen: "Foto",
  video: "Vídeo",
  carrusel: "Carrusel",
  reel: "Reel",
  story: "Story",
};

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Tarjeta({ m }: { m: MedioReferencia }) {
  const story = m.tipo === "story";
  return (
    <li className="flex min-w-0 flex-col gap-1" data-testid="referencia">
      <div className={cn("relative overflow-hidden rounded-md bg-muted", story ? "aspect-[9/16]" : "aspect-[4/5]")}>
        {m.miniaturaUrl ? (
          <img src={m.miniaturaUrl} alt={m.caption ? m.caption.slice(0, 120) : `${ETIQUETA[m.tipo]} de Instagram`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground" aria-hidden="true">
            <ImageOff className="h-5 w-5" />
          </span>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white">{ETIQUETA[m.tipo]}</span>
      </div>
      <p className="text-xs text-muted-foreground">{fechaCorta(m.fecha)}</p>
      {m.caption && <p className="line-clamp-2 text-xs">{m.caption}</p>}
      {m.permalink && (
        <a href={m.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline pointer-coarse:min-h-11">
          Ver en Instagram <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

export function LoQuePublicais({ marca }: { marca: MarcaReferencias }) {
  const m = useMutation({ mutationFn: () => leerReferencias(marca) });
  const datos = m.data && m.data.marca === marca ? m.data : null;
  const error = m.error;
  const vacio = datos && datos.publicaciones.length === 0 && datos.stories.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto" aria-labelledby="lo-que-publicais">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="lo-que-publicais" className="text-base font-semibold">
            Lo que publicáis ahora
          </h2>
          <p className="text-xs text-muted-foreground">Últimas publicaciones y stories activas de la cuenta, para usarlas como referencia de estilo.</p>
          {datos?.cuenta.username && <p className="text-xs text-muted-foreground">@{datos.cuenta.username}</p>}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>
          {m.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />}
          {datos ? "Actualizar" : "Cargar"}
        </Button>
      </header>

      {m.isPending && !datos && (
        <p className="text-xs text-muted-foreground" role="status">
          Leyendo la cuenta de Instagram…
        </p>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm" role="alert">
          <p>No se han podido leer las publicaciones de Instagram. Prueba otra vez en un rato.</p>
          <ParaOficiosos>
            <p>{error.message}</p>
            {error instanceof ErrorInstagram && error.comoArreglarlo && <p>{[error.comoArreglarlo].flat().join(" · ")}</p>}
          </ParaOficiosos>
        </div>
      )}

      {!datos && !m.isPending && !error && <p className="text-xs text-muted-foreground">Pulsa «Cargar» para ver lo último que hay en la cuenta.</p>}

      {vacio && <p className="text-sm text-muted-foreground">La cuenta no tiene publicaciones ni stories activas.</p>}

      {datos && datos.avisos.length > 0 && (
        <ParaOficiosos titulo="Avisos (Para Oficiosos)">
          {datos.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </ParaOficiosos>
      )}

      {datos && datos.stories.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">Stories activas</h3>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {datos.stories.map((s) => (
              <Tarjeta key={s.id} m={s} />
            ))}
          </ul>
        </div>
      )}

      {datos && datos.publicaciones.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">Últimas publicaciones</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {datos.publicaciones.map((p) => (
              <Tarjeta key={p.id} m={p} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
