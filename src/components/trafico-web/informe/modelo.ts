/**
 * Informe mensual de tráfico web «para el dueño» (botón Generar informe).
 *
 * Lógica pura, sin React: de los datos de las RPC (`DatosInformeTrafico`)
 * saca las cifras, la comparación con el mes anterior, los titulares de cada
 * diapositiva (la conclusión, no el nombre de la métrica) y las conclusiones
 * finales. Todo por reglas fijas sobre los datos: nada de IA.
 *
 * Reglas de datos (las mismas del resto de la pantalla):
 *   · NULL = sin datos, nunca 0. Un día sin sincronizar no cuenta.
 *   · Los días anteriores a la primera visita registrada de la web son "aún
 *     no se medía": Vercel los devuelve rellenos con 0 y se tratan como NULL.
 *   · Si a alguno de los dos meses le faltan días, se compara la media por
 *     día (un hueco no es una caída); con menos de medio mes medido en
 *     cualquiera de los dos no se compara.
 */
import { addDays, differenceInCalendarDays, endOfMonth, format, getISODay, parseISO, startOfMonth, subDays, subMonths } from "date-fns";
import type { DatosInformeTrafico, FilaSerie, FiltroProyecto, RangoDatosInforme } from "@/hooks/useTraficoWeb";
import { resumirSerie } from "../calculos";
import {
  fmtCuota,
  fmtDiaCorto,
  fmtDiaLargo,
  fmtEntero,
  fmtMedia,
  fmtMes,
  fmtMesAnio,
  fmtVariacion,
  fmtVariacionAbs,
  mayusculaInicial,
  unirLista,
} from "./formatoInforme";
import {
  claveDispositivo,
  DIAS_SEMANA,
  esRutaCarta,
  esRutaReservas,
  idiomaDeRuta,
  NOMBRE_DISPOSITIVO,
  NOMBRE_IDIOMA,
  nombrePagina,
  nombrePais,
  nombreProcedencia,
  nombreWeb,
  ORDEN_DISPOSITIVOS,
  type ClaveDispositivo,
  type GrupoProcedencia,
  type Idioma,
} from "./nombres";

const ISO = "yyyy-MM-dd";

/** Variación por debajo de este ±% se cuenta como «en la línea». */
export const UMBRAL_ESTABLE_PCT = 5;
/** Mínimo de días con dato para pintar la gráfica por día de la semana. */
export const DIAS_MINIMOS_SEMANA = 14;
/** Una anomalía solo es fiable con 8 semanas de historia detrás (la línea base son los 8 mismos días anteriores). */
export const DIAS_HISTORIA_ANOMALIAS = 56;
/** Páginas que se dibujan en la gráfica (el resto se cuenta en una nota). */
export const MAX_PAGINAS = 7;
export const MAX_PROCEDENCIAS = 5;
export const MAX_PAISES = 4;
export const MAX_CONCLUSIONES = 5;

// ─── Meses ───────────────────────────────────────────────────────────────────
export interface RangoInforme {
  /** yyyy-MM */
  mes: string;
  desde: string;
  finMes: string;
  /** Último día cerrado del mes (≤ ayer). */
  hasta: string;
  desdeAnterior: string;
  hastaAnterior: string;
  enCurso: boolean;
  diasMes: number;
  /** Días de `desde` a `hasta` (0 si el mes aún no tiene ninguno cerrado). */
  diasCerrados: number;
  diasMesAnterior: number;
}

export function rangoInforme(mes: string, hoy: string): RangoInforme {
  const ini = parseISO(`${mes}-01`);
  const fin = endOfMonth(ini);
  const ayer = subDays(parseISO(hoy), 1);
  const hasta = fin.getTime() < ayer.getTime() ? fin : ayer;
  const iniAnt = subMonths(ini, 1);
  const finAnt = subDays(ini, 1);
  return {
    mes,
    desde: format(ini, ISO),
    finMes: format(fin, ISO),
    hasta: format(hasta, ISO),
    desdeAnterior: format(iniAnt, ISO),
    hastaAnterior: format(finAnt, ISO),
    enCurso: fin.getTime() >= parseISO(hoy).getTime(),
    diasMes: differenceInCalendarDays(fin, ini) + 1,
    diasCerrados: Math.max(0, differenceInCalendarDays(hasta, ini) + 1),
    diasMesAnterior: differenceInCalendarDays(finAnt, iniAnt) + 1,
  };
}

