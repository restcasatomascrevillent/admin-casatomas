import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { EstudioReel, validarReel, type FotoElegida, type PeticionFotoReel, type ReelPieza } from "@/components/instagram/reels";
import { NOMBRE_MARCA_CORTO } from "@/components/marketing/instagram/HistorialPiezas";
import { InsigniaEstado } from "@/components/instagram/InsigniaEstado";
import { INFO_BASES } from "@/lib/instagram/reels";
import type { MarcaId } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import { DialogoFotoReel } from "./DialogoFotoReel";
import { PanelVideoReel } from "./PanelVideoReel";
import { urlPreparadaEnCache, useReelsGuardados } from "./useVideoReel";
import type { PiezaReel } from "./logica";

interface Props {
  reel: ReelPieza;
  onChange: (reel: ReelPieza) => void;
  /** Pieza del reel (vive en la página para no perderla al cambiar de pestaña). */
  piezaId: string | null;
  onPiezaId: (id: string | null) => void;
  /** Marca de la barra de pestañas: filtra los reels guardados. */
  marca?: MarcaId | "todas";
}

/** «Del mar» en vez del id «del-mar» (sin el número de orden del selector). */
export function nombreBaseReel(id: string): string {
  const info = INFO_BASES.find((b) => b.id === id);
  return info ? info.nombre.replace(/^\d+\s*·\s*/, "") : id.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Pestaña Reels (fases 5 y 6): editor + vista previa (EstudioReel) y, al lado,
 * el vídeo (PanelVideoReel: generar MP4, estado, probar, publicar, programar)
 * y los últimos reels guardados. Las fotos se eligen de la biblioteca (Drive o
 * carta) con DialogoFotoReel. `?pieza=<id>` (el aviso push «Reel listo») abre
 * ese reel. Sin scroll de página: cada columna hace scroll por dentro.
 */
export function PestanaReels({ reel, onChange, piezaId, onPiezaId, marca = "todas" }: Props) {
  const qc = useQueryClient();
  const [peticion, setPeticion] = useState<PeticionFotoReel | null>(null);
  const resolverFoto = useRef<((f: FotoElegida | null) => void) | null>(null);
  const guardados = useReelsGuardados();

  const elegirFoto = useCallback(
    (p: PeticionFotoReel) =>
      new Promise<FotoElegida | null>((resolver) => {
        resolverFoto.current?.(null);
        resolverFoto.current = resolver;
        setPeticion(p);
      }),
    [],
  );
  const alTerminar = (f: FotoElegida | null) => {
    resolverFoto.current?.(f);
    resolverFoto.current = null;
    setPeticion(null);
  };
  // Al reabrir un reel guardado, sus fotos salen de la caché de copias tmp/.
  const urlFoto = useCallback((id: string) => urlPreparadaEnCache(qc, id), [qc]);

  const abrir = useCallback(
    (p: PiezaReel) => {
      const v = validarReel(p.datos);
      onChange(v.ok ? v.reel : (p.datos as ReelPieza));
      onPiezaId(p.id);
    },
    [onChange, onPiezaId],
  );

  // ?pieza=<id> (notificación «Reel listo»): abrir ese reel una vez.
  const abiertoDeUrl = useRef(false);
  useEffect(() => {
    if (abiertoDeUrl.current || !guardados.data) return;
    const pedida = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pieza");
    abiertoDeUrl.current = true;
    const p = pedida ? guardados.data.find((x) => x.id === pedida) : undefined;
    if (p && p.id !== piezaId) abrir(p);
  }, [guardados.data, abrir, piezaId]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]">
      <EstudioReel reel={reel} onChange={onChange} elegirFoto={elegirFoto} urlFoto={urlFoto} className="h-[44rem] flex-none lg:h-full" />
      <aside className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1" aria-label="Vídeo del reel">
        <PanelVideoReel reel={reel} piezaId={piezaId} onPiezaId={onPiezaId} />
        <section className="space-y-1.5" aria-labelledby="titulo-reels-guardados">
          <div className="flex items-center justify-between">
            <h3 id="titulo-reels-guardados" className="text-sm font-medium">
              Reels guardados
            </h3>
            {piezaId && (
              <button
                type="button"
                className="inline-flex items-center rounded px-1 text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                onClick={() => onPiezaId(null)}
              >
                Empezar uno nuevo
              </button>
            )}
          </div>
          {guardados.isError && <p className="text-xs text-muted-foreground">Los reels guardados aparecerán aquí cuando el vídeo esté activado en este Supabase.</p>}
          {guardados.data?.length === 0 && <p className="text-xs text-muted-foreground">Todavía no has generado ningún vídeo.</p>}
          <ul className="space-y-1" data-testid="reels-guardados">
            {guardados.data?.filter((p) => marca === "todas" || p.marca === marca).map((p) => {
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => abrir(p)}
                    aria-current={p.id === piezaId ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border p-1.5 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
                      p.id === piezaId && "border-primary bg-primary/5",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {nombreBaseReel(p.plantilla)} · {NOMBRE_MARCA_CORTO[p.marca as MarcaId] ?? p.marca}
                      </span>
                      <time className="text-muted-foreground" dateTime={p.updated_at}>
                        {format(new Date(p.updated_at), "d MMM, HH:mm", { locale: es })}
                      </time>
                    </span>
                    <InsigniaEstado dominio="pieza" estado={p.estado} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </aside>
      <DialogoFotoReel peticion={peticion} onTerminar={alTerminar} />
    </div>
  );
}
