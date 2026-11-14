/**
 * Super Admin › Servicios › Costes: el precio de todos los servicios y de las
 * IAs (encargo del dueño del 13/11/2026, «Pasos para saber el precio de todos
 * los servicios y de las IAs»). Cuentas puras, sin React:
 *
 *   1. Inventario: cada servicio con para qué se usa, su plan, su precio fijo
 *      al mes y al año y si el precio está confirmado.
 *   3. IA función por función (`ia_coste_por_uso`, 20261129153000).
 *   4. Cuánto cuesta cada cosa, en palabras («Leer una factura ≈ 0,6
 *      céntimos»): la MEDIANA del coste de un uso en el mes.
 *   5. El mes frente al anterior (sobre `resumirCostes`).
 *   6. Avisos antes de pasar del plan gratis: % de cada límite del plan, a qué
 *      ritmo va, qué pasaría y cuánto cuesta el plan siguiente.
 *
 * Los precios vienen de `servicios_contratados` (los edita el dueño) y de
 * `ia_precios` (vía `ia_uso`): aquí no hay ningún precio escrito.
 */
import {
  type FilaMetrica,
  type LecturaServicio,
  type ResumenCostes,
  type ServicioContratado,
  aBytes,
  aEur,
  combinarMetricas,
  cuotaMensual,
  esUnidadBytes,
  fechaCorta,
  formatearBytes,
  formatearCantidad,
  formatearEur,
  formatearPorcentaje,
  sinAclaracion,
} from "@/lib/servicios";

const redondear2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** «20,00 US$ (≈ 17,89 €)» o «12,00 €». */
function importeConEur(importe: number, moneda: string, eurPorUsd: number): string {
  const original = formatearCantidad(importe, moneda);
  if ((moneda ?? "").toUpperCase() === "EUR") return original;
  const eur = aEur(importe, moneda, eurPorUsd);
  return eur == null ? original : `${original} (≈ ${formatearEur(eur)})`;
}

// ─── 1. Inventario ──────────────────────────────────────────────────────────

export type EstadoPrecio = "confirmado" | "por_confirmar" | "sin_precio";

export interface FilaInventario {
  proveedor: string;
  nombre: string;
  categoria: string;
  paraQue: string | null;
  plan: string | null;
  /** «Gratis», «Sin cuota (pago por uso)», «Sin precio» o el importe al mes en euros (con el original si no es en euros). */
  textoMes: string;
  /** Lo que se paga al año, o null si no hay cuota (gratis, por uso o sin precio). */
  textoAnio: string | null;
  mesEur: number | null;
  anioEur: number | null;
  estado: EstadoPrecio;
  /** «13/11/2026» si se confirmó desde el panel. */
  confirmadoEn: string | null;
  fuentePrecio: string | null;
  panelUrl: string | null;
}

export interface Inventario {
  filas: FilaInventario[];
  porConfirmar: number;
  /** Suma de las cuotas conocidas (lo que no tiene precio no suma). */
  cuotasMesEur: number;
  cuotasAnioEur: number;
}

/** Inventario de los servicios en uso, en el orden en que llegan. */
export function inventarioServicios(servicios: ServicioContratado[], eurPorUsd: number): Inventario {
  const filas: FilaInventario[] = servicios
    .filter((s) => s.activo !== false)
    .map((s) => {
      const cuota = cuotaMensual(s);
      const mesEur = cuota ? aEur(cuota.importe, cuota.moneda, eurPorUsd) : null;
      const anual = s.ciclo === "anual" && s.precio_anual != null;
      let textoMes: string;
      let textoAnio: string | null = null;
      if (!cuota) textoMes = "Sin precio";
      else if (s.ciclo === "por_uso" && cuota.importe === 0) textoMes = "Sin cuota (pago por uso)";
      else if (cuota.importe === 0) textoMes = "Gratis";
      else {
        textoMes = importeConEur(redondear2(cuota.importe), cuota.moneda, eurPorUsd);
        textoAnio = importeConEur(redondear2(anual ? (s.precio_anual as number) : cuota.importe * 12), cuota.moneda, eurPorUsd);
      }
      return {
        proveedor: s.proveedor,
        nombre: s.nombre,
        categoria: s.categoria,
        paraQue: s.para_que?.trim() || null,
        plan: s.plan,
        textoMes,
        textoAnio,
        mesEur: mesEur == null ? null : redondear2(mesEur),
        anioEur: mesEur == null ? null : redondear2(anual ? (aEur(s.precio_anual as number, cuota!.moneda, eurPorUsd) ?? mesEur * 12) : mesEur * 12),
        estado: !cuota ? "sin_precio" : s.por_confirmar ? "por_confirmar" : "confirmado",
        confirmadoEn: s.por_confirmar ? null : fechaCorta(s.precio_confirmado_en ?? null),
        fuentePrecio: s.fuente_precio ?? null,
        panelUrl: s.panel_url ?? null,
      };
    });
  return {
    filas,
    porConfirmar: filas.filter((f) => f.estado !== "confirmado").length,
    cuotasMesEur: redondear2(filas.reduce((t, f) => t + (f.mesEur ?? 0), 0)),
    cuotasAnioEur: redondear2(filas.reduce((t, f) => t + (f.anioEur ?? 0), 0)),
  };
}

