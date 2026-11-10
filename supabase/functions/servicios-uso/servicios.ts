// ============================================================================
//  servicios-uso · consumo de los servicios contratados (Super Admin › Servicios)
// ----------------------------------------------------------------------------
//  Quién: SOLO un super admin (exigirSuperAdmin → is_super_admin). Ser admin no
//  basta. verify_jwt = true en config.toml (prefiltro), autorización aquí.
//
//  Qué hace: para cada proveedor EN USO (`activo`) de `servicios_contratados`
//  que tenga lector (Vercel, Supabase, GitHub, Resend, Stripe, OpenAI, Vapi,
//  Hostinger, Google Drive y Mapbox) lee su consumo (por API con su secreto o de nuestra base de
//  datos), le pone el límite del plan (de `servicios_contratados.limites`),
//  calcula lo gastado por uso este mes (`coste_variable`) cuando se puede,
//  guarda una fila en `servicios_uso` y devuelve la última lectura de cada uno.
//  Los proveedores sin API razonable (Google Maps, Loading…) salen en
//  `sin_lector`: la pantalla dice que se miren en su panel.
//    · Caché: si la última lectura tiene < 15 min, no llama a la API salvo
//      `?forzar=1` (o cuerpo { "forzar": true }); aun forzando, nunca más de
//      una lectura por minuto y proveedor. Con { "proveedor": "vercel" } solo
//      se fuerza ese (botón «Actualizar ahora» de cada tarjeta).
//    · Sin el secreto de un proveedor → { error: "falta_secreto", secreto:
//      "NOMBRE" } para él, sin romper el resto.
//    · Supabase mide BD, Storage y usuarios activos con la clave de servicio
//      (RPC servicios_metricas_supabase) aunque falte SERVICIOS_SUPABASE_TOKEN.
//      De la misma RPC salen, sin ningún secreto: el gasto de IA del mes
//      (OpenAI real + estimado) frente al tope, las comisiones de Stripe de
//      los cheques regalo y las llamadas del asistente (call_logs).
//    · NUNCA devuelve ni guarda una clave: solo códigos y textos propios (los
//      mensajes de error de los proveedores no se reenvían) y, por si acaso,
//      cualquier valor de un secreto se borra de la respuesta.
//
//  Secretos (Supabase → Edge Functions → Secrets; los crea el dueño):
//    SERVICIOS_VERCEL_TOKEN  (+ SERVICIOS_VERCEL_TEAM_ID, por defecto el equipo casa-tomas)
//    SERVICIOS_SUPABASE_TOKEN (token de gestión: Usage Analytics y Logs, lectura)
//    SERVICIOS_GITHUB_TOKEN  (+ SERVICIOS_GITHUB_OWNER, por defecto restcasatomascrevillent;
//                             SERVICIOS_GITHUB_REPOS, por defecto web/admin/touza-casatomas)
//    RESEND_API_KEY          (ya existe en producción)
//    STRIPE_SECRET_KEY       (ya existe en producción; el modo sale del prefijo)
//    VAPI_API_KEY            (opcional; la usa vapi-analytics: coste de Vapi del mes)
//    SERVICIOS_HOSTINGER_TOKEN (suscripciones y dominios con su caducidad)
//    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (ya existen si
//                            se guardan copias de facturas en Drive: espacio de la cuenta)
//  Mapbox no tiene API de consumo: cuenta las cargas del mapa de vinos con la
//  RPC servicios_cargas_mapa_vinos (logs de la web; un mínimo), sin secreto.
// ============================================================================
import { exigirSuperAdmin, respuestaJson, type FabricaCliente } from "../_shared/autorizacion.ts";
import { ClienteDrive, ErrorDrive, URL_DRIVE } from "../_shared/google-drive.ts";

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
  "VAPI_API_KEY",
  "SERVICIOS_HOSTINGER_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
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

/** Lo gastado por uso en el periodo (IA, llamadas, comisiones…), en su moneda original. */
export interface CosteVariable {
  importe: number;
  moneda: string;
  periodo: string;
  /** api = dato del proveedor; bd = de nuestras tablas; estimado = cálculo aproximado. */
  origen: "api" | "bd" | "estimado";
  nota?: string;
}

