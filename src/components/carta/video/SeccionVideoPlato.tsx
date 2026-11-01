import { useEffect, useRef, useState } from "react";
import { Film, Loader2, Trash2, Undo2, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { temasDisponibles, type NombreTema } from "../composicionCarta";
import { porcentajeProgresoVideo, SEGUNDOS_VIDEO, textoProgresoVideo } from "./videoPlato";
import type { VideoPlato } from "./useVideoPlato";

interface Props {
  video: VideoPlato;
  /** `video_url` guardado (null/undefined si no hay). */
  urlGuardada?: string | null;
  /** false = la columna `video_url` no existe todavía (migración sin aplicar). */
  columnaDisponible: boolean | null;
  /** Fondo elegido para la foto (se propone el mismo para el vídeo). */
  temaFoto: NombreTema;
  /** true si en este formulario se está cambiando la foto/fondo. */
  fondoCambiado?: boolean;
}

/**
 * «Vídeo del plato» (opcional): grabar o elegir un vídeo, se usan los
 * primeros 4 s, se quita el fondo en el navegador y se compone sobre el fondo
 * elegido. Se sube al pulsar «Guardar» del formulario.
 */
export function SeccionVideoPlato({ video, urlGuardada, columnaDisponible, temaFoto, fondoCambiado }: Props) {
  const grabarRef = useRef<HTMLInputElement>(null);
  const elegirRef = useRef<HTMLInputElement>(null);
  const [tema, setTema] = useState<NombreTema>(temaFoto);
  useEffect(() => setTema(temaFoto), [temaFoto]);
  const temas = temasDisponibles();
  const { estado, disponible } = video;

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void video.generar(f, tema);
  };

  if (columnaDisponible === false) {
    return (
      <div className="space-y-1 rounded-lg border border-dashed p-3">
        <p className="text-sm font-medium">Vídeo del plato</p>
        <p className="text-sm text-muted-foreground">
          Falta aplicar la migración de vídeo en la base de datos (columna <code>video_url</code>). Hasta entonces no se
          pueden guardar vídeos; el resto del plato se guarda con normalidad.
        </p>
      </div>
    );
  }

  const hayGuardado = !!urlGuardada && !video.quitar;
  const procesando = estado.fase === "procesando";
  const nombreTema = (t: NombreTema) => temas.find((x) => x.clave === t)?.nombre ?? t;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Vídeo del plato (opcional)</p>
        <p className="text-xs text-muted-foreground">
          Para platos estrella. Graba 3–4 s rodeando el plato despacio; se usan los primeros {SEGUNDOS_VIDEO} s, se quita
          el fondo y se pone el fondo elegido. En móvil puede tardar varios minutos.
        </p>
      </div>

      {disponible && "motivo" in disponible ? (
        <p className="text-sm text-destructive">{disponible.motivo}</p>
      ) : (
        <>
          {procesando ? (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {textoProgresoVideo(estado.progreso)}
              </div>
              <Progress value={porcentajeProgresoVideo(estado.progreso)} />
              <Button type="button" variant="outline" size="sm" onClick={video.cancelar}>
                <X className="mr-1 h-4 w-4" /> Cancelar
              </Button>
            </div>
          ) : estado.fase === "listo" ? (
            <div className="space-y-2">
              <video
                src={estado.url}
                className="aspect-[4/3] w-full max-w-sm rounded-lg border bg-muted object-cover"
                autoPlay
                loop
                muted
                playsInline
                controls
              />
              <p className="text-xs text-muted-foreground">
                Vista previa (fondo {nombreTema(estado.tema)}, {Math.round(estado.r.blob.size / 1024)} KB,{" "}
                {estado.r.formato.ext.toUpperCase()}). Se guarda al pulsar «Guardar».
              </p>
              <Button type="button" variant="outline" size="sm" onClick={video.cancelar}>
                <Trash2 className="mr-1 h-4 w-4" /> Descartar vídeo nuevo
              </Button>
            </div>
          ) : hayGuardado ? (
            <div className="space-y-2">
              <video
                src={urlGuardada!}
                className="aspect-[4/3] w-full max-w-sm rounded-lg border bg-muted object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
              {fondoCambiado && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  El vídeo mantiene su fondo; vuelve a generarlo si quieres el nuevo.
                </p>
              )}
              <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => video.setQuitar(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Quitar vídeo
              </Button>
            </div>
          ) : video.quitar ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              El vídeo se quitará al guardar.
              <Button type="button" variant="ghost" size="sm" onClick={() => video.setQuitar(false)}>
                <Undo2 className="mr-1 h-4 w-4" /> Deshacer
              </Button>
            </div>
          ) : null}

          {estado.fase === "fallo" && <p className="text-sm text-destructive">{estado.mensaje}</p>}

          {!procesando && (
            <>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Fondo del vídeo: {nombreTema(tema)}</p>
                <div className="flex flex-wrap gap-2">
                  {temas.map((t) => (
                    <button
                      key={t.clave}
                      type="button"
                      onClick={() => setTema(t.clave)}
                      aria-label={`Fondo ${t.nombre}`}
                      aria-pressed={tema === t.clave}
                      title={t.nombre}
                      className={`h-9 w-9 rounded-full border-2 ${tema === t.clave ? "border-primary ring-2 ring-primary/40" : "border-muted"}`}
                      style={{ backgroundColor: t.color }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => grabarRef.current?.click()} disabled={!disponible}>
                  <Video className="mr-2 h-4 w-4" /> Grabar vídeo
                </Button>
                <Button type="button" variant="outline" onClick={() => elegirRef.current?.click()} disabled={!disponible}>
                  <Film className="mr-2 h-4 w-4" /> {hayGuardado || estado.fase === "listo" ? "Elegir otro vídeo" : "Elegir vídeo"}
                </Button>
              </div>
            </>
          )}
          <input ref={grabarRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={alElegir} />
          <input ref={elegirRef} type="file" accept="video/*" className="hidden" onChange={alElegir} />
        </>
      )}
    </div>
  );
}