// ─── 5. El mes frente al anterior ───────────────────────────────────────────

export interface ComparacionMes {
  llevamosEur: number;
  previsionEur: number;
  /** null: el mes anterior no tiene ningún dato. */
  anteriorEur: number | null;
  /** Previsión de este mes − mes anterior. */
  diferenciaEur: number | null;
  diferenciaPct: number | null;
}

export function compararConMesAnterior(resumen: Pick<ResumenCostes, "totalMesEur" | "previsionMesEur">, anteriorEur: number | null): ComparacionMes {
  const diferenciaEur = anteriorEur == null ? null : redondear2(resumen.previsionMesEur - anteriorEur);
  return {
    llevamosEur: resumen.totalMesEur,
    previsionEur: resumen.previsionMesEur,
    anteriorEur,
    diferenciaEur,
    diferenciaPct: anteriorEur && diferenciaEur != null ? Math.round((diferenciaEur / anteriorEur) * 1000) / 10 : null,
  };
}

// ─── 6. Avisos antes de pasar del plan gratis ───────────────────────────────

export type NivelAvisoPlan = "rojo" | "ambar" | "verde" | "sin_dato";

export interface AvisoPlan {
  /** «supabase:bd_tamano». */
  clave: string;
  proveedor: string;
  servicio: string;
  metrica: string;
  etiqueta: string;
  nivel: NivelAvisoPlan;
  porcentaje: number | null;
  textoValor: string | null;
  textoLimite: string | null;
  /** «A este ritmo, a fin de mes: 96 % (2.880 de 3.000 correos)», «… llegaría al límite en unos 4 días». */
  prevision: string | null;
  porcentajePrevisto: number | null;
  diasHastaLimite: number | null;
  /** Por qué no hay cifra (solo con nivel «sin_dato»). */
  motivoSinDato: string | null;
  quePasaria: string | null;
  /** «Pro: 25,00 US$ al mes (≈ 22,36 €)». */
  siguientePlan: string | null;
  panelUrl: string | null;
}

/** Métrica de tamaño «ahora» → la de su crecimiento (para saber cuándo llegaría al límite). */
export const CRECIMIENTO_DE: Record<string, string> = { bd_tamano: "bd_crecimiento" };

/** A partir de qué día del mes se proyecta a fin de mes (antes, un día raro lo dispara todo). */
const DIAS_MINIMOS_PROYECCION = 3;

const DIAS_ROJO = 7;
const DIAS_AMBAR = 30;

/** Días del mes (UTC) y días ya transcurridos (incluido hoy). */
function diasDelMes(hoy: Date): { total: number; pasados: number } {
  const total = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0)).getUTCDate();
  return { total, pasados: Math.max(1, hoy.getUTCDate()) };
}

/** Días que cubre una métrica de crecimiento: «+273 MB en 7 días», «últimos 7 días», «desde el 03/11/2026». */
export function diasDeCrecimiento(m: Pick<FilaMetrica, "nota" | "periodo"> | { nota?: string | null; periodo?: string | null }, hoy: Date = new Date()): number | null {
  const en = /en (\d+) días?/.exec(m.nota ?? "");
  if (en) return Number(en[1]) || null;
  const ultimos = /últimos (\d+) días/.exec(m.periodo ?? "");
  if (ultimos) return Number(ultimos[1]) || null;
  const desde = /desde el (\d{2})\/(\d{2})\/(\d{4})/.exec(m.periodo ?? "");
  if (desde) {
    const d = Math.round((hoy.getTime() - Date.UTC(Number(desde[3]), Number(desde[2]) - 1, Number(desde[1]))) / 86_400_000);
    return d > 0 ? d : null;
  }
  return null;
}

