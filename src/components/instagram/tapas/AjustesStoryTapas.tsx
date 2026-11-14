/**
 * RRSS › Instagram › Ajustes: «Story automática del jueves de tapas»
 * (12/11/2026): interruptor (activada por defecto), hora (12:00 de Madrid),
 * plantilla (la de siempre o la mejorada), foto de fondo por defecto (de la
 * biblioteca: Drive, carta o subida) y cómo está la de esta semana.
 */
import { useEffect, useId, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BibliotecaFotos } from "@/components/instagram/crear/BibliotecaFotos";
import { MiniaturaFoto } from "@/components/instagram/MiniaturaFoto";
import { textoInstante } from "@/components/instagram/programar/logica";
import { FOTOS, baseFotosPublica, urlRecurso } from "@/lib/instagram";
import { FOTO_TAPAS_POR_DEFECTO, hoyEnMadrid, semanaDe, type PlantillaTapas } from "@/lib/instagram/tapas";
import { DialogoVerStoryTapas } from "./AvisoStoryTapas";
import { useAjustesStoryTapas, useStoryTapasSemana } from "./useStoryTapas";

const BASE_FOTOS = baseFotosPublica(import.meta.env.VITE_SUPABASE_URL ?? "");

const ESTADO: Record<string, string> = {
  preparando: "preparándose",
  programada: "programada",
  publicada: "publicada",
  cancelada: "cancelada",
  error: "con error",
};

function FotoElegida({ id }: { id: string }) {
  const estatica = FOTOS.find((f) => f.id === id);
  if (estatica) return <img src={urlRecurso(BASE_FOTOS, estatica.ruta)} alt="" className="h-full w-full object-cover" />;
  return <MiniaturaFoto marca="casa-tomas" foto={id} className="h-full w-full" />;
}

export function AjustesStoryTapas() {
  const idActiva = useId();
  const idHora = useId();
  const { ajustes, cargando, guardar } = useAjustesStoryTapas();
  const semana = semanaDe(hoyEnMadrid());
  const { data: estaSemana } = useStoryTapasSemana(ajustes ? semana : null);
  const [hora, setHora] = useState("12:00");
  const [eligiendo, setEligiendo] = useState(false);
  const [viendo, setViendo] = useState(false);
  useEffect(() => {
    if (ajustes) setHora(ajustes.hora);
  }, [ajustes]);

  const cambiar = (c: Parameters<typeof guardar.mutate>[0], ok = "Guardado") =>
    guardar.mutate(c, { onSuccess: () => toast.success(ok), onError: (e) => toast.error((e as Error).message) });

  if (cargando) return <Card><CardContent className="p-4 text-sm text-muted-foreground">Cargando…</CardContent></Card>;
  if (!ajustes) {
    return (
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">Story automática del jueves de tapas</CardTitle>
          <CardDescription>No se pueden leer los ajustes: falta aplicar la actualización de la base de datos o permiso de Marketing.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const foto = ajustes.foto ?? FOTO_TAPAS_POR_DEFECTO;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">Story automática del jueves de tapas</CardTitle>
        <CardDescription>
          Al guardar las tapas de la semana en Gestión web (con «Tapas» activo en la web) se crea la story y se programa para ese día. Si cambian las tapas antes de salir, se rehace sola. Nunca sale dos veces la misma semana.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor={idActiva} className="cursor-pointer">Story automática del jueves de tapas</Label>
          <Switch id={idActiva} checked={ajustes.activa} disabled={guardar.isPending} onCheckedChange={(activa) => cambiar({ activa }, activa ? "Activada" : "Desactivada")} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={idHora}>Hora de publicación</Label>
            <Input id={idHora} type="time" step={300} className="h-11 w-36" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
          <Button type="button" variant="outline" className="h-11" disabled={guardar.isPending || !hora || hora === ajustes.hora} onClick={() => cambiar({ hora })}>
            {guardar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar hora
          </Button>
          <p className="w-full text-xs text-muted-foreground">Hora de España, el día de las tapas. Si ya ha pasado cuando se guardan, sale a los 15 minutos.</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Plantilla</p>
          <ToggleGroup
            type="single"
            variant="outline"
            className="justify-start"
            value={ajustes.plantilla}
            onValueChange={(v) => v && v !== ajustes.plantilla && cambiar({ plantilla: v as PlantillaTapas })}
          >
            <ToggleGroupItem value="ct-tapas" className="h-11 px-3">Mejorada</ToggleGroupItem>
            <ToggleGroupItem value="ct-tapas-clasica" className="h-11 px-3">La de siempre</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-24 w-[54px] shrink-0 overflow-hidden rounded border bg-muted">
            <FotoElegida id={foto} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium">Foto de fondo</p>
            <p className="text-xs text-muted-foreground">{ajustes.foto ? "Elegida de la biblioteca." : "La del salón (por defecto)."} Sale oscurecida y desenfocada.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-11" onClick={() => setEligiendo(true)}>
                <ImageIcon className="mr-2 h-4 w-4" /> Elegir foto
              </Button>
              {ajustes.foto && (
                <Button type="button" variant="ghost" className="h-11" onClick={() => cambiar({ foto: null }, "Vuelve la foto del salón")}>
                  Usar la de siempre
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-md border p-3 text-sm">
          {estaSemana ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Esta semana: <strong>{ESTADO[estaSemana.estado] ?? estaSemana.estado}</strong>
                {estaSemana.estado === "programada" && estaSemana.programada_para ? ` · ${textoInstante(estaSemana.programada_para)}` : ""}
              </span>
              {estaSemana.pieza_id && (
                <Button type="button" variant="ghost" className="h-11" onClick={() => setViendo(true)}>Ver</Button>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">Esta semana todavía no hay story de tapas.</span>
          )}
        </div>
      </CardContent>

      <Dialog open={eligiendo} onOpenChange={setEligiendo}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle>Foto de fondo de la story de tapas</DialogTitle>
            <DialogDescription>De Drive, de la carta o súbela. Se usará en las próximas stories.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <BibliotecaFotos
              marca="casa-tomas"
              formato="story"
              elegidas={ajustes.foto ? [ajustes.foto] : []}
              onAlternar={(id) => {
                setEligiendo(false);
                cambiar({ foto: id }, "Foto de fondo guardada");
              }}
              onSubida={(id) => {
                setEligiendo(false);
                cambiar({ foto: id }, "Foto de fondo guardada");
              }}
              baseFotos={BASE_FOTOS}
            />
          </div>
        </DialogContent>
      </Dialog>
      {viendo && estaSemana?.pieza_id && (
        <DialogoVerStoryTapas datos={{ semana, piezaId: estaSemana.pieza_id, programacionId: estaSemana.programacion_id }} open={viendo} onOpenChange={setViendo} />
      )}
    </Card>
  );
}