/** Lo que hay que pedir a Supabase; NULL si el mes no tiene aún ningún día cerrado. */
export const rangoDatos = (r: RangoInforme): RangoDatosInforme | null =>
  r.diasCerrados > 0 ? { desdeAnterior: r.desdeAnterior, desde: r.desde, hasta: r.hasta } : null;

export interface OpcionMes {
  clave: string;
  etiqueta: string;
  enCurso: boolean;
}

/** El mes en curso (si ya tiene algún día cerrado) y los `cuantos` anteriores, del más reciente al más antiguo. */
export function mesesSeleccionables(hoy: string, cuantos = 12): OpcionMes[] {
  const dia = parseISO(hoy);
  const base = startOfMonth(dia);
  const opciones: OpcionMes[] = [];
  if (dia.getDate() > 1) {
    opciones.push({ clave: format(base, "yyyy-MM"), etiqueta: `${mayusculaInicial(fmtMesAnio(format(base, ISO)))} (en curso)`, enCurso: true });
  }
  for (let i = 1; i <= cuantos; i++) {
    const m = subMonths(base, i);
    opciones.push({ clave: format(m, "yyyy-MM"), etiqueta: mayusculaInicial(fmtMesAnio(format(m, ISO))), enCurso: false });
  }
  return opciones;
}

/** Por defecto, el último mes cerrado. */
export const mesPorDefecto = (hoy: string): string => format(subMonths(startOfMonth(parseISO(hoy)), 1), "yyyy-MM");

// ─── Tipos del informe ───────────────────────────────────────────────────────
export interface Variacion {
  /** % frente al mes anterior. */
  valor: number;
  /** "total": meses completos, se comparan totales. "media": se compara la media por día. */
  base: "total" | "media";
}

export interface Cifra {
  valor: number | null;
  variacion: Variacion | null;
  /** Valor del mes anterior en la misma base que la variación (total o media por día). */
  anterior: number | null;
}

export interface PuntoEvolucion {
  dia: number;
  fecha: string;
  actual: number | null;
  anterior: number | null;
}

export interface ItemBarra {
  nombre: string;
  visitas: number;
  /** % sobre el total de su gráfica. */
  pct: number;
  destacado: boolean;
  explicacion?: string;
}

export interface ParteDispositivo {
  clave: ClaveDispositivo;
  nombre: string;
  visitas: number;
  pct: number;
}

export interface DiaSemanaInforme {
  corto: string;
  singular: string;
  media: number | null;
  dias: number;
  destacado: boolean;
}

export interface InformeVacio {
  vacio: true;
  titulo: string;
  motivo: string;
}

export interface InformeTrafico {
  vacio: false;
  proyecto: FiltroProyecto;
  /** «la web de Casa Tomás» */
  web: string;
  /** «Tráfico de la web de Casa Tomás: octubre 2026» */
  titulo: string;
  nombreArchivo: string;
  /** «Del 1 al 31 de octubre de 2026 · comparado con septiembre» */
  periodo: string;
  mes: { clave: string; nombre: string; nombreAnio: string; enCurso: boolean; diasConDato: number; diasPeriodo: number };
  mesAnterior: { nombre: string; diasConDato: number; diasMes: number };
  resumen: {
    titular: string;
    paginasVistas: Cifra;
    visitantes: Cifra;
    mediaDiaria: Cifra;
    paginasPorVisitante: number | null;
    comparable: boolean;
    /** «frente a septiembre» o por qué no se compara. */
    comparacion: string;
  };
  evolucion: {
    titular: string;
    puntos: PuntoEvolucion[];
    mejorDia: { dia: number; fecha: string; visitas: number; texto: string } | null;
    notaAnomalias: string | null;
    /** Se dibuja el mes anterior solo si la comparación es válida. */
    hayAnterior: boolean;
    /** Tramos de días (número de día del mes) sin datos tras empezar a medir. */
    huecos: { desde: number; hasta: number }[];
  };
  paginas: {
    titular: string;
    items: ItemBarra[];
    restantes: number;
    cuotaCarta: number | null;
    visitasReservas: number | null;
    idiomas: ItemBarra[] | null;
  } | null;
  procedencias: {
    titular: string;
    items: ItemBarra[];
    principal: ItemBarra & { grupo: GrupoProcedencia };
    explicaciones: { nombre: string; texto: string }[];
  } | null;
  audiencia: {
    titular: string;
    dispositivos: ParteDispositivo[] | null;
    principal: ParteDispositivo | null;
    paises: ItemBarra[] | null;
    pctEspana: number | null;
  } | null;
  diasSemana: {
    titular: string;
    items: DiaSemanaInforme[];
    mejor: DiaSemanaInforme;
    mediaFinde: number | null;
    mediaEntreSemana: number | null;
  } | null;
  conclusiones: string[];
  notas: string[];
}

