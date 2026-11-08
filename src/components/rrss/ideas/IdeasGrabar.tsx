/**
 * RRSS › Subida de fotos › «Dame ideas para grabar».
 * Funciona sin subir archivos: la IA propone 3 ideas con guion y planos.
 * No publica nada en ninguna red social.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, Check, ChevronDown, ChevronUp, Clapperboard, Clock, Copy, Loader2, Lightbulb, Martini, RefreshCw,
  Smartphone, Sparkles, Star, Sun, UtensilsCrossed, Users, Wine, Move, Frame,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ErrorRrss, guardarIdeas, ideaComoTexto, listarIdeas, pedirIdeas,
  type FilaIdeas, type IdeaGrabar, type PlanoIdea, type QuePromocionar,
} from "@/components/rrss/api";
import type { Canal, TipoContenido } from "@/lib/rrss/formatos";
import type { MarcaId } from "@/lib/instagram/tokens";
import { cn } from "@/lib/utils";

const MARCAS_UI: { id: MarcaId; nombre: string }[] = [
  { id: "casa-tomas", nombre: "Casa Tomás" },
  { id: "touza", nombre: "TOUZA" },
];
const CANALES_UI: { id: Canal; nombre: string }[] = [
  { id: "instagram", nombre: "Instagram" },
  { id: "facebook", nombre: "Facebook" },
];
const FORMATOS_UI: { id: TipoContenido | ""; nombre: string }[] = [
  { id: "", nombre: "Cualquiera" },
  { id: "publicacion", nombre: "Publicación" },
  { id: "carrusel", nombre: "Carrusel" },
  { id: "story", nombre: "Story" },
  { id: "reel", nombre: "Reel" },
  { id: "animada", nombre: "Pieza animada" },
];
const NOMBRE_FORMATO: Record<string, string> = Object.fromEntries(FORMATOS_UI.filter((f) => f.id).map((f) => [f.id, f.nombre]));
const PROMOCIONAR_UI: { id: QuePromocionar; nombre: string; Icono: typeof Star }[] = [
  { id: "plato", nombre: "Un plato", Icono: UtensilsCrossed },
  { id: "vino", nombre: "Un vino", Icono: Wine },
  { id: "menu", nombre: "El menú", Icono: Martini },
  { id: "evento", nombre: "Un evento", Icono: CalendarDays },
  { id: "ambiente", nombre: "El ambiente", Icono: Sun },
  { id: "equipo", nombre: "El equipo", Icono: Users },
];
const NOMBRE_PROMOCIONAR: Record<string, string> = Object.fromEntries(PROMOCIONAR_UI.map((p) => [p.id, p.nombre.toLowerCase()]));

const MAX_DETALLE = 600;
const MAX_MATERIAL = 400;

interface ItemCarta {
  id: string;
  nombre: string;
  categoria: string | null;
}

interface Resultado {
  id: string | null;
  ideas: IdeaGrabar[];
  preguntas: string[];
  avisos: string[];
  guardada: boolean;
}

const claseCampo = "w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const claseChip = (activo: boolean) =>
  cn(
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    activo ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted",
  );

function fechaCorta(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function copiar(texto: string, ok: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(ok);
  } catch {
    toast.error("No se ha podido copiar: selecciona el texto y cópialo a mano");
  }
}

/** Platos o vinos activos de la carta de la marca (opcional para la petición). */
function useCarta(tabla: "Platos" | "Vinos" | null, marca: MarcaId) {
  const [items, setItems] = useState<ItemCarta[]>([]);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    if (!tabla) {
      setItems([]);
      return;
    }
    let vivo = true;
    setCargando(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from(tabla)
      .select("id,nombre,categoria")
      .eq("activado", true)
      .eq(marca === "touza" ? "touza" : "restaurante", true)
      .order("nombre", { ascending: true })
      .then(({ data, error }: { data: ItemCarta[] | null; error: unknown }) => {
        if (!vivo) return;
        setItems(error ? [] : (data ?? []).filter((d) => d.nombre));
        setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [tabla, marca]);
  return { items, cargando };
}

function OrientacionIcono({ o }: { o: PlanoIdea["orientacion"] }) {
  return (
    <span className="inline-flex items-center gap-1" title={o === "vertical" ? "Móvil en vertical" : "Móvil en horizontal"}>
      <Smartphone className={cn("h-4 w-4", o === "horizontal" && "rotate-90")} aria-hidden />
      <span>{o === "vertical" ? "Vertical" : "Horizontal"}</span>
    </span>
  );
}

function TarjetaIdea({ idea, n }: { idea: IdeaGrabar; n: number }) {
  return (
    <article className="rounded-lg border bg-card p-4 space-y-4 text-card-foreground" aria-label={`Propuesta ${n}`}>
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Propuesta {n}</p>
        <h3 className="text-lg font-semibold leading-snug">{idea.titulo}</h3>
        <p className="text-sm">{idea.idea}</p>
        <p className="text-sm text-muted-foreground">Objetivo: {idea.objetivo}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clapperboard className="h-4 w-4" aria-hidden />{NOMBRE_FORMATO[idea.formato] ?? idea.formato}</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden />{Math.round(idea.duracion_total_s)} s</span>
        </p>
      </header>

      <section className="rounded-md border-l-4 border-primary bg-muted/60 p-3" aria-label="Gancho">
        <p className="text-xs font-semibold uppercase tracking-wide">Gancho (primeros 2 segundos)</p>
        <p className="text-base font-medium">{idea.gancho}</p>
      </section>

      <section aria-label="Guion" className="space-y-1">
        <h4 className="text-sm font-semibold">Guion</h4>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {idea.guion.map((g, i) => <li key={i}>{g}</li>)}
        </ol>
      </section>

      <section aria-label="Planos" className="space-y-2">
        <h4 className="text-sm font-semibold">Planos y cómo grabarlos con el móvil</h4>
        <ol className="space-y-2">
          {idea.planos.map((p, i) => (
            <li key={i} className="rounded-md border p-3 text-sm space-y-2" data-testid="plano">
              <div className="flex items-start justify-between gap-3">
                <p><span className="font-semibold">{i + 1}.</span> {p.descripcion}</p>
                <span className="shrink-0 text-xs text-muted-foreground">~{p.duracion_s} s</span>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="flex items-center gap-1"><dt className="sr-only">Orientación</dt><dd><OrientacionIcono o={p.orientacion} /></dd></div>
                <div className="flex items-center gap-1"><Sun className="h-4 w-4 shrink-0" aria-hidden /><dt className="sr-only">Luz</dt><dd>{p.luz}</dd></div>
                <div className="flex items-center gap-1"><Frame className="h-4 w-4 shrink-0" aria-hidden /><dt className="sr-only">Encuadre</dt><dd>{p.encuadre}</dd></div>
                <div className="flex items-center gap-1"><Move className="h-4 w-4 shrink-0" aria-hidden /><dt className="sr-only">Movimiento</dt><dd>{p.movimiento}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      {idea.texto_pantalla.length > 0 && (
        <section aria-label="Texto en pantalla" className="space-y-1">
          <h4 className="text-sm font-semibold">Texto en pantalla</h4>
          <ul className="flex flex-wrap gap-2">
            {idea.texto_pantalla.map((t, i) => <li key={i} className="rounded bg-muted px-2 py-1 text-sm">{t}</li>)}
          </ul>
        </section>
      )}

      {idea.voz_en_off && (
        <section aria-label="Voz en off" className="space-y-1">
          <h4 className="text-sm font-semibold">Voz en off</h4>
          <p className="text-sm">{idea.voz_en_off}</p>
        </section>
      )}

      {idea.material.length > 0 && (
        <section aria-label="Material necesario" className="space-y-1">
          <h4 className="text-sm font-semibold">Material necesario</h4>
          <ul className="space-y-1 text-sm">
            {idea.material.map((m, i) => (
              <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{m}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Texto de la publicación" className="space-y-1 rounded-md bg-muted/40 p-3">
        <h4 className="text-sm font-semibold">Texto de la publicación</h4>
        <p className="whitespace-pre-line text-sm">{idea.copy}</p>
        <p className="text-sm font-medium">{idea.cta}</p>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={claseChip(false)} onClick={() => copiar(ideaComoTexto(idea), "Guion copiado")}>
          <Copy className="h-4 w-4" aria-hidden />Copiar guion
        </button>
        <button type="button" className={claseChip(false)} onClick={() => copiar([idea.copy, idea.cta].filter(Boolean).join("\n\n"), "Texto de la publicación copiado")}>
          <Copy className="h-4 w-4" aria-hidden />Copiar texto de la publicación
        </button>
      </div>
    </article>
  );
}

export function IdeasGrabar({ className }: { className?: string }) {
  const [marca, setMarca] = useState<MarcaId>("casa-tomas");
  const [canal, setCanal] = useState<Canal>("instagram");
  const [tipo, setTipo] = useState<TipoContenido | "">("");
  const [que, setQue] = useState<QuePromocionar | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [detalle, setDetalle] = useState("");
  const [material, setMaterial] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<ErrorRrss | Error | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [histAbierto, setHistAbierto] = useState(false);
  const [historial, setHistorial] = useState<FilaIdeas[] | null>(null);
  const [errorHist, setErrorHist] = useState<string | null>(null);

  const tablaCarta = que === "plato" ? "Platos" : que === "vino" ? "Vinos" : null;
  const { items, cargando: cargandoCarta } = useCarta(tablaCarta, marca);
  const elegido = items.find((i) => i.id === itemId) ?? null;
  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return items.filter((i) => !q || (i.nombre ?? "").toLowerCase().includes(q)).slice(0, 8);
  }, [items, busqueda]);

  useEffect(() => setItemId(null), [que, marca]);

  const cargarHistorial = useCallback(async () => {
    setErrorHist(null);
    try {
      setHistorial(await listarIdeas());
    } catch (e) {
      setErrorHist((e as Error).message || "No se ha podido cargar el historial");
    }
  }, []);
  useEffect(() => {
    if (histAbierto && historial === null) void cargarHistorial();
  }, [histAbierto, historial, cargarHistorial]);

  const pedir = async () => {
    if (!que || cargando) return;
    setCargando(true);
    setError(null);
    try {
      const r = await pedirIdeas({
        marca,
        canal,
        tipo: tipo || null,
        promocionar: {
          tipo: que,
          ...(detalle.trim() ? { detalle: detalle.trim() } : {}),
          ...(que === "plato" && itemId ? { platoId: itemId } : {}),
          ...(que === "vino" && itemId ? { vinoId: itemId } : {}),
        },
        ...(material.trim() ? { material: material.trim() } : {}),
      });
      setResultado({ id: r.id, ideas: r.ideas ?? [], preguntas: r.preguntas ?? [], avisos: r.avisos ?? [], guardada: false });
      if (historial !== null) void cargarHistorial();
    } catch (e) {
      setResultado(null);
      setError(e instanceof Error ? e : new Error("Ha fallado algo inesperado"));
    } finally {
      setCargando(false);
    }
  };

  const guardar = async () => {
    if (!resultado?.id) return;
    setGuardando(true);
    try {
      await guardarIdeas(resultado.id, true);
      setResultado({ ...resultado, guardada: true });
      toast.success("Ideas guardadas");
      if (historial !== null) void cargarHistorial();
    } catch (e) {
      toast.error((e as Error).message || "No se han podido guardar");
    } finally {
      setGuardando(false);
    }
  };

  const recuperar = (f: FilaIdeas) => {
    setError(null);
    setResultado({ id: f.id, ideas: f.propuestas ?? [], preguntas: [], avisos: [], guardada: f.guardada });
    setHistAbierto(false);
  };

  const tipoError = error instanceof ErrorRrss ? error.tipo : null;
  const sinReintento = tipoError === "cupo";
  const iaCaida = tipoError === "ia_no_disponible" || tipoError === "configuracion";

  return (
    <div className={cn("space-y-6", className)}>
      <section className="space-y-4" aria-label="Qué quieres grabar">
        <div className="flex items-start gap-2">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">Dinos qué quieres enseñar y la IA te propone tres ideas con guion y planos para grabar con el móvil. No hace falta subir nada.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Marca</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Marca">
              {MARCAS_UI.map((m) => (
                <button key={m.id} type="button" aria-pressed={marca === m.id} className={claseChip(marca === m.id)} onClick={() => setMarca(m.id)}>{m.nombre}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Canal</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Canal">
              {CANALES_UI.map((c) => (
                <button key={c.id} type="button" aria-pressed={canal === c.id} className={claseChip(canal === c.id)} onClick={() => setCanal(c.id)}>{c.nombre}</button>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <label htmlFor="ideas-formato" className="text-sm font-medium">Formato preferido (opcional)</label>
            <select id="ideas-formato" className={claseCampo} value={tipo} onChange={(e) => setTipo(e.target.value as TipoContenido | "")}>
              {FORMATOS_UI.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">¿Qué quieres promocionar?</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Qué promocionar">
            {PROMOCIONAR_UI.map(({ id, nombre, Icono }) => (
              <button key={id} type="button" aria-pressed={que === id} className={claseChip(que === id)} onClick={() => setQue(id)}>
                <Icono className="h-4 w-4 shrink-0" aria-hidden />{nombre}
              </button>
            ))}
          </div>
        </fieldset>

        {tablaCarta && (
          <div className="space-y-2">
            <label htmlFor="ideas-carta" className="text-sm font-medium">
              {que === "plato" ? "Plato de la carta (opcional)" : "Vino de la carta (opcional)"}
            </label>
            {elegido ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span>{elegido.nombre}{elegido.categoria ? <span className="text-muted-foreground"> · {elegido.categoria}</span> : null}</span>
                <button type="button" className="min-h-[44px] px-2 text-sm underline" onClick={() => { setItemId(null); setBusqueda(""); }}>Quitar</button>
              </div>
            ) : (
              <>
                <input id="ideas-carta" type="search" className={claseCampo} placeholder="Busca por nombre" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {cargandoCarta ? (
                  <p className="text-xs text-muted-foreground">Cargando la carta…</p>
                ) : items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay nada activo en la carta de esta marca: cuéntalo con tus palabras abajo.</p>
                ) : (
                  <ul className="max-h-48 divide-y overflow-y-auto rounded-md border" aria-label="Resultados de la carta">
                    {coincidencias.map((i) => (
                      <li key={i.id}>
                        <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setItemId(i.id)}>
                          <span>{i.nombre}</span>
                          {i.categoria && <span className="text-xs text-muted-foreground">{i.categoria}</span>}
                        </button>
                      </li>
                    ))}
                    {coincidencias.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Sin coincidencias</li>}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ideas-detalle" className="text-sm font-medium">Cuéntanos más</label>
            <textarea id="ideas-detalle" rows={3} maxLength={MAX_DETALLE} className={claseCampo} value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Por ejemplo: el pulpo a feira de temporada, queremos que se vea el vapor" />
            <p className="text-right text-xs text-muted-foreground">{detalle.length}/{MAX_DETALLE}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="ideas-material" className="text-sm font-medium">Qué material tienes</label>
            <textarea id="ideas-material" rows={3} maxLength={MAX_MATERIAL} className={claseCampo} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Solo el móvil, trípode, luz de ventana por la mañana…" />
            <p className="text-right text-xs text-muted-foreground">{material.length}/{MAX_MATERIAL}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={pedir}
          disabled={!que || cargando}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {cargando ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Pensando ideas…</> : <><Sparkles className="h-4 w-4" aria-hidden />Dame ideas</>}
        </button>
        {!que && <p className="text-xs text-muted-foreground">Elige qué quieres promocionar para poder pedir ideas.</p>}
      </section>

      {error && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
          <p>
            {iaCaida ? `La IA no está disponible ahora: ${error.message}` : error.message}
          </p>
          {sinReintento ? (
            <p className="text-muted-foreground">Has llegado al tope de uso de la IA. No hace falta reintentar ahora: vuelve a probar más tarde.</p>
          ) : (
            <button type="button" className={claseChip(false)} onClick={pedir} disabled={cargando}>
              <RefreshCw className="h-4 w-4" aria-hidden />Reintentar
            </button>
          )}
        </div>
      )}

      {resultado && (
        <section className="space-y-4" aria-label="Ideas propuestas">
          {resultado.preguntas.length > 0 && (
            <div className="rounded-md border-l-4 border-primary bg-muted p-4 text-sm space-y-1" role="note">
              <p className="font-semibold">Para afinar, dime…</p>
              <ul className="list-disc space-y-1 pl-5">
                {resultado.preguntas.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}

          {resultado.ideas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta tanda no trae propuestas. Prueba a contar un poco más y pide otra vez.</p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              {resultado.ideas.map((idea, i) => <TarjetaIdea key={i} idea={idea} n={i + 1} />)}
            </div>
          )}

          {resultado.id && (
            <div>
              <button type="button" className={claseChip(resultado.guardada)} onClick={guardar} disabled={guardando || resultado.guardada}>
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Star className="h-4 w-4" aria-hidden />}
                {resultado.guardada ? "Ideas guardadas" : "Guardar estas ideas"}
              </button>
            </div>
          )}

          {resultado.avisos.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Avisos de la IA">
              {resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </section>
      )}

      <section aria-label="Ideas anteriores" className="rounded-lg border">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm font-medium"
          aria-expanded={histAbierto}
          onClick={() => setHistAbierto((v) => !v)}
        >
          Ideas anteriores
          {histAbierto ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        {histAbierto && (
          <div className="border-t p-2">
            {errorHist ? (
              <p className="p-2 text-sm text-destructive">{errorHist}</p>
            ) : historial === null ? (
              <p className="p-2 text-sm text-muted-foreground">Cargando…</p>
            ) : historial.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">Todavía no hay tandas anteriores.</p>
            ) : (
              <ul className="divide-y">
                {historial.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => recuperar(f)}>
                      <span>
                        {fechaCorta(f.created_at)} · {f.objetivo?.que ? (NOMBRE_PROMOCIONAR[f.objetivo.que] ?? f.objetivo.que) : "sin tema"}
                        {f.objetivo?.detalle ? <span className="text-muted-foreground"> · {f.objetivo.detalle.slice(0, 50)}</span> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{f.guardada ? "Guardada" : "Sin guardar"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default IdeasGrabar;
