// ============================================================================
//  Informe mensual de auditoría — el MODELO (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  18/11/2026, petición del dueño: «que se informe por lo que hace cada
//  usuario, no gráfico por días global sino lo que hace cada usuario, cuándo
//  lo hace… varias slides por usuario, y obvia las acciones del servidor para
//  unas slides finales dividiendo qué son cada una y explicándolo con lenguaje
//  entendible natural».
//
//  De los datos de la RPC (../fuentes/auditoria.ts) sale:
//    · `equipo`: una fila por persona (para la diapositiva «El equipo este mes»);
//    · `personas`: por cada una, su ficha (cifras y un resumen en frases),
//      cuándo trabaja (calendario del mes, horas y días de la semana), qué toca
//      (secciones y botones del servidor) y lo último y lo delicado que hizo;
//    · `sistema`: lo automático, proceso a proceso, con qué es y qué hizo.
//  Las diapositivas (src/components/informes/auditoria/Diapositivas.tsx) solo
//  pintan esto; el CSV sale de `tablaCsvAuditoria`.
// ============================================================================
import { getDaysInMonth, parseISO } from "date-fns";
import { fmtCuota, fmtEntero, mayusculaInicial, unirLista } from "@/components/trafico-web/informe/formatoInforme";
import { fraseDelicada, type DatosAuditoria, type UsuarioAuditoria } from "../fuentes/auditoria";
import { textoMes } from "../periodo";
import { nombreArchivoInforme, type InformeTabla } from "../tabla";
import { CARGAS_PUNTUALES, claveProceso, dondeTabla, esCargaPuntual, fraseAccion, fraseCuentas, textoBoton, textoProceso } from "./textos";

export const TITULO_AUDITORIA = "Informe mensual de auditoría";

const plural = (n: number, uno: string, varios: string) => `${fmtEntero(n)} ${n === 1 ? uno : varios}`;

// ─── Fechas en hora de Madrid ───────────────────────────────────────────────

const formatoLargo = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** «sáb 14 nov, 18:30» (hora de Madrid). */
export function cuandoLargo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = Object.fromEntries(formatoLargo.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const limpio = (t: string) => t.replace(".", "").toLowerCase();
  return `${limpio(p.weekday)} ${p.day} ${limpio(p.month)}, ${p.hour.padStart(2, "0")}:${p.minute}`;
}

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DIAS_PLURAL = ["los lunes", "los martes", "los miércoles", "los jueves", "los viernes", "los sábados", "los domingos"];
/** 0 = lunes. */
const diaSemana = (dia: string): number => (parseISO(dia).getDay() + 6) % 7;

// ─── Nombres ────────────────────────────────────────────────────────────────

/** «antxon@staff.local» → «Antxon» (las cuentas del personal); los demás correos, tal cual. */
export function nombrePersona(label: string): string {
  const m = label.match(/^([^@\s]+)@staff\.local$/i);
  if (!m) return label;
  return m[1]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => mayusculaInicial(p))
    .join(" ");
}

// ─── Cuándo trabaja ─────────────────────────────────────────────────────────

export interface Franja {
  /** Hora de inicio (0-23) de las 3 horas seguidas con más actividad. */
  desde: number;
  hasta: number;
  /** «por la mañana», «por la tarde», «por la noche», «de madrugada», «a mediodía». */
  momento: string;
  /** «entre las 10:00 y las 13:00». */
  texto: string;
  /** Parte de sus acciones que caen en esas 3 horas (0-100). */
  cuota: number;
}

function momentoDelDia(hora: number): string {
  if (hora < 6) return "de madrugada";
  if (hora < 13) return "por la mañana";
  if (hora < 16) return "a mediodía";
  if (hora < 21) return "por la tarde";
  return "por la noche";
}

/** Las 3 horas seguidas con más acciones (null si casi no hay actividad). */
export function franjaHabitual(horas: number[]): Franja | null {
  const total = horas.reduce((s, n) => s + n, 0);
  if (total < 3) return null;
  let mejor = 0;
  let suma = -1;
  for (let h = 0; h <= 21; h++) {
    const s = horas[h] + horas[h + 1] + horas[h + 2];
    if (s > suma) {
      suma = s;
      mejor = h;
    }
  }
  const hasta = mejor + 3;
  const texto = `entre las ${mejor}:00 y las ${hasta === 24 ? "24:00" : `${hasta}:00`}`;
  return { desde: mejor, hasta, momento: momentoDelDia(mejor + 1), texto, cuota: (suma / total) * 100 };
}

