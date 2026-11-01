import { useEffect, useRef, useState } from "react";
import { Check, Cpu, Film, Loader2, Palette, RotateCcw, Smartphone, Trash2, Undo2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { temasDisponibles, type NombreTema } from "../composicionCarta";
import { AVISO_PANTALLA_ENCENDIDA, porcentajeProgresoVideo, SEGUNDOS_VIDEO, textoProgresoVideo } from "./videoPlato";
import type { VideoPlato } from "./useVideoPlato";
import { ACEPTA_VIDEO } from "./lecturaVideo";
import { accionCambioFondo, MENSAJE_SIN_ORIGINAL, temaDeVideoUrl, temaMarcado, type EstadoOriginal } from "./originalVideo";
import { buscarOriginalVideo } from "./subirVideoPlato";
import { leerMedidaCacheada } from "../potente/dispositivoPotente";

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
  /** Avisa del fondo marcado para el vídeo (p. ej. para «Mandar a un dispositivo potente»). */
  onTemaChange?: (tema: NombreTema) => void;
}

/**
 * «Vídeo del plato» (opcional): grabar o elegir un vídeo, se usan los
 * primeros 4 s, se quita el fondo en el navegador y se compone sobre el fondo
 * elegido. Se sube al pulsar «Guardar» del formulario.
 */
