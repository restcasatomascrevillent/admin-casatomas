/**
 * Pantalla «Estudio» (inicio de Instagram; maqueta `#p-estudio`, evaluación
 * de diseño C1, 05/11/2026). Dos columnas:
 *  · izquierda: la semana con miniaturas por día, la «Sugerencia de la
 *    semana» (IA, solo al pedirla) y las próximas publicaciones;
 *  · derecha: tres cifras de los últimos 28 días con su tendencia y los
 *    encargos abiertos (los que esperan tu revisión, primero).
 *
 * Solo junta piezas que ya existían (useCalendarioInstagram, useEncargos,
 * useMetricasInstagram, SugerenciaSemana): no crea ni publica nada por sí
 * sola. Ocupa el alto que le da la pestaña (sin scroll de página); las listas
 * hacen scroll por dentro desde `lg`.
 */
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clapperboard, Image as ImageIcon, Loader2, Plus, Smartphone, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MarcaId } from "@/lib/instagram";
import { SugerenciaSemana, type IdeaSemanaIA } from "@/components/instagram/campanas";
import {
  agruparPorDia,
  construirEventos,
  DIAS_CORTOS,
  hoyMadrid,
  inicioSemana,
  madridAUtc,
  sumarDias,
  textoInstante,
  type EventoCalendario,
} from "@/components/instagram/programar/logica";
import { useCalendarioInstagram } from "@/components/instagram/programar/useProgramacionInstagram";
import { Miniatura, tituloEvento } from "@/components/instagram/programar/CalendarioInstagram";
import { useEncargos, useRolesEncargos } from "@/components/instagram/encargos/useEncargos";
import { esperaA, fechaCorta, NOMBRE_MODO, type DatosFormulario, type Encargo } from "@/components/instagram/encargos/logica";
import { useMetricasInstagram } from "@/components/instagram/metricas/useMetricasInstagram";
import { formatearNumero, textoVariacion } from "@/components/instagram/metricas/agregacion";
import type { DatosMetricas, PuntoSerie } from "@/components/instagram/metricas/tipos";
import { ESTADOS_CALENDARIO, ESTILO_TONO } from "@/components/instagram/estados";
import { InsigniaEstado, MarcaMini } from "@/components/instagram/InsigniaEstado";
import type { FiltroMarca } from "@/components/instagram/BarraInstagram";

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ICONO_FORMATO = { reel: Clapperboard, post: ImageIcon, story: Smartphone } as const;
const ABIERTOS = new Set(["borrador", "enviado", "aceptado", "en_curso", "para_revisar", "cambios_pedidos", "rechazado"]);

/** «Semana del 2 al 8 de noviembre» / «Semana del 30 de noviembre al 6 de diciembre». */
export function tituloSemana(lunes: string): string {
  const domingo = sumarDias(lunes, 6);
  const [, m1, d1] = lunes.split("-").map(Number);
  const [, m2, d2] = domingo.split("-").map(Number);
  return m1 === m2 ? `Semana del ${d1} al ${d2} de ${MESES_LARGOS[m2 - 1]}` : `Semana del ${d1} de ${MESES_LARGOS[m1 - 1]} al ${d2} de ${MESES_LARGOS[m2 - 1]}`;
}

export interface EstudioInstagramProps {
  marca: FiltroMarca;
  /** Ir a otra pestaña («Ver el mes», «Métricas», «Tablero»…). */
  onIr: (pestana: "calendario" | "campanas" | "encargos" | "metricas" | "crear") => void;
  /** Abrir un día en el calendario. */
  onVerDia?: (dia: string) => void;
  onAbrirPieza: (piezaId: string) => void;
  onNuevaPieza: () => void;
  /** Crear una pieza a partir de una idea de la semana. */
  onCrearIdea: (idea: IdeaSemanaIA) => void;
  onAbrirEncargo: (encargoId: string) => void;
  /** Abrir «Pedir un vídeo o una pieza», con datos de partida si los hay. */
  onPedirEncargo: (datos?: Partial<DatosFormulario>) => void;
  className?: string;
}

