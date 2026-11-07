// La gráfica del explorador (recharts) y su tabla alternativa.
//
//   · Barras, barras apiladas, líneas, área y ranking horizontal; ejes en
//     es-ES («120 k €»), rejilla suave, colores fijos por entidad (explorador.ts).
//   · Tocar una barra o un punto lo SELECCIONA (onSeleccion): el explorador
//     enseña debajo qué se puede hacer con él (filtrar, ver documentos…).
//   · La gráfica es una imagen con su resumen (role="img"); lo navegable con
//     teclado es la TABLA, donde cada fila y cada celda son botones.
import { useId, useMemo, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatEntero } from "@/components/facturas/shared/formatters";
import {
  COLOR_UNICO,
  datosGrafica,
  etiquetaAgrupar,
  formatoEje,
  formatoValor,
  type Exploracion,
  type FilaGrafica,
  type SerieGrafica,
  type TipoGrafica,
} from "@/lib/facturas/explorador";
import { FOCO } from "./piezas";
import { esTactil } from "./desplazar";
import type { AlertaFacturas } from "@/lib/facturas/alertas";
import { MarcasDeGrafica } from "./Alertas";

// 12 px como mínimo (texto < 12 px, QA 05/11/2026).
const EJE = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };
const REJILLA = "hsl(var(--border))";

interface PropsGrafica {
  exploracion: Exploracion;
  tipo: Exclude<TipoGrafica, "tabla">;
  alto?: number;
  seleccion?: string | null;
  onSeleccion?: (clave: string) => void;
  apartarSinClasificar?: boolean;
  /** Resumen para lectores de pantalla (va como nombre de la imagen). */
  descripcion: string;
  compacta?: boolean;
  /** Qué se cuenta en el globo («3 documentos»); null, nada. Las de «Al instante» por categoría cuentan líneas. */
  cuenta?: { uno: string; varios: string } | null;
  /** Alertas de Facturas por clave de punto (20261107300000): marca en el punto y botón debajo. */
  alertas?: Map<string, AlertaFacturas[]>;
  /** Línea horizontal discontinua (p. ej. el precio de referencia de un producto). */
  referencia?: { valor: number; etiqueta: string } | null;
  onIrA?: (enlace: string) => void;
}

