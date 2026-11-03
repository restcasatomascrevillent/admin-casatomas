// ============================================================================
//  servicios-uso · consumo de los servicios contratados (Super Admin › Servicios)
// ----------------------------------------------------------------------------
//  Quién: SOLO un super admin (exigirSuperAdmin → is_super_admin). Ser admin no
//  basta. verify_jwt = true en config.toml (prefiltro), autorización aquí.
//
//  Qué hace: para cada proveedor sembrado en `servicios_contratados` (Vercel,
//  Supabase, GitHub, Resend y Stripe) lee su consumo por API con su secreto,
//  le pone el límite del plan (de `servicios_contratados.limites`), guarda una
//  fila en `servicios_uso` y devuelve la última lectura de cada uno.
//    · Caché: si la última lectura tiene < 15 min, no llama a la API salvo
//      `?forzar=1` (o cuerpo { "forzar": true }); aun forzando, nunca más de
//      una lectura por minuto y proveedor. Con { "proveedor": "vercel" } solo
//      se fuerza ese (botón «Actualizar ahora» de cada tarjeta).
//    · Sin el secreto de un proveedor → { error: "falta_secreto", secreto:
//      "NOMBRE" } para él, sin romper el resto.
//    · Supabase mide BD, Storage y usuarios activos con la clave de servicio
//      (RPC servicios_metricas_supabase) aunque falte SERVICIOS_SUPABASE_TOKEN.
//    · NUNCA devuelve ni guarda una clave: solo códigos y textos propios (los
//      mensajes de error de los proveedores no se reenvían) y, por si acaso,
//      cualquier valor de un secreto se borra de la respuesta.
//
//  Secretos (Supabase → Edge Functions → Secrets; los crea el dueño):
//    SERVICIOS_VERCEL_TOKEN  (+ SERVICIOS_VERCEL_TEAM_ID, por defecto el equipo casa-tomas)
//    SERVICIOS_SUPABASE_TOKEN (token de gestión: Usage Analytics y Logs, lectura)
//    SERVICIOS_GITHUB_TOKEN  (+ SERVICIOS_GITHUB_OWNER, por defecto restcasatomascrevillent)
//    RESEND_API_KEY          (ya existe en producción)
//    STRIPE_SECRET_KEY       (ya existe en producción; el modo sale del prefijo)
// ============================================================================
import { exigirSuperAdmin, respuestaJson, type FabricaCliente } from "../_shared/autorizacion.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const CACHE_MS = 15 * 60_000;
export const MIN_FORZAR_MS = 60_000;
export const TIMEOUT_MS = 15_000;
export const RETENCION_DIAS = 400;
export const VERCEL_TEAM_POR_DEFECTO = "team_18KKVg7ueSX0PL4Ycy1QakZj";
export const GITHUB_OWNER_POR_DEFECTO = "restcasatomascrevillent";
const GIB = 1024 ** 3;

/** Nombres de todos los secretos que lee la función (para no devolverlos nunca). */
export const SECRETOS = [
  "SERVICIOS_VERCEL_TOKEN",
  "SERVICIOS_SUPABASE_TOKEN",
  "SERVICIOS_GITHUB_TOKEN",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
] as const;

export type CodigoError = "falta_secreto" | "credencial_rechazada" | "error_api" | "error_interno";

export interface Metrica {
  etiqueta: string;
  valor: number | null;
  /** Unidad de `valor`: "bytes" para tamaños; si no, la misma palabra que el límite (peticiones, USD…). */
  unidad: string;
  limite?: number | null;
  /** Unidad del límite (MB, GB…) cuando difiere de `unidad`. */
  unidad_limite?: string;
  periodo?: string;
  nota?: string;
  orden?: number;
}

export interface ResultadoLector {
  metricas: Record<string, Metrica>;
  error?: CodigoError | null;
  detalles?: Record<string, unknown>;
}

type Respuesta = { data: unknown; error: { message?: string; code?: string } | null };
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClienteAdmin = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<Respuesta>; from: (tabla: string) => any };

export interface ContextoLector {
  env: (nombre: string) => string | undefined;
  fetch: typeof fetch;
  ahora: Date;
  admin: ClienteAdmin;
  /** Ref del proyecto de Supabase donde corre la función (de SUPABASE_URL). */
  refProyecto: string | null;
}

export type Lector = (ctx: ContextoLector) => Promise<ResultadoLector>;

export interface LecturaGuardada {
  proveedor: string;
  tomado_en: string;
  metricas: Record<string, Metrica>;
  error: string | null;
  detalles: Record<string, unknown>;
}

export interface LecturaRespuesta extends LecturaGuardada {
  /** Nombre del secreto que falta (solo con error "falta_secreto"). */
  secreto?: string;
  desde_cache: boolean;
  guardada: boolean;
}

