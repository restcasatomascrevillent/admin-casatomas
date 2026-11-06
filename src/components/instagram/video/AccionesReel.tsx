import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ExternalLink, FlaskConical, Loader2, RotateCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { MARCAS, type MarcaId } from "@/lib/instagram";
import { ProgramarPiezaDialog } from "@/components/instagram/programar";
import { ErrorInstagram, publicar, textoError } from "@/components/marketing/instagram/api";
import { MAX_CAPTION, MAX_HASHTAGS, MAX_MENCIONES, resumenCaption } from "@/components/marketing/instagram/contadores";
import { botonesReel, type PiezaReel } from "./logica";

interface Props {
  pieza: PiezaReel;
  /** El reel del editor es el del vídeo (si no, hay que volver a generarlo). */
  reelAlDia: boolean;
  /** Hay un trabajo de render vivo. */
  trabajoActivo: boolean;
  caption: string;
  onCaption: (c: string) => void;
  /** Tras cualquier cambio en el servidor (refresca la pieza). */
  onCambio: () => void;
}

/**
 * Probar, publicar y programar un REEL: los mismos pasos que una imagen
 * (AccionesPieza), con el MP4 en vez del JPEG. Si Instagram tarda en procesar
 * el vídeo, la pieza queda «procesando»: se cierra sola (el programador, cada
 * 5 min) o con «Comprobar ahora».
 */
export function AccionesReel({ pieza, reelAlDia, trabajoActivo, caption, onCaption, onCambio }: Props) {
  const [accion, setAccion] = useState<"probar" | "publicar" | "comprobar" | null>(null);
  const [error, setError] = useState<{ texto: string; pasos: string[]; problemas: string[] } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [programando, setProgramando] = useState(false);
  const resumen = resumenCaption(caption);
  const b = botonesReel({ valido: true, ocupado: accion !== null, trabajoActivo, pieza, reelAlDia, caption, captionValido: resumen.problemas.length === 0 });
  const publicada = pieza.estado === "publicada";
  const nombreMarca = MARCAS[pieza.marca as MarcaId]?.nombre ?? pieza.marca;

  const enviar = async (dryRun: boolean, contenedorId?: string | null, tipo: "probar" | "publicar" | "comprobar" = dryRun ? "probar" : "publicar") => {
    setAccion(tipo);
    setError(null);
    try {
      const r = await publicar({ id: pieza.id, caption, dryRun, contenedorId });
      if (r.estado === "en_proceso") toast.info("Instagram está procesando el vídeo", { description: "Se cerrará solo en unos minutos; puedes seguir trabajando." });
      else if (r.estado === "prueba_ok") toast.success("Prueba correcta: no se ha publicado nada");
      else if (r.estado === "publicada") toast.success("Reel publicado en Instagram");
      for (const a of r.avisos.filter((x) => /no admiten|portada|cubo/i.test(x))) toast.message(a);
    } catch (e) {
      const v =
        e instanceof ErrorInstagram
          ? { texto: e.message, pasos: e.comoArreglarlo ? [e.comoArreglarlo].flat().filter(Boolean) : [], problemas: e.problemas ?? [] }
          : { texto: textoError(e), pasos: [], problemas: [] };
      setError(v);
      toast.error(dryRun ? "La prueba ha fallado" : "No se pudo publicar", { description: v.texto });
    } finally {
      setAccion(null);
      onCambio();
    }
  };

  const contador = (n: number, max: number) => <span className={cn("tabular-nums", n > max && "font-medium text-destructive")}>{n}/{max}</span>;

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <Label htmlFor="caption-reel" className="text-sm font-medium">
          Texto de la publicación
        </Label>
        <Textarea
          id="caption-reel"
          value={caption}
          onChange={(e) => onCaption(e.target.value)}
          rows={4}
          placeholder="Escribe el texto, los hashtags (#casatomas) y las menciones (@…)."
          aria-describedby="contadores-reel"
          aria-invalid={resumen.problemas.length > 0 || undefined}
          disabled={publicada}
          className="resize-y text-sm"
        />
        <p id="contadores-reel" className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>Caracteres {contador(resumen.caracteres, MAX_CAPTION)}</span>
          <span>Hashtags {contador(resumen.hashtags, MAX_HASHTAGS)}</span>
          <span>Menciones {contador(resumen.menciones, MAX_MENCIONES)}</span>
        </p>
        {resumen.problemas.map((p) => (
          <p key={p} className="text-xs text-destructive">
            {p}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">Los reels no llevan texto alternativo por la API de Instagram. Se comparten también en el feed.</p>
      </section>

      {pieza.estado === "procesando" && (
        <div className="space-y-1 rounded-md border border-violet-300 bg-violet-50 p-2 text-xs text-violet-900" role="status" data-testid="reel-procesando">
          <p>
            Instagram está procesando el vídeo ({pieza.procesando_accion === "publicar" ? "publicación" : pieza.procesando_accion === "programador" ? "programación" : "prueba"}).
            Se cerrará solo en unos minutos.
          </p>
          {pieza.contenedor_id && pieza.procesando_accion !== "programador" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={accion !== null}
              onClick={() => enviar(pieza.procesando_accion !== "publicar", pieza.contenedor_id, "comprobar")}
              className="pointer-coarse:min-h-11"
            >
              {accion === "comprobar" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCw className="mr-1 h-4 w-4" aria-hidden="true" />}
              Comprobar ahora
            </Button>
          )}
        </div>
      )}

      {publicada ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">
          <p className="font-medium">Reel publicado en Instagram.</p>
          {pieza.permalink && (
            <a href={pieza.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-800 underline underline-offset-2">
              Ver el reel
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      ) : (
        <section className="space-y-2" aria-label="Probar y publicar el reel">
          <Button type="button" variant="outline" className="w-full pointer-coarse:min-h-11" onClick={() => enviar(true)} disabled={!b.probar}>
            {accion === "probar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />}
            {accion === "probar" ? "Probando…" : "Prueba sin publicar"}
          </Button>
          <Button type="button" className="w-full pointer-coarse:min-h-11" onClick={() => setConfirmar(true)} disabled={!b.publicar}>
            {accion === "publicar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
            {accion === "publicar" ? "Publicando…" : "Publicar en Instagram"}
          </Button>
          <Button type="button" variant="outline" className="w-full pointer-coarse:min-h-11" onClick={() => setProgramando(true)} disabled={!b.publicar}>
            <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />
            Programar…
          </Button>
          {b.motivo && <p className="text-xs text-muted-foreground">{b.motivo}</p>}
          {pieza.estado === "error" && pieza.error && <p className="text-xs text-destructive">Último error: {pieza.error}</p>}
          <ProgramarPiezaDialog piezaId={pieza.id} open={programando} onOpenChange={setProgramando} onHecho={onCambio} />
        </section>
      )}

      {error && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <p className="font-medium text-destructive">{error.texto}</p>
          {error.problemas.length > 0 && (
            <ul className="list-disc pl-4 text-destructive">
              {error.problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {error.pasos.length > 0 && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Cómo arreglarlo: </span>
              {error.pasos.join(" ")}
            </p>
          )}
        </div>
      )}

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar el reel en Instagram?</AlertDialogTitle>
            <AlertDialogDescription>
              Se publicará en la cuenta configurada para {nombreMarca}. Si Instagram tarda en procesar el vídeo, se publicará solo en unos minutos. No se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmar(false);
                void enviar(false);
              }}
            >
              Publicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
