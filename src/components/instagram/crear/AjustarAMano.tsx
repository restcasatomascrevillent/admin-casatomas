import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { cn } from "@/lib/utils";
import { EncuadreFoto } from "@/components/instagram/EncuadreFoto";
import { MARCAS_IDS, obtenerPlantilla, type MarcaId } from "@/lib/instagram";
import { AYUDA_CAMPO, NOMBRE_CAMPO } from "@/components/marketing/instagram/pieza";
import { NOMBRE_MARCA_CORTO } from "@/components/marketing/instagram/HistorialPiezas";
import { MAX_ALT_TEXT, contarCaracteres } from "@/components/marketing/instagram/contadores";
import {
  CAMPOS_ROTULO,
  ajusteDe,
  formatoEfectivo,
  formatoImagen,
  plantillasConFoto,
  type AjusteImagen,
  type CampoRotulo,
  type EstadoCrear,
} from "./estado";

interface Props {
  estado: EstadoCrear;
  abierto: boolean;
  onAbierto: (v: boolean) => void;
  /** Imagen que se está retocando (la misma que se ve en la vista previa). */
  actual: number;
  onActual: (i: number) => void;
  onMarca: (m: MarcaId) => void;
  onFormatoUnaFoto: (f: "post" | "story") => void;
  onAjuste: (foto: string, cambio: Partial<AjusteImagen>) => void;
  /** URL de la foto (la copia preparada) para encuadrar «Solo foto»; undefined mientras se prepara. */
  urlFoto?: (foto: string) => string | undefined;
}

/**
 * «Ajustar a mano», plegado: marca, formato y, por imagen, plantilla, rótulos
 * y texto alternativo. Para quien quiera retocar lo que ha montado la IA.
 */