// ─── utilidades ─────────────────────────────────────────────────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numero = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const redondear = (n: number, decimales = 2) => Math.round(n * 10 ** decimales) / 10 ** decimales;
const secreto = (ctx: Pick<ContextoLector, "env">, nombre: string) => (ctx.env(nombre) ?? "").trim();

export function inicioMesUtc(ahora: Date): Date {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
}

export function faltaSecreto(nombre: string, metricas: Record<string, Metrica> = {}, detalles: Record<string, unknown> = {}): ResultadoLector {
  return { metricas, error: "falta_secreto", detalles: { ...detalles, secreto: nombre } };
}

function rechazoHttp(status: number, detalles: Record<string, unknown> = {}): ResultadoLector {
  return {
    metricas: {},
    error: status === 401 || status === 403 ? "credencial_rechazada" : "error_api",
    detalles: { ...detalles, http: status },
  };
}

interface Http {
  ok: boolean;
  status: number;
  json: unknown;
  headers: Headers;
}

/** GET con tiempo límite. No lanza por códigos HTTP; sí por red o tiempo agotado. */
async function pedir(ctx: ContextoLector, url: string, cabeceras: Record<string, string>): Promise<Http> {
  const res = await ctx.fetch(url, { method: "GET", headers: cabeceras, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const texto = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, headers: res.headers };
}

/** Ref del proyecto desde SUPABASE_URL (https://<ref>.supabase.co). */
export function refDeUrl(url: string | undefined): string | null {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.(co|in)\/?$/i.exec((url ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

/** Pone a cada métrica el límite del plan guardado en `servicios_contratados.limites`. */
export function aplicarLimites(metricas: Record<string, Metrica>, limites: unknown): Record<string, Metrica> {
  const salida: Record<string, Metrica> = {};
  for (const [clave, m] of Object.entries(metricas)) {
    const l = esObjeto(limites) && esObjeto(limites[clave]) ? limites[clave] : null;
    const limite = l ? numero(l.limite) : null;
    salida[clave] = limite == null
      ? { ...m }
      : { ...m, limite, unidad_limite: typeof l?.unidad === "string" && l.unidad ? l.unidad : m.unidad };
  }
  return salida;
}

/** Borra de cualquier texto los valores de los secretos (defensa en profundidad). */
export function ocultarSecretos<T>(dato: T, env: (n: string) => string | undefined): T {
  const valores = SECRETOS.map((n) => (env(n) ?? "").trim()).filter((v) => v.length >= 8);
  if (valores.length === 0) return dato;
  const limpiar = (v: unknown): unknown => {
    if (typeof v === "string") return valores.reduce((t, s) => t.split(s).join("[oculto]"), v);
    if (Array.isArray(v)) return v.map(limpiar);
    if (esObjeto(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpiar(x)]));
    return v;
  };
  return limpiar(dato) as T;
}

// ─── Vercel ─────────────────────────────────────────────────────────────────

/** Filas de la respuesta de /v2/usage, sea cual sea el envoltorio. */
function filasDeUso(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter(esObjeto);
  if (!esObjeto(json)) return [];
  for (const clave of ["data", "usage", "results", "result", "items"]) {
    const v = json[clave];
    if (Array.isArray(v)) return v.filter(esObjeto);
    if (esObjeto(v)) {
      const listas = Object.values(v).filter(Array.isArray) as unknown[][];
      return listas.length ? listas.flat().filter(esObjeto) : [v];
    }
  }
  return [json];
}

/** Suma por clave todos los campos numéricos (un nivel de anidación: «padre_hijo»). */
export function sumarCampos(json: unknown): Record<string, number> {
  const sumas: Record<string, number> = {};
  const ignorar = /(time|date|^day$|period|start|end|_at$|^ts$|^id$)/i;
  const sumar = (clave: string, v: unknown) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : null;
    if (n != null && !ignorar.test(clave)) sumas[clave] = (sumas[clave] ?? 0) + n;
  };
  for (const fila of filasDeUso(json)) {
    for (const [k, v] of Object.entries(fila)) {
      if (esObjeto(v)) for (const [k2, v2] of Object.entries(v)) sumar(`${k}_${k2}`, v2);
      else sumar(k, v);
    }
  }
  return sumas;
}

function sumaDe(sumas: Record<string, number>, incluye: RegExp, excluye?: RegExp): number | undefined {
  let total = 0;
  let hay = false;
  for (const [k, v] of Object.entries(sumas)) {
    if (incluye.test(k) && !excluye?.test(k)) {
      total += v;
      hay = true;
    }
  }
  return hay ? total : undefined;
}

export interface UsoVercel {
  peticiones?: number;
  bytesServidos?: number;
  bytesOrigen?: number;
  invocaciones?: number;
  cpuHoras?: number;
  imagenes?: number;
  claves: string[];
}

/**
 * Interpreta /v2/usage (la API que usa el propio panel de Vercel; NO está
 * documentada). Se reconocen los nombres de campo conocidos y parecidos; si
 * Vercel los cambia, la métrica sale «sin dato» y se avisa con las claves vistas.
 */
export function resumirUsoVercel(json: unknown): UsoVercel {
  const s = sumarCampos(json);
  const ms = sumaDe(s, /active_cpu.*(_ms|millis)/i);
  return {
    peticiones:
      sumaDe(s, /^request_(hit|miss)_count$/i) ??
      sumaDe(s, /^(edge_|cdn_)?requests?(_count)?$/i) ??
      sumaDe(s, /request.*count/i, /function|invocation|middleware|image|byte|bandwidth|synthetic/i),
    bytesServidos:
      sumaDe(s, /^bandwidth_outgoing_bytes$/i) ??
      sumaDe(s, /(fast_data_transfer|data_transfer_out|outgoing_bytes|bandwidth_out)/i, /origin/i),
    bytesOrigen: sumaDe(s, /(fast_origin_transfer|origin_transfer|origin.*bytes)/i),
    invocaciones:
      sumaDe(s, /^function_invocation_.*_count$/i) ??
      sumaDe(s, /^(function_|serverless_function_)?invocations?(_count)?$/i),
    cpuHoras: ms != null ? ms / 3_600_000 : sumaDe(s, /active_cpu.*hours?$/i),
    imagenes: sumaDe(s, /image.*(transformation|optimization).*count|^source_images?(_count)?$/i),
    claves: Object.keys(s).sort(),
  };
}

export const leerVercel: Lector = async (ctx) => {
  const token = secreto(ctx, "SERVICIOS_VERCEL_TOKEN");
  if (!token) return faltaSecreto("SERVICIOS_VERCEL_TOKEN");
  const equipo = secreto(ctx, "SERVICIOS_VERCEL_TEAM_ID") || VERCEL_TEAM_POR_DEFECTO;
  const cab = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const metricas: Record<string, Metrica> = {};
  const avisos: string[] = [];
  const detalles: Record<string, unknown> = { equipo };

  // 1. Despliegues de las últimas 24 h (API documentada; Hobby: 100 al día).
  const desde = ctx.ahora.getTime() - 86_400_000;
  const d = await pedir(ctx, `https://api.vercel.com/v6/deployments?teamId=${encodeURIComponent(equipo)}&since=${desde}&limit=100`, cab);
  if (d.status === 401 || d.status === 403) return rechazoHttp(d.status, detalles);
  const lista = esObjeto(d.json) && Array.isArray(d.json.deployments) ? d.json.deployments : null;
  if (d.ok && lista) {
    metricas.despliegues_24h = {
      orden: 7, etiqueta: "Publicaciones (despliegues)", valor: lista.length, unidad: "despliegues", periodo: "últimas 24 h",
      ...(lista.length >= 100 ? { nota: "100 o más: la API devuelve como mucho 100." } : {}),
    };
  } else {
    avisos.push(`No se pudieron contar los despliegues (respuesta ${d.status}).`);
  }

  // 2. Uso de los últimos 30 días (API interna del panel de Vercel, no documentada).
  const desde30 = new Date(ctx.ahora.getTime() - 30 * 86_400_000).toISOString();
  const u = await pedir(
    ctx,
    `https://api.vercel.com/v2/usage?type=requests&granularity=day&teamId=${encodeURIComponent(equipo)}&from=${encodeURIComponent(desde30)}&to=${encodeURIComponent(ctx.ahora.toISOString())}`,
    cab,
  );
  if (u.ok) {
    const r = resumirUsoVercel(u.json);
    const periodo = "últimos 30 días";
    if (r.peticiones != null) metricas.peticiones_cdn = { orden: 1, etiqueta: "Visitas a las webs (peticiones al CDN)", valor: Math.round(r.peticiones), unidad: "peticiones", periodo };
    if (r.bytesServidos != null) metricas.transferencia_rapida = { orden: 2, etiqueta: "Datos servidos a los visitantes (Fast Data Transfer)", valor: Math.round(r.bytesServidos), unidad: "bytes", periodo };
    if (r.bytesOrigen != null) metricas.transferencia_origen = { orden: 3, etiqueta: "Datos desde el servidor (Fast Origin Transfer)", valor: Math.round(r.bytesOrigen), unidad: "bytes", periodo };
    if (r.invocaciones != null) metricas.invocaciones_funciones = { orden: 4, etiqueta: "Ejecuciones de funciones", valor: Math.round(r.invocaciones), unidad: "invocaciones", periodo };
    if (r.cpuHoras != null) metricas.cpu_activa = { orden: 5, etiqueta: "Tiempo de CPU de las funciones", valor: redondear(r.cpuHoras, 3), unidad: "horas", periodo };
    if (r.imagenes != null) metricas.transformaciones_imagen = { orden: 6, etiqueta: "Imágenes optimizadas", valor: Math.round(r.imagenes), unidad: "transformaciones", periodo };
    if (r.peticiones == null && r.bytesServidos == null && r.invocaciones == null) {
      avisos.push("Vercel ha cambiado el formato de su API de uso: no se reconocen las cifras.");
      detalles.claves_uso = r.claves.slice(0, 30);
    }
  } else {
    avisos.push(`No se pudo leer el uso de los últimos 30 días (respuesta ${u.status}).`);
  }

  if (avisos.length) detalles.avisos = avisos;
  if (Object.keys(metricas).length === 0) return { metricas, error: "error_api", detalles };
  return { metricas, detalles };
};

// ─── Supabase ───────────────────────────────────────────────────────────────

export const leerSupabase: Lector = async (ctx) => {
  const metricas: Record<string, Metrica> = {};
  const avisos: string[] = [];
  const detalles: Record<string, unknown> = { proyecto: ctx.refProyecto };

  // 1. Con la clave de servicio (siempre): BD, Storage y usuarios activos.
  const { data, error } = await ctx.admin.rpc("servicios_metricas_supabase");
  if (error || !esObjeto(data)) {
    avisos.push("No se pudo medir la base de datos (falta la migración de Servicios o no responde).");
  } else {
    const bd = numero(data.bd_bytes);
    if (bd != null) metricas.bd_tamano = { orden: 1, etiqueta: "Tamaño de la base de datos", valor: bd, unidad: "bytes", periodo: "ahora" };
    const sto = numero(data.storage_bytes);
    if (sto != null) {
      const n = numero(data.storage_objetos);
      metricas.almacenamiento = {
        orden: 2, etiqueta: "Fotos y archivos guardados (Storage)", valor: sto, unidad: "bytes", periodo: "ahora",
        ...(n != null ? { nota: `${n.toLocaleString("es-ES")} archivos en este proyecto.` } : {}),
      };
    }
    const mau = numero(data.usuarios_activos_mes);
    if (mau != null) {
      const total = numero(data.usuarios_total);
      metricas.usuarios_activos_mes = {
        orden: 3, etiqueta: "Usuarios activos este mes", valor: mau, unidad: "usuarios", periodo: "mes en curso",
        ...(total != null ? { nota: `${total.toLocaleString("es-ES")} usuarios dados de alta en este proyecto.` } : {}),
      };
    }
  }

  // 2. Con el token de gestión (opcional): peticiones a la API y ejecuciones de funciones.
  const token = secreto(ctx, "SERVICIOS_SUPABASE_TOKEN");
  if (!token) {
    detalles.secreto_opcional = "SERVICIOS_SUPABASE_TOKEN";
    avisos.push("Sin SERVICIOS_SUPABASE_TOKEN no salen las peticiones a la API ni las ejecuciones de funciones.");
  } else if (!ctx.refProyecto) {
    avisos.push("No se reconoce el proyecto de Supabase (SUPABASE_URL).");
  } else {
    const cab = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const base = `https://api.supabase.com/v1/projects/${ctx.refProyecto}/analytics/endpoints`;
    const c = await pedir(ctx, `${base}/usage.api-counts?interval=7day`, cab);
    if (c.status === 401 || c.status === 403) {
      detalles.token_rechazado = true;
      avisos.push("El token de gestión no tiene permiso de lectura de «Usage Analytics».");
    } else if (c.ok && esObjeto(c.json) && Array.isArray(c.json.result)) {
      let total = 0;
      for (const fila of c.json.result.filter(esObjeto)) {
        for (const [k, v] of Object.entries(fila)) if (/^total_.*requests$/.test(k)) total += numero(v) ?? 0;
      }
      metricas.peticiones_api_7d = {
        orden: 7, etiqueta: "Peticiones a la API", valor: total, unidad: "peticiones", periodo: "últimos 7 días",
        nota: "Base de datos, inicio de sesión, archivos y tiempo real. Informativo: el plan Free no las limita.",
      };
    } else {
      avisos.push(`No se pudieron leer las peticiones a la API (respuesta ${c.status}).`);
    }

    const fin = ctx.ahora.toISOString();
    const inicio = new Date(ctx.ahora.getTime() - 86_400_000 + 60_000).toISOString();
    const sql = "select count(*) as invocaciones from logs where source = 'function_edge_logs'";
    const l = await pedir(
      ctx,
      `${base}/logs?sql=${encodeURIComponent(sql)}&iso_timestamp_start=${encodeURIComponent(inicio)}&iso_timestamp_end=${encodeURIComponent(fin)}`,
      cab,
    );
    const filaLogs = esObjeto(l.json) && Array.isArray(l.json.result) && esObjeto(l.json.result[0]) ? l.json.result[0] : null;
    const inv = filaLogs ? numero(filaLogs.invocaciones) : null;
    if (l.status === 401 || l.status === 403) {
      detalles.token_rechazado = true;
      avisos.push("El token de gestión no tiene permiso de lectura de «Logs».");
    } else if (l.ok && inv != null) {
      metricas.invocaciones_funciones_24h = {
        orden: 6, etiqueta: "Ejecuciones de funciones", valor: inv, unidad: "invocaciones", periodo: "últimas 24 h",
        nota: "El límite del plan (500.000) es por mes; en el plan Free la API solo guarda un día de registros.",
      };
    } else {
      avisos.push(`No se pudieron contar las ejecuciones de funciones (respuesta ${l.status}).`);
    }
  }

  if (avisos.length) detalles.avisos = avisos;
  if (Object.keys(metricas).length === 0) return { metricas, error: "error_api", detalles };
  return { metricas, detalles };
};

// ─── GitHub ─────────────────────────────────────────────────────────────────

export interface UsoGithub {
  computoUsd: number;
  minutos: number;
  almacenamientoGbHoras: number;
}

/** Suma los `usageItems` del informe de facturación (resumen o detalle). */
export function resumirUsoGithub(json: unknown): UsoGithub {
  const items = esObjeto(json) && Array.isArray(json.usageItems) ? json.usageItems.filter(esObjeto) : [];
  const r: UsoGithub = { computoUsd: 0, minutos: 0, almacenamientoGbHoras: 0 };
  for (const it of items) {
    const producto = String(it.product ?? "");
    const unidad = String(it.unitType ?? "");
    const cantidad = numero(it.grossQuantity) ?? numero(it.quantity) ?? 0;
    if (/actions/i.test(producto) && /minute/i.test(unidad)) {
      r.minutos += cantidad;
      r.computoUsd += numero(it.grossAmount) ?? cantidad * (numero(it.pricePerUnit) ?? 0);
    } else if (/(gigabyte|gb).*hour/i.test(unidad)) {
      r.almacenamientoGbHoras += cantidad;
    }
  }
  return r;
}

export const leerGithub: Lector = async (ctx) => {
  const token = secreto(ctx, "SERVICIOS_GITHUB_TOKEN");
  if (!token) return faltaSecreto("SERVICIOS_GITHUB_TOKEN");
  const cuenta = secreto(ctx, "SERVICIOS_GITHUB_OWNER") || GITHUB_OWNER_POR_DEFECTO;
  const cab = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "casa-tomas-panel-servicios",
  };
  const anio = ctx.ahora.getUTCFullYear();
  const mes = ctx.ahora.getUTCMonth() + 1;
  const base = `https://api.github.com/users/${encodeURIComponent(cuenta)}/settings/billing/usage`;
  let r = await pedir(ctx, `${base}/summary?year=${anio}&month=${mes}`, cab);
  if (r.status === 404) r = await pedir(ctx, `${base}?year=${anio}&month=${mes}`, cab);
  if (!r.ok) return rechazoHttp(r.status, { cuenta, permiso_necesario: "Plan (lectura)" });

  const uso = resumirUsoGithub(r.json);
  const horasMes = Math.max(1, (ctx.ahora.getTime() - inicioMesUtc(ctx.ahora).getTime()) / 3_600_000);
  const metricas: Record<string, Metrica> = {
    actions_computo: {
      orden: 1, etiqueta: "Pruebas automáticas (GitHub Actions)", valor: redondear(uso.computoUsd), unidad: "USD", periodo: "mes en curso",
      nota: `${Math.round(uso.minutos).toLocaleString("es-ES")} minutos este mes (precio de lista, antes de descontar lo incluido).`,
    },
    almacenamiento_artefactos: {
      orden: 2, etiqueta: "Almacenamiento de artefactos y paquetes", valor: Math.round((uso.almacenamientoGbHoras / horasMes) * GIB), unidad: "bytes",
      periodo: "media del mes",
    },
    actions_minutos: { orden: 3, etiqueta: "Minutos de Actions", valor: Math.round(uso.minutos), unidad: "minutos", periodo: "mes en curso" },
  };
  const detalles: Record<string, unknown> = { cuenta };
  const yo = await pedir(ctx, "https://api.github.com/user", cab).catch(() => null);
  const plan = yo?.ok && esObjeto(yo.json) && esObjeto(yo.json.plan) ? yo.json.plan.name : null;
  if (typeof plan === "string" && plan) detalles.plan_detectado = plan;
  return { metricas, detalles };
};

// ─── Resend ─────────────────────────────────────────────────────────────────

/** Estimación con nuestras tablas (correos de reservas + newsletter transaccional y contactos). */
async function estimacionResend(ctx: ContextoLector): Promise<Record<string, Metrica>> {
  const { data, error } = await ctx.admin.rpc("servicios_metricas_supabase");
  if (error || !esObjeto(data)) return {};
  const nota = "Estimación con nuestras tablas (reservas y newsletter): Resend no ha dado el dato.";
  const metricas: Record<string, Metrica> = {};
  const mes = (numero(data.correos_reservas_mes) ?? 0) + (numero(data.correos_newsletter_mes) ?? 0);
  const hoy = (numero(data.correos_reservas_hoy) ?? 0) + (numero(data.correos_newsletter_hoy) ?? 0);
  if (data.correos_reservas_mes != null || data.correos_newsletter_mes != null) {
    metricas.correos_mes = { orden: 1, etiqueta: "Correos enviados este mes", valor: mes, unidad: "correos", periodo: "mes en curso", nota };
    metricas.correos_hoy = { orden: 2, etiqueta: "Correos enviados hoy", valor: hoy, unidad: "correos", periodo: "hoy (UTC)", nota };
  }
  const contactos = numero(data.contactos_newsletter);
  if (contactos != null) {
    metricas.contactos_marketing = {
      orden: 3, etiqueta: "Contactos de la newsletter", valor: contactos, unidad: "contactos", periodo: "ahora",
      nota: "Suscriptores activos en nuestra base.",
    };
  }
  return metricas;
}

export const leerResend: Lector = async (ctx) => {
  const metricas = await estimacionResend(ctx);
  const clave = secreto(ctx, "RESEND_API_KEY");
  if (!clave) return faltaSecreto("RESEND_API_KEY", metricas);

  const r = await pedir(ctx, "https://api.resend.com/domains", { Authorization: `Bearer ${clave}`, Accept: "application/json" });
  const mensual = numero(r.headers.get("x-resend-monthly-quota"));
  const diario = numero(r.headers.get("x-resend-daily-quota"));
  const detalles: Record<string, unknown> = {};
  const avisos: string[] = [];
  const restringida = esObjeto(r.json) && r.json.name === "restricted_api_key";

  if ((r.status === 401 || r.status === 403) && !restringida && mensual == null) {
    return { ...rechazoHttp(r.status), metricas };
  }
  const dato = "Dato de Resend (enviados y recibidos).";
  if (mensual != null) metricas.correos_mes = { orden: 1, etiqueta: "Correos enviados este mes", valor: mensual, unidad: "correos", periodo: "mes en curso", nota: dato };
  if (diario != null) {
    // Resend solo manda el tope diario a las cuentas gratuitas.
    metricas.correos_hoy = { orden: 2, etiqueta: "Correos enviados hoy", valor: diario, unidad: "correos", periodo: "hoy (UTC)", nota: dato };
    detalles.plan_detectado = "Free";
  } else if (mensual != null) {
    delete metricas.correos_hoy;
    detalles.plan_detectado = "de pago (sin tope diario)";
  }
  if (r.ok && esObjeto(r.json) && Array.isArray(r.json.data)) {
    const dominios = r.json.data.filter(esObjeto);
    const verificados = dominios.filter((x) => x.status === "verified").length;
    metricas.dominios = {
      orden: 4, etiqueta: "Dominios de envío", valor: dominios.length, unidad: "dominios", periodo: "ahora",
      nota: `${verificados} verificado${verificados === 1 ? "" : "s"}.`,
    };
  } else if (restringida) {
    avisos.push("La clave de Resend solo permite enviar: no se pueden contar los dominios.");
  } else if (!r.ok) {
    avisos.push(`Resend respondió ${r.status} al pedir los dominios.`);
  }
  if (mensual == null) avisos.push("Resend no ha devuelto el contador de correos: se muestra una estimación.");
  if (avisos.length) detalles.avisos = avisos;
  return { metricas, detalles };
};

// ─── Stripe ─────────────────────────────────────────────────────────────────

export function modoStripe(clave: string): "real" | "prueba" | "desconocido" {
  if (/^[sr]k_live_/.test(clave)) return "real";
  if (/^[sr]k_test_/.test(clave)) return "prueba";
  return "desconocido";
}

const MAX_PAGINAS_STRIPE = 5;

export const leerStripe: Lector = async (ctx) => {
  const clave = secreto(ctx, "STRIPE_SECRET_KEY");
  if (!clave) return faltaSecreto("STRIPE_SECRET_KEY");
  const modo = modoStripe(clave);
  const cab = { Authorization: `Bearer ${clave}` };

  const b = await pedir(ctx, "https://api.stripe.com/v1/balance", cab);
  if (!b.ok) return rechazoHttp(b.status, { modo });
  const saldo = (lista: unknown, moneda: string) =>
    (Array.isArray(lista) ? lista.filter(esObjeto) : []).filter((x) => x.currency === moneda).reduce((t, x) => t + (numero(x.amount) ?? 0), 0);
  const disponibles = esObjeto(b.json) && Array.isArray(b.json.available) ? b.json.available.filter(esObjeto) : [];
  const moneda = String(disponibles.find((x) => x.currency === "eur")?.currency ?? disponibles[0]?.currency ?? "eur");

  let cobros = 0;
  let importe = 0;
  let comisiones = 0;
  let reembolsos = 0;
  let truncado = false;
  let despues: string | null = null;
  const desde = Math.floor(inicioMesUtc(ctx.ahora).getTime() / 1000);
  for (let pagina = 0; pagina < MAX_PAGINAS_STRIPE; pagina++) {
    const url = `https://api.stripe.com/v1/balance_transactions?limit=100&created%5Bgte%5D=${desde}${despues ? `&starting_after=${encodeURIComponent(despues)}` : ""}`;
    const t = await pedir(ctx, url, cab);
    if (!t.ok || !esObjeto(t.json) || !Array.isArray(t.json.data)) return rechazoHttp(t.status === 200 ? 502 : t.status, { modo });
    const filas = t.json.data.filter(esObjeto);
    for (const x of filas) {
      if (x.currency !== moneda) continue;
      comisiones += numero(x.fee) ?? 0;
      if (x.type === "charge" || x.type === "payment") {
        cobros += 1;
        importe += numero(x.amount) ?? 0;
      } else if (x.type === "refund" || x.type === "payment_refund") {
        reembolsos += Math.abs(numero(x.amount) ?? 0);
      }
    }
    if (!t.json.has_more || filas.length === 0) break;
    despues = String(filas[filas.length - 1].id ?? "");
    if (pagina === MAX_PAGINAS_STRIPE - 1) truncado = true;
  }

  const unidad = moneda.toUpperCase();
  const periodo = "mes en curso";
  const metricas: Record<string, Metrica> = {
    cobros_mes: { orden: 1, etiqueta: "Cobros este mes", valor: cobros, unidad: "cobros", periodo },
    importe_cobrado_mes: {
      orden: 2, etiqueta: "Importe cobrado este mes", valor: importe / 100, unidad, periodo,
      ...(reembolsos ? { nota: `Reembolsado: ${(reembolsos / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} ${unidad}.` } : {}),
    },
    comisiones_mes: { orden: 3, etiqueta: "Comisiones de Stripe este mes", valor: comisiones / 100, unidad, periodo },
    saldo_disponible: { orden: 4, etiqueta: "Saldo disponible", valor: saldo(esObjeto(b.json) ? b.json.available : null, moneda) / 100, unidad, periodo: "ahora" },
    saldo_pendiente: { orden: 5, etiqueta: "Saldo pendiente de liberar", valor: saldo(esObjeto(b.json) ? b.json.pending : null, moneda) / 100, unidad, periodo: "ahora" },
  };
  const detalles: Record<string, unknown> = { modo, moneda: unidad };
  if (truncado) detalles.avisos = [`Más de ${MAX_PAGINAS_STRIPE * 100} movimientos este mes: las cifras del mes son parciales.`];
  return { metricas, detalles };
};

export const LECTORES: Record<string, Lector> = {
  vercel: leerVercel,
  supabase: leerSupabase,
  github: leerGithub,
  resend: leerResend,
  stripe: leerStripe,
};

// ─── manejador HTTP ─────────────────────────────────────────────────────────

export interface DependenciasServicios {
  crearCliente: FabricaCliente;
  env?: (nombre: string) => string | undefined;
  fetch?: typeof fetch;
  ahora?: () => Date;
  lectores?: Record<string, Lector>;
}

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nombre);
}

