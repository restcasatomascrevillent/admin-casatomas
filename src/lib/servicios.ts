/**
 * Super Admin › Servicios: tipos y cuentas de la pantalla (sin React).
 *
 * Datos: `servicios_contratados` (plan, precio, límites; lo edita el dueño),
 * `servicios_config` (tipo de cambio) y las lecturas de la Edge Function
 * `servicios-uso` (consumo y coste variable; tabla `servicios_uso`). Ver
 * supabase/migrations/20261103120000_servicios_contratados.sql,
 * 20261103160000_servicios_planes_costes.sql y
 * 20261104121000_servicios_configurables.sql (altas y borrado de lo quitado).
 *
 * Semáforo (petición del dueño): verde < 70 %, ámbar de 70 a 90 %, rojo > 90 %.
 * Aviso destacado arriba de la pantalla a partir del 80 %.
 */

export type Semaforo = "verde" | "ambar" | "rojo";

export interface LimitePlan {
  etiqueta?: string;
  /** null = «sin dato». Ausente con `limite_desde`: lo pone la lectura (p. ej. el tope de IA de Costes). */
  limite?: number | null;
  /** De dónde sale el límite cuando no se edita aquí. */
  limite_desde?: string;
  unidad?: string;
  periodo?: string;
  fuente?: string;
  nota?: string;
  orden?: number;
}

export type Categoria =
  | "alojamiento" | "base_datos" | "codigo" | "correo" | "pagos" | "ia" | "telefonia" | "mapas" | "archivos" | "dominio" | "otros";

export interface ServicioContratado {
  proveedor: string;
  nombre: string;
  plan: string | null;
  precio_mensual: number | null;
  moneda: string;
  ciclo: "mensual" | "anual" | "gratuito" | "por_uso" | string;
  renovacion: string | null;
  cuenta: string | null;
  panel_url: string | null;
  limites: Record<string, LimitePlan>;
  notas: string | null;
  actualizado_en: string;
  // 20261103160000 (sin ella, `cargarServicios` pone los valores por defecto).
  categoria: Categoria | string;
  orden: number;
  /** «Lo usamos»: si no, ni se lee ni suma al coste. */
  activo: boolean;
  /** Plan y precio sin comprobar. */
  por_confirmar: boolean;
  /** Lo que se paga al año (ciclo «anual»). */
  precio_anual: number | null;
  fuente_precio: string | null;
}

/** Lo gastado por uso en el periodo de la lectura, en su moneda original. */
export interface CosteVariable {
  importe: number;
  moneda: string;
  periodo?: string;
  origen?: "api" | "bd" | "estimado" | string;
  nota?: string;
}

export interface MetricaLeida {
  etiqueta?: string;
  valor: number | null;
  unidad: string;
  limite?: number | null;
  unidad_limite?: string;
  periodo?: string;
  nota?: string;
  orden?: number;
}

export interface LecturaServicio {
  proveedor: string;
  tomado_en: string;
  metricas: Record<string, MetricaLeida>;
  error: string | null;
  secreto?: string;
  detalles: Record<string, unknown>;
  coste_variable?: CosteVariable | null;
  desde_cache?: boolean;
  guardada?: boolean;
}

export const UMBRAL_AMBAR = 70;
export const UMBRAL_ROJO = 90;
/** A partir de aquí la métrica sale en el aviso de arriba de la pantalla. */
export const UMBRAL_AVISO = 80;

/** verde < 70 %, ámbar 70–90 %, rojo > 90 %. */
export function semaforo(porcentaje: number): Semaforo {
  if (porcentaje > UMBRAL_ROJO) return "rojo";
  if (porcentaje >= UMBRAL_AMBAR) return "ambar";
  return "verde";
}

export const TEXTO_SEMAFORO: Record<Semaforo, string> = {
  verde: "Bien",
  ambar: "Cerca del límite",
  rojo: "Al límite",
};

