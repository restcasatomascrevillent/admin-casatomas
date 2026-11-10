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
// AFORO POR NEGOCIO (marca) — bug de 2026-09-22
// ------------------------------------------------------------
// El grupo Casa Tomás tiene dos negocios (`reservas.marca`, migración
// `20260922180000_marca_negocio_en_reservas.sql`: "casa_tomas" | "touza").
// `espacios_reserva` los mezcla en UNA sola tabla — hoy Comedor/Salón/
// Terraza (casa_tomas, 50 cada uno) y "El Reservado" (touza, 20), ver
// migración `20260922150000_espacio_el_reservado_touza.sql`, que etiqueta
// cada fila con `caracteristicas->>'marca'`.
//
// Hasta la migración `20260922190000_aforo_por_marca.sql` (trigger) y este
// cambio (motor), TANTO el trigger `validar_capacidad_reserva` COMO este
// fichero sumaban `capacidad_maxima` de TODOS los espacios activos sin
// mirar la marca: al dar de alta "El Reservado" el aforo del restaurante
// pasó de 150 a 170 (150 + 20 de un espacio que no es suyo), y una
// solicitud de El Reservado se validaba contra 170 en vez de sus 20 reales.
//
// `filtrarEspaciosPorMarca`/`sumarCapacidadPorMarca` son las ÚNICAS
// funciones que filtran/suman espacios por marca — las usan
// `reservas-web/index.ts` y `useDisponibilidad.ts` (antes cada uno tenía
// su propio `.reduce()` sin filtrar, ahora es un solo sitio, testeado
// aquí). El criterio tiene que ser IDÉNTICO al del trigger o el cliente
// vería un hueco que el servidor luego rechaza (o al revés): por eso
// ambos lados usan el mismo `COALESCE(marca, 'casa_tomas')` — ver el
// propio SQL de la migración del trigger para la prueba de que coinciden.
//
// La ocupación (`reservas.numero_comensales`) NO necesita un helper
// equivalente aquí: `reservas.marca` es `NOT NULL DEFAULT 'casa_tomas'`
// (misma migración), así que quien llama filtra con `.eq("marca", marca)`
// directamente en la consulta — no hace falta emular un COALESCE en JS
// para una columna que la base de datos ya garantiza que no es NULL.
// ------------------------------------------------------------

/**
 * Valor que asume la marca de un espacio o de una reserva cuando no hay
 * dato: el negocio mayoritario e histórico, Casa Tomás. Es el mismo valor
 * que `NEGOCIO_POR_DEFECTO` en `reservas-web/plantillas.ts` y que el
 * `DEFAULT 'casa_tomas'` de la columna `reservas.marca` — repetido aquí
 * como literal, NO importado, porque este fichero no importa nada (regla
 * de oro de la cabecera). Si cambia, cambia en los tres sitios a la vez:
 * aquí, `NEGOCIO_POR_DEFECTO` y el `COALESCE` de
 * `20260922190000_aforo_por_marca.sql`.
 */
export const MARCA_POR_DEFECTO = "casa_tomas";

/** Lo mínimo de una fila de `espacios_reserva` para sumar aforo por marca. */
export interface EspacioParaAforo {
  capacidad_maxima: number;
  /** `caracteristicas->>'marca'`, tal cual llega (sin validar, puede faltar). */
  marca?: string | null;
  /**
   * `caracteristicas->>'privada'` (sala privada, hoy el «Reservado» de Casa
   * Tomás). Una sala privada está FUERA DE AFORO (decisión del dueño,
   * 2026-10-03): no suma su capacidad (ver `sumarCapacidadPorMarca`). Acepta el
   * booleano o el texto "true", como lo lee el trigger con `->>`.
   */
  privada?: boolean | string | null;
}

// ------------------------------------------------------------
// SALAS PRIVADAS — FUERA DE AFORO (decisión del dueño, 2026-10-03)
// ------------------------------------------------------------
// «El Reservado no quiero que se tenga en cuenta en los aforos porque no es
// accesible, es para gente especial y está fuera del sistema de reservas, pero
// que sepamos que está.» Una sala con `espacios_reserva.caracteristicas.privada
// = true` (hoy solo el «Reservado» de Casa Tomás, 20 plazas):
//   · NO suma su capacidad al aforo de la marca (Casa Tomás = 150);
//   · una reserva en ella NO consume aforo (ni capacidad ni comensales).
// Lo hace cumplir `validar_capacidad_reserva()` (migración
// 20261003150000_sala_privada_fuera_de_aforo.sql); estas funciones hacen que
// el motor compartido (web, emails, panel) cuente igual que el trigger.
// La exclusividad (una reserva por sala privada, día y turno) la comprueba
// SOLO el trigger; el motor no la modela (la web nunca asigna sala privada).

