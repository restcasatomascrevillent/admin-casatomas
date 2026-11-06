/**
 * «Sugerir texto» con IA para una pieza de Instagram (fase 1 de la propuesta).
 *
 * Pide a la Edge Function instagram-ia 3 propuestas con la voz de la marca
 * (caption, hashtags y texto alternativo) y, si se pasa onElegirRotulos,
 * también rótulos para la plantilla. El servidor ya las ha validado (sin
 * emoji, sin precios inventados, sin platos que no existan, sin alérgenos que
 * la carta no respalde, TOUZA sin «reservar»).
 *
 * Aprobación humana: elegir una propuesta SOLO rellena el texto llamando a
 * onElegir; este componente nunca publica ni programa nada.
 *
 *   <SugerirTextoIA
 *     contexto={{ marca, formato, plantilla, foto, piezaId, textos: { titular, antetitulo } }}
 *     onElegir={(caption, hashtags, altText) => …}
 *     onElegirRotulos={(rotulos) => …}   // opcional
 *   />
 */
import { useId, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  ErrorIA,
  marcarElegida,
  sugerirRotulos,
  sugerirTexto,
  textoError,
  TONOS_IA,
  type CampoRotuloIA,
  type ContextoPiezaIA,
  type OpcionesLlamada,
  type RespuestaRotulosIA,
  type RespuestaTextoIA,
  type RotulosIA,
  type TonoIA,
} from "./api";

export interface SugerirTextoIAProps {
  /** Contexto de la pieza: marca, formato, plantilla, foto (o plato), textos ya puestos e id si está guardada. */
  contexto: ContextoPiezaIA;
  /** Se llama al elegir una propuesta. Solo rellena: publicar sigue siendo cosa de la persona. */
  onElegir: (caption: string, hashtags: string[], altText: string) => void;
  /** Si se pasa, aparece «Proponer rótulos» y se llama al elegir uno (solo campos de la plantilla). */
  onElegirRotulos?: (rotulos: RotulosIA) => void;
  deshabilitado?: boolean;
  className?: string;
  /** Solo para pruebas: fetch y token de la llamada. */
  opcionesLlamada?: OpcionesLlamada;
}

const MAX_INDICACIONES = 500;
const ETIQUETA_CAMPO: Record<CampoRotuloIA, string> = {
  antetitulo: "Antetítulo",
  titular: "Titular",
  cita: "Cita",
  cta: "Llamada a la acción",
  pie: "Pie",
};

type Estado =
  | { tipo: "inicial" }
  | { tipo: "cargando"; que: "texto" | "rotulos" }
  | { tipo: "error"; error: unknown; que: "texto" | "rotulos" }
  | { tipo: "texto"; r: RespuestaTextoIA }
  | { tipo: "rotulos"; r: RespuestaRotulosIA };

function esFotoCarta(ctx: ContextoPiezaIA): boolean {
  return !!ctx.platoId || (typeof ctx.foto === "string" && ctx.foto.startsWith("carta:"));
}

function Descartadas({ lista }: { lista: Array<{ motivos: string[] }> }) {
  if (!lista.length) return null;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">
        {lista.length === 1 ? "1 propuesta descartada" : `${lista.length} propuestas descartadas`} por las comprobaciones
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {lista.flatMap((d, i) => d.motivos.map((m, j) => <li key={`${i}-${j}`}>{m}</li>))}
      </ul>
    </details>
  );
}