// ─── Tipos del informe ──────────────────────────────────────────────────────

export interface DiaCalendario {
  dia: string;
  numero: number;
  /** Acciones de ese día. */
  n: number;
  /** Entró ese día (aunque no hiciera nada). */
  entro: boolean;
  /** Fila (semana) y columna (0 = lunes) en el calendario del mes. */
  fila: number;
  columna: number;
  /** Día que aún no ha llegado (mes en curso). */
  futuro: boolean;
}

export interface SeccionPersona {
  nombre: string;
  crear: number;
  cambiar: number;
  borrar: number;
  total: number;
}

export interface LineaTiempo {
  cuando: string;
  frase: string;
}

/** Lo delicado, con las acciones iguales juntas («Borró un archivo», 94 veces, la última el sáb 14 nov). */
export interface LineaDelicada extends LineaTiempo {
  veces: number;
}

export interface PersonaAuditoria {
  /** El actor de la auditoría (correo): clave única. */
  clave: string;
  nombre: string;
  /** Correo o etiqueta completa (si `nombre` es más corto). */
  etiqueta: string | null;
  acciones: number;
  dias: number;
  /** Veces que abrió el panel (null si la base de datos aún no lo da). */
  entradas: number | null;
  primera: string;
  ultima: string;
  cuentas: { crear: number; cambiar: number; borrar: number; servidor: number };
  calendario: DiaCalendario[];
  /** Acciones por hora (24 valores, hora de Madrid). */
  horas: number[];
  /** Acciones por día de la semana (7 valores, 0 = lunes). */
  semana: { dia: string; n: number }[];
  franja: Franja | null;
  /** «los martes» si un día de la semana destaca. */
  diaFuerte: string | null;
  mejorDia: { dia: string; n: number } | null;
  secciones: SeccionPersona[];
  /** Secciones que no caben en la tabla. */
  seccionesResto: { cuantas: number; total: number };
  servidor: { nombre: string; n: number; fallidas: number }[];
  recientes: LineaTiempo[];
  /** Agrupadas por frase, de la más reciente a la más antigua. */
  delicadas: LineaDelicada[];
  /** Cuántas acciones delicadas hizo (sin agrupar). */
  totalDelicadas: number;
  /** Frases de «En pocas palabras». */
  resumen: string[];
  titulares: { ficha: string; cuando: string; que: string; ultimo: string };
  /**
   * Qué diapositivas lleva: con 10 acciones o más, las cuatro; con menos, solo la ficha (que entonces enseña
   * también lo que hizo) y, si tocó algo delicado, lo último y lo delicado.
   */
  diapositivas: ("ficha" | "cuando" | "que" | "ultimo")[];
}

export interface FilaEquipo {
  nombre: string;
  acciones: number;
  dias: number;
  cuando: string;
  donde: string;
  delicadas: number;
}

export interface ProcesoSistema {
  clave: string;
  nombre: string;
  explicacion: string;
  /** «Creó 183 líneas de factura y 58 facturas. Cambió 279 reservas.» */
  detalle: string;
  n: number;
}

export interface InformeAuditoria {
  vacio: false;
  titulo: string;
  mes: string;
  /** «noviembre de 2026». */
  nombreMes: string;
  /** «Noviembre de 2026 (hasta el día 18)». */
  textoPeriodo: string;
  enCurso: boolean;
  /** Días del mes (o hasta hoy, si va en curso). */
  diasPeriodo: number;
  nombreArchivo: string;
  resumen: { personas: number; acciones: number; delicadas: number; fallidos: number; sistema: number; descripcion: string; titular: string };
  equipo: FilaEquipo[];
  personas: PersonaAuditoria[];
  sistema: { total: number; titular: string; procesos: ProcesoSistema[]; nota: string | null };
}

export interface InformeAuditoriaVacio {
  vacio: true;
  motivo: string;
}

export type ResultadoInformeAuditoria = InformeAuditoria | InformeAuditoriaVacio;

