import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGuardarPlantillaNewsletter } from "@/hooks/useNewsletterPlantillas";
import type { DisenoNewsletter, PlantillaGuardada } from "@/lib/newsletter/diseno";

interface Props {
  abierto: boolean;
  onAbiertoChange: (v: boolean) => void;
  diseno: DisenoNewsletter;
  origen: "manual" | "ia";
  onGuardada: (p: PlantillaGuardada) => void;
}

/** «Guardar como plantilla»: guarda el diseño actual (no lo envía) para reutilizarlo. */
export function DialogoGuardarPlantilla({ abierto, onAbiertoChange, diseno, origen, onGuardada }: Props) {
  const [nombre, setNombre] = useState("");
  const { mutate, isPending } = useGuardarPlantillaNewsletter();
  useEffect(() => {
    if (abierto) setNombre(diseno.titulo.slice(0, 80));
  }, [abierto, diseno.titulo]);

  const guardar = () => {
    if (!nombre.trim()) return;
    mutate({ nombre, diseno, origen }, {
      onSuccess: (p) => {
        onGuardada(p);
        onAbiertoChange(false);
      },
    });
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !isPending && onAbiertoChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Guardar como plantilla</DialogTitle>
          <DialogDescription>Aparecerá en «Tus plantillas» para usarla otra vez. Guardar no envía nada.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
        >
          <Label htmlFor="nombre-plantilla">Nombre de la plantilla</Label>
          <Input id="nombre-plantilla" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} className="h-11 text-base md:text-sm" autoFocus />
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={() => onAbiertoChange(false)} disabled={isPending}>Cancelar</Button>
          <Button className="h-11" onClick={guardar} disabled={!nombre.trim() || isPending}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar plantilla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
