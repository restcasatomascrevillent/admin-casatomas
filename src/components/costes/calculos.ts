/**
 * Lógica pura de la pantalla de Costes (sin React), para poder testearla y para
 * que los ficheros de componentes solo exporten componentes (fast refresh).
 * La estadística "de verdad" vive en las RPC SQL; aquí solo se da forma y se
 * juntan las dos monedas.
 */
import type {
  CosteFijo,
  FilaCosteMes,
  FilaCostePorModelo,
  FilaCosteSerie,
  FilaFuncionSinRegistro,
  IaCosteEstimado,
} from "@/hooks/useCostes";
import { esNulo, USD_EUR } from "./formato";

export const RANGOS_DIAS = [30, 90, 180, 365] as const;
export type RangoDias = (typeof RANGOS_DIAS)[number];

/** Ventana con la que se pregunta a `ia_funciones_sin_registro`. */
export const DIAS_SIN_REGISTRO = 7;
/** Un coste fijo verificado hace más de esto ya no es de fiar: los proveedores suben precios. */
export const DIAS_VERIFICACION_CADUCA = 90;

/** Categorías de `costes_fijos` en el orden en que se leen mejor. */
export const ORDEN_CATEGORIAS = ["infraestructura", "ia_plataforma", "telefonia", "email", "dominio", "otros"] as const;

export const NOMBRE_CATEGORIA: Record<string, string> = {
  infraestructura: "Infraestructura",
  ia_plataforma: "Plataformas de IA",
  telefonia: "Telefonía",
  email: "Email",
  dominio: "Dominio",
  otros: "Otros",
};

export const etiquetaCategoria = (categoria: string): string => NOMBRE_CATEGORIA[categoria] ?? categoria;

// ─── Resumen del periodo de la serie ─────────────────────────────────────────
export interface ResumenCoste {
  costeUsd: number | null;
  mediaDiaUsd: number | null;
  /** Días con coste no NULL. Un día sin filas no cuenta como día de 0 $. */
  diasConDato: number;
  peticiones: number | null;
  llamadas: number | null;
  errores: number | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensRazonamiento: number | null;
  anomalias: number;
}

/**
 * Resume el periodo ignorando los NULL, y con un contador por métrica: un día
 * puede traer peticiones y NO traer coste (modelo sin tarifa en `ia_precios`),
 * y eso no debe convertir las peticiones en "sin datos" ni el coste en 0.
 */
export function resumirSerieCoste(filas: FilaCosteSerie[]): ResumenCoste {
  let coste = 0;
  let diasCoste = 0;
  let peticiones = 0;
  let hayPeticiones = false;
  let llamadas = 0;
  let hayLlamadas = false;
  let errores = 0;
  let hayErrores = false;
  let prompt = 0;
  let hayPrompt = false;
  let completion = 0;
  let hayCompletion = false;
  let razonamiento = 0;
  let hayRazonamiento = false;
  let anomalias = 0;

  for (const f of filas) {
    if (f.es_anomalia === true) anomalias++;
    if (!esNulo(f.coste_usd)) {
      coste += f.coste_usd;
      diasCoste++;
    }
    if (!esNulo(f.peticiones)) {
      peticiones += f.peticiones;
      hayPeticiones = true;
    }
    if (!esNulo(f.llamadas)) {
      llamadas += f.llamadas;
      hayLlamadas = true;
    }
    if (!esNulo(f.errores)) {
      errores += f.errores;
      hayErrores = true;
    }
    if (!esNulo(f.prompt_tokens)) {
      prompt += f.prompt_tokens;
      hayPrompt = true;
    }
    if (!esNulo(f.completion_tokens)) {
      completion += f.completion_tokens;
      hayCompletion = true;
    }
    if (!esNulo(f.razonamiento_tokens)) {
      razonamiento += f.razonamiento_tokens;
      hayRazonamiento = true;
    }
  }

  return {
    costeUsd: diasCoste > 0 ? coste : null,
    mediaDiaUsd: diasCoste > 0 ? coste / diasCoste : null,
    diasConDato: diasCoste,
    peticiones: hayPeticiones ? peticiones : null,
    llamadas: hayLlamadas ? llamadas : null,
    errores: hayErrores ? errores : null,
    tokensPrompt: hayPrompt ? prompt : null,
    tokensCompletion: hayCompletion ? completion : null,
    tokensRazonamiento: hayRazonamiento ? razonamiento : null,
    anomalias,
  };
}

// ─── Puntos del gráfico principal ────────────────────────────────────────────
export interface PuntoCoste {
  dia: string;
  coste?: number | null;
  media7?: number | null;
  media30?: number | null;
  /** [media_30 − 2σ, media_30 + 2σ]: la banda con la que la RPC marca anomalías. */
  banda2?: [number, number] | null;
  peticiones?: number | null;
  z?: number | null;
  desviacionPct?: number | null;
  anomalia?: boolean | null;
}

const banda = (media: number | null, desv: number | null, k: number): [number, number] | null =>
  esNulo(media) || esNulo(desv) ? null : [Math.max(0, media - k * desv), media + k * desv];

