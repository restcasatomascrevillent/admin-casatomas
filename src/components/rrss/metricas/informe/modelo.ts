/**
 * RRSS › Métricas › «Generar informe»: modelo del informe mensual de redes
 * sociales (funciones puras, sin React ni Supabase). Mismo planteamiento que el
 * de tráfico web (src/components/trafico-web/informe/modelo.ts): titulares que
 * cuentan la conclusión, cifras del mes comparadas con el anterior y
 * conclusiones redactadas a partir de los datos.
 *
 * Fuentes (todas reales; nada se rellena ni se inventa):
 *   · Instagram: instagram_metricas_cuenta (un día por fila) e
 *     instagram_metricas_publicacion_ultima (última captura de cada
 *     publicación), que escribe la Edge Function instagram-metricas.
 *   · Visitas a la web desde redes: el desglose por procedencia de Tráfico web
 *     (solo si quien genera el informe tiene permiso de Tráfico web).
 *   · Facebook: no está conectado al panel. El informe lo dice y no enseña
 *     ninguna cifra suya.
 *
 * Comparación con el mes anterior, igual que el informe de tráfico: con los
 * dos meses completos se comparan totales; si falta algún día (o el mes está
 * en curso), la media por día con datos. Con menos de 7 días, o menos de la
 * mitad del mes, no se compara.
 */
import { addDays, format, parseISO } from "date-fns";
import type { Cifra, ItemBarra, PuntoEvolucion, RangoInforme, Variacion } from "@/components/trafico-web/informe/modelo";
import { rangoInforme } from "@/components/trafico-web/informe/modelo";
import {
  fmtCuota,
  fmtDiaCorto,
  fmtDiaLargo,
  fmtEntero,
  fmtMedia,
  fmtMes,
  fmtMesAnio,
  fmtVariacionAbs,
  mayusculaInicial,
} from "@/components/trafico-web/informe/formatoInforme";
import { nombreProcedencia } from "@/components/trafico-web/informe/nombres";

export { mesesSeleccionables, mesPorDefecto, rangoInforme } from "@/components/trafico-web/informe/modelo";

const ISO = "yyyy-MM-dd";
/** Por debajo de este % de cambio se dice «en la línea de». */
export const UMBRAL_ESTABLE_PCT = 5;
export const MAX_MEJORES = 5;
export const MAX_CONCLUSIONES = 5;
/** Publicaciones mínimas de un tipo para comparar su alcance medio con otro. */
export const MINIMO_POR_TIPO = 2;
const MAX_TEXTO_PUBLICACION = 90;

// ─── Datos de entrada ────────────────────────────────────────────────────────
export interface FilaCuentaIg {
  fecha: string;
  ig_user_id: string;
  seguidores: number | null;
  alcance: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
  cuentas_interaccion: number | null;
  visitas_perfil: number | null;
  toques_enlaces: number | null;
}