/** Diapositivas de cada tipo, para no cortar listas en la pantalla. */
export const MAX_SECCIONES = 8;
export const MAX_BOTONES = 6;
export const MAX_RECIENTES = 8;
export const MAX_DELICADAS_PERSONA = 6;
/** Por debajo, la persona lleva una sola diapositiva (la ficha, con lo que hizo). */
export const POCAS_ACCIONES = 10;

// ─── Persona ────────────────────────────────────────────────────────────────

function calendarioMes(mes: string, porDia: Map<string, number>, hoy: string): DiaCalendario[] {
  const inicio = parseISO(`${mes}-01`);
  const n = getDaysInMonth(inicio);
  const primeraColumna = diaSemana(`${mes}-01`);
  return Array.from({ length: n }, (_, i) => {
    const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
    const posicion = primeraColumna + i;
    return { dia, numero: i + 1, n: porDia.get(dia) ?? 0, entro: porDia.has(dia), fila: Math.floor(posicion / 7), columna: posicion % 7, futuro: dia > hoy };
  });
}

function persona(u: UsuarioAuditoria, d: DatosAuditoria, mes: string, hoy: string, diasPeriodo: number): PersonaAuditoria {
  const nombre = nombrePersona(u.quien);
  const porDia = new Map((u.por_dia ?? []).map((x) => [x.dia, x.n]));
  const calendario = calendarioMes(mes, porDia, hoy);
  const horas = Array.from({ length: 24 }, (_, h) => (u.por_hora ?? []).find((x) => x.hora === h)?.n ?? 0);
  const semanaN = [0, 0, 0, 0, 0, 0, 0];
  for (const x of u.por_dia ?? []) semanaN[diaSemana(x.dia)] += x.n;
  const semana = semanaN.map((n, i) => ({ dia: DIAS_SEMANA[i], n }));
  const totalSemana = semanaN.reduce((s, n) => s + n, 0);
  const iFuerte = semanaN.indexOf(Math.max(...semanaN));
  const diaFuerte = totalSemana >= 5 && semanaN[iFuerte] / totalSemana >= 0.25 ? DIAS_PLURAL[iFuerte] : null;
  const mejor = (u.por_dia ?? []).reduce<{ dia: string; n: number } | null>((m, x) => (x.n > 0 && (!m || x.n > m.n) ? { dia: x.dia, n: x.n } : m), null);
  const franja = franjaHabitual(horas);

  // Secciones: todo lo que tocó (migración 20261212100000) o, si no, sus 3 principales.
  const todas: SeccionPersona[] = u.tablas
    ? u.tablas.map((t) => ({ nombre: dondeTabla(t.tabla), crear: t.crear, cambiar: t.actualizar, borrar: t.eliminar, total: t.n }))
    : u.secciones.map((s) => ({ nombre: dondeTabla(s.tabla), crear: 0, cambiar: 0, borrar: 0, total: s.n }));
  const secciones = todas.slice(0, MAX_SECCIONES);
  const resto = todas.slice(MAX_SECCIONES);
  const servidor = (u.servidor ?? []).map((s) => ({ nombre: textoBoton(s.op), n: s.n, fallidas: s.fallidas }));
  const cuentas = {
    crear: todas.reduce((s, t) => s + t.crear, 0),
    cambiar: todas.reduce((s, t) => s + t.cambiar, 0),
    borrar: todas.reduce((s, t) => s + t.borrar, 0),
    servidor: servidor.reduce((s, t) => s + t.n, 0),
  };
  const recientes = (u.recientes ?? []).slice(0, MAX_RECIENTES).map((r) => ({ cuando: cuandoLargo(r.created_at), frase: fraseAccion(r) }));
  const suyas = d.delicadas.filter((x) => x.actor_label === u.quien);
  const delicadas: LineaDelicada[] = [];
  for (const x of suyas) {
    const frase = fraseDelicada(x);
    const igual = delicadas.find((l) => l.frase === frase);
    if (igual) igual.veces++;
    else delicadas.push({ cuando: cuandoLargo(x.created_at), frase, veces: 1 });
  }

  // ── Frases ──
  const dias = plural(u.dias, "día", "días");
  const top = todas[0];
  const cuotaTop = top && u.acciones > 0 ? (top.total / u.acciones) * 100 : 0;
  const resumen: string[] = [];
  resumen.push(
    `Entró ${u.dias} de los ${diasPeriodo} días del mes` +
      (u.entradas != null ? ` y abrió el panel ${plural(u.entradas, "vez", "veces")}.` : "."),
  );
  if (franja) {
    resumen.push(
      franja.cuota >= 35
        ? `Suele trabajar ${franja.momento}, ${franja.texto}${diaFuerte ? `, y sobre todo ${diaFuerte}` : ""}.`
        : `Reparte su trabajo a lo largo del día${diaFuerte ? `; el día que más, ${diaFuerte}` : ""}.`,
    );
  }
  if (top) {
    resumen.push(
      cuotaTop >= 50
        ? `${cuotaTop >= 80 ? "Casi todo" : "La mayor parte de"} lo que hace es en «${top.nombre}» (${fmtCuota(cuotaTop)} de sus acciones).`
        : `Donde más trabaja: ${unirLista(todas.slice(0, 3).map((t) => `«${t.nombre}»`))}.`,
    );
  }
  const partes = [
    cuentas.crear && `creó ${plural(cuentas.crear, "cosa", "cosas")}`,
    cuentas.cambiar && `cambió ${fmtEntero(cuentas.cambiar)}`,
    cuentas.borrar && `borró ${fmtEntero(cuentas.borrar)}`,
  ].filter(Boolean) as string[];
  if (partes.length) resumen.push(`${mayusculaInicial(unirLista(partes))}${cuentas.servidor ? ` y pidió ${plural(cuentas.servidor, "tarea", "tareas")} al servidor` : ""}.`);
  else if (cuentas.servidor) resumen.push(`Pidió ${plural(cuentas.servidor, "tarea", "tareas")} al servidor.`);
  resumen.push(suyas.length ? `Hizo ${plural(suyas.length, "cosa delicada", "cosas delicadas")} (borrados, precios o permisos): están en su última diapositiva.` : "No hizo nada delicado (borrar, cambiar precios o permisos).");

  const masServidor = cuentas.servidor > cuentas.crear + cuentas.cambiar + cuentas.borrar && servidor[0];
  const titulares = {
    ficha:
      u.acciones === 0
        ? `${nombre} entró ${dias} pero no cambió nada`
        : `${nombre} hizo ${plural(u.acciones, "cosa", "cosas")} en ${dias}${top && cuotaTop >= 50 ? `, sobre todo en ${top.nombre}` : ""}`,
    cuando: franja && franja.cuota >= 35 ? `${nombre} trabaja sobre todo ${franja.momento}${diaFuerte ? ` y ${diaFuerte}` : ""}` : `Cuándo trabaja ${nombre}`,
    que: masServidor ? `${nombre} sobre todo pide cosas al servidor: ${servidor[0].nombre.toLowerCase()}` : top ? `Lo que más toca ${nombre}: ${top.nombre}` : `Qué hace ${nombre}`,
    ultimo: suyas.length ? `${nombre}: ${plural(suyas.length, "cosa delicada", "cosas delicadas")} que conviene mirar` : `Lo último que hizo ${nombre}`,
  };

  const diapositivas: PersonaAuditoria["diapositivas"] =
    u.acciones >= POCAS_ACCIONES ? ["ficha", "cuando", "que", "ultimo"] : suyas.length ? ["ficha", "ultimo"] : ["ficha"];

  return {
    clave: u.quien,
    nombre,
    etiqueta: nombre !== u.quien ? u.quien : null,
    acciones: u.acciones,
    dias: u.dias,
    entradas: u.entradas ?? null,
    primera: cuandoLargo(u.primera),
    ultima: cuandoLargo(u.ultima),
    cuentas,
    calendario,
    horas,
    semana,
    franja,
    diaFuerte,
    mejorDia: mejor,
    secciones,
    seccionesResto: { cuantas: resto.length, total: resto.reduce((s, t) => s + t.total, 0) },
    servidor,
    recientes,
    delicadas,
    totalDelicadas: suyas.length,
    resumen,
    titulares,
    diapositivas,
  };
}

