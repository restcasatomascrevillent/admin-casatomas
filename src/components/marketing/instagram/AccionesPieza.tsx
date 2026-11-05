import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ExternalLink, FlaskConical, ImageIcon, Loader2, RotateCw, Send } from "lucide-react";
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
import { ProgramarPiezaDialog } from "@/components/instagram/programar";
import { MARCAS, type FormatoId, type MarcaId } from "@/lib/instagram";
import {
  ErrorInstagram,
  MENSAJE_SIN_SERVIDOR,
  comprobarConexion,
  cuentaDeMarca,
  generarImagen,
  publicar,
  textoError,
  type Cuota,
  type FotoPreparada,
  type RespuestaEstado,
} from "./api";
import { MAX_ALT_TEXT, MAX_CAPTION, MAX_HASHTAGS, MAX_MENCIONES, contarCaracteres, problemasAltText, resumenCaption } from "./contadores";
import { textoCuota } from "./ConexionInstagram";
import { humanizarProblema } from "./pieza";
import type { EstadoPieza } from "./usePiezasInstagram";

/** Lo que el servidor sabe de la pieza que está en el editor. */
export interface ServidorPieza {
  id: string | null;
  estado: EstadoPieza | "en_proceso" | null;
  urlJpeg: string | null;
  /** JSON de la pieza con el que se generó el JPEG: si el formulario cambia, la imagen ya no vale. */
  firma: string | null;
  contenedorId: string | null;
  estadoContenedor: string | null;
  cuota: Cuota | null;
  permalink: string | null;
  /** Texto con el que pasó la prueba: si se cambia, hay que volver a probar. */
  captionProbado: string | null;
  /** Texto alternativo con el que pasó la prueba (lo reutiliza el programador). */
  altProbado?: string | null;
  /** Meta aún procesaba la imagen: «Reintentar» con el mismo contenedor. */
  reintento: { dryRun: boolean } | null;
  avisos: string[];
}

export const SERVIDOR_VACIO: ServidorPieza = {
  id: null,
  estado: null,
  urlJpeg: null,
  firma: null,
  contenedorId: null,
  estadoContenedor: null,
  cuota: null,
  permalink: null,
  captionProbado: null,
  altProbado: null,
  reintento: null,
  avisos: [],
};

interface Props {
  pieza: Record<string, unknown>;
  /** JSON.stringify(pieza): identifica lo que se ve. */
  firma: string;
  formato: FormatoId;
  /** Marca de la pieza: decide la cuenta de Instagram. */
  marca: MarcaId;
  /** Hay problemas de validación o de maquetación: no se puede generar. */
  bloqueada: boolean;
  /** La vista previa aún no se ha medido. */
  midiendo: boolean;
  servidor: ServidorPieza;
  onServidor: (s: ServidorPieza | ((previo: ServidorPieza) => ServidorPieza)) => void;
  caption: string;
  onCaption: (c: string) => void;
  /** Texto alternativo de la imagen (solo posts). */
  altText: string;
  onAltText: (a: string) => void;
  /** Resultado de «Comprobar conexión» (cuenta de cada marca), para el diálogo de publicar. */
  estadoConexion: RespuestaEstado | null;
  onEstadoConexion: (e: RespuestaEstado | null) => void;
  /** Tras guardar algo en el servidor (para refrescar el historial). */
  onCambioServidor?: () => void;
  /** Foto de Drive ya copiada al bucket (la necesita el render). */
  fotoPreparada?: FotoPreparada | null;
  /** Copia tmp/ de esa foto: la función la borra al publicar de verdad. */
  fotoTmp?: string | null;
  /** Tras una publicación real. */
  onPublicada?: () => void;
}

type Accion = "generar" | "probar" | "publicar" | null;

interface ErrorVisible {
  texto: string;
  pasos: string[];
  problemas: string[];
}

function aErrorVisible(e: unknown): ErrorVisible {
  if (e instanceof ErrorInstagram) {
    return {
      texto: e.message,
      pasos: e.comoArreglarlo ? [e.comoArreglarlo].flat().filter(Boolean) : [],
      problemas: (e.problemas ?? []).map(humanizarProblema),
    };
  }
  return { texto: textoError(e), pasos: [], problemas: [] };
}