export interface PublicacionIg {
  media_id: string;
  ig_user_id: string;
  publicado_at: string | null;
  producto: string | null;
  tipo_medio: string | null;
  caption: string | null;
  permalink: string | null;
  alcance: number | null;
  me_gusta: number | null;
  comentarios: number | null;
  guardados: number | null;
  compartidos: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

export interface FilaProcedencia {
  valor: string;
  visitas: number;
  /** % sobre todas las visitas del periodo (lo da la RPC de Tráfico web). */
  pct: number | null;
}

export interface DatosWebDesdeRedes {
  actual: FilaProcedencia[];
  anterior: FilaProcedencia[];
}

export interface DatosInformeRrss {
  cuentas: FilaCuentaIg[];
  publicaciones: PublicacionIg[];
  /** null: sin permiso de Tráfico web (el informe no lleva esa diapositiva). */
  web: DatosWebDesdeRedes | null;
}

export interface OpcionesInformeRrss {
  /** yyyy-MM */
  mes: string;
  /** yyyy-MM-dd */
  hoy: string;
}

// ─── Informe ─────────────────────────────────────────────────────────────────
export interface InformeRrssVacio {
  vacio: true;
  titulo: string;
  motivo: string;
}

export interface MejorPublicacion {
  mediaId: string;
  fecha: string;
  fechaCorta: string;
  tipo: string;
  texto: string;
  alcance: number;
  interacciones: number | null;
  /** Interacciones / alcance, en %. */
  tasa: number | null;
  permalink: string | null;
}

export interface TipoPublicado extends ItemBarra {
  alcanceMedio: number | null;
}

export interface InformeRrss {
  vacio: false;
  titulo: string;
  nombreArchivo: string;
  marca: string;
  mes: { clave: string; nombre: string; nombreAnio: string };
  mesAnterior: { nombre: string };
  enCurso: boolean;
  periodo: string;
  resumen: {
    titular: string;
    alcance: Cifra;
    visualizaciones: Cifra;
    interacciones: Cifra;
    visitasPerfil: Cifra;
    toquesEnlaces: Cifra;
    seguidores: { valor: number | null; cambio: number | null; anterior: number | null };
    /** Interacciones / alcance del mes, en %. */
    tasaInteraccion: number | null;
    comparacion: string;
    diasConDatos: number;
  };
  evolucion: {
    titular: string;
    puntos: PuntoEvolucion[];
    mejorDia: { dia: number; visitas: number; fecha: string; texto: string } | null;
    hayAnterior: boolean;
    huecos: { desde: number; hasta: number }[];
  };
  publicaciones: {
    titular: string;
    total: number;
    totalAnterior: number;
    porTipo: TipoPublicado[];
    mejores: MejorPublicacion[];
    titularMejores: string;
  } | null;
  web: {
    titular: string;
    total: number;
    /** % de todas las visitas a las webs que llega desde redes. */
    cuota: number | null;
    variacion: Variacion | null;
    anterior: number | null;
    redes: ItemBarra[];
  } | null;
  conclusiones: string[];
  notas: string[];
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
const variacionPct = (actual: number | null, anterior: number | null): number | null =>
  actual === null || anterior === null || anterior <= 0 ? null : (100 * (actual - anterior)) / anterior;

const sumar = (valores: (number | null)[]): number | null => {
  const con = valores.filter((v): v is number => v !== null);
  return con.length ? con.reduce((a, b) => a + b, 0) : null;
};

const aNombreArchivo = (t: string): string =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const FORMATO_DIA_MADRID = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });

/** Día de Europe/Madrid (yyyy-MM-dd) de un instante; null si no es una fecha. */
export function diaMadrid(instante: string | null): string | null {
  if (!instante) return null;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return null;
  return FORMATO_DIA_MADRID.format(d);
}

/** Tipo legible de una publicación de Instagram (producto + tipo de medio de Meta). */
export function tipoPublicacion(p: Pick<PublicacionIg, "producto" | "tipo_medio">): string {
  if (p.producto === "REELS") return "Reel";
  if (p.producto === "STORY") return "Historia";
  if (p.producto === "AD") return "Anuncio";
  if (p.tipo_medio === "CAROUSEL_ALBUM") return "Carrusel";
  if (p.tipo_medio === "VIDEO") return "Vídeo";
  return "Foto";
}

const PLURAL_TIPO: Record<string, string> = {
  Reel: "los reels",
  Historia: "las historias",
  Anuncio: "los anuncios",
  Carrusel: "los carruseles",
  Vídeo: "los vídeos",
  Foto: "las fotos",
};

/** Interacciones de una publicación: las de Meta o, si no las da, la suma de me gusta, comentarios, guardados y compartidos. */
export function interaccionesPublicacion(p: PublicacionIg): number | null {
  if (p.interacciones !== null) return p.interacciones;
  return sumar([p.me_gusta, p.comentarios, p.guardados, p.compartidos]);
}