const json = (cuerpo: unknown, status = 200) => respuestaJson(cuerpo, status, CORS);

function esSinMigracion(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" ||
    /servicios_(contratados|uso)|does not exist|schema cache/i.test(error.message ?? "");
}

/** `?forzar=1` o { forzar: true }; `?proveedor=x` o { proveedor: "x" } fuerza solo ese. */
async function opcionesDe(req: Request): Promise<{ forzar: boolean; solo: string | null }> {
  const q = new URL(req.url).searchParams;
  const cuerpo = req.method === "POST" ? await req.clone().json().catch(() => null) : null;
  const forzar = q.get("forzar") === "1" || (esObjeto(cuerpo) && cuerpo.forzar === true);
  const p = q.get("proveedor") ?? (esObjeto(cuerpo) && typeof cuerpo.proveedor === "string" ? cuerpo.proveedor : null);
  return { forzar, solo: p && /^[a-z0-9_-]{2,40}$/.test(p) ? p : null };
}

function aRespuesta(fila: LecturaGuardada, desdeCache: boolean, guardada: boolean): LecturaRespuesta {
  const detalles = esObjeto(fila.detalles) ? fila.detalles : {};
  return {
    proveedor: fila.proveedor,
    tomado_en: fila.tomado_en,
    metricas: esObjeto(fila.metricas) ? (fila.metricas as Record<string, Metrica>) : {},
    error: fila.error ?? null,
    ...(fila.error === "falta_secreto" && typeof detalles.secreto === "string" ? { secreto: detalles.secreto } : {}),
    detalles,
    desde_cache: desdeCache,
    guardada,
  };
}