export interface ResultadoLector {
  metricas: Record<string, Metrica>;
  error?: CodigoError | null;
  detalles?: Record<string, unknown>;
  coste_variable?: CosteVariable | null;
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
  coste_variable?: CosteVariable | null;
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

/** GET (o POST con `cuerpo`) con tiempo límite. No lanza por códigos HTTP; sí por red o tiempo agotado. */
async function pedir(ctx: ContextoLector, url: string, cabeceras: Record<string, string>, cuerpo?: unknown): Promise<Http> {
  const res = await ctx.fetch(url, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: cuerpo === undefined ? cabeceras : { ...cabeceras, "Content-Type": "application/json" },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, headers: res.headers };
}

// Varias tarjetas leen la misma RPC (Supabase, Resend, OpenAI, Stripe, Vapi):
// una sola llamada por petición.
const cacheMetricasBd = new WeakMap<ContextoLector, Promise<Record<string, unknown> | null>>();

/** `servicios_metricas_supabase()` (clave de servicio), una vez por petición; null si falla. */
export function metricasBd(ctx: ContextoLector): Promise<Record<string, unknown> | null> {
  let p = cacheMetricasBd.get(ctx);
  if (!p) {
    p = Promise.resolve(ctx.admin.rpc("servicios_metricas_supabase"))
      .then(({ data, error }) => (error || !esObjeto(data) ? null : data))
      .catch(() => null);
    cacheMetricasBd.set(ctx, p);
  }
  return p;
}

/** Euros por dólar de la pantalla (servicios_config) o 0,92 si no hay. */
export const CAMBIO_POR_DEFECTO = 0.92;
const cambioDe = (d: Record<string, unknown> | null) => {
  const n = d ? numero(d.eur_por_usd) : null;
  return n != null && n > 0.2 && n < 5 ? n : CAMBIO_POR_DEFECTO;
};
const fmtNum = (n: number, decimales = 2) => n.toLocaleString("es-ES", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
/** «2026-11-01» → «01/11/2026». */
const fechaEs = (iso: unknown) => {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

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

/** Último valor (de la última fila con él) de los campos que casan: para niveles como el almacenamiento, que no se suman. */
export function ultimoDe(json: unknown, incluye: RegExp): number | undefined {
  let ultimo: number | undefined;
  for (const fila of filasDeUso(json)) {
    let suma: number | undefined;
    for (const [k, v] of Object.entries(fila)) {
      if (typeof v === "number" && Number.isFinite(v) && incluye.test(k)) suma = (suma ?? 0) + v;
    }
    if (suma != null) ultimo = suma;
  }
  return ultimo;
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
  /** Memoria aprovisionada de las funciones (GB-hora). */
  gbHoras?: number;
  imagenes?: number;
  /** % de las peticiones servidas desde la caché del CDN (aciertos / total). */
  aciertosCache?: number;
  /** Almacenamiento de los despliegues y de las funciones (bytes, último día). Hobby no los da hoy. */
  bytesDespliegues?: number;
  bytesFunciones?: number;
  /** Peticiones de cada proyecto (del reparto diario «breakdown.requests»), de más a menos. */
  porProyecto: Array<{ proyecto: string; peticiones: number }>;
  claves: string[];
}

/** Reparte las peticiones de cada día entre los proyectos según `breakdown.requests` (en %). */
function peticionesPorProyecto(json: unknown): Array<{ proyecto: string; peticiones: number }> {
  const suma = new Map<string, number>();
  for (const fila of filasDeUso(json)) {
    const total = (numero(fila.request_hit_count) ?? 0) + (numero(fila.request_miss_count) ?? 0);
    const reparto = esObjeto(fila.breakdown) && Array.isArray(fila.breakdown.requests) ? fila.breakdown.requests.filter(esObjeto) : [];
    for (const r of reparto) {
      const nombre = typeof r.name === "string" ? r.name : typeof r.title === "string" ? r.title : null;
      const pct = numero(r.percent);
      if (nombre && pct != null) suma.set(nombre, (suma.get(nombre) ?? 0) + (total * pct) / 100);
    }
  }
  return [...suma].map(([proyecto, peticiones]) => ({ proyecto, peticiones: Math.round(peticiones) }))
    .sort((a, b) => b.peticiones - a.peticiones);
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
    gbHoras: sumaDe(s, /^function_execution_.*gb_hours?$/i) ?? sumaDe(s, /(provisioned_memory|memory).*gb_hours?$/i),
    imagenes: sumaDe(s, /image.*(transformation|optimization).*count|^source_images?(_count)?$/i),
    aciertosCache: (() => {
      const aciertos = sumaDe(s, /^request_hit_count$/i);
      const fallos = sumaDe(s, /^request_miss_count$/i);
      return aciertos != null && fallos != null && aciertos + fallos > 0 ? (aciertos / (aciertos + fallos)) * 100 : undefined;
    })(),
    // Hobby no los da por API (comprobado el 10/11/2026); si un día salen, se leen.
    bytesDespliegues: ultimoDe(json, /deployment.*(storage|size).*bytes?$|^deployments?_storage(_bytes)?$/i),
    bytesFunciones: ultimoDe(json, /(function|lambda).*(storage|size).*bytes?$|^functions?_storage(_bytes)?$/i),
    porProyecto: peticionesPorProyecto(json),
    claves: Object.keys(s).sort(),
  };
}

/** Compilaciones (/v2/usage?type=builds): cuántas, cuántas fallaron y horas compilando. */
export function resumirCompilacionesVercel(json: unknown): { total: number; fallidas: number; horas: number } | null {
  const s = sumarCampos(json);
  const ok = sumaDe(s, /^build_completed_count$/i);
  const mal = sumaDe(s, /^build_failed_count$/i);
  if (ok == null && mal == null) return null;
  return { total: (ok ?? 0) + (mal ?? 0), fallidas: mal ?? 0, horas: (sumaDe(s, /^build_build_seconds$/i) ?? 0) / 3600 };
}

/** «admin 68 % · web 31 % · touza 1 %». */
const textoReparto = (lista: Array<{ proyecto: string; peticiones: number }>) => {
  const total = lista.reduce((t, x) => t + x.peticiones, 0);
  return total > 0 ? lista.map((x) => `${x.proyecto.replace(/-casatomas$/, "")} ${Math.round((x.peticiones / total) * 100)} %`).join(" · ") : "";
};

/**
 * Recortes de fotos en el servidor (api/recortar-foto del panel, migración
 * 20261103180000): nº de fotos del mes y de hoy y minutos de CPU anotados,
 * frente a los topes del panel (recortes_servidor_mes/_dia, cpu_recortes_mes
 * en los límites de Vercel). Sale de nuestra BD: no necesita el token de Vercel.
 */
export async function metricasRecorteServidor(ctx: ContextoLector): Promise<Record<string, Metrica>> {
  const { data, error } = await ctx.admin.rpc("recorte_servidor_uso");
  if (error || !esObjeto(data)) return {};
  const n = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : Number(data[k] ?? 0));
  const minutos = redondear(n("cpu_ms_mes") / 60_000, 1);
  return {
    recortes_servidor_mes: {
      orden: 8, etiqueta: "Recortes de fotos en el servidor (tope del panel)", valor: n("recortes_mes"), unidad: "fotos", periodo: "mes en curso",
      nota: `${minutos} min de CPU este mes. Al llegar al tope, el móvil deja las fotos para un ordenador.`,
    },
    recortes_servidor_dia: { orden: 9, etiqueta: "Recortes de fotos en el servidor hoy (tope del panel)", valor: n("recortes_dia"), unidad: "fotos", periodo: "hoy" },
    cpu_recortes_mes: { orden: 10, etiqueta: "CPU de los recortes en el servidor (tope del panel)", valor: minutos, unidad: "minutos", periodo: "mes en curso" },
  };
}

export const leerVercel: Lector = async (ctx) => {
  const recortes = await metricasRecorteServidor(ctx);
  const token = secreto(ctx, "SERVICIOS_VERCEL_TOKEN");
  if (!token) return faltaSecreto("SERVICIOS_VERCEL_TOKEN", recortes);
  const equipo = secreto(ctx, "SERVICIOS_VERCEL_TEAM_ID") || VERCEL_TEAM_POR_DEFECTO;
  const cab = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const metricas: Record<string, Metrica> = { ...recortes };
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
    if (r.peticiones != null) {
      const notas = [
        r.porProyecto.length ? `Por proyecto: ${textoReparto(r.porProyecto)}.` : "",
        r.aciertosCache != null ? `${Math.round(r.aciertosCache)} % servidas desde la caché del CDN.` : "",
      ].filter(Boolean);
      metricas.peticiones_cdn = {
        orden: 1, etiqueta: "Visitas a las webs (peticiones al CDN)", valor: Math.round(r.peticiones), unidad: "peticiones", periodo,
        ...(notas.length ? { nota: notas.join(" ") } : {}),
      };
    }
    if (r.porProyecto.length) detalles.peticiones_por_proyecto = r.porProyecto.slice(0, 10);
    if (r.aciertosCache != null) detalles.aciertos_cache = Math.round(r.aciertosCache);
    if (r.bytesServidos != null) metricas.transferencia_rapida = { orden: 2, etiqueta: "Datos servidos a los visitantes (Fast Data Transfer)", valor: Math.round(r.bytesServidos), unidad: "bytes", periodo };
    if (r.bytesOrigen != null) metricas.transferencia_origen = { orden: 3, etiqueta: "Datos desde el servidor (Fast Origin Transfer)", valor: Math.round(r.bytesOrigen), unidad: "bytes", periodo };
    if (r.invocaciones != null) metricas.invocaciones_funciones = { orden: 4, etiqueta: "Ejecuciones de funciones", valor: Math.round(r.invocaciones), unidad: "invocaciones", periodo };
    if (r.cpuHoras != null) {
      metricas.cpu_activa = { orden: 5, etiqueta: "Tiempo de CPU de las funciones", valor: redondear(r.cpuHoras, 3), unidad: "horas", periodo };
      const rec = recortes.recortes_servidor_mes;
      if (rec) metricas.cpu_activa.nota = `De ellas, recortes de fotos este mes: ${rec.valor} fotos, ${recortes.cpu_recortes_mes?.valor ?? 0} min (este proyecto de Supabase).`;
    }
    if (r.gbHoras != null) {
      metricas.memoria_funciones = {
        orden: 5.5, etiqueta: "Memoria de las funciones", valor: redondear(r.gbHoras, 3), unidad: "GB-hora", periodo,
        // Límite del plan Hobby si servicios_contratados no tiene uno (20261120100000 lo añade, editable).
        limite: 360, unidad_limite: "GB-hora",
      };
    }
    // Almacenamiento (petición del dueño, 10/11/2026). Es «ahora», no del periodo: el último valor del día.
    if (r.bytesDespliegues != null) metricas.almacenamiento_despliegues = { orden: 11, etiqueta: "Almacenamiento de los despliegues (Deployment Storage)", valor: Math.round(r.bytesDespliegues), unidad: "bytes", periodo: "ahora" };
    if (r.bytesFunciones != null) metricas.almacenamiento_funciones = { orden: 12, etiqueta: "Almacenamiento de las funciones (Functions Storage)", valor: Math.round(r.bytesFunciones), unidad: "bytes", periodo: "ahora" };
    if (r.imagenes != null) metricas.transformaciones_imagen = { orden: 6, etiqueta: "Imágenes optimizadas", valor: Math.round(r.imagenes), unidad: "transformaciones", periodo };
    if (r.peticiones == null && r.bytesServidos == null && r.invocaciones == null) {
      avisos.push("Vercel ha cambiado el formato de su API de uso: no se reconocen las cifras.");
      detalles.claves_uso = r.claves.slice(0, 30);
    }
  } else {
    avisos.push(`No se pudo leer el uso de los últimos 30 días (respuesta ${u.status}).`);
  }

