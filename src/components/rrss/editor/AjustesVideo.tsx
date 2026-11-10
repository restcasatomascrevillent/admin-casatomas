import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Mic, Plus, Trash2 } from "lucide-react";
import type { Archivo } from "@/components/rrss/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { FormatoSalida } from "@/lib/rrss/formatos";
import { DURACION_PLANO, duracionMontaje, LIMITES_TEXTO, MAX_TITULOS, MAX_TOMAS, type PiezaVideo, type Toma, type TituloVideo } from "@/lib/rrss/plan";
import { TRANSICIONES, type Transicion } from "@/lib/rrss/estilos";
import { Campo, Deslizador, SelectorNativo } from "./Controles";
import { aDecimas, coma, formatoSegundos } from "./util";

const ETIQUETA_TRANSICION: Record<Transicion, string> = { fundido: "Fundido", deslizar: "Deslizar", zoom: "Zoom", corte: "Corte" };
const POSICIONES_TITULO: { valor: TituloVideo["posicion"]; etiqueta: string }[] = [
  { valor: "arriba", etiqueta: "Arriba" },
  { valor: "centro", etiqueta: "En el centro" },
  { valor: "abajo", etiqueta: "Abajo" },
];

/** Segundos con pasos de 0,1: se escribe libremente y se acota al salir del campo. */
function CampoSegundos({ id, etiqueta, valor, min, max, disabled, onCommit }: { id: string; etiqueta: string; valor: number; min: number; max: number; disabled?: boolean; onCommit: (v: number) => void }) {
  const [borrador, setBorrador] = useState<string | null>(null);
  useEffect(() => setBorrador(null), [valor]);
  const confirmar = () => {
    if (borrador === null) return;
    const n = Number(borrador.replace(",", "."));
    setBorrador(null);
    if (Number.isFinite(n)) onCommit(aDecimas(Math.min(max, Math.max(min, n))));
  };
  return (
    <Campo etiqueta={etiqueta} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={0.1}
        min={min}
        max={max}
        disabled={disabled}
        value={borrador ?? String(valor)}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => e.key === "Enter" && confirmar()}
      />
    </Campo>
  );
}

interface Props {
  pieza: PiezaVideo;
  archivos: Archivo[];
  formato: FormatoSalida;
  ocupado: boolean;
  transcribiendo: Set<string>;
  onTranscribir: (archivoId: string) => void;
  onAplicar: (pieza: PiezaVideo) => void;
}

