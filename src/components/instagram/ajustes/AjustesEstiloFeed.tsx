/**
 * RRSS › Instagram › Ajustes: «Estilo del feed» (12/11/2026). Cómo monta la
 * IA los posts y carruseles: «Solo foto» (por defecto, como el feed de la
 * cuenta: la foto limpia y el texto en el pie) o «Con rótulos» (titular y
 * rótulos encima). Las stories llevan siempre rótulos.
 */
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EstiloFeed } from "@/lib/instagram/montar";
import { NOMBRE_ESTILO_FEED, useEstiloFeed } from "./estiloFeed";

const EXPLICACION: Record<EstiloFeed, string> = {
  solo_foto: "La foto limpia, sin texto encima, como lo que publicáis ahora. El nombre del plato y el gancho van en el texto de la publicación.",
  rotulos: "Portada con titular, imágenes del medio con el nombre del plato y cierre con el lema y el botón.",
};

export function AjustesEstiloFeed() {
  const { estilo, cargando, guardar } = useEstiloFeed();
  const cambiar = (v: string) => {
    if (!v || v === estilo) return;
    guardar.mutate(v as EstiloFeed, {
      onSuccess: () => toast.success(`Estilo del feed: ${NOMBRE_ESTILO_FEED[v as EstiloFeed]}`),
      onError: (e) => toast.error((e as Error).message),
    });
  };
  return (
    <Card data-testid="ajustes-estilo-feed">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">Estilo del feed</CardTitle>
        <CardDescription>Cómo monta la IA los posts y carruseles. Las stories llevan siempre rótulos; y en «Ajustar a mano» se puede elegir cualquier plantilla.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        <ToggleGroup type="single" variant="outline" className="justify-start" value={estilo} onValueChange={cambiar} disabled={cargando || guardar.isPending} aria-label="Estilo del feed">
          <ToggleGroupItem value="solo_foto" className="h-11 px-3">
            Solo foto (como ahora)
          </ToggleGroupItem>
          <ToggleGroupItem value="rotulos" className="h-11 px-3">
            {NOMBRE_ESTILO_FEED.rotulos}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{EXPLICACION[estilo]}</p>
      </CardContent>
    </Card>
  );
}
