import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ExternalLink, ImageOff, KeyRound, RefreshCw, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AyudaPopover } from "@/components/AyudaPopover";
import { TiraCifras, type CifraTira } from "@/components/panel/TiraCifras";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { cn } from "@/lib/utils";
import { ErrorMetricas } from "./api";
import {
  formatearNumero,
  formatearPorcentaje,
  interaccionesDe,
  nombreMarca,
  nombrePlantilla,
  nombreTipoFoto,
  ordenarPublicaciones,
  queFuncionaMejor,
  tasaDe,
  textoVariacion,
  tipoFotoDe,
  type GrupoRendimiento,
} from "./agregacion";
import { useMetricasInstagram, type ApiMetricas } from "./useMetricasInstagram";
import type { Captura, Comparacion, DatosMetricas, Publicacion, ResumenPeriodo } from "./tipos";

// SIN SCROLL DE PÁGINA (regla del dueño, 06/10/2026): desde `md` el bloque mide
// el alto que queda hasta el fondo de la pantalla (`useAlturaDisponible`) y
// solo hacen scroll la lista de publicaciones y «Qué funciona mejor». En móvil
// (< md) va todo en columna y desplaza la pestaña entera, como Newsletter.

const ALTURA_MINIMA = 520;

const ESTILO_TOOLTIP = {
  backgroundColor: "hsl(var(--background))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
} as const;

const SERIES = [
  { clave: "alcance", nombre: "Alcance", color: "#3b82f6", eje: "izq" },
  { clave: "seguidores", nombre: "Seguidores", color: "#22c55e", eje: "der" },
] as const;

const TEXTO_AYUDA =
  "Datos de la API oficial de Instagram. Se capturan cada día a las 06:00 (07:00 en verano) y Meta puede tardar hasta 48 h en darlos completos. " +
  "El alcance del periodo es la suma del alcance de cada día: una cuenta que vio contenido tres días cuenta tres veces. " +
  "La variación compara con el periodo anterior de la misma duración. Las métricas de cada publicación son las acumuladas desde que se publicó.";

const PRODUCTO: Record<string, string> = { FEED: "Publicación", REELS: "Reel", STORY: "Historia", AD: "Anuncio" };

export interface MetricasInstagramProps {
  /** Para pruebas: llamadas simuladas en vez de la Edge Function. */
  api?: ApiMetricas;
  className?: string;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "d MMM yyyy", { locale: es });
  } catch {
    return "—";
  }
}

function hace(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  try {
    return formatDistanceToNow(parseISO(iso), { locale: es, addSuffix: true });
  } catch {
    return "—";
  }
}