/** ¿`caracteristicas.privada` es verdadero? Solo `true` o el texto "true" (el `->>` del trigger). */
export function esCaracteristicaPrivada(caracteristicas: unknown): boolean {
  if (!caracteristicas || typeof caracteristicas !== "object") return false;
  const flag = (caracteristicas as { privada?: unknown }).privada;
  return flag === true || flag === "true";
}

/** Ids de las salas privadas de una lista de filas de `espacios_reserva` (con `id` y `caracteristicas`). */
export function idsSalasPrivadas(
  espacios: ReadonlyArray<{ id?: string | null; caracteristicas?: unknown } | null | undefined> | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const e of espacios ?? []) {
    if (e?.id && esCaracteristicaPrivada(e.caracteristicas)) ids.push(String(e.id));
  }
  return ids;
}

/** Las reservas que SÍ consumen aforo: las que no están en una sala privada. */
export function sinReservasEnSalasPrivadas<T extends { espacio_id?: string | null }>(
  reservas: readonly T[],
  salasPrivadas: readonly string[] | null | undefined,
): T[] {
  if (!salasPrivadas || salasPrivadas.length === 0) return [...reservas];
  const privadas = new Set(salasPrivadas);
  return reservas.filter((r) => !(r?.espacio_id && privadas.has(String(r.espacio_id))));
}

/**
 * Filtra espacios a los de la marca indicada. Mismo criterio que el
 * trigger `validar_capacidad_reserva` (versión
 * `20260922190000_aforo_por_marca.sql`): se compara
 * `COALESCE(espacio.marca, 'casa_tomas')` con `COALESCE(marca, 'casa_tomas')`
 * — un espacio sin etiquetar cuenta como Casa Tomás (nunca desaparece del
 * aforo en silencio) y una marca vacía/null también cae en Casa Tomás
 * (nunca deja el aforo en cero por accidente). Un negocio nuevo el día de
 * mañana no toca esta función: solo hace falta que sus espacios traigan
 * `caracteristicas.marca` con el valor nuevo — no hay ningún `IN`/`switch`
 * con la lista de marcas cerrada a "casa_tomas" | "touza".
 *
 * Genérica (`T extends EspacioParaAforo`) para que quien llama pueda pasar
 * la fila completa de `espacios_reserva` (con `id`, `nombre`...) y recuperar
 * esos mismos campos ya filtrados, sin tener que reconstruir los objetos.
 */
export function filtrarEspaciosPorMarca<T extends EspacioParaAforo>(
  espacios: T[],
  marca: string | null | undefined,
): T[] {
  const marcaObjetivo = marca || MARCA_POR_DEFECTO;
  return espacios.filter((e) => (e.marca || MARCA_POR_DEFECTO) === marcaObjetivo);
}

/**
 * Suma `capacidad_maxima` SOLO de los espacios de la marca indicada y SIN las
 * salas privadas (fuera de aforo, 2026-10-03: Casa Tomás = 150, no 170).
 * Ver `filtrarEspaciosPorMarca` (mismo criterio, aquí solo se reduce el
 * resultado a un número).
 */
export function sumarCapacidadPorMarca(
  espacios: EspacioParaAforo[],
  marca: string | null | undefined,
): number {
  return filtrarEspaciosPorMarca(espacios, marca)
    .filter((e) => !(e.privada === true || e.privada === "true"))
    .reduce(
      (suma, e) => suma + (Number.isFinite(Number(e.capacidad_maxima)) ? Number(e.capacidad_maxima) : 0),
      0,
    );
}

// ------------------------------------------------------------
// SALAS CERRADAS POR UN EVENTO (20261119100000)
// ------------------------------------------------------------
// Una fila de `salas_cerradas_servicio` con `reserva_id` = esa sala está
// entera para un evento (la reserva `reserva_id`) ese día y turno. Igual que
// en el trigger `validar_capacidad_reserva`:
//   - su capacidad sale del aforo de ESE turno (150 - 50 = 100 con el Salón);
//   - las reservas que están en ella (el propio evento) no consumen aforo.
// Las filas SIN `reserva_id` (el interruptor «Sala cerrada» de Organizar) no
// cambian el aforo: aquí no entran.

