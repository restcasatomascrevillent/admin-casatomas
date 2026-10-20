/**
 * Formato de la pantalla de Costes del sistema.
 *
 * Lo que es idéntico a Tráfico web se reexporta en vez de reescribirse: así la
 * regla de oro ("NULL = sin datos, nunca 0") tiene una sola implementación y no
 * puede divergir entre pantallas.
 *
 * MONEDA — el problema real de esta pantalla:
 *  - El coste de IA está en USD, porque así factura OpenAI.
 *  - El coste fijo está en EUR, porque así vienen las facturas de Supabase,
 *    Vercel, Resend, VAPI y el dominio.
 * No se suman a ciegas. Cualquier total mixto se convierte con `USD_EUR`, se
 * escribe con "≈" y la pantalla dice en pantalla qué tipo de cambio ha usado.
 * Es una aproximación deliberada y visible: preferimos un número marcado como
 * aproximado a dos columnas que nadie puede comparar.
 */
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { esNulo, SIN_DATOS } from "@/components/trafico-web/formato";

export {
  SIN_DATOS,
  esNulo,
  fmtNumero,
  fmtDecimal1,
  fmtDecimal2,
  fmtPct,
  fmtFechaCorta,
  fmtFechaLarga,
  fmtFechaHora,
} from "@/components/trafico-web/formato";

/**
 * TIPO DE CAMBIO — a mano y a propósito.
 *
 * No se consulta ninguna API: un tipo de cambio que cambia solo haría que el
 * coste de un mes cerrado variase de una visita a otra. Se actualiza a mano
 * cuando el dueño revise los números, y la fecha de abajo se enseña siempre
 * junto a cualquier cifra convertida para que se sepa de cuándo es.
 */
export const USD_EUR = 0.92;
/** Fecha en la que se fijó `USD_EUR` (ISO, para poder pintarla). */
export const FECHA_TIPO_CAMBIO = "2026-09-28";

const fmtDos = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCuatro = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtCompacto = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });

/** Texto del tipo de cambio, listo para pegar debajo de cualquier total mixto. */
export const TEXTO_TIPO_CAMBIO = `1 USD ≈ ${fmtDos.format(USD_EUR)} EUR (fijado a mano el ${format(
  parseISO(FECHA_TIPO_CAMBIO),
  "d MMM yyyy",
  { locale: es },
)})`;

/** Dólares con 2 decimales. Para totales y subtotales. */
export const fmtUsd = (v: number | null | undefined): string => (esNulo(v) ? SIN_DATOS : `${fmtDos.format(v)} $`);

/**
 * Dólares con 4 decimales. Los costes por petición o por unidad se mueven en
 * milésimas: con 2 decimales todos serían "0,00 $" y parecerían gratis.
 */
export const fmtUsdPreciso = (v: number | null | undefined): string =>
  esNulo(v) ? SIN_DATOS : `${fmtCuatro.format(v)} $`;

/** Euros con 2 decimales. */
export const fmtEur = (v: number | null | undefined): string => (esNulo(v) ? SIN_DATOS : `${fmtDos.format(v)} €`);

export const usdAEur = (v: number | null | undefined): number | null => (esNulo(v) ? null : v * USD_EUR);

/** Euros convertidos desde USD: siempre con "≈", nunca disfrazados de exactos. */
export const fmtEurAprox = (v: number | null | undefined): string => (esNulo(v) ? SIN_DATOS : `≈ ${fmtEur(v)}`);

/** Igual que `fmtEurAprox` pero partiendo de una cifra en dólares. */
export const fmtUsdEnEur = (usd: number | null | undefined): string => fmtEurAprox(usdAEur(usd));

/**
 * Tokens en notación compacta ("1,2 M"). Las cifras reales son de millones y
 * en una tabla de 375 px el número completo rompe la columna.
 */
export const fmtTokens = (v: number | null | undefined): string => (esNulo(v) ? SIN_DATOS : fmtCompacto.format(v));

/** Fecha suelta (`date` de Postgres, sin hora). NULL → "sin datos". */
export const fmtFecha = (iso: string | null | undefined): string =>
  iso ? format(parseISO(iso), "d MMM yyyy", { locale: es }) : SIN_DATOS;

/** Mes en texto ("septiembre 2026"), a partir del `mes` que devuelve la RPC. */
export const fmtMes = (iso: string | null | undefined): string =>
  iso ? format(parseISO(iso), "MMMM yyyy", { locale: es }) : SIN_DATOS;