export function AjustarAMano({ estado, abierto, onAbierto, actual, onActual, onMarca, onFormatoUnaFoto, onAjuste, urlFoto }: Props) {
  const formato = formatoEfectivo(estado);
  const formatoPieza = formatoImagen(formato);
  const n = estado.fotos.length;
  const indice = Math.min(actual, Math.max(0, n - 1));
  const foto = estado.fotos[indice];
  const ajuste = foto ? ajusteDe(estado, foto) : null;
  const plantilla = ajuste ? obtenerPlantilla(ajuste.plantilla) : undefined;
  const campos = CAMPOS_ROTULO.filter((c) => plantilla?.admitidos.includes(c));
  const opcionesPlantilla = plantillasConFoto(estado.marca, formatoPieza, ajuste?.plantilla);

  return (
    <Collapsible open={abierto} onOpenChange={onAbierto} className="rounded-md border">
      <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Ajustar a mano
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", abierto && "rotate-180")} aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-3 pb-3 pt-3" data-testid="ajustar-a-mano">
        <div className="space-y-1">
          <Label id="crear-marca">Marca</Label>
          <SelectorSubrayado
            aria-labelledby="crear-marca"
            valor={estado.marca}
            onCambio={(v) => onMarca(v as MarcaId)}
            opciones={MARCAS_IDS.map((m) => ({ valor: m, etiqueta: NOMBRE_MARCA_CORTO[m] }))}
          />
          {n > 0 && <p className="text-xs text-muted-foreground">Al cambiar de marca se quitan las fotos elegidas.</p>}
        </div>

        <div className="space-y-1">
          <Label id="crear-formato">Formato</Label>
          {n > 1 ? (
            <p className="text-sm">Carrusel de {n} imágenes (con varias fotos siempre es carrusel).</p>
          ) : (
            <SelectorSubrayado
              aria-labelledby="crear-formato"
              valor={estado.formatoUnaFoto}
              onCambio={(v) => onFormatoUnaFoto(v as "post" | "story")}
              opciones={[
                { valor: "post", etiqueta: "Post" },
                { valor: "story", etiqueta: "Story" },
              ]}
            />
          )}
        </div>

        {!foto || !ajuste ? (
          <p className="text-sm text-muted-foreground">Elige una foto para retocar su plantilla y sus rótulos.</p>
        ) : (
          <fieldset className="space-y-3">
            <legend className="sr-only">Imagen {indice + 1}</legend>
            {n > 1 && (
              <div role="group" aria-label="Qué imagen retocar" className="flex flex-wrap gap-1">
                {estado.fotos.map((f, i) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={i === indice}
                    onClick={() => onActual(i)}
                    className={cn(
                      "h-9 min-w-9 rounded-md border px-2 text-sm pointer-coarse:h-11 pointer-coarse:min-w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      i === indice ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted",
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
            <p className="text-sm font-medium">{n > 1 ? `Imagen ${indice + 1} de ${n}` : "La imagen"}</p>

            <div className="space-y-1">
              <Label htmlFor="crear-plantilla">Plantilla</Label>
              <Select value={ajuste.plantilla} onValueChange={(v) => onAjuste(foto, { plantilla: v })}>
                <SelectTrigger id="crear-plantilla" className="pointer-coarse:min-h-11">
                  <SelectValue placeholder="Elige una plantilla" />
                </SelectTrigger>
                <SelectContent>
                  {opcionesPlantilla.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.clasica ? `${p.nombre} (clásica)` : p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {plantilla?.sinTexto && (
              <p className="text-xs text-muted-foreground" data-testid="sin-rotulos">
                Esta plantilla va sin texto encima: el nombre del plato y el gancho van en el texto de la publicación.
              </p>
            )}
            {plantilla?.sinTexto &&
              (urlFoto?.(foto) ? (
                <EncuadreFoto
                  key={foto}
                  src={urlFoto(foto)!}
                  valor={ajuste.encuadre ?? { x: 50, y: 50 }}
                  onCambio={(encuadre) => onAjuste(foto, { encuadre })}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Preparando la foto para encuadrarla…</p>
              ))}

            {campos.map((c) => (
              <CampoRotuloInput key={`${foto}-${c}`} campo={c} valor={ajuste.datos[c] ?? ""} limite={plantilla?.limites?.[c]} onCambio={(v) => onAjuste(foto, { datos: { [c]: v } })} />
            ))}

            {formato !== "story" && (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="crear-alt">Texto alternativo</Label>
                  <span className={cn("text-xs tabular-nums text-muted-foreground", contarCaracteres(ajuste.altText) > MAX_ALT_TEXT && "font-medium text-destructive")}>
                    {contarCaracteres(ajuste.altText)}/{MAX_ALT_TEXT}
                  </span>
                </div>
                <Textarea
                  id="crear-alt"
                  rows={2}
                  value={ajuste.altText}
                  onChange={(e) => onAjuste(foto, { altText: e.target.value })}
                  aria-describedby="crear-alt-ayuda"
                  className="text-sm"
                />
                <p id="crear-alt-ayuda" className="text-xs text-muted-foreground">
                  Lo escribe la IA describiendo la foto. Lo oyen quienes usan lector de pantalla.
                </p>
              </div>
            )}
          </fieldset>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CampoRotuloInput({ campo, valor, limite, onCambio }: { campo: CampoRotulo; valor: string; limite?: number; onCambio: (v: string) => void }) {
  const id = `crear-${campo}`;
  const n = contarCaracteres(valor);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{NOMBRE_CAMPO[campo]}</Label>
        {limite ? <span className={cn("text-xs tabular-nums text-muted-foreground", n > limite && "font-medium text-destructive")}>{n}/{limite}</span> : null}
      </div>
      {campo === "cita" ? (
        <Textarea id={id} rows={2} value={valor} onChange={(e) => onCambio(e.target.value)} aria-describedby={`${id}-ayuda`} className="text-sm" />
      ) : (
        <Input id={id} value={valor} onChange={(e) => onCambio(e.target.value)} aria-describedby={`${id}-ayuda`} className="pointer-coarse:min-h-11" />
      )}
      {AYUDA_CAMPO[campo] && (
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {AYUDA_CAMPO[campo]}
        </p>
      )}
    </div>
  );
}