/** «Pro: 25,00 US$ al mes (≈ 22,36 €)», «Pago por uso» o null. */
export function textoSiguientePlan(s: Pick<ServicioContratado, "plan_siguiente" | "precio_siguiente" | "moneda">, eurPorUsd: number): string | null {
  const plan = s.plan_siguiente?.trim() || null;
  const precio = num(s.precio_siguiente);
  if (precio == null) return plan;
  const moneda = s.moneda || "EUR";
  const eur = moneda.toUpperCase() === "EUR" ? null : aEur(precio, moneda, eurPorUsd);
  const importe = precio === 0 ? "gratis" : `${formatearCantidad(precio, moneda)} al mes${eur == null ? "" : ` (≈ ${formatearEur(eur)})`}`;
  return plan ? `${plan}: ${importe}` : importe;
}

const RANGO: Record<NivelAvisoPlan, number> = { rojo: 0, ambar: 1, verde: 2, sin_dato: 3 };

/**
 * Los límites de los planes gratis (y de los que tienen plan siguiente
 * apuntado), uno por uno. Solo cuentan los límites del PLAN: los que tienen
 * página oficial (`fuente`); los topes propios del panel (recortes de fotos,
 * tope de IA) ya avisan en su tarjeta.
 *   · rojo: ya al 90 % o más, o se pasaría antes de fin de mes, o llegaría en 7 días o menos.
 *   · ámbar: al 70 % o más, previsto al 80 % o más, o llegaría en 30 días o menos.
 *   · verde: lejos del límite. · sin_dato: no hay lectura (se mira en su panel).
 */