export function SeccionVideoPlato({ video, urlGuardada, columnaDisponible, temaFoto, fondoCambiado, onTemaChange }: Props) {
  const grabarRef = useRef<HTMLInputElement>(null);
  const elegirRef = useRef<HTMLInputElement>(null);
  // Fondo que ha tocado el usuario (null = no ha tocado: se marca el fondo real del vídeo).
  const [elegido, setElegido] = useState<NombreTema | null>(null);
  useEffect(() => setElegido(null), [temaFoto]);
  const temas = temasDisponibles();
  const { estado, disponible } = video;

  // ¿Hay vídeo ya hecho, y con qué fondo?
  const hayGuardado = !!urlGuardada && !video.quitar;
  const listo = estado.fase === "listo" ? estado.trabajo : null;
  const hayVideo = !!listo || hayGuardado;
  const temaReal = listo ? listo.tema : hayGuardado ? temaDeVideoUrl(urlGuardada) : null;
  const tema = temaMarcado(elegido, temaReal, temaFoto);
  const avisarTema = useRef(onTemaChange);
  avisarTema.current = onTemaChange;
  useEffect(() => avisarTema.current?.(tema), [tema]);
  const platoId = video.platoId;

  // Si quiere otro fondo, mirar si el vídeo tiene original guardado.
  const quiereCambio = hayVideo && !!elegido && elegido !== temaReal && estado.fase !== "procesando";
  const rutaSesion = listo?.rutaOriginal;
  const [original, setOriginal] = useState<EstadoOriginal>(null);
  useEffect(() => {
    if (!quiereCambio || !platoId) return;
    if (rutaSesion) {
      setOriginal(rutaSesion);
      return;
    }
    let vivo = true;
    setOriginal(null);
    buscarOriginalVideo(platoId)
      .then((r) => vivo && setOriginal(r ?? false))
      .catch(() => vivo && setOriginal(false));
    return () => {
      vivo = false;
    };
  }, [quiereCambio, platoId, rutaSesion]);
  const accion = platoId
    ? accionCambioFondo({ hayVideo: quiereCambio, elegido, real: temaReal, tieneArchivo: !!listo?.archivo, original })
    : "nada";
  const [mandando, setMandando] = useState(false);
  const esPotente = leerMedidaCacheada()?.potente === true;

  const cambiarFondo = () => {
    if (!elegido) return;
    if (video.cambiarFondo(elegido, original)) setElegido(null);
    else toast.error(MENSAJE_SIN_ORIGINAL);
  };

  const mandarCambioAPotente = async () => {
    if (!elegido || !platoId || typeof original !== "string") return;
    setMandando(true);
    try {
      const { mandarOriginalAPotente } = await import("../potente/trabajosVideo");
      await mandarOriginalAPotente({ platoId, rutaOriginal: original, tema: elegido });
      toast.success("Cambio de fondo mandado", {
        description: "Lo hará el primer ordenador potente que tenga el panel abierto; el vídeo se guarda solo.",
      });
      setElegido(null);
    } catch (e) {
      toast.error("No se pudo mandar el vídeo", { description: (e as Error)?.message });
    } finally {
      setMandando(false);
    }
  };

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
                {estado.enCola ? "En cola: empezará cuando acabe el vídeo anterior…" : textoProgresoVideo(estado.progreso)}
              </div>
              <Progress value={porcentajeProgresoVideo(estado.progreso)} />
              <p className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <Smartphone className="h-3.5 w-3.5 shrink-0" /> {AVISO_PANTALLA_ENCENDIDA}
              </p>
              <p className="text-xs text-muted-foreground">
                Puedes cerrar esta ventana y seguir usando el panel: el vídeo se guarda solo al terminar y te avisamos.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={video.cancelar}>
                <X className="mr-1 h-4 w-4" /> Cancelar
              </Button>
            </div>
          ) : estado.fase === "pendiente" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Film className="h-4 w-4" /> «{estado.nombreArchivo}»: el vídeo se generará al guardar el plato.
              <Button type="button" variant="ghost" size="sm" onClick={video.cancelar}>
                <X className="mr-1 h-4 w-4" /> Quitar
              </Button>
            </div>
          ) : estado.fase === "listo" && estado.urlVista ? (
            <div className="space-y-2">
              <video
                src={estado.urlVista}
                className="aspect-[4/3] w-full max-w-sm rounded-lg border bg-muted object-cover"
                autoPlay
                loop
                muted
                playsInline
                controls
              />
              <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Vídeo nuevo guardado automáticamente en la carta (fondo {nombreTema(estado.trabajo.tema)}).
              </p>
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
                  El vídeo mantiene su fondo; para cambiarlo, toca abajo el fondo que quieras y pulsa «Cambiar fondo del vídeo».
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

          {estado.fase === "fallo" && !procesando && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{estado.mensaje}</p>
              {video.puedeReintentar && (
                <Button type="button" variant="outline" size="sm" onClick={video.reintentar}>
                  <RotateCcw className="mr-1 h-4 w-4" /> Reintentar
                </Button>
              )}
            </div>
          )}

          {!procesando && (
            <>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Fondo del vídeo: {nombreTema(tema)}</p>
                <div className="flex flex-wrap gap-2">
                  {temas.map((t) => (
                    <button
                      key={t.clave}
                      type="button"
                      onClick={() => setElegido(t.clave)}
                      aria-label={`Fondo ${t.nombre}`}
                      aria-pressed={tema === t.clave}
                      title={t.nombre}
                      className={`h-9 w-9 rounded-full border-2 ${tema === t.clave ? "border-primary ring-2 ring-primary/40" : "border-muted"}`}
                      style={{ backgroundColor: t.color }}
                    />
                  ))}
                </div>
              </div>
              {accion === "boton" && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={cambiarFondo}>
                    <Palette className="mr-2 h-4 w-4" /> Cambiar fondo del vídeo a {nombreTema(tema)}
                  </Button>
                  {!esPotente && typeof original === "string" && (
                    <Button type="button" variant="secondary" onClick={() => void mandarCambioAPotente()} disabled={mandando}>
                      {mandando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cpu className="mr-2 h-4 w-4" />}
                      Mandar a un dispositivo potente
                    </Button>
                  )}
                </div>
              )}
              {accion === "buscando" && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comprobando el vídeo original…
                </p>
              )}
              {accion === "sin-original" && <p className="text-sm text-amber-700 dark:text-amber-400">{MENSAJE_SIN_ORIGINAL}</p>}
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
          <input ref={elegirRef} type="file" accept={ACEPTA_VIDEO} className="hidden" onChange={alElegir} />
        </>
      )}
    </div>
  );
}
