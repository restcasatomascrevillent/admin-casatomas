import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { limitesFecha, textoInstante, validarProgramacion, valorInicial } from "./logica";
import { useAccionesProgramacion, useProgramacionDePieza, type Conflicto, type ProgramacionInstagram } from "./useProgramacionInstagram";

export interface ProgramarPiezaDialogProps {
  /** Pieza (instagram_piezas.id). Tiene que estar generada (con JPEG) y sin publicar. */
  piezaId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Programación concreta que se mueve (desde el calendario; también una con
   * error). Sin ella, se crea la programación de la pieza o se mueve la que
   * tenga pendiente.
   */
  programacionId?: string | null;
  /** Instante inicial. Por defecto: el de la programación pendiente o mañana a las 13:00 de Madrid. */
  inicial?: Date | string | null;
  onHecho?: (programacion: ProgramacionInstagram) => void;
  /** Por qué se propone la hora inicial (p. ej. «Según «Qué funciona»…»); se oculta al tocar la fecha. */
  motivoInicial?: string | null;
}

/**
 * Diálogo «Programar publicación»: fecha y hora en Europe/Madrid (sea cual sea
 * la zona del dispositivo). Valida en el navegador (≥ 10 min, ≤ 75 días, hora
 * inexistente por el cambio de hora) y el servidor vuelve a validar. Si en ±30
 * min ya hay otra programada de la misma marca, avisa y pide confirmación.
 */
export function ProgramarPiezaDialog({ piezaId, open, onOpenChange, programacionId, inicial, onHecho, motivoInicial }: ProgramarPiezaDialogProps) {
  const { data: vigente } = useProgramacionDePieza(open && !programacionId ? piezaId : null);
  const { programar } = useAccionesProgramacion();
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [tocado, setTocado] = useState(false);
  const [conflictos, setConflictos] = useState<Conflicto[] | null>(null);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  const pendiente = vigente && vigente.estado === "programada" ? vigente : null;
  const moviendo = Boolean(programacionId || pendiente);
  const publicando = vigente?.estado === "publicando";

  // Valor inicial al abrir (y cuando llega la programación vigente, si no se ha tocado).
  useEffect(() => {
    if (!open) {
      setTocado(false);
      setConflictos(null);
      setErrorServidor(null);
      return;
    }
    if (tocado) return;
    const v = valorInicial(inicial ?? pendiente?.programada_para ?? null);
    setFecha(v.fecha);
    setHora(v.hora);
  }, [open, inicial, pendiente?.programada_para, tocado]);

  const limites = limitesFecha();
  const validacion = validarProgramacion(fecha, hora);
  const enviando = programar.isPending;

  const cambiar = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setTocado(true);
    setConflictos(null);
    setErrorServidor(null);
    f(e.target.value);
  };

  async function enviar(confirmarConflicto: boolean) {
    if (!("instante" in validacion) || (!piezaId && !programacionId)) return;
    setErrorServidor(null);
    try {
      const r = await programar.mutateAsync({ piezaId, programacionId, instante: validacion.instante, confirmarConflicto });
      if (!r.ok) {
        setConflictos(r.conflictos);
        return;
      }
      toast.success(r.accion === "reprogramada" ? "Publicación movida" : "Publicación programada", {
        description: `${textoInstante(r.programacion.programada_para)} (hora de Madrid)`,
      });
      onHecho?.(r.programacion);
      onOpenChange(false);
    } catch (e) {
      setErrorServidor((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !enviando && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
            {moviendo ? "Mover la publicación" : "Programar publicación"}
          </DialogTitle>
          <DialogDescription>
            Se publicará sola en Instagram a esa hora (hora de Madrid), con un margen de hasta 5 minutos.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(false);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="programar-fecha">Día</Label>
              <Input id="programar-fecha" type="date" value={fecha} min={limites.min} max={limites.max} onChange={cambiar(setFecha)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="programar-hora">Hora (Madrid)</Label>
              <Input id="programar-hora" type="time" step={300} value={hora} onChange={cambiar(setHora)} required />
            </div>
          </div>

          {motivoInicial && !tocado && !pendiente && !programacionId && (
            <p className="text-sm text-muted-foreground" data-testid="motivo-hueco">
              {motivoInicial}
            </p>
          )}
          {pendiente && !programacionId && (
            <p className="text-sm text-muted-foreground">Ya estaba programada para el {textoInstante(pendiente.programada_para)}; se moverá.</p>
          )}
          {publicando && <p className="text-sm text-destructive">Se está publicando ahora mismo: espera a que termine.</p>}
          {tocado && "error" in validacion && (
            <p className="text-sm text-destructive" role="alert">
              {validacion.error}
            </p>
          )}
          {errorServidor && (
            <p className="text-sm text-destructive" role="alert">
              {errorServidor}
            </p>
          )}
          {conflictos && conflictos.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Ya hay {conflictos.length === 1 ? "otra publicación" : `${conflictos.length} publicaciones`} de esta marca a menos de 30 minutos:
              </p>
              <ul className="mt-1 list-inside list-disc">
                {conflictos.map((c) => (
                  <li key={c.id}>{textoInstante(c.programadaPara)}</li>
                ))}
              </ul>
              <p className="mt-1">Separarlas suele funcionar mejor. ¿La programas igualmente?</p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
              Cerrar
            </Button>
            {conflictos && conflictos.length > 0 ? (
              <Button type="button" onClick={() => void enviar(true)} disabled={enviando || !validacion.ok}>
                {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Programar igualmente
              </Button>
            ) : (
              <Button type="submit" disabled={enviando || !validacion.ok || publicando || (!piezaId && !programacionId)}>
                {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {moviendo ? "Mover" : "Programar"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
