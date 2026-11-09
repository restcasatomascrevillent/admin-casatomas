import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Info, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { mensajeError, transcribir, type Archivo, type Generacion, type Proyecto, type Resultado } from "@/components/rrss/api";
import { Button } from "@/components/ui/button";
import type { FormatoSalida } from "@/lib/rrss/formatos";
import type { PiezaFoto, PiezaVideo } from "@/lib/rrss/plan";
import { AjustesFoto } from "./AjustesFoto";
import { AjustesVideo } from "./AjustesVideo";
import { ComparadorFoto } from "./ComparadorFoto";
import { descargarResultado } from "./descargas";
import type { useGenerar } from "./useGenerar";
import { CLAVES } from "./useTrabajo";
import { formatoSegundos } from "./util";

interface Props {
  proyecto: Proyecto;
  archivos: Archivo[];
  resultados: Resultado[];
  urls: Record<string, string>;
  formato: FormatoSalida;
  generacion: Generacion | null | undefined;
  gen: ReturnType<typeof useGenerar>;
}

function Avisos({ avisos }: { avisos: string[] }) {
  if (avisos.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Avisos">
      {avisos.map((a) => (
        <li key={a} className="flex items-start gap-1.5">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {a}
        </li>
      ))}
    </ul>
  );
}

function TarjetaFoto({ r, pieza, proyecto, archivos, urls, gen }: { r: Resultado; pieza: PiezaFoto | undefined; proyecto: Proyecto; archivos: Archivo[]; urls: Record<string, string>; gen: Props["gen"] }) {
  const [ajustando, setAjustando] = useState(false);
  const archivo = pieza ? archivos.find((a) => a.id === pieza.archivo) : undefined;
  const previa = archivo?.analisis?.previa_ruta ? urls[archivo.analisis.previa_ruta] : undefined;
  return (
    <li data-testid={`resultado:${r.indice}`} className={`min-w-0 space-y-2 rounded-lg border bg-card p-3 ${ajustando ? "sm:col-span-2 xl:col-span-3" : ""}`}>
      <div className={ajustando ? "mx-auto w-full max-w-sm" : ""}>
        <ComparadorFoto ancho={r.ancho} alto={r.alto} urlResultado={urls[r.ruta]} urlOriginal={previa} original={archivo} encuadre={pieza?.encuadre ?? { x: 0.5, y: 0.5, zoom: 1 }} descripcion={pieza?.altText || `Pieza ${r.indice + 1}`} />
      </div>
      <p className="text-sm font-medium">Pieza {r.indice + 1}</p>
      {pieza?.nota && <p className="text-xs text-muted-foreground">{pieza.nota}</p>}
      <Avisos avisos={r.avisos ?? []} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void descargarResultado(proyecto, r)}>
          <Download className="h-4 w-4" aria-hidden="true" /> Descargar
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1" aria-expanded={ajustando} disabled={!pieza} onClick={() => setAjustando((v) => !v)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Ajustar
        </Button>
      </div>
      {ajustando && pieza && (
        <AjustesFoto
          key={JSON.stringify(pieza)}
          pieza={pieza}
          ancho={r.ancho}
          alto={r.alto}
          archivo={archivo}
          urlOriginal={previa}
          estilo={proyecto.estilo}
          marca={proyecto.marca}
          permiteCreativo={proyecto.permitir_creativo}
          ocupado={gen.ocupado}
          onAplicar={(p) => void gen.rehacerFoto(r.indice, p)}
          onOtraPropuesta={(ind) => void gen.otraPropuesta(r.indice, ind)}
        />
      )}
    </li>
  );
}