export function construirPuntosCoste(serie: FilaCosteSerie[]): PuntoCoste[] {
  return serie.map((f) => ({
    dia: f.dia,
    coste: f.coste_usd,
    media7: f.media_7,
    media30: f.media_30,
    banda2: banda(f.media_30, f.desv_30, 2),
    peticiones: f.peticiones,
    z: f.z_30,
    desviacionPct: f.desviacion_pct,
    anomalia: f.es_anomalia,
  }));
}

// ─── Fechas ──────────────────────────────────────────────────────────────────
/**
 * Días enteros transcurridos desde una fecha. Las `date` de Postgres llegan sin
 * hora: se leen como medianoche LOCAL (no UTC) para que "hoy" sea hoy aquí.
 */
export function diasDesde(iso: string | null | undefined, ahora: Date): number | null {
  if (!iso) return null;
  const fecha = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  const ms = fecha.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor((ahora.getTime() - ms) / 86400000);
}

// ─── Avisos: cómo la pantalla admite que puede estar contando por debajo ─────
export interface FijoCaducado {
  concepto: string;
  verificadoEn: string | null;
  dias: number | null;
}

export interface AvisosCostes {
  /** Funciones que todavía NO registran su consumo: su coste real no está aquí. */
  sinInstrumentar: FilaFuncionSinRegistro[];
  /** Funciones que SÍ deberían registrar y llevan días sin escribir nada. */
  instrumentadasMudas: FilaFuncionSinRegistro[];
  /** Modelos usados que no tienen tarifa en `ia_precios` (su coste es NULL). */
  modelosSinTarifa: string[];
  /** Cuántos costes fijos activos no tienen importe verificado. */
  fijosSinVerificar: number;
  /** Costes fijos con importe pero verificados hace demasiado. */
  fijosCaducados: FijoCaducado[];
  hayAvisos: boolean;
}

export interface EntradaAvisos {
  sinRegistro: FilaFuncionSinRegistro[] | undefined;
  modelos: FilaCostePorModelo[] | undefined;
  fijos: CosteFijo[] | undefined;
  /** `fijos_sin_verificar` de `ia_coste_mes`, como respaldo si la tabla no ha cargado. */
  fijosSinVerificarRpc: number | null;
  ahora?: Date;
}

export function calcularAvisosCostes({
  sinRegistro,
  modelos,
  fijos,
  fijosSinVerificarRpc,
  ahora = new Date(),
}: EntradaAvisos): AvisosCostes {
  const filas = sinRegistro ?? [];
  const sinInstrumentar = filas.filter((f) => f.instrumentada === false);
  const instrumentadasMudas = filas.filter((f) => f.instrumentada === true);
  const modelosSinTarifa = (modelos ?? []).filter((m) => m.tarifado === false).map((m) => m.modelo);

  const activos = (fijos ?? []).filter((f) => f.activo);
  // La tabla manda cuando está cargada; la RPC es solo el respaldo.
  const fijosSinVerificar = fijos ? activos.filter((f) => esNulo(f.eur_mes)).length : (fijosSinVerificarRpc ?? 0);

  const fijosCaducados: FijoCaducado[] = [];
  for (const f of activos) {
    if (esNulo(f.eur_mes)) continue; // sin importe ya avisa el contador de arriba
    const dias = diasDesde(f.verificado_en, ahora);
    if (dias === null || dias > DIAS_VERIFICACION_CADUCA) {
      fijosCaducados.push({ concepto: f.concepto, verificadoEn: f.verificado_en, dias });
    }
  }

  return {
    sinInstrumentar,
    instrumentadasMudas,
    modelosSinTarifa,
    fijosSinVerificar,
    fijosCaducados,
    hayAvisos:
      sinInstrumentar.length > 0 ||
      instrumentadasMudas.length > 0 ||
      modelosSinTarifa.length > 0 ||
      fijosSinVerificar > 0 ||
      fijosCaducados.length > 0,
  };
}

// ─── Costes fijos agrupados por categoría ────────────────────────────────────
export interface GrupoCostesFijos {
  categoria: string;
  filas: CosteFijo[];
  /** Suma de los importes CONOCIDOS. NULL si ninguna fila del grupo tiene importe. */
  totalEur: number | null;
  sinDato: number;
}

export interface ResumenCostesFijos {
  grupos: GrupoCostesFijos[];
  /** Suma de los importes conocidos: un MÍNIMO, no el total, si `sinDato > 0`. */
  totalEur: number | null;
  conDato: number;
  sinDato: number;
}

const posicionCategoria = (categoria: string): number => {
  const i = (ORDEN_CATEGORIAS as readonly string[]).indexOf(categoria);
  return i === -1 ? ORDEN_CATEGORIAS.length : i;
};

/**
 * Agrupa por categoría, solo las filas activas. El total suma lo conocido y
 * cuenta aparte lo que falta: sumar NULL como 0 haría que un coste sin
 * verificar pareciera gratis, que es justo el error que esta pantalla evita.
 */
