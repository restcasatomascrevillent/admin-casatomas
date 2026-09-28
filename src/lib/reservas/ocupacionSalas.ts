// ============================================================================
// OCUPACIÓN DE SALAS — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Rejilla salas × franjas horarias de UN día, para decidir dónde y a qué hora
// cabe un grupo. La usan el diálogo de solicitudes del bot
// (`SolicitudGestionPanel.tsx`) y `FormularioReserva.tsx` a través del
// componente `OcupacionSalas.tsx`; los datos los trae
// `src/hooks/useOcupacionSalasDia.ts`.
//
// CÓMO SE CUENTA (mismo criterio que el resto del sistema):
//   · El aforo se mide POR TURNO (comida / cena), no por hora suelta. Corte a
//     las 17:00 (`turnoDeHora`), copiado del trigger `validar_capacidad_reserva`.
//   · AFORO DEL TURNO (lo que valida la base de datos): suma de
//     `numero_comensales` de las reservas en `ESTADOS_QUE_OCUPAN`
//     (pendiente, verificada, confirmada) del turno, contra la suma de
//     `capacidad_maxima` de los espacios del negocio. Es EXACTAMENTE la cuenta
//     del trigger: si aquí "no cabe", el INSERT fallará con 23514.
//   · OCUPACIÓN DE CADA SALA (orientativa, la BD no la valida): mismo turno,
//     pero con `ocupaEspacio` de `servicioSala.ts` — los mismos estados MÁS
//     'completada' (un cliente que ya llegó está sentado en esa sala). Es el
//     criterio del Gestor de reservas (Kanban) al mover de espacio, así que el
//     aviso "excede la capacidad de la sala" dice lo mismo en los dos sitios.
//     Para días futuros ambas cuentas coinciden (aún no hay 'completada').
//   · DE DÓNDE SALE CADA COLUMNA (`origenFranja`): una misma rejilla mezcla
//     horas de TRES procedencias distintas, y hay que poder distinguirlas —
//     si no, parece arbitrario que unas horas lleven "y media" y otras no:
//       - "turno": la ofrece el motor para ese día (`horasBase`). Cuántas
//         ofrece lo decide la ESCALERA de `configuracion_turnos`
//         (`calcularDisponibilidad`): con poca ocupación solo las horas en
//         punto; cuando una hora llega a su umbral se abre la "y media", y
//         luego el cuarto. Por eso un día tranquilo solo enseña horas enteras.
//       - "reserva": el motor NO la ofrece ese día, pero YA hay una reserva a
//         esa hora. Se enseña a propósito (ver `calcularOcupacionSalas`):
//         esos comensales cuentan en el aforo del turno, así que esconder la
//         columna dejaría al encargado sin ver dónde están sentados.
//       - "propuesta": ni la ofrece el motor ni tiene reservas; es la hora
//         personalizada que se está proponiendo ahora (`horasExtra`).
//     Precedencia turno > reserva > propuesta: si el motor la ofrece es
//     "turno" aunque además tenga reservas.
//   · AFORO POR NEGOCIO: `calcularOcupacionSalas` mide UN negocio; los
//     espacios y reservas deben llegar ya repartidos por negocio (marca).
//     `repartirPorNegocio` hace ese reparto (espacio: `caracteristicas.marca`;
//     reserva: columna `reservas.marca`, la que usa el trigger) y
//     `calcularOcupacionPorNegocio` calcula un bloque por negocio, de modo que
//     los comensales de Touza (El Reservado) nunca cuentan contra el aforo de
//     Casa Tomás ni al revés. Decisión del dueño 2026-09-24: la rejilla
//     enseña los dos negocios, agrupados.
// ============================================================================

import {
  calcularDisponibilidad,
  ESTADOS_QUE_OCUPAN,
  horaAMinutos,
  minutosAHora,
  turnoDeHora,
  type ConfiguracionTurnoInput,
} from "../../../supabase/functions/_shared/disponibilidad";
import { ocupaEspacio } from "./servicioSala";
import { MARCA_POR_DEFECTO, normalizarMarca, agruparPorNegocio } from "./negocios";

export type Turno = "comida" | "cena";
export const TURNOS: Turno[] = ["comida", "cena"];
export const ETIQUETA_TURNO: Record<Turno, string> = { comida: "Comida", cena: "Cena" };