/** Una sala cerrada por un evento en un turno, con la capacidad que resta. */
export interface SalaCerradaPorEvento {
  espacio_id: string;
  turno: "comida" | "cena";
  capacidad_maxima: number;
}

/**
 * Convierte filas de `salas_cerradas_servicio` (ya filtradas por fecha) en
 * `SalaCerradaPorEvento`: solo las de un evento (`reserva_id`), de salas
 * activas de la marca y que no sean privadas (la privada ya está fuera de
 * aforo; restarla dos veces dejaría el aforo por debajo de lo real).
 */
export function salasCerradasPorEventoDesdeFilas(
  filas: ReadonlyArray<{ espacio_id?: string | null; turno?: string | null; reserva_id?: string | null } | null | undefined> | null | undefined,
  espacios: ReadonlyArray<{ id?: string | null; capacidad_maxima?: number | null; caracteristicas?: unknown } | null | undefined> | null | undefined,
  marca: string | null | undefined,
): SalaCerradaPorEvento[] {
  const marcaObjetivo = marca || MARCA_POR_DEFECTO;
  const porId = new Map<string, { capacidad_maxima?: number | null; caracteristicas?: unknown }>();
  for (const e of espacios ?? []) if (e?.id) porId.set(String(e.id), e);
  const vistas = new Set<string>();
  const salida: SalaCerradaPorEvento[] = [];
  for (const f of filas ?? []) {
    if (!f?.reserva_id || !f.espacio_id) continue;
    if (f.turno !== "comida" && f.turno !== "cena") continue;
    const espacio = porId.get(String(f.espacio_id));
    if (!espacio || esCaracteristicaPrivada(espacio.caracteristicas)) continue;
    const marcaEspacio = (espacio.caracteristicas as { marca?: unknown } | null)?.marca;
    if ((typeof marcaEspacio === "string" && marcaEspacio ? marcaEspacio : MARCA_POR_DEFECTO) !== marcaObjetivo) continue;
    const clave = `${f.turno}|${f.espacio_id}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    const capacidad = Number(espacio.capacidad_maxima);
    salida.push({ espacio_id: String(f.espacio_id), turno: f.turno, capacidad_maxima: Number.isFinite(capacidad) ? capacidad : 0 });
  }
  return salida;
}

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
  /**
   * Turnos de HORA FIJA (migración 20261122200100, jueves de tapas: 20:30 y
   * 22:00). `time[]` de Postgres: llega como `["20:30:00","22:00:00"]` (o en
   * texto `{20:30:00,22:00:00}`). Con valor, el periodo ofrece SOLO esas horas
   * (sin escalera). Ver `horasFijasDeConfig`.
   */
  horas_fijas?: unknown;
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
  /**
   * Ids de las salas privadas (fuera de aforo, ver `idsSalasPrivadas`). Las
   * reservas cuyo `espacio_id` esté aquí NO cuentan en la ocupación del turno,
   * igual que en el trigger. Opcional: sin él se cuentan todas (quien ya las
   * filtró con `sinReservasEnSalasPrivadas` no necesita pasarlo).
   */
  salasPrivadas?: readonly string[];
  /**
   * Suma de `capacidad_maxima` de los espacios activos DE LA MISMA MARCA
   * que la reserva/consulta. Igual que el trigger — calcúlese con
   * `sumarCapacidadPorMarca` (arriba en este mismo fichero), nunca sumando
   * todos los espacios activos sin filtrar (ese fue el bug del aforo
   * 150->170 al dar de alta "El Reservado", ver esa función).
   */
  capacidadTotal: number;
  /**
   * Salas cerradas por un EVENTO ese día (ver `salasCerradasPorEventoDesdeFilas`).
   * En su turno restan su capacidad de `capacidadTotal` y las reservas que
   * están en ellas no ocupan aforo, igual que el trigger. Sin él, nada cambia.
   */
  salasCerradasPorEvento?: ReadonlyArray<SalaCerradaPorEvento>;
  /**
   * Servicios de ESTE día en los que no se cogen reservas (cierre semanal o a
   * mano, ver `_shared/cierres.ts`). Los periodos cuyo inicio cae en un turno
   * cerrado no generan huecos; si no queda ninguno, el día sale `cerrado` con
   * `motivoCierre = "cierre_reservas"`. Sin él (el panel), no se cierra nada.
   */
  serviciosCerrados?: ReadonlyArray<"comida" | "cena">;
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
  /** Turnos de hora fija del periodo ("HH:MM"), o `null` si va por escalera. */
  horas_fijas?: string[] | null;
  huecos_ofrecidos: number;
  huecos_completos: number;
}

/**
 * `cierre_reservas`: el restaurante abre, pero ese día (o los servicios que
 * tenía) no se cogen reservas por los canales públicos — regla semanal o
 * cierre a mano del calendario (`_shared/cierres.ts`, tabla `cierres_reserva`).
 */
export type MotivoCierre = "dia_no_configurado" | "sin_configuracion" | "cierre_reservas" | null;

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
// TURNOS DE HORA FIJA (jueves de tapas, migración 20261122200100)
// ------------------------------------------------------------

/**
 * Las horas fijas de un periodo, en minutos desde medianoche, ordenadas y sin
 * repetir; `null` si el periodo va por escalera (lo de siempre). Acepta el
 * array de PostgREST (`["20:30:00", "22:00:00"]`) o el texto de Postgres
 * (`{20:30:00,22:00:00}`); lo ilegible se ignora.
 */
export function horasFijasDeConfig(config: Pick<ConfiguracionTurnoInput, "horas_fijas"> | null | undefined): number[] | null {
  let bruto = config?.horas_fijas;
  if (typeof bruto === "string") {
    const texto = bruto.trim().replace(/^\{|\}$/g, "");
    bruto = texto ? texto.split(",") : [];
  }
  if (!Array.isArray(bruto)) return null;
  const minutos = new Set<number>();
  for (const h of bruto) {
    const m = horaAMinutos(typeof h === "string" ? h.replace(/"/g, "").trim() : h);
    if (m !== null) minutos.add(m);
  }
  return minutos.size > 0 ? Array.from(minutos).sort((a, b) => a - b) : null;
}

/**
 * Turnos de hora fija de ESE día ("HH:MM", ordenados): los de los periodos
 * generales activos que aplican a su día de la semana. Vacío = día normal.
 */
export function horasFijasDelDia(
  fecha: string | null | undefined,
  configuraciones: readonly ConfiguracionTurnoInput[] | null | undefined,
): string[] {
  const dia = fecha ? diaDeLaSemana(fecha) : null;
  if (dia === null || !Array.isArray(configuraciones)) return [];
  const minutos = new Set<number>();
  for (const c of seleccionarConfiguraciones([...configuraciones], null, dia)) {
    for (const m of horasFijasDeConfig(c) ?? []) minutos.add(m);
  }
  return Array.from(minutos).sort((a, b) => a - b).map(minutosAHora);
}

/**
 * Minutos desde `hora` hasta el turno fijo SIGUIENTE, o `null` si no aplica.
 * Solo dentro de la secuencia de turnos (desde el primero): con 20:30 y 22:00,
 * una reserva de las 20:30 (o de las 21:00) tiene 90 (30) minutos antes de que
 * su mesa haga falta para el segundo turno; la de las 22:00, `null`.
 * Es la misma regla que `fn_minutos_hasta_siguiente_turno_fijo` en la base de datos.
 */
export function minutosHastaSiguienteTurnoFijo(
  hora: string | number | null | undefined,
  horasFijas: readonly string[] | null | undefined,
): number | null {
  const m = typeof hora === "number" && Number.isFinite(hora) ? hora : horaAMinutos(hora);
  if (m === null || !horasFijas || horasFijas.length === 0) return null;
  const fijas = horasFijas.map((h) => horaAMinutos(h)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (fijas.length === 0 || m < fijas[0]) return null;
  const siguiente = fijas.find((f) => f > m);
  return siguiente === undefined ? null : siguiente - m;
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

  // Salas cerradas por un evento: restan su capacidad en SU turno.
  const privadasSet = new Set(entrada.salasPrivadas || []);
  const cerradaPorEvento = new Set<string>();
  const restaTurno = { comida: 0, cena: 0 };
  for (const s of entrada.salasCerradasPorEvento || []) {
    if (!s?.espacio_id || (s.turno !== "comida" && s.turno !== "cena")) continue;
    const clave = `${s.turno}|${s.espacio_id}`;
    if (privadasSet.has(String(s.espacio_id)) || cerradaPorEvento.has(clave)) continue;
    cerradaPorEvento.add(clave);
    const c = Number(s.capacidad_maxima);
    restaTurno[s.turno] += Number.isFinite(c) && c > 0 ? c : 0;
  }
  const capacidadTurno = {
    comida: Math.max(0, capacidadTotal - restaTurno.comida),
    cena: Math.max(0, capacidadTotal - restaTurno.cena),
  };

  const diaSemana = diaDeLaSemana(fecha);
  const politica = entrada.politica || {};
  const ahora = entrada.ahora || null;

  // --- Ocupación por hora y por turno (SIEMPRE desde `reservas`) ---
  // Nunca desde `vista_ocupacion` / `ocupacion_diaria`: en producción 724 de
  // sus 784 filas son huérfanas y su columna `turno` usa otro corte (16:00).
  const porHora = new Map<string, { reservas: number; comensales: number }>();
  let comensalesComida = 0;
  let comensalesCena = 0;

  const reservasQueOcupan = sinReservasEnSalasPrivadas(entrada.reservas || [], entrada.salasPrivadas);
  for (const reserva of reservasQueOcupan) {
    if (!reserva) continue;
    const minutos = horaAMinutos(reserva.hora);
    if (minutos === null) continue;
    // El evento que tiene la sala entera no consume aforo (como en el trigger).
    if (reserva.espacio_id && cerradaPorEvento.has(`${turnoDeHora(minutos)}|${reserva.espacio_id}`)) continue;
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

  const construirAforo = (ocupacion: number, capacidad: number): AforoTurnoCalculado => {
    const disponible = Math.max(0, capacidad - ocupacion);
    return {
      capacidad_maxima: capacidad,
      ocupacion,
      disponible,
      porcentaje: capacidad > 0 ? Math.round((ocupacion / capacidad) * 100) : 0,
      completo: disponible < comensalesPedidos,
    };
  };
  const aforo = {
    comida: construirAforo(comensalesComida, capacidadTurno.comida),
    cena: construirAforo(comensalesCena, capacidadTurno.cena),
  };

  const ocupacion: OcupacionHora[] = Array.from(porHora.entries())
    .map(([hora, v]) => {
      const capacidad = capacidadTurno[turnoDeHora(hora)];
      return {
        hora,
        turno: turnoDeHora(hora),
        total_reservas: v.reservas,
        total_comensales: v.comensales,
        porcentaje_hora: capacidad > 0 ? Math.round((v.comensales / capacidad) * 100) : 0,
      };
    })
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
  // Cierres de reservas (semanal / a mano): fuera los periodos de un turno cerrado.
  const turnosCerrados = new Set(entrada.serviciosCerrados || []);
  const abiertas =
    turnosCerrados.size === 0
      ? seleccionadas
      : seleccionadas.filter((c) => {
          const inicio = horaAMinutos(c.hora_inicio);
          return inicio === null || !turnosCerrados.has(turnoDeHora(inicio));
        });
  if (abiertas.length === 0) {
    return vacio(true, "cierre_reservas", reservable, motivoNoReservable);
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

  for (const config of abiertas) {
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

    // Aforo del turno del periodo (sin las salas cerradas por un evento).
    const capacidadPeriodo = capacidadTurno[turnoDeHora(inicio)];
    const { escalera, origen } = resolverEscalera(config, avisos);
    const ocultar = resolverOcultar(config);

    if (escalera.length === 0) {
      avisos.add(AVISO_PERIODO_SIN_HUECOS);
      continue;
    }

    // Turnos de hora fija (jueves de tapas): SOLO esas horas, siempre abiertas
    // (nivel 0, sin escalera). Las que caen fuera de [inicio, fin) no cuentan.
    const fijas = horasFijasDeConfig(config);
    const { candidatos, tope } = fijas
      ? {
          candidatos: fijas
            .map((m) => (m < inicio ? m + MINUTOS_DIA : m))
            .filter((m) => m >= inicio && m < fin)
            .sort((a, b) => a - b)
            .map<CandidatoHueco>((m) => ({
              minutoAbs: m,
              hora: minutosAHora(m),
              nivel: 0,
              minutosNivel: escalera[0].minutos,
              umbralNivel: 0,
              padre: null,
              promovido: false,
            })),
          tope: false,
        }
      : generarCandidatos(inicio, fin, escalera);
    const horasFijasPeriodo = fijas ? candidatos.map((c) => c.hora) : null;
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
        base_umbral_capacidad: capacidadPeriodo,
        origen_escalera: origen,
        horas_fijas: horasFijasPeriodo,
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
        ? capacidadPeriodo / huecosNivelBase
        : capacidadPeriodo;
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
        porcentaje_hora: aforoTurno.capacidad_maxima > 0 ? Math.round((v.comensales / aforoTurno.capacidad_maxima) * 100) : 0,
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
      horas_fijas: horasFijasPeriodo,
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
