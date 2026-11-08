import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { Archivo } from "@/components/rrss/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { MarcaId } from "@/lib/instagram/tokens";
import { ESTILOS, previaCss, sumarTratamientos, type EstiloId } from "@/lib/rrss/estilos";
import { CREATIVOS, LIMITES_TEXTO, MAX_PALABRAS_TITULO, POSICIONES, type Creativo, type PiezaFoto, type PosicionRotulos, type Rotulos } from "@/lib/rrss/plan";
import { Campo, Deslizador, SelectorNativo } from "./Controles";
import { posicionOriginal } from "./util";

const ETIQUETA_POSICION: Record<PosicionRotulos, string> = { auto: "Automática", arriba: "Arriba", centro: "En el centro", abajo: "Abajo" };
const ETIQUETA_CREATIVO: Record<Creativo, string> = { ninguno: "Ninguna", "desenfocar-fondo": "Desenfocar el fondo", "fondo-marca": "Fondo de la marca" };

interface Props {
  pieza: PiezaFoto;
  /** Medidas de la salida. */
  ancho: number;
  alto: number;
  archivo?: Pick<Archivo, "ancho" | "alto">;
  urlOriginal?: string;
  estilo: EstiloId;
  marca: MarcaId;
  permiteCreativo: boolean;
  ocupado: boolean;
  onAplicar: (pieza: PiezaFoto) => void;
  onOtraPropuesta: (indicacion: string) => void;
}