  // 3. Compilaciones de los últimos 30 días (misma API interna). Informativo: el plan no las limita.
  if (u.ok) {
    const b = await pedir(
      ctx,
      `https://api.vercel.com/v2/usage?type=builds&granularity=day&teamId=${encodeURIComponent(equipo)}&from=${encodeURIComponent(desde30)}&to=${encodeURIComponent(ctx.ahora.toISOString())}`,
      cab,
    ).catch(() => null);
    const c = b?.ok ? resumirCompilacionesVercel(b.json) : null;
    if (c) {
      metricas.compilaciones_30d = {
        orden: 7.5, etiqueta: "Compilaciones", valor: c.total, unidad: "compilaciones", periodo: "últimos 30 días",
        nota: `${c.fallidas.toLocaleString("es-ES")} fallidas · ${fmtNum(c.horas, 1)} h compilando. Cada cambio que se sube compila las webs que toca.`,
      };
    }
  }

  if (avisos.length) detalles.avisos = avisos;
  if (Object.keys(metricas).length === Object.keys(recortes).length) return { metricas, error: "error_api", detalles };
  return { metricas, detalles };
};

// ─── Supabase ───────────────────────────────────────────────────────────────

/** «12,3 MB»: tamaño corto para las notas. */
const tamanoCorto = (bytes: number) => {
  for (const [u, f] of [["GB", GIB], ["MB", 1024 ** 2], ["kB", 1024]] as const) if (bytes >= f) return `${fmtNum(bytes / f, bytes >= 10 * f ? 0 : 1)} ${u}`;
  return `${Math.round(bytes)} B`;
};

/**
 * Cuánto ha crecido la base de datos: la lectura de Supabase de hace 7 días (o, si aún no hay
 * tantas, la más antigua de hace al menos un día) frente a ahora. null si no hay con qué comparar.
 */
export async function crecimientoBd(ctx: ContextoLector, bytesAhora: number): Promise<{ bytes: number; dias: number; desde: string } | null> {
  const anterior = async (hasta: Date, masReciente: boolean) => {
    try {
      const { data, error } = await ctx.admin.from("servicios_uso").select("tomado_en, metricas")
        .eq("proveedor", "supabase").lte("tomado_en", hasta.toISOString())
        .order("tomado_en", { ascending: !masReciente }).limit(5);
      if (error || !Array.isArray(data)) return null;
      return (data as Array<Record<string, unknown>>).find((f) => esObjeto(f.metricas) && esObjeto(f.metricas.bd_tamano) && numero(f.metricas.bd_tamano.valor) != null) ?? null;
    } catch {
      return null;
    }
  };
  const hace7 = new Date(ctx.ahora.getTime() - 7 * 86_400_000);
  const fila = (await anterior(hace7, true)) ?? (await anterior(new Date(ctx.ahora.getTime() - 86_400_000), false));
  if (!fila) return null;
  const antes = numero((fila.metricas as Record<string, Record<string, unknown>>).bd_tamano.valor)!;
  const desde = String(fila.tomado_en);
  const dias = Math.max(1, Math.round((ctx.ahora.getTime() - Date.parse(desde)) / 86_400_000));
  return { bytes: bytesAhora - antes, dias, desde };
}

const TIPOS_PETICION: Array<[RegExp, string]> = [
  [/rest/, "base de datos"],
  [/auth/, "inicio de sesión"],
  [/storage/, "archivos"],
  [/realtime/, "tiempo real"],
];

