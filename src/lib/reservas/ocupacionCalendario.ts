// ============================================================================
// OCUPACIÓN DEL CALENDARIO — lógica pura (sin React, sin Supabase)
// ----------------------------------------------------------------------------
// Lo que pinta la cuadrícula del mes de /reservas → Calendario (y la cabecera
// del panel del día): cuántos comensales hay, qué % del aforo ocupan y de qué
// color se ve el día. Antes la casilla se coloreaba por "reservas sin sala"
// (verde / ámbar); desde que la sala la asigna el personal DESPUÉS (reservas-
// sin-salas, ventana de 48 h) casi todo el futuro salía ámbar y el color dejó
// de decir nada. Ahora el color es el PORCENTAJE DE OCUPACIÓN (petición del
// dueño, 2026-10-01) y «sin sala» queda como un punto discreto.
//
// ---------------------------------------------------------------------------
// DECISIONES (todas ajustables desde este fichero)
// ---------------------------------------------------------------------------
// 1. QUÉ SE MIDE: comensales / aforo POR TURNO, solo de CASA TOMÁS. Es
//    exactamente lo que valida el trigger `validar_capacidad_reserva`: el aforo
//    de un turno es la suma de `capacidad_maxima` de los espacios ACTIVOS del
//    negocio (hoy 170: Comedor 50 + Salón 50 + Terraza 50 + Reservado 20) y el
//    turno parte a las 17:00.
//
//    SOLO CASA TOMÁS ADMITE RESERVAS (decisión del dueño, 2026-10-01). Si en los
//    datos aparece una reserva antigua de otro negocio (`marca = 'touza'`) se
//    IGNORA: no suma comensales, reservas ni %, ni pone el punto de «sin sala»,
//    y el aforo de sus espacios no se mira. Hay una sola escala por turno. La
//    regla es `admiteReservas` (`negocios.ts`), la misma en todo el panel.
//
// 2. QUÉ COLOR TIENE EL DÍA: el del turno MÁS LLENO (comida o cena). No una
//    media: una media de comida al 20 % y cena al 95 % da un 57 % «moderado» que
//    esconde justo lo que el dueño quiere ver, que la cena no tiene hueco. La
//    casilla enseña además el % de cada turno (dos barras) para que no se pierda
//    el otro servicio.
//
// 3. QUÉ ESTADOS CUENTAN (decisión del 2026-10-01, corrige el calendario
//    anterior, que contaba todo menos `cancelada`):
//      · HOY Y FUTURO: solo las VIVAS (pendiente, verificada, confirmada). Es
//        lo que cuenta el trigger de aforo y lo que enseña el panel del día
//        (`vista_asignacion_dia`), así que la cifra de la casilla y la del
//        panel son SIEMPRE la misma. `cancelada`, `completada` («Llegó») y
//        `no_show` («No vino») no cuentan.
//      · DÍAS PASADOS: no tienen escala. El aforo no mide algo que ya ocurrió
//        y, en producción, casi todo lo pasado es `no_show` (el cron lo marca
//        solo a las 3 h), así que contar solo lo vivo dejaría septiembre en
//        blanco. Se enseñan ATENUADOS con lo que se reservó (todo menos las
//        canceladas), sin porcentaje y sin color de ocupación.
//
// 4. «SIN SALA» NO ES UN COLOR: es un punto que solo sale si la reserva cae
//    dentro de la ventana de asignación (`configuracion_reservas.
//    asignacion_ventana_horas`, 48 h por defecto): reservas vivas, sin sala,
//    entre AHORA y ahora + N horas. Más allá de eso «sin sala» es lo normal y
//    no hay nada que decir; lo ya empezado tampoco (ya no se puede repartir).
//
// 5. EL PORCENTAJE SE TRUNCA, NO SE REDONDEA: 99,4 % es 99 %, así «100 %» solo
//    sale cuando de verdad no queda hueco, y los bordes de la escala coinciden
//    con el número que se lee (29 % es «Tranquilo», 30 % ya es «Moderado»).
//    Algo con reservas nunca enseña 0 %.
//
// ---------------------------------------------------------------------------
// LA ESCALA (un solo sitio: `UMBRALES_OCUPACION`)
// ---------------------------------------------------------------------------
// Una sola tonalidad (azul, la misma familia que `--viz-1` de los gráficos del
// panel), de claro a oscuro: más oscuro = más lleno. Una rampa de lightness, no
// de matiz: es lo que sobrevive al daltonismo. Y NUNCA solo color: la casilla
// lleva el % escrito y barras, y la leyenda trae los rangos en números.
//
//   Tranquilo   < 30 %    Moderado   30–59 %    Concurrido   60–84 %
//   Casi lleno  85–99 %   Completo   100 % (sin hueco)
//
// Contrastes medidos con `contrast()` del validador de la skill `dataviz` (WCAG,
// tema claro): el texto de cada casilla (negro sobre los tres tonos claros,
// blanco sobre los dos oscuros) tiene ≥ 6,6:1 y los números pequeños, que van al
// 80 % de opacidad, ≥ 4,8:1. Pasos consecutivos separados ≥ 0,09 de lightness
// OKLCH (el mínimo que exige la skill es 0,06). La rampa varía solo la
// luminosidad, no el matiz: sobrevive al daltonismo.
//
// El ámbar queda reservado a «sin sala» y el rojo no se usa: una cena completa
// es una buena noticia, no una alarma.
// ============================================================================

