/**
 * Super Admin › Servicios: tipos y cuentas de la pantalla (sin React).
 *
 * Datos: `servicios_contratados` (plan, precio, límites; lo edita el dueño) y
 * las lecturas de la Edge Function `servicios-uso` (consumo; tabla
 * `servicios_uso`). Ver supabase/migrations/20261103120000_servicios_contratados.sql.
 *
 * Semáforo (petición del dueño): verde < 70 %, ámbar de 70 a 90 %, rojo > 90 %.
 */

export type Semaforo = "verde" | "ambar" | "rojo";

export interface LimitePlan {
  etiqueta?: string;
  /** null o ausente = «sin dato». */
  limite?: number | null;
  unidad?: string;
  periodo?: string;
  fuente?: string;
  nota?: string;
  orden?: number;
}

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
  desde_cache?: boolean;
  guardada?: boolean;
}

export const UMBRAL_AMBAR = 70;
export const UMBRAL_ROJO = 90;

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

/** «Gratis», «20,00 US$ al mes», «Pago por uso». */
export function textoPrecio(s: Pick<ServicioContratado, "precio_mensual" | "moneda" | "ciclo">): string {
  if (s.ciclo === "por_uso" && (s.precio_mensual == null || s.precio_mensual === 0)) return "Pago por uso";
  if (s.precio_mensual == null) return "Precio sin dato";
  if (s.precio_mensual === 0) return "Gratis";
  const importe = formatearCantidad(s.precio_mensual, s.moneda);
  return `${importe} al mes${s.ciclo === "anual" ? " (pago anual)" : ""}`;
}

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
      "Con la cuenta restcasatomascrevillent, crea un «Fine-grained token».",
      "Repository access: «Public repositories» (no necesita ningún repositorio). Account permissions → «Plan»: Read-only.",
      "Copia el token (empieza por github_pat_): GitHub solo lo enseña una vez.",
    ],
    permisos: "Solo lectura del plan y de la facturación: no puede tocar el código.",
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

// ─── edición (diálogo) ──────────────────────────────────────────────────────

export interface BorradorServicio {
  nombre: string;
  plan: string;
  precio: string;
  moneda: string;
  ciclo: string;
  renovacion: string;
  cuenta: string;
  panel_url: string;
  notas: string;
  limites: Record<string, { limite: string; unidad: string }>;
}

export function borradorDe(s: ServicioContratado): BorradorServicio {
  return {
    nombre: s.nombre,
    plan: s.plan ?? "",
    precio: s.precio_mensual == null ? "" : String(s.precio_mensual).replace(".", ","),
    moneda: s.moneda || "USD",
    ciclo: s.ciclo || "mensual",
    renovacion: s.renovacion ?? "",
    cuenta: s.cuenta ?? "",
    panel_url: s.panel_url ?? "",
    notas: s.notas ?? "",
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

/** Valida el borrador (mismas reglas que la migración) y lo convierte en cambios. */
export function cambiosDeBorrador(b: BorradorServicio, original: ServicioContratado): ResultadoBorrador {
  const errores: Record<string, string> = {};
  const nombre = b.nombre.trim();
  if (!nombre || nombre.length > 80) errores.nombre = "Pon un nombre (máximo 80 letras).";
  const precio = leerNumero(b.precio);
  if (precio != null && (Number.isNaN(precio) || precio > 100000)) errores.precio = "Escribe un importe (por ejemplo 20 o 19,99) o déjalo vacío.";
  const panel = b.panel_url.trim();
  if (panel && !/^https:\/\/\S+$/.test(panel)) errores.panel_url = "El enlace tiene que empezar por https://";
  if (b.renovacion && !/^\d{4}-\d{2}-\d{2}$/.test(b.renovacion)) errores.renovacion = "Fecha no válida.";
  if (!/^[A-Z]{3}$/.test(b.moneda)) errores.moneda = "Moneda no válida.";
  const limites: Record<string, LimitePlan> = {};
  for (const [clave, original_l] of Object.entries(original.limites ?? {})) {
    const borrador = b.limites[clave];
    const limite = borrador ? leerNumero(borrador.limite) : (original_l.limite ?? null);
    if (limite != null && Number.isNaN(limite)) errores[`limite.${clave}`] = "Escribe un número o déjalo vacío (= sin dato).";
    const unidad = (borrador?.unidad ?? original_l.unidad ?? "").trim().slice(0, 30);
    limites[clave] = { ...original_l, limite: limite != null && Number.isNaN(limite) ? null : limite, ...(unidad ? { unidad } : {}) };
  }
  if (Object.keys(errores).length) return { ok: false, errores };
  return {
    ok: true,
    cambios: {
      nombre,
      plan: b.plan.trim().slice(0, 80) || null,
      precio_mensual: precio,
      moneda: b.moneda,
      ciclo: b.ciclo,
      renovacion: b.renovacion || null,
      cuenta: b.cuenta.trim().slice(0, 300) || null,
      panel_url: panel || null,
      limites,
      notas: b.notas.trim().slice(0, 2000) || null,
    },
  };
}

export const TEXTO_ERROR: Record<string, string> = {
  falta_secreto: "Falta configurar la clave",
  credencial_rechazada: "El proveedor ha rechazado la clave guardada (no es válida, ha caducado o le faltan permisos).",
  error_api: "El proveedor no ha devuelto los datos. Se volverá a intentar en la próxima lectura.",
  error_interno: "No se pudo contactar con el proveedor (sin respuesta o tiempo agotado).",
};
