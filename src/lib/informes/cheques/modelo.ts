/**
 * Informe de cheques regalo: de las filas de la RPC `informe_cheques_regalo` (sin datos personales) a las cifras,
 * gráficas y conclusiones del informe. Función pura y determinista (no mira el reloj): la usan el diálogo de
 * Cheques › Stripe y el módulo «Informes» del Super Admin (a través de `generarInformeCheques`, ver ./index.ts).
 *
 * Definiciones (las mismas que se explican en el propio informe):
 *   · Venta: cheque cobrado (web o manual) creado en el periodo. Las cortesías y los reembolsados no son venta.
 *   · Canje: cheque cobrado canjeado en el periodo, sea cual sea el día en que se vendió.
 *   · Pendiente al cierre: cobrado antes del cierre, sin canjear y sin caducar ese día. Es dinero ya cobrado que
 *     el restaurante debe en comidas.
 *   · Comisión de Stripe: la real que guarda el webhook; si falta, se estima con la tarifa estándar
 *     (1,5 % + 0,25 € sobre lo cobrado), como la pestaña Stripe.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { fmtCifra, fmtDiaLargo, fmtEntero, fmtVariacionAbs, mayusculaInicial } from "@/components/trafico-web/informe/formatoInforme";
import type { Cifra, DiaSemanaInforme, ItemBarra, PuntoEvolucion } from "@/components/trafico-web/informe/modelo";
import type { PeriodoInforme } from "./periodo";

export type CanalCheque = "web" | "manual" | "cortesia";

/** Una fila de la RPC `informe_cheques_regalo`. Fechas en hora de Madrid, sin zona. */
export interface FilaInformeCheque {
  creado: string;
  importe_eur: number | string;
  gastos_gestion_eur: number | string | null;
  stripe_fee_eur: number | string | null;
  canal: CanalCheque;
  estado: "pagado" | "reembolsado";
  canjeado: string | null;
  caduca_el: string | null;
}

export interface RespuestaInformeCheques {
  desde?: string;
  hasta?: string;
  hoy?: string;
  cheques: FilaInformeCheque[];
}

export interface InformeChequesVacio {
  vacio: true;
  titulo: string;
  motivo: string;
}

export interface CifraEuros extends Cifra {
  /** Número de cheques de la cifra (p. ej. 12 cheques canjeados por 950 €). */
  cheques: number;
}

export interface InformeCheques {
  vacio: false;
  /** «Cheques regalo: octubre 2026» */
  titulo: string;
  nombreArchivo: string;
  periodo: PeriodoInforme;
  resumen: {
    titular: string;
    vendido: CifraEuros;
    vendidos: Cifra;
    ticketMedio: Cifra;
    canjeado: CifraEuros;
    pendiente: CifraEuros;
  };
  evolucion: {
    titular: string;
    /** Mes: importe vendido acumulado día a día (y el del periodo anterior). Año: importe vendido por mes. */
    tipo: "acumulado" | "meses";
    puntos: PuntoEvolucion[];
    meses: DiaSemanaInforme[];
    mejorDia: { fecha: string; texto: string; importe: number } | null;
  };
  cobros: {
    titular: string;
    canales: ItemBarra[];
    cobradoTotal: number;
    web: { cheques: number; cobrado: number; gastos: number; comision: number; neto: number; comisionEstimada: boolean };
    manual: { cheques: number; importe: number };
    cortesia: { cheques: number; importe: number };
    reembolsos: { cheques: number; importe: number };
  };
  canjes: {
    titular: string;
    canjeados: CifraEuros;
    diasMediosHastaCanje: number | null;
    pendiente: CifraEuros;
    caducanPronto: { cheques: number; importe: number; dias: number };
    caducadosSinCanjear: { cheques: number; importe: number };
    importes: ItemBarra[];
  };
  diasSemana: { titular: string; items: DiaSemanaInforme[]; mejor: DiaSemanaInforme } | null;
  conclusiones: string[];
  notas: string[];
}

/** Días hacia delante en los que se avisa de cheques a punto de caducar. */
export const DIAS_AVISO_CADUCIDAD = 60;
const ESTIMACION_PCT = 0.015;
const ESTIMACION_FIJO = 0.25;
const MAX_IMPORTES = 6;

