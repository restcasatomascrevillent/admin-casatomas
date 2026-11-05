import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Clock, ExternalLink, Loader2, RotateCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { limitesFecha, textoInstante, validarProgramacion, valorInicial } from "@/components/instagram/programar/logica";
import type { Progreso, ResultadoPublicacion } from "./publicar";

export type Envio =
  | { tipo: "inactivo" }
  | { tipo: "trabajando"; progreso: Progreso }
  | { tipo: "hecho"; resultado: ResultadoPublicacion }
  | { tipo: "error"; mensaje: string; pasos: string[]; problemas: string[] };

export function textoProgreso(p: Progreso): string {
  if (p.fase === "imagenes") return p.total > 1 ? `Preparando imágenes ${p.hechas}/${p.total}…` : "Preparando la imagen…";
  return p.fase === "publicando" ? "Publicando en Instagram…" : "Programando…";
}

/** 0–100: las imágenes son el 80 %, publicar o programar el resto. */
export function porcentaje(p: Progreso): number {
  if (p.fase === "imagenes") return Math.round((p.hechas / Math.max(1, p.total)) * 80);
  return 90;
}

interface Props {
  /** Por qué no se puede publicar todavía (null = se puede). */
  motivo: string | null;
  horaSugerida: string | null;
  /** Texto corto de lo que se va a publicar: «carrusel de 6 imágenes». */
  queSePublica: string;
  /** Marca en llano, para la confirmación. */
  nombreMarca: string;
  envio: Envio;
  onPublicar: () => void;
  onProgramar: (instante: Date) => void;
  onReintentar: () => void;
  onConfirmarConflicto: () => void;
  onOtra: () => void;
  onVerCalendario?: () => void;
}

/**
 * Pie fijo de «Así quedará»: «Publicar ahora» y «Programar» (con la hora
 * sugerida ya puesta), el progreso y el resultado.
 */
export function PieAcciones({
  motivo,
  horaSugerida,
  queSePublica,
  nombreMarca,
  envio,
  onPublicar,
  onProgramar,
  onReintentar,
  onConfirmarConflicto,
  onOtra,
  onVerCalendario,
}: Props) {
  const [cuando, setCuando] = useState(() => valorInicial(horaSugerida));
  const [cambiar, setCambiar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  useEffect(() => setCuando(valorInicial(horaSugerida)), [horaSugerida]);
  const validacion = validarProgramacion(cuando.fecha, cuando.hora);
  const limites = limitesFecha();
  const trabajando = envio.tipo === "trabajando";
  const bloqueado = !!motivo || trabajando;

  if (envio.tipo === "hecho" && (envio.resultado.estado === "publicada" || envio.resultado.estado === "programada")) {
    const r = envio.resultado;
    return (
      <div role="status" className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="resultado-publicacion">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
          {r.estado === "publicada" ? "Publicada en Instagram." : `Programada para el ${textoInstante(r.programadaPara ?? new Date())}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {r.estado === "publicada" && r.permalink && (
            <Button asChild variant="outline" className="min-h-11 bg-white">
              <a href={r.permalink} target="_blank" rel="noreferrer">
                Ver la publicación
                <ExternalLink className="ml-1 h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
          )}
          {r.estado === "programada" && onVerCalendario && (
            <Button type="button" variant="outline" className="min-h-11 bg-white" onClick={onVerCalendario}>
              Ver en el calendario
            </Button>
          )}
          <Button type="button" className="min-h-11" onClick={onOtra}>
            Crear otra
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {envio.tipo === "trabajando" && (
        <div role="status" className="space-y-1" data-testid="progreso-publicacion">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {textoProgreso(envio.progreso)}
          </p>
          <Progress value={porcentaje(envio.progreso)} aria-label="Progreso" className="h-2" />
        </div>
      )}

      {envio.tipo === "hecho" && envio.resultado.estado === "en_proceso" && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
          <p>Instagram todavía está procesando las imágenes. Espera unos segundos y vuelve a intentarlo.</p>
          <Button type="button" variant="outline" className="min-h-11 bg-white" onClick={onReintentar}>
            <RotateCw className="mr-1 h-4 w-4" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      )}
      {envio.tipo === "hecho" && envio.resultado.estado === "conflicto" && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
          <p>Ya hay otra publicación de {nombreMarca} a menos de media hora. ¿La programas igualmente?</p>
          <Button type="button" variant="outline" className="min-h-11 bg-white" onClick={onConfirmarConflicto}>
            Programar igualmente
          </Button>
        </div>
      )}
      {envio.tipo === "error" && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
          <p className="font-medium text-destructive">{envio.mensaje}</p>
          {envio.problemas.length > 0 && (
            <ul className="list-disc pl-5 text-destructive">
              {envio.problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {envio.pasos.length > 0 && <p className="text-muted-foreground">Cómo arreglarlo: {envio.pasos.join(" ")}</p>}
        </div>
      )}

      {!trabajando && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {horaSugerida ? "Hora sugerida: " : "Programar para: "}
            <b data-testid="hora-programar">{"instante" in validacion ? textoInstante(validacion.instante) : `${cuando.fecha} ${cuando.hora}`}</b>
          </span>
          <Popover open={cambiar} onOpenChange={setCambiar}>
            <PopoverTrigger asChild>
              <Button type="button" variant="link" className="h-auto min-h-11 px-1 py-0">
                Cambiar
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="crear-fecha">Día</Label>
                  <Input id="crear-fecha" type="date" min={limites.min} max={limites.max} value={cuando.fecha} onChange={(e) => setCuando((c) => ({ ...c, fecha: e.target.value }))} className="min-h-11" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="crear-hora">Hora</Label>
                  <Input id="crear-hora" type="time" step={300} value={cuando.hora} onChange={(e) => setCuando((c) => ({ ...c, hora: e.target.value }))} className="min-h-11" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Hora de España peninsular.</p>
              <Button type="button" className="min-h-11 w-full" onClick={() => setCambiar(false)}>
                Listo
              </Button>
            </PopoverContent>
          </Popover>
          {"error" in validacion && <span className="w-full text-xs text-destructive">{validacion.error}</span>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" className="min-h-11" disabled={bloqueado} onClick={() => setConfirmar(true)}>
          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
          Publicar ahora
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={bloqueado || !validacion.ok}
          onClick={() => "instante" in validacion && onProgramar(validacion.instante)}
        >
          <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />
          Programar
        </Button>
      </div>
      {motivo && !trabajando && (
        <p className="text-xs text-muted-foreground" data-testid="motivo-no-publicar">
          {motivo}
        </p>
      )}

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar ahora en Instagram?</AlertDialogTitle>
            <AlertDialogDescription>
              Se publicará ya en la cuenta de {nombreMarca} ({queSePublica}). No se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                setConfirmar(false);
                onPublicar();
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