export function agruparCostesFijos(filas: CosteFijo[]): ResumenCostesFijos {
  const activas = filas.filter((f) => f.activo);
  const porCategoria = new Map<string, CosteFijo[]>();
  for (const f of activas) {
    const lista = porCategoria.get(f.categoria);
    if (lista) lista.push(f);
    else porCategoria.set(f.categoria, [f]);
  }

  const grupos: GrupoCostesFijos[] = [];
  for (const [categoria, lista] of porCategoria) {
    let total = 0;
    let conDato = 0;
    let sinDato = 0;
    for (const f of lista) {
      if (esNulo(f.eur_mes)) sinDato++;
      else {
        total += f.eur_mes;
        conDato++;
      }
    }
    grupos.push({
      categoria,
      filas: [...lista].sort((a, b) => a.orden - b.orden || a.concepto.localeCompare(b.concepto, "es")),
      totalEur: conDato > 0 ? total : null,
      sinDato,
    });
  }
  grupos.sort((a, b) => posicionCategoria(a.categoria) - posicionCategoria(b.categoria) || a.categoria.localeCompare(b.categoria, "es"));

  const conDato = activas.filter((f) => !esNulo(f.eur_mes)).length;
  const sinDato = activas.length - conDato;
  const totalEur = conDato > 0 ? activas.reduce((s, f) => s + (esNulo(f.eur_mes) ? 0 : f.eur_mes), 0) : null;

  return { grupos, totalEur, conDato, sinDato };
}

// ─── Estimación inicial (lo medido a mano el día 1) ──────────────────────────
export interface FilaEstimacion {
  fila: IaCosteEstimado;
  /** usd_por_unidad × unidades_mes_estimadas. */
  usdMes: number | null;
}

export interface ResumenEstimacion {
  filas: FilaEstimacion[];
  totalUsdMes: number | null;
}

export function resumirEstimacion(filas: IaCosteEstimado[]): ResumenEstimacion {
  const calculadas: FilaEstimacion[] = filas.map((fila) => ({
    fila,
    usdMes:
      esNulo(fila.usd_por_unidad) || esNulo(fila.unidades_mes_estimadas)
        ? null
        : fila.usd_por_unidad * fila.unidades_mes_estimadas,
  }));
  const conDato = calculadas.filter((f) => !esNulo(f.usdMes));
  return {
    filas: calculadas,
    totalUsdMes: conDato.length > 0 ? conDato.reduce((s, f) => s + (f.usdMes ?? 0), 0) : null,
  };
}

// ─── El coste de IA del mes: de dónde sale la cifra que se usa para el total ──
export type OrigenIaMes = "media7" | "lineal" | "estimacion" | "ninguno";

export interface IaMesEstimado {
  usd: number | null;
  origen: OrigenIaMes;
}

export const TEXTO_ORIGEN: Record<OrigenIaMes, string> = {
  media7: "proyección por media de 7 días",
  lineal: "proyección lineal",
  estimacion: "estimación medida a mano (aún sin registro real)",
  ninguno: "sin datos",
};

/**
 * Elige la mejor cifra disponible para "IA este mes", en este orden:
 * media de 7 días → lineal → estimación inicial. Devuelve también de dónde
 * sale, porque un total que mezcla medición y estimación tiene que decirlo.
 */
export function iaUsdMes(mes: FilaCosteMes | null | undefined): IaMesEstimado {
  if (!mes) return { usd: null, origen: "ninguno" };
  if (!esNulo(mes.proy_media7_usd)) return { usd: mes.proy_media7_usd, origen: "media7" };
  if (!esNulo(mes.proy_lineal_usd)) return { usd: mes.proy_lineal_usd, origen: "lineal" };
  if (!esNulo(mes.estimado_ia_usd_mes)) return { usd: mes.estimado_ia_usd_mes, origen: "estimacion" };
  return { usd: null, origen: "ninguno" };
}

// ─── Total mensual y margen (el único sitio donde se mezclan USD y EUR) ──────
export interface TotalMensual {
  /** IA del mes convertida a euros con `USD_EUR`: aproximada, siempre con "≈". */
  iaEurAprox: number | null;
  fijosEur: number | null;
  /** NULL si falta cualquiera de las dos mitades: media suma no es un total. */
  totalEurAprox: number | null;
  margenEur: number | null;
  margenPct: number | null;
}

/**
 * Junta las dos monedas. Si falta una mitad el total es NULL a propósito: dar
 * "solo los fijos" como total mensual haría creer que la IA es gratis.
 */
export function calcularTotalMensual(
  iaUsd: number | null,
  fijosEur: number | null,
  facturadoEur: number,
): TotalMensual {
  const iaEurAprox = esNulo(iaUsd) ? null : iaUsd * USD_EUR;
  const fijos = esNulo(fijosEur) ? null : fijosEur;
  const totalEurAprox = iaEurAprox === null || fijos === null ? null : iaEurAprox + fijos;
  const margenEur = totalEurAprox === null ? null : facturadoEur - totalEurAprox;
  const margenPct = margenEur === null || facturadoEur <= 0 ? null : (100 * margenEur) / facturadoEur;
  return { iaEurAprox, fijosEur: fijos, totalEurAprox, margenEur, margenPct };
}
