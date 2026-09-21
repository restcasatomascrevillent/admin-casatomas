// ============================================================
// MOTOR DE DISPONIBILIDAD — módulo compartido y ÚNICO
// ============================================================
// Este fichero es la ÚNICA implementación de la regla de negocio de
// "qué horas se ofrecen". Lo consumen:
//
//   - supabase/functions/reservas-web/index.ts   (web pública)
//   - src/hooks/useDisponibilidad.ts             (panel de administración)
//
// Antes de existir este módulo había CUATRO copias divergentes:
//   1. src/hooks/useDisponibilidad.ts            (generarTurnosDinamicos)
//   2. src/hooks/useConfiguracionTurnos.ts       (generarTurnosDinamicos, otra)
//   3. casa-tomas-story ReservationForm.tsx      (secondaryOffsets = [15,45])
//   4. reservas-web/index.ts                     (ninguna: volcado en crudo)
// Las tres primeras daban resultados distintos entre sí. Ver el informe.
//
// REGLAS DE ORO DE ESTE FICHERO:
//   - CERO imports. Corre igual en Deno (edge function), en el navegador
//     (Vite) y en vitest. No toca red, ni base de datos, ni Deno.env.
//   - CERO efectos: mismas entradas -> mismas salidas. Todo lo que depende
//     del reloj entra por parámetro (`ahora`), para que los tests puedan
//     fijar la hora sin mockear nada.
//   - NO es la autoridad del aforo. La autoridad es el trigger
//     `trg_validar_capacidad` (usa `pg_advisory_xact_lock`, es inmune a
//     carreras). Este motor PREDICE para poder ofrecer huecos; el INSERT
//     puede fallar igualmente y eso es correcto.
// ============================================================

// ------------------------------------------------------------
// CONSTANTES DE TURNO
// ------------------------------------------------------------

/**
 * Hora que separa comida de cena.
 *
 * Copiado literalmente del trigger `validar_capacidad_reserva`:
 *   `v_es_comida := NEW.hora < '17:00:00'::time;`
 * y su filtro de ocupación usa el mismo umbral. Es la ÚNICA autoridad.
 */
export const HORA_CORTE_TURNO = "17:00";
const MIN_CORTE_TURNO = 17 * 60;

/**
 * Umbral DISTINTO que usa el trigger `actualizar_ocupacion_diaria_espacios`
 * al rellenar `ocupacion_diaria.turno`:
 *   `CASE WHEN r.hora < '16:00' THEN 'comida' ELSE 'cena' END`
 *
 * Es una incoherencia REAL en producción. Este motor NO la usa nunca:
 * clasifica siempre con `HORA_CORTE_TURNO` (17:00), que es lo que de
 * verdad decide si una reserva entra o no. Se expone aquí solo para
 * poder DETECTAR la zona gris [16:00, 17:00) y avisar (ver
 * `AVISO_DESAJUSTE_TURNO`). Hoy no muerde porque la comida acaba a las
 * 16:00 y la cena empieza a las 20:00, así que ningún hueco cae dentro;
 * en cuanto alguien configure un periodo que toque esa franja, el panel
 * y `ocupacion_diaria` dirían "cena" mientras el trigger dice "comida".
 */
export const HORA_CORTE_OCUPACION_DIARIA = "16:00";
const MIN_CORTE_OCUPACION_DIARIA = 16 * 60;

/** Estados de `reservas` que ocupan plaza. Mismo criterio que el trigger. */
export const ESTADOS_QUE_OCUPAN = ["pendiente", "verificada", "confirmada"] as const;

/** Tope duro de huecos por periodo. Red de seguridad anti-bucle infinito. */
const MAX_HUECOS_POR_PERIODO = 400;

const MINUTOS_DIA = 1440;

// ------------------------------------------------------------
// AVISOS (diagnóstico de configuración incoherente)
// ------------------------------------------------------------
export const AVISO_DESAJUSTE_TURNO = "desajuste_corte_turno_16_17";
export const AVISO_UMBRALES_NO_MONOTONOS = "umbrales_no_monotonos";
export const AVISO_NIVEL_INVALIDO = "nivel_invalido_descartado";
export const AVISO_PERIODO_INVALIDO = "periodo_invalido_descartado";
export const AVISO_PERIODO_SIN_HUECOS = "periodo_sin_huecos";
export const AVISO_OCULTAR_ANULADO = "ocultar_anulado_dejaria_periodo_vacio";
export const AVISO_CRUZA_MEDIANOCHE = "periodo_cruza_medianoche_turno_ambiguo";
export const AVISO_SIN_CAPACIDAD = "capacidad_total_cero";
export const AVISO_TOPE_HUECOS = "tope_de_huecos_alcanzado";
export const AVISO_UMBRAL_FUERA_DE_RANGO = "umbral_fuera_de_rango_ajustado";

// ------------------------------------------------------------
// TIPOS DE ENTRADA
// ------------------------------------------------------------

/** Un escalón de la escalera. `minutos` = paso del nivel, `umbral` = % para abrirlo. */
export interface NivelEscalera {
  /** Paso en minutos: 60 = horas enteras, 30 = medias, 15 = cuartos. */
  minutos: number;
  /** Porcentaje de OCUPACIÓN del hueco padre a partir del cual se abre. */
  umbral: number;
}

/**
 * Una fila de `configuracion_turnos`, tal cual llega de Supabase.
 *
 * Convive la forma NUEVA (`niveles_escalera` + `ocultar_nivel_anterior`)
 * con la ANTIGUA (`intervalo_base_minutos` + `umbral_apertura_secundario`
 * + `ocultar_primario_si_secundario`). Si la nueva no viene o no es
 * válida, se deriva de la antigua — ver `resolverEscalera`.
 */