export interface OpcionesInforme {
  proyecto: FiltroProyecto;
  /** yyyy-MM */
  mes: string;
  /** yyyy-MM-dd (hoy, calendario local) */
  hoy: string;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
const pctDe = (parte: number, total: number): number => (total > 0 ? (100 * parte) / total : 0);

const variacionPct = (actual: number | null, anterior: number | null): number | null =>
  actual === null || anterior === null || anterior <= 0 ? null : (100 * (actual - anterior)) / anterior;

/** «Tráfico de la web de Casa Tomás» → «Trafico-de-la-web-de-Casa-Tomas». */
const aNombreArchivo = (t: string): string =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** «el 5 de octubre» / «del 27 al 31 de octubre», agrupando días seguidos. */
export function describirDias(fechas: string[]): string {
  const ordenadas = [...fechas].sort();
  const tramos: string[][] = [];
  for (const f of ordenadas) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && differenceInCalendarDays(parseISO(f), parseISO(ultimo[ultimo.length - 1])) === 1) ultimo.push(f);
    else tramos.push([f]);
  }
  return unirLista(
    tramos.map((t) => {
      const ini = parseISO(t[0]);
      const fin = parseISO(t[t.length - 1]);
      const mesFin = fmtMes(t[t.length - 1]);
      if (t.length === 1) return `el ${ini.getDate()} de ${mesFin}`;
      const mesIni = fmtMes(t[0]);
      return mesIni === mesFin
        ? `del ${ini.getDate()} al ${fin.getDate()} de ${mesFin}`
        : `del ${ini.getDate()} de ${mesIni} al ${fin.getDate()} de ${mesFin}`;
    }),
  );
}

/** Ordena por visitas, deja `max` y suma el resto en `otros`. Recalcula el % sobre el total de la lista. */
function aBarras<T extends { nombre: string; visitas: number }>(
  filas: T[],
  max: number,
  otros: (visitas: number) => T,
): (T & { pct: number; destacado: boolean })[] {
  const total = filas.reduce((s, f) => s + f.visitas, 0);
  const ordenadas = filas.filter((f) => f.visitas > 0).sort((a, b) => b.visitas - a.visitas || a.nombre.localeCompare(b.nombre, "es"));
  const lista = ordenadas.slice(0, max).map((f, i) => ({ ...f, pct: pctDe(f.visitas, total), destacado: i === 0 }));
  const resto = ordenadas.slice(max).reduce((s, f) => s + f.visitas, 0);
  if (resto > 0) lista.push({ ...otros(resto), pct: pctDe(resto, total), destacado: false });
  return lista;
}

/** Suma filas con el mismo nombre (p. ej. «l.instagram.com» e «instagram.com»). */
function agrupar<T>(filas: { clave: string; visitas: number; dato: T }[]): { nombre: string; visitas: number; dato: T }[] {
  const m = new Map<string, { nombre: string; visitas: number; dato: T }>();
  for (const f of filas) {
    if (f.visitas <= 0) continue;
    const previo = m.get(f.clave);
    if (previo) previo.visitas += f.visitas;
    else m.set(f.clave, { nombre: f.clave, visitas: f.visitas, dato: f.dato });
  }
  return [...m.values()];
}