export const leerSupabase: Lector = async (ctx) => {
  const metricas: Record<string, Metrica> = {};
  const avisos: string[] = [];
  const detalles: Record<string, unknown> = { proyecto: ctx.refProyecto };

  // 1. Con la clave de servicio (siempre): BD, Storage y usuarios activos.
  const data = await metricasBd(ctx);
  if (!data) {
    avisos.push("No se pudo medir la base de datos (falta la migración de Servicios o no responde).");
  } else {
    const bd = numero(data.bd_bytes);
    if (bd != null) {
      metricas.bd_tamano = { orden: 1, etiqueta: "Tamaño de la base de datos", valor: bd, unidad: "bytes", periodo: "ahora" };
      const c = await crecimientoBd(ctx, bd);
      if (c) {
        metricas.bd_crecimiento = {
          orden: 1.5, etiqueta: "Crecimiento de la base de datos", valor: c.bytes, unidad: "bytes",
          periodo: c.dias === 7 ? "últimos 7 días" : `desde el ${fechaEs(c.desde)}`,
          nota: `${c.bytes >= 0 ? "+" : "−"}${tamanoCorto(Math.abs(c.bytes))} en ${c.dias} día${c.dias === 1 ? "" : "s"}.`,
        };
      }
    }
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

  // 1b. Conexiones abiertas y tablas que más ocupan (RPC de 20261120100000; sin ella, no salen).
  const extra = await Promise.resolve(ctx.admin.rpc("servicios_metricas_bd_extra")).catch(() => null);
  const ex = extra && !extra.error && esObjeto(extra.data) ? extra.data : null;
  if (ex) {
    const n = numero(ex.conexiones);
    const max = numero(ex.conexiones_max);
    if (n != null) {
      metricas.conexiones = {
        orden: 4, etiqueta: "Conexiones a la base de datos", valor: n, unidad: "conexiones", periodo: "ahora",
        ...(max != null && max > 0 ? { limite: max, unidad_limite: "conexiones" } : {}),
        nota: "Las abiertas ahora mismo (panel, webs y servicios de Supabase). El máximo lo fija el tamaño del servidor.",
      };
    }
    const tablas = Array.isArray(ex.tablas_mayores)
      ? ex.tablas_mayores.filter(esObjeto).filter((t) => typeof t.tabla === "string" && numero(t.bytes) != null)
        .slice(0, 5).map((t) => ({ tabla: String(t.tabla).slice(0, 80), bytes: numero(t.bytes)! }))
      : [];
    if (tablas.length) {
      detalles.tablas_mayores = tablas;
      if (metricas.bd_tamano) metricas.bd_tamano.nota = `Lo que más ocupa: ${tablas.slice(0, 3).map((t) => `${t.tabla} ${tamanoCorto(t.bytes)}`).join(" · ")}.`;
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
      const porTipo: Record<string, number> = {};
      for (const fila of c.json.result.filter(esObjeto)) {
        for (const [k, v] of Object.entries(fila)) {
          if (!/^total_.*requests$/.test(k)) continue;
          const n = numero(v) ?? 0;
          total += n;
          const tipo = TIPOS_PETICION.find(([re]) => re.test(k))?.[1] ?? "otras";
          porTipo[tipo] = (porTipo[tipo] ?? 0) + n;
        }
      }
      const reparto = Object.entries(porTipo).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      if (reparto.length) detalles.peticiones_por_tipo = Object.fromEntries(reparto);
      metricas.peticiones_api_7d = {
        orden: 7, etiqueta: "Peticiones a la API", valor: total, unidad: "peticiones", periodo: "últimos 7 días",
        nota: `${reparto.length ? `${reparto.map(([t, n]) => `${t} ${n.toLocaleString("es-ES")}`).join(" · ")}. ` : ""}Informativo: el plan Free no las limita.`,
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
  /** Lo que de verdad se factura (netAmount, tras descontar lo incluido); null si el informe no lo trae. */
  netoUsd: number | null;
  /**
   * Minutos y dólares (precio de lista) de los repositorios PÚBLICOS: GitHub no los cobra ni
   * cuentan para los 2.000 minutos incluidos (09/11/2026: web, admin y touza son públicos y el
   * informe los sumaba, con un «157 %» rojo que no lo era). Solo con el informe detallado, que
   * dice el repositorio de cada línea; sin él, 0.
   */
  minutosPublicos: number;
  computoPublicoUsd: number;
  /** Alguna línea dice su repositorio (informe detallado). */
  conRepositorio: boolean;
}

/** «restcasatomascrevillent/web-casatomas» o «web-casatomas» → «web-casatomas». */
const nombreRepo = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? (t.split("/").pop() ?? t).toLowerCase() : null;
};

/**
 * Suma los `usageItems` del informe de facturación (resumen o detalle). `publicos`: repositorios
 * que se sabe que son públicos (sus minutos van aparte). Una línea sin repositorio, o de uno que no
 * se sabe, cuenta como privada: mejor un aviso de más que uno de menos.
 */
export function resumirUsoGithub(json: unknown, publicos: ReadonlySet<string> = new Set()): UsoGithub {
  const items = esObjeto(json) && Array.isArray(json.usageItems) ? json.usageItems.filter(esObjeto) : [];
  const r: UsoGithub = { computoUsd: 0, minutos: 0, almacenamientoGbHoras: 0, netoUsd: null, minutosPublicos: 0, computoPublicoUsd: 0, conRepositorio: false };
  for (const it of items) {
    const producto = String(it.product ?? "");
    const unidad = String(it.unitType ?? "");
    const cantidad = numero(it.grossQuantity) ?? numero(it.quantity) ?? 0;
    const neto = numero(it.netAmount);
    const repo = nombreRepo(it.repositoryName);
    if (repo) r.conRepositorio = true;
    if (neto != null) r.netoUsd = (r.netoUsd ?? 0) + neto;
    if (/actions/i.test(producto) && /minute/i.test(unidad)) {
      const usd = numero(it.grossAmount) ?? cantidad * (numero(it.pricePerUnit) ?? 0);
      r.minutos += cantidad;
      r.computoUsd += usd;
      if (repo && publicos.has(repo)) {
        r.minutosPublicos += cantidad;
        r.computoPublicoUsd += usd;
      }
    } else if (/(gigabyte|gb).*hour/i.test(unidad)) {
      r.almacenamientoGbHoras += cantidad;
    }
  }
  return r;
}

/** Visibilidad de un repositorio (`private` de la API); null si no se puede saber. */
async function repoEsPublico(ctx: ContextoLector, cab: Record<string, string>, cuenta: string, repo: string): Promise<boolean | null> {
  const r = await pedir(ctx, `https://api.github.com/repos/${encodeURIComponent(cuenta)}/${encodeURIComponent(repo)}`, cab).catch(() => null);
  return r?.ok && esObjeto(r.json) && typeof r.json.private === "boolean" ? !r.json.private : null;
}

/** Repositorios cuyas ejecuciones de GitHub Actions se cuentan (06/11/2026). */
export const GITHUB_REPOS_POR_DEFECTO = ["web-casatomas", "admin-casatomas", "touza-casatomas"];
/** Una ejecución que falla en menos de esto no llegó a empezar: GitHub no le dio máquina. */
export const SEGUNDOS_SIN_ARRANCAR = 20;
/** Con estas seguidas sin arrancar, la tarjeta avisa de que GitHub está bloqueado. */
export const RACHA_BLOQUEO = 3;

export interface EjecucionGithub {
  repo: string;
  creada: string;
  segundos: number;
  estado: string;
  conclusion: string | null;
}

export interface ResumenEjecucionesGithub {
  total: number;
  sinArrancar: number;
  /** Suma de la duración de las que sí arrancaron, por minutos empezados (como factura GitHub). */
  minutosEstimados: number;
  /** Cuántas de las últimas, seguidas, no arrancaron. */
  racha: number;
  bloqueadoDesde: string | null;
  ultimaQueArranco: string | null;
  porRepo: Record<string, { ejecuciones: number; sin_arrancar: number; minutos: number }>;
}

const noArranco = (e: EjecucionGithub) =>
  e.estado === "completed" && e.conclusion === "failure" && e.segundos < SEGUNDOS_SIN_ARRANCAR;

/**
 * Lo que dicen las ejecuciones del mes de los repositorios (06/11/2026, petición del dueño: «añade
 * esas métricas al apartado de servicios para controlarlo»). Detecta el caso de noviembre de 2026:
 * con los minutos gastados, GitHub da por fallidas todas las ejecuciones en 2–4 s sin arrancarlas
 * (ni registro ni máquina), también la copia de seguridad programada.
 */
export function resumirEjecucionesGithub(ejecuciones: EjecucionGithub[]): ResumenEjecucionesGithub {
  const orden = [...ejecuciones].sort((a, b) => b.creada.localeCompare(a.creada));
  const r: ResumenEjecucionesGithub = {
    total: orden.length, sinArrancar: 0, minutosEstimados: 0, racha: 0, bloqueadoDesde: null, ultimaQueArranco: null, porRepo: {},
  };
  let enRacha = true;
  for (const e of orden) {
    const repo = (r.porRepo[e.repo] ??= { ejecuciones: 0, sin_arrancar: 0, minutos: 0 });
    repo.ejecuciones++;
    if (e.estado !== "completed") continue;
    if (noArranco(e)) {
      r.sinArrancar++;
      repo.sin_arrancar++;
      if (enRacha) {
        r.racha++;
        r.bloqueadoDesde = e.creada;
      }
      continue;
    }
    enRacha = false;
    r.ultimaQueArranco ??= e.creada;
    const minutos = Math.ceil(Math.max(0, e.segundos) / 60);
    r.minutosEstimados += minutos;
    repo.minutos += minutos;
  }
  return r;
}

/** Ejecuciones de este mes de un repositorio (hasta 500); null si no hay acceso. */
async function ejecucionesRepo(ctx: ContextoLector, cab: Record<string, string>, cuenta: string, repo: string): Promise<EjecucionGithub[] | null> {
  const desde = inicioMesUtc(ctx.ahora).toISOString().slice(0, 10);
  const out: EjecucionGithub[] = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const url = `https://api.github.com/repos/${encodeURIComponent(cuenta)}/${encodeURIComponent(repo)}/actions/runs?created=${encodeURIComponent(`>=${desde}`)}&per_page=100&page=${pagina}`;
    const r = await pedir(ctx, url, cab).catch(() => null);
    if (!r?.ok || !esObjeto(r.json) || !Array.isArray(r.json.workflow_runs)) return pagina === 1 ? null : out;
    const filas = r.json.workflow_runs.filter(esObjeto);
    for (const f of filas) {
      const inicio = Date.parse(String(f.run_started_at ?? f.created_at ?? ""));
      const fin = Date.parse(String(f.updated_at ?? ""));
      out.push({
        repo,
        creada: String(f.created_at ?? ""),
        segundos: Number.isFinite(inicio) && Number.isFinite(fin) ? Math.max(0, (fin - inicio) / 1000) : 0,
        estado: String(f.status ?? ""),
        conclusion: typeof f.conclusion === "string" ? f.conclusion : null,
      });
    }
    if (filas.length < 100) break;
  }
  return out;
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * GitHub: minutos de Actions del mes frente a lo incluido, ejecuciones por repositorio y si GitHub
 * las está arrancando. Dos fuentes, cada una opcional:
 *  · el informe de facturación (permiso «Plan» de la cuenta): minutos y dólares exactos;
 *  · las ejecuciones de los repositorios (permiso «Actions» de lectura): cuántas, cuántas no
 *    arrancaron, desde cuándo está bloqueado y, sin el informe, una estimación de los minutos.
 * Solo es error si fallan las dos.
 */
export const leerGithub: Lector = async (ctx) => {
  const token = secreto(ctx, "SERVICIOS_GITHUB_TOKEN");
  if (!token) return faltaSecreto("SERVICIOS_GITHUB_TOKEN");
  const cuenta = secreto(ctx, "SERVICIOS_GITHUB_OWNER") || GITHUB_OWNER_POR_DEFECTO;
  const repos = (secreto(ctx, "SERVICIOS_GITHUB_REPOS") || GITHUB_REPOS_POR_DEFECTO.join(","))
    .split(",").map((r) => r.trim()).filter(Boolean);
  const cab = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "casa-tomas-panel-servicios",
  };
  const anio = ctx.ahora.getUTCFullYear();
  const mes = ctx.ahora.getUTCMonth() + 1;
  const base = `https://api.github.com/users/${encodeURIComponent(cuenta)}/settings/billing/usage`;

  // Visibilidad de cada repositorio y ejecuciones del mes, en paralelo.
  const [visibles, porRepo] = await Promise.all([
    Promise.all(repos.map((repo) => repoEsPublico(ctx, cab, cuenta, repo))),
    Promise.all(repos.map((repo) => ejecucionesRepo(ctx, cab, cuenta, repo).catch(() => null))),
  ]);
  const publicos = new Set(repos.filter((_, i) => visibles[i] === true).map((x) => x.toLowerCase()));
  const esPublico = (repo: string) => publicos.has(repo.toLowerCase());

  // El informe detallado dice el repositorio de cada línea (para apartar los públicos); si no
  // está, el resumen del mes.
  let r: Http | null = await pedir(ctx, `${base}?year=${anio}&month=${mes}`, cab).catch(() => null);
  let uso = r?.ok && esObjeto(r.json) && Array.isArray(r.json.usageItems) ? resumirUsoGithub(r.json, publicos) : null;
  if (!uso) {
    r = await pedir(ctx, `${base}/summary?year=${anio}&month=${mes}`, cab);
    uso = r.ok ? resumirUsoGithub(r.json, publicos) : null;
  }

  const conAcceso = repos.filter((_, i) => porRepo[i] !== null);
  const ejecuciones = conAcceso.length ? resumirEjecucionesGithub(porRepo.flatMap((e) => e ?? [])) : null;

  if (!uso && !ejecuciones) return rechazoHttp(r?.status ?? 502, { cuenta, permiso_necesario: "Plan (lectura)" });

  const horasMes = Math.max(1, (ctx.ahora.getTime() - inicioMesUtc(ctx.ahora).getTime()) / 3_600_000);
  const metricas: Record<string, Metrica> = {};
  const detalles: Record<string, unknown> = { cuenta };
  const avisos: string[] = [];
  if (publicos.size) detalles.repos_publicos = repos.filter(esPublico);

  // Minutos de las ejecuciones (estimación) de los repositorios privados y de los públicos.
  const estimados = (publicosSi: boolean) =>
    ejecuciones ? conAcceso.filter((x) => esPublico(x) === publicosSi).reduce((t, x) => t + (ejecuciones.porRepo[x]?.minutos ?? 0), 0) : null;

  // Lo que cuenta para los 2.000 minutos incluidos: solo los repositorios privados.
  let privados: number | null;
  let publicosMin: number | null;
  let usdPrivado: number | null = null;
  let notaMinutos: string;
  if (uso && (uso.conRepositorio || publicos.size === 0)) {
    privados = uso.minutos - uso.minutosPublicos;
    publicosMin = uso.minutosPublicos;
    usdPrivado = uso.computoUsd - uso.computoPublicoUsd;
    notaMinutos = "Dato de GitHub.";
  } else if (uso) {
    // Resumen sin repositorio por línea y algún repositorio público: los privados, por sus ejecuciones.
    privados = estimados(false);
    publicosMin = privados == null ? null : Math.max(0, uso.minutos - privados);
    usdPrivado = privados == null || uso.minutos <= 0 ? null : (uso.computoUsd / uso.minutos) * privados;
    notaMinutos = "Estimación con la duración de las ejecuciones de los repositorios privados: el informe de GitHub no separa los públicos.";
  } else {
    privados = estimados(false);
    publicosMin = publicos.size ? estimados(true) : null;
    notaMinutos = "Estimación con la duración de cada ejecución (GitHub cuenta cada trabajo por separado: el gasto real es algo mayor).";
  }
  if (publicos.size) notaMinutos += ` Los repositorios públicos (${repos.filter(esPublico).map((x) => x.replace(/-casatomas$/, "")).join(", ")}) no cuentan: GitHub no cobra sus minutos.`;

  if (uso) {
    if (usdPrivado != null) {
      const totalMin = Math.round(uso.minutos).toLocaleString("es-ES");
      metricas.actions_computo = {
        orden: 1, etiqueta: "Pruebas automáticas (GitHub Actions)", valor: redondear(Math.max(0, usdPrivado)), unidad: "USD", periodo: "mes en curso",
        nota: publicosMin
          ? `Precio de lista de los minutos de repositorios privados. En total, ${totalMin} minutos este mes (${fmtNum(uso.computoUsd)} US$ a precio de lista); los de repositorios públicos son gratis.`
          : `${totalMin} minutos este mes (precio de lista, antes de descontar lo incluido).`,
      };
    }
    metricas.almacenamiento_artefactos = {
      orden: 4, etiqueta: "Almacenamiento de artefactos y paquetes", valor: Math.round((uso.almacenamientoGbHoras / horasMes) * GIB), unidad: "bytes",
      periodo: "media del mes",
    };
  } else {
    detalles.permiso_faltante = "Plan (lectura): sin él, los minutos son una estimación y no se ve lo facturado.";
  }

  metricas.actions_minutos = {
    orden: 2, etiqueta: publicos.size ? "Minutos de Actions en repositorios privados" : "Minutos de Actions",
    valor: privados == null ? null : Math.round(Math.max(0, privados)), unidad: "minutos", periodo: "mes en curso", nota: notaMinutos,
  };
  if (publicosMin != null && (publicos.size || publicosMin > 0)) {
    metricas.actions_minutos_publicos = {
      orden: 2.5, etiqueta: "Minutos de Actions en repositorios públicos (gratis)", valor: Math.round(publicosMin), unidad: "minutos", periodo: "mes en curso",
      nota: "GitHub no cobra los minutos de los repositorios públicos ni los cuenta en los 2.000 incluidos del plan gratuito.",
    };
  }

  if (ejecuciones) {
    // En el orden configurado y con los que no tienen ninguna (0), para comparar de un vistazo.
    for (const repo of conAcceso) ejecuciones.porRepo[repo] ??= { ejecuciones: 0, sin_arrancar: 0, minutos: 0 };
    const nombres = conAcceso
      .map((repo) => `${repo.replace(/-casatomas$/, "")} ${ejecuciones.porRepo[repo].ejecuciones}`).join(" · ");
    metricas.actions_ejecuciones = {
      orden: 3, etiqueta: "Ejecuciones de Actions", valor: ejecuciones.total, unidad: "ejecuciones", periodo: "mes en curso",
      nota: nombres || undefined,
    };
    metricas.actions_sin_arrancar = {
      orden: 3.5, etiqueta: "Ejecuciones que no arrancaron", valor: ejecuciones.sinArrancar, unidad: "ejecuciones", periodo: "mes en curso",
      nota: `Terminan en menos de ${SEGUNDOS_SIN_ARRANCAR} s sin llegar a empezar: GitHub no les da máquina (minutos agotados o pago).`,
    };
    detalles.repos = conAcceso;
    detalles.ejecuciones_por_repo = ejecuciones.porRepo;
    if (ejecuciones.ultimaQueArranco) detalles.ultima_ejecucion_que_arranco = ejecuciones.ultimaQueArranco;
    if (ejecuciones.racha >= RACHA_BLOQUEO && ejecuciones.bloqueadoDesde) {
      detalles.bloqueado_desde = ejecuciones.bloqueadoDesde;
      avisos.push(
        `GitHub no arranca las pruebas automáticas desde el ${fechaCorta(ejecuciones.bloqueadoDesde)}: las últimas ${ejecuciones.racha} ejecuciones terminan en segundos sin empezar, también la copia de seguridad diaria. Suele ser que se han gastado los minutos del mes o un problema de pago: revisa github.com/settings/billing.`,
      );
    }
    if (conAcceso.length < repos.length) {
      avisos.push(`Sin acceso a las ejecuciones de ${repos.filter((x) => !conAcceso.includes(x)).join(", ")}: dale al token el permiso «Actions» (lectura) en esos repositorios.`);
    }
  } else {
    detalles.permiso_faltante_actions = "Actions (lectura) en los repositorios: sin él no se ven las ejecuciones ni si GitHub está bloqueado.";
  }
  if (avisos.length) detalles.avisos = avisos;

  const yo = await pedir(ctx, "https://api.github.com/user", cab).catch(() => null);
  const plan = yo?.ok && esObjeto(yo.json) && esObjeto(yo.json.plan) ? yo.json.plan.name : null;
  if (typeof plan === "string" && plan) detalles.plan_detectado = plan;
  const coste_variable: CosteVariable | null = uso?.netoUsd == null ? null : {
    importe: redondear(Math.max(0, uso.netoUsd), 4), moneda: "USD", periodo: "mes en curso", origen: "api",
    nota: "Lo que GitHub factura este mes por encima de lo incluido en el plan.",
  };
  return { metricas, detalles, coste_variable };
};

// ─── Resend ─────────────────────────────────────────────────────────────────

/** Estimación con nuestras tablas (correos de reservas + newsletter transaccional y contactos). */
async function estimacionResend(ctx: ContextoLector): Promise<Record<string, Metrica>> {
  const data = await metricasBd(ctx);
  if (!data) return {};
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

/**
 * Cheques regalo cobrados por Stripe este mes y su comisión, de nuestra base
 * de datos (sin clave): la comisión real que guarda el webhook o, si falta, la
 * estimada (1,5 % + 0,25 €), como metricas_cheques_regalo.
 */
async function chequesDeBd(ctx: ContextoLector): Promise<{ metricas: Record<string, Metrica>; coste: CosteVariable | null }> {
  const d = await metricasBd(ctx);
  const n = d ? numero(d.cheques_stripe_mes) : null;
  if (!d || n == null) return { metricas: {}, coste: null };
  const comision = numero(d.cheques_stripe_comision_mes) ?? 0;
  const estimadas = numero(d.cheques_stripe_comision_estimadas) ?? 0;
  const nota = estimadas > 0
    ? `Según nuestra base de datos. ${estimadas} sin comisión guardada: se estima con la tarifa estándar (1,5 % + 0,25 €).`
    : "Según nuestra base de datos (comisión que guarda el webhook de Stripe).";
  const periodo = "mes en curso";
  return {
    metricas: {
      cheques_mes: { orden: 6, etiqueta: "Cheques regalo cobrados por Stripe este mes", valor: n, unidad: "cheques", periodo },
      importe_cheques_mes: { orden: 7, etiqueta: "Importe de esos cheques", valor: redondear(numero(d.cheques_stripe_importe_mes) ?? 0), unidad: "EUR", periodo },
      comision_cheques_mes: { orden: 8, etiqueta: "Comisión de Stripe de esos cheques", valor: redondear(comision), unidad: "EUR", periodo, nota },
    },
    coste: { importe: redondear(comision), moneda: "EUR", periodo, origen: estimadas > 0 ? "estimado" : "bd", nota },
  };
}

export const leerStripe: Lector = async (ctx) => {
  const bd = await chequesDeBd(ctx);
  const clave = secreto(ctx, "STRIPE_SECRET_KEY");
  if (!clave) return { ...faltaSecreto("STRIPE_SECRET_KEY", bd.metricas), coste_variable: bd.coste };
  const modo = modoStripe(clave);
  const cab = { Authorization: `Bearer ${clave}` };

  const b = await pedir(ctx, "https://api.stripe.com/v1/balance", cab);
  if (!b.ok) return { ...rechazoHttp(b.status, { modo }), metricas: bd.metricas, coste_variable: bd.coste };
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
    if (!t.ok || !esObjeto(t.json) || !Array.isArray(t.json.data)) {
      return { ...rechazoHttp(t.status === 200 ? 502 : t.status, { modo }), metricas: bd.metricas, coste_variable: bd.coste };
    }
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
  Object.assign(metricas, bd.metricas);
  const detalles: Record<string, unknown> = { modo, moneda: unidad };
  if (truncado) detalles.avisos = [`Más de ${MAX_PAGINAS_STRIPE * 100} movimientos este mes: las cifras del mes son parciales.`];
  const coste_variable: CosteVariable = {
    importe: redondear(comisiones / 100), moneda: unidad, periodo, origen: "api",
    nota: modo === "real" ? "Comisiones que Stripe ha cobrado este mes." : "Comisiones del modo prueba (no son dinero real).",
  };
  return { metricas, detalles, coste_variable: modo === "real" ? coste_variable : { ...coste_variable, importe: 0 } };
};

// ─── OpenAI (de nuestra base de datos, sin secreto nuevo) ──────────────────
// El gasto REAL lo trae sincronizar-costes-openai a `openai_costes_diarios`
// (cron de 6 h, OPENAI_ADMIN_KEY); lo que OpenAI aún no ha publicado sale de la
// estimación de `ia_uso`. El límite es el tope de Super Admin › Costes.

/** Días sin coste real a partir de los cuales se avisa de que la sincronización no va. */
export const DIAS_AVISO_SIN_REAL = 3;

export const leerOpenai: Lector = async (ctx) => {
  const d = await metricasBd(ctx);
  const real = d ? numero(d.openai_usd_mes_real) : null;
  const estimadoMes = d ? numero(d.ia_usd_mes_estimado) : null;
  if (!d || (real == null && estimadoMes == null)) {
    return { metricas: {}, error: "error_api", detalles: { avisos: ["No se pudo leer el gasto de IA de la base de datos (openai_costes_diarios / ia_uso)."] } };
  }
  const sinReal = real == null ? (estimadoMes ?? 0) : (numero(d.ia_usd_estimado_sin_real) ?? 0);
  const usd = (real ?? 0) + sinReal;
  const cambio = cambioDe(d);
  const tope = numero(d.tope_ia_mes_eur);
  const ultimo = typeof d.openai_ultimo_dia_real === "string" ? d.openai_ultimo_dia_real : null;
  const periodo = "mes en curso";
  const avisos: string[] = [];
  const metricas: Record<string, Metrica> = {
    gasto_ia_mes: {
      orden: 1, etiqueta: "Gasto de IA este mes", valor: redondear(usd * cambio), unidad: "EUR", periodo,
      ...(tope != null ? { limite: tope, unidad_limite: "EUR" } : {}),
      nota: `${fmtNum(usd, 4)} US$ a ${fmtNum(cambio, 4)} € por dólar. El límite es el tope de gasto de IA de Super Admin › Costes.`,
    },
    gasto_real_usd: {
      orden: 2, etiqueta: "Ya facturado por OpenAI", valor: redondear(real ?? 0, 4), unidad: "USD", periodo,
      nota: ultimo ? `Días cerrados, hasta el ${fechaEs(ultimo)}.` : "OpenAI todavía no ha publicado ningún día.",
    },
    gasto_estimado_usd: {
      orden: 3, etiqueta: "Estimado, aún sin facturar", valor: redondear(sinReal, 4), unidad: "USD", periodo,
      nota: "Lo que calculamos con ia_uso para los días que OpenAI aún no ha publicado.",
    },
  };
  const diasSinReal = ultimo ? Math.floor((ctx.ahora.getTime() - Date.parse(`${ultimo}T00:00:00Z`)) / 86_400_000) - 1 : null;
  if (diasSinReal == null) avisos.push("No hay ningún coste real de OpenAI guardado: revisa OPENAI_ADMIN_KEY y la sincronización de Super Admin › Costes.");
  else if (diasSinReal > DIAS_AVISO_SIN_REAL) avisos.push(`OpenAI no ha publicado costes reales desde el ${fechaEs(ultimo)}: revisa OPENAI_ADMIN_KEY y la sincronización de Super Admin › Costes.`);
  const detalles: Record<string, unknown> = { eur_por_usd: cambio, ...(ultimo ? { ultimo_dia_real: ultimo } : {}) };
  if (avisos.length) detalles.avisos = avisos;
  return {
    metricas,
    detalles,
    coste_variable: { importe: redondear(usd, 4), moneda: "USD", periodo, origen: sinReal > 0 ? "estimado" : "bd", nota: "Real de OpenAI + estimación de lo aún no publicado." },
  };
};

// ─── Vapi (asistente telefónico) ───────────────────────────────────────────
// De call_logs (lo que guarda el asistente de cada llamada) siempre; con
// VAPI_API_KEY (la de vapi-analytics, opcional), el coste que da Vapi.

/** Suma de `sumCost` / `countId` de la respuesta de POST /analytics (lista de { name, result: [...] }). */
export function resumirAnaliticaVapi(json: unknown): { coste: number | null; llamadas: number | null } {
  const consultas = Array.isArray(json) ? json.filter(esObjeto) : esObjeto(json) && Array.isArray(json.results) ? json.results.filter(esObjeto) : [];
  const q = consultas.find((c) => c.name === "servicios_mes") ?? consultas[0];
  const filas = q && Array.isArray(q.result) ? q.result.filter(esObjeto) : [];
  let coste: number | null = null;
  let llamadas: number | null = null;
  for (const f of filas) {
    for (const [k, v] of Object.entries(f)) {
      const n = numero(v);
      if (n == null) continue;
      if (/^sum.*cost$/i.test(k)) coste = (coste ?? 0) + n;
      else if (/^count/i.test(k)) llamadas = (llamadas ?? 0) + n;
    }
  }
  return { coste, llamadas };
}

export const leerVapi: Lector = async (ctx) => {
  const d = await metricasBd(ctx);
  const periodo = "mes en curso";
  const metricas: Record<string, Metrica> = {};
  const detalles: Record<string, unknown> = {};
  const avisos: string[] = [];
  let coste: CosteVariable | null = null;

  const llamadasBd = d ? numero(d.llamadas_mes) : null;
  if (llamadasBd != null) {
    const nota = "Según call_logs (lo que guarda el asistente de cada llamada).";
    metricas.llamadas_mes = { orden: 1, etiqueta: "Llamadas este mes", valor: llamadasBd, unidad: "llamadas", periodo, nota };
    metricas.minutos_mes = { orden: 2, etiqueta: "Minutos de llamada este mes", valor: redondear((numero(d?.llamadas_segundos_mes) ?? 0) / 60, 1), unidad: "minutos", periodo, nota };
    const usd = numero(d?.llamadas_usd_mes);
    const eur = numero(d?.llamadas_eur_mes);
    if (usd != null) {
      metricas.coste_llamadas_mes = { orden: 3, etiqueta: "Coste de las llamadas este mes", valor: redondear(usd, 4), unidad: "USD", periodo, nota };
      coste = { importe: redondear(usd, 4), moneda: "USD", periodo, origen: "bd", nota };
    } else if (eur != null) {
      metricas.coste_llamadas_mes = { orden: 3, etiqueta: "Coste de las llamadas este mes", valor: redondear(eur, 4), unidad: "EUR", periodo, nota };
      coste = { importe: redondear(eur, 4), moneda: "EUR", periodo, origen: "bd", nota };
    } else {
      coste = { importe: 0, moneda: "USD", periodo, origen: "bd", nota };
    }
  }

  const clave = secreto(ctx, "VAPI_API_KEY");
  if (!clave) {
    if (llamadasBd == null) return faltaSecreto("VAPI_API_KEY");
    detalles.secreto_opcional = "VAPI_API_KEY";
  } else {
    const r = await pedir(ctx, "https://api.vapi.ai/analytics", { Authorization: `Bearer ${clave}`, Accept: "application/json" }, {
      queries: [{
        table: "call", name: "servicios_mes",
        timeRange: { start: inicioMesUtc(ctx.ahora).toISOString(), end: ctx.ahora.toISOString(), timezone: "UTC" },
        operations: [{ operation: "sum", column: "cost" }, { operation: "count", column: "id" }],
      }],
    });
    if (r.status === 401 || r.status === 403) {
      if (llamadasBd == null) return rechazoHttp(r.status);
      detalles.token_rechazado = true;
      avisos.push("Vapi ha rechazado VAPI_API_KEY: se muestran solo los datos de call_logs.");
    } else if (r.ok) {
      const a = resumirAnaliticaVapi(r.json);
      const nota = "Dato de Vapi (todas las llamadas de la organización).";
      if (a.llamadas != null) metricas.llamadas_mes = { orden: 1, etiqueta: "Llamadas este mes", valor: a.llamadas, unidad: "llamadas", periodo, nota };
      if (a.coste != null) {
        metricas.coste_llamadas_mes = { orden: 3, etiqueta: "Coste de las llamadas este mes", valor: redondear(a.coste, 4), unidad: "USD", periodo, nota };
        coste = { importe: redondear(a.coste, 4), moneda: "USD", periodo, origen: "api", nota };
      }
      if (a.coste == null && a.llamadas == null) avisos.push("Vapi ha cambiado el formato de su API de analítica: no se reconocen las cifras.");
    } else {
      avisos.push(`Vapi respondió ${r.status} al pedir el coste del mes.`);
    }
  }
  if (avisos.length) detalles.avisos = avisos;
  if (Object.keys(metricas).length === 0) return { metricas, error: "error_api", detalles };
  return { metricas, detalles, coste_variable: coste };
};

// ─── Hostinger (suscripciones y dominios) ──────────────────────────────────
// API pública (https://developers.hostinger.com, 90 peticiones/min). El token
// hereda los permisos de quien lo crea: no hay tokens de solo lectura.

export interface SuscripcionHostinger {
  nombre: string;
  estado: string;
  /** Precio de renovación en la moneda de la suscripción (la API da céntimos). */
  precio_renovacion: number | null;
  moneda: string;
  periodo: string;
  caduca: string | null;
  proxima_factura: string | null;
  renovacion_automatica: boolean;
  /** Renovación pasada a meses (para sumar el coste al mes). */
  meses: number | null;
}

const MESES_POR_UNIDAD: Record<string, number> = { day: 1 / 30, days: 1 / 30, month: 1, months: 1, year: 12, years: 12 };
const listaDe = (json: unknown): Record<string, unknown>[] =>
  Array.isArray(json) ? json.filter(esObjeto) : esObjeto(json) && Array.isArray(json.data) ? json.data.filter(esObjeto) : [];

export function resumirSuscripcionesHostinger(json: unknown): SuscripcionHostinger[] {
  return listaDe(json).map((x) => {
    const n = numero(x.billing_period);
    const f = MESES_POR_UNIDAD[String(x.billing_period_unit ?? "").toLowerCase()];
    const precio = numero(x.renewal_price) ?? numero(x.total_price);
    return {
      nombre: String(x.name ?? "Suscripción").slice(0, 120),
      estado: String(x.status ?? "desconocido").slice(0, 40),
      precio_renovacion: precio == null ? null : precio / 100,
      moneda: /^[A-Z]{3}$/.test(String(x.currency_code ?? "")) ? String(x.currency_code) : "EUR",
      periodo: n != null && x.billing_period_unit ? `${n} ${String(x.billing_period_unit)}` : "",
      caduca: typeof x.expires_at === "string" ? x.expires_at : null,
      proxima_factura: typeof x.next_billing_at === "string" ? x.next_billing_at : null,
      renovacion_automatica: x.is_auto_renewed === true,
      meses: n != null && f ? n * f : null,
    };
  });
}

export const leerHostinger: Lector = async (ctx) => {
  const token = secreto(ctx, "SERVICIOS_HOSTINGER_TOKEN");
  if (!token) return faltaSecreto("SERVICIOS_HOSTINGER_TOKEN");
  const cab = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const s = await pedir(ctx, "https://developers.hostinger.com/api/billing/v1/subscriptions", cab);
  if (!s.ok) return rechazoHttp(s.status);
  const subs = resumirSuscripcionesHostinger(s.json);
  const activas = subs.filter((x) => x.estado === "active");
  const metricas: Record<string, Metrica> = {
    suscripciones_activas: { orden: 1, etiqueta: "Suscripciones activas", valor: activas.length, unidad: "suscripciones", periodo: "ahora" },
  };
  const detalles: Record<string, unknown> = { suscripciones: subs.slice(0, 20) };
  if (activas.length) detalles.plan_detectado = activas.map((x) => x.nombre).join(", ").slice(0, 200);
  const avisos: string[] = [];

  const p = await pedir(ctx, "https://developers.hostinger.com/api/domains/v1/portfolio", cab);
  if (p.ok) {
    const dominios = listaDe(p.json)
      .filter((x) => typeof x.domain === "string" && x.domain)
      .map((x) => ({ dominio: String(x.domain).slice(0, 120), estado: String(x.status ?? "").slice(0, 40), caduca: typeof x.expires_at === "string" ? x.expires_at : null }));
    detalles.dominios = dominios.slice(0, 20);
    const proximo = dominios.filter((x) => x.estado === "active" && x.caduca).sort((a, b) => String(a.caduca).localeCompare(String(b.caduca)))[0];
    metricas.dominios = {
      orden: 2, etiqueta: "Dominios en la cuenta", valor: dominios.length, unidad: "dominios", periodo: "ahora",
      ...(proximo ? { nota: `El primero en caducar: ${proximo.dominio}, el ${fechaEs(proximo.caduca)}.` } : {}),
    };
  } else {
    avisos.push(`Hostinger respondió ${p.status} al pedir los dominios.`);
  }

  // Coste al mes de lo que se renueva (solo si todas van en la misma moneda).
  const conPrecio = activas.filter((x) => x.precio_renovacion != null && x.meses);
  const monedas = new Set(conPrecio.map((x) => x.moneda));
  if (conPrecio.length && monedas.size === 1) {
    const alMes = conPrecio.reduce((t, x) => t + (x.precio_renovacion ?? 0) / (x.meses ?? 1), 0);
    detalles.coste_mensual_detectado = { importe: redondear(alMes), moneda: [...monedas][0] };
  }
  if (avisos.length) detalles.avisos = avisos;
  return { metricas, detalles };
};

// ─── Google Drive (espacio de la cuenta de las copias de facturas) ─────────
// La misma cuenta y los mismos secretos que procesar-factura. `about` vale con
// el alcance drive.file y da el espacio de TODA la cuenta (Drive, Gmail, Fotos).

export const leerGoogleDrive: Lector = async (ctx) => {
  const cliente = new ClienteDrive({
    config: {
      clientId: secreto(ctx, "GOOGLE_CLIENT_ID"),
      clientSecret: secreto(ctx, "GOOGLE_CLIENT_SECRET"),
      refreshToken: secreto(ctx, "GOOGLE_REFRESH_TOKEN"),
    },
    fetch: ctx.fetch,
  });
  if (!cliente.configurado) {
    const falta = ["GOOGLE_REFRESH_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].find((n) => !secreto(ctx, n)) ?? "GOOGLE_REFRESH_TOKEN";
    return faltaSecreto(falta);
  }
  let json: unknown;
  try {
    json = await cliente.json(`${URL_DRIVE}/about?fields=storageQuota`);
  } catch (e) {
    if (e instanceof ErrorDrive) {
      const rechazada = e.motivo === "token" || e.motivo === "permiso";
      return { metricas: {}, error: rechazada ? "credencial_rechazada" : "error_api", detalles: e.estado ? { http: e.estado } : {} };
    }
    throw e;
  }
  const q = esObjeto(json) && esObjeto(json.storageQuota) ? json.storageQuota : null;
  const usado = numero(q?.usage);
  if (!q || usado == null) return { metricas: {}, error: "error_api", detalles: { avisos: ["Google Drive no ha dado el espacio usado."] } };
  const limite = numero(q.limit);
  const enDrive = numero(q.usageInDrive);
  const papelera = numero(q.usageInDriveTrash);
  const metricas: Record<string, Metrica> = {
    almacenamiento: {
      orden: 1, etiqueta: "Espacio de la cuenta de Google", valor: usado, unidad: "bytes",
      ...(limite != null ? { limite: redondear(limite / GIB, 2), unidad_limite: "GB" } : {}),
      periodo: "ahora", nota: "Todo lo que ocupa la cuenta: Drive, Gmail y Google Fotos.",
    },
  };
  if (enDrive != null) metricas.en_drive = { orden: 2, etiqueta: "De ello, en Drive", valor: enDrive, unidad: "bytes", periodo: "ahora" };
  if (papelera != null && papelera > 0) {
    metricas.papelera = { orden: 3, etiqueta: "En la papelera de Drive", valor: papelera, unidad: "bytes", periodo: "ahora", nota: "Vaciar la papelera libera este espacio." };
  }
  const detalles: Record<string, unknown> = {};
  if (limite == null) detalles.avisos = ["La cuenta no tiene límite de espacio (cuenta de empresa o almacenamiento compartido)."];
  else detalles.plan_detectado = `${redondear(limite / GIB, 0)} GB de espacio`;
  return { metricas, detalles };
};

// ─── Mapbox (mapa de vinos de la web) ──────────────────────────────────────
// Mapbox no tiene API de consumo: las cargas salen de los logs de la web
// (sesiones que abren el mapa, solo con cookies de análisis aceptadas: es un
// mínimo). Precio de https://www.mapbox.com/pricing (03/11/2026).
export const MAPBOX_CARGAS_GRATIS = 50_000;
export const MAPBOX_USD_POR_MIL = 5;

export const leerMapbox: Lector = async (ctx) => {
  const periodo = "mes en curso";
  let n: number | null = null;
  try {
    const { data, error } = await ctx.admin.rpc("servicios_cargas_mapa_vinos", { p_desde: inicioMesUtc(ctx.ahora).toISOString() });
    if (error) {
      return { metricas: {}, error: "error_api", detalles: { avisos: ["Falta aplicar la migración 20261122153000_servicios_costes_mes (cuenta las cargas del mapa)."] } };
    }
    n = numero(data);
  } catch {
    return { metricas: {}, error: "error_interno", detalles: {} };
  }
  if (n == null) {
    return { metricas: {}, error: "error_api", detalles: { avisos: ["Sin los logs de la web no se pueden contar las cargas del mapa: míralas en el panel de Mapbox."] } };
  }
  const nota = "Sesiones de la web que abren el mapa (solo quien acepta las cookies de análisis: es un mínimo).";
  const exceso = Math.max(0, n - MAPBOX_CARGAS_GRATIS);
  return {
    metricas: { cargas_mapa_web: { orden: 1, etiqueta: "Cargas del mapa de vinos (web)", valor: n, unidad: "cargas", limite: MAPBOX_CARGAS_GRATIS, periodo, nota } },
    detalles: {},
    coste_variable: {
      importe: redondear((exceso / 1000) * MAPBOX_USD_POR_MIL, 2), moneda: "USD", periodo, origen: "estimado",
      nota: `Gratis hasta ${MAPBOX_CARGAS_GRATIS.toLocaleString("es-ES")} cargas; después, ${MAPBOX_USD_POR_MIL} US$ cada 1.000.`,
    },
  };
};

export const LECTORES: Record<string, Lector> = {
  vercel: leerVercel,
  supabase: leerSupabase,
  github: leerGithub,
  resend: leerResend,
  stripe: leerStripe,
  openai: leerOpenai,
  vapi: leerVapi,
  hostinger: leerHostinger,
  google_drive: leerGoogleDrive,
  mapbox: leerMapbox,
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
    coste_variable: esObjeto(fila.coste_variable) ? fila.coste_variable : null,
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

    // «*»: sirve antes y después de 20261103160000 (sin `activo`, todos en uso).
    const servicios = await admin.from("servicios_contratados").select("*");
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
    const enUso: string[] = [];
    for (const s of (Array.isArray(servicios.data) ? servicios.data : []).filter(esObjeto)) {
      if (s.activo === false) continue; // «no lo usamos»: ni se lee ni se cuenta
      limites.set(String(s.proveedor), s.limites);
      enUso.push(String(s.proveedor));
    }
    const previas = new Map<string, LecturaGuardada>();
    for (const u of (Array.isArray(ultimas.data) ? ultimas.data : []).filter(esObjeto)) previas.set(String(u.proveedor), u as unknown as LecturaGuardada);

    const ahora = (deps.ahora ?? (() => new Date()))();
    const ctx: ContextoLector = { env, fetch: deps.fetch ?? fetch, ahora, admin, refProyecto: refDeUrl(env("SUPABASE_URL")) };
    const proveedores = Object.keys(lectores).filter((p) => limites.has(p));
    const sinLector = enUso.filter((p) => !(p in lectores)).sort();

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
        coste_variable: r.coste_variable ?? null,
      }, env);
      let { error } = await admin.from("servicios_uso").insert(fila);
      if (error && /coste_variable/.test(error.message ?? "")) {
        // Base sin 20261103160000: se guarda sin la columna nueva.
        const { coste_variable: _sinColumna, ...vieja } = fila;
        ({ error } = await admin.from("servicios_uso").insert(vieja));
      }
      if (error) console.error(`[servicios-uso] no se guardó la lectura de ${p}:`, error.message);
      return aRespuesta(fila, false, !error);
    }));

    if (lecturas.some((l) => !l.desde_cache)) {
      const corte = new Date(ahora.getTime() - RETENCION_DIAS * 86_400_000).toISOString();
      const { error } = await admin.from("servicios_uso").delete().lt("tomado_en", corte);
      if (error) console.error("[servicios-uso] limpieza del histórico:", error.message);
    }

    return json(ocultarSecretos({ lecturas, sin_lector: sinLector, forzado: forzar, proveedor: solo, generado_en: ahora.toISOString() }, env));
  };
}