export interface ConfiguracionTurnoInput {
  id?: string | null;
  nombre_periodo?: string | null;
  hora_inicio: string;
  hora_fin: string;
  intervalo_base_minutos?: number | null;
  umbral_apertura_secundario?: number | null;
  ocultar_primario_si_secundario?: boolean | null;
  /** jsonb. Array de `NivelEscalera` (o su JSON en texto). */
  niveles_escalera?: unknown;
  ocultar_nivel_anterior?: boolean | null;
  /** "aforo_total" (defecto) | "reparto_nivel_base". Ver `BaseUmbral`. */
  base_umbral?: string | null;
  dias_semana?: number[] | null;
  activo?: boolean | null;
  espacio_id?: string | null;
}

/** Una reserva viva (estado que ocupa) del día consultado. */
export interface ReservaOcupante {
  hora: string;
  numero_comensales: number;
  espacio_id?: string | null;
  estado?: string | null;
}

/** "Ahora" en Europe/Madrid, ya resuelto por quien llama (o por `ahoraEnMadrid`). */
export interface AhoraMadrid {
  /** Fecha local de Madrid en formato YYYY-MM-DD. */
  fechaHoy: string;
  /** Minutos transcurridos desde las 00:00 locales de Madrid. */
  minutosDelDia: number;
}

/** Reglas de `configuracion_reservas` que afectan a qué se puede ofrecer. */
export interface PoliticaReservas {
  /** `/crear` rechaza SIEMPRE las reservas para hoy (motivo `reserva_hoy`). */
  permitirMismoDia?: boolean;
  /** `minutos_corte_antes_servicio`. Un hueco más cercano que esto no se ofrece. */
  minutosCorte?: number;
  /** `dias_max_antelacion`. */
  diasMaxAntelacion?: number | null;
  /** `max_comensales_por_reserva`. Solo para informar, no filtra huecos. */
  maxComensales?: number | null;
}

export interface EntradaDisponibilidad {
  /** YYYY-MM-DD. */
  fecha: string;
  /** Tamaño del grupo. Un hueco está "completo" si no caben. Por defecto 1. */
  comensales?: number | null;
  /** Filtra `configuracion_turnos` por espacio. `null` = configuración global. */
  espacioId?: string | null;
  /** Filas de `configuracion_turnos` (ya filtradas o no: aquí se filtran). */
  configuraciones: ConfiguracionTurnoInput[];
  /** Reservas del día en estado que ocupa. */
  reservas: ReservaOcupante[];
  /** Suma de `capacidad_maxima` de los espacios activos. Igual que el trigger. */
  capacidadTotal: number;
  /** `null` = no aplicar corte horario ni reglas de "hoy". */
  ahora?: AhoraMadrid | null;
  politica?: PoliticaReservas;
}

// ------------------------------------------------------------
// TIPOS DE SALIDA
// ------------------------------------------------------------

export type EstadoHueco = "libre" | "completo";

export type MotivoDescarte =
  | "nivel_sin_abrir"
  | "oculto_por_nivel_inferior"
  | "corte_horario"
  | "reserva_hoy"
  | "fecha_pasada"
  | "fecha_demasiado_lejana";

export interface HuecoCalculado {
  /** "HH:MM". */
  hora: string;
  /** Turno según el trigger (`hora < 17:00`), NO según `ocupacion_diaria`. */
  turno: "comida" | "cena";
  /** 0 = hora entera, 1 = media, 2 = cuarto… */
  nivel: number;
  minutos_nivel: number;
  etiqueta_nivel: string;
  umbral_nivel: number;
  estado: EstadoHueco;
  /** `true` si `estado === "libre"`. Comodidad para el consumidor. */
  ofrecido: boolean;
  /** Por qué está completo (o `null` si está libre). */
  motivo: string | null;
  periodo: string | null;
  /** Hueco padre cuya ocupación abrió éste (`null` en nivel 0). */
  abierto_por: string | null;
  /** Ocupación del padre en el momento de abrirse, en %. */
  abierto_con_porcentaje: number | null;
  /**
   * `true` si el hueco no tenía padre dentro del periodo (p. ej. un periodo
   * que empieza a las 13:30 con la escalera anclada en horas enteras) y se
   * ha promovido a "siempre abierto" para no dejar el periodo vacío.
   */
  promovido: boolean;
  /** Comensales con reserva EXACTAMENTE a esa hora. */
  comensales_hora: number;
  reservas_hora: number;
  /** `comensales_hora / capacidad_maxima * 100`, redondeado. */
  porcentaje_hora: number;
  /**
   * El porcentaje que de verdad se compara con el umbral del escalón
   * siguiente. Coincide con `porcentaje_hora` salvo que el periodo use
   * `base_umbral = "reparto_nivel_base"`.
   */
  porcentaje_para_umbral: number;
  /** Aforo del TURNO al que pertenece el hueco (lo que valida el trigger). */
  capacidad_maxima: number;
  capacidad_disponible: number;
  /** Ocupación del TURNO en %, redondeada. Mismo campo que `kind:"ocupacion"`. */
  porcentaje_ocupacion: number;
}

export interface HuecoDescartado {
  hora: string;
  nivel: number;
  minutos_nivel: number;
  periodo: string | null;
  motivo: MotivoDescarte;
  /** Detalle legible para el panel. */
  detalle: string;
}

export interface AforoTurnoCalculado {
  capacidad_maxima: number;
  ocupacion: number;
  disponible: number;
  porcentaje: number;
  /** `true` si no caben los comensales pedidos. */
  completo: boolean;
}

export interface OcupacionHora {
  hora: string;
  turno: "comida" | "cena";
  total_reservas: number;
  total_comensales: number;
  porcentaje_hora: number;
}

export interface PeriodoResuelto {
  id: string | null;
  nombre_periodo: string | null;
  hora_inicio: string;
  hora_fin: string;
  espacio_id: string | null;
  escalera: NivelEscalera[];
  ocultar_nivel_anterior: boolean;
  base_umbral: BaseUmbral;
  /** Comensales que equivalen al 100% para los umbrales de este periodo. */
  base_umbral_capacidad: number;
  /** De dónde salió la escalera: columnas nuevas o derivada de las viejas. */
  origen_escalera: "niveles_escalera" | "legacy";
  huecos_ofrecidos: number;
  huecos_completos: number;
}

