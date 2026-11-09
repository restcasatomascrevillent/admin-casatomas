import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { mensajeError, proponerTextos, textoParaCopiar } from "@/components/rrss/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Canal } from "@/lib/rrss/formatos";
import { LIMITES_TEXTO, MAX_HASHTAGS, normalizarHashtags, type TextosPublicacion as Textos } from "@/lib/rrss/plan";
import { Campo } from "./Controles";

export const ESPERA_GUARDADO_TEXTOS = 800;

interface Props {
  proyectoId: string;
  canal: Canal;
  textos: Partial<Textos>;
  onGuardar: (t: Textos) => Promise<void>;
}

export function TextosPublicacion({ proyectoId, canal, textos, onGuardar }: Props) {
  const [t, setT] = useState<Textos>({ caption: textos.caption ?? "", hashtags: textos.hashtags ?? [], titular: textos.titular ?? "" });
  const [nuevo, setNuevo] = useState("");
  const [indicacion, setIndicacion] = useState("");
  const [regenerando, setRegenerando] = useState(false);
  const ultimo = useRef(JSON.stringify(t));
  const guardar = useRef(onGuardar);
  guardar.current = onGuardar;

  // Guardado automático: un momento después de dejar de escribir.
  useEffect(() => {
    const s = JSON.stringify(t);
    if (s === ultimo.current) return;
    const h = setTimeout(() => {
      ultimo.current = s;
      guardar.current(t).catch((e) => toast.error(`No se ha guardado el texto: ${mensajeError(e)}`));
    }, ESPERA_GUARDADO_TEXTOS);
    return () => clearTimeout(h);
  }, [t]);

  const maxRecomendado = MAX_HASHTAGS[canal];

  function anadirHashtag() {
    const lista = normalizarHashtags([...t.hashtags, nuevo], 30);
    setT((x) => ({ ...x, hashtags: lista }));
    setNuevo("");
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoParaCopiar(t));
      toast.success("Texto copiado");
    } catch {
      toast.error("No se ha podido copiar: selecciona el texto y cópialo a mano");
    }
  }

  async function regenerar() {
    setRegenerando(true);
    try {
      const r = await proponerTextos(proyectoId, indicacion.trim() || undefined);
      setT(r.textos);
      toast.success("Texto regenerado");
    } catch (e) {
      toast.error(mensajeError(e));
    } finally {
      setRegenerando(false);
    }
  }

  return (
    <section aria-labelledby="textos-pub" className="space-y-3 rounded-lg border p-3" data-testid="textos-publicacion">
      <h3 id="textos-pub" className="text-sm font-semibold">
        Texto de la publicación
      </h3>
      <Campo etiqueta="Texto" htmlFor="tp-caption" ayuda={`${t.caption.length}/${LIMITES_TEXTO.caption} caracteres. Se guarda solo.`}>
        <Textarea id="tp-caption" rows={Math.min(16, Math.max(6, (t.caption ?? "").split("\n").length + Math.ceil((t.caption ?? "").length / 90) + 1))} maxLength={LIMITES_TEXTO.caption} value={t.caption} onChange={(e) => setT((x) => ({ ...x, caption: e.target.value }))} />
      </Campo>
      <Campo etiqueta="Titular" htmlFor="tp-titular">
        <Input id="tp-titular" maxLength={LIMITES_TEXTO.titular} value={t.titular} onChange={(e) => setT((x) => ({ ...x, titular: e.target.value }))} />
      </Campo>
      <div className="space-y-2">
        <p className="text-sm font-medium" id="tp-hashtags">
          Hashtags
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-labelledby="tp-hashtags">
          {t.hashtags.map((h) => (
            <li key={h} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs">
              {h}
              <button type="button" aria-label={`Quitar ${h}`} className="rounded-full p-0.5 hover:bg-background" onClick={() => setT((x) => ({ ...x, hashtags: x.hashtags.filter((y) => y !== h) }))}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            aria-label="Nuevo hashtag"
            value={nuevo}
            placeholder="#nuevo"
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                anadirHashtag();
              }
            }}
          />
          <Button type="button" variant="outline" disabled={!nuevo.trim()} onClick={anadirHashtag}>
            Añadir
          </Button>
        </div>
        {t.hashtags.length > maxRecomendado && <p className="text-xs text-muted-foreground">En {canal === "instagram" ? "Instagram" : "Facebook"} se recomiendan {maxRecomendado} como mucho.</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" className="gap-2" onClick={copiar}>
          <Copy className="h-4 w-4" aria-hidden="true" /> Copiar texto
        </Button>
      </div>
      <div className="space-y-2 border-t pt-3">
        <Campo etiqueta="Indicación para el texto (opcional)" htmlFor="tp-indicacion">
          <Input id="tp-indicacion" maxLength={300} value={indicacion} onChange={(e) => setIndicacion(e.target.value)} placeholder="Ej.: más corto y con tono cercano" />
        </Campo>
        <Button type="button" variant="outline" className="gap-2" disabled={regenerando} onClick={regenerar}>
          {regenerando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Regenerar solo el texto
        </Button>
      </div>
    </section>
  );
}
