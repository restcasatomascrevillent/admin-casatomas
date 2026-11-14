/**
 * Botones del aviso «Story del jueves de tapas programada» en la campana
 * (12/11/2026): «Ver» (la story generada y su estado), «Publicar ahora»,
 * «Cambiar hora» (el diálogo de programar de siempre) y «Cancelar». Los datos
 * vienen en notificaciones_dashboard.datos (semana, piezaId, programacionId),
 * que escribe instagram_story_tapas_registrar.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Eye, Loader2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { ProgramarPiezaDialog } from "@/components/instagram/programar/ProgramarPiezaDialog";
import { CLAVE_PROGRAMACION } from "@/components/instagram/programar/useProgramacionInstagram";
import { textoInstante } from "@/components/instagram/programar/logica";
import { baseFotosPublica, urlRecurso } from "@/lib/instagram";
import { CLAVE_STORY_TAPAS, DEPS_STORY_TAPAS } from "./api";
import { avisarResultado } from "./automatico";
import { publicarAhoraAviso } from "./storyTapas";
import { useCancelarStoryTapas, useStoryTapasSemana } from "./useStoryTapas";

const BASE_FOTOS = baseFotosPublica(import.meta.env.VITE_SUPABASE_URL ?? "");

export const TIPO_AVISO_STORY_TAPAS = "instagram_story_tapas";

export interface DatosAvisoStoryTapas {
  semana: string;
  piezaId: string;
  programacionId: string | null;
}

/** Datos del aviso, o null si no es de la story de tapas o le falta algo. */
export function datosAvisoStoryTapas(n: { tipo?: string | null; datos?: Record<string, unknown> | null }): DatosAvisoStoryTapas | null {
  if (n.tipo !== TIPO_AVISO_STORY_TAPAS || !n.datos) return null;
  const { semana, piezaId, programacionId } = n.datos as Record<string, unknown>;
  if (typeof semana !== "string" || typeof piezaId !== "string") return null;
  return { semana, piezaId, programacionId: typeof programacionId === "string" ? programacionId : null };
}

const ESTADO_TEXTO: Record<string, string> = {
  preparando: "Preparándose",
  programada: "Programada",
  publicada: "Publicada",
  cancelada: "Cancelada",
  error: "Con error",
};

/** Fila de botones pequeños para el aviso (dentro de la campana). */
export function AccionesAvisoStoryTapas({ datos, onAntes }: { datos: DatosAvisoStoryTapas; onAntes?: () => void }) {
  const qc = useQueryClient();
  const { data: fila, refetch } = useStoryTapasSemana(datos.semana);
  const cancelar = useCancelarStoryTapas();
  const [viendo, setViendo] = useState(false);
  const [cambiandoHora, setCambiandoHora] = useState(false);
  const [confirmarPublicar, setConfirmarPublicar] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const programacionId = fila?.programacion_id ?? datos.programacionId;
  const vivo = !fila || fila.estado === "programada" || fila.estado === "error";

  const publicarYa = async () => {
    setPublicando(true);
    const r = await publicarAhoraAviso({ piezaId: fila?.pieza_id ?? datos.piezaId, programacionId: fila?.estado === "programada" ? programacionId : null }, DEPS_STORY_TAPAS);
    setPublicando(false);
    setConfirmarPublicar(false);
    avisarResultado(r, false);
    void qc.invalidateQueries({ queryKey: CLAVE_STORY_TAPAS });
    void qc.invalidateQueries({ queryKey: CLAVE_PROGRAMACION });
  };

  const parar = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="flex flex-wrap gap-1 px-3 pb-2 pl-10" onClick={parar}>
      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => setViendo(true)}>
        <Eye className="mr-1 h-3.5 w-3.5" /> Ver
      </Button>
      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={!vivo || publicando} onClick={() => setConfirmarPublicar(true)}>
        {publicando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />} Publicar ahora
      </Button>
      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={!vivo || !programacionId} onClick={() => setCambiandoHora(true)}>
        <CalendarClock className="mr-1 h-3.5 w-3.5" /> Cambiar hora
      </Button>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-destructive" disabled={!vivo || cancelar.isPending} onClick={() => setConfirmarCancelar(true)}>
        <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
      </Button>

      {viendo && <DialogoVerStoryTapas datos={datos} open={viendo} onOpenChange={setViendo} />}
      <ProgramarPiezaDialog
        piezaId={fila?.pieza_id ?? datos.piezaId}
        programacionId={programacionId}
        open={cambiandoHora}
        onOpenChange={setCambiandoHora}
        inicial={fila?.programada_para ?? null}
        onHecho={() => {
          onAntes?.();
          void refetch();
        }}
      />
      <AlertDialog open={confirmarPublicar} onOpenChange={setConfirmarPublicar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar la story de tapas ahora?</AlertDialogTitle>
            <AlertDialogDescription>Sale ya en la cuenta de Instagram de Casa Tomás y se quita de la programación.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publicando}>No</AlertDialogCancel>
            <AlertDialogAction disabled={publicando} onClick={(e) => (e.preventDefault(), void publicarYa())}>
              {publicando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Publicar ahora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmarCancelar} onOpenChange={setConfirmarCancelar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar la story de tapas de esta semana?</AlertDialogTitle>
            <AlertDialogDescription>
              No se publicará y no se volverá a crear sola esta semana. Si cambias de idea, «Crear story de Instagram» en Gestión web › Tapas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                cancelar.mutate(datos.semana, {
                  onSuccess: () => toast.success("Story de tapas cancelada."),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              Cancelar la story
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** «Ver»: la story ya generada (su JPEG) y en qué estado está. */
export function DialogoVerStoryTapas({ datos, open, onOpenChange }: { datos: DatosAvisoStoryTapas; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: fila } = useStoryTapasSemana(open ? datos.semana : null);
  const piezaId = fila?.pieza_id ?? datos.piezaId;
  const { data: pieza } = useQuery({
    queryKey: ["instagram_piezas", "story-tapas", piezaId],
    enabled: open && !!piezaId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados
      const { data } = await (supabase as any).from("instagram_piezas").select("imagen_ruta, estado, permalink, updated_at").eq("id", piezaId).maybeSingle();
      return data as { imagen_ruta: string | null; estado: string; permalink: string | null; updated_at: string } | null;
    },
  });
  const url = pieza?.imagen_ruta ? `${urlRecurso(BASE_FOTOS, pieza.imagen_ruta)}?v=${encodeURIComponent(pieza.updated_at ?? "")}` : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Story del jueves de tapas</DialogTitle>
          <DialogDescription>
            {fila ? ESTADO_TEXTO[fila.estado] ?? fila.estado : "Cargando…"}
            {fila?.estado === "programada" && fila.programada_para ? ` · ${textoInstante(fila.programada_para)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {url ? (
          <img src={url} alt="Story del jueves de tapas" className="mx-auto aspect-[9/16] w-full max-w-[280px] rounded-md border object-cover" />
        ) : (
          <p className="text-sm text-muted-foreground">{pieza && !pieza.imagen_ruta ? "La imagen ya no está en el panel (se guarda en Drive al publicarse)." : "Cargando la imagen…"}</p>
        )}
        {fila?.error && fila.estado === "error" && <p className="text-sm text-destructive">{fila.error}</p>}
        <DialogFooter>
          {pieza?.permalink && (
            <Button asChild variant="outline" className="h-11">
              <a href={pieza.permalink} target="_blank" rel="noopener noreferrer">Ver en Instagram</a>
            </Button>
          )}
          <Button className="h-11" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