import { turnoDeHora, TURNOS, type Turno } from "@/lib/reservas/asignacionMesas";
import { ESTADO_CANCELADA, esEstadoVivo } from "@/lib/reservas/estadosReserva";
import { admiteReservas, salaAdmiteReservas } from "@/lib/reservas/negocios";
import { enVentana, sumarDias } from "@/lib/reservas/ventanaAsignacion";

// ----------------------------------------------------------------------------
// Escala: umbrales, niveles y etiquetas
// ----------------------------------------------------------------------------

/**
 * Dónde empieza cada nivel, en % del aforo del turno. ÚNICO sitio donde se
 * ajustan: la leyenda, los rangos de los textos y los niveles salen de aquí.
 * Enteros, y deben ir en orden creciente.
 */
export const UMBRALES_OCUPACION = { medio: 30, alto: 60, casiLleno: 85, completo: 100 } as const;

/** Los niveles de ocupación, de menos a más. Es lo que pinta la leyenda. */
export const NIVELES_ESCALA = ["bajo", "medio", "alto", "casi_lleno", "completo"] as const;

/**
 * Los niveles de ocupación más tres estados que NO son de la escala:
 *   · `vacio`     — sin reservas.
 *   · `pasado`    — día ya pasado: histórico atenuado, sin porcentaje.
 *   · `sin_aforo` — hay reservas pero no se conoce el aforo.
 */
export type NivelCalendario = (typeof NIVELES_ESCALA)[number] | "vacio" | "pasado" | "sin_aforo";

const ETIQUETAS_NIVEL: Record<NivelCalendario, string> = {
  vacio: "Sin reservas",
  bajo: "Tranquilo",
  medio: "Moderado",
  alto: "Concurrido",
  casi_lleno: "Casi lleno",
  completo: "Completo",
  pasado: "Día pasado",
  sin_aforo: "Sin aforo",
};

/** La palabra de un nivel: «Tranquilo», «Casi lleno», «Completo»… */
export function etiquetaNivel(nivel: NivelCalendario): string {
  return ETIQUETAS_NIVEL[nivel];
}

/**
 * El rango de un nivel en palabras de la leyenda, calculado de los umbrales:
 * «menos del 30%», «30–59%», «60–84%», «85–99%», «100%». Sin espacio antes del
 * %, como el resto del panel («33%»).
 */
export function rangoNivel(nivel: NivelCalendario): string {
  const u = UMBRALES_OCUPACION;
  switch (nivel) {
    case "bajo":
      return `menos del ${u.medio}%`;
    case "medio":
      return `${u.medio}–${u.alto - 1}%`;
    case "alto":
      return `${u.alto}–${u.casiLleno - 1}%`;
    case "casi_lleno":
      return `${u.casiLleno}–${u.completo - 1}%`;
    case "completo":
      return `${u.completo}%`;
    default:
      return "";
  }
}

/**
 * Clases Tailwind de cada nivel. Los colores son LITERALES (Tailwind solo
 * genera las clases que ve escritas enteras) y salen de la rampa azul de la
 * skill `dataviz` (pasos 100 · 250 · 350 · 550 · 700; `--viz-1` es el 450).
 *
 *   · `celda`    fondo + borde + color de texto de la casilla del día.
 *   · `hoy`      círculo del número del día de hoy, que ha de verse sobre ese fondo.
 *   · `muestra`  la muestra de la leyenda.
 *   · `relleno`  relleno de una barra sobre fondo NEUTRO (el panel del día).
 *
 * Con `dark:` por si el panel llega a tener tema oscuro (hoy no hay conmutador):
 * la rampa se invierte (más lleno = más claro) y el texto cambia de lado.
 */