export function avisosPlan(args: {
  servicios: ServicioContratado[];
  lecturas: Map<string, LecturaServicio>;
  eurPorUsd: number;
  hoy?: Date;
  /** Demo y previews: sin clave no es un fallo, las claves solo están en producción. */
  clavesSoloEnProduccion?: boolean;
}): AvisoPlan[] {
  const { servicios, lecturas, eurPorUsd, hoy = new Date(), clavesSoloEnProduccion = false } = args;
  const { total, pasados } = diasDelMes(hoy);
  const salida: AvisoPlan[] = [];
  for (const s of servicios) {
    if (s.activo === false) continue;
    if (s.ciclo !== "gratuito" && !s.plan_siguiente) continue;
    const lectura = lecturas.get(s.proveedor) ?? null;
    const filas = new Map(combinarMetricas(s, lectura).map((f) => [f.clave, f]));
    for (const [clave, limite] of Object.entries(s.limites ?? {})) {
      if (!limite?.fuente || num(limite.limite) == null) continue;
      const f = filas.get(clave);
      if (!f) continue;
      const base = {
        clave: `${s.proveedor}:${clave}`,
        proveedor: s.proveedor,
        servicio: sinAclaracion(s.nombre),
        metrica: clave,
        etiqueta: sinAclaracion(f.etiqueta),
        quePasaria: limite.si_se_pasa?.trim() || s.si_se_pasa?.trim() || null,
        siguientePlan: textoSiguientePlan(s, eurPorUsd),
        panelUrl: s.panel_url ?? null,
      };
      if (f.valor == null || f.porcentaje == null) {
        const sinClave = lectura?.error === "falta_secreto";
        salida.push({
          ...base, nivel: "sin_dato", porcentaje: null, textoValor: null, textoLimite: f.textoLimite, prevision: null,
          porcentajePrevisto: null, diasHastaLimite: null,
          motivoSinDato: sinClave
            ? clavesSoloEnProduccion ? "En la demo no se lee: la clave solo está en producción." : "Falta la clave para leerlo (en su tarjeta está cómo crearla)."
            : f.nota?.trim() || "Sin lectura automática: míralo en su panel.",
        });
        continue;
      }
      let prevision: string | null = null;
      let porcentajePrevisto: number | null = null;
      let diasHastaLimite: number | null = null;
      const periodo = f.periodo ?? "";
      if (/mes en curso|mes natural/i.test(periodo) && pasados >= DIAS_MINIMOS_PROYECCION && pasados < total) {
        const factor = total / pasados;
        porcentajePrevisto = f.porcentaje * factor;
        const valorPrevisto = f.valor * factor;
        // «3300 de 3000 correos» (como el resto de la pantalla): con la misma unidad, la cifra sola.
        const mismaUnidad = (f.unidad ?? "").trim().toLowerCase() === (f.unidadLimite ?? "").trim().toLowerCase()
          && !esUnidadBytes(f.unidad) && !/^(usd|eur|gbp)$/i.test((f.unidad ?? "").trim());
        const texto = mismaUnidad ? Math.round(valorPrevisto).toLocaleString("es-ES") : formatearCantidad(valorPrevisto, f.unidad, f.unidadLimite);
        prevision = `A este ritmo, a fin de mes: ${formatearPorcentaje(porcentajePrevisto)}${f.textoLimite ? ` (${texto} de ${f.textoLimite})` : ""}`;
      } else if (CRECIMIENTO_DE[clave] && f.limite != null) {
        const crec = lectura?.metricas?.[CRECIMIENTO_DE[clave]];
        const dias = crec ? diasDeCrecimiento(crec, hoy) : null;
        const bytesCrec = crec && typeof crec.valor === "number" && esUnidadBytes(crec.unidad) ? aBytes(crec.valor, crec.unidad) : null;
        const bytesAhora = esUnidadBytes(f.unidad) ? aBytes(f.valor, f.unidad) : null;
        const bytesLimite = f.unidadLimite && esUnidadBytes(f.unidadLimite) ? aBytes(f.limite, f.unidadLimite) : null;
        if (dias && bytesCrec != null && bytesAhora != null && bytesLimite != null) {
          const ritmo = `al ritmo de los últimos ${dias} día${dias === 1 ? "" : "s"} (${bytesCrec >= 0 ? "+" : "−"}${formatearBytes(Math.abs(bytesCrec))})`;
          if (bytesCrec <= 0) prevision = `${ritmo[0].toUpperCase()}${ritmo.slice(1)} no crece.`;
          else {
            diasHastaLimite = Math.max(0, Math.floor((bytesLimite - bytesAhora) / (bytesCrec / dias)));
            prevision = bytesAhora >= bytesLimite
              ? "Ya está en el límite."
              : diasHastaLimite > 365
                ? `${ritmo[0].toUpperCase()}${ritmo.slice(1)} tardaría más de un año en llegar al límite.`
                : `${ritmo[0].toUpperCase()}${ritmo.slice(1)}, llegaría al límite en ${diasHastaLimite <= 1 ? "1 día o menos" : `unos ${diasHastaLimite} días`}.`;
          }
        }
      }
      const p = f.porcentaje;
      const nivel: NivelAvisoPlan =
        p >= 90 || (porcentajePrevisto != null && porcentajePrevisto >= 100) || (diasHastaLimite != null && diasHastaLimite <= DIAS_ROJO)
          ? "rojo"
          : p >= 70 || (porcentajePrevisto != null && porcentajePrevisto >= 80) || (diasHastaLimite != null && diasHastaLimite <= DIAS_AMBAR)
            ? "ambar"
            : "verde";
      salida.push({
        ...base, nivel, porcentaje: p, textoValor: f.textoValor, textoLimite: f.textoLimite, prevision, porcentajePrevisto, diasHastaLimite, motivoSinDato: null,
      });
    }
  }
  // Dentro de cada color, lo más cerca primero: llegar en pocos días pesa más que un % alto a fin de mes.
  const urgencia = (x: AvisoPlan) =>
    Math.max(x.porcentaje ?? 0, x.porcentajePrevisto ?? 0, x.diasHastaLimite == null ? 0 : 100 + DIAS_AMBAR - Math.min(x.diasHastaLimite, DIAS_AMBAR));
  return salida.sort((a, b) => RANGO[a.nivel] - RANGO[b.nivel] || urgencia(b) - urgencia(a) || a.servicio.localeCompare(b.servicio, "es"));
}

/**
 * Para «Qué mirar» de Estado: los límites que se pasarían pronto al ritmo que
 * van pero que hoy están por debajo del 80 % (los de más ya salen por consumo).
 */