// ─── El informe ─────────────────────────────────────────────────────────────

/** Momento del día en una palabra para la tabla del equipo: «Mañanas», «Tardes»… */
function cuandoCorto(f: Franja | null): string {
  if (!f) return "—";
  if (f.cuota < 35) return "Todo el día";
  return { "por la mañana": "Mañanas", "a mediodía": "Mediodías", "por la tarde": "Tardes", "por la noche": "Noches", "de madrugada": "Madrugadas" }[f.momento] ?? "—";
}

export function modeloInformeAuditoria(d: DatosAuditoria, mes: string, hoy: string): ResultadoInformeAuditoria {
  const conActividad = d.usuarios.filter((u) => u.acciones > 0 || u.dias > 0);
  if (conActividad.length === 0 && d.sistema_total === 0 && d.delicadas_total === 0) {
    return { vacio: true, motivo: `No hay nada en el registro de ${textoMes(mes)}.` };
  }
  const enCurso = hoy.slice(0, 7) === mes;
  const diasPeriodo = enCurso ? Number(hoy.slice(8, 10)) : getDaysInMonth(parseISO(`${mes}-01`));
  const nombreMes = textoMes(mes);
  const personas = conActividad.map((u) => persona(u, d, mes, hoy, diasPeriodo));
  const acciones = personas.reduce((s, p) => s + p.acciones, 0);

  const equipo: FilaEquipo[] = personas.map((p) => ({
    nombre: p.nombre,
    acciones: p.acciones,
    dias: p.dias,
    cuando: cuandoCorto(p.franja),
    donde: p.secciones[0]?.nombre ?? (p.servidor[0] ? "Botones del servidor" : "—"),
    delicadas: p.totalDelicadas,
  }));

  // Lo automático, proceso a proceso.
  // Las cargas puntuales (scripts que se lanzan una vez) van todas juntas en una tarjeta.
  const porProceso = new Map<string, { tabla: string | null; accion: string; n: number }[]>();
  const cargas = new Map<string, number>();
  for (const s of d.sistema) {
    const clave = claveProceso(s.actor_label);
    if (esCargaPuntual(clave)) cargas.set(clave, (cargas.get(clave) ?? 0) + s.n);
    porProceso.set(clave, [...(porProceso.get(clave) ?? []), { tabla: s.tabla, accion: s.accion, n: s.n }]);
  }
  const procesos: ProcesoSistema[] = [...porProceso.entries()]
    .filter(([clave]) => !cargas.has(clave))
    .map(([clave, filas]) => ({ clave, ...textoProceso(clave), detalle: fraseCuentas(filas, 2), n: filas.reduce((s, f) => s + f.n, 0) }));
  if (cargas.size) {
    const lista = [...cargas.entries()].sort((a, b) => b[1] - a[1]);
    const nombres = lista.slice(0, 4).map(([c, n]) => `«${c}» (${fmtEntero(n)})`);
    if (lista.length > 4) nombres.push(plural(lista.length - 4, "más", "más"));
    procesos.push({ clave: "cargas-puntuales", ...CARGAS_PUNTUALES, detalle: `${unirLista(nombres)}.`, n: lista.reduce((s, [, n]) => s + n, 0) });
  }
  procesos.sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, "es"));
  const contadas = procesos.reduce((s, p) => s + p.n, 0);

  const top = personas[0];
  const titular =
    personas.length === 0
      ? `Nadie usó el panel en ${nombreMes}`
      : personas.length === 1
        ? `Solo ${top.nombre} usó el panel en ${nombreMes}`
        : `${personas.length} personas usaron el panel; ${top.nombre} fue quien más (${plural(top.acciones, "cosa", "cosas")})`;
  const descripcion =
    `Lo que hizo cada persona en el panel en ${nombreMes}: ${plural(personas.length, "persona", "personas")} y ${plural(acciones, "cosa", "cosas")}, ` +
    `cuándo y dónde trabaja y lo delicado que tocó. Al final, lo que el sistema hace solo, explicado.`;

  return {
    vacio: false,
    titulo: TITULO_AUDITORIA,
    mes,
    nombreMes,
    textoPeriodo: `${mayusculaInicial(nombreMes)}${enCurso ? ` (hasta el día ${diasPeriodo})` : ""}`,
    enCurso,
    diasPeriodo,
    nombreArchivo: nombreArchivoInforme(TITULO_AUDITORIA, mes),
    resumen: { personas: personas.length, acciones, delicadas: d.delicadas_total, fallidos: d.accesos_fallidos, sistema: d.sistema_total, descripcion, titular },
    equipo,
    personas,
    sistema: {
      total: d.sistema_total,
      titular: d.sistema_total ? `Además, el sistema hizo ${plural(d.sistema_total, "cosa", "cosas")} solo` : "El sistema no hizo nada solo este mes",
      procesos,
      nota: contadas < d.sistema_total ? `Salen los procesos más activos (${fmtEntero(contadas)} de ${fmtEntero(d.sistema_total)} cosas).` : null,
    },
  };
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/** El informe como tablas para el CSV (mismo formato que el resto de informes: `csvInformeTabla`). */
export function tablaCsvAuditoria(inf: InformeAuditoria, d: DatosAuditoria): InformeTabla {
  const t = (id: string, etiqueta: string, tipo: "texto" | "entero" = "texto") => ({ id, etiqueta, tipo });
  return {
    vacio: false,
    titulo: inf.titulo,
    descripcion: inf.resumen.descripcion,
    textoPeriodo: inf.textoPeriodo,
    nombreArchivo: inf.nombreArchivo,
    tablas: [
      {
        titulo: "Cada persona: resumen",
        columnas: [
          t("persona", "Persona"), t("acciones", "Acciones", "entero"), t("dias", "Días que entró", "entero"), t("entradas", "Veces que abrió el panel", "entero"),
          t("primera", "Primera vez"), t("ultima", "Última vez"), t("cuando", "Suele trabajar"), t("donde", "Donde más trabaja"), t("delicadas", "Cosas delicadas", "entero"),
        ],
        filas: inf.personas.map((p) => ({
          persona: p.etiqueta ?? p.nombre, acciones: p.acciones, dias: p.dias, entradas: p.entradas, primera: p.primera, ultima: p.ultima,
          cuando: p.franja ? `${p.franja.momento} (${p.franja.texto})` : "—", donde: p.secciones[0]?.nombre ?? "—", delicadas: p.delicadas.length,
        })),
      },
      {
        titulo: "Qué hace cada persona",
        columnas: [t("persona", "Persona"), t("seccion", "Sección"), t("crear", "Crea", "entero"), t("cambiar", "Cambia", "entero"), t("borrar", "Borra", "entero"), t("total", "Total", "entero")],
        filas: d.usuarios.flatMap((u) =>
          (u.tablas ?? []).map((x) => ({ persona: u.quien, seccion: dondeTabla(x.tabla), crear: x.crear, cambiar: x.actualizar, borrar: x.eliminar, total: x.n })),
        ),
      },
      {
        titulo: "Lo que cada persona pide al servidor",
        columnas: [t("persona", "Persona"), t("que", "Qué pidió"), t("n", "Veces", "entero"), t("fallidas", "No salieron bien", "entero")],
        filas: d.usuarios.flatMap((u) => (u.servidor ?? []).map((s) => ({ persona: u.quien, que: textoBoton(s.op), n: s.n, fallidas: s.fallidas }))),
      },
      {
        titulo: "Cuándo trabaja cada persona (por días)",
        columnas: [t("persona", "Persona"), t("dia", "Día"), t("n", "Acciones", "entero")],
        filas: d.usuarios.flatMap((u) => (u.por_dia ?? []).map((x) => ({ persona: u.quien, dia: x.dia, n: x.n }))),
      },
      {
        titulo: "Acciones delicadas",
        columnas: [t("cuando", "Cuándo"), t("quien", "Quién"), t("que", "Qué hizo")],
        filas: d.delicadas.map((x) => ({ cuando: cuandoLargo(x.created_at), quien: x.actor_label ?? "—", que: fraseDelicada(x) })),
        nota: d.delicadas_total > d.delicadas.length ? `Salen las ${d.delicadas.length} más recientes de ${d.delicadas_total}.` : null,
      },
      {
        titulo: "Lo que hace el sistema solo",
        columnas: [t("proceso", "Proceso"), t("explicacion", "Qué es"), t("detalle", "Qué hizo"), t("n", "Veces", "entero")],
        filas: inf.sistema.procesos.map((p) => ({ proceso: p.nombre, explicacion: p.explicacion, detalle: p.detalle, n: p.n })),
        total: { proceso: "Total", explicacion: "", detalle: "", n: inf.sistema.total },
        nota: inf.sistema.nota,
      },
    ],
  };
}