/** Triángulo de aviso dibujado sobre el punto (ámbar; rojo si alguna alerta es importante). */
function FormaAviso({ cx, cy, alta }: { cx?: number; cy?: number; alta: boolean }) {
  if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const y = cy - 12;
  const color = alta ? "#dc2626" : "#d97706";
  return (
    <g pointerEvents="none" aria-hidden>
      <path d={`M ${cx} ${y - 7} L ${cx + 7.5} ${y + 6} L ${cx - 7.5} ${y + 6} Z`} fill={color} stroke="hsl(var(--background))" strokeWidth={1.5} />
      <text x={cx} y={y + 4.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">
        !
      </text>
    </g>
  );
}

const CUENTA_DOCUMENTOS = { uno: "documento", varios: "documentos" };

/** Muestra de la trama de un mes incompleto (la misma que la barra). */
const MuestraTrama = () => (
  <span
    className="h-2.5 w-2.5 shrink-0 rounded-sm border border-dashed"
    style={{ borderColor: COLOR_UNICO, background: `repeating-linear-gradient(45deg, ${COLOR_UNICO} 0 2px, transparent 2px 4px)`, opacity: 0.7 }}
    aria-hidden
  />
);

function Leyenda({ series, incompletos }: { series: SerieGrafica[]; incompletos: boolean }) {
  if (series.length === 0 && !incompletos) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Leyenda">
      {incompletos && (
        <li className="flex min-w-0 items-center gap-1.5 font-medium text-amber-800 dark:text-amber-400" data-testid="leyenda-mes-incompleto">
          <MuestraTrama />
          <span>Mes incompleto: faltan facturas por subir</span>
        </li>
      )}
      {series.map((s) => (
        <li key={s.clave} className="flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
          <span className="line-clamp-2 max-w-[12rem] break-words">
            {s.etiqueta}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Globo({
  active,
  payload,
  series,
  medida,
  unidad,
  cuenta,
  elegible,
  alertas,
}: TooltipProps<number, string> & {
  series: SerieGrafica[];
  medida: Exploracion["parametros"]["medida"];
  unidad: string | null;
  cuenta: { uno: string; varios: string } | null;
  /** «toca para elegir» solo si tocar hace algo (las gráficas de «Al instante» no eligen). */
  elegible: boolean;
  alertas?: Map<string, AlertaFacturas[]>;
}) {
  if (!active || !payload?.length) return null;
  const fila = payload[0]?.payload as FilaGrafica | undefined;
  if (!fila) return null;
  return (
    <div className="max-w-[18rem] rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{fila.larga}</p>
      {series.length > 0 && (
        <ul className="mb-1 space-y-0.5">
          {series
            // Sin las series a 0 (los tramos sin compras se rellenan con 0 para dibujar la línea).
            .filter((s) => (fila[s.dato] ?? 0) !== 0)
            .map((s) => (
              <li key={s.clave} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
                <span className="min-w-0 flex-1 break-words">{s.etiqueta}</span>
                <span className="tabular-nums">{formatoValor(fila[s.dato] ?? null, medida, unidad)}</span>
              </li>
            ))}
        </ul>
      )}
      <p className="flex items-baseline gap-2 border-t border-border/60 pt-1">
        <span className="flex-1 text-muted-foreground">{series.length ? "Total" : "Valor"}</span>
        <span className="font-semibold tabular-nums">{formatoValor(fila.valor, medida, unidad)}</span>
      </p>
      {fila.incompleto && <p className="font-medium text-amber-800 dark:text-amber-400">Mes incompleto: faltan facturas por subir</p>}
      {alertas?.get(fila.clave)?.map((a) => (
        <p key={a.id} className={a.prioridad === "alta" ? "font-medium text-red-700 dark:text-red-400" : "font-medium text-amber-800 dark:text-amber-400"}>
          ⚠ {a.titulo}
        </p>
      ))}
      {(cuenta || elegible) && (
        <p className="text-muted-foreground">
          {cuenta && (fila.documentos === 1 ? `1 ${cuenta.uno}` : `${formatEntero(fila.documentos)} ${cuenta.varios}`)}
          {cuenta && elegible && " · "}
          {elegible && "toca para elegir"}
        </p>
      )}
    </div>
  );
}

export function GraficaExplorador({
  exploracion,
  tipo,
  alto = 300,
  seleccion,
  onSeleccion,
  apartarSinClasificar,
  descripcion,
  compacta,
  cuenta = CUENTA_DOCUMENTOS,
  alertas,
  referencia,
  onIrA,
}: PropsGrafica) {
  const { filas, series } = useMemo(() => datosGrafica(exploracion, { apartarSinClasificar }), [exploracion, apartarSinClasificar]);
  const { medida, unidad } = exploracion.parametros;
  const ejeY = (n: number) => formatoEje(n, medida, unidad);
  const elegir = (e: unknown) => {
    const fila = (e as { activePayload?: { payload?: FilaGrafica }[] } | null)?.activePayload?.[0]?.payload;
    if (fila && onSeleccion) onSeleccion(fila.clave);
  };
  const opacidad = (clave: string) => (seleccion && seleccion !== clave ? 0.35 : 1);
  // Meses incompletos (faltan facturas): barra con trama (una serie) o atenuada y con
  // borde discontinuo (varias series), y una línea en la leyenda.
  const idTrama = `trama-incompleto-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hayIncompletos = filas.some((f) => f.incompleto);
  const trama = hayIncompletos && (
    <defs>
      <pattern id={idTrama} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={COLOR_UNICO} fillOpacity={0.3} />
        <line x1="0" y1="0" x2="0" y2="6" stroke={COLOR_UNICO} strokeWidth="2.5" />
      </pattern>
    </defs>
  );
  const celdaUnica = (f: FilaGrafica) => (
    <Cell
      key={f.clave}
      fillOpacity={opacidad(f.clave)}
      cursor={onSeleccion ? "pointer" : undefined}
      {...(f.incompleto ? { fill: `url(#${idTrama})`, stroke: COLOR_UNICO, strokeDasharray: "3 2" } : {})}
    />
  );
  const celdaSerie = (f: FilaGrafica, color: string) => (
    <Cell
      key={f.clave}
      fillOpacity={opacidad(f.clave) * (f.incompleto ? 0.4 : 1)}
      cursor={onSeleccion ? "pointer" : undefined}
      {...(f.incompleto ? { stroke: color, strokeDasharray: "3 2" } : {})}
    />
  );
  // Con el dedo el globo se queda pegado y tapa la tira «Punto elegido»: con un
  // punto elegido, se oculta (con ratón sigue al pasar por encima).
  const sinGlobo = !!seleccion && esTactil();
  const globo = (
    <Tooltip
      content={<Globo series={series} medida={medida} unidad={unidad} cuenta={cuenta} elegible={!!onSeleccion} alertas={alertas} />}
      cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
      {...(sinGlobo ? { active: false } : {})}
    />
  );
  // Abonos con «−» también en la cifra de cada barra.
  const cifraBarra = (v: number) => formatoEje(medida === "abonos" ? -Math.abs(v) : v, medida, unidad);
  // Alertas: un triángulo sobre cada punto con alguna (en el precio, a la altura del precio que avisa).
  const conAlertas = alertas && alertas.size > 0 ? filas.filter((f) => (alertas.get(f.clave)?.length ?? 0) > 0) : [];
  const yAviso = (f: FilaGrafica): number | null => {
    if (medida === "precio") {
      const ps = (alertas?.get(f.clave) ?? []).map((a) => a.datos.precioUd).filter((x): x is number => x !== null);
      if (ps.length) return Math.max(...ps);
    }
    return f.valor;
  };
  const avisos = (vertical: boolean) =>
    conAlertas.map((f) => {
      const y = yAviso(f);
      if (y === null) return null;
      const alta = (alertas?.get(f.clave) ?? []).some((a) => a.prioridad === "alta");
      const forma = (dx: number, dy: number) => (p: { cx?: number; cy?: number }) => (
        <FormaAviso cx={p.cx === undefined ? undefined : p.cx + dx} cy={p.cy === undefined ? undefined : p.cy + dy} alta={alta} />
      );
      return vertical ? (
        <ReferenceDot key={`aviso-${f.clave}`} x={f.corta} y={y} r={0} ifOverflow="extendDomain" shape={forma(0, 0)} />
      ) : (
        <ReferenceDot key={`aviso-${f.clave}`} x={y} y={f.corta} r={0} ifOverflow="extendDomain" shape={forma(14, 12)} />
      );
    });
  const lineaRef = referencia ? (
    <ReferenceLine
      y={referencia.valor}
      ifOverflow="extendDomain"
      stroke="#b45309"
      strokeDasharray="5 4"
      strokeWidth={1.5}
      label={{ value: `${referencia.etiqueta}: ${formatoValor(referencia.valor, medida, unidad)}`, position: "insideTopLeft", fontSize: 12, fill: "#92400e" }}
    />
  ) : null;
  const margen = { top: conAlertas.length || referencia ? 22 : 8, right: 12, bottom: 0, left: 0 };
  const anchoEjeY = compacta ? 52 : 64;

  let grafica: ReactNode;
  if (tipo === "horizontales") {
    const altoH = Math.max(compacta ? 140 : 180, filas.length * (compacta ? 24 : 32) + 32);
    grafica = (
      <ResponsiveContainer width="100%" height={altoH}>
        <BarChart data={filas} layout="vertical" margin={{ ...margen, right: series.length === 0 ? 56 : 12 }} onClick={elegir} barCategoryGap={compacta ? 3 : 6}>
          {trama}
          <CartesianGrid horizontal={false} stroke={REJILLA} strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={ejeY} tick={EJE} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="corta" width={compacta ? 110 : 160} tick={EJE} axisLine={false} tickLine={false} interval={0} />
          {globo}
          {avisos(false)}
          {series.length === 0 ? (
            <Bar dataKey="valor" fill={COLOR_UNICO} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {filas.map(celdaUnica)}
              {/* En tablet no hay «pasar el ratón»: la cifra, al final de cada barra. */}
              <LabelList dataKey="valor" position="right" formatter={cifraBarra} className="fill-foreground text-xs tabular-nums" />
            </Bar>
          ) : (
            series.map((s, i) => (
              <Bar key={s.clave} dataKey={s.dato} name={s.etiqueta} stackId="a" fill={s.color} isAnimationActive={false} radius={i === series.length - 1 ? [0, 4, 4, 0] : 0}>
                {filas.map((f) => celdaSerie(f, s.color))}
              </Bar>
            ))
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  } else if (tipo === "lineas") {
    grafica = (
      <ResponsiveContainer width="100%" height={alto}>
        <LineChart data={filas} margin={margen} onClick={elegir}>
          <CartesianGrid vertical={false} stroke={REJILLA} strokeDasharray="3 3" />
          <XAxis dataKey="corta" tick={EJE} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tickFormatter={ejeY} tick={EJE} axisLine={false} tickLine={false} width={anchoEjeY} />
          {globo}
          {lineaRef}
          {(series.length ? series : [{ clave: "valor", dato: "valor" as const, color: COLOR_UNICO, etiqueta: "" }]).map((s) => (
            <Line
              key={s.clave}
              type="monotone"
              dataKey={s.dato}
              stroke={s.color}
              strokeWidth={2}
              dot={filas.length <= 40 ? { r: 3, strokeWidth: 0, fill: s.color } : false}
              activeDot={{ r: 6 }}
              connectNulls={medida === "precio"}
              isAnimationActive={false}
            />
          ))}
          {avisos(true)}
        </LineChart>
      </ResponsiveContainer>
    );
  } else if (tipo === "area") {
    grafica = (
      <ResponsiveContainer width="100%" height={alto}>
        <AreaChart data={filas} margin={margen} onClick={elegir}>
          <CartesianGrid vertical={false} stroke={REJILLA} strokeDasharray="3 3" />
          <XAxis dataKey="corta" tick={EJE} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tickFormatter={ejeY} tick={EJE} axisLine={false} tickLine={false} width={anchoEjeY} />
          {globo}
          {(series.length ? series : [{ clave: "valor", dato: "valor" as const, color: COLOR_UNICO, etiqueta: "" }]).map((s) => (
            <Area
              key={s.clave}
              type="monotone"
              dataKey={s.dato}
              stackId={series.length ? "a" : undefined}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.25}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
          {lineaRef}
          {avisos(true)}
        </AreaChart>
      </ResponsiveContainer>
    );
  } else {
    const apilar = tipo === "apiladas";
    grafica = (
      <ResponsiveContainer width="100%" height={alto}>
        <BarChart data={filas} margin={margen} onClick={elegir} barCategoryGap={filas.length > 40 ? 1 : "18%"}>
          {trama}
          <CartesianGrid vertical={false} stroke={REJILLA} strokeDasharray="3 3" />
          <XAxis dataKey="corta" tick={EJE} axisLine={false} tickLine={false} minTickGap={8} />
          <YAxis tickFormatter={ejeY} tick={EJE} axisLine={false} tickLine={false} width={anchoEjeY} />
          {globo}
          {series.length === 0 ? (
            <Bar dataKey="valor" fill={COLOR_UNICO} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {filas.map(celdaUnica)}
            </Bar>
          ) : (
            series.map((s, i) => (
              <Bar
                key={s.clave}
                dataKey={s.dato}
                name={s.etiqueta}
                stackId={apilar ? "a" : undefined}
                fill={s.color}
                isAnimationActive={false}
                radius={!apilar || i === series.length - 1 ? [4, 4, 0, 0] : 0}
              >
                {filas.map((f) => celdaSerie(f, s.color))}
              </Bar>
            ))
          )}
          {lineaRef}
          {avisos(true)}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Leyenda series={series} incompletos={hayIncompletos} />
      <div role="img" aria-label={descripcion} className="min-w-0 select-none [&_.recharts-surface]:outline-none">
        {grafica}
      </div>
      {conAlertas.length > 0 && (
        <MarcasDeGrafica puntos={conAlertas.map((f) => ({ clave: f.clave, etiqueta: f.larga, alertas: alertas?.get(f.clave) ?? [] }))} onIrA={onIrA} />
      )}
    </div>
  );
}

// ─── Tabla (alternativa accesible y vista «Tabla») ──────────────────────────

export function TablaExploracion({
  exploracion,
  seleccion,
  onSeleccion,
  onCelda,
  apartarSinClasificar,
  maxAlto = "max-h-80",
}: {
  exploracion: Exploracion;
  seleccion?: string | null;
  onSeleccion?: (clave: string) => void;
  /** Ver los documentos de un punto × serie. */
  onCelda?: (clave: string, serie: string) => void;
  apartarSinClasificar?: boolean;
  maxAlto?: string;
}) {
  const { filas, series } = useMemo(() => datosGrafica(exploracion, { apartarSinClasificar }), [exploracion, apartarSinClasificar]);
  const { medida, unidad } = exploracion.parametros;
  return (
    <div className={cn("overflow-auto rounded-lg border border-border/70", maxAlto)}>
      <table className="w-full min-w-max text-sm tabular-nums">
        <thead className="sticky top-0 z-10 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {etiquetaAgrupar(exploracion.parametros.agrupar)}
            </th>
            {series.map((s) => (
              <th key={s.clave} scope="col" className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {s.etiqueta}
                </span>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {series.length ? "Total" : "Valor"}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Docs.
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} className={cn("border-t border-border/50", seleccion === f.clave && "bg-primary/5")}>
              <th scope="row" className="px-1 py-0 text-left font-normal">
                {onSeleccion ? (
                  <button
                    type="button"
                    onClick={() => onSeleccion(f.clave)}
                    aria-pressed={seleccion === f.clave}
                    className={cn("min-h-11 w-full rounded-md px-2 text-left hover:bg-muted/60", FOCO)}
                  >
                    {f.larga}
                  </button>
                ) : (
                  <span className="block px-2 py-2">{f.larga}</span>
                )}
              </th>
              {series.map((s) => (
                <td key={s.clave} className="px-1 py-0 text-right">
                  {/* Un 0 (tramo sin compras de esa serie) no tiene documentos que ver. */}
                  {onCelda && (f[s.dato] ?? 0) !== 0 ? (
                    <button
                      type="button"
                      onClick={() => onCelda(f.clave, s.clave)}
                      aria-label={`${f.larga}, ${s.etiqueta}: ${formatoValor(f[s.dato] ?? null, medida, unidad)}. Ver documentos`}
                      className={cn("min-h-11 w-full rounded-md px-2 text-right hover:bg-muted/60", FOCO)}
                    >
                      {formatoValor(f[s.dato] ?? null, medida, unidad)}
                    </button>
                  ) : (
                    <span className="block px-2 py-2 text-muted-foreground">{formatoValor(f[s.dato] ?? null, medida, unidad)}</span>
                  )}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-medium">{formatoValor(f.valor, medida, unidad)}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">{formatEntero(f.documentos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