export type MotivoCierre = "dia_no_configurado" | "sin_configuracion" | null;

export interface ResultadoDisponibilidad {
  fecha: string;
  /** 0 = domingo … 6 = sábado. Calculado sin zona horaria (aritmética UTC). */
  diaSemana: number;
  /** `true` = el restaurante no abre ese día. NO es un error. */
  cerrado: boolean;
  motivoCierre: MotivoCierre;
  /**
   * `false` cuando la fecha en sí no es reservable por política
   * (hoy / pasada / demasiado lejana). Distinto de `cerrado`.
   */
  reservable: boolean;
  motivoNoReservable: MotivoDescarte | null;
  comensales: number;
  periodos: PeriodoResuelto[];
  huecos: HuecoCalculado[];
  descartados: HuecoDescartado[];
  ocupacion: OcupacionHora[];
  aforo: { comida: AforoTurnoCalculado; cena: AforoTurnoCalculado };
  avisos: string[];
}

// ------------------------------------------------------------
// HELPERS PUROS DE TIEMPO
// ------------------------------------------------------------

/** "13:00" | "13:00:00" | "13:0" -> 780. Devuelve `null` si no es parseable. */
export function horaAMinutos(hora: unknown): number | null {
  if (typeof hora !== "string") return null;
  const m = hora.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 780 -> "13:00". Normaliza al día (1470 -> "00:30"). */
export function minutosAHora(minutos: number): string {
  const m = ((Math.round(minutos) % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "13:00:00" -> "13:00". Deja igual lo que no reconoce. */
export function normalizarHora(hora: string): string {
  const m = horaAMinutos(hora);
  return m === null ? hora : minutosAHora(m);
}

/**
 * Día de la semana de una fecha YYYY-MM-DD (0 = domingo).
 *
 * Bug que corrige: el panel hacía `new Date(fecha).getDay()`. `new Date("2026-03-15")`
 * se interpreta como MEDIANOCHE UTC y `.getDay()` devuelve el día en la zona
 * LOCAL del proceso; en cualquier zona al oeste de Greenwich (o en un runtime
 * configurado así) daba el día ANTERIOR, con lo que un domingo se comprobaba
 * contra la configuración del sábado. Aquí todo es aritmética UTC explícita.
 */
export function diaDeLaSemana(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.getUTCDay();
}

/** Diferencia en días naturales entre dos YYYY-MM-DD (b - a). */
export function diferenciaDias(desde: string, hasta: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(desde || ""));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hasta || ""));
  if (!a || !b) return null;
  const ta = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const tb = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((tb - ta) / 86400000);
}

/**
 * "Ahora" en Europe/Madrid, sin depender de la zona del proceso.
 *
 * Deno Deploy y Vercel corren en UTC; el navegador del cliente puede estar
 * en cualquier zona. Se usa `Intl` con `timeZone: "Europe/Madrid"`, que ya
 * aplica CET/CEST y por tanto el cambio de horario de verano sale gratis:
 * el 29/03 a las 01:30 UTC son las 03:30 en Madrid (la hora 02:xx no existe),
 * y el 25/10 tanto 00:30 UTC como 01:30 UTC son las 02:30 en Madrid.
 */
export function ahoraEnMadrid(instante: Date = new Date()): AhoraMadrid {
  // "sv-SE" da exactamente "YYYY-MM-DD HH:mm:ss".
  const texto = instante.toLocaleString("sv-SE", { timeZone: "Europe/Madrid" });
  const [fechaHoy, horaTexto] = texto.split(" ");
  const minutos = horaAMinutos(horaTexto);
  return { fechaHoy, minutosDelDia: minutos === null ? 0 : minutos };
}

/** Turno de una hora, con EXACTAMENTE el criterio del trigger de aforo. */
export function turnoDeHora(hora: string | number): "comida" | "cena" {
  const m = typeof hora === "number" ? hora : horaAMinutos(hora);
  if (m === null) return "cena";
  return (m % MINUTOS_DIA) < MIN_CORTE_TURNO ? "comida" : "cena";
}

/** Turno según `ocupacion_diaria` (<16:00). Solo para detectar el desajuste. */
export function turnoSegunOcupacionDiaria(hora: string | number): "comida" | "cena" {
  const m = typeof hora === "number" ? hora : horaAMinutos(hora);
  if (m === null) return "cena";
  return (m % MINUTOS_DIA) < MIN_CORTE_OCUPACION_DIARIA ? "comida" : "cena";
}

/** `true` si la hora cae en la franja gris donde los dos cortes discrepan. */
export function enFranjaDeDesajuste(hora: string | number): boolean {
  return turnoDeHora(hora) !== turnoSegunOcupacionDiaria(hora);
}

// ------------------------------------------------------------
// LA ESCALERA
// ------------------------------------------------------------

function etiquetaNivel(minutos: number): string {
  if (minutos === 60) return "hora en punto";
  if (minutos === 30) return "media hora";
  if (minutos === 15) return "cuarto de hora";
  return `cada ${minutos} min`;
}

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function parseNiveles(bruto: unknown): NivelEscalera[] | null {
  let valor = bruto;
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (!texto) return null;
    try {
      valor = JSON.parse(texto);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(valor) || valor.length === 0) return null;

  const niveles: NivelEscalera[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const minutos = Number(obj.minutos ?? obj.intervalo_minutos ?? obj.paso_minutos);
    const umbral = Number(obj.umbral ?? obj.umbral_apertura ?? obj.umbral_porcentaje ?? 0);
    if (!Number.isFinite(minutos) || minutos <= 0 || !Number.isInteger(minutos)) continue;
    if (minutos > MINUTOS_DIA) continue;
    niveles.push({ minutos, umbral: Number.isFinite(umbral) ? umbral : 0 });
  }
  return niveles.length > 0 ? niveles : null;
}

/**
 * Normaliza la escalera: ordena de grueso a fino, deduplica, fuerza el nivel 0
 * a umbral 0 y hace los umbrales MONÓTONOS.
 *
 * Decisión documentada (requisito 3 del encargo): si alguien configura el
 * umbral del nivel 3 por DEBAJO del nivel 2 (p. ej. 70 y luego 10), no se
 * revienta ni se ofrece un nivel fino antes que el grueso. El umbral efectivo
 * de cada nivel es el MÁXIMO de los umbrales hasta él, así que la escalera
 * sigue siendo una escalera: cada escalón se abre igual o más tarde que el
 * anterior. Se emite el aviso `umbrales_no_monotonos` para que el panel pueda
 * avisar a quien lo configuró.
 */
export function normalizarEscalera(
  niveles: NivelEscalera[],
  avisos: Set<string>,
): NivelEscalera[] {
  const limpios = niveles
    .filter((n) => Number.isFinite(n.minutos) && n.minutos > 0)
    .slice()
    .sort((a, b) => b.minutos - a.minutos);

  if (limpios.length !== niveles.length) avisos.add(AVISO_NIVEL_INVALIDO);

  const salida: NivelEscalera[] = [];
  let umbralPrevio = 0;
  let noMonotono = false;

  for (const nivel of limpios) {
    if (salida.some((n) => n.minutos === nivel.minutos)) continue; // dedupe
    let umbral = Number.isFinite(nivel.umbral) ? nivel.umbral : 0;
    if (umbral < 0 || umbral > 100) {
      avisos.add(AVISO_UMBRAL_FUERA_DE_RANGO);
      umbral = clamp(umbral, 0, 100);
    }
    if (salida.length === 0) {
      umbral = 0; // el nivel más grueso SIEMPRE está abierto
    } else if (umbral < umbralPrevio) {
      noMonotono = true;
      umbral = umbralPrevio;
    }
    umbralPrevio = umbral;
    salida.push({ minutos: nivel.minutos, umbral });
  }

  if (noMonotono) avisos.add(AVISO_UMBRALES_NO_MONOTONOS);
  return salida;
}

/**
 * Obtiene la escalera de una fila de `configuracion_turnos`.
 *
 * COMPATIBILIDAD HACIA ATRÁS: si `niveles_escalera` no viene (o es basura),
 * se deriva de las columnas de siempre:
 *
 *   intervalo_base_minutos = 30, umbral_apertura_secundario = 40
 *       ->  [ {60, 0}, {30, 40} ]
 *
 * es decir, exactamente lo que el dueño describe hoy: horas enteras siempre,
 * y la media se abre al 40%. Con la configuración que hay en producción, el
 * motor se comporta igual que antes sin que nadie toque nada.
 */
export function resolverEscalera(
  config: ConfiguracionTurnoInput,
  avisos: Set<string>,
): { escalera: NivelEscalera[]; origen: "niveles_escalera" | "legacy" } {
  const nuevos = parseNiveles(config.niveles_escalera);
  if (nuevos) {
    return { escalera: normalizarEscalera(nuevos, avisos), origen: "niveles_escalera" };
  }

  const intervalo = Number(config.intervalo_base_minutos);
  const umbral = Number(config.umbral_apertura_secundario);
  const paso = Number.isFinite(intervalo) && intervalo > 0 ? Math.round(intervalo) : 30;
  const umbralSeguro = Number.isFinite(umbral) ? umbral : 0;

  const derivada: NivelEscalera[] = [{ minutos: 60, umbral: 0 }];
  // Si el intervalo configurado es >= 60 no hay segundo escalón que añadir:
  // el "primario" ya lo cubre todo.
  if (paso < 60) derivada.push({ minutos: paso, umbral: umbralSeguro });

  return { escalera: normalizarEscalera(derivada, avisos), origen: "legacy" };
}

/** `ocultar_nivel_anterior` con caída al flag antiguo. */
export function resolverOcultar(config: ConfiguracionTurnoInput): boolean {
  if (typeof config.ocultar_nivel_anterior === "boolean") return config.ocultar_nivel_anterior;
  return config.ocultar_primario_si_secundario === true;
}

/**
 * Sobre qué se calcula el porcentaje que abre un escalón.
 *
 *   "aforo_total"        -> comensales de esa hora / aforo del restaurante.
 *   "reparto_nivel_base" -> comensales de esa hora / (aforo repartido entre
 *                           las horas del nivel más grueso del periodo).
 *
 * POR QUÉ EXISTE ESTA OPCIÓN. Con "aforo_total" y los datos reales de
 * producción, el escalón siguiente NO SE ABRE NUNCA: el día más lleno que
 * hay (16/02/2026, 50 reservas y 200 comensales) tiene el turno de comida
 * al 66%, pero su hora más cargada son 17 comensales — un 11% de los 150
 * de aforo. Para llegar al 40% harían falta 60 personas a la misma hora, y
 * al 70% harían falta 105.
 *
 * Con "reparto_nivel_base", la comida (13:00-16:00, tres horas en punto)
 * reparte 150 / 3 = 50 por hora, así que esos 17 comensales son un 34% y
 * el umbral empieza a significar algo.
 *
 * DECISIÓN TOMADA POR EL DUEÑO: el modo por defecto es
 * "reparto_nivel_base". Con "aforo_total" la escalera no llegaba a abrirse
 * nunca con el tráfico real del restaurante. "aforo_total" sigue siendo
 * elegible desde la configuración por si algún día cambia la distribución
 * de sala, pero hay que pedirlo expresamente.
 *
 * El defecto vive AQUÍ y no solo en el DEFAULT de la columna, a propósito:
 * si el código se despliega antes de aplicar la migración, o si alguien
 * inserta una fila sin la columna, el comportamiento tiene que ser el que
 * se ha decidido, no el antiguo. Un valor explícito en base de datos
 * siempre gana sobre este defecto.
 */
export type BaseUmbral = "aforo_total" | "reparto_nivel_base";

export const BASE_UMBRAL_POR_DEFECTO: BaseUmbral = "reparto_nivel_base";

export function resolverBaseUmbral(config: ConfiguracionTurnoInput): BaseUmbral {
  return config.base_umbral === "aforo_total" ? "aforo_total" : BASE_UMBRAL_POR_DEFECTO;
}

// ------------------------------------------------------------
// SELECCIÓN DE CONFIGURACIONES
// ------------------------------------------------------------

/**
 * Filtra `configuracion_turnos` por espacio y por día de la semana.
 *
 * Prioriza las configuraciones específicas del espacio sobre las globales
 * (`espacio_id = null`), igual que hacía el panel. `dias_semana` vacío o
 * ausente se interpreta como "todos los días", igual que hacía la edge
 * function: es lo que ya consume el frontend y cambiarlo cerraría días.
 */
export function seleccionarConfiguraciones(
  configuraciones: ConfiguracionTurnoInput[],
  espacioId: string | null | undefined,
  diaSemana: number,
): ConfiguracionTurnoInput[] {
  const activas = (configuraciones || []).filter((c) => c && c.activo !== false);

  const especificas = espacioId ? activas.filter((c) => c.espacio_id === espacioId) : [];
  const globales = activas.filter((c) => c.espacio_id === null || c.espacio_id === undefined);
  const base = especificas.length > 0 ? especificas : globales;

  return base.filter((c) => {
    const dias = c.dias_semana;
    if (!Array.isArray(dias) || dias.length === 0) return true;
    return dias.includes(diaSemana);
  });
}

// ------------------------------------------------------------
// GENERACIÓN DE HUECOS DE UN PERIODO
// ------------------------------------------------------------

interface CandidatoHueco {
  /** Minutos absolutos desde las 00:00 del día de inicio (puede pasar de 1440). */
  minutoAbs: number;
  hora: string;
  nivel: number;
  minutosNivel: number;
  umbralNivel: number;
  padre: number | null;
  promovido: boolean;
}

/**
 * Genera los candidatos de un periodo, anclando la rejilla a MEDIANOCHE.
 *
 * El anclaje a medianoche es lo que hace que "las enteras" sean 13:00, 14:00…
 * y no "13:20, 14:20" cuando el periodo empieza a las 13:20. Un periodo que
 * no empieza en una posición de la rejilla del nivel 0 simplemente no tiene
 * hueco de nivel 0 al principio: su primer hueco se PROMUEVE (ver `promovido`)
 * para que el periodo no quede vacío.
 */
function generarCandidatos(
  inicio: number,
  fin: number,
  escalera: NivelEscalera[],
): { candidatos: CandidatoHueco[]; tope: boolean } {
  const porMinuto = new Map<number, CandidatoHueco>();
  let tope = false;

  for (let nivel = 0; nivel < escalera.length; nivel++) {
    const paso = escalera[nivel].minutos;
    let t = Math.ceil(inicio / paso) * paso;
    let guardia = 0;
    while (t < fin) {
      if (++guardia > MAX_HUECOS_POR_PERIODO) {
        tope = true;
        break;
      }
      if (!porMinuto.has(t)) {
        // Padre = el múltiplo del paso del nivel anterior inmediatamente
        // anterior a `t`. Si cae fuera del periodo, el hueco se promueve.
        let padre: number | null = null;
        let promovido = false;
        if (nivel > 0) {
          const pasoPadre = escalera[nivel - 1].minutos;
          const candidatoPadre = Math.floor(t / pasoPadre) * pasoPadre;
          if (candidatoPadre >= inicio && candidatoPadre < fin && candidatoPadre !== t) {
            padre = candidatoPadre;
          } else {
            promovido = true;
          }
        }
        porMinuto.set(t, {
          minutoAbs: t,
          hora: minutosAHora(t),
          nivel,
          minutosNivel: paso,
          umbralNivel: escalera[nivel].umbral,
          padre,
          promovido,
        });
      }
      t += paso;
    }
    if (tope) break;
  }

  const candidatos = Array.from(porMinuto.values()).sort((a, b) => a.minutoAbs - b.minutoAbs);
  return { candidatos, tope };
}

// ------------------------------------------------------------
// MOTOR
// ------------------------------------------------------------

export function calcularDisponibilidad(entrada: EntradaDisponibilidad): ResultadoDisponibilidad {
  const avisos = new Set<string>();
  const fecha = String(entrada.fecha || "");
  const comensalesPedidos = Math.max(
    1,
    Number.isFinite(Number(entrada.comensales)) ? Math.round(Number(entrada.comensales)) : 1,
  );
  const capacidadTotal = Math.max(
    0,
    Number.isFinite(Number(entrada.capacidadTotal)) ? Number(entrada.capacidadTotal) : 0,
  );
  if (capacidadTotal === 0) avisos.add(AVISO_SIN_CAPACIDAD);

  const diaSemana = diaDeLaSemana(fecha);
  const politica = entrada.politica || {};
  const ahora = entrada.ahora || null;

  // --- Ocupación por hora y por turno (SIEMPRE desde `reservas`) ---
  // Nunca desde `vista_ocupacion` / `ocupacion_diaria`: en producción 724 de
  // sus 784 filas son huérfanas y su columna `turno` usa otro corte (16:00).
  const porHora = new Map<string, { reservas: number; comensales: number }>();
  let comensalesComida = 0;
  let comensalesCena = 0;

  for (const reserva of entrada.reservas || []) {
    if (!reserva) continue;
    const minutos = horaAMinutos(reserva.hora);
    if (minutos === null) continue;
    const comensales = Number(reserva.numero_comensales);
    const suma = Number.isFinite(comensales) ? comensales : 0;
    const clave = minutosAHora(minutos);
    const actual = porHora.get(clave) || { reservas: 0, comensales: 0 };
    actual.reservas += 1;
    actual.comensales += suma;
    porHora.set(clave, actual);
    if (turnoDeHora(minutos) === "comida") comensalesComida += suma;
    else comensalesCena += suma;
  }

  const construirAforo = (ocupacion: number): AforoTurnoCalculado => {
    const disponible = Math.max(0, capacidadTotal - ocupacion);
    return {
      capacidad_maxima: capacidadTotal,
      ocupacion,
      disponible,
      porcentaje: capacidadTotal > 0 ? Math.round((ocupacion / capacidadTotal) * 100) : 0,
      completo: disponible < comensalesPedidos,
    };
  };
  const aforo = {
    comida: construirAforo(comensalesComida),
    cena: construirAforo(comensalesCena),
  };

  const ocupacion: OcupacionHora[] = Array.from(porHora.entries())
    .map(([hora, v]) => ({
      hora,
      turno: turnoDeHora(hora),
      total_reservas: v.reservas,
      total_comensales: v.comensales,
      porcentaje_hora: capacidadTotal > 0 ? Math.round((v.comensales / capacidadTotal) * 100) : 0,
    }))
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const vacio = (
    cerrado: boolean,
    motivoCierre: MotivoCierre,
    reservable: boolean,
    motivoNoReservable: MotivoDescarte | null,
    descartados: HuecoDescartado[] = [],
  ): ResultadoDisponibilidad => ({
    fecha,
    diaSemana: diaSemana === null ? -1 : diaSemana,
    cerrado,
    motivoCierre,
    reservable,
    motivoNoReservable,
    comensales: comensalesPedidos,
    periodos: [],
    huecos: [],
    descartados,
    ocupacion,
    aforo,
    avisos: Array.from(avisos),
  });

  if (diaSemana === null) {
    return vacio(true, "sin_configuracion", false, null);
  }

  // --- Política de fecha: hoy / pasada / demasiado lejana ---
  // NO se marca `cerrado`: el restaurante sí abre, lo que pasa es que esa
  // fecha no se puede reservar por este canal. Confundirlo con "cerrado"
  // le diría al cliente algo falso.
  let reservable = true;
  let motivoNoReservable: MotivoDescarte | null = null;
  if (ahora) {
    const diff = diferenciaDias(ahora.fechaHoy, fecha);
    if (diff !== null) {
      if (diff < 0) {
        reservable = false;
        motivoNoReservable = "fecha_pasada";
      } else if (diff === 0 && politica.permitirMismoDia === false) {
        reservable = false;
        motivoNoReservable = "reserva_hoy";
      } else if (
        politica.diasMaxAntelacion !== null &&
        politica.diasMaxAntelacion !== undefined &&
        diff > politica.diasMaxAntelacion
      ) {
        reservable = false;
        motivoNoReservable = "fecha_demasiado_lejana";
      }
    }
  }

  const seleccionadas = seleccionarConfiguraciones(entrada.configuraciones, entrada.espacioId, diaSemana);
  if ((entrada.configuraciones || []).length === 0) {
    return vacio(true, "sin_configuracion", reservable, motivoNoReservable);
  }
  if (seleccionadas.length === 0) {
    return vacio(true, "dia_no_configurado", reservable, motivoNoReservable);
  }

  // Se acumulan con su minuto ABSOLUTO (que puede pasar de 1440 en un
  // periodo que cruza medianoche) para poder ordenar por orden real de
  // servicio: en un turno 20:00-01:00, las 00:30 van DESPUÉS de las 23:30,
  // no las primeras. Ordenar por el texto "HH:MM" las colocaría arriba.
  const huecosOrdenables: Array<{ orden: number; hueco: HuecoCalculado }> = [];
  const descartadosOrdenables: Array<{ orden: number; descarte: HuecoDescartado }> = [];
  const periodos: PeriodoResuelto[] = [];

  const esHoy = ahora ? ahora.fechaHoy === fecha : false;
  const minutosCorte = Number.isFinite(Number(politica.minutosCorte)) ? Number(politica.minutosCorte) : 0;

  for (const config of seleccionadas) {
    const nombre = config.nombre_periodo ?? null;
    const inicio = horaAMinutos(config.hora_inicio);
    const finBruto = horaAMinutos(config.hora_fin);

    if (inicio === null || finBruto === null) {
      avisos.add(AVISO_PERIODO_INVALIDO);
      continue;
    }
    // hora_fin <= hora_inicio => el periodo cruza medianoche.
    const fin = finBruto > inicio ? finBruto : finBruto + MINUTOS_DIA;
    const span = fin - inicio;
    // `hora_fin == hora_inicio` da span exactamente 1440. Es un error de
    // configuración (periodo de longitud cero), no un servicio de 24 h: un
    // turno de día entero se configura 00:00-23:59. La versión anterior del
    // panel entraba en BUCLE INFINITO con este dato.
    if (span <= 0 || span >= MINUTOS_DIA) {
      avisos.add(AVISO_PERIODO_INVALIDO);
      continue;
    }
    if (fin > MINUTOS_DIA) avisos.add(AVISO_CRUZA_MEDIANOCHE);
    // ¿El periodo pisa la franja [16:00, 17:00) en la que los dos triggers
    // discrepan? Hoy (comida 13-16, cena 20-23) no ocurre nunca; en cuanto
    // alguien mueva un horario, sí.
    if (Math.max(inicio, MIN_CORTE_OCUPACION_DIARIA) < Math.min(fin, MIN_CORTE_TURNO)) {
      avisos.add(AVISO_DESAJUSTE_TURNO);
    }

    const { escalera, origen } = resolverEscalera(config, avisos);
    const ocultar = resolverOcultar(config);

    if (escalera.length === 0) {
      avisos.add(AVISO_PERIODO_SIN_HUECOS);
      continue;
    }

    const { candidatos, tope } = generarCandidatos(inicio, fin, escalera);
    if (tope) avisos.add(AVISO_TOPE_HUECOS);
    if (candidatos.length === 0) {
      avisos.add(AVISO_PERIODO_SIN_HUECOS);
      periodos.push({
        id: config.id ?? null,
        nombre_periodo: nombre,
        hora_inicio: normalizarHora(config.hora_inicio),
        hora_fin: normalizarHora(config.hora_fin),
        espacio_id: config.espacio_id ?? null,
        escalera,
        ocultar_nivel_anterior: ocultar,
        base_umbral: resolverBaseUmbral(config),
        base_umbral_capacidad: capacidadTotal,
        origen_escalera: origen,
        huecos_ofrecidos: 0,
        huecos_completos: 0,
      });
      continue;
    }

    const porMinuto = new Map<number, CandidatoHueco>();
    for (const c of candidatos) porMinuto.set(c.minutoAbs, c);

    const ocupacionDe = (minutoAbs: number): number => {
      const v = porHora.get(minutosAHora(minutoAbs));
      return v ? v.comensales : 0;
    };

    // ¿Sobre QUÉ se calcula el % que abre un escalón? Ver `BaseUmbral`.
    const huecosNivelBase = candidatos.filter((c) => c.nivel === 0).length || candidatos.length;
    const baseUmbral = resolverBaseUmbral(config);
    const divisor =
      baseUmbral === "reparto_nivel_base" && huecosNivelBase > 0
        ? capacidadTotal / huecosNivelBase
        : capacidadTotal;
    // Con 150 plazas y una comida de 13:00 a 16:00 (tres horas en punto),
    // `divisor` vale 50: el 70% que abre la media son 35 personas A ESA
    // MISMA HORA, y el 85% que abre el cuarto son 43.

    const porcentajeDe = (minutoAbs: number): number =>
      divisor > 0 ? (ocupacionDe(minutoAbs) / divisor) * 100 : 0;

    // --- Paso 1: ¿qué escalones están abiertos? ---
    // Un hueco de nivel k se abre si su PADRE está abierto y la ocupación
    // del padre alcanza el umbral del nivel k. La condición "padre abierto"
    // es lo que garantiza que la escalera se sube escalón a escalón y que
    // nunca aparece un cuarto de hora colgando de una media que no se ofrece.
    const abierto = new Map<number, boolean>();
    const abiertoPor = new Map<number, { hora: string; porcentaje: number }>();

    for (const c of candidatos) {
      if (c.nivel === 0 || c.promovido || c.padre === null) {
        abierto.set(c.minutoAbs, true);
        continue;
      }
      const padreAbierto = abierto.get(c.padre) === true;
      if (!padreAbierto) {
        abierto.set(c.minutoAbs, false);
        continue;
      }
      const pct = porcentajeDe(c.padre);
      if (pct >= c.umbralNivel) {
        abierto.set(c.minutoAbs, true);
        abiertoPor.set(c.minutoAbs, { hora: minutosAHora(c.padre), porcentaje: Math.round(pct) });
      } else {
        abierto.set(c.minutoAbs, false);
      }
    }

    // --- Paso 2: ocultar el nivel anterior si procede ---
    const ocultos = new Set<number>();
    if (ocultar) {
      for (const c of candidatos) {
        if (abierto.get(c.minutoAbs) !== true) continue;
        if (c.padre === null || c.promovido) continue;
        ocultos.add(c.padre);
      }
      const quedanVisibles = candidatos.some(
        (c) => abierto.get(c.minutoAbs) === true && !ocultos.has(c.minutoAbs),
      );
      // Red de seguridad: ocultar no puede dejar el periodo sin una sola hora.
      if (!quedanVisibles) {
        ocultos.clear();
        avisos.add(AVISO_OCULTAR_ANULADO);
      }
    }

    // --- Paso 3: materializar huecos y descartes ---
    let ofrecidos = 0;
    let completos = 0;

    for (const c of candidatos) {
      const detalleBase = { hora: c.hora, nivel: c.nivel, minutos_nivel: c.minutosNivel, periodo: nombre };

      if (!reservable && motivoNoReservable) {
        descartadosOrdenables.push({ orden: c.minutoAbs, descarte: {
          ...detalleBase,
          motivo: motivoNoReservable,
          detalle: `${c.hora} no se puede reservar por este canal para esa fecha`,
        } });
        continue;
      }
      if (abierto.get(c.minutoAbs) !== true) {
        const padreHora = c.padre === null ? null : minutosAHora(c.padre);
        descartadosOrdenables.push({ orden: c.minutoAbs, descarte: {
          ...detalleBase,
          motivo: "nivel_sin_abrir",
          detalle: padreHora
            ? `${c.hora} necesita que ${padreHora} llegue al ${c.umbralNivel}% (va por el ${Math.round(porcentajeDe(c.padre as number))}%)`
            : `${c.hora} no tiene un hueco anterior del que colgar`,
        } });
        continue;
      }
      if (ocultos.has(c.minutoAbs)) {
        descartadosOrdenables.push({ orden: c.minutoAbs, descarte: {
          ...detalleBase,
          motivo: "oculto_por_nivel_inferior",
          detalle: `${c.hora} se deja de ofrecer porque se ha abierto el escalón siguiente`,
        } });
        continue;
      }
      if (esHoy && ahora && c.minutoAbs - ahora.minutosDelDia < minutosCorte) {
        descartadosOrdenables.push({ orden: c.minutoAbs, descarte: {
          ...detalleBase,
          motivo: "corte_horario",
          detalle: `${c.hora} está a menos de ${minutosCorte} min`,
        } });
        continue;
      }

      const turno = turnoDeHora(c.minutoAbs);
      const aforoTurno = aforo[turno];
      const cabe = aforoTurno.disponible >= comensalesPedidos;
      const v = porHora.get(c.hora) || { reservas: 0, comensales: 0 };
      const apertura = abiertoPor.get(c.minutoAbs) || null;

      if (cabe) ofrecidos++;
      else completos++;

      huecosOrdenables.push({ orden: c.minutoAbs, hueco: {
        hora: c.hora,
        turno,
        nivel: c.nivel,
        minutos_nivel: c.minutosNivel,
        etiqueta_nivel: etiquetaNivel(c.minutosNivel),
        umbral_nivel: c.umbralNivel,
        estado: cabe ? "libre" : "completo",
        ofrecido: cabe,
        motivo: cabe ? null : "aforo_turno_completo",
        periodo: nombre,
        abierto_por: apertura ? apertura.hora : null,
        abierto_con_porcentaje: apertura ? apertura.porcentaje : null,
        promovido: c.promovido,
        comensales_hora: v.comensales,
        reservas_hora: v.reservas,
        porcentaje_hora: capacidadTotal > 0 ? Math.round((v.comensales / capacidadTotal) * 100) : 0,
        porcentaje_para_umbral: Math.round(porcentajeDe(c.minutoAbs)),
        capacidad_maxima: aforoTurno.capacidad_maxima,
        capacidad_disponible: aforoTurno.disponible,
        porcentaje_ocupacion: aforoTurno.porcentaje,
      } });
    }

    periodos.push({
      id: config.id ?? null,
      nombre_periodo: nombre,
      hora_inicio: normalizarHora(config.hora_inicio),
      hora_fin: normalizarHora(config.hora_fin),
      espacio_id: config.espacio_id ?? null,
      escalera,
      ocultar_nivel_anterior: ocultar,
      base_umbral: baseUmbral,
      base_umbral_capacidad: Math.round(divisor * 100) / 100,
      origen_escalera: origen,
      huecos_ofrecidos: ofrecidos,
      huecos_completos: completos,
    });
  }

  const huecos = huecosOrdenables.sort((a, b) => a.orden - b.orden).map((x) => x.hueco);
  const descartados = descartadosOrdenables.sort((a, b) => a.orden - b.orden).map((x) => x.descarte);

  // `cerrado` significa SOLO "el restaurante no abre ese día": cero periodos
  // aplicables. Un turno lleno NO es un día cerrado, y ninguno de los dos es
  // un error: son tres respuestas distintas.
  const cerrado = periodos.length === 0;

  return {
    fecha,
    diaSemana,
    cerrado,
    motivoCierre: cerrado ? "dia_no_configurado" : null,
    reservable,
    motivoNoReservable,
    comensales: comensalesPedidos,
    periodos,
    huecos,
    descartados,
    ocupacion,
    aforo,
    avisos: Array.from(avisos),
  };
}

/** Atajo: solo las horas que se pueden reservar, en formato "HH:MM". */
export function horasOfrecidas(resultado: ResultadoDisponibilidad): string[] {
  return resultado.huecos.filter((h) => h.ofrecido).map((h) => h.hora);
}

// ------------------------------------------------------------
// VALIDACIÓN DE UNA HORA CONCRETA (para /crear)
// ------------------------------------------------------------

export interface ValidacionHora {
  /** `true` = se puede seguir adelante con la reserva. */
  ok: boolean;
  /** Motivo del contrato de `/crear`. `sin_disponibilidad` -> "elige otra hora". */
  motivo: "sin_disponibilidad" | null;
  /** Código interno para el log, más fino que `motivo`. */
  codigo: "hora_no_ofrecida" | "dia_cerrado" | "hora_invalida" | null;
  /** Texto para el cliente. */
  mensaje: string | null;
  /** Detalle para `solicitudes_pendientes` y para los logs. */
  detalle: string | null;
  /**
   * `true` cuando NO se puede juzgar (no hay ni una configuración de turnos
   * legible). En ese caso `ok` es `true`: un fallo de configuración no puede
   * bloquear todas las reservas. Un día genuinamente cerrado NO es esto.
   */
  indeterminado: boolean;
}

/**
 * ¿Es `hora` una de las que el motor ofrece de verdad para ese día?
 *
 * Existe porque `/crear` aceptaba CUALQUIER hora enviada a mano: bastaba una
 * petición directa (o un bot) con `hora: "03:15"` para saltarse la escalera
 * entera. La web solo enseña lo que sale de `calcularDisponibilidad`, así
 * que el servidor tiene que exigir lo mismo.
 *
 * Importante: se espera un `resultado` calculado SIN `ahora` y SIN política
 * de fechas. Las reglas temporales (hoy, corte horario, fecha pasada o
 * lejana) ya las comprueba `/crear` antes y con mensajes mejores; volver a
 * juzgarlas aquí solo taparía el motivo bueno con uno peor.
 *
 * Tampoco juzga el aforo: un hueco `completo` SÍ pasa esta validación,
 * porque del aforo se encarga la comprobación siguiente (y, al final, el
 * trigger `trg_validar_capacidad`, que es la autoridad).
 */
export function validarHoraOfrecida(
  resultado: ResultadoDisponibilidad,
  hora: string,
): ValidacionHora {
  const ok = (): ValidacionHora => ({
    ok: true, motivo: null, codigo: null, mensaje: null, detalle: null, indeterminado: false,
  });

  // Fallo de sistema (tabla vacía o ilegible), no decisión de negocio:
  // se deja pasar y que decida el trigger.
  if (resultado.motivoCierre === "sin_configuracion") {
    return { ...ok(), indeterminado: true };
  }

  const minutos = horaAMinutos(hora);
  if (minutos === null) {
    return {
      ok: false,
      motivo: "sin_disponibilidad",
      codigo: "hora_invalida",
      mensaje: "Esa hora no es válida. Elige una de las que aparecen en la web.",
      detalle: `Hora no parseable: ${JSON.stringify(hora)}`,
      indeterminado: false,
    };
  }
  const normalizada = minutosAHora(minutos);

  if (resultado.cerrado) {
    return {
      ok: false,
      motivo: "sin_disponibilidad",
      codigo: "dia_cerrado",
      mensaje: "Ese día no abrimos. Prueba con otra fecha.",
      detalle: `Día sin turnos activos (${resultado.fecha}).`,
      indeterminado: false,
    };
  }

  if (resultado.huecos.some((h) => h.hora === normalizada)) return ok();

  const ofrecidas = horasOfrecidas(resultado);
  const sugerencia = ofrecidas.length > 0 ? ` Horas disponibles: ${ofrecidas.slice(0, 8).join(", ")}.` : "";
  return {
    ok: false,
    motivo: "sin_disponibilidad",
    codigo: "hora_no_ofrecida",
    mensaje: `A las ${normalizada} no se puede reservar ese día.${sugerencia}`,
    detalle: `Hora ${normalizada} fuera de las que ofrece el motor (${resultado.huecos.map((h) => h.hora).join(", ") || "ninguna"}).`,
    indeterminado: false,
  };
}