export interface EstiloNivel {
  nivel: NivelCalendario;
  etiqueta: string;
  celda: string;
  hoy: string;
  muestra: string;
  relleno: string;
}

const ESTILOS: Record<NivelCalendario, Omit<EstiloNivel, "nivel" | "etiqueta">> = {
  vacio: {
    celda: "border-border bg-card text-foreground",
    hoy: "bg-primary text-primary-foreground",
    muestra: "border-border bg-card",
    relleno: "bg-muted-foreground/40",
  },
  pasado: {
    celda: "border-transparent bg-muted/40 text-muted-foreground",
    hoy: "bg-primary text-primary-foreground",
    muestra: "border-transparent bg-muted/40",
    relleno: "bg-muted-foreground/40",
  },
  sin_aforo: {
    celda: "border-border bg-muted/30 text-foreground",
    hoy: "bg-primary text-primary-foreground",
    muestra: "border-border bg-muted/30",
    relleno: "bg-muted-foreground/40",
  },
  bajo: {
    celda: "border-transparent bg-[#cde2fb] text-slate-950 dark:bg-[#223c5a] dark:text-white",
    hoy: "bg-primary text-primary-foreground",
    muestra: "border-transparent bg-[#cde2fb] dark:bg-[#223c5a]",
    relleno: "bg-[#5598e7] dark:bg-[#4283d0]",
  },
  medio: {
    celda: "border-transparent bg-[#86b6ef] text-slate-950 dark:bg-[#2d5f9c] dark:text-white",
    hoy: "bg-primary text-primary-foreground",
    muestra: "border-transparent bg-[#86b6ef] dark:bg-[#2d5f9c]",
    relleno: "bg-[#3987e5] dark:bg-[#5a97e0]",
  },
  alto: {
    celda: "border-transparent bg-[#5598e7] text-slate-950 dark:bg-[#5a97e0] dark:text-slate-950",
    hoy: "bg-primary text-primary-foreground dark:bg-slate-950 dark:text-white",
    muestra: "border-transparent bg-[#5598e7] dark:bg-[#5a97e0]",
    relleno: "bg-[#2a78d6] dark:bg-[#76aaec]",
  },
  casi_lleno: {
    celda: "border-transparent bg-[#1c5cab] text-white dark:bg-[#86b6ef] dark:text-slate-950",
    hoy: "bg-white text-slate-950 dark:bg-slate-950 dark:text-white",
    muestra: "border-transparent bg-[#1c5cab] dark:bg-[#86b6ef]",
    relleno: "bg-[#1c5cab] dark:bg-[#97c0f2]",
  },
  completo: {
    celda: "border-transparent bg-[#0d366b] text-white dark:bg-[#b4d2f6] dark:text-slate-950",
    hoy: "bg-white text-slate-950 dark:bg-slate-950 dark:text-white",
    muestra: "border-transparent bg-[#0d366b] dark:bg-[#b4d2f6]",
    relleno: "bg-[#0d366b] dark:bg-[#b4d2f6]",
  },
};

/**
 * El punto de «sin sala»: ámbar (el único ámbar de la cuadrícula) con aro blanco
 * para que se separe de cualquier fondo, claro u oscuro. Solo es un aviso
 * discreto, nunca el color del día.
 */
export const CLASES_PUNTO_SIN_SALA = "rounded-full bg-amber-500 ring-2 ring-white";

export function estiloNivel(nivel: NivelCalendario): EstiloNivel {
  return { nivel, etiqueta: ETIQUETAS_NIVEL[nivel], ...ESTILOS[nivel] };
}

// ----------------------------------------------------------------------------
// Porcentaje y nivel de UN turno
// ----------------------------------------------------------------------------

/** Números que llegan de un `select` sin validar: basura, null, negativos → 0. */
function entero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function aforoValido(capacidad: number | null | undefined): capacidad is number {
  return typeof capacidad === "number" && Number.isFinite(capacidad) && capacidad > 0;
}

/**
 * Nivel de un turno. Se compara en enteros (`comensales * 100` contra
 * `umbral * aforo`) para que ningún redondeo de coma flotante mueva un día de
 * escalón justo en el borde.
 */