export function pendientesDePlan(avisos: AvisoPlan[]): Array<{ clave: string; gravedad: "rojo" | "ambar"; titulo: string; detalle: string | null }> {
  return avisos
    .filter((a) => (a.nivel === "rojo" || a.nivel === "ambar") && a.porcentaje != null && a.porcentaje < 80 && (a.diasHastaLimite != null || a.porcentajePrevisto != null))
    .map((a) => ({
      clave: `plan:${a.clave}`,
      gravedad: a.nivel as "rojo" | "ambar",
      titulo: `${a.servicio} · ${a.etiqueta}: ${
        a.diasHastaLimite != null
          ? `llegaría al límite del plan en ${a.diasHastaLimite <= 1 ? "1 día o menos" : `unos ${a.diasHastaLimite} días`}`
          : `a este ritmo, ${formatearPorcentaje(a.porcentajePrevisto as number)} a fin de mes`
      }`,
      detalle: a.quePasaria,
    }));
}

// ─── 3. IA, función por función ─────────────────────────────────────────────

/** Una fila de `ia_coste_por_uso(p_desde, p_hasta)`. */
export interface FilaCostePorUso {
  funcion: string;
  queHace: string | null;
  accion: string | null;
  unidad: string;
  orden: number;
  llamadas: number;
  usos: number;
  usosConCoste: number;
  /** Coste conocido (sin las filas de modelos sin tarifa). null = ninguna fila con coste. */
  costeUsd: number | null;
  filasSinTarifa: number;
  modelosSinTarifa: string[];
  /** Mediana del coste de un uso (de los que tienen coste). */
  medianaUsd: number | null;
  mediaUsd: number | null;
  /** Todo en nuestro servidor (pseudo-modelos «vercel:…»): no se paga a nadie por uso. */
  servidorPropio: boolean;
}

/** Normaliza lo que devuelve la RPC (numeric puede llegar como texto). */
export function normalizarCostePorUso(datos: unknown): FilaCostePorUso[] {
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null && typeof (f as { funcion?: unknown }).funcion === "string")
    .map((f) => ({
      funcion: String(f.funcion),
      queHace: typeof f.que_hace === "string" && f.que_hace.trim() ? f.que_hace.trim() : null,
      accion: typeof f.accion === "string" && f.accion.trim() ? f.accion.trim() : null,
      unidad: typeof f.unidad === "string" && f.unidad.trim() ? f.unidad.trim() : "llamada",
      orden: num(f.orden) ?? 999,
      llamadas: num(f.llamadas) ?? 0,
      usos: num(f.usos) ?? 0,
      usosConCoste: num(f.usos_con_coste) ?? 0,
      costeUsd: num(f.coste_usd),
      filasSinTarifa: num(f.filas_sin_tarifa) ?? 0,
      modelosSinTarifa: Array.isArray(f.modelos_sin_tarifa) ? f.modelos_sin_tarifa.filter((m): m is string => typeof m === "string") : [],
      medianaUsd: num(f.mediana_usd),
      mediaUsd: num(f.media_usd),
      servidorPropio: f.servidor_propio === true,
    }));
}

const PLURALES: Record<string, string> = {
  resumen: "resúmenes", petición: "peticiones", peticion: "peticiones", vino: "vinos", pregunta: "preguntas", documento: "documentos",
};

/** «documento» → «documentos», «petición» → «peticiones», «resumen» → «resúmenes». */
export function plural(unidad: string, n: number): string {
  if (n === 1) return unidad;
  if (PLURALES[unidad]) return PLURALES[unidad];
  if (/[aeiou]$/i.test(unidad)) return `${unidad}s`;
  if (/ón$/.test(unidad)) return `${unidad.slice(0, -2)}ones`;
  return `${unidad}es`;
}

const f1 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

/**
 * El coste de una cosa en palabras: «≈ 0,6 céntimos», «≈ 12 céntimos», «≈ 1,25 €»,
 * «gratis (en nuestro servidor)», «gratis», «sin datos». Los decimales crecen
 * al bajar el importe para que 0,05 céntimos no salga como 0.
 */
