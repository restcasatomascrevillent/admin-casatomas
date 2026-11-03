/**
 * Gráficas del informe mensual (Recharts, como el resto de Tráfico web).
 * Tamaño fijo en px del lienzo de la diapositiva (1280 × 720): la diapositiva
 * entera se escala al ancho de la pantalla y se rasteriza a ×3 para el PDF,
 * así que aquí no hay ResponsiveContainer. Sin animaciones (la captura del
 * PDF tiene que salir completa a la primera).
 *
 * Marcas según la skill `dataviz`: barras de ≤ 24 px con el extremo de dato
 * redondeado (4 px) y la base recta; líneas de 2 px; marcador ≥ 8 px con anillo
 * del color de fondo; rejilla de línea fina y continua; el texto nunca lleva el
 * color de la serie. Cada barra lleva su valor en la punta (no hay tooltips:
 * el informe se lee como un documento) y las fuentes van como atributos del SVG
 * porque html2canvas pinta cada SVG como una imagen aislada.
 */
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";
import type { DiaSemanaInforme, ItemBarra, PuntoEvolucion } from "./modelo";
import { fmtCuota, fmtEntero, fmtMedia } from "./formatoInforme";
import { COLOR, PILA_FUENTES } from "./tema";

const GROSOR_BARRA = 24;

/**
 * Eje Y con marcas redondas y aire sobre el máximo para la etiqueta del mejor
 * día: 53 → 0, 20, 40, 60, 80. Siempre 3–5 marcas en múltiplos de 1, 2, 2,5 o 5.
 */
function marcasEje(max: number): number[] {
  const conAire = Math.max(1, max * 1.18);
  const bruto = conAire / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) ?? 10 * potencia;
  const pasoEntero = Math.max(1, paso);
  const techo = Math.ceil(conAire / pasoEntero) * pasoEntero;
  const marcas: number[] = [];
  for (let v = 0; v <= techo + 1e-9; v += pasoEntero) marcas.push(Math.round(v * 100) / 100);
  return marcas;
}

const recortar = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

// ─── Evolución diaria ────────────────────────────────────────────────────────
interface GraficoEvolucionProps {
  puntos: PuntoEvolucion[];
  mejorDia: { dia: number; visitas: number } | null;
  hayAnterior: boolean;
  /** Días sin datos: banda gris con «Sin datos» (un hueco no es una caída a 0). */
  huecos: { desde: number; hasta: number }[];
  ancho: number;
  alto: number;
}

export function GraficoEvolucion({ puntos, mejorDia, hayAnterior, huecos, ancho, alto }: GraficoEvolucionProps) {
  const max = Math.max(0, ...puntos.flatMap((p) => [p.actual ?? 0, hayAnterior ? (p.anterior ?? 0) : 0]));
  const marcasY = marcasEje(max);
  const ticksX = [1, 5, 10, 15, 20, 25, puntos.length].filter((d, i, a) => d <= puntos.length && a.indexOf(d) === i);
  const eje = { fontSize: 16, fill: COLOR.grisMedio, fontFamily: PILA_FUENTES };
  return (
    <ComposedChart width={ancho} height={alto} data={puntos} margin={{ top: 28, right: 24, bottom: 4, left: 0 }}>
      <CartesianGrid vertical={false} stroke={COLOR.rejilla} strokeOpacity={0.8} strokeWidth={1} />
      <XAxis
        dataKey="dia"
        type="number"
        domain={[1, puntos.length]}
        ticks={ticksX}
        tick={eje}
        tickLine={false}
        axisLine={{ stroke: COLOR.rejilla }}
        tickMargin={10}
        allowDecimals={false}
      />
      <YAxis
        domain={[0, marcasY[marcasY.length - 1]]}
        ticks={marcasY}
        interval={0}
        tick={eje}
        tickLine={false}
        axisLine={false}
        allowDecimals={false}
        width={52}
        tickFormatter={(v: number) => fmtEntero(v)}
      />
      {huecos.map((h) => (
        <ReferenceArea
          key={h.desde}
          x1={Math.max(1, h.desde - 0.5)}
          x2={Math.min(puntos.length, h.hasta + 0.5)}
          fill={COLOR.rejilla}
          fillOpacity={0.55}
          stroke="none"
          ifOverflow="hidden"
          label={
            h.hasta - h.desde >= 2
              ? { value: "Sin datos", position: "insideTop", offset: 12, fill: COLOR.tenue, fontSize: 15, fontFamily: PILA_FUENTES }
              : undefined
          }
        />
      ))}
      {hayAnterior && (
        <Line
          dataKey="anterior"
          type="monotone"
          stroke={COLOR.piedra}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      )}
      <Area
        dataKey="actual"
        type="monotone"
        stroke={COLOR.oro}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={COLOR.oro}
        fillOpacity={0.12}
        dot={false}
        activeDot={false}
        isAnimationActive={false}
      />
      {mejorDia && (
        <ReferenceDot
          x={mejorDia.dia}
          y={mejorDia.visitas}
          r={7}
          fill={COLOR.oro}
          stroke={COLOR.papel}
          strokeWidth={3}
          ifOverflow="extendDomain"
          label={{
            value: fmtEntero(mejorDia.visitas),
            // En los extremos, al lado del punto: encima chocaría con las marcas del eje.
            position: mejorDia.dia <= 3 ? "right" : mejorDia.dia >= puntos.length - 2 ? "left" : "top",
            offset: 12,
            fill: COLOR.pizarra,
            fontSize: 20,
            fontWeight: 700,
            fontFamily: PILA_FUENTES,
          }}
        />
      )}
    </ComposedChart>
  );
}