const BYTES: Record<string, number> = { b: 1, byte: 1, bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
const MONEDAS = new Set(["USD", "EUR", "GBP"]);

const norm = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();
export const esUnidadBytes = (u: string | null | undefined) => norm(u) in BYTES;

const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Valor en bytes (si la unidad es de tamaño). */
export function aBytes(valor: number, unidad: string): number | null {
  const f = BYTES[norm(unidad)];
  return f ? valor * f : null;
}

const fmt = (n: number, decimales = 2) => n.toLocaleString("es-ES", { maximumFractionDigits: decimales });

/** Tamaño legible: en la unidad pedida (la del límite) o en la mayor que dé ≥ 1. */
export function formatearBytes(bytes: number, unidadPreferida?: string | null): string {
  const pref = norm(unidadPreferida);
  if (pref && BYTES[pref] && pref !== "byte" && pref !== "bytes") return `${fmt(bytes / BYTES[pref])} ${pref.toUpperCase()}`;
  for (const u of ["tb", "gb", "mb", "kb"]) if (bytes >= BYTES[u]) return `${fmt(bytes / BYTES[u])} ${u.toUpperCase()}`;
  return `${fmt(bytes, 0)} B`;
}

/** «7,00 US$», «75,00 €», «3600 peticiones», «48,29 MB». */
export function formatearCantidad(valor: number, unidad: string, unidadBytes?: string | null): string {
  if (esUnidadBytes(unidad)) {
    const b = aBytes(valor, unidad) ?? valor;
    return formatearBytes(b, unidadBytes && esUnidadBytes(unidadBytes) ? unidadBytes : null);
  }
  const u = unidad.trim();
  if (MONEDAS.has(u.toUpperCase())) {
    return valor.toLocaleString("es-ES", { style: "currency", currency: u.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return u ? `${fmt(valor)} ${u}` : fmt(valor);
}

export function formatearPorcentaje(p: number): string {
  // Espacio fino irrompible: la cifra y el «%» nunca se separan de línea.
  if (p > 0 && p < 1) return "menos del 1\u00a0%";
  return `${fmt(p, p < 10 ? 1 : 0)}\u00a0%`;
}

export interface FilaMetrica {
  clave: string;
  etiqueta: string;
  valor: number | null;
  unidad: string;
  limite: number | null;
  unidadLimite: string | null;
  porcentaje: number | null;
  semaforo: Semaforo | null;
  textoValor: string | null;
  textoLimite: string | null;
  periodo: string | null;
  nota: string | null;
  fuente: string | null;
  orden: number;
}

/**
 * Une los límites del plan (lo que el dueño ve y edita) con la última lectura.
 * El límite vigente es el de `servicios_contratados` (si el dueño lo ha
 * borrado, no hay barra); la lectura solo aporta el suyo si la tabla no tiene
 * esa métrica. Las métricas sin límite salen como dato informativo.
 */
export function combinarMetricas(servicio: Pick<ServicioContratado, "limites"> | null, lectura: Pick<LecturaServicio, "metricas"> | null): FilaMetrica[] {
  const limites = servicio?.limites ?? {};
  const metricas = lectura?.metricas ?? {};
  const claves = [...new Set([...Object.keys(limites), ...Object.keys(metricas)])];
  return claves
    .map((clave): FilaMetrica => {
      const l = limites[clave];
      const m = metricas[clave];
      const valor = numero(m?.valor);
      const unidad = m?.unidad ?? l?.unidad ?? "";
      const limite = l && "limite" in l ? numero(l.limite) : numero(m?.limite);
      const unidadLimite = (l?.unidad || m?.unidad_limite || m?.unidad || null) ?? null;
      let porcentaje: number | null = null;
      if (valor != null && limite != null && limite > 0) {
        if (esUnidadBytes(unidad) && esUnidadBytes(unidadLimite)) {
          porcentaje = ((aBytes(valor, unidad) ?? 0) / (aBytes(limite, unidadLimite ?? "") ?? 1)) * 100;
        } else if (norm(unidad) === norm(unidadLimite)) {
          porcentaje = (valor / limite) * 100;
        }
      }
      return {
        clave,
        etiqueta: l?.etiqueta || m?.etiqueta || clave,
        valor,
        unidad,
        limite,
        unidadLimite,
        porcentaje,
        semaforo: porcentaje == null ? null : semaforo(porcentaje),
        // «3 de 50.000 usuarios»: con la misma unidad (y sin ser tamaño ni moneda) solo se dice al final.
        textoValor: valor == null
          ? null
          : limite != null && norm(unidad) === norm(unidadLimite) && !esUnidadBytes(unidad) && !MONEDAS.has(unidad.trim().toUpperCase())
            ? fmt(valor)
            : formatearCantidad(valor, unidad, unidadLimite),
        textoLimite: limite == null ? null : formatearCantidad(limite, unidadLimite ?? unidad),
        periodo: m?.periodo || l?.periodo || null,
        nota: m?.nota || l?.nota || null,
        fuente: l?.fuente || null,
        orden: numero(l?.orden) ?? numero(m?.orden) ?? 99,
      };
    })
    .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, "es"));
}

/** El peor semáforo de un servicio (para el resumen de la tarjeta). */
export function peorSemaforo(filas: FilaMetrica[]): Semaforo | null {
  const orden: Semaforo[] = ["rojo", "ambar", "verde"];
  for (const s of orden) if (filas.some((f) => f.semaforo === s)) return s;
  return null;
}

/** «hace 3 min», «hace 2 h», «el 01/11 a las 09:30». */
export function haceCuanto(iso: string | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return "nunca";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "fecha desconocida";
  const min = Math.round((ahora.getTime() - t) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `el ${dd}/${mm} a las ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const TEXTO_CICLO: Record<string, string> = {
  mensual: "mensual",
  anual: "anual",
  gratuito: "gratis",
  por_uso: "según uso",
};

type PrecioServicio = Pick<ServicioContratado, "precio_mensual" | "moneda" | "ciclo"> & Partial<Pick<ServicioContratado, "precio_anual">>;

/** «Gratis», «20,00 US$ al mes», «14,99 € al año», «Pago por uso». */
export function textoPrecio(s: PrecioServicio): string {
  if (s.ciclo === "por_uso" && (s.precio_mensual == null || s.precio_mensual === 0)) return "Pago por uso";
  if (s.ciclo === "anual" && s.precio_anual != null) {
    return s.precio_anual === 0 ? "Gratis" : `${formatearCantidad(s.precio_anual, s.moneda)} al año`;
  }
  if (s.ciclo === "gratuito" && !s.precio_mensual) return "Gratis";
  if (s.precio_mensual == null) return "Precio sin dato";
  if (s.precio_mensual === 0) return "Gratis";
  const importe = formatearCantidad(s.precio_mensual, s.moneda);
  return `${importe} al mes${s.ciclo === "anual" ? " (pago anual)" : ""}`;
}

// ─── coste (en euros) ───────────────────────────────────────────────────────

export const CAMBIO_POR_DEFECTO = 0.92;

/** Importe en euros: EUR tal cual, USD con el tipo de cambio; otra moneda, null. */
export function aEur(importe: number, moneda: string, eurPorUsd: number): number | null {
  const m = (moneda ?? "").trim().toUpperCase();
  if (m === "EUR") return importe;
  if (m === "USD") return importe * eurPorUsd;
  return null;
}

export interface Importe {
  importe: number;
  moneda: string;
}

/**
 * Cuota fija al mes en su moneda: gratis → 0; mensual → precio_mensual;
 * anual → precio_anual / 12 (o el precio al mes de antes); según uso → la
 * cuota si la hay (normalmente 0: lo demás es coste variable). null = sin dato.
 */
export function cuotaMensual(s: PrecioServicio): Importe | null {
  const moneda = s.moneda || "EUR";
  if (s.ciclo === "gratuito") return { importe: s.precio_mensual ?? 0, moneda };
  if (s.ciclo === "anual") {
    if (s.precio_anual != null) return { importe: s.precio_anual / 12, moneda };
    return s.precio_mensual == null ? null : { importe: s.precio_mensual, moneda };
  }
  if (s.ciclo === "por_uso") return { importe: s.precio_mensual ?? 0, moneda };
  return s.precio_mensual == null ? null : { importe: s.precio_mensual, moneda };
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** Coste variable de la lectura, si es un importe válido. */
export function costeVariableDe(lectura: Pick<LecturaServicio, "coste_variable"> | null | undefined): CosteVariable | null {
  const c = lectura?.coste_variable;
  return c && typeof c.importe === "number" && Number.isFinite(c.importe) && typeof c.moneda === "string" ? c : null;
}

export interface FilaCoste {
  proveedor: string;
  nombre: string;
  categoria: string;
  /** Cuota fija del mes en euros (null = precio sin dato). */
  fijoEur: number | null;
  /** Lo gastado por uso este mes en euros (0 si no se mide). */
  variableEur: number;
  totalEur: number;
  /** Importes originales (para enseñar «20,00 US$ ≈ 17,88 €»). */
  fijo: Importe | null;
  variable: CosteVariable | null;
  porConfirmar: boolean;
  /** La cuota o el variable está en una moneda que no se sabe pasar a euros. */
  monedaDesconocida: boolean;
}

export interface ResumenCostes {
  filas: FilaCoste[];
  fijoMesEur: number;
  variableMesEur: number;
  totalMesEur: number;
  /** Cuotas + el variable al ritmo de los días que van de mes (orientativo). */
  previsionMesEur: number;
  /** Cuotas × 12 + el variable al ritmo de este mes × 12 (orientativo). */
  previsionAnioEur: number;
  /** Cuotas × 12. */
  fijoAnioEur: number;
  /** Servicios en uso sin precio (o por confirmar): el total puede quedarse corto. */
  sinPrecio: string[];
  porConfirmar: string[];
  hayUsd: boolean;
}

/** Días del mes (UTC) y días ya transcurridos (incluido hoy). */
function diasDelMes(hoy: Date): { total: number; pasados: number } {
  const total = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0)).getUTCDate();
  return { total, pasados: Math.max(1, hoy.getUTCDate()) };
}

/**
 * Coste de los servicios EN USO: cuota fija al mes, lo gastado por uso este
 * mes (de las lecturas) y la previsión del año. Todo en euros con `eurPorUsd`.
 */
export function resumirCostes(
  servicios: ServicioContratado[],
  lecturas: Map<string, Pick<LecturaServicio, "coste_variable">> | Record<string, Pick<LecturaServicio, "coste_variable">>,
  eurPorUsd: number,
  hoy: Date = new Date(),
): ResumenCostes {
  const leer = (p: string) => (lecturas instanceof Map ? lecturas.get(p) : lecturas[p]) ?? null;
  const filas: FilaCoste[] = [];
  const sinPrecio: string[] = [];
  const porConfirmar: string[] = [];
  let hayUsd = false;
  for (const s of servicios) {
    if (s.activo === false) continue;
    const fijo = cuotaMensual(s);
    const variable = costeVariableDe(leer(s.proveedor));
    const fijoEur = fijo ? aEur(fijo.importe, fijo.moneda, eurPorUsd) : null;
    const variableEurBruto = variable ? aEur(variable.importe, variable.moneda, eurPorUsd) : 0;
    if (fijo?.moneda.toUpperCase() === "USD" || variable?.moneda.toUpperCase() === "USD") hayUsd = true;
    if (!fijo) sinPrecio.push(s.nombre);
    if (s.por_confirmar) porConfirmar.push(s.nombre);
    const variableEur = variableEurBruto ?? 0;
    filas.push({
      proveedor: s.proveedor,
      nombre: s.nombre,
      categoria: s.categoria,
      fijoEur: fijoEur == null ? null : redondear2(fijoEur),
      variableEur: redondear2(variableEur),
      totalEur: redondear2((fijoEur ?? 0) + variableEur),
      fijo,
      variable,
      porConfirmar: !!s.por_confirmar,
      monedaDesconocida: (fijo != null && fijoEur == null) || (variable != null && variableEurBruto == null),
    });
  }
  filas.sort((a, b) => b.totalEur - a.totalEur || a.nombre.localeCompare(b.nombre, "es"));
  const fijoMesEur = redondear2(filas.reduce((t, f) => t + (f.fijoEur ?? 0), 0));
  const variableMesEur = redondear2(filas.reduce((t, f) => t + f.variableEur, 0));
  const { total, pasados } = diasDelMes(hoy);
  const variableMesCompleto = variableMesEur * (total / pasados);
  return {
    filas,
    fijoMesEur,
    variableMesEur,
    totalMesEur: redondear2(fijoMesEur + variableMesEur),
    previsionMesEur: redondear2(fijoMesEur + variableMesCompleto),
    fijoAnioEur: redondear2(fijoMesEur * 12),
    previsionAnioEur: redondear2((fijoMesEur + variableMesCompleto) * 12),
    sinPrecio,
    porConfirmar,
    hayUsd,
  };
}

/** «17,88 €». */
export const formatearEur = (n: number) => formatearCantidad(n, "EUR");

/** «20,00 US$ (≈ 17,88 €)» o «12,00 €». */
export function textoImporteConEur(i: Importe, eurPorUsd: number): string {
  const original = formatearCantidad(i.importe, i.moneda);
  if (i.moneda.toUpperCase() === "EUR") return original;
  const eur = aEur(i.importe, i.moneda, eurPorUsd);
  return eur == null ? original : `${original} (≈ ${formatearEur(eur)})`;
}

// ─── avisos de consumo (≥ 80 %) ─────────────────────────────────────────────

export interface AvisoConsumo {
  proveedor: string;
  nombre: string;
  clave: string;
  etiqueta: string;
  porcentaje: number;
  semaforo: Semaforo;
  textoValor: string | null;
  textoLimite: string | null;
}

/** Métricas de los servicios en uso a partir del 80 % de su límite, de mayor a menor. */
export function avisosConsumo(
  servicios: ServicioContratado[],
  lecturas: Map<string, LecturaServicio>,
  umbral: number = UMBRAL_AVISO,
): AvisoConsumo[] {
  const avisos: AvisoConsumo[] = [];
  for (const s of servicios) {
    if (s.activo === false) continue;
    for (const f of combinarMetricas(s, lecturas.get(s.proveedor) ?? null)) {
      if (f.porcentaje != null && f.semaforo && f.porcentaje >= umbral) {
        avisos.push({
          proveedor: s.proveedor, nombre: s.nombre, clave: f.clave, etiqueta: f.etiqueta, porcentaje: f.porcentaje,
          semaforo: f.semaforo, textoValor: f.textoValor, textoLimite: f.textoLimite,
        });
      }
    }
  }
  return avisos.sort((a, b) => b.porcentaje - a.porcentaje);
}

// ─── próximas renovaciones y caducidad de dominios ──────────────────────────

export interface Renovacion {
  proveedor: string;
  nombre: string;
  /** «Renovación del plan», «Dominio x.es», «Suscripción Premium…». */
  concepto: string;
  /** AAAA-MM-DD. */
  fecha: string;
  dias: number;
  /** Según la API del proveedor (no lo escribió el dueño). */
  deLaApi: boolean;
}

const fechaIso = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const diasHasta = (iso: string, hoy: Date) => {
  const inicioHoy = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - inicioHoy) / 86_400_000);
};

/**
 * Renovaciones de los servicios en uso: la fecha que guarda el dueño
 * («Próxima renovación») y lo que dice la API (dominios y suscripciones de
 * Hostinger). De la más cercana a la más lejana; las ya pasadas, también (el
 * dueño tiene que poner la nueva fecha).
 */
export function proximasRenovaciones(servicios: ServicioContratado[], lecturas: Map<string, LecturaServicio>, hoy: Date = new Date()): Renovacion[] {
  const salida: Renovacion[] = [];
  const vistas = new Set<string>();
  const anadir = (r: Omit<Renovacion, "dias">) => {
    const clave = `${r.proveedor}|${r.concepto}|${r.fecha}`;
    if (vistas.has(clave)) return;
    vistas.add(clave);
    salida.push({ ...r, dias: diasHasta(r.fecha, hoy) });
  };
  for (const s of servicios) {
    if (s.activo === false) continue;
    const f = fechaIso(s.renovacion);
    if (f) anadir({ proveedor: s.proveedor, nombre: s.nombre, concepto: s.categoria === "dominio" ? "Renovación (dominio o plan)" : "Renovación del plan", fecha: f, deLaApi: false });
    const d = lecturas.get(s.proveedor)?.detalles ?? {};
    for (const x of Array.isArray(d.dominios) ? d.dominios : []) {
      const dominio = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
      const caduca = fechaIso(dominio?.caduca);
      if (dominio && caduca && typeof dominio.dominio === "string" && (dominio.estado ?? "active") === "active") {
        anadir({ proveedor: s.proveedor, nombre: s.nombre, concepto: `Dominio ${dominio.dominio}`, fecha: caduca, deLaApi: true });
      }
    }
    for (const x of Array.isArray(d.suscripciones) ? d.suscripciones : []) {
      const sub = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
      const fecha = fechaIso(sub?.proxima_factura) ?? fechaIso(sub?.caduca);
      if (sub && fecha && sub.estado === "active") {
        anadir({ proveedor: s.proveedor, nombre: s.nombre, concepto: `Suscripción ${String(sub.nombre ?? "")}`.trim(), fecha, deLaApi: true });
      }
    }
  }
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre, "es"));
}

/** «hoy», «mañana», «en 12 días», «hace 3 días». */
export function textoDias(dias: number): string {
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  if (dias === -1) return "ayer";
  return dias > 0 ? `en ${dias.toLocaleString("es-ES")} días` : `hace ${(-dias).toLocaleString("es-ES")} días`;
}

// ─── Lo que requiere atención (pestaña Estado, «Qué mirar») ─────────────────

/** Con 30 días o menos (o ya pasada) la renovación se marca y pide atención. */
export const DIAS_RENOVACION_CERCANA = 30;

export type GravedadPendiente = "rojo" | "ambar" | "info";

/** A dónde lleva «Ver» de un pendiente: una pestaña y, si es de un servicio, su tarjeta. */
export interface DestinoPendiente {
  pestana: "servicios" | "costes" | "configurar";
  proveedor?: string;
}

export interface Pendiente {
  clave: string;
  gravedad: GravedadPendiente;
  titulo: string;
  detalle: string | null;
  destino: DestinoPendiente;
  /** Texto del botón («Ver», «Revisar»…). */
  accion: string;
}

const ORDEN_GRAVEDAD: Record<GravedadPendiente, number> = { rojo: 0, ambar: 1, info: 2 };

const nombres = (lista: string[]) => (lista.length <= 3 ? lista.join(", ") : `${lista.slice(0, 3).join(", ")} y ${lista.length - 3} más`);

/**
 * «Qué mirar» de la pestaña Estado: lo que el dueño tiene que hacer algo,
 * de lo más grave a lo menos. Consumos a partir del 80 %, renovaciones
 * pasadas o en 30 días, claves que faltan o el proveedor rechaza, avisos de
 * la IA (funciones que no registran su gasto, modelos sin tarifa) y planes o
 * precios por confirmar. Solo servicios en uso.
 */
export function pendientesServicios(args: {
  servicios: ServicioContratado[];
  lecturas: Map<string, LecturaServicio>;
  renovaciones: Renovacion[];
  resumen: Pick<ResumenCostes, "sinPrecio" | "porConfirmar">;
  /** Proveedores sin lectura automática (no se les pide clave). */
  sinLector?: Set<string>;
  ia?: { sinRegistro: number; modelosSinTarifa: number } | null;
  /** Costes de meses ya cerrados (o precios) que faltan por meter (Costes › «Costes por meter»). */
  costesPorMeter?: number;
}): Pendiente[] {
  const { servicios, lecturas, renovaciones, resumen, sinLector = new Set<string>(), ia, costesPorMeter = 0 } = args;
  const enUso = servicios.filter((s) => s.activo !== false);
  const salida: Pendiente[] = [];

  // Una línea por servicio (09/11/2026: GitHub salía dos veces, minutos y dólares, con el mismo
  // exceso, y el contador de la pestaña no cuadraba con el titular): la métrica más alta y cuántas más.
  const porServicio = new Map<string, AvisoConsumo[]>();
  for (const a of avisosConsumo(enUso, lecturas)) porServicio.set(a.proveedor, [...(porServicio.get(a.proveedor) ?? []), a]);
  for (const [proveedor, lista] of porServicio) {
    const [a] = lista; // de mayor a menor
    const mas = lista.length - 1;
    salida.push({
      clave: `consumo:${proveedor}:${a.clave}`,
      gravedad: lista.some((x) => x.semaforo === "rojo") ? "rojo" : "ambar",
      titulo: `${a.nombre} · ${a.etiqueta}${mas > 0 ? ` y ${mas} más` : ""}`,
      detalle: `${formatearPorcentaje(a.porcentaje)} del límite${a.textoValor && a.textoLimite ? ` (${a.textoValor} de ${a.textoLimite})` : ""}`,
      destino: { pestana: "servicios", proveedor },
      accion: "Ver",
    });
  }

  for (const r of renovaciones) {
    if (r.dias > DIAS_RENOVACION_CERCANA) continue;
    salida.push({
      clave: `renovacion:${r.proveedor}:${r.concepto}:${r.fecha}`,
      gravedad: r.dias < 0 ? "rojo" : "ambar",
      titulo: `${r.nombre} · ${r.concepto}`,
      detalle: r.dias < 0
        ? `Pasó ${textoDias(r.dias)} (${fechaCorta(r.fecha)})${r.deLaApi ? "" : ": apunta la nueva fecha"}`
        : `Se renueva ${textoDias(r.dias)} (${fechaCorta(r.fecha)})`,
      destino: { pestana: "servicios", proveedor: r.proveedor },
      accion: "Ver",
    });
  }

  // Claves y errores de lectura: uno por tipo, con los servicios afectados.
  const porError = new Map<string, ServicioContratado[]>();
  for (const s of enUso) {
    const e = lecturas.get(s.proveedor)?.error;
    if (!e || sinLector.has(s.proveedor)) continue;
    const tipo = e === "falta_secreto" || e === "credencial_rechazada" ? e : "lectura";
    porError.set(tipo, [...(porError.get(tipo) ?? []), s]);
  }
  const TEXTO_PENDIENTE_ERROR: Record<string, { gravedad: GravedadPendiente; uno: string; varios: string; detalle: string }> = {
    credencial_rechazada: { gravedad: "rojo", uno: "rechaza la clave guardada", varios: "rechazan la clave guardada", detalle: "No es válida, ha caducado o le faltan permisos: hay que crear otra." },
    falta_secreto: { gravedad: "ambar", uno: "falta configurar la clave", varios: "falta configurar la clave", detalle: "Sin ella no se lee el consumo. En su tarjeta está cómo crearla." },
    lectura: { gravedad: "ambar", uno: "no se pudieron leer los datos", varios: "no se pudieron leer los datos", detalle: "Se volverá a intentar en la próxima lectura." },
  };
  for (const tipo of ["credencial_rechazada", "falta_secreto", "lectura"]) {
    const lista = porError.get(tipo);
    if (!lista?.length) continue;
    const t = TEXTO_PENDIENTE_ERROR[tipo];
    salida.push({
      clave: `error:${tipo}`,
      gravedad: t.gravedad,
      titulo: lista.length === 1 ? `${lista[0].nombre}: ${t.uno}` : `${nombres(lista.map((s) => s.nombre))}: ${t.varios}`,
      detalle: t.detalle,
      destino: { pestana: "servicios", proveedor: lista.length === 1 ? lista[0].proveedor : undefined },
      accion: "Ver",
    });
  }

  if (ia && ia.sinRegistro > 0) {
    salida.push({
      clave: "ia:sin-registro",
      gravedad: "ambar",
      titulo: ia.sinRegistro === 1 ? "Una función de IA no registra su gasto" : `${ia.sinRegistro} funciones de IA no registran su gasto`,
      detalle: "El coste de la IA por proceso puede quedarse corto.",
      destino: { pestana: "costes" },
      accion: "Ver en Costes",
    });
  }
  if (ia && ia.modelosSinTarifa > 0) {
    salida.push({
      clave: "ia:sin-tarifa",
      gravedad: "ambar",
      titulo: ia.modelosSinTarifa === 1 ? "Un modelo de IA no tiene tarifa" : `${ia.modelosSinTarifa} modelos de IA no tienen tarifa`,
      detalle: "Su coste sale como «sin datos» y no suma.",
      destino: { pestana: "costes" },
      accion: "Ver en Costes",
    });
  }

  if (costesPorMeter > 0) {
    salida.push({
      clave: "costes:por-meter",
      gravedad: "ambar",
      titulo: costesPorMeter === 1 ? "Falta meter 1 coste" : `Faltan por meter ${costesPorMeter} costes`,
      detalle: "Servicios de pago sin precio o sin el coste de algún mes: el informe mensual se queda corto.",
      destino: { pestana: "costes" },
      accion: "Ver en Costes",
    });
  }

  const revisar = [...new Set([...resumen.sinPrecio, ...resumen.porConfirmar])];
  if (revisar.length > 0) {
    salida.push({
      clave: "configurar:por-confirmar",
      gravedad: "info",
      titulo: revisar.length === 1 ? `${revisar[0]}: plan o precio por confirmar` : `${revisar.length} servicios con el plan o el precio por confirmar`,
      detalle: revisar.length === 1 ? "Mientras, su coste puede no estar bien sumado." : `${nombres(revisar)}. Mientras, el coste puede no estar bien sumado.`,
      destino: { pestana: "configurar" },
      accion: "Revisar",
    });
  }

  return salida
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ORDEN_GRAVEDAD[a.p.gravedad] - ORDEN_GRAVEDAD[b.p.gravedad] || a.i - b.i)
    .map(({ p }) => p);
}

// ─── categorías ─────────────────────────────────────────────────────────────

export const CATEGORIAS: Array<{ valor: Categoria; texto: string }> = [
  { valor: "alojamiento", texto: "Webs y alojamiento" },
  { valor: "base_datos", texto: "Base de datos" },
  { valor: "codigo", texto: "Código y pruebas" },
  { valor: "correo", texto: "Correo" },
  { valor: "pagos", texto: "Cobros" },
  { valor: "ia", texto: "Inteligencia artificial" },
  { valor: "telefonia", texto: "Teléfono" },
  { valor: "mapas", texto: "Mapas y reseñas" },
  { valor: "archivos", texto: "Archivos" },
  { valor: "dominio", texto: "Dominio y correo propio" },
  { valor: "otros", texto: "Otros" },
];
export const TEXTO_CATEGORIA: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.texto]));

/** Por `orden` y, a igualdad, por nombre. */
export const ordenarServicios = (lista: ServicioContratado[]) =>
  [...lista].sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100) || a.nombre.localeCompare(b.nombre, "es"));

/** Fecha «AAAA-MM-DD» → «03/11/2026». */
export function fechaCorta(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

export interface AyudaSecreto {
  titulo: string;
  enlace: string;
  textoEnlace: string;
  pasos: string[];
  permisos: string;
  /** Ya está creada en producción: no se enseña el paso «guárdala en Supabase». */
  yaExiste?: boolean;
}

/** Cómo crear cada clave (sin tecnicismos) y con qué permisos mínimos. */
export const AYUDA_SECRETOS: Record<string, AyudaSecreto> = {
  SERVICIOS_VERCEL_TOKEN: {
    titulo: "Token de Vercel",
    enlace: "https://vercel.com/account/settings/tokens",
    textoEnlace: "Abrir los tokens de Vercel",
    pasos: [
      "Entra en Vercel con la cuenta del equipo «Casa tomas» y pulsa «Create Token».",
      "Nombre: «Panel · Servicios». En «Scope» elige el equipo «Casa tomas» (todos los proyectos). Caducidad: 1 año.",
      "Copia el token (empieza por vcp_): Vercel solo lo enseña una vez.",
    ],
    permisos: "Vercel no tiene tokens de solo lectura: limítalo al equipo «Casa tomas» y ponle caducidad.",
  },
  SERVICIOS_GITHUB_TOKEN: {
    titulo: "Token de GitHub",
    enlace: "https://github.com/settings/personal-access-tokens/new",
    textoEnlace: "Crear el token en GitHub",
    pasos: [
      "Con la cuenta restcasatomascrevillent, crea un «Fine-grained token». Nombre: «Panel · Servicios». Caducidad: 1 año.",
      "Repository access: «Only select repositories» → web-casatomas, admin-casatomas y touza-casatomas. Repository permissions → «Actions»: Read-only.",
      "Account permissions → «Plan»: Read-only (para los minutos y lo facturado exactos).",
      "Copia el token (empieza por github_pat_): GitHub solo lo enseña una vez.",
    ],
    permisos: "Solo lectura de las ejecuciones de pruebas, del plan y de la facturación: no puede tocar el código ni lanzar nada.",
  },
  SERVICIOS_SUPABASE_TOKEN: {
    titulo: "Token de gestión de Supabase",
    enlace: "https://supabase.com/dashboard/account/tokens",
    textoEnlace: "Abrir los tokens de Supabase",
    pasos: [
      "Pulsa «Generate new token» y limita el token al proyecto de producción.",
      "Permisos: «Usage Analytics» y «Logs», los dos en «Read». Nada más.",
      "Copia el token (empieza por sbp_): Supabase solo lo enseña una vez.",
    ],
    permisos: "Opcional: sin él ya se ven la base de datos, los archivos y los usuarios. Si no aparece la opción de permisos, no lo crees (un token clásico da acceso total).",
  },
  RESEND_API_KEY: {
    titulo: "Clave de Resend",
    enlace: "https://resend.com/api-keys",
    textoEnlace: "Abrir las claves de Resend",
    pasos: [
      "En producción ya existe (la usan los correos de reservas): no hay que hacer nada.",
      "En la demo no se configura a propósito: la demo no manda correos.",
    ],
    permisos: "Con una clave «Sending access» se ve el consumo, pero no los dominios.",
    yaExiste: true,
  },
  SERVICIOS_HOSTINGER_TOKEN: {
    titulo: "Token de Hostinger",
    enlace: "https://hpanel.hostinger.com/profile/api",
    textoEnlace: "Abrir los tokens de Hostinger",
    pasos: [
      "Entra en hPanel con la cuenta de Hostinger del restaurante → Perfil → API y pulsa «Nuevo token».",
      "Nombre: «Panel · Servicios». Caducidad: 1 año.",
      "Copia el token: Hostinger solo lo enseña una vez.",
    ],
    permisos: "Hostinger no tiene tokens de solo lectura: el token puede lo mismo que tu usuario. El panel solo lo usa para LEER suscripciones y dominios. Si el restaurante no tiene cuenta en Hostinger, no lo crees y desmarca «Lo usamos».",
  },
  VAPI_API_KEY: {
    titulo: "Clave privada de Vapi",
    enlace: "https://dashboard.vapi.ai/org/api-keys",
    textoEnlace: "Abrir las claves de Vapi",
    pasos: [
      "Si la pantalla de llamadas (Asistente telefónico) ya enseña gráficas, la clave ya existe en Supabase: no hay que hacer nada.",
      "Si no, en Vapi → Organización → API Keys copia la «Private Key».",
    ],
    permisos: "Opcional: sin ella, el número de llamadas, los minutos y su coste salen de call_logs. Con ella, el coste del mes lo da Vapi.",
  },
  GOOGLE_REFRESH_TOKEN: {
    titulo: "Cuenta de Google de las facturas",
    enlace: "https://console.cloud.google.com/apis/credentials",
    textoEnlace: "Abrir las credenciales de Google",
    pasos: [
      "Son las mismas claves que guardan las copias de las facturas en Drive (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN).",
      "Si las facturas ya se copian a Drive, existen: no hay que hacer nada. Si no, se configuran una vez para las facturas y esta tarjeta las aprovecha.",
    ],
    permisos: "Solo lee el espacio usado de la cuenta; no abre ni cambia ningún fichero.",
    yaExiste: true,
  },
  GOOGLE_CLIENT_ID: {
    titulo: "Cuenta de Google de las facturas",
    enlace: "https://console.cloud.google.com/apis/credentials",
    textoEnlace: "Abrir las credenciales de Google",
    pasos: ["Es una de las tres claves de la copia de facturas en Drive (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN)."],
    permisos: "Solo lee el espacio usado de la cuenta.",
    yaExiste: true,
  },
  GOOGLE_CLIENT_SECRET: {
    titulo: "Cuenta de Google de las facturas",
    enlace: "https://console.cloud.google.com/apis/credentials",
    textoEnlace: "Abrir las credenciales de Google",
    pasos: ["Es una de las tres claves de la copia de facturas en Drive (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN)."],
    permisos: "Solo lee el espacio usado de la cuenta.",
    yaExiste: true,
  },
  STRIPE_SECRET_KEY: {
    titulo: "Clave de Stripe",
    enlace: "https://dashboard.stripe.com/apikeys",
    textoEnlace: "Abrir las claves de Stripe",
    pasos: [
      "En producción ya existe (la usan los cheques regalo): no hay que hacer nada.",
      "En la demo no se configura a propósito: la demo no cobra.",
    ],
    permisos: "No la cambies desde aquí: es la misma que cobra los cheques regalo.",
    yaExiste: true,
  },
};

/** Página de secretos de las funciones del proyecto de Supabase al que apunta el panel. */
export function enlaceSecretosSupabase(urlSupabase: string | undefined): string {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.(co|in)/i.exec(urlSupabase ?? "");
  return m ? `https://supabase.com/dashboard/project/${m[1]}/functions/secrets` : "https://supabase.com/dashboard/projects";
}

// ─── alta (Configurar › Añadir servicio) ────────────────────────────────────

/**
 * Clave de un servicio nuevo a partir de su nombre («Google Analytics» →
 * «google_analytics»): minúsculas sin tildes, solo [a-z0-9_] (la CHECK de la
 * tabla admite 2–40). Si ya existe, «_2», «_3»…
 */
export function proveedorDeNombre(nombre: string, existentes: Iterable<string>): string {
  const limpio = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34).replace(/_+$/, "");
  const raiz = limpio.length >= 2 ? limpio : `servicio${limpio ? `_${limpio}` : ""}`;
  const usados = new Set(existentes);
  if (!usados.has(raiz)) return raiz;
  for (let i = 2; ; i++) {
    const candidata = `${raiz}_${i}`;
    if (!usados.has(candidata)) return candidata;
  }
}

/** Ficha vacía para el diálogo de alta: en uso, pago mensual en euros, al final de la lista. */
export function servicioNuevo(orden = 100): ServicioContratado {
  return {
    proveedor: "nuevo",
    nombre: "",
    plan: null,
    precio_mensual: null,
    moneda: "EUR",
    ciclo: "mensual",
    renovacion: null,
    cuenta: null,
    panel_url: null,
    limites: {},
    notas: null,
    actualizado_en: "",
    categoria: "otros",
    orden: Math.min(10000, Math.max(0, Math.round(orden))),
    activo: true,
    por_confirmar: false,
    precio_anual: null,
    fuente_precio: null,
  };
}

// ─── edición (diálogo) ──────────────────────────────────────────────────────

export interface BorradorServicio {
  nombre: string;
  plan: string;
  /** Precio al mes (o, con ciclo «anual», al año). */
  precio: string;
  moneda: string;
  ciclo: string;
  renovacion: string;
  cuenta: string;
  panel_url: string;
  notas: string;
  categoria: string;
  orden: string;
  activo: boolean;
  por_confirmar: boolean;
  fuente_precio: string;
  limites: Record<string, { limite: string; unidad: string }>;
}

const aTexto = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

export function borradorDe(s: ServicioContratado): BorradorServicio {
  const anual = s.ciclo === "anual";
  return {
    nombre: s.nombre,
    plan: s.plan ?? "",
    // Anual: lo que se paga al año (si solo había precio al mes, ×12).
    precio: anual ? aTexto(s.precio_anual ?? (s.precio_mensual == null ? null : Math.round(s.precio_mensual * 12 * 100) / 100)) : aTexto(s.precio_mensual),
    moneda: s.moneda || "USD",
    ciclo: s.ciclo || "mensual",
    renovacion: s.renovacion ?? "",
    cuenta: s.cuenta ?? "",
    panel_url: s.panel_url ?? "",
    notas: s.notas ?? "",
    categoria: s.categoria || "otros",
    orden: String(s.orden ?? 100),
    activo: s.activo !== false,
    por_confirmar: !!s.por_confirmar,
    fuente_precio: s.fuente_precio ?? "",
    limites: Object.fromEntries(Object.entries(s.limites ?? {}).map(([k, l]) => [k, {
      limite: typeof l.limite === "number" ? String(l.limite).replace(".", ",") : "",
      unidad: l.unidad ?? "",
    }])),
  };
}

/** «1.000.000», «2,5», «  » → número, null (vacío) o NaN (no válido). */
export function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!t) return null;
  const normal = /,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

export type ResultadoBorrador =
  | { ok: true; cambios: Omit<ServicioContratado, "proveedor" | "actualizado_en"> }
  | { ok: false; errores: Record<string, string> };

const CATEGORIAS_VALIDAS = new Set<string>(CATEGORIAS.map((c) => c.valor));

/** Valida el borrador (mismas reglas que la migración) y lo convierte en cambios. */
export function cambiosDeBorrador(b: BorradorServicio, original: ServicioContratado): ResultadoBorrador {
  const errores: Record<string, string> = {};
  const nombre = b.nombre.trim();
  if (!nombre || nombre.length > 80) errores.nombre = "Pon un nombre (máximo 80 letras).";
  const anual = b.ciclo === "anual";
  const precio = leerNumero(b.precio);
  if (precio != null && (Number.isNaN(precio) || precio > (anual ? 1000000 : 100000))) errores.precio = "Escribe un importe (por ejemplo 20 o 19,99) o déjalo vacío.";
  const panel = b.panel_url.trim();
  if (panel && !/^https:\/\/\S+$/.test(panel)) errores.panel_url = "El enlace tiene que empezar por https://";
  const fuente = b.fuente_precio.trim();
  if (fuente && (!/^https:\/\/\S+$/.test(fuente) || fuente.length > 500)) errores.fuente_precio = "El enlace tiene que empezar por https://";
  if (!CATEGORIAS_VALIDAS.has(b.categoria)) errores.categoria = "Elige una categoría.";
  const orden = leerNumero(b.orden);
  if (orden == null || Number.isNaN(orden) || !Number.isInteger(orden) || orden > 10000) errores.orden = "Escribe un número entero de 0 a 10.000.";
  if (b.renovacion && !/^\d{4}-\d{2}-\d{2}$/.test(b.renovacion)) errores.renovacion = "Fecha no válida.";
  if (!/^[A-Z]{3}$/.test(b.moneda)) errores.moneda = "Moneda no válida.";
  const limites: Record<string, LimitePlan> = {};
  for (const [clave, original_l] of Object.entries(original.limites ?? {})) {
    const borrador = b.limites[clave];
    const limite = borrador ? leerNumero(borrador.limite) : (original_l.limite ?? null);
    if (limite != null && Number.isNaN(limite)) errores[`limite.${clave}`] = "Escribe un número o déjalo vacío (= sin dato).";
    const unidad = (borrador?.unidad ?? original_l.unidad ?? "").trim().slice(0, 30);
    // Límite que pone la lectura (p. ej. el tope de IA): sin «limite» mientras no se escriba uno.
    const sinLimitePropio = !("limite" in original_l) && limite == null;
    const { limite: _sinUsar, ...resto } = original_l;
    limites[clave] = sinLimitePropio
      ? { ...resto, ...(unidad ? { unidad } : {}) }
      : { ...original_l, limite: limite != null && Number.isNaN(limite) ? null : limite, ...(unidad ? { unidad } : {}) };
  }
  if (Object.keys(errores).length) return { ok: false, errores };
  return {
    ok: true,
    cambios: {
      nombre,
      plan: b.plan.trim().slice(0, 80) || null,
      // Solo uno de los dos: al mes, o al año con ciclo «anual».
      precio_mensual: anual ? null : precio,
      precio_anual: anual ? precio : null,
      moneda: b.moneda,
      ciclo: b.ciclo,
      renovacion: b.renovacion || null,
      cuenta: b.cuenta.trim().slice(0, 300) || null,
      panel_url: panel || null,
      limites,
      notas: b.notas.trim().slice(0, 2000) || null,
      categoria: b.categoria,
      orden: orden ?? 100,
      activo: b.activo,
      por_confirmar: b.por_confirmar,
      fuente_precio: fuente || null,
    },
  };
}

export const TEXTO_ERROR: Record<string, string> = {
  falta_secreto: "Falta configurar la clave",
  credencial_rechazada: "El proveedor ha rechazado la clave guardada (no es válida, ha caducado o le faltan permisos).",
  error_api: "El proveedor no ha devuelto los datos. Se volverá a intentar en la próxima lectura.",
  error_interno: "No se pudo contactar con el proveedor (sin respuesta o tiempo agotado).",
};

// ─── Estado de un vistazo (pestaña «Estado», 06/11/2026) ────────────────────
// Petición del dueño: «la primera pestaña tiene que ser algo muy visual, que de
// primera vista sepas el estado de la instalación completa». Una ficha por
// servicio en uso con un color y dos o tres palabras; el detalle, en su tarjeta.

/** El color de una ficha. «gris»: sin datos (no hay lectura automática o aún no se ha leído). */
export type EstadoServicio = Semaforo | "gris";

export const TEXTO_ESTADO: Record<EstadoServicio, string> = {
  rojo: "Urgente",
  ambar: "Aviso",
  verde: "Bien",
  gris: "Sin datos",
};

/** Una métrica con límite, para un anillo de la ficha. */
export interface AnilloEstado {
  clave: string;
  /** Una o dos palabras bajo el anillo: «Visitas», «Base de datos». */
  corta: string;
  etiqueta: string;
  porcentaje: number;
  semaforo: Semaforo;
  textoValor: string | null;
  textoLimite: string | null;
}

/** Un dato sin límite que se enseña en la ficha (cobros, llamadas, crecimiento de la BD…). */
export interface DatoEstado {
  clave: string;
  corta: string;
  /** La cifra corta: «63.021», «10,00 €», «+259 MB», «en 111 días». */
  texto: string;
  /** Para el «title» y el lector de pantalla: etiqueta entera, cifra con unidad y periodo. */
  completo: string;
}

export interface FichaEstado {
  proveedor: string;
  /** Sin la aclaración entre paréntesis: «Vapi», no «Vapi (asistente telefónico)». */
  nombre: string;
  nombreCompleto: string;
  categoria: string;
  estado: EstadoServicio;
  /** Dos o tres palabras: «Bien», «Al 121 %», «Falta la clave», «Renueva en 12 días». */
  motivo: string;
  /** La métrica más cerca de su límite (el primer anillo), si alguna tiene límite. */
  principal: { etiqueta: string; porcentaje: number; textoValor: string | null; textoLimite: string | null } | null;
  /** Hasta 3 métricas con límite, de la más cerca de su límite a la que menos (09/11/2026). */
  anillos: AnilloEstado[];
  /** Hasta 3 datos sin límite (por su orden) y la próxima renovación, si la hay. */
  datos: DatoEstado[];
}

/** Máximo de anillos y de datos por ficha (caben a 2 columnas en un móvil de 320 px). */
export const MAX_ANILLOS = 3;
export const MAX_DATOS = 3;

/**
 * Nombre corto de cada métrica en la ficha de Estado (el entero va en el «title»). Las que no
 * están aquí usan su etiqueta sin el paréntesis final.
 */
export const ETIQUETA_CORTA: Record<string, string> = {
  // Vercel
  peticiones_cdn: "Visitas", transferencia_rapida: "Tráfico", transferencia_origen: "Tráfico del servidor",
  invocaciones_funciones: "Funciones", cpu_activa: "CPU", memoria_funciones: "Memoria", transformaciones_imagen: "Imágenes",
  despliegues_24h: "Despliegues", recortes_servidor_mes: "Recortes mes", recortes_servidor_dia: "Recortes hoy",
  cpu_recortes_mes: "CPU recortes", compilaciones_30d: "Compilaciones (30 días)",
  // Supabase
  bd_tamano: "Base de datos", almacenamiento: "Archivos", usuarios_activos_mes: "Usuarios", conexiones: "Conexiones",
  bd_crecimiento: "Crecimiento BD", peticiones_api_7d: "Peticiones (7 días)", invocaciones_funciones_24h: "Funciones (24 h)",
  // GitHub
  actions_minutos: "Minutos", actions_computo: "Cómputo", almacenamiento_artefactos: "Artefactos",
  actions_minutos_publicos: "Minutos gratis", actions_ejecuciones: "Ejecuciones", actions_sin_arrancar: "Sin arrancar",
  // Resend
  correos_mes: "Correos mes", correos_hoy: "Correos hoy", contactos_marketing: "Contactos", dominios: "Dominios",
  // Stripe
  cobros_mes: "Cobros", importe_cobrado_mes: "Cobrado", comisiones_mes: "Comisiones", saldo_disponible: "Saldo",
  // OpenAI
  gasto_ia_mes: "Gasto IA", gasto_real_usd: "Ya facturado", gasto_estimado_usd: "Estimado",
  // Vapi
  llamadas_mes: "Llamadas", minutos_mes: "Minutos", coste_llamadas_mes: "Coste", llamadas_simultaneas: "A la vez",
  // Hostinger
  suscripciones_activas: "Suscripciones",
};

/** Datos que no se enseñan en la ficha (repiten otro o no dicen nada de un vistazo). */
const DATOS_OCULTOS = new Set(["actions_computo", "saldo_pendiente", "cheques_mes", "importe_cheques_mes", "comision_cheques_mes"]);

const cortaDe = (clave: string, etiqueta: string) => ETIQUETA_CORTA[clave] ?? sinAclaracion(etiqueta);

/** «mes en curso» → «este mes»; «últimos 7 días» → «7 días»… (para el «title»). */
function periodoCorto(p: string | null): string {
  if (!p) return "";
  if (/^ahora$/i.test(p)) return "ahora";
  if (/mes en curso|mes natural/i.test(p)) return "este mes";
  return p.replace(/^últim[oa]s\s+/i, "");
}

/** La cifra de un dato: sin la unidad si es una palabra («63.021»), con ella si es tamaño o moneda. */
function textoDato(f: FilaMetrica): string {
  const v = f.valor ?? 0;
  const signo = /crecimiento/.test(f.clave) && v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (esUnidadBytes(f.unidad)) {
    // Corto: «253 MB», «6,1 GB» (sin los dos decimales de la tarjeta).
    const b = aBytes(abs, f.unidad) ?? abs;
    for (const u of ["tb", "gb", "mb", "kb"]) if (b >= BYTES[u]) return `${signo}${fmt(b / BYTES[u], b >= 10 * BYTES[u] ? 0 : 1)} ${u === "kb" ? "kB" : u.toUpperCase()}`;
    return `${signo}${fmt(b, 0)} B`;
  }
  if (MONEDAS.has(f.unidad.trim().toUpperCase())) return `${signo}${formatearCantidad(abs, f.unidad)}`;
  return `${signo}${fmt(abs)}`;
}

export interface EstadoInstalacion {
  fichas: FichaEstado[];
  cuenta: Record<EstadoServicio, number>;
  /** El estado de toda la instalación: el peor color (el gris solo si no hay nada más). */
  general: EstadoServicio;
}

/** «Vapi (asistente telefónico)» → «Vapi»; «Visitas a las webs (peticiones al CDN)» → «Visitas a las webs». */
export const sinAclaracion = (texto: string): string => texto.replace(/\s*\([^)]*\)\s*$/, "").trim() || texto;