export function nivelDeOcupacion(ocupados: number, capacidad: number | null | undefined): NivelCalendario {
  const comensales = entero(ocupados);
  if (comensales === 0) return "vacio";
  if (!aforoValido(capacidad)) return "sin_aforo";

  const x100 = comensales * 100;
  const u = UMBRALES_OCUPACION;
  if (x100 >= u.completo * capacidad) return "completo";
  if (x100 >= u.casiLleno * capacidad) return "casi_lleno";
  if (x100 >= u.alto * capacidad) return "alto";
  if (x100 >= u.medio * capacidad) return "medio";
  return "bajo";
}

/**
 * % de ocupación (entero), TRUNCADO: 99,4 % → 99. `null` si no se conoce el
 * aforo (no se inventa). 0 solo si no hay comensales; con reservas, mínimo 1.
 * Puede pasar de 100 si hay más comensales que aforo (un espacio desactivado
 * después de reservar): se dice tal cual.
 */
export function porcentajeOcupacion(ocupados: number, capacidad: number | null | undefined): number | null {
  if (!aforoValido(capacidad)) return null;
  const comensales = entero(ocupados);
  if (comensales === 0) return 0;
  return Math.max(1, Math.floor((comensales * 100) / capacidad));
}

// ----------------------------------------------------------------------------
// Casa Tomás: el único negocio que se mide (la regla es `admiteReservas`)
// ----------------------------------------------------------------------------

/** Lo que se lee de un espacio para saber su aforo (los `select("*")` traen más). */
export interface EspacioConAforo {
  id?: string;
  capacidad_maxima?: unknown;
  activa?: boolean | null;
  caracteristicas?: unknown;
  marca?: string | null;
}

/**
 * Aforo por turno de Casa Tomás: suma de `capacidad_maxima` de sus espacios
 * ACTIVOS, igual que el trigger (un espacio sin marca es de Casa Tomás y uno sin
 * `activa` se da por activo: solo `activa === false` se descarta). Los espacios
 * de otro negocio no cuentan (`salaAdmiteReservas`). `null` si no hay aforo (lista vacía o nula, o todo a 0):
 * es «no se sabe», no «0 plazas».
 */
export function aforoCasaTomas(espacios: ReadonlyArray<EspacioConAforo> | null | undefined): number | null {
  let total = 0;
  for (const e of espacios ?? []) {
    if (!e || e.activa === false || !salaAdmiteReservas(e)) continue;
    total += entero(e.capacidad_maxima);
  }
  return total > 0 ? total : null;
}

// ----------------------------------------------------------------------------
// Ocupación de un día (a partir de reservas ya filtradas por estado)
// ----------------------------------------------------------------------------

/** Una reserva viva reducida a lo que mide el aforo. */
export interface ItemOcupacion {
  /** Las que no son de Casa Tomás se ignoran (ver `admiteReservas`). */
  marca?: string | null;
  turno: Turno;
  comensales: number;
}

/** Un turno (comida o cena) de un día. */
export interface TurnoOcupacion {
  turno: Turno;
  comensales: number;
  reservas: number;
  /** Aforo por turno; `null` si no se conoce. */
  capacidad: number | null;
  porcentaje: number | null;
  nivel: NivelCalendario;
  /** Plazas que quedan (nunca negativo); `null` sin aforo. */
  libres: number | null;
  /** Comensales por encima del aforo (0 casi siempre). */
  sobreaforo: number;
}

export interface OcupacionDia {
  /** Siempre los dos turnos, con 0 comensales si no hay reservas. */
  turnos: Record<Turno, TurnoOcupacion>;
  /** El turno con más % de aforo (decide el color del día); `null` si no se puede medir. */
  masLleno: TurnoOcupacion | null;
  nivel: NivelCalendario;
  porcentaje: number | null;
  /** Reservas y comensales contados (los dos turnos juntos). */
  reservas: number;
  comensales: number;
}

function turnoOcupacion(turno: Turno, comensales: number, reservas: number, capacidad: number | null): TurnoOcupacion {
  return {
    turno,
    comensales,
    reservas,
    capacidad,
    porcentaje: porcentajeOcupacion(comensales, capacidad),
    nivel: nivelDeOcupacion(comensales, capacidad),
    libres: capacidad === null ? null : Math.max(0, capacidad - comensales),
    sobreaforo: capacidad === null ? 0 : Math.max(0, comensales - capacidad),
  };
}

/**
 * Mide cada turno contra el aforo de Casa Tomás y elige el más lleno. Es la
 * función que comparten la casilla del mes y la cabecera del panel del día, para
 * que digan siempre lo mismo. Ignora lo que no es de Casa Tomás.
 */