export function textoCosteUso(usd: number | null, eurPorUsd: number, servidorPropio = false): string {
  if (usd == null || !Number.isFinite(usd)) return "sin datos";
  if (usd <= 0) return servidorPropio ? "gratis (en nuestro servidor)" : "gratis";
  const eur = usd * eurPorUsd;
  if (eur >= 1) return `≈ ${f2.format(eur)} €`;
  const cent = eur * 100;
  if (cent < 0.01) return "menos de 0,01 céntimos";
  const texto = cent >= 10 ? f0.format(cent) : cent >= 0.1 ? f1.format(cent) : f2.format(cent);
  return `≈ ${texto} ${texto === "1" || texto === "1,0" ? "céntimo" : "céntimos"}`;
}

export interface TotalesIa {
  costeUsd: number;
  llamadas: number;
  usos: number;
  filasSinTarifa: number;
  modelosSinTarifa: string[];
}

export function totalesIa(filas: FilaCostePorUso[]): TotalesIa {
  return {
    costeUsd: filas.reduce((t, f) => t + (f.costeUsd ?? 0), 0),
    llamadas: filas.reduce((t, f) => t + f.llamadas, 0),
    usos: filas.reduce((t, f) => t + f.usos, 0),
    filasSinTarifa: filas.reduce((t, f) => t + f.filasSinTarifa, 0),
    modelosSinTarifa: [...new Set(filas.flatMap((f) => f.modelosSinTarifa))].sort(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Este mes (del 1 a hoy) y el anterior entero, en días locales (`mes`: «AAAA-MM-01»). */
export function ventanasIa(hoy: Date) {
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const primeroAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const ultimoAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return {
    actual: { desde: isoLocal(primero), hasta: isoLocal(hoy), mes: isoLocal(primero) },
    anterior: { desde: isoLocal(primeroAnterior), hasta: isoLocal(ultimoAnterior), mes: isoLocal(primeroAnterior) },
  };
}

/** Un mes entero («AAAA-MM-01» → del 1 al último día). */
export function ventanaMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split("-").map(Number);
  return { desde: `${a}-${pad2(m)}-01`, hasta: isoLocal(new Date(a, m, 0)) };
}

// ─── 4. Cuánto cuesta cada cosa ─────────────────────────────────────────────

/** Las cuatro que pidió el dueño: salen siempre, aunque este mes no se hayan usado. */
export const ACCIONES_PEDIDAS: ReadonlyArray<{ funcion: string; accion: string }> = [
  { funcion: "ocr-trabajo", accion: "Leer una factura" },
  { funcion: "extraer-vino-foto", accion: "Leer la etiqueta de un vino" },
  { funcion: "traducir-contenido", accion: "Traducir un plato" },
  { funcion: "recortar-foto", accion: "Recortar una foto" },
];

export interface CosteAccion {
  funcion: string;
  accion: string;
  /** «≈ 0,6 céntimos», «gratis (en nuestro servidor)», «sin usos todavía». */
  texto: string;
  /** «mediana de 316 documentos de noviembre de 2026». */
  detalle: string | null;
  medianaUsd: number | null;
  /** La cifra es del mes anterior (este mes aún no se ha usado). */
  delMesAnterior: boolean;
  sinDatos: boolean;
}

/**
 * Una línea por acción con la mediana del coste de un uso: las cuatro pedidas
 * siempre (si este mes no se han usado, con el mes anterior; si tampoco, «sin
 * usos todavía») y, después, las demás funciones con acción que se han usado.
 */
export function costesPorAccion(args: {
  actual: FilaCostePorUso[];
  anterior?: FilaCostePorUso[] | null;
  eurPorUsd: number;
  /** «noviembre de 2026», «octubre de 2026». */
  textoMes: string;
  textoMesAnterior: string;
}): CosteAccion[] {
  const { actual, anterior = null, eurPorUsd, textoMes, textoMesAnterior } = args;
  const de = (lista: FilaCostePorUso[] | null, funcion: string) => lista?.find((f) => f.funcion === funcion && f.usosConCoste > 0) ?? null;
  const linea = (funcion: string, accion: string): CosteAccion => {
    const ahora = de(actual, funcion);
    const antes = ahora ? null : de(anterior, funcion);
    const fila = ahora ?? antes;
    if (!fila) return { funcion, accion, texto: "sin usos todavía", detalle: null, medianaUsd: null, delMesAnterior: false, sinDatos: true };
    const n = fila.usosConCoste;
    return {
      funcion,
      accion: fila.accion ?? accion,
      texto: textoCosteUso(fila.medianaUsd, eurPorUsd, fila.servidorPropio),
      detalle: `${n === 1 ? "1" : "mediana de"} ${n === 1 ? "" : `${n.toLocaleString("es-ES")} `}${plural(fila.unidad, n)} de ${ahora ? textoMes : textoMesAnterior}`.replace(/\s+/g, " "),
      medianaUsd: fila.medianaUsd,
      delMesAnterior: !ahora,
      sinDatos: false,
    };
  };
  const pedidas = ACCIONES_PEDIDAS.map((p) => linea(p.funcion, p.accion));
  const vistas = new Set(ACCIONES_PEDIDAS.map((p) => p.funcion));
  const resto = actual
    .filter((f) => f.accion && !vistas.has(f.funcion) && f.usosConCoste > 0)
    .sort((a, b) => a.orden - b.orden || a.funcion.localeCompare(b.funcion))
    .map((f) => linea(f.funcion, f.accion as string));
  return [...pedidas, ...resto];
}

// ─── 1b. «Confirmar precio» ─────────────────────────────────────────────────

export interface BorradorPrecio {
  plan: string;
  ciclo: string;
  /** Al mes (o al año con ciclo «anual»). */
  precio: string;
  moneda: string;
  fuente_precio: string;
}

export const borradorPrecioDe = (s: ServicioContratado): BorradorPrecio => {
  const anual = s.ciclo === "anual";
  const n = anual ? (s.precio_anual ?? (s.precio_mensual == null ? null : Math.round(s.precio_mensual * 12 * 100) / 100)) : s.precio_mensual;
  return {
    plan: (s.plan ?? "").replace(/\s*\(por confirmar\)\s*$/i, "").replace(/^por confirmar$/i, ""),
    ciclo: s.ciclo || "mensual",
    precio: n == null ? "" : String(n).replace(".", ","),
    moneda: s.moneda || "EUR",
    fuente_precio: s.fuente_precio ?? "",
  };
};

export type ResultadoConfirmar =
  | { ok: true; cambios: Pick<ServicioContratado, "plan" | "ciclo" | "precio_mensual" | "precio_anual" | "moneda" | "fuente_precio" | "por_confirmar" | "precio_confirmado_en"> }
  | { ok: false; errores: Record<string, string> };

/** «1.000», «19,99» → número; vacío → null; otra cosa → NaN. */
function leerImporte(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!t) return null;
  const normal = /,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

/**
 * Valida «Confirmar precio» y lo convierte en cambios: el plan y la forma de
 * pago, el precio (obligatorio si se paga cada mes o cada año; gratis = 0),
 * la página oficial, «por confirmar» fuera y hoy como día de la confirmación.
 */
export function cambiosConfirmarPrecio(b: BorradorPrecio, hoy: string): ResultadoConfirmar {
  const errores: Record<string, string> = {};
  const plan = b.plan.trim();
  if (!plan) errores.plan = "Escribe el plan (por ejemplo Free, Pro o Hobby).";
  if (plan.length > 80) errores.plan = "Máximo 80 letras.";
  if (!["gratuito", "mensual", "anual", "por_uso"].includes(b.ciclo)) errores.ciclo = "Elige la forma de pago.";
  const anual = b.ciclo === "anual";
  const precio = leerImporte(b.precio);
  if (precio != null && (Number.isNaN(precio) || precio > (anual ? 1000000 : 100000))) errores.precio = "Escribe un importe (por ejemplo 20 o 19,99).";
  else if (precio == null && (b.ciclo === "mensual" || anual)) errores.precio = anual ? "Escribe lo que se paga al año." : "Escribe lo que se paga al mes.";
  if (!/^[A-Z]{3}$/.test(b.moneda)) errores.moneda = "Elige la moneda.";
  const fuente = b.fuente_precio.trim();
  if (fuente && (!/^https:\/\/\S+$/.test(fuente) || fuente.length > 500)) errores.fuente_precio = "El enlace tiene que empezar por https://";
  if (Object.keys(errores).length) return { ok: false, errores };
  return {
    ok: true,
    cambios: {
      plan,
      ciclo: b.ciclo,
      precio_mensual: anual ? null : b.ciclo === "gratuito" ? (precio ?? 0) : precio,
      precio_anual: anual ? precio : null,
      moneda: b.moneda,
      fuente_precio: fuente || null,
      por_confirmar: false,
      precio_confirmado_en: hoy,
    },
  };
}