/** libre < 75 % · justo 75–99 % · lleno ≥ 100 % (ocupación actual). */
export type NivelOcupacion = "libre" | "justo" | "lleno";
export const UMBRAL_JUSTO = 0.75;
export const ETIQUETA_NIVEL: Record<NivelOcupacion, string> = {
  libre: "Libre",
  justo: "Justo",
  lleno: "Lleno",
};

export interface EspacioSala {
  id: string;
  nombre: string;
  capacidad_maxima: number;
  /** Negocio (`caracteristicas.marca`); sin valor = Casa Tomás. */
  marca?: string | null;
}

export interface ReservaOcupacionSala {
  id?: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
  /** Negocio (`reservas.marca`); sin valor = Casa Tomás. */
  marca?: string | null;
}

export interface FranjasDia {
  comida: string[];
  cena: string[];
}

/**
 * Por qué está una columna en la rejilla (ver la cabecera de este fichero):
 *  · "turno"     — la ofrece el motor ese día (está en `horasBase`).
 *  · "reserva"   — el motor no la ofrece, pero ya hay una reserva a esa hora.
 *  · "propuesta" — ni la ofrece el motor ni tiene reservas: es la hora que se
 *                  está proponiendo ahora mismo (`horasExtra`).
 */
export type OrigenFranja = "turno" | "reserva" | "propuesta";

/** Nombre corto de cada procedencia (cabeceras, leyenda, lector de pantalla). */
export const ETIQUETA_ORIGEN_FRANJA: Record<OrigenFranja, string> = {
  turno: "Hora del turno",
  reserva: "Hora con reserva",
  propuesta: "Hora que estás proponiendo",
};

/** La misma idea en una frase, en el lenguaje del dueño (para `title`/aria). */
export const MOTIVO_ORIGEN_FRANJA: Record<OrigenFranja, string> = {
  turno: "El sistema ofrece esta hora para ese día.",
  reserva:
    "El sistema no ofrece esta hora ese día: sale porque ya hay una reserva a esa hora y sus comensales cuentan en el aforo del turno.",
  propuesta: "El sistema no ofrece esta hora ese día: sale porque es la hora que estás proponiendo.",
};

export interface CeldaTurno {
  /** Comensales que ya ocupan la sala en el turno. */
  ocupados: number;
  /** `null` = fila "Sin asignar" (no tiene capacidad propia). */
  capacidad: number | null;
  /** Ocupación si se añade el grupo propuesto. */
  tras: number;
  /** Plazas libres que quedarían (puede ser negativo). */
  libresTras: number | null;
  nivel: NivelOcupacion;
  /** ¿Cabe el grupo en ESTA sala en este turno? */
  cabe: boolean;
}

export interface CeldaHora {
  pax: number;
  reservas: number;
}

export interface FilaSala {
  /** `null` = reservas sin espacio asignado. */
  espacioId: string | null;
  nombre: string;
  capacidad: number | null;
  turnos: Record<Turno, CeldaTurno>;
  porHora: Record<string, CeldaHora>;
}

export interface AforoTurnoDia {
  ocupados: number;
  capacidad: number;
  tras: number;
  nivel: NivelOcupacion;
  /** ¿Lo aceptaría el trigger `trg_validar_capacidad`? */
  cabe: boolean;
}

export interface OcupacionSalasDia {
  comensales: number;
  franjas: FranjasDia;
  /**
   * Procedencia de cada columna ("HH:MM" -> origen). Tiene una entrada por
   * cada hora de `franjas` (los dos turnos juntos: las horas no se repiten
   * entre comida y cena). Campo aparte para no cambiar la forma de `franjas`.
   */
  origenFranja: Record<string, OrigenFranja>;
  salas: FilaSala[];
  /** Solo existe si hay reservas que ocupan sin espacio asignado. */
  sinAsignar: FilaSala | null;
  aforo: Record<Turno, AforoTurnoDia>;
}

/** "14:00:00" | "14:00" | "9:5" -> "14:00". `null` si no se puede leer. */
export function horaCorta(hora: string | null | undefined): string | null {
  if (hora == null || hora === "") return null;
  const minutos = horaAMinutos(String(hora));
  return minutos === null ? null : minutosAHora(minutos);
}

export function nivelOcupacion(ocupados: number, capacidad: number | null): NivelOcupacion {
  if (capacidad == null) return "libre";
  if (capacidad <= 0) return "lleno";
  const ratio = ocupados / capacidad;
  if (ratio >= 1) return "lleno";
  if (ratio >= UMBRAL_JUSTO) return "justo";
  return "libre";
}