function ResultadoVideo({ r, pieza, proyecto, archivos, urls, formato, gen }: { r: Resultado; pieza: PiezaVideo | undefined; proyecto: Proyecto; archivos: Archivo[]; urls: Record<string, string>; formato: FormatoSalida; gen: Props["gen"] }) {
  const qc = useQueryClient();
  const [ajustando, setAjustando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState<Set<string>>(new Set());
  // Si la URL firmada no llega en 15 s, se dice en vez de quedarse «Cargando» para siempre.
  const hayUrl = !!urls[r.ruta];
  const [sinUrl, setSinUrl] = useState(false);
  useEffect(() => {
    if (hayUrl) {
      setSinUrl(false);
      return;
    }
    const t = setTimeout(() => setSinUrl(true), 15_000);
    return () => clearTimeout(t);
  }, [hayUrl]);

  async function transcribirVoz(id: string) {
    setTranscribiendo((s) => new Set(s).add(id));
    try {
      await transcribir(id);
      await qc.invalidateQueries({ queryKey: CLAVES.archivos(proyecto.id) });
      toast.success("Voz transcrita");
    } catch (e) {
      toast.error(mensajeError(e));
    } finally {
      setTranscribiendo((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  return (
    <div data-testid="resultado-video" className="space-y-3 rounded-lg border bg-card p-3">
      <div className="mx-auto w-full max-w-xs overflow-hidden rounded-md bg-black" style={{ aspectRatio: `${r.ancho} / ${r.alto}` }}>
        {urls[r.ruta] ? (
          <video controls playsInline preload="metadata" poster={r.portada_ruta ? urls[r.portada_ruta] : undefined} src={urls[r.ruta]} className="h-full w-full object-contain" />
        ) : (
          <div role={sinUrl ? "alert" : "status"} className="flex h-full items-center justify-center p-3 text-center text-xs text-white/70">
            {sinUrl ? "No se pudo cargar el vídeo. Vuelve a abrir el trabajo o prueba a descargarlo." : "Cargando el vídeo…"}
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {r.ancho}×{r.alto} px{r.duracion_s ? ` · ${formatoSegundos(r.duracion_s)}` : ""}
      </p>
      {pieza?.nota && <p className="text-xs text-muted-foreground">{pieza.nota}</p>}
      <Avisos avisos={r.avisos ?? []} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void descargarResultado(proyecto, r)}>
          <Download className="h-4 w-4" aria-hidden="true" /> Descargar
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1" aria-expanded={ajustando} disabled={!pieza} onClick={() => setAjustando((v) => !v)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Ajustar el vídeo
        </Button>
      </div>
      {ajustando && pieza && (
        <AjustesVideo key={JSON.stringify(pieza)} pieza={pieza} archivos={archivos.filter((a) => a.estado === "listo")} formato={formato} ocupado={gen.ocupado} transcribiendo={transcribiendo} onTranscribir={(id) => void transcribirVoz(id)} onAplicar={(p) => void gen.rehacerVideo(p)} />
      )}
    </div>
  );
}

export function Resultados({ proyecto, archivos, resultados, urls, formato, generacion, gen }: Props) {
  const fotos = resultados.filter((r) => r.medio === "foto");
  const video = resultados.find((r) => r.medio === "video");
  const piezas = proyecto.plan?.piezas ?? [];
  const avisosPlan = [...new Set([...(proyecto.plan?.avisos ?? []), ...(generacion?.avisos ?? [])])];

  return (
    <div className="space-y-4">
      {proyecto.plan?.resumen && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="resumen-ia">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lo que ha entendido la IA</p>
          <p>{proyecto.plan.resumen}</p>
        </div>
      )}
      <Avisos avisos={avisosPlan} />

      {resultados.length === 0 && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Todavía no hay resultados. Genera el contenido en el paso «Generar».</p>}

      {fotos.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Resultados">
          {fotos.map((r) => {
            const p = piezas[r.indice];
            return <TarjetaFoto key={r.id} r={r} pieza={p?.tipo === "foto" ? p : undefined} proyecto={proyecto} archivos={archivos} urls={urls} gen={gen} />;
          })}
        </ul>
      )}
      {video && <ResultadoVideo r={video} pieza={piezas.find((p): p is PiezaVideo => p.tipo === "video")} proyecto={proyecto} archivos={archivos} urls={urls} formato={formato} gen={gen} />}
    </div>
  );
}