const RANGO_ESTADO: Record<EstadoServicio, number> = { rojo: 3, ambar: 2, verde: 1, gris: 0 };

/**
 * Una ficha por servicio en uso: el peor de su consumo (≥ 90 % rojo, 70–90 %
 * ámbar), su clave (rechazada: rojo; falta: ámbar), la lectura (fallida: ámbar)
 * y su renovación (pasada: rojo; en 30 días o menos: ámbar). Sin ningún dato,
 * gris. Primero lo urgente; dentro de cada color, el orden de siempre.
 */
export function estadoInstalacion(args: {
  servicios: ServicioContratado[];
  lecturas: Map<string, LecturaServicio>;
  renovaciones: Renovacion[];
  sinLector?: Set<string>;
}): EstadoInstalacion {
  const { servicios, lecturas, renovaciones, sinLector = new Set<string>() } = args;
  const fichas: FichaEstado[] = [];
  servicios.filter((s) => s.activo !== false).forEach((s) => {
    const lectura = lecturas.get(s.proveedor) ?? null;
    const filas = combinarMetricas(s, lectura);
    // De mayor a menor %; a igualdad, el orden de siempre (sort estable).
    const conLimite = filas.filter((f) => f.porcentaje != null && f.semaforo != null).sort((a, b) => b.porcentaje! - a.porcentaje!);
    const top = conLimite[0] ?? null;
    const principal = top
      ? { etiqueta: sinAclaracion(top.etiqueta), porcentaje: top.porcentaje!, textoValor: top.textoValor, textoLimite: top.textoLimite }
      : null;
    const anillos: AnilloEstado[] = conLimite.slice(0, MAX_ANILLOS).map((f) => ({
      clave: f.clave, corta: cortaDe(f.clave, f.etiqueta), etiqueta: sinAclaracion(f.etiqueta), porcentaje: f.porcentaje!, semaforo: f.semaforo!,
      textoValor: f.textoValor, textoLimite: f.textoLimite,
    }));
    const datos: DatoEstado[] = filas
      .filter((f) => f.valor != null && f.porcentaje == null && f.limite == null && !DATOS_OCULTOS.has(f.clave))
      .slice(0, MAX_DATOS)
      .map((f) => {
        const periodo = periodoCorto(f.periodo);
        const texto = textoDato(f);
        const palabra = !esUnidadBytes(f.unidad) && !MONEDAS.has(f.unidad.trim().toUpperCase()) && f.unidad.trim() ? ` ${f.unidad.trim()}` : "";
        return {
          clave: f.clave, corta: cortaDe(f.clave, f.etiqueta), texto,
          completo: `${f.etiqueta}: ${texto}${palabra}${periodo ? ` (${periodo})` : ""}`,
        };
      });

    let estado: EstadoServicio = "gris";
    let motivo = sinLector.has(s.proveedor) ? "Se mira en su panel" : "Sin datos aún";
    const subir = (e: EstadoServicio, m: string) => {
      if (RANGO_ESTADO[e] > RANGO_ESTADO[estado]) {
        estado = e;
        motivo = m;
      }
    };

    if (lectura && !lectura.error) subir("verde", "Bien");
    if (top?.semaforo === "rojo" || top?.semaforo === "ambar") subir(top.semaforo, `Al ${formatearPorcentaje(top.porcentaje!)}`);
    if (lectura?.error && !sinLector.has(s.proveedor)) {
      if (lectura.error === "credencial_rechazada") subir("rojo", "Clave rechazada");
      else if (lectura.error === "falta_secreto") subir("ambar", "Falta la clave");
      else subir("ambar", "No se pudo leer");
    }
    const suyas = renovaciones.filter((r) => r.proveedor === s.proveedor).sort((a, b) => a.dias - b.dias);
    const proxima = suyas[0];
    if (proxima && proxima.dias < 0) subir("rojo", "Renovación pasada");
    else if (proxima && proxima.dias <= DIAS_RENOVACION_CERCANA) subir("ambar", `Renueva ${textoDias(proxima.dias)}`);
    // La próxima renovación lejana también es un dato útil (la cercana ya la dice el motivo).
    if (proxima && proxima.dias > DIAS_RENOVACION_CERCANA && datos.length < MAX_DATOS) {
      datos.push({
        clave: "renovacion", corta: "Renueva", texto: textoDias(proxima.dias),
        completo: `${proxima.concepto}: ${textoDias(proxima.dias)} (${fechaCorta(proxima.fecha)})`,
      });
    }

    fichas.push({
      proveedor: s.proveedor,
      nombre: sinAclaracion(s.nombre),
      nombreCompleto: s.nombre,
      categoria: s.categoria,
      estado,
      motivo,
      principal,
      anillos,
      datos,
    });
  });
  fichas.sort((a, b) => RANGO_ESTADO[b.estado] - RANGO_ESTADO[a.estado]);
  const cuenta: Record<EstadoServicio, number> = { rojo: 0, ambar: 0, verde: 0, gris: 0 };
  for (const f of fichas) cuenta[f.estado] += 1;
  const general: EstadoServicio = cuenta.rojo ? "rojo" : cuenta.ambar ? "ambar" : cuenta.verde ? "verde" : "gris";
  return { fichas, cuenta, general };
}

/** El titular del estado general: «Todo en orden», «Todo funciona · 2 avisos», «1 servicio necesita atención». */
export function titularEstado(e: Pick<EstadoInstalacion, "cuenta" | "general">): string {
  const { rojo, ambar } = e.cuenta;
  if (e.general === "rojo") return rojo === 1 ? "1 servicio necesita atención" : `${rojo} servicios necesitan atención`;
  if (e.general === "ambar") return ambar === 1 ? "Todo funciona · 1 aviso" : `Todo funciona · ${ambar} avisos`;
  if (e.general === "verde") return "Todo en orden";
  return "Todavía sin datos";
}