export function ocupacionPorTurno(items: readonly ItemOcupacion[], aforo: number | null | undefined): OcupacionDia {
  const capacidad = aforoValido(aforo) ? aforo : null;
  const acumulado: Record<Turno, { comensales: number; reservas: number }> = {
    comida: { comensales: 0, reservas: 0 },
    cena: { comensales: 0, reservas: 0 },
  };
  for (const it of items) {
    if (!admiteReservas(it.marca)) continue;
    acumulado[it.turno].comensales += entero(it.comensales);
    acumulado[it.turno].reservas += 1;
  }

  const turnos = {} as Record<Turno, TurnoOcupacion>;
  for (const turno of TURNOS) {
    turnos[turno] = turnoOcupacion(turno, acumulado[turno].comensales, acumulado[turno].reservas, capacidad);
  }

  // El más lleno: si empatan, la comida (primero en el orden de servicio). Sin
  // aforo conocido no se puede medir.
  let masLleno: TurnoOcupacion | null = null;
  for (const turno of TURNOS) {
    const t = turnos[turno];
    if (capacidad === null || t.comensales === 0) continue;
    if (masLleno === null || t.comensales > masLleno.comensales) masLleno = t;
  }

  const reservas = turnos.comida.reservas + turnos.cena.reservas;
  const comensales = turnos.comida.comensales + turnos.cena.comensales;
  const nivel: NivelCalendario = reservas === 0 ? "vacio" : masLleno ? masLleno.nivel : comensales > 0 ? "sin_aforo" : "vacio";

  return { turnos, masLleno, nivel, porcentaje: masLleno ? masLleno.porcentaje : null, reservas, comensales };
}

// ----------------------------------------------------------------------------
// Un día y un mes
// ----------------------------------------------------------------------------

/** Lo que la cuadrícula necesita de cada fila de `reservas`. */
export interface ReservaCalendario {
  id?: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** `HH:MM` o `HH:MM:SS`. */
  hora: string;
  numero_comensales: number | string | null;
  estado: string;
  marca?: string | null;
  espacio_id?: string | null;
}

export interface ContextoCalendario {
  /** Hoy en hora de Madrid (`YYYY-MM-DD`). Lo anterior es «pasado». */
  hoy: string;
  /** Ahora, en ms epoch: ancla de la ventana de asignación. */
  ahora: number;
  /** Ventana de asignación (`configuracion_reservas.asignacion_ventana_horas`). */
  ventanaHoras: number;
}

export interface ResumenDiaCalendario extends OcupacionDia {
  fecha: string;
  esPasado: boolean;
  /** Reservas vivas sin sala dentro de la ventana de asignación (el punto discreto). */
  sinSalaEnVentana: number;
}

const tieneSala = (espacioId: string | null | undefined) => !!espacioId && String(espacioId).trim() !== "";

/**
 * Resumen de UN día a partir de TODAS sus reservas (cualquier estado y marca:
 * aquí se filtra). Ver la cabecera del fichero para qué estados cuentan, por qué
 * los días pasados son histórico y por qué lo de otro negocio se ignora.
 */
export function resumirDia(
  fecha: string,
  reservas: readonly ReservaCalendario[],
  aforo: number | null | undefined,
  contexto: ContextoCalendario,
): ResumenDiaCalendario {
  const deCasaTomas = reservas.filter((r) => admiteReservas(r.marca));

  if (fecha < contexto.hoy) {
    let n = 0;
    let comensales = 0;
    for (const r of deCasaTomas) {
      if (r.estado === ESTADO_CANCELADA) continue;
      n += 1;
      comensales += entero(r.numero_comensales);
    }
    const vacio = ocupacionPorTurno([], aforo);
    return {
      ...vacio,
      fecha,
      esPasado: true,
      reservas: n,
      comensales,
      nivel: n > 0 ? "pasado" : "vacio",
      sinSalaEnVentana: 0,
    };
  }

  const vivas = deCasaTomas.filter((r) => esEstadoVivo(r.estado));
  const ocupacion = ocupacionPorTurno(
    vivas.map((r) => ({ marca: r.marca, turno: turnoDeHora(r.hora), comensales: entero(r.numero_comensales) })),
    aforo,
  );

  // Solo se mira la ventana si el día puede caer dentro de ella: así un mes de
  // mil reservas no paga el cálculo de zona horaria de cada una.
  let sinSalaEnVentana = 0;
  const ultimoDiaPosible = sumarDias(contexto.hoy, Math.ceil(contexto.ventanaHoras / 24) + 1);
  if (fecha <= ultimoDiaPosible) {
    for (const r of vivas) {
      if (!tieneSala(r.espacio_id) && enVentana(r, contexto.ventanaHoras, contexto.ahora)) sinSalaEnVentana += 1;
    }
  }

  return { ...ocupacion, fecha, esPasado: false, sinSalaEnVentana };
}

