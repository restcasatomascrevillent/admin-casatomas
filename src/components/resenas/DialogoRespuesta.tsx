import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, Copy, ExternalLink, RotateCcw, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import {
  enlaceGoogle,
  estadoDe,
  ETIQUETA_ESTADO,
  llamarContestador,
  MAX_RESPUESTA,
  TONO_ESTADO,
  type ResenaPanel,
} from "@/lib/resenas/contestador";
import { Estrellas } from "./Estrellas";

interface Props {
  resena: ResenaPanel | null;
  placeId?: string | null;
  /** Business Profile conectado: «Aprobar» publica directamente en Google. */
  googleConectado: boolean;
  onClose: () => void;
  onCambio: () => void;
}

/**
 * Revisar, editar y aprobar la respuesta a una reseña. Nada se publica sin pulsar «Aprobar»; sin Business Profile
 * conectado, la respuesta aprobada se copia y se abre la reseña en Google con un clic.
 */
export function DialogoRespuesta({ resena, placeId, googleConectado, onClose, onCambio }: Props) {
  const [texto, setTexto] = useState("");
  const [indicacion, setIndicacion] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState<null | "proponer" | "guardar" | "aprobar" | "marcar" | "descartar">(null);

  useEffect(() => {
    setTexto(resena?.respuesta_propuesta ?? resena?.respuesta ?? "");
    setIndicacion("");
    setAvisos([]);
  }, [resena?.id, resena?.respuesta_propuesta, resena?.respuesta]);

  if (!resena) return null;
  const estado = estadoDe(resena);
  const enlace = enlaceGoogle(resena, placeId);
  const publicada = estado === "publicada";
  const sinCambios = texto.trim() === (resena.respuesta_propuesta ?? "").trim();
  const largo = texto.length;

  const accion = async <T,>(clave: NonNullable<typeof ocupado>, cuerpo: Record<string, unknown>, ok: (r: T) => void) => {
    setOcupado(clave);
    try {
      const r = await llamarContestador<T>(cuerpo);
      ok(r);
      onCambio();
    } catch (e) {
      toast.error(mensajeUsuario(e, "No se pudo completar. Inténtalo de nuevo."));
    } finally {
      setOcupado(null);
    }
  };

  const proponer = () =>
    accion<{ propuesta: string; avisos?: string[] }>("proponer", { accion: "proponer", id: resena.id, indicacion: indicacion.trim() || undefined }, (r) => {
      setTexto(r.propuesta);
      setAvisos(r.avisos ?? []);
      toast.success("Nueva propuesta lista para revisar");
    });

  const copiarYAbrir = async () => {
    try {
      await navigator.clipboard.writeText(texto.trim());
      toast.success("Respuesta copiada. Pégala en Google y pulsa «Responder».");
    } catch {
      toast.error("No se pudo copiar: selecciona el texto y cópialo a mano.");
    }
    if (enlace) window.open(enlace, "_blank", "noopener,noreferrer");
  };

  const aprobar = () =>
    accion<{ publicada: boolean; estado: string; motivo?: string; mensaje?: string }>("aprobar", { accion: "aprobar", id: resena.id, texto }, (r) => {
      if (r.publicada) {
        toast.success("Respuesta publicada en Google");
        onClose();
      } else if (r.estado === "error") {
        toast.error(`Google no la aceptó: ${r.motivo ?? "error"}`, { duration: 8000 });
      } else {
        toast.success(r.mensaje ?? "Respuesta aprobada");
      }
    });

  return (
    <Dialog open={!!resena} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-3 overflow-hidden p-4 sm:p-6" data-testid="dialogo-respuesta">
        <DialogHeader className="shrink-0 space-y-1 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-8 text-base">
            {resena.nombre_cliente}
            <Estrellas valor={resena.valoracion} />
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span>{format(new Date(resena.fecha), "d MMMM yyyy", { locale: es })}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${TONO_ESTADO[estado]}`}>{ETIQUETA_ESTADO[estado]}</span>
            {resena.respuesta_automatica && <span className="rounded-full bg-muted px-2 py-0.5">automática</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5">
          <blockquote className="whitespace-pre-line border-l-2 border-border pl-3 text-sm text-muted-foreground">
            {resena.comentario?.trim() || <em>Reseña sin texto, solo estrellas.</em>}
          </blockquote>

          {estado === "error" && resena.respuesta_error && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {resena.respuesta_error}
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="resena-respuesta">{publicada ? "Respuesta publicada" : "Respuesta"}</Label>
              <span className={`text-xs ${largo > MAX_RESPUESTA ? "text-red-600" : "text-muted-foreground"}`}>{largo} / {MAX_RESPUESTA}</span>
            </div>
            <Textarea
              id="resena-respuesta"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={7}
              placeholder="Pide una propuesta a la IA o escribe la respuesta."
              className="min-h-[9rem] text-base md:text-sm"
              data-testid="resena-texto"
            />
            {resena.respuesta_origen === "ia" && sinCambios && texto && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Propuesta de la IA{resena.respuesta_modelo ? ` (${resena.respuesta_modelo})` : ""}: revísala antes de aprobar.
              </p>
            )}
            {avisos.length > 0 && (
              <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                {avisos.map((a) => <li key={a}>• {a}</li>)}
              </ul>
            )}
          </div>

          {!publicada && (
            <div className="space-y-1.5">
              <Label htmlFor="resena-indicacion" className="text-xs text-muted-foreground">Indicación para la IA (opcional)</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="resena-indicacion"
                  value={indicacion}
                  maxLength={500}
                  onChange={(e) => setIndicacion(e.target.value)}
                  placeholder="p. ej. más corta, menciona que el chef es Tomás…"
                  className="h-11 min-w-[12rem] flex-1 text-base md:text-sm"
                />
                <Button variant="outline" className="h-11 gap-2" onClick={proponer} disabled={!!ocupado}>
                  <Sparkles className={`h-4 w-4 ${ocupado === "proponer" ? "animate-pulse" : ""}`} />
                  {texto ? "Otra propuesta" : "Proponer respuesta"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <div className="flex flex-wrap gap-1">
            {!publicada && (resena.respuesta_propuesta || texto) && (
              <Button variant="ghost" className="h-11 gap-1.5 px-3 text-muted-foreground" disabled={!!ocupado}
                onClick={() => accion("descartar", { accion: "descartar", id: resena.id }, () => { toast.success("Borrador descartado"); onClose(); })}>
                <Trash2 className="h-4 w-4" /> Descartar
              </Button>
            )}
            {!publicada && !sinCambios && texto.trim() && (
              <Button variant="ghost" className="h-11 gap-1.5 px-3" disabled={!!ocupado}
                onClick={() => accion("guardar", { accion: "guardar", id: resena.id, texto }, () => toast.success("Borrador guardado"))}>
                <RotateCcw className="h-4 w-4" /> Guardar
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {texto.trim() && enlace && (
              <Button variant="outline" className="h-11 gap-2" onClick={copiarYAbrir} data-testid="resena-copiar-abrir">
                <Copy className="h-4 w-4" /> Copiar y abrir en Google <ExternalLink className="h-3.5 w-3.5 opacity-60" />
              </Button>
            )}
            {/* Aprobada sin publicar (sin Business Profile): tras pegarla en Google, se marca como respondida. */}
            {estado === "aprobada" && sinCambios && !(googleConectado && resena.gbp_review_name) ? (
              <Button className="h-11 gap-2" disabled={!!ocupado || !texto.trim()}
                onClick={() => accion("marcar", { accion: "marcar_respondida", id: resena.id, texto }, () => { toast.success("Marcada como respondida"); onClose(); })}>
                <Check className="h-4 w-4" /> Ya la he respondido
              </Button>
            ) : !publicada ? (
              <Button className="h-11 gap-2" disabled={!!ocupado || !texto.trim() || largo > MAX_RESPUESTA} onClick={aprobar} data-testid="resena-aprobar">
                <Send className="h-4 w-4" />
                {googleConectado && resena.gbp_review_name ? "Aprobar y publicar" : "Aprobar"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