function Variacion({ c, invertir = false }: { c: Comparacion; invertir?: boolean }) {
  if (c.variacion === null) return <span className="text-muted-foreground">{textoVariacion(null)}</span>;
  const bueno = invertir ? c.variacion < 0 : c.variacion > 0;
  return (
    <span className={cn(c.variacion === 0 ? "text-muted-foreground" : bueno ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {textoVariacion(c.variacion)}
    </span>
  );
}

function cifras(r: ResumenPeriodo): CifraTira[] {
  const m = r.metricas;
  const cambio = m.seguidores.cambio;
  return [
    {
      etiqueta: "Seguidores",
      valor: formatearNumero(m.seguidores.actual),
      detalle: cambio === null ? <Variacion c={m.seguidores} /> : <span>{cambio >= 0 ? `+${formatearNumero(cambio)}` : `−${formatearNumero(-cambio)}`}</span>,
    },
    { etiqueta: "Alcance (suma diaria)", valor: formatearNumero(m.alcance.actual), detalle: <Variacion c={m.alcance} /> },
    { etiqueta: "Visualizaciones", valor: formatearNumero(m.visualizaciones.actual), detalle: <Variacion c={m.visualizaciones} /> },
    { etiqueta: "Interacciones", valor: formatearNumero(m.interacciones.actual), detalle: <Variacion c={m.interacciones} /> },
    { etiqueta: "Cuentas que interactúan", valor: formatearNumero(m.cuentasInteraccion.actual), detalle: <Variacion c={m.cuentasInteraccion} /> },
    { etiqueta: "Visitas al perfil", valor: formatearNumero(m.visitasPerfil.actual), detalle: <Variacion c={m.visitasPerfil} /> },
  ];
}

/** Aviso de permiso que falta / secretos / otro error de la última captura. */
function AvisoCaptura({ error, captura }: { error: Error | null; captura: Captura | null }) {
  const e = error instanceof ErrorMetricas ? error : null;
  const permiso = e?.tipo === "permiso_insights" || (!error && captura?.ok === false && captura.errorTipo === "permiso_insights");
  if (permiso) {
    return (
      <Alert className="border-amber-500/60" data-testid="aviso-permiso">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Falta el permiso «instagram_manage_insights»</AlertTitle>
        <AlertDescription className="space-y-1 text-sm">
          <p>Sin ese permiso Meta no deja leer las métricas de la cuenta.</p>
          <p>
            Añádelo en <strong>Meta Business Suite → Configuración del negocio → Usuarios → Usuarios del sistema</strong> → (tu usuario) →
            «Generar token», marcando <code>instagram_basic</code>, <code>instagram_content_publish</code> e <code>instagram_manage_insights</code>.
            Cambia después el secreto <code>IG_ACCESS_TOKEN</code> en Supabase y pulsa «Actualizar ahora».
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  if (e && e.tipo !== "demasiado_pronto") {
    return (
      <Alert variant="destructive" data-testid="aviso-captura">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>No se pudieron actualizar las métricas</AlertTitle>
        <AlertDescription className="space-y-1 text-sm">
          <p>{e.message}</p>
          {e.comoArreglarlo.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </AlertDescription>
      </Alert>
    );
  }
  if (!error && captura && !captura.ok && captura.error) {
    return (
      <Alert variant="destructive" data-testid="aviso-captura">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>La última captura falló ({hace(captura.inicio)})</AlertTitle>
        <AlertDescription className="text-sm">{captura.error}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function Miniatura({ p }: { p: Publicacion }) {
  const [rota, setRota] = useState(false);
  if (!p.miniaturaUrl || rota) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground" aria-hidden="true">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={p.miniaturaUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setRota(true)}
      className="h-14 w-14 shrink-0 rounded object-cover"
    />
  );
}

function FilaPublicacion({ p }: { p: Publicacion }) {
  const tipo = tipoFotoDe(p);
  const titulo = p.caption?.split("\n")[0]?.trim() || (p.plantilla ? nombrePlantilla(p.plantilla) : "Sin texto");
  return (
    <li className="flex gap-3 py-2" data-testid="publicacion">
      <Miniatura p={p} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium" title={p.caption ?? undefined}>
            {titulo}
          </p>
          {p.permalink && (
            <a
              href={p.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              Ver <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">en Instagram</span>
            </a>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{fechaCorta(p.publicadoAt)}</span>
          {p.producto && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{PRODUCTO[p.producto] ?? p.producto}</Badge>}
          {p.marca && <span>· {nombreMarca(p.marca)}</span>}
          {p.plantilla && <span>· {nombrePlantilla(p.plantilla)}</span>}
          {tipo && <span>· {nombreTipoFoto(tipo)}</span>}
        </div>
        <dl className="mt-1 grid grid-cols-4 gap-1 text-xs">
          <div>
            <dt className="text-muted-foreground">Alcance</dt>
            <dd className="tabular-nums">{formatearNumero(p.alcance)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Interacciones</dt>
            <dd className="tabular-nums">{formatearNumero(interaccionesDe(p))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Me gusta</dt>
            <dd className="tabular-nums">{formatearNumero(p.meGusta)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tasa</dt>
            <dd className="tabular-nums">{formatearPorcentaje(tasaDe(p))}</dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

function TablaGrupos({ titulo, grupos }: { titulo: string; grupos: GrupoRendimiento[] }) {
  return (
    <section aria-label={titulo}>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      {grupos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin datos todavía.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">&nbsp;</th>
              <th className="py-1 text-right font-normal">Publ.</th>
              <th className="py-1 text-right font-normal">Alcance medio</th>
              <th className="py-1 text-right font-normal">Interacción media</th>
              <th className="py-1 text-right font-normal">Tasa</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g, i) => (
              <tr key={g.clave} className="border-t">
                <td className={cn("py-1 pr-2", i === 0 && grupos.length > 1 && "font-semibold")}>{g.etiqueta}</td>
                <td className="py-1 text-right tabular-nums">{g.publicaciones}</td>
                <td className="py-1 text-right tabular-nums">{formatearNumero(g.alcanceMedio)}</td>
                <td className="py-1 text-right tabular-nums">{formatearNumero(g.interaccionesMedias)}</td>
                <td className="py-1 text-right tabular-nums">{formatearPorcentaje(g.tasaInteraccion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Grafica({ datos, dias }: { datos: DatosMetricas; dias: number }) {
  const idGrafica = useId();
  const serie = useMemo(() => datos.serie.slice(-dias), [datos.serie, dias]);
  return (
    <Card className="flex h-64 flex-col p-3 md:h-auto md:min-h-[12rem] md:flex-1">
      <figure aria-labelledby={idGrafica} className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <CardTitle id={idGrafica} className="flex items-center gap-1.5 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Alcance diario y seguidores · últimos {dias} días
          </CardTitle>
          <ul aria-label="Leyenda" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {SERIES.map((s) => (
              <li key={s.clave} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                {s.nombre}
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="lienzo-grafica" className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="fecha" tickFormatter={(v) => format(parseISO(v), "d MMM", { locale: es })} className="text-xs" minTickGap={16} />
                <YAxis yAxisId="izq" className="text-xs" allowDecimals={false} width={44} />
                <YAxis yAxisId="der" orientation="right" className="text-xs" allowDecimals={false} width={44} domain={["auto", "auto"]} />
                <Tooltip
                  labelFormatter={(v) => format(parseISO(String(v)), "d MMMM yyyy", { locale: es })}
                  formatter={(v: number | string) => (typeof v === "number" ? formatearNumero(v) : v)}
                  contentStyle={ESTILO_TOOLTIP}
                />
                {SERIES.map((s) => (
                  <Line
                    key={s.clave}
                    yAxisId={s.eje}
                    type="monotone"
                    dataKey={s.clave}
                    name={s.nombre}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={s.clave === "seguidores"}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        {/* Los mismos datos para el lector de pantalla (el SVG no se puede leer). */}
        <div className="sr-only">
          <table>
            <caption>Alcance y seguidores de cada día</caption>
            <thead>
              <tr>
                <th>Día</th>
                <th>Alcance</th>
                <th>Seguidores</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((p) => (
                <tr key={p.fecha}>
                  <td>{p.fecha}</td>
                  <td>{formatearNumero(p.alcance)}</td>
                  <td>{formatearNumero(p.seguidores)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    </Card>
  );
}

function Centro({ children, rol = "status", etiqueta }: { children: ReactNode; rol?: "status" | "alert"; etiqueta?: string }) {
  return (
    <div role={rol} aria-label={etiqueta} className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      {children}
    </div>
  );
}

/**
 * Pestaña «Métricas» de Instagram, autocontenida: lee de la Edge Function
 * instagram-metricas (permiso de lectura de Marketing) y el botón
 * «Actualizar ahora» pide una captura (permiso de edición de Marketing).
 *
 *   import { MetricasInstagram } from "@/components/instagram/metricas";
 *   <MetricasInstagram />
 */
export function MetricasInstagram({ api, className }: MetricasInstagramProps) {
  const m = useMetricasInstagram(api);
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA);
  const [periodo, setPeriodo] = useState<"7" | "28">("7");
  const [orden, setOrden] = useState<"recientes" | "alcance">("recientes");

  const datos = m.datos;
  const mejor = useMemo(() => queFuncionaMejor(datos?.publicaciones ?? []), [datos?.publicaciones]);
  const publicaciones = useMemo(() => ordenarPublicaciones(datos?.publicaciones ?? [], orden), [datos?.publicaciones, orden]);

  const actualizar = () =>
    m.capturar(undefined, {
      onSuccess: (r) => {
        toast.success(`Métricas actualizadas: ${r.publicaciones} publicaciones.`);
        if (r.avisos.length) toast.warning(r.avisos.slice(0, 3).join(" · "));
      },
      onError: (e) => {
        if (e instanceof ErrorMetricas && e.tipo === "demasiado_pronto") toast.info(e.message);
      },
    });

  const botonActualizar = (
    <Button size="sm" variant="outline" onClick={actualizar} disabled={m.capturando} className="min-h-11 md:min-h-9">
      <RefreshCw className={cn("mr-1.5 h-4 w-4", m.capturando && "animate-spin")} aria-hidden="true" />
      {m.capturando ? "Actualizando…" : "Actualizar ahora"}
    </Button>
  );

  let cuerpo: ReactNode;
  if (m.cargando) {
    cuerpo = (
      <Centro etiqueta="Cargando las métricas">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </Centro>
    );
  } else if (m.error) {
    const e = m.error instanceof ErrorMetricas ? m.error : null;
    cuerpo = (
      <Centro rol="alert">
        <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <p className="font-medium">No se pudieron cargar las métricas</p>
        <p className="max-w-xl text-sm text-muted-foreground">{m.error.message}</p>
        {e?.comoArreglarlo.map((p) => (
          <p key={p} className="max-w-xl text-sm text-muted-foreground">
            {p}
          </p>
        ))}
        <Button size="sm" variant="outline" onClick={() => m.recargar()}>
          Reintentar
        </Button>
      </Centro>
    );
  } else if (!datos || (!datos.resumen && datos.publicaciones.length === 0)) {
    cuerpo = (
      <div className="space-y-3">
        <AvisoCaptura error={m.errorCaptura} captura={datos?.ultimaCaptura ?? null} />
        <Centro etiqueta="Sin métricas todavía">
          <TrendingUp className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Todavía no hay métricas</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Se capturan solas cada día a las 06:00. Pulsa «Actualizar ahora» para traer las de los últimos días.
          </p>
          {botonActualizar}
        </Centro>
      </div>
    );
  } else {
    const resumen = datos.resumen ? (periodo === "7" ? datos.resumen.d7 : datos.resumen.d28) : null;
    cuerpo = (
      <>
        <AvisoCaptura error={m.errorCaptura} captura={datos.ultimaCaptura} />
        {resumen ? (
          <div className="space-y-1">
            <TiraCifras cifras={cifras(resumen)} data-testid="resumen-metricas" />
            <p className="text-xs text-muted-foreground">
              Del {fechaCorta(resumen.desde)} al {fechaCorta(resumen.hasta)} frente a los {resumen.dias} días anteriores
              {resumen.diasConDatos < resumen.dias && ` · ${resumen.diasConDatos} de ${resumen.dias} días con datos`}
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-3 md:min-h-0">
            {datos.serie.length > 0 && <Grafica datos={datos} dias={Number(periodo)} />}
            <Card className="flex flex-col p-3 md:min-h-0 md:flex-1" data-testid="que-funciona-mejor">
              <div className="mb-2 flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium">Qué funciona mejor</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {mejor.conPieza} publicaciones del panel{mejor.sinPieza > 0 && ` · ${mejor.sinPieza} de fuera no cuentan`}
                </span>
              </div>
              <div className="space-y-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1">
                <TablaGrupos titulo="Por plantilla" grupos={mejor.porPlantilla} />
                <TablaGrupos titulo="Por marca" grupos={mejor.porMarca} />
                <TablaGrupos titulo="Por tipo de foto" grupos={mejor.porTipoFoto} />
              </div>
            </Card>
          </div>

          <Card className="flex flex-col p-3 md:min-h-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">Publicaciones ({publicaciones.length})</CardTitle>
              <ToggleGroup
                type="single"
                size="sm"
                value={orden}
                onValueChange={(v) => v && setOrden(v as "recientes" | "alcance")}
                aria-label="Orden de las publicaciones"
              >
                <ToggleGroupItem value="recientes" className="text-xs">
                  Recientes
                </ToggleGroupItem>
                <ToggleGroupItem value="alcance" className="text-xs">
                  Más alcance
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {publicaciones.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sin publicaciones capturadas.</p>
            ) : (
              <ul className="divide-y md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1" data-testid="lista-publicaciones">
                {publicaciones.map((p) => (
                  <FilaPublicacion key={p.mediaId} p={p} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </>
    );
  }

  return (
    <div
      ref={setRaiz}
      data-testid="metricas-instagram"
      className={cn("flex flex-col gap-3 md:h-[var(--alto-metricas)] md:min-h-0 md:overflow-hidden", className)}
      style={alto ? ({ "--alto-metricas": `${alto}px` } as CSSProperties) : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">Métricas de Instagram</h3>
          <AyudaPopover etiqueta="Qué cuentan estas métricas">{TEXTO_AYUDA}</AyudaPopover>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {datos?.resumen && (
            <ToggleGroup
              type="single"
              size="sm"
              value={periodo}
              onValueChange={(v) => v && setPeriodo(v as "7" | "28")}
              aria-label="Periodo del resumen"
            >
              <ToggleGroupItem value="7">7 días</ToggleGroupItem>
              <ToggleGroupItem value="28">28 días</ToggleGroupItem>
            </ToggleGroup>
          )}
          {datos && (
            <span className="text-xs text-muted-foreground" data-testid="ultima-actualizacion">
              Actualizado {hace(datos.ultimaCorrecta?.fin ?? datos.ultimaCorrecta?.inicio)}
            </span>
          )}
          {datos && (datos.resumen || datos.publicaciones.length > 0) && botonActualizar}
        </div>
      </div>
      {cuerpo}
    </div>
  );
}