/**
 * Resumen de todos los días del mes con reservas contables. Un día sin entrada
 * en el mapa es un día sin nada que contar (la casilla sale «vacía»).
 */
export function resumirMes(
  reservas: readonly ReservaCalendario[],
  aforo: number | null | undefined,
  contexto: ContextoCalendario,
): Record<string, ResumenDiaCalendario> {
  const porDia = new Map<string, ReservaCalendario[]>();
  for (const r of reservas) {
    if (!r?.fecha) continue;
    const lista = porDia.get(r.fecha);
    if (lista) lista.push(r);
    else porDia.set(r.fecha, [r]);
  }

  const salida: Record<string, ResumenDiaCalendario> = {};
  for (const [fecha, lista] of porDia) {
    const resumen = resumirDia(fecha, lista, aforo, contexto);
    if (resumen.reservas > 0) salida[fecha] = resumen;
  }
  return salida;
}

// ----------------------------------------------------------------------------
// Textos (tooltip y lector de pantalla)
// ----------------------------------------------------------------------------

const NOMBRE_TURNO: Record<Turno, string> = { comida: "Comida", cena: "Cena" };

const plural = (n: number, singular: string, plural_: string) => `${n} ${n === 1 ? singular : plural_}`;

/** «Comida: 45% (77 de 170)», «Cena: completo (170 de 170)» o, sin aforo, «Cena: 12 comensales (aforo sin configurar)». */
export function textoTurno(t: TurnoOcupacion): string {
  const cabecera = NOMBRE_TURNO[t.turno];
  if (t.capacidad === null || t.porcentaje === null) {
    return `${cabecera}: ${plural(t.comensales, "comensal", "comensales")} (aforo sin configurar)`;
  }
  // Si se pasa del aforo, la medida se queda en el aforo y el exceso se dice aparte.
  const medida = `${Math.min(t.comensales, t.capacidad)} de ${t.capacidad}`;
  if (t.nivel === "completo") {
    const extra = t.sobreaforo > 0 ? `, ${plural(t.sobreaforo, "comensal", "comensales")} por encima del aforo` : "";
    return `${cabecera}: completo (${medida}${extra})`;
  }
  return `${cabecera}: ${t.porcentaje}% (${medida})`;
}

export interface DescripcionDia {
  /** Una sola frase para `aria-label` (sin la fecha: la pone quien llama). */
  aria: string;
  /** Una línea por dato, para el tooltip. */
  lineas: string[];
}

/** El día contado para el tooltip y para el lector de pantalla. */
export function describirDia(resumen: ResumenDiaCalendario | undefined, ventanaHoras: number): DescripcionDia {
  if (!resumen || resumen.reservas === 0) return { aria: "sin reservas", lineas: ["Sin reservas"] };

  const total = `${plural(resumen.comensales, "comensal", "comensales")} en ${plural(resumen.reservas, "reserva", "reservas")}`;

  if (resumen.esPasado) {
    return {
      aria: `día pasado, ${total}`,
      lineas: [total, "Día pasado: lo que se reservó, sin contar las canceladas"],
    };
  }

  const lineas = [total];
  const partesAria = [total];

  if (resumen.masLleno) {
    const m = resumen.masLleno;
    partesAria.push(`ocupación ${m.porcentaje}% (${etiquetaNivel(m.nivel).toLowerCase()}) en la ${NOMBRE_TURNO[m.turno].toLowerCase()}`);
  } else {
    partesAria.push("aforo no disponible");
  }
  for (const turno of TURNOS) {
    if (resumen.turnos[turno].reservas > 0) lineas.push(textoTurno(resumen.turnos[turno]));
  }

  if (resumen.sinSalaEnVentana > 0) {
    const frase = `${plural(resumen.sinSalaEnVentana, "reserva sin sala", "reservas sin sala")} en las próximas ${ventanaHoras} h`;
    lineas.push(frase);
    partesAria.push(frase);
  }

  return { aria: partesAria.join("; "), lineas };
}