/**
 * Franjas (columnas) del día: las horas que da el motor de disponibilidad
 * (`horasBase`, las de `configuracion_turnos`) más las horas "raras" que haga
 * falta enseñar (`extras`: reservas a una hora fuera de franja, o la hora
 * personalizada que se está proponiendo). Sin duplicados, ordenadas y
 * separadas por turno con el corte del trigger.
 */
export function construirFranjas(
  horasBase: readonly (string | null | undefined)[],
  extras: readonly (string | null | undefined)[] = [],
): FranjasDia {
  const todas = conjuntoDeHoras([...horasBase, ...extras]);
  const ordenadas = Array.from(todas).sort((a, b) => a.localeCompare(b));
  return {
    comida: ordenadas.filter((h) => turnoDeHora(h) === "comida"),
    cena: ordenadas.filter((h) => turnoDeHora(h) === "cena"),
  };
}

/** Horas normalizadas a "HH:MM", sin duplicados ni valores ilegibles. */
function conjuntoDeHoras(horas: readonly (string | null | undefined)[]): Set<string> {
  const salida = new Set<string>();
  for (const h of horas) {
    const corta = horaCorta(h);
    if (corta) salida.add(corta);
  }
  return salida;
}

/**
 * Etiqueta cada franja con SU procedencia, para que la rejilla pueda enseñar
 * por qué está cada columna (ver `OrigenFranja`). Precedencia deliberada
 * turno > reserva > propuesta: si el motor ofrece la hora es "turno" aunque
 * además tenga reservas o sea la que se está proponiendo — lo que importa
 * marcar es lo contrario, la hora que el sistema NO ofrece ese día.
 */
export function clasificarOrigenFranjas(
  franjas: FranjasDia,
  horasBase: readonly (string | null | undefined)[],
  horasConReserva: readonly (string | null | undefined)[] = [],
): Record<string, OrigenFranja> {
  const deTurno = conjuntoDeHoras(horasBase);
  const conReserva = conjuntoDeHoras(horasConReserva);
  const origen: Record<string, OrigenFranja> = {};
  for (const h of [...franjas.comida, ...franjas.cena]) {
    origen[h] = deTurno.has(h) ? "turno" : conReserva.has(h) ? "reserva" : "propuesta";
  }
  return origen;
}

const ocupaAforo = (estado: string) => (ESTADOS_QUE_OCUPAN as readonly string[]).includes(estado);
const pax = (r: ReservaOcupacionSala) => Number(r.numero_comensales) || 0;

function celdaTurno(ocupados: number, capacidad: number | null, comensales: number): CeldaTurno {
  const tras = ocupados + comensales;
  return {
    ocupados,
    capacidad,
    tras,
    libresTras: capacidad == null ? null : capacidad - tras,
    nivel: nivelOcupacion(ocupados, capacidad),
    cabe: capacidad == null ? true : tras <= capacidad,
  };
}

function construirFila(
  espacioId: string | null,
  nombre: string,
  capacidad: number | null,
  reservas: ReservaOcupacionSala[],
  comensales: number,
): FilaSala {
  const propias = reservas.filter((r) => (r.espacio_id ?? null) === espacioId && ocupaEspacio(r.estado));
  const turnos = {} as Record<Turno, CeldaTurno>;
  for (const turno of TURNOS) {
    const ocupados = propias.filter((r) => turnoDeHora(r.hora) === turno).reduce((s, r) => s + pax(r), 0);
    turnos[turno] = celdaTurno(ocupados, capacidad, comensales);
  }
  const porHora: Record<string, CeldaHora> = {};
  for (const r of propias) {
    const h = horaCorta(r.hora);
    if (!h) continue;
    const celda = porHora[h] ?? { pax: 0, reservas: 0 };
    celda.pax += pax(r);
    celda.reservas += 1;
    porHora[h] = celda;
  }
  return { espacioId, nombre, capacidad, turnos, porHora };
}

export interface EntradaOcupacionSalas {
  /** Espacios de UN negocio (ver `repartirPorNegocio`). */
  espacios: EspacioSala[];
  /** Reservas del día (cualquier estado: aquí se filtran). */
  reservas: ReservaOcupacionSala[];
  /** Horas que ofrece el motor para ese día. */
  horasBase: readonly string[];
  /** Horas adicionales a mostrar (p. ej. la hora propuesta). */
  horasExtra?: readonly (string | null | undefined)[];
  /** Tamaño del grupo que se quiere colocar. */
  comensales: number;
  /** Al editar una reserva existente: no contarla contra sí misma. */
  excluirReservaId?: string | null;
}