export function crearManejador(deps: DependenciasServicios): (req: Request) => Promise<Response> {
  const env = deps.env ?? envDeDeno;
  const lectores = deps.lectores ?? LECTORES;
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "GET" && req.method !== "POST") return json({ error: "metodo_no_permitido" }, 405);

    const autorizado = await exigirSuperAdmin(req, { crearCliente: deps.crearCliente, env, corsHeaders: CORS });
    if (!autorizado.ok) return autorizado.response;

    const { forzar, solo } = await opcionesDe(req);
    const admin = deps.crearCliente(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as ClienteAdmin;

    const servicios = await admin.from("servicios_contratados").select("proveedor, limites");
    if (servicios.error) {
      console.error("[servicios-uso] servicios_contratados:", servicios.error.message);
      return esSinMigracion(servicios.error) ? json({ error: "sin_migracion" }, 503) : json({ error: "error_bd" }, 500);
    }
    const ultimas = await admin.rpc("servicios_uso_ultimas");
    if (ultimas.error) {
      console.error("[servicios-uso] servicios_uso_ultimas:", ultimas.error.message);
      return esSinMigracion(ultimas.error) ? json({ error: "sin_migracion" }, 503) : json({ error: "error_bd" }, 500);
    }

    const limites = new Map<string, unknown>();
    for (const s of (Array.isArray(servicios.data) ? servicios.data : []).filter(esObjeto)) limites.set(String(s.proveedor), s.limites);
    const previas = new Map<string, LecturaGuardada>();
    for (const u of (Array.isArray(ultimas.data) ? ultimas.data : []).filter(esObjeto)) previas.set(String(u.proveedor), u as unknown as LecturaGuardada);

    const ahora = (deps.ahora ?? (() => new Date()))();
    const ctx: ContextoLector = { env, fetch: deps.fetch ?? fetch, ahora, admin, refProyecto: refDeUrl(env("SUPABASE_URL")) };
    const proveedores = Object.keys(lectores).filter((p) => limites.has(p));

    const lecturas = await Promise.all(proveedores.map(async (p): Promise<LecturaRespuesta> => {
      const previa = previas.get(p);
      const edad = previa ? ahora.getTime() - Date.parse(previa.tomado_en) : Number.POSITIVE_INFINITY;
      const forzarEste = forzar && (!solo || solo === p);
      // Con `proveedor`, los demás se devuelven tal cual estén guardados.
      if (previa && (edad < MIN_FORZAR_MS || (!forzarEste && (edad < CACHE_MS || (solo && solo !== p))))) return aRespuesta(previa, true, true);

      let r: ResultadoLector;
      try {
        r = await lectores[p](ctx);
      } catch (e) {
        console.error(`[servicios-uso] ${p}:`, e instanceof Error ? e.name : "error");
        r = { metricas: {}, error: "error_interno", detalles: { avisos: ["No se pudo contactar con el proveedor (sin respuesta o tiempo agotado)."] } };
      }
      const fila: LecturaGuardada = ocultarSecretos({
        proveedor: p,
        tomado_en: ahora.toISOString(),
        metricas: aplicarLimites(r.metricas, limites.get(p)),
        error: r.error ?? null,
        detalles: r.detalles ?? {},
      }, env);
      const { error } = await admin.from("servicios_uso").insert(fila);
      if (error) console.error(`[servicios-uso] no se guardó la lectura de ${p}:`, error.message);
      return aRespuesta(fila, false, !error);
    }));

    if (lecturas.some((l) => !l.desde_cache)) {
      const corte = new Date(ahora.getTime() - RETENCION_DIAS * 86_400_000).toISOString();
      const { error } = await admin.from("servicios_uso").delete().lt("tomado_en", corte);
      if (error) console.error("[servicios-uso] limpieza del histórico:", error.message);
    }

    return json(ocultarSecretos({ lecturas, forzado: forzar, proveedor: solo, generado_en: ahora.toISOString() }, env));
  };
}