function Avisos({ avisos }: { avisos: string[] }) {
  if (!avisos.length) return null;
  return (
    <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
      {avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
}

export function SugerirTextoIA({ contexto, onElegir, onElegirRotulos, deshabilitado, className, opcionesLlamada }: SugerirTextoIAProps) {
  const id = useId();
  const [tono, setTono] = useState<TonoIA>("cercano");
  const [indicaciones, setIndicaciones] = useState("");
  const [incluirPrecio, setIncluirPrecio] = useState(false);
  const [estado, setEstado] = useState<Estado>({ tipo: "inicial" });
  /** Hashtags que la persona ha quitado de cada propuesta (por índice). */
  const [quitados, setQuitados] = useState<Record<number, string[]>>({});
  const [elegida, setElegida] = useState<number | null>(null);

  const cargando = estado.tipo === "cargando";
  const conPlato = esFotoCarta(contexto);

  async function pedir(que: "texto" | "rotulos") {
    setEstado({ tipo: "cargando", que });
    setQuitados({});
    setElegida(null);
    const peticion = { tono, indicaciones, incluirPrecio: conPlato && incluirPrecio };
    try {
      if (que === "texto") setEstado({ tipo: "texto", r: await sugerirTexto(contexto, peticion, opcionesLlamada) });
      else setEstado({ tipo: "rotulos", r: await sugerirRotulos(contexto, peticion, opcionesLlamada) });
    } catch (e) {
      setEstado({ tipo: "error", error: e, que });
    }
  }

  function elegirTexto(r: RespuestaTextoIA, i: number) {
    const v = r.variantes[i];
    const fuera = quitados[i] ?? [];
    onElegir(v.caption, v.hashtags.filter((h) => !fuera.includes(h)), v.altText);
    setElegida(i);
    void marcarElegida(r.sugerenciaId, i);
  }

  function elegirRotulos(r: RespuestaRotulosIA, i: number) {
    const v = r.variantes[i];
    const rotulos: RotulosIA = {};
    for (const k of Object.keys(ETIQUETA_CAMPO) as CampoRotuloIA[]) if (v[k]) rotulos[k] = v[k];
    onElegirRotulos?.(rotulos);
    setElegida(i);
    void marcarElegida(r.sugerenciaId, i);
  }

  const error = estado.tipo === "error" ? estado.error : null;

  return (
    <section className={cn("space-y-4 rounded-lg border p-4", className)} aria-labelledby={`${id}-titulo`}>
      <div className="space-y-1">
        <h3 id={`${id}-titulo`} className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Sugerir texto con IA
        </h3>
        <p className="text-xs text-muted-foreground">
          Son propuestas para revisar: elegir una solo rellena el texto. Nada se publica sin que lo apruebes.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label id={`${id}-tono`}>Tono</Label>
        <ToggleGroup
          type="single"
          value={tono}
          onValueChange={(v) => v && setTono(v as TonoIA)}
          aria-labelledby={`${id}-tono`}
          className="justify-start"
          disabled={cargando || deshabilitado}
        >
          {TONOS_IA.map((t) => (
            <ToggleGroupItem key={t.id} value={t.id} variant="outline" size="sm">
              {t.etiqueta}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-indicaciones`}>Indicaciones (opcional)</Label>
        <Textarea
          id={`${id}-indicaciones`}
          value={indicaciones}
          maxLength={MAX_INDICACIONES}
          onChange={(e) => setIndicaciones(e.target.value)}
          placeholder="Por ejemplo: que se note el otoño, mencionar que es para compartir…"
          rows={2}
          disabled={cargando || deshabilitado}
          aria-describedby={`${id}-indicaciones-ayuda`}
        />
        <p id={`${id}-indicaciones-ayuda`} className="text-right text-xs text-muted-foreground">
          {indicaciones.length}/{MAX_INDICACIONES} · no pongas datos de clientes
        </p>
      </div>

      {conPlato && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-precio`}
            checked={incluirPrecio}
            onCheckedChange={(v) => setIncluirPrecio(v === true)}
            disabled={cargando || deshabilitado}
          />
          <Label htmlFor={`${id}-precio`} className="text-sm font-normal">
            Añadir el precio de la carta al final
          </Label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => pedir("texto")} disabled={cargando || deshabilitado}>
          {cargando && estado.que === "texto" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {cargando && estado.que === "texto" ? "Pensando…" : "Proponer 3 textos"}
        </Button>
        {onElegirRotulos && (
          <Button type="button" variant="outline" onClick={() => pedir("rotulos")} disabled={cargando || deshabilitado}>
            {cargando && estado.que === "rotulos" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {cargando && estado.que === "rotulos" ? "Pensando…" : "Proponer rótulos"}
          </Button>
        )}
      </div>

      <div aria-live="polite" aria-busy={cargando} className="space-y-3">
        {cargando && <p className="text-sm text-muted-foreground">Preparando propuestas con la voz de la marca…</p>}

        {error !== null && (
          <Alert variant="destructive">
            <AlertTitle>No se han podido preparar las propuestas</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{textoError(error)}</p>
              {error instanceof ErrorIA && <Descartadas lista={error.descartadas} />}
              {!(error instanceof ErrorIA && (error.tipo === "cupo" || error.tipo === "sin_permiso")) && (
                <Button type="button" size="sm" variant="outline" onClick={() => pedir(estado.tipo === "error" ? estado.que : "texto")}>
                  Reintentar
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {estado.tipo === "texto" && (
          <>
            <Avisos avisos={estado.r.avisos} />
            <ol className="space-y-3" aria-label="Propuestas de texto">
              {estado.r.variantes.map((v, i) => {
                const fuera = quitados[i] ?? [];
                return (
                  <li key={i} className={cn("space-y-2 rounded-md border p-3", elegida === i && "border-primary")}>
                    <p className="text-xs font-medium text-muted-foreground">Propuesta {i + 1}</p>
                    <p className="whitespace-pre-wrap text-sm">{v.caption}</p>
                    {v.hashtags.length > 0 && (
                      <ul className="flex flex-wrap gap-1" aria-label={`Hashtags de la propuesta ${i + 1}`}>
                        {v.hashtags
                          .filter((h) => !fuera.includes(h))
                          .map((h) => (
                            <li key={h}>
                              <Badge variant="secondary" className="gap-1 pr-1">
                                {h}
                                <button
                                  type="button"
                                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                                  aria-label={`Quitar ${h}`}
                                  onClick={() => setQuitados((q) => ({ ...q, [i]: [...(q[i] ?? []), h] }))}
                                >
                                  <X className="h-3 w-3" aria-hidden="true" />
                                </button>
                              </Badge>
                            </li>
                          ))}
                      </ul>
                    )}
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Texto alternativo:</span> {v.altText}
                    </p>
                    <Avisos avisos={v.avisos} />
                    <Button type="button" size="sm" variant={elegida === i ? "default" : "outline"} onClick={() => elegirTexto(estado.r, i)}>
                      {elegida === i ? <Check className="mr-1 h-4 w-4" aria-hidden="true" /> : null}
                      {elegida === i ? "Elegida" : "Usar este texto"}
                    </Button>
                  </li>
                );
              })}
            </ol>
            <Descartadas lista={estado.r.descartadas} />
          </>
        )}

        {estado.tipo === "rotulos" && (
          <>
            <Avisos avisos={estado.r.avisos} />
            <ol className="space-y-3" aria-label="Propuestas de rótulos">
              {estado.r.variantes.map((v, i) => (
                <li key={i} className={cn("space-y-2 rounded-md border p-3", elegida === i && "border-primary")}>
                  <p className="text-xs font-medium text-muted-foreground">Propuesta {i + 1}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    {(Object.keys(ETIQUETA_CAMPO) as CampoRotuloIA[])
                      .filter((k) => v[k])
                      .map((k) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-foreground">{ETIQUETA_CAMPO[k]}</dt>
                          <dd>{v[k]}</dd>
                        </div>
                      ))}
                  </dl>
                  <Avisos avisos={v.avisos} />
                  <Button type="button" size="sm" variant={elegida === i ? "default" : "outline"} onClick={() => elegirRotulos(estado.r, i)}>
                    {elegida === i ? <Check className="mr-1 h-4 w-4" aria-hidden="true" /> : null}
                    {elegida === i ? "Elegidos" : "Usar estos rótulos"}
                  </Button>
                </li>
              ))}
            </ol>
            <Descartadas lista={estado.r.descartadas} />
          </>
        )}
      </div>
    </section>
  );
}