export function calcularOcupacionSalas(entrada: EntradaOcupacionSalas): OcupacionSalasDia {
  const comensales = Math.max(0, Number(entrada.comensales) || 0);
  const reservas = entrada.reservas.filter((r) => !entrada.excluirReservaId || r.id !== entrada.excluirReservaId);

  // Reservas a horas fuera de franja también se enseñan como columna: si no,
  // sus comensales contarían en el turno sin que se viera dónde están.
  // `origenFranja` guarda de cuál de los tres sitios viene cada columna para
  // que la rejilla pueda marcar las que el motor NO ofrece ese día.
  const horasConReservas = reservas.filter((r) => ocupaEspacio(r.estado)).map((r) => r.hora);
  const franjas = construirFranjas(entrada.horasBase, [...(entrada.horasExtra ?? []), ...horasConReservas]);
  const origenFranja = clasificarOrigenFranjas(franjas, entrada.horasBase, horasConReservas);

  const espacios = [...entrada.espacios].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const salas = espacios.map((e) =>
    construirFila(e.id, e.nombre, Number(e.capacidad_maxima) || 0, reservas, comensales),
  );

  const idsConocidos = new Set(espacios.map((e) => e.id));
  // "Sin asignar" = sin espacio, o con un espacio que ya no está activo / es de
  // otro negocio. Se agrupan para que ningún comensal desaparezca de la vista.
  const huerfanas = reservas
    .filter((r) => !r.espacio_id || !idsConocidos.has(r.espacio_id))
    .map((r) => ({ ...r, espacio_id: null }));
  const filaSinAsignar = construirFila(null, "Sin asignar", null, huerfanas, comensales);
  const haySinAsignar = TURNOS.some((t) => filaSinAsignar.turnos[t].ocupados > 0);

  const capacidadTotal = espacios.reduce((s, e) => s + (Number(e.capacidad_maxima) || 0), 0);
  const aforo = {} as Record<Turno, AforoTurnoDia>;
  for (const turno of TURNOS) {
    const ocupados = reservas
      .filter((r) => ocupaAforo(r.estado) && turnoDeHora(r.hora) === turno)
      .reduce((s, r) => s + pax(r), 0);
    const tras = ocupados + comensales;
    aforo[turno] = {
      ocupados,
      capacidad: capacidadTotal,
      tras,
      nivel: nivelOcupacion(ocupados, capacidadTotal),
      // Misma condición que el trigger: ocupación + nuevos > capacidad => rechazo.
      cabe: tras <= capacidadTotal,
    };
  }

  return { comensales, franjas, origenFranja, salas, sinAsignar: haySinAsignar ? filaSinAsignar : null, aforo };
}

// ----------------------------------------------------------------------------
// VARIOS NEGOCIOS (Casa Tomás + Touza · El Reservado)
// ----------------------------------------------------------------------------

export interface BloqueNegocioSalas {
  marca: string;
  espacios: EspacioSala[];
  /** Reservas del día de ESTE negocio (columna `reservas.marca`). */
  reservas: ReservaOcupacionSala[];
}

/**
 * Reparte espacios y reservas por negocio. Una reserva va al negocio de SU
 * columna `marca` (aunque su `espacio_id` apunte a una sala de otro negocio:
 * así lo cuenta el trigger; en la rejilla saldrá en "Sin asignar" de su
 * negocio). Casa Tomás siempre tiene bloque; los demás, si tienen espacios o
 * reservas ese día.
 */
export function repartirPorNegocio(
  espacios: readonly EspacioSala[],
  reservas: readonly ReservaOcupacionSala[],
): BloqueNegocioSalas[] {
  const porEspacio = agruparPorNegocio(espacios, (e) => normalizarMarca(e.marca), [MARCA_POR_DEFECTO]);
  const porReserva = agruparPorNegocio(reservas, (r) => normalizarMarca(r.marca));
  const marcas = agruparPorNegocio(
    [...porEspacio.map((g) => g.negocio.marca), ...porReserva.map((g) => g.negocio.marca)],
    (m) => m,
  ).map((g) => g.negocio.marca);
  return marcas.map((marca) => ({
    marca,
    espacios: porEspacio.find((g) => g.negocio.marca === marca)?.items ?? [],
    reservas: porReserva.find((g) => g.negocio.marca === marca)?.items ?? [],
  }));
}