const n = (v: number | string | null | undefined): number => {
  const x = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(x) ? (x as number) : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const dia = (ts: string) => ts.slice(0, 10);
const suma = <T>(xs: T[], f: (x: T) => number) => r2(xs.reduce((a, x) => a + f(x), 0));

/** «1.250 €», «48,50 €» (con espacio de no separación antes de €). */
export function fmtEuros(v: number): string {
  const entero = Math.abs(v - Math.round(v)) < 0.005;
  return `${fmtCifra(v, entero ? 0 : 2)}\u00A0€`;
}

export const comisionDe = (f: FilaInformeCheque): { valor: number; estimada: boolean } => {
  if (f.stripe_fee_eur !== null && f.stripe_fee_eur !== undefined && f.stripe_fee_eur !== "") return { valor: n(f.stripe_fee_eur), estimada: false };
  return { valor: r2((n(f.importe_eur) + n(f.gastos_gestion_eur)) * ESTIMACION_PCT + ESTIMACION_FIJO), estimada: true };
};

function variacion(actual: number, anterior: number): Cifra["variacion"] {
  if (!(anterior > 0)) return null;
  return { valor: ((actual - anterior) / anterior) * 100, base: "total" };
}
const cifra = (actual: number, anterior: number): Cifra => ({ valor: actual, anterior, variacion: variacion(actual, anterior) });
const cifraEuros = (actual: number, anterior: number, cheques: number): CifraEuros => ({ ...cifra(actual, anterior), cheques });

interface Tramo {
  desde: string;
  hasta: string;
}

const enTramo = (d: string, t: Tramo) => d >= t.desde && d <= t.hasta;
const ventasDe = (filas: FilaInformeCheque[], t: Tramo) => filas.filter((f) => f.estado === "pagado" && f.canal !== "cortesia" && enTramo(dia(f.creado), t));
const canjesDe = (filas: FilaInformeCheque[], t: Tramo) => filas.filter((f) => f.estado === "pagado" && f.canjeado && enTramo(dia(f.canjeado), t));
/** Pendientes al acabar el día `cierre`: cobrados, sin canjear y sin caducar ese día (el día de caducidad cuenta). */
const pendientesAl = (filas: FilaInformeCheque[], cierre: string) =>
  filas.filter((f) => f.estado === "pagado" && f.canal !== "cortesia" && dia(f.creado) <= cierre && (!f.canjeado || dia(f.canjeado) > cierre) && (!f.caduca_el || f.caduca_el >= cierre));

const DIAS_SEMANA = [
  { corto: "Lun", singular: "lunes" },
  { corto: "Mar", singular: "martes" },
  { corto: "Mié", singular: "miércoles" },
  { corto: "Jue", singular: "jueves" },
  { corto: "Vie", singular: "viernes" },
  { corto: "Sáb", singular: "sábado" },
  { corto: "Dom", singular: "domingo" },
];
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const plural = (cantidad: number, uno: string, varios: string) => `${fmtEntero(cantidad)} ${cantidad === 1 ? uno : varios}`;

/** Frase de comparación: «un 12 % más que en septiembre», «lo mismo que…». */
function frenteA(v: Cifra["variacion"], nombreAnterior: string, enCurso: boolean): string {
  const ref = enCurso ? `los mismos días de ${nombreAnterior}` : nombreAnterior;
  if (!v) return "";
  if (Math.abs(v.valor) < 5) return `, casi igual que en ${ref}`;
  return `, un ${fmtVariacionAbs(v.valor)} ${v.valor > 0 ? "más" : "menos"} que en ${ref}`;
}

export function construirInformeCheques(datos: RespuestaInformeCheques, periodo: PeriodoInforme): InformeCheques | InformeChequesVacio {
  const titulo = `Cheques regalo: ${periodo.nombre}`;
  const filas = (datos.cheques ?? []).filter((f) => f && typeof f.creado === "string");
  const actual: Tramo = { desde: periodo.desde, hasta: periodo.hasta };
  const anterior: Tramo = { desde: periodo.desdeAnterior, hasta: periodo.hastaAnterior };

  const ventas = ventasDe(filas, actual);
  const ventasAnt = ventasDe(filas, anterior);
  const canjes = canjesDe(filas, actual);
  const canjesAnt = canjesDe(filas, anterior);
  const pendientes = pendientesAl(filas, periodo.hasta);
  const pendientesAnt = pendientesAl(filas, periodo.hastaAnterior);
  const creadosEnPeriodo = filas.filter((f) => enTramo(dia(f.creado), actual));

  if (ventas.length === 0 && canjes.length === 0 && pendientes.length === 0 && creadosEnPeriodo.length === 0) {
    return { vacio: true, titulo, motivo: `No hay cheques vendidos, canjeados ni pendientes de canjear en ${periodo.nombre}.` };
  }

  const importe = (f: FilaInformeCheque) => n(f.importe_eur);
  const vendido = suma(ventas, importe);
  const vendidoAnt = suma(ventasAnt, importe);
  const ticket = ventas.length ? r2(vendido / ventas.length) : 0;
  const ticketAnt = ventasAnt.length ? r2(vendidoAnt / ventasAnt.length) : 0;
  const resumenVendido = cifraEuros(vendido, vendidoAnt, ventas.length);
  const resumenCanjeado = cifraEuros(suma(canjes, importe), suma(canjesAnt, importe), canjes.length);
  const resumenPendiente = cifraEuros(suma(pendientes, importe), suma(pendientesAnt, importe), pendientes.length);
  const vendidos = cifra(ventas.length, ventasAnt.length);

  // ─── Evolución ─────────────────────────────────────────────────────────────
  const porDia = new Map<string, number>();
  for (const v of ventas) porDia.set(dia(v.creado), r2((porDia.get(dia(v.creado)) ?? 0) + importe(v)));
  const mejor = [...porDia].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
  let puntos: PuntoEvolucion[] = [];
  let meses: DiaSemanaInforme[] = [];
  if (periodo.tipo === "mes") {
    const diasMes = differenceInCalendarDays(parseISO(periodo.fin), parseISO(periodo.desde)) + 1;
    const diasAnt = differenceInCalendarDays(parseISO(periodo.hastaAnterior), parseISO(periodo.desdeAnterior)) + 1;
    const porDiaAnt = new Map<string, number>();
    for (const v of ventasAnt) porDiaAnt.set(dia(v.creado), (porDiaAnt.get(dia(v.creado)) ?? 0) + importe(v));
    let acum = 0;
    let acumAnt = 0;
    for (let i = 0; i < diasMes; i++) {
      const fecha = format(addDays(parseISO(periodo.desde), i), "yyyy-MM-dd");
      const fechaAnt = format(addDays(parseISO(periodo.desdeAnterior), i), "yyyy-MM-dd");
      acum += porDia.get(fecha) ?? 0;
      if (i < diasAnt) acumAnt += porDiaAnt.get(fechaAnt) ?? 0;
      puntos.push({ dia: i + 1, fecha, actual: fecha <= periodo.hasta ? r2(acum) : null, anterior: i < diasAnt ? r2(acumAnt) : null });
    }
  } else {
    const porMes = Array.from({ length: 12 }, () => 0);
    for (const v of ventas) porMes[Number(v.creado.slice(5, 7)) - 1] += importe(v);
    const ultimoMes = Number(periodo.hasta.slice(5, 7));
    const max = Math.max(...porMes);
    meses = porMes.map((valor, i) => ({
      corto: MESES_CORTOS[i],
      singular: MESES[i],
      media: i < ultimoMes ? r2(valor) : null,
      dias: 0,
      destacado: max > 0 && valor === max,
    }));
    puntos = [];
  }
  const mesMejor = meses.find((m) => m.destacado);
  const titularEvolucion =
    periodo.tipo === "mes"
      ? mejor
        ? `El día de más ventas fue el ${fmtDiaLargo(mejor[0])}, con ${fmtEuros(mejor[1])}`
        : "No hubo ventas en este periodo"
      : mesMejor
        ? `${mayusculaInicial(mesMejor.singular)} fue el mes de más ventas, con ${fmtEuros(mesMejor.media ?? 0)}`
        : "No hubo ventas en este periodo";

  // ─── Cobros ────────────────────────────────────────────────────────────────
  const web = ventas.filter((v) => v.canal === "web");
  const manual = ventas.filter((v) => v.canal === "manual");
  const cortesias = creadosEnPeriodo.filter((f) => f.estado === "pagado" && f.canal === "cortesia");
  const reembolsos = creadosEnPeriodo.filter((f) => f.estado === "reembolsado");
  const comisiones = web.map(comisionDe);
  const cobradoWeb = suma(web, (f) => importe(f) + n(f.gastos_gestion_eur));
  const comision = suma(comisiones, (c) => c.valor);
  const gastos = suma(web, (f) => n(f.gastos_gestion_eur));
  const importeManual = suma(manual, importe);
  const cobradoTotal = r2(cobradoWeb + importeManual);
  const totalCanales = vendido + suma(cortesias, importe);
  const canales: ItemBarra[] = [
    { nombre: "Web (Stripe)", visitas: suma(web, importe), pct: 0, destacado: false },
    { nombre: "En el restaurante", visitas: importeManual, pct: 0, destacado: false },
    { nombre: "Cortesía (regalo)", visitas: suma(cortesias, importe), pct: 0, destacado: false },
  ]
    .filter((c) => c.visitas > 0)
    .map((c) => ({ ...c, pct: totalCanales > 0 ? (100 * c.visitas) / totalCanales : 0 }))
    .sort((a, b) => b.visitas - a.visitas)
    .map((c, i) => ({ ...c, destacado: i === 0 }));
  const pctWeb = vendido > 0 ? (100 * suma(web, importe)) / vendido : 0;
  const titularCobros =
    web.length === 0
      ? manual.length
        ? "Todas las ventas del periodo se hicieron en el restaurante"
        : "Sin cobros en este periodo"
      : `Stripe se llevó ${fmtEuros(comision)}${gastos > 0 ? `; los gastos de gestión cubrieron ${fmtEuros(Math.min(gastos, comision))}` : ` de ${fmtEuros(cobradoWeb)} cobrados en la web`}`;

  // ─── Canjes y pendientes ───────────────────────────────────────────────────
  const diasCanje = canjes.map((c) => differenceInCalendarDays(parseISO(dia(c.canjeado as string)), parseISO(dia(c.creado))));
  const diasMedios = diasCanje.length ? diasCanje.reduce((a, b) => a + b, 0) / diasCanje.length : null;
  const limiteAviso = format(addDays(parseISO(periodo.hasta), DIAS_AVISO_CADUCIDAD), "yyyy-MM-dd");
  const caducanPronto = pendientes.filter((p) => p.caduca_el && p.caduca_el > periodo.hasta && p.caduca_el <= limiteAviso);
  const caducados = filas.filter(
    (f) => f.estado === "pagado" && f.canal !== "cortesia" && f.caduca_el && enTramo(f.caduca_el, actual) && f.caduca_el < periodo.hasta && (!f.canjeado || dia(f.canjeado) > f.caduca_el),
  );
  const porImporte = new Map<number, number>();
  for (const v of ventas) porImporte.set(importe(v), (porImporte.get(importe(v)) ?? 0) + 1);
  const importes: ItemBarra[] = [...porImporte]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .slice(0, MAX_IMPORTES)
    .map(([valor, cuantos], i) => ({ nombre: `Cheque de ${fmtEuros(valor)}`, visitas: cuantos, pct: (100 * cuantos) / ventas.length, destacado: i === 0 }));
  const titularCanjes =
    resumenPendiente.valor && resumenPendiente.valor > 0
      ? `Quedan ${fmtEuros(resumenPendiente.valor ?? 0)} en ${plural(pendientes.length, "cheque", "cheques")} por canjear`
      : "No queda ningún cheque pendiente de canjear";

  // ─── Días de la semana ─────────────────────────────────────────────────────
  let diasSemana: InformeCheques["diasSemana"] = null;
  if (ventas.length >= 3) {
    const cuenta = Array.from({ length: 7 }, () => 0);
    for (const v of ventas) cuenta[(parseISO(dia(v.creado)).getDay() + 6) % 7]++;
    const max = Math.max(...cuenta);
    const items = DIAS_SEMANA.map((d, i) => ({ ...d, media: cuenta[i], dias: cuenta[i], destacado: cuenta[i] === max }));
    const mejorDia = items.find((d) => d.destacado) as DiaSemanaInforme;
    const empatados = items.filter((d) => d.destacado).map((d) => d.singular);
    const titularDias =
      empatados.length === 1
        ? `El ${mejorDia.singular} es el día que más cheques se venden`
        : `${mayusculaInicial(empatados.map((d) => `el ${d}`).join(", ").replace(/, ([^,]*)$/, " y $1"))} son los días que más cheques se venden`;
    diasSemana = { titular: titularDias, items, mejor: mejorDia };
  }

  // ─── Titular y conclusiones ────────────────────────────────────────────────
  const ref = periodo.nombreAnterior;
  const titular =
    ventas.length > 0
      ? `${plural(ventas.length, "cheque vendido", "cheques vendidos")} por ${fmtEuros(vendido)}${frenteA(resumenVendido.variacion, ref, periodo.enCurso)}`
      : `Sin ventas de cheques en ${periodo.nombre}${canjes.length ? `; se canjearon ${plural(canjes.length, "cheque", "cheques")}` : ""}`;
  const conclusiones: string[] = [];
  if (ventas.length > 0) conclusiones.push(`Se vendieron ${plural(ventas.length, "cheque", "cheques")} por ${fmtEuros(vendido)}${frenteA(resumenVendido.variacion, ref, periodo.enCurso)}. El cheque medio fue de ${fmtEuros(ticket)}.`);
  if (web.length > 0) conclusiones.push(`El ${fmtEntero(pctWeb)}${"\u00A0"}% de lo vendido entró por la web. Stripe se quedó ${fmtEuros(comision)} (${fmtCifra((100 * comision) / Math.max(cobradoWeb, 0.01), 1)}${"\u00A0"}% de lo cobrado)${gastos > 0 ? ` y los gastos de gestión cubrieron ${fmtEuros(Math.min(gastos, comision))}` : ""}.`);
  if (canjes.length > 0) conclusiones.push(`Se canjearon ${plural(canjes.length, "cheque", "cheques")} por ${fmtEuros(resumenCanjeado.valor ?? 0)}${diasMedios !== null ? `, de media ${plural(Math.round(diasMedios), "día", "días")} después de comprarlos` : ""}.`);
  if (pendientes.length > 0) conclusiones.push(`Al cierre quedan ${fmtEuros(resumenPendiente.valor ?? 0)} por canjear (${plural(pendientes.length, "cheque", "cheques")}): es dinero ya cobrado que se servirá en comidas.`);
  if (caducanPronto.length > 0) conclusiones.push(`${plural(caducanPronto.length, "cheque caduca", "cheques caducan")} en los próximos ${DIAS_AVISO_CADUCIDAD} días (${fmtEuros(suma(caducanPronto, importe))}).`);
  if (caducados.length > 0) conclusiones.push(`${plural(caducados.length, "cheque caducó", "cheques caducaron")} sin canjear en el periodo (${fmtEuros(suma(caducados, importe))}).`);
  if (reembolsos.length > 0) conclusiones.push(`Se reembolsaron ${plural(reembolsos.length, "cheque", "cheques")} (${fmtEuros(suma(reembolsos, importe))}).`);

  const notas: string[] = [
    "Ventas: cheques cobrados (web y en el restaurante) en el periodo; las cortesías y los reembolsos no cuentan como venta.",
    "Pendiente de canjear: cobrado, sin canjear y sin caducar al acabar el periodo.",
  ];
  if (comisiones.some((c) => c.estimada)) notas.push("Algunos pagos no tienen guardada la comisión real de Stripe: se estima con la tarifa estándar (1,5 % + 0,25 €).");
  if (periodo.enCurso) notas.push(`El periodo está en curso: se compara con ${periodo.tipo === "mes" ? `los mismos días de ${ref}` : `el mismo tramo de ${ref}`}.`);

  return {
    vacio: false,
    titulo,
    nombreArchivo: `informe-cheques-regalo-${periodo.clave}.pdf`,
    periodo,
    resumen: { titular, vendido: resumenVendido, vendidos, ticketMedio: cifra(ticket, ticketAnt), canjeado: resumenCanjeado, pendiente: resumenPendiente },
    evolucion: {
      titular: titularEvolucion,
      tipo: periodo.tipo === "mes" ? "acumulado" : "meses",
      puntos,
      meses,
      mejorDia: mejor ? { fecha: mejor[0], texto: fmtDiaLargo(mejor[0]), importe: mejor[1] } : null,
    },
    cobros: {
      titular: titularCobros,
      canales,
      cobradoTotal,
      web: { cheques: web.length, cobrado: cobradoWeb, gastos, comision, neto: r2(cobradoWeb - comision), comisionEstimada: comisiones.some((c) => c.estimada) },
      manual: { cheques: manual.length, importe: importeManual },
      cortesia: { cheques: cortesias.length, importe: suma(cortesias, importe) },
      reembolsos: { cheques: reembolsos.length, importe: suma(reembolsos, importe) },
    },
    canjes: {
      titular: titularCanjes,
      canjeados: resumenCanjeado,
      diasMediosHastaCanje: diasMedios,
      pendiente: resumenPendiente,
      caducanPronto: { cheques: caducanPronto.length, importe: suma(caducanPronto, importe), dias: DIAS_AVISO_CADUCIDAD },
      caducadosSinCanjear: { cheques: caducados.length, importe: suma(caducados, importe) },
      importes,
    },
    diasSemana,
    conclusiones,
    notas,
  };
}