/** Principio del pie de foto en una línea, sin hashtags ni menciones sueltas al final. */
export function textoPublicacion(caption: string | null): string {
  if (!caption) return "Sin texto";
  const limpio = caption
    .replace(/\s+/g, " ")
    .replace(/(\s*[#@][\p{L}\p{N}_.]+)+\s*$/u, "")
    .trim();
  if (!limpio) return "Sin texto";
  if (limpio.length <= MAX_TEXTO_PUBLICACION) return limpio;
  const corte = limpio.slice(0, MAX_TEXTO_PUBLICACION);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > 40 ? corte.slice(0, espacio) : corte).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** Suma las procedencias de Tráfico web que son redes sociales, por red (de más a menos visitas). */
export function resumirRedes(filas: FilaProcedencia[]): { total: number; cuota: number | null; redes: { nombre: string; visitas: number }[] } {
  const porRed = new Map<string, number>();
  let cuota: number | null = null;
  for (const f of filas) {
    const pr = nombreProcedencia(f.valor);
    if (pr.grupo !== "redes") continue;
    porRed.set(pr.nombre, (porRed.get(pr.nombre) ?? 0) + f.visitas);
    if (f.pct !== null) cuota = (cuota ?? 0) + f.pct;
  }
  const redes = [...porRed].map(([nombre, visitas]) => ({ nombre, visitas })).sort((a, b) => b.visitas - a.visitas || a.nombre.localeCompare(b.nombre, "es"));
  return { total: redes.reduce((a, r) => a + r.visitas, 0), cuota, redes };
}

/** La cuenta con más días con datos en el mes (hoy hay una sola para las dos marcas). */
function cuentaPrincipal(filas: FilaCuentaIg[], r: RangoInforme): { id: string | null; total: number } {
  const dias = new Map<string, number>();
  for (const f of filas) {
    if (f.fecha < r.desde || f.fecha > r.hasta || f.alcance === null) continue;
    dias.set(f.ig_user_id, (dias.get(f.ig_user_id) ?? 0) + 1);
  }
  let id: string | null = null;
  let max = -1;
  for (const [k, n] of [...dias].sort(([a], [b]) => a.localeCompare(b))) {
    if (n > max) {
      id = k;
      max = n;
    }
  }
  return { id, total: new Set(filas.map((f) => f.ig_user_id)).size };
}

interface Acumulado {
  diasConDato: number;
  alcance: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
  visitasPerfil: number | null;
  toquesEnlaces: number | null;
}

function acumular(filas: FilaCuentaIg[]): Acumulado {
  const conDato = filas.filter((f) => f.alcance !== null);
  return {
    diasConDato: conDato.length,
    alcance: sumar(conDato.map((f) => f.alcance)),
    visualizaciones: sumar(conDato.map((f) => f.visualizaciones)),
    interacciones: sumar(conDato.map((f) => f.interacciones)),
    visitasPerfil: sumar(conDato.map((f) => f.visitas_perfil)),
    toquesEnlaces: sumar(conDato.map((f) => f.toques_enlaces)),
  };
}

/** Último número de seguidores apuntado en el rango (Meta solo lo da el día que se captura). */
function ultimosSeguidores(filas: FilaCuentaIg[]): number | null {
  for (let i = filas.length - 1; i >= 0; i--) if (filas[i].seguidores !== null) return filas[i].seguidores;
  return null;
}

/** «del 1 al 31 de octubre de 2026» / «del 1 al 8 de noviembre de 2026 (mes en curso)». */
function describirPeriodo(r: RangoInforme): string {
  const ini = parseISO(r.desde);
  const fin = parseISO(r.hasta);
  const anio = format(ini, "yyyy");
  const base = r.diasCerrados === 1 ? `El ${fin.getDate()} de ${fmtMes(r.desde)} de ${anio}` : `Del ${ini.getDate()} al ${fin.getDate()} de ${fmtMes(r.desde)} de ${anio}`;
  return r.enCurso ? `${base} (mes en curso)` : base;
}

// ─── Construcción ────────────────────────────────────────────────────────────
export const MARCA_INFORME = "Casa Tomás";

export function construirInformeRrss(datos: DatosInformeRrss, op: OpcionesInformeRrss): InformeRrss | InformeRrssVacio {
  const r = rangoInforme(op.mes, op.hoy);
  const nombreMes = fmtMes(r.desde);
  const nombreMesAnio = fmtMesAnio(r.desde);
  const Mes = mayusculaInicial(nombreMes);
  const nombreMesAnt = fmtMes(r.desdeAnterior);
  const titulo = `Redes sociales de ${MARCA_INFORME}: ${nombreMesAnio}`;

  if (r.diasCerrados === 0) {
    return { vacio: true, titulo, motivo: `${Mes} acaba de empezar: todavía no hay ningún día completo.` };
  }

  const { id: cuenta, total: numCuentas } = cuentaPrincipal(datos.cuentas, r);
  const filas = datos.cuentas.filter((f) => f.ig_user_id === cuenta).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const filasMes = filas.filter((f) => f.fecha >= r.desde && f.fecha <= r.hasta);
  const filasAnt = filas.filter((f) => f.fecha >= r.desdeAnterior && f.fecha <= r.hastaAnterior);
  const act = acumular(filasMes);
  const ant = acumular(filasAnt);

  if (cuenta === null || act.diasConDato === 0) {
    return {
      vacio: true,
      titulo,
      motivo: `No hay métricas de Instagram guardadas de ${nombreMesAnio}. Se guardan cada día desde que se conectó la cuenta; si acaba de conectarse, prueba con el mes que viene.`,
    };
  }

  // ── Comparación ──
  const completoAct = !r.enCurso && act.diasConDato === r.diasMes;
  const completoAnt = ant.diasConDato === r.diasMesAnterior;
  const comparable = act.diasConDato >= 7 && act.diasConDato >= r.diasCerrados / 2 && ant.diasConDato >= r.diasMesAnterior / 2;
  const base: Variacion["base"] = completoAct && completoAnt ? "total" : "media";
  const porDia = (total: number | null, dias: number) => (total === null || dias === 0 ? null : total / dias);
  const cifra = (clave: keyof Omit<Acumulado, "diasConDato">): Cifra => {
    const actual = base === "total" ? act[clave] : porDia(act[clave], act.diasConDato);
    const anterior = base === "total" ? ant[clave] : porDia(ant[clave], ant.diasConDato);
    const v = comparable ? variacionPct(actual, anterior) : null;
    return { valor: act[clave], variacion: v === null ? null : { valor: v, base }, anterior: v === null ? null : anterior };
  };
  const alcance = cifra("alcance");
  const visualizaciones = cifra("visualizaciones");
  const interacciones = cifra("interacciones");
  const visitasPerfil = cifra("visitasPerfil");
  const toquesEnlaces = cifra("toquesEnlaces");

  const segAct = ultimosSeguidores(filasMes);
  const segAnt = ultimosSeguidores(filasAnt);
  const seguidores = { valor: segAct, anterior: segAnt, cambio: segAct !== null && segAnt !== null ? segAct - segAnt : null };
  const tasaInteraccion = act.alcance && act.interacciones !== null ? (100 * act.interacciones) / act.alcance : null;

  let comparacion: string;
  if (comparable) comparacion = `frente a ${nombreMesAnt}`;
  else if (ant.diasConDato === 0) comparacion = `sin datos de ${nombreMesAnt} para comparar`;
  else if (ant.diasConDato < r.diasMesAnterior / 2)
    comparacion = `${nombreMesAnt} solo tiene ${ant.diasConDato} ${ant.diasConDato === 1 ? "día con datos" : "días con datos"}: aún no se puede comparar`;
  else comparacion = `pocos días todavía para comparar con ${nombreMesAnt}`;

  const va = alcance.variacion;
  const cabezaResumen =
    va?.base === "media"
      ? `${Mes}: ${fmtMedia(porDia(act.alcance, act.diasConDato) ?? 0)} de alcance al día en Instagram`
      : `El alcance de Instagram en ${nombreMes}: ${fmtEntero(act.alcance ?? 0)}`;
  const titularResumen = !va
    ? cabezaResumen
    : Math.abs(va.valor) < UMBRAL_ESTABLE_PCT
      ? `${cabezaResumen}, en la línea de ${nombreMesAnt}`
      : `${cabezaResumen}, un ${fmtVariacionAbs(va.valor)} ${va.valor > 0 ? "más" : "menos"} que en ${nombreMesAnt}`;

  // ── Evolución diaria del alcance ──
  const porFechaAct = new Map(filasMes.map((f) => [f.fecha, f.alcance]));
  const porFechaAnt = new Map(filasAnt.map((f) => [f.fecha, f.alcance]));
  const puntos: PuntoEvolucion[] = [];
  for (let dia = 1; dia <= r.diasMes; dia++) {
    const fecha = format(addDays(parseISO(r.desde), dia - 1), ISO);
    const fechaAnt = dia <= r.diasMesAnterior ? format(addDays(parseISO(r.desdeAnterior), dia - 1), ISO) : null;
    puntos.push({ dia, fecha, actual: porFechaAct.get(fecha) ?? null, anterior: fechaAnt ? (porFechaAnt.get(fechaAnt) ?? null) : null });
  }
  let mejor: { fecha: string; alcance: number } | null = null;
  for (const f of filasMes) if (f.alcance !== null && (mejor === null || f.alcance > mejor.alcance)) mejor = { fecha: f.fecha, alcance: f.alcance };
  const mejorDia = mejor ? { dia: parseISO(mejor.fecha).getDate(), visitas: mejor.alcance, fecha: mejor.fecha, texto: fmtDiaLargo(mejor.fecha) } : null;
  const huecos: { desde: number; hasta: number }[] = [];
  const primerDato = filas.find((f) => f.alcance !== null)?.fecha ?? null;
  for (const p of puntos) {
    const sinDato = p.actual === null && p.fecha <= r.hasta && primerDato !== null && p.fecha >= primerDato;
    if (!sinDato) continue;
    const ultimo = huecos[huecos.length - 1];
    if (ultimo && ultimo.hasta === p.dia - 1) ultimo.hasta = p.dia;
    else huecos.push({ desde: p.dia, hasta: p.dia });
  }
  const hayAnterior = puntos.some((p) => p.anterior !== null);
  const titularEvolucion = mejorDia
    ? `El día de más alcance fue el ${mejorDia.texto}, con ${fmtEntero(mejorDia.visitas)} ${mejorDia.visitas === 1 ? "cuenta" : "cuentas"}`
    : `Así se movió el alcance día a día en ${nombreMes}`;

  // ── Publicaciones del mes ──
  const deCuenta = datos.publicaciones.filter((p) => p.ig_user_id === cuenta);
  const enRango = (p: PublicacionIg, desde: string, hasta: string) => {
    const d = diaMadrid(p.publicado_at);
    return d !== null && d >= desde && d <= hasta;
  };
  const pubsMes = deCuenta.filter((p) => enRango(p, r.desde, r.hasta));
  const pubsAnt = deCuenta.filter((p) => enRango(p, r.desdeAnterior, r.hastaAnterior));
  let publicaciones: InformeRrss["publicaciones"] = null;
  if (pubsMes.length > 0) {
    const grupos = new Map<string, PublicacionIg[]>();
    for (const p of pubsMes) {
      const t = tipoPublicacion(p);
      grupos.set(t, [...(grupos.get(t) ?? []), p]);
    }
    const porTipo: TipoPublicado[] = [...grupos]
      .map(([nombre, ps]) => {
        const conAlcance = ps.filter((p) => p.alcance !== null);
        return {
          nombre,
          visitas: ps.length,
          pct: (100 * ps.length) / pubsMes.length,
          destacado: false,
          alcanceMedio: conAlcance.length ? (sumar(conAlcance.map((p) => p.alcance)) ?? 0) / conAlcance.length : null,
        };
      })
      .sort((a, b) => b.visitas - a.visitas || a.nombre.localeCompare(b.nombre, "es"));
    if (porTipo[0]) porTipo[0].destacado = true;
    const mejores: MejorPublicacion[] = pubsMes
      .filter((p): p is PublicacionIg & { alcance: number } => p.alcance !== null)
      .sort((a, b) => b.alcance - a.alcance || (a.publicado_at ?? "").localeCompare(b.publicado_at ?? ""))
      .slice(0, MAX_MEJORES)
      .map((p) => {
        const inter = interaccionesPublicacion(p);
        const fecha = diaMadrid(p.publicado_at) ?? r.desde;
        return {
          mediaId: p.media_id,
          fecha,
          fechaCorta: fmtDiaCorto(fecha),
          tipo: tipoPublicacion(p),
          texto: textoPublicacion(p.caption),
          alcance: p.alcance,
          interacciones: inter,
          tasa: inter !== null && p.alcance > 0 ? (100 * inter) / p.alcance : null,
          permalink: p.permalink,
        };
      });
    const n = pubsMes.length;
    const nAnt = pubsAnt.length;
    const verbo = r.enCurso ? (n === 1 ? "Va" : "Van") : n === 1 ? "Salió" : "Salieron";
    const cabezaPub = `${verbo} ${n} ${n === 1 ? "publicación" : "publicaciones"} en ${nombreMes}`;
    const titularPub =
      nAnt > 0 && !r.enCurso
        ? `${cabezaPub}, ${n === nAnt ? (n === 1 ? "la misma que" : "las mismas que") : n > nAnt ? `${n - nAnt} más que` : `${nAnt - n} menos que`} en ${nombreMesAnt}`
        : cabezaPub;
    const top = mejores[0];
    publicaciones = {
      titular: titularPub,
      total: n,
      totalAnterior: nAnt,
      porTipo,
      mejores,
      titularMejores: top
        ? `La que más llegó: ${top.tipo === "Historia" ? "una historia" : top.tipo === "Foto" ? "una foto" : `un ${top.tipo.toLowerCase()}`} del ${top.fechaCorta}, con ${fmtEntero(top.alcance)} ${top.alcance === 1 ? "cuenta" : "cuentas"} alcanzadas`
        : `Las publicaciones de ${nombreMes}`,
    };
  }

  // ── Visitas a la web desde redes ──
  let web: InformeRrss["web"] = null;
  if (datos.web) {
    const wAct = resumirRedes(datos.web.actual);
    const wAnt = resumirRedes(datos.web.anterior);
    if (wAct.total > 0) {
      const mesCompleto = !r.enCurso;
      const actualCmp = mesCompleto ? wAct.total : wAct.total / r.diasCerrados;
      const anteriorCmp = mesCompleto ? wAnt.total : wAnt.total / r.diasMesAnterior;
      const v = variacionPct(actualCmp, wAnt.total > 0 ? anteriorCmp : null);
      const redes: ItemBarra[] = wAct.redes.map(({ nombre, visitas }, i) => ({ nombre, visitas, pct: (100 * visitas) / wAct.total, destacado: i === 0 }));
      const principal = redes[0];
      web = {
        titular:
          redes.length > 1
            ? `Las redes llevaron ${fmtEntero(wAct.total)} ${wAct.total === 1 ? "visita" : "visitas"} a la web; ${fmtCuota(principal.pct)} desde ${principal.nombre}`
            : `Las redes llevaron ${fmtEntero(wAct.total)} ${wAct.total === 1 ? "visita" : "visitas"} a la web, todas desde ${principal.nombre}`,
        total: wAct.total,
        cuota: wAct.cuota,
        variacion: v === null ? null : { valor: v, base: mesCompleto ? "total" : "media" },
        anterior: v === null ? null : anteriorCmp,
        redes,
      };
    }
  }

  // ── Conclusiones ──
  const conclusiones: string[] = [];
  if (va) {
    conclusiones.push(
      Math.abs(va.valor) < UMBRAL_ESTABLE_PCT
        ? `El alcance se mantuvo en la línea de ${nombreMesAnt}${va.base === "media" ? " (media por día)" : ""}.`
        : `El alcance ${va.valor > 0 ? "subió" : "bajó"} un ${fmtVariacionAbs(va.valor)} frente a ${nombreMesAnt}${va.base === "media" ? " (media por día)" : ""}.`,
    );
  }
  if (seguidores.cambio !== null && seguidores.valor !== null) {
    conclusiones.push(
      seguidores.cambio === 0
        ? `La cuenta sigue con ${fmtEntero(seguidores.valor)} seguidores, los mismos que al cerrar ${nombreMesAnt}.`
        : `La cuenta ${seguidores.cambio > 0 ? "ganó" : "perdió"} ${fmtEntero(Math.abs(seguidores.cambio))} ${Math.abs(seguidores.cambio) === 1 ? "seguidor" : "seguidores"}: ${r.enCurso ? "va" : "cerró"} con ${fmtEntero(seguidores.valor)}.`,
    );
  }
  if (publicaciones) {
    const comparables = publicaciones.porTipo.filter((t) => t.visitas >= MINIMO_POR_TIPO && t.alcanceMedio !== null);
    if (comparables.length >= 2) {
      const orden = [...comparables].sort((a, b) => (b.alcanceMedio ?? 0) - (a.alcanceMedio ?? 0));
      const [a, b] = [orden[0], orden[orden.length - 1]];
      conclusiones.push(
        `${mayusculaInicial(PLURAL_TIPO[a.nombre] ?? a.nombre)} llegaron de media a ${fmtEntero(a.alcanceMedio ?? 0)} cuentas, frente a ${fmtEntero(b.alcanceMedio ?? 0)} de ${PLURAL_TIPO[b.nombre] ?? b.nombre}.`,
      );
    }
    const top = publicaciones.mejores[0];
    if (top) conclusiones.push(`La publicación con más alcance fue la del ${top.fechaCorta} (${top.tipo.toLowerCase()}), con ${fmtEntero(top.alcance)} cuentas.`);
  } else {
    conclusiones.push(`No hay publicaciones de ${nombreMes} con métricas guardadas.`);
  }
  if (web) {
    conclusiones.push(
      `Desde las redes llegaron ${fmtEntero(web.total)} ${web.total === 1 ? "visita" : "visitas"} a la web${web.cuota !== null ? ` (${fmtCuota(web.cuota)} del total)` : ""}${web.redes.length > 1 ? `, sobre todo desde ${web.redes[0].nombre}` : ""}.`,
    );
  }
  if (tasaInteraccion !== null && conclusiones.length < MAX_CONCLUSIONES) {
    conclusiones.push(`De cada 100 cuentas alcanzadas, unas ${fmtMedia(Math.round(tasaInteraccion * 10) / 10)} interactuaron (me gusta, comentarios, guardados o compartidos).`);
  }

  // ── Notas ──
  const notas = [
    "Alcance del mes: la suma del alcance de cada día (una cuenta que vio contenido tres días cuenta tres veces).",
    "Datos de la API oficial de Instagram; Meta puede tardar hasta 48 horas en darlos completos.",
  ];
  if (publicaciones) notas.push("Las cifras de cada publicación son las acumuladas hasta la última captura.");
  if (numCuentas > 1) notas.push(`Hay ${numCuentas} cuentas de Instagram con datos: el informe usa la que tiene más días medidos.`);
  notas.push("Facebook todavía no está conectado al panel: este informe no incluye sus datos.");

  return {
    vacio: false,
    titulo,
    nombreArchivo: `${aNombreArchivo(`Redes sociales ${MARCA_INFORME} ${nombreMesAnio}`)}.pdf`,
    marca: MARCA_INFORME,
    mes: { clave: r.mes, nombre: nombreMes, nombreAnio: nombreMesAnio },
    mesAnterior: { nombre: nombreMesAnt },
    enCurso: r.enCurso,
    periodo: describirPeriodo(r),
    resumen: {
      titular: titularResumen,
      alcance,
      visualizaciones,
      interacciones,
      visitasPerfil,
      toquesEnlaces,
      seguidores,
      tasaInteraccion,
      comparacion,
      diasConDatos: act.diasConDato,
    },
    evolucion: { titular: titularEvolucion, puntos, mejorDia, hayAnterior, huecos },
    publicaciones,
    web,
    conclusiones: conclusiones.slice(0, MAX_CONCLUSIONES),
    notas,
  };
}

/** Lo que hay que pedir para el informe: del 1 del mes anterior al último día cerrado. */
export function rangoDatosRrss(mes: string, hoy: string): { desdeAnterior: string; desde: string; hasta: string; hastaAnterior: string } | null {
  const r = rangoInforme(mes, hoy);
  return r.diasCerrados > 0 ? { desdeAnterior: r.desdeAnterior, desde: r.desde, hasta: r.hasta, hastaAnterior: r.hastaAnterior } : null;
}