/**
 * Horas (franjas) que ofrece el motor para un negocio ese día. Casa Tomás:
 * turnos generales (`espacio_id` null), como siempre. Otro negocio: la unión
 * de las horas de cada uno de sus espacios — el motor usa los turnos propios
 * del espacio si los tiene y, si no, los generales (`seleccionarConfiguraciones`).
 */
export function horasBaseDeNegocio(
  fecha: string,
  bloque: BloqueNegocioSalas,
  configuraciones: readonly ConfiguracionTurnoInput[],
): { horasBase: string[]; cerrado: boolean } {
  const capacidadTotal = bloque.espacios.reduce((s, e) => s + (Number(e.capacidad_maxima) || 0), 0);
  const reservasQueOcupan = bloque.reservas.filter((r) => ocupaAforo(r.estado));
  const ids: (string | null)[] =
    normalizarMarca(bloque.marca) === MARCA_POR_DEFECTO || bloque.espacios.length === 0
      ? [null]
      : bloque.espacios.map((e) => e.id);
  const horas = new Set<string>();
  let cerrado = true;
  for (const espacioId of ids) {
    const resultado = calcularDisponibilidad({
      fecha,
      espacioId,
      configuraciones: configuraciones as ConfiguracionTurnoInput[],
      reservas: reservasQueOcupan,
      capacidadTotal,
      ahora: null,
    });
    if (!resultado.cerrado) cerrado = false;
    for (const h of resultado.huecos) horas.add(h.hora);
  }
  return { horasBase: Array.from(horas), cerrado };
}

export interface OcupacionNegocio {
  marca: string;
  ocupacion: OcupacionSalasDia;
  cerrado: boolean;
}

/** Un `calcularOcupacionSalas` por negocio: aforo por turno SEPARADO. */
export function calcularOcupacionPorNegocio(entrada: {
  bloques: readonly (BloqueNegocioSalas & { horasBase: readonly string[]; cerrado?: boolean })[];
  horasExtra?: readonly (string | null | undefined)[];
  /** Tamaño del grupo: solo se prueba en el negocio en juego. */
  comensales: number;
  /** Negocio de la sala elegida (por defecto Casa Tomás). Los demás bloques
   * se calculan con 0 comensales: solo enseñan su ocupación. */
  marcaEnJuego?: string | null;
  excluirReservaId?: string | null;
}): OcupacionNegocio[] {
  const enJuego = normalizarMarca(entrada.marcaEnJuego);
  return entrada.bloques.map((b) => ({
    marca: b.marca,
    cerrado: !!b.cerrado,
    ocupacion: calcularOcupacionSalas({
      espacios: b.espacios,
      reservas: b.reservas,
      horasBase: b.horasBase,
      horasExtra: normalizarMarca(b.marca) === enJuego ? entrada.horasExtra : [],
      comensales: normalizarMarca(b.marca) === enJuego ? entrada.comensales : 0,
      excluirReservaId: entrada.excluirReservaId,
    }),
  }));
}

// ----------------------------------------------------------------------------
// EVALUAR UNA UBICACIÓN CONCRETA (espacio + hora)
// ----------------------------------------------------------------------------

export interface EvaluacionUbicacion {
  turno: Turno;
  /** `null` si no hay espacio elegido. */
  sala: FilaSala | null;
  celda: CeldaTurno | null;
  /** La sala tiene sitio (o no hay sala elegida). Orientativo: no bloquea. */
  cabeSala: boolean;
  /** El turno tiene aforo — si es `false` la base de datos RECHAZARÁ el alta. */
  cabeAforo: boolean;
  aforo: AforoTurnoDia;
}

export function evaluarUbicacion(
  ocupacion: OcupacionSalasDia,
  espacioId: string | null,
  hora: string | null | undefined,
): EvaluacionUbicacion | null {
  const h = horaCorta(hora);
  if (!h) return null;
  const turno = turnoDeHora(h);
  const sala = espacioId ? ocupacion.salas.find((s) => s.espacioId === espacioId) ?? null : null;
  const celda = sala ? sala.turnos[turno] : null;
  const aforo = ocupacion.aforo[turno];
  return { turno, sala, celda, cabeSala: celda ? celda.cabe : true, cabeAforo: aforo.cabe, aforo };
}

// ----------------------------------------------------------------------------
// RECOMENDACIÓN EN UNA LÍNEA
// ----------------------------------------------------------------------------