const palabras = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function AjustesFoto({ pieza, ancho, alto, archivo, urlOriginal, estilo, marca, permiteCreativo, ocupado, onAplicar, onOtraPropuesta }: Props) {
  const [p, setP] = useState<PiezaFoto>(pieza);
  const [r, setR] = useState<Required<Pick<Rotulos, "posicion">> & Rotulos>({ posicion: pieza.rotulos?.posicion ?? "auto", antetitulo: pieza.rotulos?.antetitulo ?? "", titulo: pieza.rotulos?.titulo ?? "", subtitulo: pieza.rotulos?.subtitulo ?? "", cta: pieza.rotulos?.cta ?? "" });
  const [indicacion, setIndicacion] = useState("");
  const id = `aj-${pieza.archivo}`;

  const corr = (k: keyof PiezaFoto["correccion"], v: number) => setP((x) => ({ ...x, correccion: { ...x.correccion, [k]: v } }));
  const enc = (k: keyof PiezaFoto["encuadre"], v: number) => setP((x) => ({ ...x, encuadre: { ...x.encuadre, [k]: v } }));
  const rot = (k: "antetitulo" | "titulo" | "subtitulo" | "cta", v: string) => {
    if (k === "titulo" && palabras(v) > MAX_PALABRAS_TITULO) return;
    setR((x) => ({ ...x, [k]: v }));
  };

  function aplicar() {
    const limpios: Rotulos = { posicion: r.posicion };
    for (const k of ["antetitulo", "titulo", "subtitulo", "cta"] as const) {
      const v = (r[k] ?? "").trim();
      if (v) limpios[k] = v;
    }
    const hayTexto = !!(limpios.antetitulo || limpios.titulo || limpios.subtitulo || limpios.cta);
    onAplicar({ ...p, rotulos: hayTexto ? limpios : null, creativo: permiteCreativo ? p.creativo : "ninguno" });
  }

  const pos = posicionOriginal(archivo, ancho, alto, p.encuadre);
  const tr = sumarTratamientos(p.correccion, ESTILOS[estilo].tratamiento[marca]);
  const css = previaCss(tr);

  return (
    <div className="space-y-5 rounded-md border bg-muted/20 p-3" data-testid="ajustes-foto">
      <div className="grid gap-5 md:grid-cols-[minmax(0,220px)_1fr]">
        <div className="space-y-2">
          <p className="text-xs font-medium">Vista previa del encuadre</p>
          <div className="relative w-full max-w-[220px] overflow-hidden rounded-md bg-muted" style={{ aspectRatio: `${ancho} / ${alto}` }}>
            {urlOriginal && pos ? (
              <img src={urlOriginal} alt="Original con el encuadre elegido" className="absolute max-w-none" style={{ ...pos, filter: css.filter }} />
            ) : (
              <p className="p-2 text-xs text-muted-foreground">Sin vista previa del original</p>
            )}
            {css.vineta > 0 && <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${(0.8 * css.vineta).toFixed(2)}) 100%)` }} />}
          </div>
          <p className="text-xs text-muted-foreground">Aproximada: la foto final la hace el motor.</p>
        </div>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Corrección</legend>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <Deslizador id={`${id}-exp`} etiqueta="Exposición" valor={p.correccion.exposicion} min={-0.6} max={0.6} paso={0.05} onCambio={(v) => corr("exposicion", v)} />
              <Deslizador id={`${id}-con`} etiqueta="Contraste" valor={p.correccion.contraste} min={-0.6} max={0.6} paso={0.05} onCambio={(v) => corr("contraste", v)} />
              <Deslizador id={`${id}-sat`} etiqueta="Saturación" valor={p.correccion.saturacion} min={-0.6} max={0.6} paso={0.05} onCambio={(v) => corr("saturacion", v)} />
              <Deslizador id={`${id}-tem`} etiqueta="Temperatura (frío a cálido)" valor={p.correccion.temperatura} min={-0.6} max={0.6} paso={0.05} onCambio={(v) => corr("temperatura", v)} />
              <Deslizador id={`${id}-nit`} etiqueta="Nitidez" valor={p.correccion.nitidez} min={0} max={0.8} paso={0.05} onCambio={(v) => corr("nitidez", v)} />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch id={`${id}-niv`} checked={p.autoNiveles} onCheckedChange={(v) => setP((x) => ({ ...x, autoNiveles: v }))} />
              <Label htmlFor={`${id}-niv`} className="text-sm">
                Niveles automáticos <span className="text-xs text-muted-foreground">(para fotos apagadas o con velo)</span>
              </Label>
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Encuadre</legend>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-3">
              <Deslizador id={`${id}-x`} etiqueta="Horizontal" valor={p.encuadre.x} min={0} max={1} paso={0.01} formato={(v) => `${Math.round(v * 100)} %`} onCambio={(v) => enc("x", v)} />
              <Deslizador id={`${id}-y`} etiqueta="Vertical" valor={p.encuadre.y} min={0} max={1} paso={0.01} formato={(v) => `${Math.round(v * 100)} %`} onCambio={(v) => enc("y", v)} />
              <Deslizador id={`${id}-z`} etiqueta="Zoom" valor={p.encuadre.zoom} min={1} max={3} paso={0.05} formato={(v) => `×${String(Math.round(v * 100) / 100).replace(".", ",")}`} onCambio={(v) => enc("zoom", v)} />
            </div>
          </fieldset>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Rótulos</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Antetítulo" htmlFor={`${id}-ante`}>
            <Input id={`${id}-ante`} value={r.antetitulo ?? ""} maxLength={LIMITES_TEXTO.antetitulo} onChange={(e) => rot("antetitulo", e.target.value)} />
          </Campo>
          <Campo etiqueta="Titular" htmlFor={`${id}-tit`} ayuda={`${palabras(r.titulo ?? "")}/${MAX_PALABRAS_TITULO} palabras`}>
            <Input id={`${id}-tit`} value={r.titulo ?? ""} maxLength={LIMITES_TEXTO.titulo} onChange={(e) => rot("titulo", e.target.value)} />
          </Campo>
          <Campo etiqueta="Subtítulo" htmlFor={`${id}-sub`}>
            <Input id={`${id}-sub`} value={r.subtitulo ?? ""} maxLength={LIMITES_TEXTO.subtitulo} onChange={(e) => rot("subtitulo", e.target.value)} />
          </Campo>
          <Campo etiqueta="Llamada a la acción" htmlFor={`${id}-cta`}>
            <Input id={`${id}-cta`} value={r.cta ?? ""} maxLength={LIMITES_TEXTO.cta} onChange={(e) => rot("cta", e.target.value)} />
          </Campo>
          <SelectorNativo id={`${id}-pos`} etiqueta="Posición de los rótulos" valor={r.posicion} opciones={POSICIONES.map((x) => ({ valor: x, etiqueta: ETIQUETA_POSICION[x] }))} onCambio={(v) => setR((x) => ({ ...x, posicion: v as PosicionRotulos }))} />
        </div>
        <div className="flex items-center gap-3">
          <Switch id={`${id}-logo`} checked={p.logo} onCheckedChange={(v) => setP((x) => ({ ...x, logo: v }))} />
          <Label htmlFor={`${id}-logo`} className="text-sm">
            Poner el logo de la marca
          </Label>
        </div>
      </fieldset>

      {permiteCreativo && (
        <SelectorNativo id={`${id}-cre`} etiqueta="Transformación creativa (cambia la escena)" valor={p.creativo} opciones={CREATIVOS.map((x) => ({ valor: x, etiqueta: ETIQUETA_CREATIVO[x] }))} onCambio={(v) => setP((x) => ({ ...x, creativo: v as Creativo }))} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={ocupado} onClick={aplicar}>
          {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Aplicar ajustes
        </Button>
      </div>

      <div className="space-y-2 border-t pt-3">
        <Campo etiqueta="Indicación para la IA (opcional)" htmlFor={`${id}-ind`}>
          <Textarea id={`${id}-ind`} rows={2} maxLength={300} value={indicacion} onChange={(e) => setIndicacion(e.target.value)} placeholder="Ej.: más cálida, con el plato más grande" />
        </Campo>
        <Button type="button" variant="outline" className="gap-2" disabled={ocupado} onClick={() => onOtraPropuesta(indicacion)}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Pedir otra propuesta a la IA para esta foto
        </Button>
      </div>
    </div>
  );
}