export function AjustesVideo({ pieza, archivos, formato, ocupado, transcribiendo, onTranscribir, onAplicar }: Props) {
  const [p, setP] = useState<PiezaVideo>(pieza);
  const [nuevoArchivo, setNuevoArchivo] = useState(archivos[0]?.id ?? "");
  const porId = new Map(archivos.map((a) => [a.id, a]));
  const total = duracionMontaje(p);
  const lim = formato.duracion;
  const fueraDeFormato = lim && (total < lim.min || total > lim.max);
  const conVoz = archivos.filter((a) => a.tipo === "video" && !!a.analisis?.audio_ruta);

  const tomaN = (i: number, c: Partial<Toma>) => setP((x) => ({ ...x, tomas: x.tomas.map((t, j) => (j === i ? { ...t, ...c } : t)) }));
  const moverToma = (i: number, d: number) =>
    setP((x) => {
      const j = i + d;
      if (j < 0 || j >= x.tomas.length) return x;
      const t = [...x.tomas];
      [t[i], t[j]] = [t[j], t[i]];
      return { ...x, tomas: t };
    });
  const tituloN = (i: number, c: Partial<TituloVideo>) => setP((x) => ({ ...x, titulos: x.titulos.map((t, j) => (j === i ? { ...t, ...c } : t)) }));

  function cambiarArchivoToma(i: number, archivoId: string) {
    const a = porId.get(archivoId);
    if (!a) return;
    const d = a.tipo === "video" ? a.duracion_s ?? 0 : 0;
    const t = p.tomas[i];
    const dur = Math.max(DURACION_PLANO.min, Math.min(t.fin - t.inicio, a.tipo === "video" && d > 0 ? d : DURACION_PLANO.max));
    tomaN(i, { archivo: a.id, medio: a.tipo, inicio: 0, fin: aDecimas(dur), movimiento: a.tipo === "foto" ? "acercar" : "ninguno" });
  }

  function anadirToma() {
    const a = porId.get(nuevoArchivo);
    if (!a || p.tomas.length >= MAX_TOMAS) return;
    const dur = a.tipo === "video" ? Math.min(3, a.duracion_s ?? 3) : 2.5;
    setP((x) => ({ ...x, tomas: [...x.tomas, { archivo: a.id, medio: a.tipo, inicio: 0, fin: aDecimas(Math.max(DURACION_PLANO.min, dur)), encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: a.tipo === "foto" ? "acercar" : "ninguno", motivo: "" }] }));
  }

  function aplicar() {
    onAplicar({ ...p, titulos: p.titulos.filter((t) => t.texto.trim()).map((t) => ({ ...t, texto: t.texto.trim() })) });
  }

  return (
    <div className="space-y-6 rounded-md border bg-muted/20 p-3" data-testid="ajustes-video">
      <section className="space-y-3" aria-labelledby="av-tomas">
        <h4 id="av-tomas" className="text-sm font-semibold">
          Tomas
        </h4>
        <ol className="space-y-3">
          {p.tomas.map((t, i) => {
            const a = porId.get(t.archivo);
            const esVideo = t.medio === "video";
            const dur = esVideo ? a?.duracion_s ?? DURACION_PLANO.max * 10 : DURACION_PLANO.max;
            return (
              <li key={i} className="space-y-2 rounded-md border bg-card p-2" data-testid={`toma:${i}`}>
                <div className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem]">
                  <SelectorNativo
                    id={`av-t${i}-a`}
                    etiqueta={`Toma ${i + 1}: archivo`}
                    valor={t.archivo}
                    opciones={[...(a ? [] : [{ valor: t.archivo, etiqueta: "Archivo quitado" }]), ...archivos.map((x) => ({ valor: x.id, etiqueta: `${x.nombre} (${x.tipo === "video" ? "vídeo" : "foto"})` }))]}
                    onCambio={(v) => cambiarArchivoToma(i, v)}
                  />
                  <CampoSegundos id={`av-t${i}-i`} etiqueta="Inicio (s)" valor={t.inicio} min={0} max={Math.max(0, aDecimas(t.fin - 0.1))} disabled={!esVideo} onCommit={(v) => tomaN(i, { inicio: v })} />
                  <CampoSegundos
                    id={`av-t${i}-f`}
                    etiqueta="Fin (s)"
                    valor={t.fin}
                    min={aDecimas(t.inicio + (esVideo ? 0.1 : DURACION_PLANO.min))}
                    max={esVideo ? aDecimas(dur) : DURACION_PLANO.max}
                    onCommit={(v) => tomaN(i, { fin: v })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Dura {coma(t.fin - t.inicio)} s{esVideo && a?.duracion_s ? ` · el clip dura ${formatoSegundos(a.duracion_s)}` : ""}
                  </span>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Subir la toma ${i + 1}`} disabled={i === 0} onClick={() => moverToma(i, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Bajar la toma ${i + 1}`} disabled={i === p.tomas.length - 1} onClick={() => moverToma(i, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Quitar la toma ${i + 1}`} disabled={p.tomas.length <= 1} onClick={() => setP((x) => ({ ...x, tomas: x.tomas.filter((_, j) => j !== i) }))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-end gap-2">
          <SelectorNativo className="min-w-0 flex-1" id="av-nueva" etiqueta="Añadir una toma de" valor={nuevoArchivo} opciones={archivos.map((x) => ({ valor: x.id, etiqueta: `${x.nombre} (${x.tipo === "video" ? "vídeo" : "foto"})` }))} onCambio={setNuevoArchivo} />
          <Button type="button" variant="outline" className="gap-1" disabled={!nuevoArchivo || p.tomas.length >= MAX_TOMAS} onClick={anadirToma}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Añadir toma
          </Button>
        </div>
        <p data-testid="duracion-total" className="text-sm">
          Duración total: <strong>{coma(total)} s</strong>
          {lim && <span className="text-xs text-muted-foreground"> (este formato admite de {lim.min} a {lim.max} s)</span>}
        </p>
        {fueraDeFormato && lim && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-[#e7b008] bg-[#e7b008]/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {total < lim.min ? `El vídeo dura menos de ${lim.min} s, el mínimo de ${formato.etiqueta}: alarga alguna toma o añade otra.` : `El vídeo dura más de ${lim.max} s, el máximo de ${formato.etiqueta}: acorta o quita tomas (el motor recortará las últimas).`}
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="av-titulos">
        <h4 id="av-titulos" className="text-sm font-semibold">
          Títulos en pantalla
        </h4>
        {p.titulos.length === 0 && <p className="text-xs text-muted-foreground">Sin títulos.</p>}
        <ul className="space-y-3">
          {p.titulos.map((t, i) => (
            <li key={i} className="space-y-2 rounded-md border bg-card p-2">
              <Campo etiqueta={`Título ${i + 1}: texto`} htmlFor={`av-ti${i}-x`}>
                <Input id={`av-ti${i}-x`} value={t.texto} maxLength={LIMITES_TEXTO.subtitulo} onChange={(e) => tituloN(i, { texto: e.target.value })} />
              </Campo>
              <div className="grid gap-2 sm:grid-cols-3">
                <CampoSegundos id={`av-ti${i}-i`} etiqueta="Desde (s)" valor={t.inicio} min={0} max={Math.max(0, aDecimas(total - 0.5))} onCommit={(v) => tituloN(i, { inicio: v })} />
                <CampoSegundos id={`av-ti${i}-f`} etiqueta="Hasta (s)" valor={t.fin} min={aDecimas(t.inicio + 0.8)} max={Math.max(aDecimas(t.inicio + 0.8), aDecimas(total))} onCommit={(v) => tituloN(i, { fin: v })} />
                <SelectorNativo id={`av-ti${i}-p`} etiqueta="Posición" valor={t.posicion} opciones={POSICIONES_TITULO.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta }))} onCambio={(v) => tituloN(i, { posicion: v as TituloVideo["posicion"] })} />
              </div>
              <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setP((x) => ({ ...x, titulos: x.titulos.filter((_, j) => j !== i) }))}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Quitar el título {i + 1}
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={p.titulos.length >= MAX_TITULOS} onClick={() => setP((x) => ({ ...x, titulos: [...x.titulos, { texto: "", inicio: 0, fin: Math.min(aDecimas(Math.max(total, 1)), 2.5), posicion: "abajo" }] }))}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Añadir título
        </Button>
      </section>

      <section className="space-y-3" aria-labelledby="av-trans">
        <h4 id="av-trans" className="text-sm font-semibold">
          Transición y sonido
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectorNativo id="av-trans-t" etiqueta="Transición entre tomas" valor={p.transicion} opciones={TRANSICIONES.map((t) => ({ valor: t, etiqueta: ETIQUETA_TRANSICION[t] }))} onCambio={(v) => setP((x) => ({ ...x, transicion: v as Transicion, duracionTransicion: v === "corte" ? 0 : x.duracionTransicion || 0.5 }))} />
          <Deslizador id="av-trans-d" etiqueta="Duración de la transición" valor={p.duracionTransicion} min={0.2} max={1.2} paso={0.1} disabled={p.transicion === "corte"} formato={(v) => `${coma(v)} s`} onCambio={(v) => setP((x) => ({ ...x, duracionTransicion: aDecimas(v) }))} />
        </div>
        <div className="flex items-center gap-3">
          <Switch id="av-audio" checked={p.audio === "original"} onCheckedChange={(v) => setP((x) => ({ ...x, audio: v ? "original" : "silencio" }))} />
          <Label htmlFor="av-audio" className="text-sm">
            Mantener el sonido original de los clips
          </Label>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="av-subs">
        <h4 id="av-subs" className="text-sm font-semibold">
          Subtítulos
        </h4>
        <div className="flex items-center gap-3">
          <Switch id="av-subs-s" checked={p.subtitulos} onCheckedChange={(v) => setP((x) => ({ ...x, subtitulos: v }))} />
          <Label htmlFor="av-subs-s" className="text-sm">
            Subtitular la voz de los clips
          </Label>
        </div>
        {conVoz.length === 0 && <p className="text-xs text-muted-foreground">Ningún clip tiene voz que transcribir.</p>}
        <ul className="space-y-2">
          {conVoz.map((a) => {
            const hecha = (a.analisis.transcripcion?.length ?? 0) > 0 || !!a.analisis.transcripcion_texto;
            const ocupadoT = transcribiendo.has(a.id);
            return (
              <li key={a.id} className="space-y-1 rounded-md border bg-card p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{a.nombre}</span>
                  {!hecha && (
                    <Button type="button" variant="outline" size="sm" className="gap-1" disabled={ocupadoT} onClick={() => onTranscribir(a.id)}>
                      {ocupadoT ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                      Transcribir la voz
                    </Button>
                  )}
                </div>
                {hecha && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">Ver la transcripción</summary>
                    <p className="mt-1 whitespace-pre-line text-xs">{a.analisis.transcripcion_texto || a.analisis.transcripcion?.map((s) => s.texto).join(" ")}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="av-cierre">
        <h4 id="av-cierre" className="text-sm font-semibold">
          Cierre y logo
        </h4>
        <div className="flex items-center gap-3">
          <Switch id="av-cierre-m" checked={p.cierre.mostrar} onCheckedChange={(v) => setP((x) => ({ ...x, cierre: { ...x.cierre, mostrar: v } }))} />
          <Label htmlFor="av-cierre-m" className="text-sm">
            Añadir un cierre con titular y llamada a la acción
          </Label>
        </div>
        {p.cierre.mostrar && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Titular del cierre" htmlFor="av-cierre-t">
              <Input id="av-cierre-t" value={p.cierre.titulo ?? ""} maxLength={LIMITES_TEXTO.titulo} onChange={(e) => setP((x) => ({ ...x, cierre: { ...x.cierre, titulo: e.target.value } }))} />
            </Campo>
            <Campo etiqueta="Llamada a la acción" htmlFor="av-cierre-c">
              <Input id="av-cierre-c" value={p.cierre.cta ?? ""} maxLength={LIMITES_TEXTO.cta} onChange={(e) => setP((x) => ({ ...x, cierre: { ...x.cierre, cta: e.target.value } }))} />
            </Campo>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Switch id="av-logo" checked={p.logo} onCheckedChange={(v) => setP((x) => ({ ...x, logo: v }))} />
          <Label htmlFor="av-logo" className="text-sm">
            Poner el logo de la marca
          </Label>
        </div>
      </section>

      <Button type="button" disabled={ocupado} onClick={aplicar}>
        {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Aplicar cambios
      </Button>
    </div>
  );
}