export type Recomendacion =
  | { tipo: "cabe"; espacioId: string | null; hora: string; texto: string }
  | { tipo: "sugerencia"; espacioId: string; hora: string; texto: string }
  | { tipo: "sin_hueco"; texto: string };

const describirCelda = (c: CeldaTurno) =>
  `${c.ocupados}/${c.capacidad} ocupadas, quedarían ${Math.max(0, c.libresTras ?? 0)} libres`;

/** Sala con más plazas libres tras colocar el grupo, entre las que caben. */
function mejorSala(ocupacion: OcupacionSalasDia, turno: Turno, excluir?: string | null): FilaSala | null {
  const candidatas = ocupacion.salas
    .filter((s) => s.espacioId !== excluir && s.turnos[turno].cabe && (s.capacidad ?? 0) > 0)
    .sort((a, b) => (b.turnos[turno].libresTras ?? 0) - (a.turnos[turno].libresTras ?? 0));
  return candidatas[0] ?? null;
}

/** Hora del turno con menos comensales ya sentados (reparte la carga). */
function horaMasTranquila(ocupacion: OcupacionSalasDia, turno: Turno, sala: FilaSala): string | null {
  const horas = ocupacion.franjas[turno];
  if (horas.length === 0) return null;
  return [...horas].sort((a, b) => {
    const diff = (sala.porHora[a]?.pax ?? 0) - (sala.porHora[b]?.pax ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  })[0];
}

/**
 * Una frase que ayude a decidir. Prioridad:
 *  1. La ubicación elegida cabe (sala y aforo del turno) -> se confirma.
 *  2. Misma hora, otra sala que sí cabe (o asignar sala si no hay ninguna).
 *  3. El otro turno del mismo día, en la sala y hora más holgadas.
 *  4. Nada cabe ese día.
 */
export function recomendarUbicacion(
  ocupacion: OcupacionSalasDia,
  elegido: { espacioId: string | null; hora: string | null | undefined },
): Recomendacion {
  const n = ocupacion.comensales;
  const hora = horaCorta(elegido.hora);
  const turnoPedido: Turno | null = hora ? turnoDeHora(hora) : null;

  if (ocupacion.salas.length === 0) {
    return { tipo: "sin_hueco", texto: "No hay salas activas configuradas." };
  }

  if (hora && turnoPedido) {
    const ev = evaluarUbicacion(ocupacion, elegido.espacioId, hora)!;
    if (ev.cabeAforo && ev.sala && ev.celda?.cabe) {
      return {
        tipo: "cabe",
        espacioId: ev.sala.espacioId,
        hora,
        texto: `Cabe en ${ev.sala.nombre} a las ${hora} (${describirCelda(ev.celda)}).`,
      };
    }
    if (ev.cabeAforo) {
      const otra = mejorSala(ocupacion, turnoPedido, elegido.espacioId);
      if (otra) {
        const prefijo = ev.sala ? `No cabe en ${ev.sala.nombre}. ` : "";
        return {
          tipo: "sugerencia",
          espacioId: otra.espacioId!,
          hora,
          texto: `${prefijo}Cabe en ${otra.nombre} a las ${hora} (${describirCelda(otra.turnos[turnoPedido])}).`,
        };
      }
    }
  }

  // Probar el otro turno (o ambos si no hay hora elegida).
  const turnosAProbar: Turno[] = turnoPedido ? TURNOS.filter((t) => t !== turnoPedido) : TURNOS;
  for (const turno of turnosAProbar) {
    if (!ocupacion.aforo[turno].cabe) continue;
    const sala = mejorSala(ocupacion, turno);
    const h = sala ? horaMasTranquila(ocupacion, turno, sala) : null;
    if (sala && h) {
      const motivo = turnoPedido
        ? ocupacion.aforo[turnoPedido].cabe
          ? `No cabe en ninguna sala en el turno de ${turnoPedido}. `
          : `Turno de ${turnoPedido} completo (${ocupacion.aforo[turnoPedido].ocupados}/${ocupacion.aforo[turnoPedido].capacidad}). `
        : "";
      return {
        tipo: "sugerencia",
        espacioId: sala.espacioId!,
        hora: h,
        texto: `${motivo}Cabe en ${sala.nombre} a las ${h} (${describirCelda(sala.turnos[turno])}).`,
      };
    }
  }

  return {
    tipo: "sin_hueco",
    texto: `Ese día no caben ${n} personas en ninguna sala. Prueba otro día o reparte el grupo.`,
  };
}
