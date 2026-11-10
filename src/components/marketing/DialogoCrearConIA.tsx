import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrearNewsletterIA, type RespuestaIA, type TonoIA } from "@/hooks/useNewsletterPlantillas";
import { useGaleriaImagenes } from "./SelectorImagenGaleria";
import { PLANTILLAS_BASE, type DisenoNewsletter, type TipoNewsletter } from "@/lib/newsletter/diseno";

const TONOS: { valor: TonoIA; nombre: string }[] = [
  { valor: "cercano", nombre: "Cercano" },
  { valor: "elegante", nombre: "Elegante" },
  { valor: "festivo", nombre: "Festivo" },
  { valor: "informativo", nombre: "Informativo" },
];

const LIMITE = 1500;

interface Props {
  abierto: boolean;
  onAbiertoChange: (v: boolean) => void;
  /** Diseño que hay ahora en el editor (para «mejorar el correo actual»). */
  actual: DisenoNewsletter | null;
  onPropuesta: (r: RespuestaIA) => void;
}

/**
 * «Crear con IA»: el usuario describe lo que quiere y la IA (Edge Function
 * newsletter-ia, con la clave del servidor) redacta el texto y propone la
 * presentación con los bloques de las plantillas. La propuesta se carga en el
 * editor para revisarla: aquí no se envía ni se guarda nada.
 */
export function DialogoCrearConIA({ abierto, onAbiertoChange, actual, onPropuesta }: Props) {
  const [descripcion, setDescripcion] = useState("");
  const [tipo, setTipo] = useState<TipoNewsletter | "auto">("auto");
  const [tono, setTono] = useState<TonoIA>("cercano");
  const [mejorar, setMejorar] = useState(false);
  const [conFotos, setConFotos] = useState(true);
  const { data: galeria } = useGaleriaImagenes();
  const { mutate, isPending } = useCrearNewsletterIA();

  const valido = descripcion.trim().length >= 10 && descripcion.length <= LIMITE;

  const redactar = () => {
    if (!valido) return;
    mutate(
      {
        descripcion: descripcion.trim(),
        tipo: tipo === "auto" ? null : tipo,
        tono,
        imagenes: conFotos ? (galeria ?? []).slice(0, 24) : [],
        base: mejorar && actual ? actual : null,
      },
      {
        onSuccess: (r) => {
          onPropuesta(r);
          onAbiertoChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !isPending && onAbiertoChange(v)}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
            Crear con IA
          </DialogTitle>
          <DialogDescription>
            Cuenta qué quieres comunicar. La IA redacta el correo y elige su presentación; después lo revisas y lo cambias a tu gusto.
            No se envía nada sin tu confirmación.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ia-descripcion">¿Qué quieres contar?</Label>
            <Textarea
              id="ia-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value.slice(0, LIMITE))}
              rows={5}
              className="text-base md:text-sm"
              placeholder="Ej.: Cena de San Valentín el sábado 14 de febrero a las 21:00. Menú de gamba roja, arroz de bogavante y coulant, 55 € por persona. Plazas limitadas."
              aria-describedby="ia-descripcion-ayuda"
            />
            <p id="ia-descripcion-ayuda" className="text-xs text-muted-foreground">
              Pon los datos concretos (fechas, precios, platos): la IA no se los inventa y deja huecos [entre corchetes] si faltan. {descripcion.length}/{LIMITE}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ia-plantilla">Plantilla</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoNewsletter | "auto")}>
                <SelectTrigger id="ia-plantilla" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Que la elija la IA</SelectItem>
                  {PLANTILLAS_BASE.filter((p) => p.tipo !== "personalizada").map((p) => (
                    <SelectItem key={p.tipo} value={p.tipo}>{p.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ia-tono">Tono</Label>
              <Select value={tono} onValueChange={(v) => setTono(v as TonoIA)}>
                <SelectTrigger id="ia-tono" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONOS.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>{t.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <Checkbox checked={conFotos} onCheckedChange={(v) => setConFotos(v === true)} className="mt-0.5" />
              <span>Puede usar fotos de la galería de la carta{galeria?.length ? ` (${galeria.length})` : ""}</span>
            </label>
            {actual && (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                <Checkbox checked={mejorar} onCheckedChange={(v) => setMejorar(v === true)} className="mt-0.5" />
                <span>Partir del correo que tengo ahora («{actual.titulo || "sin asunto"}») en vez de empezar de cero</span>
              </label>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={() => onAbiertoChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button className="h-11" onClick={redactar} disabled={!valido || isPending}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {isPending ? "Redactando…" : "Redactar con IA"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