// ─── Barras horizontales (páginas, procedencias) ─────────────────────────────
interface TickNombreProps {
  x?: number;
  y?: number;
  payload?: { value: string };
  color: string;
  maxCaracteres: number;
}

function TickNombre({ x = 0, y = 0, payload, color, maxCaracteres }: TickNombreProps) {
  return (
    <text x={x} y={y} dy={6} textAnchor="end" fill={color} fontSize={18} fontWeight={500} fontFamily={PILA_FUENTES}>
      {recortar(payload?.value ?? "", maxCaracteres)}
    </text>
  );
}

interface EtiquetaValorProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  index?: number;
  items: ItemBarra[];
  color: string;
  colorSecundario: string;
}

function EtiquetaValor({ x = 0, y = 0, width = 0, height = 0, index = 0, items, color, colorSecundario }: EtiquetaValorProps) {
  const item = items[index];
  if (!item) return null;
  return (
    <text
      x={Number(x) + Number(width) + 10}
      y={Number(y) + Number(height) / 2}
      dy={6}
      fontSize={18}
      fontFamily={PILA_FUENTES}
      fill={color}
    >
      <tspan fontWeight={700}>{fmtEntero(item.visitas)}</tspan>
      <tspan fill={colorSecundario} fontWeight={400}>{`  ${fmtCuota(item.pct)}`}</tspan>
    </text>
  );
}

interface GraficoBarrasProps {
  items: ItemBarra[];
  ancho: number;
  alto: number;
  /** En la tarjeta pizarra (oro claro + piedra media) o sobre el papel (oro + piedra). */
  sobrePizarra?: boolean;
  anchoNombres?: number;
}

export function GraficoBarras({ items, ancho, alto, sobrePizarra = false, anchoNombres = 250 }: GraficoBarrasProps) {
  const max = Math.max(0, ...items.map((i) => i.visitas));
  const texto = sobrePizarra ? COLOR.blanco : COLOR.pizarra;
  const textoSecundario = sobrePizarra ? COLOR.tenueSobrePizarra : COLOR.tenue;
  // Énfasis: la primera barra en oro y el resto en piedra (una sola serie; el
  // valor va en la punta de cada barra, así que la piedra no necesita contraste 3:1).
  const relleno = (destacado: boolean) =>
    sobrePizarra ? (destacado ? COLOR.oroClaro : COLOR.piedraSobrePizarra) : destacado ? COLOR.oro : COLOR.piedra;
  // El espacio para el valor (≈ «1.234  45 %») se reserva a la derecha.
  return (
    <BarChart
      width={ancho}
      height={alto}
      data={items}
      layout="vertical"
      margin={{ top: 4, right: 120, bottom: 4, left: 0 }}
      barCategoryGap="30%"
    >
      <XAxis type="number" hide domain={[0, Math.max(1, max)]} />
      <YAxis
        type="category"
        dataKey="nombre"
        width={anchoNombres}
        tickLine={false}
        axisLine={false}
        interval={0}
        tick={<TickNombre color={texto} maxCaracteres={Math.floor(anchoNombres / 9.5)} />}
      />
      <Bar dataKey="visitas" barSize={GROSOR_BARRA} radius={[0, 4, 4, 0]} isAnimationActive={false}>
        {items.map((item) => (
          <Cell key={item.nombre} fill={relleno(item.destacado)} />
        ))}
        <LabelList
          dataKey="visitas"
          content={<EtiquetaValor items={items} color={texto} colorSecundario={textoSecundario} />}
        />
      </Bar>
    </BarChart>
  );
}

// ─── Columnas por día de la semana ───────────────────────────────────────────
interface EtiquetaColumnaProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  index?: number;
  items: DiaSemanaInforme[];
}

function EtiquetaColumna({ x = 0, y = 0, width = 0, index = 0, items }: EtiquetaColumnaProps) {
  const item = items[index];
  if (!item || item.media === null) return null;
  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={Number(y) - 12}
      textAnchor="middle"
      fontSize={18}
      fontWeight={item.destacado ? 700 : 500}
      fontFamily={PILA_FUENTES}
      fill={COLOR.pizarra}
    >
      {fmtMedia(item.media)}
    </text>
  );
}

export function GraficoSemana({ items, ancho, alto }: { items: DiaSemanaInforme[]; ancho: number; alto: number }) {
  const max = Math.max(0, ...items.map((i) => i.media ?? 0));
  const datos = items.map((i) => ({ ...i, valor: i.media ?? 0 }));
  return (
    <BarChart width={ancho} height={alto} data={datos} margin={{ top: 36, right: 8, bottom: 4, left: 8 }} barCategoryGap="20%">
      <CartesianGrid vertical={false} horizontal={false} />
      <XAxis
        dataKey="corto"
        tick={{ fontSize: 18, fill: COLOR.pizarra, fontFamily: PILA_FUENTES, fontWeight: 500 }}
        tickLine={false}
        axisLine={{ stroke: COLOR.rejilla }}
        tickMargin={12}
        interval={0}
      />
      <YAxis hide domain={[0, Math.max(1, max)]} />
      <Bar dataKey="valor" barSize={GROSOR_BARRA} radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {datos.map((d) => (
          <Cell key={d.corto} fill={d.destacado ? COLOR.oro : COLOR.piedra} />
        ))}
        <LabelList dataKey="valor" content={<EtiquetaColumna items={items} />} />
      </Bar>
    </BarChart>
  );
}
