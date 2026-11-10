import { useState } from "react";
import { Archive, CheckCircle2, Download, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { EstadoProyecto, Proyecto, Resultado } from "@/components/rrss/api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { descargarResultado } from "./descargas";

interface Props {
  proyecto: Proyecto;
  resultados: Resultado[];
  onEstado: (e: EstadoProyecto, mensaje: string) => Promise<void>;
  onBorrar: () => Promise<void>;
}

export function AccionesTrabajo({ proyecto, resultados, onEstado, onBorrar }: Props) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);

  async function ejecutar(clave: string, f: () => Promise<void>) {
    setOcupado(clave);
    try {
      await f();
    } finally {
      setOcupado(null);
    }
  }

  async function descargarTodo() {
    for (const r of resultados) {
      await descargarResultado(proyecto, r);
      await new Promise((ok) => setTimeout(ok, 350));
    }
    toast.success(resultados.length === 1 ? "Descargado 1 archivo" : `Descargados ${resultados.length} archivos`);
  }

  return (
    <section aria-labelledby="acciones-trabajo" className="space-y-3 rounded-lg border p-3">
      <h3 id="acciones-trabajo" className="text-sm font-semibold">
        Este trabajo
      </h3>
      <p className="rounded-md bg-muted/50 p-2 text-sm" data-testid="nota-no-publica">
        Nada se publica solo: descarga o copia el contenido para publicarlo.
        {proyecto.canal === "instagram" && <span className="block text-xs text-muted-foreground">En Instagram también puedes publicarlo desde RRSS › Instagram › Crear, subiendo las imágenes.</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="gap-2" disabled={resultados.length === 0 || ocupado !== null} onClick={() => void ejecutar("descargar", descargarTodo)}>
          {ocupado === "descargar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          Descargar todo
        </Button>
        <Button type="button" variant="outline" className="gap-2" disabled={ocupado !== null} onClick={() => void ejecutar("borrador", () => onEstado("borrador", "Borrador guardado"))}>
          <Save className="h-4 w-4" aria-hidden="true" /> Guardar borrador
        </Button>
        <Button type="button" className="gap-2" disabled={ocupado !== null || proyecto.estado === "listo"} onClick={() => void ejecutar("listo", () => onEstado("listo", "Trabajo marcado como listo"))}>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Marcar como listo
        </Button>
        <Button type="button" variant="outline" className="gap-2" disabled={ocupado !== null} onClick={() => void ejecutar("archivar", () => onEstado("archivado", "Trabajo archivado"))}>
          <Archive className="h-4 w-4" aria-hidden="true" /> Archivar
        </Button>
        <Button type="button" variant="outline" className="gap-2 text-destructive hover:text-destructive" disabled={ocupado !== null} onClick={() => setConfirmarBorrar(true)}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Borrar trabajo
        </Button>
      </div>

      <AlertDialog open={confirmarBorrar} onOpenChange={(o) => ocupado === null && setConfirmarBorrar(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar este trabajo?</AlertDialogTitle>
            <AlertDialogDescription>Se borran el trabajo, los originales, las piezas generadas y los textos. No se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado !== null}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupado !== null}
              onClick={(e) => {
                e.preventDefault();
                void ejecutar("borrar", async () => {
                  await onBorrar();
                  setConfirmarBorrar(false);
                });
              }}
            >
              Borrar trabajo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