/** Minigráfica (maqueta, `.chispa`). */
function Chispa({ valores, className }: { valores: number[]; className?: string }) {
  if (valores.length < 2) return <span className={cn("block h-[34px] w-24", className)} aria-hidden="true" />;
  const w = 96;
  const h = 34;
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const r = max - min || 1;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * w, h - 3 - ((v - min) / r) * (h - 6)]);
  const l = `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-[34px] w-24 shrink-0", className)} aria-hidden="true">
      <path d={`${l} L${w} ${h} L0 ${h}Z`} className="fill-[rgb(57_65_71/0.07)]" />
      <path d={l} className="fill-none stroke-[#394147]" strokeWidth={1.6} />
    </svg>
  );
}

interface Cifra {
  nombre: string;
  valor: string;
  variacion: number | null;
  serie: number[];
}

/** Las 3 cifras del Estudio (alcance, interacciones, seguidores nuevos) de los últimos 28 días. */
export function cifrasEstudio(datos: DatosMetricas | null): Cifra[] {
  const r = datos?.resumen?.d28;
  if (!r) return [];
  const serie = (datos?.serie ?? []).slice(-28);
  const de = (k: keyof PuntoSerie) => serie.map((p) => p[k]).filter((v): v is number => typeof v === "number");
  const seguidores = de("seguidores");
  const cambio = r.metricas.seguidores.cambio;
  return [
    { nombre: "Alcance", valor: formatearNumero(r.metricas.alcance.actual), variacion: r.metricas.alcance.variacion, serie: de("alcance") },
    { nombre: "Interacciones", valor: formatearNumero(r.metricas.interacciones.actual), variacion: r.metricas.interacciones.variacion, serie: de("interacciones") },
    {
      nombre: "Seguidores nuevos",
      valor: typeof cambio === "number" ? `${cambio > 0 ? "+" : ""}${formatearNumero(cambio)}` : "—",
      variacion: r.metricas.seguidores.variacion,
      serie: seguidores,
    },
  ];
}

function Tarjeta({ titulo, accion, children, className }: { titulo: React.ReactNode; accion?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-h-0 flex-col rounded-xl border bg-card", className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 px-3.5 pb-2 pt-3">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {accion}
      </header>
      {children}
    </section>
  );
}

function Enlace({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-[#926a26] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

/** Miniatura pequeña de un evento en la semana (26 px; programada con contorno oro). */
function MiniDia({ e, onAbrir }: { e: EventoCalendario; onAbrir: (id: string) => void }) {
  const titulo = `${tituloEvento(e)} · ${e.hora} · ${ESTADOS_CALENDARIO[e.estado].etiqueta}`;
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onAbrir(e.piezaId);
      }}
      title={titulo}
      aria-label={titulo}
      data-testid="mini-semana"
      data-estado={e.estado}
      className={cn(
        "relative h-7 w-7 shrink-0 overflow-hidden rounded-md outline-2 outline-offset-1 focus-visible:ring-2 focus-visible:ring-ring",
        e.estado === "programada" && "outline",
        ESTILO_TONO[ESTADOS_CALENDARIO[e.estado].tono].contorno,
        e.tipo === "borrador" && "border border-dashed border-[#9b8a7d]",
      )}
    >
      {e.tipo === "publicada" ? (
        <span className="flex h-full w-full items-center justify-center bg-[rgb(17_126_57/0.1)] text-[#117e39]">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ) : (
        <Miniatura evento={e} className="h-full w-full !aspect-auto" />
      )}
    </button>
  );
}

export function EstudioInstagram({ marca, onIr, onVerDia, onAbrirPieza, onNuevaPieza, onCrearIdea, onAbrirEncargo, onPedirEncargo, className }: EstudioInstagramProps) {
  const hoy = hoyMadrid();
  const lunes = inicioSemana(hoy);
  // Una sola consulta: desde el lunes hasta dentro de un mes (semana + próximas).
  const [rango] = useState(() => ({ desde: madridAUtc(lunes, "00:00") as Date, hasta: madridAUtc(sumarDias(hoy, 31), "00:00") as Date }));
  const calendario = useCalendarioInstagram(rango.desde, rango.hasta);
  const eventos = useMemo(
    () =>
      construirEventos(calendario.data?.programaciones ?? [], calendario.data?.publicadas ?? [], calendario.data?.borradores ?? []).filter(
        (e) => marca === "todas" || e.marca === marca,
      ),
    [calendario.data, marca],
  );
  const porDia = useMemo(() => agruparPorDia(eventos), [eventos]);
  const ahora = Date.now();
  const proximas = eventos.filter((e) => e.tipo !== "publicada" && new Date(e.instante).getTime() >= ahora - 60 * 60_000).slice(0, 20);

  const roles = useRolesEncargos();
  const encargos = useEncargos(!roles.cargando && (roles.restaurante || roles.agencia));
  const abiertos = useMemo(() => {
    const lista = (encargos.data ?? []).filter((e) => ABIERTOS.has(e.estado) && (marca === "todas" || e.marca === marca));
    const espera = (e: Encargo) => (esperaA(e) === "restaurante" ? 0 : 1);
    return lista.sort((a, b) => espera(a) - espera(b));
  }, [encargos.data, marca]);
  const esperanRevision = abiertos.filter((e) => esperaA(e) === "restaurante").length;

  const metricas = useMetricasInstagram(undefined, marca === "todas" ? null : marca);
  const cifras = cifrasEstudio(metricas.datos);
  const marcaSugerencia: MarcaId = marca === "todas" ? "casa-tomas" : marca;

  return (
    <div className={cn("grid min-h-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(17.5rem,1fr)] lg:grid-rows-[minmax(0,1fr)]", className)} data-testid="estudio-instagram">
      {/* Columna izquierda */}
      <div className="flex min-h-0 flex-col gap-4">
        <Tarjeta titulo={tituloSemana(lunes)} accion={<Enlace onClick={() => onIr("calendario")}>Ver el mes</Enlace>} className="shrink-0">
          <ol className="grid grid-cols-7 gap-1.5 px-3.5 pb-3.5" aria-label="Piezas de la semana" data-testid="semana-estudio">
            {Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)).map((d, i) => {
              const lista = porDia.get(d) ?? [];
              const esHoy = d === hoy;
              const pasado = d < hoy;
              const visibles = lista.slice(0, 4);
              return (
                <li key={d}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onVerDia?.(d)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        onVerDia?.(d);
                      }
                    }}
                    aria-label={`${DIAS_CORTOS[i]} ${Number(d.slice(8))}: ${lista.length ? `${lista.length} ${lista.length === 1 ? "pieza" : "piezas"}` : "sin piezas"}. Ver el día`}
                    aria-current={esHoy ? "date" : undefined}
                    className={cn(
                      "flex min-h-[4.75rem] cursor-pointer flex-col gap-1.5 rounded-lg border border-transparent bg-[#f6f3f1] p-2 transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      esHoy && "border-[#b6852f] bg-background shadow-[inset_0_0_0_1px_#b6852f]",
                      pasado && "opacity-70",
                    )}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {DIAS_CORTOS[i]} <span className="text-[15px] normal-case tracking-normal text-foreground">{Number(d.slice(8))}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {visibles.map((e) => (
                        <MiniDia key={e.clave} e={e} onAbrir={onAbrirPieza} />
                      ))}
                      {lista.length > visibles.length && <span className="self-center text-xs text-muted-foreground">+{lista.length - visibles.length}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </Tarjeta>

        <SugerenciaSemana
          destacada
          marca={marcaSugerencia}
          className="shrink-0"
          onCrear={onCrearIdea}
          onVerCampanas={() => onIr("campanas")}
          onPedirFoto={(idea) =>
            onPedirEncargo({
              marca: marcaSugerencia,
              modo: "oficiosos",
              formato: idea.formato === "story" ? "story" : "post",
              titulo: `Foto: ${idea.plato?.nombre ?? idea.titulo}`.slice(0, 120),
              idea: `Foto para la idea de la semana «${idea.titulo}». ${idea.idea}`.trim(),
              fecha_deseada: idea.fecha >= hoy ? idea.fecha : "",
            })
          }
        />

        <Tarjeta
          titulo="Próximas publicaciones"
          className="min-h-[12rem] flex-1"
          accion={
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={onNuevaPieza}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Nueva pieza
            </Button>
          }
        >
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5" data-testid="proximas-estudio">
            {calendario.isLoading && (
              <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
              </li>
            )}
            {calendario.error && <li className="p-3 text-sm text-muted-foreground">No se ha podido cargar el calendario ahora.</li>}
            {!calendario.isLoading && !calendario.error && proximas.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">
                No hay nada programado. Crea una pieza o pide ideas a la IA: un post a la semana ya se nota.
              </li>
            )}
            {proximas.map((e) => (
              <li key={e.clave} className="border-t first:border-t-0 border-[#efebe8]">
                <button
                  type="button"
                  onClick={() => onAbrirPieza(e.piezaId)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-[#f6f3f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Miniatura evento={e} className="w-12" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{tituloEvento(e)}</span>
                    <span className="text-xs text-muted-foreground">
                      {textoInstante(e.instante)} · {e.pieza?.formato === "story" ? "Story" : "Post"}
                    </span>
                  </span>
                  <MarcaMini marca={e.marca} />
                  <InsigniaEstado dominio="calendario" estado={e.estado} />
                </button>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </div>

      {/* Columna derecha */}
      <div className="flex min-h-0 flex-col gap-4">
        <Tarjeta titulo="Últimos 28 días" accion={<Enlace onClick={() => onIr("metricas")}>Métricas</Enlace>} className="shrink-0">
          <div className="px-3.5 pb-2" data-testid="cifras-estudio">
            {metricas.cargando && (
              <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando cifras…
              </p>
            )}
            {!metricas.cargando && cifras.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">Aún no hay cifras de Instagram. Cuando lleguen, verás aquí el alcance, las interacciones y los seguidores.</p>
            )}
            {cifras.map((c) => (
              <div key={c.nombre} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2.5 border-t border-[#efebe8] py-2.5 first:border-t-0">
                <div>
                  <div className="text-xs text-muted-foreground">{c.nombre}</div>
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-[22px] font-semibold tabular-nums tracking-tight">{c.valor}</span>
                    {typeof c.variacion === "number" && (
                      <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", c.variacion >= 0 ? "text-[#117e39]" : "text-[#b42318]")}>
                        {c.variacion >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                        {textoVariacion(c.variacion)}
                      </span>
                    )}
                  </div>
                </div>
                <Chispa valores={c.serie} />
              </div>
            ))}
          </div>
        </Tarjeta>

        <Tarjeta
          titulo={
            <>
              Encargos abiertos
              {esperanRevision > 0 && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {esperanRevision} {esperanRevision === 1 ? "espera" : "esperan"} tu revisión
                </span>
              )}
            </>
          }
          accion={<Enlace onClick={() => onIr("encargos")}>Tablero</Enlace>}
          className="min-h-[12rem] flex-1"
        >
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5" data-testid="encargos-estudio">
            {encargos.isLoading && (
              <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
              </li>
            )}
            {!encargos.isLoading && abiertos.length === 0 && <li className="p-3 text-sm text-muted-foreground">No hay encargos abiertos.</li>}
            {abiertos.map((e) => {
              const Icono = ICONO_FORMATO[e.formato] ?? ImageIcon;
              return (
                <li key={e.id} className="border-t first:border-t-0 border-[#efebe8]">
                  <button
                    type="button"
                    onClick={() => onAbrirEncargo(e.id)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-[#f6f3f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#f6f3f1] text-muted-foreground">
                      <Icono className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.titulo}</span>
                      <span className="text-xs text-muted-foreground">
                        {e.formato === "reel" ? "Vídeo" : e.formato === "story" ? "Story" : "Post"} · {NOMBRE_MODO[e.modo]}
                        {e.fecha_deseada ? ` · para el ${fechaCorta(e.fecha_deseada)}` : ""}
                      </span>
                    </span>
                    <InsigniaEstado dominio="encargo" estado={e.estado} />
                  </button>
                </li>
              );
            })}
          </ul>
          {roles.restaurante && (
            <div className="shrink-0 border-t p-3">
              <Button type="button" variant="outline" className="w-full" onClick={() => onPedirEncargo()}>
                <Clapperboard className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Pedir un vídeo o una pieza
              </Button>
            </div>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