// ─── Construcción ────────────────────────────────────────────────────────────
export function construirInforme(datos: DatosInformeTrafico, op: OpcionesInforme): InformeTrafico | InformeVacio {
  const r = rangoInforme(op.mes, op.hoy);
  const web = nombreWeb(op.proyecto);
  const nombreMes = fmtMes(r.desde);
  const nombreMesAnio = fmtMesAnio(r.desde);
  const Mes = mayusculaInicial(nombreMes);
  const nombreMesAnt = fmtMes(r.desdeAnterior);
  const titulo = `Tráfico de ${web}: ${nombreMesAnio}`;

  // Días anteriores a la primera visita registrada = aún no se medía (NULL, no 0).
  const inicio = datos.primerDiaConVisitas;
  const serie: FilaSerie[] = datos.serie.map((f) =>
    inicio === null || f.fecha < inicio ? { ...f, visitas: null, visitantes: null, es_anomalia: null } : f,
  );
  const filasMes = serie.filter((f) => f.fecha >= r.desde && f.fecha <= r.hasta);
  const filasAnt = serie.filter((f) => f.fecha >= r.desdeAnterior && f.fecha <= r.hastaAnterior);
  const act = resumirSerie(filasMes);
  const ant = resumirSerie(filasAnt);

  if (r.diasCerrados === 0) {
    return { vacio: true, titulo, motivo: `${Mes} acaba de empezar: todavía no hay ningún día completo.` };
  }
  if (act.diasConDato === 0 || !act.total) {
    const motivo =
      inicio === null || inicio > r.hasta
        ? `En ${nombreMesAnio} todavía no se medían las visitas de ${web}.`
        : `No hay visitas registradas de ${web} en ${nombreMesAnio}.`;
    return { vacio: true, titulo, motivo };
  }

  // ── Comparación con el mes anterior ──
  const completoAct = !r.enCurso && act.diasConDato === r.diasMes;
  const completoAnt = ant.diasConDato === r.diasMesAnterior;
  const comparable =
    act.diasConDato >= 7 && act.diasConDato >= r.diasCerrados / 2 && ant.diasConDato >= r.diasMesAnterior / 2;
  const base: Variacion["base"] = completoAct && completoAnt ? "total" : "media";
  const porDia = (total: number | null, dias: number) => (total === null || dias === 0 ? null : total / dias);
  /** Cifra del mes con su variación; `actual`/`anterior` son lo que se compara (total o media por día). */
  const cifra = (valor: number | null, actual: number | null, anterior: number | null, b: Variacion["base"] = base): Cifra => {
    const v = comparable ? variacionPct(actual, anterior) : null;
    return { valor, variacion: v === null ? null : { valor: v, base: b }, anterior: v === null ? null : anterior };
  };

  const paginasVistas =
    base === "total" ? cifra(act.total, act.total, ant.total) : cifra(act.total, act.media, ant.media);
  const visitantes =
    base === "total"
      ? cifra(act.visitantes, act.visitantes, ant.visitantes)
      : cifra(act.visitantes, porDia(act.visitantes, act.diasConDato), porDia(ant.visitantes, ant.diasConDato));
  const mediaDiaria = cifra(act.media, act.media, ant.media, "media");
  const paginasPorVisitante = act.total !== null && act.visitantes ? act.total / act.visitantes : null;

  let comparacion: string;
  if (comparable) comparacion = `frente a ${nombreMesAnt}`;
  else if (ant.diasConDato === 0) comparacion = `sin datos de ${nombreMesAnt} para comparar`;
  else if (ant.diasConDato < r.diasMesAnterior / 2)
    comparacion = `${nombreMesAnt} solo tiene ${ant.diasConDato} ${ant.diasConDato === 1 ? "día medido" : "días medidos"}: aún no se puede comparar`;
  else comparacion = `pocos días todavía para comparar con ${nombreMesAnt}`;

  // ── Resumen ──
  const verbo = r.enCurso ? "lleva" : "cierra con";
  const total = act.total;
  let titularResumen: string;
  const vp = paginasVistas.variacion;
  if (vp) {
    const masMenos = vp.valor > 0 ? "más" : "menos";
    const cabeza =
      vp.base === "total"
        ? `${Mes} ${verbo} ${fmtEntero(total)} páginas vistas`
        : `${Mes}: ${fmtMedia(act.media ?? 0)} páginas vistas al día`;
    titularResumen =
      Math.abs(vp.valor) < UMBRAL_ESTABLE_PCT
        ? `${cabeza}, en la línea de ${nombreMesAnt}`
        : `${cabeza}, un ${fmtVariacionAbs(vp.valor)} ${masMenos} que ${vp.base === "total" ? nombreMesAnt : `en ${nombreMesAnt}`}`;
  } else {
    titularResumen = `${Mes} ${verbo} ${fmtEntero(total)} páginas vistas${act.visitantes ? ` de ${fmtEntero(act.visitantes)} visitantes` : ""}`;
  }

  // ── Evolución diaria ──
  const porFechaAct = new Map(filasMes.map((f) => [f.fecha, f.visitas]));
  const porFechaAnt = new Map(filasAnt.map((f) => [f.fecha, f.visitas]));
  const puntos: PuntoEvolucion[] = [];
  for (let dia = 1; dia <= r.diasMes; dia++) {
    const fecha = format(addDays(parseISO(r.desde), dia - 1), ISO);
    const fechaAnt = dia <= r.diasMesAnterior ? format(addDays(parseISO(r.desdeAnterior), dia - 1), ISO) : null;
    puntos.push({
      dia,
      fecha,
      actual: porFechaAct.get(fecha) ?? null,
      anterior: fechaAnt ? (porFechaAnt.get(fechaAnt) ?? null) : null,
    });
  }
  let mejor: { fecha: string; visitas: number } | null = null;
  for (const f of filasMes) {
    if (f.visitas !== null && (mejor === null || f.visitas > mejor.visitas)) mejor = { fecha: f.fecha, visitas: f.visitas };
  }
  const mejorDia = mejor
    ? { ...mejor, dia: parseISO(mejor.fecha).getDate(), texto: fmtDiaLargo(mejor.fecha) }
    : null;
  const titularEvolucion = mejorDia
    ? `El día con más movimiento fue el ${mejorDia.texto}, con ${fmtEntero(mejorDia.visitas)} ${mejorDia.visitas === 1 ? "página vista" : "páginas vistas"}`
    : `Así se movió la web día a día en ${nombreMes}`;

  const limiteAnomalias = inicio ? format(addDays(parseISO(inicio), DIAS_HISTORIA_ANOMALIAS), ISO) : null;
  const anomalias = filasMes.filter(
    (f) => f.es_anomalia === true && f.z_dow !== null && (limiteAnomalias === null || f.fecha >= limiteAnomalias),
  );
  const altas = anomalias.filter((f) => (f.z_dow ?? 0) > 0).map((f) => fmtDiaCorto(f.fecha));
  const bajas = anomalias.filter((f) => (f.z_dow ?? 0) < 0).map((f) => fmtDiaCorto(f.fecha));
  const huecos: { desde: number; hasta: number }[] = [];
  for (const p of puntos) {
    const sinDato = p.actual === null && p.fecha <= r.hasta && (inicio === null || p.fecha >= inicio);
    if (!sinDato) continue;
    const ultimo = huecos[huecos.length - 1];
    if (ultimo && ultimo.hasta === p.dia - 1) ultimo.hasta = p.dia;
    else huecos.push({ desde: p.dia, hasta: p.dia });
  }
  const frasesAnomalias: string[] = [];
  if (altas.length) frasesAnomalias.push(`Picos fuera de lo normal para ese día de la semana: ${unirLista(altas)}.`);
  if (bajas.length) frasesAnomalias.push(`Días más flojos de lo normal: ${unirLista(bajas)}.`);

  // ── Páginas ──
  const conWeb = op.proyecto === "ambos";
  const paginasAgrupadas = agrupar(
    datos.paginas.map((p) => ({ clave: nombrePagina(p.ruta, p.proyecto, conWeb), visitas: p.visitas, dato: null })),
  );
  const totalRutas = paginasAgrupadas.reduce((s, p) => s + p.visitas, 0);
  const totalPaginas = Math.max(total ?? 0, totalRutas);
  let paginas: InformeTrafico["paginas"] = null;
  if (paginasAgrupadas.length > 0) {
    const ordenadas = [...paginasAgrupadas].sort((a, b) => b.visitas - a.visitas || a.nombre.localeCompare(b.nombre, "es"));
    const items: ItemBarra[] = ordenadas.slice(0, MAX_PAGINAS).map((p, i) => ({
      nombre: p.nombre,
      visitas: p.visitas,
      pct: pctDe(p.visitas, totalPaginas),
      destacado: i === 0,
    }));
    const visitasCarta = datos.paginas.filter((p) => esRutaCarta(p.ruta)).reduce((s, p) => s + p.visitas, 0);
    const visitasReservas = datos.paginas
      .filter((p) => p.proyecto !== "touza-restaurant-website" && esRutaReservas(p.ruta))
      .reduce((s, p) => s + p.visitas, 0);
    const cuotaCarta = visitasCarta > 0 ? pctDe(visitasCarta, totalPaginas) : null;

    const porIdioma = new Map<Idioma, number>();
    for (const p of datos.paginas) {
      const { idioma } = idiomaDeRuta(p.ruta);
      porIdioma.set(idioma, (porIdioma.get(idioma) ?? 0) + p.visitas);
    }
    const hayOtrosIdiomas = [...porIdioma.entries()].some(([idioma, v]) => idioma !== "es" && v > 0);
    const idiomas = hayOtrosIdiomas
      ? aBarras(
          [...porIdioma.entries()].map(([idioma, visitas]) => ({ nombre: NOMBRE_IDIOMA[idioma], visitas })),
          3,
          (visitas) => ({ nombre: "Otros", visitas }),
        )
      : null;

    const titularPaginas =
      cuotaCarta !== null && cuotaCarta >= 35
        ? `La carta reúne el ${fmtCuota(cuotaCarta)} de todo lo que se mira en la web`
        : items.length >= 2
          ? `Lo más visto: ${items[0].nombre} y ${items[1].nombre}`
          : `Lo más visto: ${items[0].nombre}`;
    paginas = {
      titular: titularPaginas,
      items,
      restantes: Math.max(0, ordenadas.length - MAX_PAGINAS),
      cuotaCarta,
      visitasReservas: visitasReservas > 0 ? visitasReservas : null,
      idiomas,
    };
  }

  // ── Procedencias ──
  const procedenciasAgrupadas = agrupar(
    datos.procedencias.map((d) => {
      const p = nombreProcedencia(d.valor);
      return { clave: p.nombre, visitas: d.visitas, dato: p };
    }),
  );
  let procedencias: InformeTrafico["procedencias"] = null;
  const pctGrupo = (g: GrupoProcedencia): number => {
    const t = procedenciasAgrupadas.reduce((s, p) => s + p.visitas, 0);
    return pctDe(procedenciasAgrupadas.filter((p) => p.dato.grupo === g).reduce((s, p) => s + p.visitas, 0), t);
  };
  if (procedenciasAgrupadas.length > 0) {
    const barras = aBarras(
      procedenciasAgrupadas.map((p) => ({ nombre: p.nombre, visitas: p.visitas, explicacion: p.dato.explicacion, grupo: p.dato.grupo })),
      MAX_PROCEDENCIAS,
      (visitas) => ({ nombre: "Otras webs", visitas, explicacion: undefined, grupo: "web" as GrupoProcedencia }),
    );
    const principal = barras[0];
    const pct = fmtCuota(principal.pct);
    const titularProcedencias =
      principal.grupo === "directo"
        ? `El ${pct} llega directamente, sin pasar por buscadores ni redes`
        : principal.grupo === "buscador" || principal.grupo === "redes"
          ? `${principal.nombre} trae el ${pct} de las visitas`
          : `${principal.nombre} es la primera vía de entrada (${pct})`;
    procedencias = {
      titular: titularProcedencias,
      items: barras,
      principal,
      explicaciones: barras.filter((b) => b.explicacion).map((b) => ({ nombre: b.nombre, texto: b.explicacion as string })),
    };
  }

  // ── Audiencia: dispositivo y país ──
  const porDispositivo = new Map<ClaveDispositivo, number>();
  for (const d of datos.dispositivos) {
    const clave = claveDispositivo(d.valor);
    if (clave && d.visitas > 0) porDispositivo.set(clave, (porDispositivo.get(clave) ?? 0) + d.visitas);
  }
  const totalDispositivos = [...porDispositivo.values()].reduce((s, v) => s + v, 0);
  const dispositivos: ParteDispositivo[] | null =
    totalDispositivos > 0
      ? ORDEN_DISPOSITIVOS.filter((c) => (porDispositivo.get(c) ?? 0) > 0).map((c) => ({
          clave: c,
          nombre: NOMBRE_DISPOSITIVO[c],
          visitas: porDispositivo.get(c) ?? 0,
          pct: pctDe(porDispositivo.get(c) ?? 0, totalDispositivos),
        }))
      : null;
  const principalDispositivo = dispositivos ? [...dispositivos].sort((a, b) => b.visitas - a.visitas)[0] : null;

  const paisesAgrupados = agrupar(datos.paises.map((d) => ({ clave: nombrePais(d.valor), visitas: d.visitas, dato: d.valor.toUpperCase() })));
  const totalPaises = paisesAgrupados.reduce((s, p) => s + p.visitas, 0);
  const paises = paisesAgrupados.length ? aBarras(
        paisesAgrupados.map((p) => ({ nombre: p.nombre, visitas: p.visitas })),
        MAX_PAISES,
        (visitas) => ({ nombre: "Otros países", visitas }),
      ) : null;
  const visitasEspana = paisesAgrupados.filter((p) => p.dato === "ES").reduce((s, p) => s + p.visitas, 0);
  const pctEspana = totalPaises > 0 ? pctDe(visitasEspana, totalPaises) : null;

  let audiencia: InformeTrafico["audiencia"] = null;
  if (principalDispositivo || paises) {
    let titularAudiencia: string;
    if (principalDispositivo) {
      titularAudiencia = `El ${fmtCuota(principalDispositivo.pct)} entra desde ${principalDispositivo.clave === "tablet" ? "la tablet" : `el ${principalDispositivo.nombre.toLowerCase()}`}`;
      if (pctEspana !== null && pctEspana >= 90) titularAudiencia += ", y casi todo desde España";
      else if (pctEspana !== null && pctEspana > 0) titularAudiencia += `; el ${fmtCuota(pctEspana)}, desde España`;
    } else {
      titularAudiencia = `El ${fmtCuota(pctEspana ?? 0)} de las visitas llega desde España`;
    }
    audiencia = { titular: titularAudiencia, dispositivos, principal: principalDispositivo, paises, pctEspana };
  }

  // ── Días de la semana ──
  let diasSemana: InformeTrafico["diasSemana"] = null;
  if (act.diasConDato >= DIAS_MINIMOS_SEMANA) {
    const suma = Array(7).fill(0) as number[];
    const cuenta = Array(7).fill(0) as number[];
    for (const f of filasMes) {
      if (f.visitas === null) continue;
      const i = getISODay(parseISO(f.fecha)) - 1;
      suma[i] += f.visitas;
      cuenta[i]++;
    }
    const medias = suma.map((s, i) => (cuenta[i] > 0 ? s / cuenta[i] : null));
    let iMejor = 0;
    medias.forEach((m, i) => {
      if (m !== null && (medias[iMejor] === null || m > (medias[iMejor] as number))) iMejor = i;
    });
    const items: DiaSemanaInforme[] = DIAS_SEMANA.map((d, i) => ({
      corto: d.corto,
      singular: d.singular,
      media: medias[i],
      dias: cuenta[i],
      destacado: i === iMejor,
    }));
    const mediaGrupo = (idx: number[]) => {
      const s = idx.reduce((a, i) => a + suma[i], 0);
      const c = idx.reduce((a, i) => a + cuenta[i], 0);
      return c > 0 ? s / c : null;
    };
    diasSemana = {
      titular: `Los ${DIAS_SEMANA[iMejor].plural} son el día de la semana con más visitas`,
      items,
      mejor: items[iMejor],
      mediaFinde: mediaGrupo([5, 6]),
      mediaEntreSemana: mediaGrupo([0, 1, 2, 3, 4]),
    };
  }

  // ── Conclusiones (reglas, en orden de prioridad) ──
  const conclusiones: string[] = [];
  if (vp) {
    const que = vp.base === "total" ? "páginas vistas" : "páginas vistas por día";
    if (vp.valor >= UMBRAL_ESTABLE_PCT) conclusiones.push(`La web gana público: ${fmtVariacion(vp.valor)} de ${que} frente a ${nombreMesAnt}.`);
    else if (vp.valor <= -UMBRAL_ESTABLE_PCT)
      conclusiones.push(`${Mes} ha tenido un ${fmtVariacionAbs(vp.valor)} menos de ${que} que ${nombreMesAnt}: buen momento para darle un empujón a la web en redes.`);
    else conclusiones.push(`Las visitas se mantienen estables respecto a ${nombreMesAnt} (${fmtVariacion(vp.valor)}).`);
  } else if (inicio && inicio >= r.desdeAnterior) {
    conclusiones.push(`${Mes} es el primer mes con datos casi completos: servirá de referencia para comparar los siguientes.`);
  }
  if (principalDispositivo && principalDispositivo.pct >= 50) {
    conclusiones.push(
      principalDispositivo.clave === "desktop"
        ? `El ${fmtCuota(principalDispositivo.pct)} entra desde el ordenador: mucha gente consulta la web con calma, en casa o en el trabajo.`
        : `El ${fmtCuota(principalDispositivo.pct)} entra desde ${principalDispositivo.clave === "tablet" ? "la tablet" : "el móvil"}: lo que más importa es que la web se vea y vaya bien en el teléfono.`,
    );
  }
  if (paginas?.cuotaCarta !== null && paginas?.cuotaCarta !== undefined && paginas.cuotaCarta >= 25) {
    conclusiones.push(`La carta es lo más consultado (${fmtCuota(paginas.cuotaCarta)} de las páginas vistas): tenerla al día es lo que más se nota.`);
  }
  if (procedencias) {
    const directo = pctGrupo("directo");
    const buscadores = pctGrupo("buscador");
    const redes = pctGrupo("redes");
    if (directo >= 50 && buscadores < 10) {
      conclusiones.push(
        `El ${fmtCuota(directo)} llega directamente y ${buscadores > 0 ? `solo el ${fmtCuota(buscadores)}` : "casi nadie"} desde Google u otros buscadores: hay margen para atraer gente nueva (ficha de Google, reseñas).`,
      );
    } else if (directo >= 50) {
      conclusiones.push(`El ${fmtCuota(directo)} llega directamente: la gente ya conoce la web y vuelve a ella.`);
    } else if (procedencias.principal.grupo === "buscador") {
      conclusiones.push(`${procedencias.principal.nombre} es la puerta principal (${fmtCuota(procedencias.principal.pct)}): la ficha de Google y las reseñas son clave.`);
    }
    if (redes >= 20) conclusiones.push(`Las redes sociales traen el ${fmtCuota(redes)} de las visitas: lo que se publica se traduce en visitas a la web.`);
  }
  if (paginas?.visitasReservas) {
    conclusiones.push(
      `La página de reservas se abrió ${fmtEntero(paginas.visitasReservas)} ${paginas.visitasReservas === 1 ? "vez" : "veces"}: es el último paso antes de reservar mesa.`,
    );
  }
  if (diasSemana && diasSemana.mejor.media !== null) {
    conclusiones.push(
      `Los ${DIAS_SEMANA[diasSemana.items.indexOf(diasSemana.mejor)].plural} son el día fuerte (${fmtMedia(diasSemana.mejor.media)} páginas vistas de media).`,
    );
  }
  if (paginasPorVisitante !== null && paginasPorVisitante >= 3) {
    conclusiones.push(`Cada visitante mira unas ${fmtMedia(Math.round(paginasPorVisitante * 10) / 10)} páginas: quien entra, se queda a curiosear.`);
  }
  if (pctEspana !== null && pctEspana <= 90) {
    conclusiones.push(`Un ${fmtCuota(100 - pctEspana)} llega desde fuera de España: las versiones en inglés y francés tienen público.`);
  }

  // ── Notas al pie ──
  const notas: string[] = ["Datos de Vercel Web Analytics, que se copian cada noche al panel."];
  if (inicio && inicio > r.desdeAnterior && inicio <= r.hasta) {
    notas.push(`La web empezó a registrar visitas el ${format(parseISO(inicio), "d")} de ${fmtMes(inicio)}; antes no hay datos.`);
  }
  const fechasSinDato = filasMes.filter((f) => f.visitas === null && (inicio === null || f.fecha >= inicio)).map((f) => f.fecha);
  if (fechasSinDato.length) notas.push(`Sin datos ${describirDias(fechasSinDato)}: esos días no se pudieron copiar.`);
  if (r.enCurso) notas.push(`Mes en curso: datos hasta el ${format(parseISO(r.hasta), "d")} de ${nombreMes}.`);

  const fechaDesde = parseISO(r.desde);
  const fechaHasta = parseISO(r.hasta);
  const periodo = `Del ${fechaDesde.getDate()} al ${fechaHasta.getDate()} de ${nombreMesAnio.replace(" ", " de ")}${r.enCurso ? " (mes en curso)" : ""}${
    comparable ? ` · comparado con ${nombreMesAnt}` : ""
  }`;

  return {
    vacio: false,
    proyecto: op.proyecto,
    web,
    titulo,
    nombreArchivo: `${aNombreArchivo(`Trafico de ${web} ${nombreMesAnio}`)}.pdf`,
    periodo,
    mes: {
      clave: op.mes,
      nombre: nombreMes,
      nombreAnio: nombreMesAnio,
      enCurso: r.enCurso,
      diasConDato: act.diasConDato,
      diasPeriodo: r.diasCerrados,
    },
    mesAnterior: { nombre: nombreMesAnt, diasConDato: ant.diasConDato, diasMes: r.diasMesAnterior },
    resumen: {
      titular: titularResumen,
      paginasVistas,
      visitantes,
      mediaDiaria,
      paginasPorVisitante,
      comparable,
      comparacion,
    },
    evolucion: {
      titular: titularEvolucion,
      puntos,
      mejorDia,
      notaAnomalias: frasesAnomalias.length ? frasesAnomalias.join(" ") : null,
      hayAnterior: comparable && ant.diasConDato > 0,
      huecos,
    },
    paginas,
    procedencias,
    audiencia,
    diasSemana,
    conclusiones: conclusiones.slice(0, MAX_CONCLUSIONES),
    notas,
  };
}
