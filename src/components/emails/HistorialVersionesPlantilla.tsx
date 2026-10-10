// ============================================================================
// HistorialVersionesPlantilla — lista las versiones (append-only) de un tipo
// y permite "volver atrás". Restaurar llama a fn_restaurar_version_plantilla
// (vía useRestaurarVersionPlantilla) — nunca se reescribe el historial desde
// aquí, solo se copia contenido hacia una versión nueva, igual que hace esa
// función en la base de datos.
// ============================================================================
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, Loader2, RotateCcw } from "lucide-react";
import { useRestaurarVersionPlantilla, type PlantillaEmailVersion, type TipoPlantilla } from "@/hooks/usePlantillasEmail";

interface HistorialVersionesPlantillaProps {
  tipo: TipoPlantilla;
  versiones: PlantillaEmailVersion[];
  puedeRestaurar: boolean;
}

export function HistorialVersionesPlantilla({ tipo, versiones, puedeRestaurar }: HistorialVersionesPlantillaProps) {
  const [abierto, setAbierto] = useState(false);
  const restaurar = useRestaurarVersionPlantilla(tipo);
  const siguienteVersion = versiones.length > 0 ? Math.max(...versiones.map((v) => v.version)) + 1 : 1;

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="sm" className="h-11 gap-1.5 px-2 text-muted-foreground hover:text-foreground">
          <History className="h-4 w-4" />
          Historial{versiones.length > 0 ? ` (${versiones.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de versiones</DialogTitle>
          <DialogDescription>
            Cada guardado crea una versión nueva; nunca se borra ni se reescribe una anterior. Restaurar copia el
            contenido de esa versión hacia adelante, a una versión nueva, y la activa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {versiones.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay ninguna versión guardada.</p>}

          {versiones.map((v) => (
            <div key={v.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Versión {v.version}</span>
                  {v.es_actual && <Badge>Actual</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(v.creado_at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>

              {v.nota_version && <p className="mt-1 text-xs text-muted-foreground">"{v.nota_version}"</p>}

              <p className="mt-2 truncate text-xs">
                <span className="font-medium text-foreground">Asunto:</span>{" "}
                <span className="text-muted-foreground">{v.asunto}</span>
              </p>

              {!v.es_actual && puedeRestaurar && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="mt-2 h-11 gap-1.5 px-3 text-sm">
                      <RotateCcw className="h-4 w-4" />
                      Restaurar esta versión
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Restaurar la versión {v.version}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se creará la versión {siguienteVersion} con este mismo contenido y pasará a ser la vigente
                        para los próximos correos. La versión {v.version} original, y todas las demás, siguen
                        intactas en el historial — nada se borra.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={restaurar.isPending}
                        onClick={() => {
                          restaurar.mutate(v.version, { onSuccess: () => setAbierto(false) });
                        }}
                      >
                        {restaurar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Restaurar"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="h-11 px-5" onClick={() => setAbierto(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