export function AccionesPieza({
  pieza,
  firma,
  formato,
  marca,
  bloqueada,
  midiendo,
  servidor,
  onServidor,
  caption,
  onCaption,
  altText,
  onAltText,
  estadoConexion,
  onEstadoConexion,
  onCambioServidor,
  fotoPreparada,
  fotoTmp,
  onPublicada,
}: Props) {
  const [accion, setAccion] = useState<Accion>(null);
  const [error, setError] = useState<ErrorVisible | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [buscandoCuenta, setBuscandoCuenta] = useState(false);
  const [programando, setProgramando] = useState(false);

  const story = formato === "story";
  // Las stories no llevan texto por la API: se manda vacío.
  const captionEnvio = story ? "" : caption;
  const resumen = resumenCaption(captionEnvio);
  // Tampoco texto alternativo (Meta no lo admite en stories).
  const altEnvio = story ? "" : altText.trim();
  const problemasAlt = problemasAltText(altEnvio);
  const cuenta = cuentaDeMarca(estadoConexion, marca);
  const nombreMarca = MARCAS[marca]?.nombre ?? marca;
  const imagenAlDia = !!servidor.id && !!servidor.urlJpeg && servidor.firma === firma;
  const publicada = servidor.estado === "publicada";
  const ocupado = accion !== null;

  const puedeGenerar = !bloqueada && !midiendo && !ocupado;
  const puedeProbar = imagenAlDia && !publicada && resumen.problemas.length === 0 && problemasAlt.length === 0 && !ocupado;
  const pruebaVigente =
    servidor.estado === "prueba_ok" && imagenAlDia && servidor.captionProbado === captionEnvio && (servidor.altProbado ?? "") === altEnvio;
  const puedePublicar = pruebaVigente && !ocupado;

  const fallo = (e: unknown, titulo: string) => {
    const v = aErrorVisible(e);
    setError(v);
    toast.error(titulo, { description: v.texto });
  };

  const generar = async () => {
    setAccion("generar");
    setError(null);
    try {
      // Una pieza ya publicada no se toca: lo editado se guarda como pieza nueva.
      const r = await generarImagen(pieza, publicada ? null : servidor.id, undefined, fotoPreparada);
      onServidor({ ...SERVIDOR_VACIO, id: r.id, estado: "generada", urlJpeg: r.urlJpeg, firma, avisos: r.avisos ?? [] });
      toast.success("Imagen generada y guardada");
      onCambioServidor?.();
    } catch (e) {
      fallo(e, "No se pudo generar la imagen");
    } finally {
      setAccion(null);
    }
  };

  const enviar = async (dryRun: boolean, contenedorId?: string | null) => {
    if (!servidor.id) return;
    setAccion(dryRun ? "probar" : "publicar");
    setError(null);
    try {
      const r = await publicar({ id: servidor.id, caption: captionEnvio, altText: altEnvio, dryRun, contenedorId, fotoTmp: dryRun ? null : fotoTmp });
      onServidor((s) => ({
        ...s,
        estado: r.estado === "en_proceso" ? s.estado : (r.estado as ServidorPieza["estado"]),
        contenedorId: r.contenedorId ?? s.contenedorId,
        estadoContenedor: r.estadoContenedor,
        cuota: r.cuota ?? s.cuota,
        urlJpeg: s.urlJpeg ?? r.urlJpeg,
        permalink: r.permalink ?? s.permalink,
        captionProbado: dryRun && r.estado === "prueba_ok" ? captionEnvio : s.captionProbado,
        altProbado: dryRun && r.estado === "prueba_ok" ? altEnvio : (s.altProbado ?? null),
        reintento: r.estado === "en_proceso" ? { dryRun } : null,
        avisos: r.avisos,
      }));
      if (r.estado === "en_proceso") toast.info("Instagram aún está procesando la imagen", { description: "Pulsa «Reintentar» en unos segundos." });
      else if (r.estado === "prueba_ok") toast.success("Prueba correcta: no se ha publicado nada");
      else if (r.estado === "publicada") {
        toast.success("Publicada en Instagram");
        onPublicada?.();
      }
      onCambioServidor?.();
    } catch (e) {
      fallo(e, dryRun ? "La prueba ha fallado" : "No se pudo publicar");
      onCambioServidor?.();
    } finally {
      setAccion(null);
    }
  };

  const abrirConfirmacion = async () => {
    setConfirmar(true);
    if (cuenta) return;
    setBuscandoCuenta(true);
    try {
      onEstadoConexion(await comprobarConexion());
    } catch {
      onEstadoConexion(null);
    } finally {
      setBuscandoCuenta(false);
    }
  };

  const contador = (n: number, max: number) => (
    <span className={cn("tabular-nums", n > max && "font-medium text-destructive")}>
      {n}/{max}
    </span>
  );

  return (
    <div className="space-y-4">
      {import.meta.env.DEV && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {MENSAJE_SIN_SERVIDOR} Aquí puedes diseñar y ver la vista previa; «Comprobar conexión» y la publicación sí funcionan (son Edge Functions de Supabase).
        </p>
      )}

      {/* 1. Generar */}
      <section aria-labelledby="titulo-generar" className="space-y-2">
        <h3 id="titulo-generar" className="text-sm font-medium">
          1. Imagen definitiva
        </h3>
        <Button type="button" className="w-full pointer-coarse:min-h-11" onClick={generar} disabled={!puedeGenerar}>
          {accion === "generar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ImageIcon className="mr-2 h-4 w-4" aria-hidden="true" />}
          {accion === "generar" ? "Generando…" : servidor.id && !publicada ? "Volver a generar" : "Generar imagen"}
        </Button>
        {bloqueada && <p className="text-xs text-muted-foreground">Arregla los problemas en rojo para poder generarla.</p>}
        {servidor.urlJpeg && (
          <div className="flex items-start gap-2">
            <a href={servidor.urlJpeg} target="_blank" rel="noreferrer" className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <img
                src={servidor.urlJpeg}
                alt="Imagen generada"
                className={cn("w-16 rounded border object-cover", story ? "aspect-[9/16]" : "aspect-[4/5]", !imagenAlDia && "opacity-50")}
              />
            </a>
            <div className="min-w-0 text-xs">
              {imagenAlDia ? (
                <p className="text-muted-foreground">Imagen guardada. Ábrela para verla a tamaño real.</p>
              ) : (
                <p className="text-amber-700">Has cambiado la pieza: vuelve a generar la imagen antes de probar o publicar.</p>
              )}
              {servidor.avisos.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-amber-700">
                  {servidor.avisos.map((a) => <li key={a}>{humanizarProblema(a)}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 2. Texto */}
      <section className="space-y-1.5">
        <Label id="titulo-caption" htmlFor="caption-ig" className="text-sm font-medium">
          2. Texto de la publicación
        </Label>
        {story ? (
          <p className="text-xs text-muted-foreground">Las stories no llevan texto: Instagram no lo admite al publicar desde aquí.</p>
        ) : (
          <>
            <Textarea
              id="caption-ig"
              value={caption}
              onChange={(e) => onCaption(e.target.value)}
              rows={4}
              placeholder="Escribe el texto, los hashtags (#casatomas) y las menciones (@…)."
              aria-describedby="contadores-caption"
              aria-invalid={resumen.problemas.length > 0 || undefined}
              disabled={publicada}
              className="resize-y text-sm"
            />
            <p id="contadores-caption" className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>Caracteres {contador(resumen.caracteres, MAX_CAPTION)}</span>
              <span>Hashtags {contador(resumen.hashtags, MAX_HASHTAGS)}</span>
              <span>Menciones {contador(resumen.menciones, MAX_MENCIONES)}</span>
            </p>
            {resumen.problemas.map((p) => (
              <p key={p} className="text-xs text-destructive">
                {p}
              </p>
            ))}
            <Label htmlFor="alt-ig" className="block pt-2 text-sm font-medium">
              Texto alternativo <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="alt-ig"
              value={altText}
              onChange={(e) => onAltText(e.target.value)}
              rows={2}
              placeholder="Describe la imagen para quien no la ve: «Chuletón trinchado sobre tabla, con patatas»."
              aria-describedby="contador-alt"
              aria-invalid={problemasAlt.length > 0 || undefined}
              disabled={publicada}
              className="resize-y text-sm"
            />
            <p id="contador-alt" className="text-xs text-muted-foreground">
              Lo leen los lectores de pantalla de Instagram. Caracteres {contador(contarCaracteres(altEnvio), MAX_ALT_TEXT)}
            </p>
            {problemasAlt.map((p) => (
              <p key={p} className="text-xs text-destructive">
                {p}
              </p>
            ))}
          </>
        )}
      </section>

      {/* 3. Prueba y publicación */}
      <section aria-labelledby="titulo-publicar" className="space-y-2">
        <h3 id="titulo-publicar" className="text-sm font-medium">
          3. Probar y publicar
        </h3>
        <Button type="button" variant="outline" className="w-full pointer-coarse:min-h-11" onClick={() => enviar(true)} disabled={!puedeProbar}>
          {accion === "probar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />}
          {accion === "probar" ? "Probando…" : "Prueba sin publicar"}
        </Button>
        {!imagenAlDia && !publicada && <p className="text-xs text-muted-foreground">Primero genera la imagen.</p>}

        {(servidor.estado === "prueba_ok" || servidor.reintento || servidor.cuota) && !publicada && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-md bg-muted/50 p-2 text-xs" data-testid="resultado-prueba">
            {servidor.estadoContenedor && (
              <>
                <dt className="text-muted-foreground">Contenedor</dt>
                <dd>{servidor.estadoContenedor === "FINISHED" ? "Listo en Instagram" : servidor.estadoContenedor}</dd>
              </>
            )}
            {servidor.cuota && (
              <>
                <dt className="text-muted-foreground">Cupo</dt>
                <dd>{textoCuota(servidor.cuota)}</dd>
              </>
            )}
            {servidor.urlJpeg && (
              <>
                <dt className="text-muted-foreground">Imagen</dt>
                <dd className="min-w-0 truncate">
                  <a href={servidor.urlJpeg} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                    {servidor.urlJpeg.replace(/^https?:\/\//, "").split("?")[0]}
                  </a>
                </dd>
              </>
            )}
          </dl>
        )}
        {servidor.estado === "prueba_ok" && !pruebaVigente && !publicada && (
          <p className="text-xs text-amber-700">Has cambiado la imagen o el texto desde la prueba: vuelve a probar.</p>
        )}

        {servidor.reintento && servidor.contenedorId && (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <p>Instagram todavía está procesando la imagen. Espera unos segundos y reintenta.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => enviar(servidor.reintento!.dryRun, servidor.contenedorId)}
              disabled={ocupado}
              className="pointer-coarse:min-h-11"
            >
              <RotateCw className="mr-1 h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        )}

        {publicada ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">
            <p className="font-medium">Publicada en Instagram.</p>
            {servidor.permalink && (
              <a href={servidor.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-800 underline underline-offset-2">
                Ver la publicación
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        ) : (
          <>
            <Button type="button" className="w-full pointer-coarse:min-h-11" onClick={abrirConfirmacion} disabled={!puedePublicar}>
              {accion === "publicar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
              {accion === "publicar" ? "Publicando…" : "Publicar en Instagram"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full pointer-coarse:min-h-11"
              onClick={() => setProgramando(true)}
              disabled={!puedePublicar || !servidor.id}
            >
              <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />
              Programar…
            </Button>
            {!pruebaVigente && (
              <p className="text-xs text-muted-foreground">
                Publicar y Programar se activan cuando la prueba sin publicar sale bien (así quedan guardados el texto y el texto alternativo).
              </p>
            )}
            <ProgramarPiezaDialog
              piezaId={servidor.id ?? null}
              open={programando}
              onOpenChange={setProgramando}
              onHecho={() => onCambioServidor?.()}
            />
          </>
        )}
      </section>

      {error && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <p className="font-medium text-destructive">{error.texto}</p>
          {error.problemas.length > 0 && (
            <ul className="list-disc pl-4 text-destructive">
              {error.problemas.map((p) => <li key={p}>{p}</li>)}
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
            <AlertDialogTitle>¿Publicar en Instagram?</AlertDialogTitle>
            <AlertDialogDescription>
              {buscandoCuenta
                ? "Comprobando la cuenta…"
                : cuenta
                  ? `Se publicará en la cuenta @${cuenta} (${nombreMarca}). No se puede deshacer desde aquí.`
                  : `Se publicará en la cuenta configurada para ${nombreMarca} (no se ha podido comprobar cuál). No se puede deshacer desde aquí.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={buscandoCuenta}
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
