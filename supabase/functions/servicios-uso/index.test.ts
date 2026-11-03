// servicios-uso: autorización (solo super admin), caché de 15 min, «falta
// configurar la clave X» por proveedor, lectura de cada API (simulada: no sale
// nada a Internet), coste variable del mes (IA, llamadas, Stripe, GitHub),
// proveedores sin lector o que no se usan, y que ningún secreto llegue nunca
// al navegador.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_MS,
  LECTORES,
  aplicarLimites,
  crearManejador,
  metricasBd,
  modoStripe,
  ocultarSecretos,
  refDeUrl,
  resumirAnaliticaVapi,
  resumirSuscripcionesHostinger,
  resumirUsoGithub,
  resumirUsoVercel,
  type LecturaGuardada,
  type LecturaRespuesta,
} from "./servicios.ts";

const AHORA = new Date("2026-11-03T12:00:00Z");
const SECRETOS = {
  SERVICIOS_VERCEL_TOKEN: "vercel-token-supersecreto-123",
  SERVICIOS_SUPABASE_TOKEN: "sbp_token-de-gestion-secreto-456",
  SERVICIOS_GITHUB_TOKEN: "github_pat_secreto_789",
  RESEND_API_KEY: "re_clave_resend_secreta_000",
  STRIPE_SECRET_KEY: "sk_test_clave_stripe_secreta_111",
  VAPI_API_KEY: "vapi-clave-privada-secreta-222",
  SERVICIOS_HOSTINGER_TOKEN: "hostinger-token-secreto-333",
};
const BASE_ENV: Record<string, string> = {
  SUPABASE_URL: "https://sfonaclosuafvlhutkon.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
};
const USUARIOS: Record<string, { id: string; email: string; superadmin: boolean; admin?: boolean }> = {
  "jwt-super": { id: "11111111-1111-4111-8111-111111111111", email: "dueno@casatomas.test", superadmin: true },
  "jwt-admin": { id: "22222222-2222-4222-8222-222222222222", email: "admin@casatomas.test", superadmin: false, admin: true },
  "jwt-staff": { id: "33333333-3333-4333-8333-333333333333", email: "staff@casatomas.test", superadmin: false },
};

const LIMITES: Record<string, unknown> = {
  vercel: { peticiones_cdn: { limite: 1000000, unidad: "peticiones" }, transferencia_rapida: { limite: 100, unidad: "GB" }, despliegues_24h: { limite: 100, unidad: "despliegues" } },
  supabase: { bd_tamano: { limite: 500, unidad: "MB" }, almacenamiento: { limite: 1, unidad: "GB" }, usuarios_activos_mes: { limite: 50000, unidad: "usuarios" } },
  github: { actions_computo: { limite: 12, unidad: "USD" }, almacenamiento_artefactos: { limite: 500, unidad: "MB" } },
  resend: { correos_mes: { limite: 3000, unidad: "correos" }, correos_hoy: { limite: 100, unidad: "correos" }, contactos_marketing: { limite: 1000, unidad: "contactos" }, dominios: { limite: 3, unidad: "dominios" } },
  stripe: {},
  // El límite del gasto de IA lo pone la lectura (tope de Costes): sin «limite».
  openai: { gasto_ia_mes: { unidad: "EUR", limite_desde: "Tope de gasto de IA de Super Admin › Costes" } },
  vapi: { llamadas_simultaneas: { limite: 4, unidad: "llamadas" } },
  hostinger: {},
  // Sin lector (no hay API razonable): sale en sin_lector.
  google: { consultas_ficha_resenas: { limite: 1000, unidad: "consultas" } },
  loading: {},
  // «No lo usamos»: ni se lee ni sale en sin_lector.
  perplexity: {},
};
const NO_SE_USAN = new Set(["perplexity"]);
const CON_LECTOR = ["github", "hostinger", "openai", "resend", "stripe", "supabase", "vapi", "vercel"];
const METRICAS_BD = {
  bd_bytes: 50_632_371, storage_bytes: 120_083_232, storage_objetos: 501, usuarios_activos_mes: 2, usuarios_total: 9,
  correos_reservas_mes: 6, correos_reservas_hoy: 1, correos_newsletter_mes: 4, correos_newsletter_hoy: 0, contactos_newsletter: 37,
  eur_por_usd: 0.9, eur_por_usd_bce: 0.893815, eur_por_usd_bce_fecha: "2026-10-26",
  openai_usd_mes_real: 2.5, openai_ultimo_dia_real: "2026-11-02", ia_usd_mes_estimado: 0.5, ia_usd_estimado_sin_real: 0.4, tope_ia_mes_eur: 8,
  cheques_stripe_mes: 2, cheques_stripe_importe_mes: 70, cheques_stripe_comision_mes: 1.55, cheques_stripe_comision_estimadas: 1,
  llamadas_mes: 3, llamadas_segundos_mes: 390, llamadas_usd_mes: 0.75, llamadas_eur_mes: 0.67,
};

type Estado = {
  previas: LecturaGuardada[];
  insertadas: LecturaGuardada[];
  borrados: string[];
  rpcs: string[];
  errorServicios: { message: string; code?: string } | null;
  errorInsert: { message: string } | null;
  /** Simula una base sin la columna coste_variable (antes de 20261103160000). */
  errorInsertColumna?: boolean;
  errorMetricas: boolean;
  metricasExtra: Record<string, unknown>;
};
let estado: Estado;

function crearCliente(_url: string, _key: string) {
  return {
    auth: {
      getUser: async (token: string) => {
        const u = USUARIOS[token];
        return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      estado.rpcs.push(fn);
      const u = Object.values(USUARIOS).find((x) => x.id === args._user_id);
      if (fn === "is_super_admin") return { data: !!u?.superadmin, error: null };
      if (fn === "is_admin") return { data: !!u?.admin, error: null };
      if (fn === "servicios_uso_ultimas") return { data: estado.previas, error: null };
      if (fn === "servicios_metricas_supabase") return estado.errorMetricas ? { data: null, error: { message: "no existe" } } : { data: { ...METRICAS_BD, ...estado.metricasExtra }, error: null };
      return { data: null, error: { message: `rpc ${fn} no simulada` } };
    },
    from: (tabla: string) => ({
      select: async () => (estado.errorServicios
        ? { data: null, error: estado.errorServicios }
        : { data: Object.entries(LIMITES).map(([proveedor, limites]) => ({ proveedor, limites, activo: !NO_SE_USAN.has(proveedor) })), error: null }),
      insert: async (fila: LecturaGuardada) => {
        if (tabla !== "servicios_uso") throw new Error(`insert en ${tabla}`);
        if (estado.errorInsertColumna && "coste_variable" in fila) {
          return { error: { message: "Could not find the 'coste_variable' column of 'servicios_uso' in the schema cache" } };
        }
        if (!estado.errorInsert) estado.insertadas.push(fila);
        return { error: estado.errorInsert };
      },
      delete: () => ({ lt: async (_c: string, corte: string) => { estado.borrados.push(corte); return { error: null }; } }),
    }),
  };
}

// ─── fetch simulado ─────────────────────────────────────────────────────────
type Ruta = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const resp = (cuerpo: unknown, status = 200, cabeceras: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json", ...cabeceras } });

function fetchSimulado(rutas: Record<string, Ruta>) {
  const llamadas: Array<{ url: URL; auth: string | null; metodo: string; cuerpo: unknown }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    llamadas.push({ url, auth: new Headers(init?.headers).get("Authorization"), metodo: init?.method ?? "GET", cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const clave = url.host + url.pathname;
    const ruta = rutas[clave];
    if (!ruta) throw new Error(`ruta no simulada: ${clave}`);
    return ruta(url, init);
  });
  return { fn: fn as unknown as typeof fetch, llamadas };
}

const USO_VERCEL = {
  data: [
    { timestamp: "2026-11-01T00:00:00Z", request_hit_count: 1000, request_miss_count: 500, bandwidth_outgoing_bytes: 2 * 1024 ** 3, bandwidth_incoming_bytes: 999, function_invocation_successful_count: 300, function_invocation_error_count: 2 },
    { timestamp: "2026-11-02T00:00:00Z", request_hit_count: 2000, request_miss_count: 100, bandwidth_outgoing_bytes: 1024 ** 3, function_invocation_successful_count: 100 },
  ],
};
const GITHUB_RESUMEN = {
  usageItems: [
    { product: "Actions", sku: "actions_linux", unitType: "minutes", pricePerUnit: 0.006, grossQuantity: 1000, grossAmount: 6, discountQuantity: 1000, discountAmount: 6, netQuantity: 0, netAmount: 0 },
    { product: "Actions", sku: "actions_windows", unitType: "Minutes", pricePerUnit: 0.01, grossQuantity: 100, grossAmount: 1, netAmount: 1 },
    { product: "Actions", sku: "actions_storage", unitType: "GigabyteHours", grossQuantity: 3.6, grossAmount: 0.001 },
    { product: "Copilot", sku: "copilot", unitType: "requests", grossQuantity: 50, grossAmount: 2 },
  ],
};

const SUSCRIPCIONES_HOSTINGER = [
  { id: "s1", name: "Premium Web Hosting", status: "active", billing_period: 1, billing_period_unit: "year", currency_code: "EUR", total_price: 4788, renewal_price: 9588, is_auto_renewed: true, created_at: "2025-11-20T10:00:00Z", expires_at: "2026-11-20T10:00:00Z", next_billing_at: "2026-11-20T10:00:00Z" },
  { id: "s2", name: ".es Domain", status: "active", billing_period: 1, billing_period_unit: "year", currency_code: "EUR", total_price: 999, renewal_price: 1199, is_auto_renewed: false, created_at: "2025-01-15T10:00:00Z", expires_at: "2027-01-15T10:00:00Z", next_billing_at: null },
  { id: "s3", name: "Email Starter", status: "cancelled", billing_period: 1, billing_period_unit: "month", currency_code: "EUR", total_price: 100, renewal_price: 100, is_auto_renewed: false, created_at: "2025-01-15T10:00:00Z", expires_at: "2025-02-15T10:00:00Z", next_billing_at: null },
];

function rutasCompletas(extra: Partial<Record<string, Ruta>> = {}): Record<string, Ruta> {
  return {
    "api.vercel.com/v6/deployments": () => resp({ deployments: Array.from({ length: 12 }, (_, i) => ({ uid: `dpl_${i}` })) }),
    "api.vercel.com/v2/usage": () => resp(USO_VERCEL),
    "api.supabase.com/v1/projects/sfonaclosuafvlhutkon/analytics/endpoints/usage.api-counts": () =>
      resp({ result: [{ timestamp: "2026-11-02T00:00:00", total_auth_requests: 10, total_realtime_requests: 5, total_rest_requests: 100, total_storage_requests: 85 }, { total_rest_requests: 800 }] }),
    "api.supabase.com/v1/projects/sfonaclosuafvlhutkon/analytics/endpoints/logs": () => resp({ result: [{ invocaciones: 1959 }] }),
    "api.github.com/users/restcasatomascrevillent/settings/billing/usage/summary": () => resp(GITHUB_RESUMEN),
    "api.github.com/user": () => resp({ login: "restcasatomascrevillent", plan: { name: "free" } }),
    "api.resend.com/domains": () => resp({ data: [{ id: "d1", name: "casatomas.es", status: "verified" }] }, 200, { "x-resend-monthly-quota": "321", "x-resend-daily-quota": "17" }),
    "api.stripe.com/v1/balance": () => resp({ available: [{ amount: 12345, currency: "eur" }], pending: [{ amount: 500, currency: "eur" }, { amount: 99, currency: "usd" }] }),
    "api.stripe.com/v1/balance_transactions": (url) => url.searchParams.get("starting_after")
      ? resp({ data: [{ id: "txn_3", type: "refund", amount: -1000, fee: 0, currency: "eur" }], has_more: false })
      : resp({ data: [
        { id: "txn_1", type: "charge", amount: 5000, fee: 100, currency: "eur" },
        { id: "txn_2", type: "payment", amount: 2500, fee: 63, currency: "eur" },
        { id: "txn_x", type: "charge", amount: 9999, fee: 9, currency: "usd" },
      ], has_more: true }),
    "api.vapi.ai/analytics": () => resp([{ name: "servicios_mes", timeRange: {}, result: [{ sumCost: 1.25, countId: 4 }] }]),
    "developers.hostinger.com/api/billing/v1/subscriptions": () => resp(SUSCRIPCIONES_HOSTINGER),
    "developers.hostinger.com/api/domains/v1/portfolio": () => resp([
      { id: 1, domain: "otro-dominio.es", type: "domain", status: "active", created_at: "2025-01-01T00:00:00Z", expires_at: "2027-06-01T00:00:00Z" },
      { id: 2, domain: "restaurantecasatomascrevillente.es", type: "domain", status: "active", created_at: "2024-01-01T00:00:00Z", expires_at: "2027-01-15T00:00:00Z" },
      { id: 3, domain: null, type: "free_domain", status: "requested", created_at: "2025-01-01T00:00:00Z", expires_at: null },
    ]),
    ...extra,
  } as Record<string, Ruta>;
}

function manejador(opciones: { env?: Record<string, string>; rutas?: Record<string, Ruta>; ahora?: Date } = {}) {
  const env = { ...BASE_ENV, ...(opciones.env ?? {}) };
  const f = fetchSimulado(opciones.rutas ?? rutasCompletas());
  const h = crearManejador({ crearCliente, env: (n) => env[n], fetch: f.fn, ahora: () => opciones.ahora ?? AHORA });
  return { h, llamadas: f.llamadas, env };
}

async function llamar(h: (r: Request) => Promise<Response>, token?: string, query = "", cuerpo?: unknown) {
  const res = await h(new Request(`https://sfonaclosuafvlhutkon.supabase.co/functions/v1/servicios-uso${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  }));
  const texto = await res.text();
  return { status: res.status, texto, cuerpo: texto ? JSON.parse(texto) : null };
}
const lectura = (cuerpo: { lecturas: LecturaRespuesta[] }, p: string) => cuerpo.lecturas.find((l) => l.proveedor === p)!;

beforeEach(() => {
  estado = { previas: [], insertadas: [], borrados: [], rpcs: [], errorServicios: null, errorInsert: null, errorMetricas: false, metricasExtra: {} };
});

describe("autorización", () => {
  it.each([undefined, BASE_ENV.SUPABASE_ANON_KEY, "sb_publishable_x", BASE_ENV.SUPABASE_SERVICE_ROLE_KEY, "jwt-falso"])("token %s → 401 sin leer nada", async (token) => {
    const { h, llamadas } = manejador({ env: SECRETOS });
    expect((await llamar(h, token)).status).toBe(401);
    expect(llamadas).toEqual([]);
    expect(estado.insertadas).toEqual([]);
  });
  it.each(["jwt-staff", "jwt-admin"])("%s (no super admin) → 403 sin leer nada", async (token) => {
    const { h, llamadas } = manejador({ env: SECRETOS });
    const r = await llamar(h, token);
    expect(r.status).toBe(403);
    expect(llamadas).toEqual([]);
    expect(estado.rpcs).not.toContain("servicios_uso_ultimas");
  });
  it("OPTIONS responde CORS y PUT → 405", async () => {
    const { h } = manejador();
    const op = await h(new Request("https://x.test/servicios-uso", { method: "OPTIONS" }));
    expect(op.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect((await h(new Request("https://x.test/servicios-uso", { method: "PUT" }))).status).toBe(405);
  });
});

describe("sin ningún secreto (como la demo)", () => {
  it("cada proveedor dice qué clave falta, Supabase mide con la clave de servicio y Resend estima", async () => {
    const { h, llamadas } = manejador();
    const r = await llamar(h, "jwt-super");
    expect(r.status).toBe(200);
    expect(llamadas).toEqual([]); // ninguna API externa
    expect(r.cuerpo.lecturas.map((l: LecturaRespuesta) => l.proveedor).sort()).toEqual(CON_LECTOR);
    // Sin API razonable: se dice; lo que no se usa, ni se lee ni se nombra.
    expect(r.cuerpo.sin_lector).toEqual(["google", "loading"]);
    expect(estado.rpcs.filter((f) => f === "servicios_metricas_supabase")).toHaveLength(1); // una sola vez por petición
    expect(lectura(r.cuerpo, "vercel")).toMatchObject({ error: "falta_secreto", secreto: "SERVICIOS_VERCEL_TOKEN", metricas: {}, coste_variable: null });
    expect(lectura(r.cuerpo, "github")).toMatchObject({ error: "falta_secreto", secreto: "SERVICIOS_GITHUB_TOKEN" });
    expect(lectura(r.cuerpo, "hostinger")).toMatchObject({ error: "falta_secreto", secreto: "SERVICIOS_HOSTINGER_TOKEN", metricas: {} });
    // Stripe: sin clave, las comisiones de los cheques salen de nuestra base de datos.
    const st = lectura(r.cuerpo, "stripe");
    expect(st).toMatchObject({ error: "falta_secreto", secreto: "STRIPE_SECRET_KEY" });
    expect(st.metricas.comision_cheques_mes).toMatchObject({ valor: 1.55, unidad: "EUR", nota: expect.stringContaining("1,5 % + 0,25 €") });
    expect(st.coste_variable).toMatchObject({ importe: 1.55, moneda: "EUR", origen: "estimado" });
    // OpenAI: todo de la base de datos, frente al tope de Costes (en euros).
    const ia = lectura(r.cuerpo, "openai");
    expect(ia.error).toBeNull();
    expect(ia.metricas.gasto_ia_mes).toMatchObject({ valor: 2.61, unidad: "EUR", limite: 8, unidad_limite: "EUR" });
    expect(ia.coste_variable).toMatchObject({ importe: 2.9, moneda: "USD" });
    // Vapi: llamadas de call_logs y la clave como opcional.
    const vapi = lectura(r.cuerpo, "vapi");
    expect(vapi).toMatchObject({ error: null, detalles: { secreto_opcional: "VAPI_API_KEY" } });
    expect(vapi.metricas.llamadas_mes).toMatchObject({ valor: 3 });
    expect(vapi.metricas.minutos_mes).toMatchObject({ valor: 6.5, unidad: "minutos" });
    expect(vapi.coste_variable).toMatchObject({ importe: 0.75, moneda: "USD", origen: "bd" });
    const resend = lectura(r.cuerpo, "resend");
    expect(resend).toMatchObject({ error: "falta_secreto", secreto: "RESEND_API_KEY" });
    expect(resend.metricas.correos_mes).toMatchObject({ valor: 10, limite: 3000, unidad: "correos" });
    expect(resend.metricas.contactos_marketing).toMatchObject({ valor: 37, limite: 1000 });
    const supa = lectura(r.cuerpo, "supabase");
    expect(supa.error).toBeNull();
    expect(supa.metricas.bd_tamano).toMatchObject({ valor: 50_632_371, unidad: "bytes", limite: 500, unidad_limite: "MB" });
    expect(supa.metricas.almacenamiento).toMatchObject({ valor: 120_083_232, limite: 1, unidad_limite: "GB" });
    expect(supa.metricas.usuarios_activos_mes).toMatchObject({ valor: 2, limite: 50000 });
    expect(supa.detalles.secreto_opcional).toBe("SERVICIOS_SUPABASE_TOKEN");
    expect(estado.insertadas).toHaveLength(CON_LECTOR.length);
    expect(estado.insertadas.find((f) => f.proveedor === "openai")?.coste_variable).toMatchObject({ importe: 2.9 });
    expect(estado.borrados).toHaveLength(1); // limpieza del histórico (> 400 días)
  });
});

describe("caché", () => {
  const previa = (p: string, minutos: number): LecturaGuardada => ({
    proveedor: p, tomado_en: new Date(AHORA.getTime() - minutos * 60_000).toISOString(), metricas: { x: { etiqueta: "x", valor: 1, unidad: "u" } }, error: null, detalles: {},
  });
  it("< 15 min: no llama a la API ni guarda; > 15 min: vuelve a leer", async () => {
    estado.previas = [previa("vercel", 5), previa("github", 5), previa("stripe", 5), previa("resend", 5), previa("supabase", 20),
      previa("openai", 5), previa("vapi", 5), previa("hostinger", 5)];
    const { h, llamadas } = manejador({ env: SECRETOS });
    const r = await llamar(h, "jwt-super");
    expect(lectura(r.cuerpo, "vercel")).toMatchObject({ desde_cache: true, metricas: { x: { valor: 1 } } });
    expect(lectura(r.cuerpo, "supabase").desde_cache).toBe(false);
    expect(llamadas.every((l) => l.url.host === "api.supabase.com")).toBe(true);
    expect(estado.insertadas.map((f) => f.proveedor)).toEqual(["supabase"]);
  });
  it("?forzar=1 (o { forzar: true }) vuelve a leer, pero nunca más de una vez por minuto", async () => {
    estado.previas = [previa("vercel", 5), previa("github", 0.5)];
    const { h, llamadas } = manejador({ env: SECRETOS });
    const r = await llamar(h, "jwt-super", "?forzar=1");
    expect(r.cuerpo.forzado).toBe(true);
    expect(lectura(r.cuerpo, "vercel").desde_cache).toBe(false);
    expect(lectura(r.cuerpo, "github").desde_cache).toBe(true);
    expect(llamadas.some((l) => l.url.host === "api.github.com")).toBe(false);
    estado.insertadas = [];
    estado.previas = [previa("vercel", 5)];
    const r2 = await llamar(manejador({ env: SECRETOS }).h, "jwt-super", "", { forzar: true });
    expect(lectura(r2.cuerpo, "vercel").desde_cache).toBe(false);
  });
  it("{ forzar, proveedor } solo vuelve a leer ese proveedor; los demás, aunque viejos, salen de lo guardado", async () => {
    estado.previas = [previa("vercel", 5), previa("github", 60), previa("stripe", 60), previa("resend", 60), previa("supabase", 60),
      previa("openai", 60), previa("vapi", 60), previa("hostinger", 60)];
    const { h, llamadas } = manejador({ env: SECRETOS });
    const r = await llamar(h, "jwt-super", "", { forzar: true, proveedor: "vercel" });
    expect(r.cuerpo.proveedor).toBe("vercel");
    expect(r.cuerpo.lecturas.filter((l: LecturaRespuesta) => !l.desde_cache).map((l: LecturaRespuesta) => l.proveedor)).toEqual(["vercel"]);
    expect(new Set(llamadas.map((l) => l.url.host))).toEqual(new Set(["api.vercel.com"]));
    expect(estado.insertadas.map((f) => f.proveedor)).toEqual(["vercel"]);
  });
  it("la caché dura 15 minutos", () => expect(CACHE_MS).toBe(15 * 60_000));
});

describe("con todos los secretos", () => {
  it("lee todas las APIs, pone los límites y nunca devuelve ni guarda un secreto", async () => {
    const { h, llamadas } = manejador({ env: SECRETOS });
    const r = await llamar(h, "jwt-super");
    expect(r.status).toBe(200);
    for (const valor of [...Object.values(SECRETOS), BASE_ENV.SUPABASE_SERVICE_ROLE_KEY]) {
      expect(r.texto).not.toContain(valor);
      expect(JSON.stringify(estado.insertadas)).not.toContain(valor);
    }
    // Cada API con su propia clave.
    expect(llamadas.find((l) => l.url.host === "api.vercel.com")?.auth).toBe(`Bearer ${SECRETOS.SERVICIOS_VERCEL_TOKEN}`);
    expect(llamadas.find((l) => l.url.host === "api.stripe.com")?.auth).toBe(`Bearer ${SECRETOS.STRIPE_SECRET_KEY}`);
    expect(llamadas.find((l) => l.url.pathname.includes("/deployments"))?.url.searchParams.get("teamId")).toBe("team_18KKVg7ueSX0PL4Ycy1QakZj");

    const v = lectura(r.cuerpo, "vercel");
    expect(v.error).toBeNull();
    expect(v.metricas.peticiones_cdn).toMatchObject({ valor: 3600, limite: 1000000 });
    expect(v.metricas.transferencia_rapida).toMatchObject({ valor: 3 * 1024 ** 3, unidad: "bytes", limite: 100, unidad_limite: "GB" });
    expect(v.metricas.invocaciones_funciones).toMatchObject({ valor: 402 });
    expect(v.metricas.despliegues_24h).toMatchObject({ valor: 12, limite: 100 });

    const s = lectura(r.cuerpo, "supabase");
    expect(s.metricas.peticiones_api_7d).toMatchObject({ valor: 1000, periodo: "últimos 7 días" });
    expect(s.metricas.invocaciones_funciones_24h).toMatchObject({ valor: 1959 });
    expect(s.detalles.secreto_opcional).toBeUndefined();
    const logs = llamadas.find((l) => l.url.pathname.endsWith("/logs"))!;
    expect(logs.url.searchParams.get("sql")).toContain("function_edge_logs");
    expect(Date.parse(logs.url.searchParams.get("iso_timestamp_end")!) - Date.parse(logs.url.searchParams.get("iso_timestamp_start")!)).toBeLessThanOrEqual(86_400_000);

    const g = lectura(r.cuerpo, "github");
    expect(g.metricas.actions_computo).toMatchObject({ valor: 7, unidad: "USD", limite: 12 });
    expect(g.metricas.actions_minutos).toMatchObject({ valor: 1100 });
    // 3,6 GB·h repartidos en las 60 h que lleva el mes (1 nov 00:00 → 3 nov 12:00).
    expect(g.metricas.almacenamiento_artefactos.valor).toBe(Math.round((3.6 / 60) * 1024 ** 3));
    expect(g.detalles.plan_detectado).toBe("free");

    const re = lectura(r.cuerpo, "resend");
    expect(re.error).toBeNull();
    expect(re.metricas.correos_mes).toMatchObject({ valor: 321, limite: 3000, nota: expect.stringContaining("Dato de Resend") });
    expect(re.metricas.correos_hoy).toMatchObject({ valor: 17, limite: 100 });
    expect(re.metricas.dominios).toMatchObject({ valor: 1, limite: 3 });
    expect(re.detalles.plan_detectado).toBe("Free");

    const st = lectura(r.cuerpo, "stripe");
    expect(st.detalles).toMatchObject({ modo: "prueba", moneda: "EUR" });
    expect(st.metricas.cobros_mes.valor).toBe(2);
    expect(st.metricas.importe_cobrado_mes).toMatchObject({ valor: 75, unidad: "EUR" });
    expect(st.metricas.comisiones_mes.valor).toBeCloseTo(1.63);
    expect(st.metricas.saldo_disponible.valor).toBeCloseTo(123.45);
    expect(st.metricas.saldo_pendiente.valor).toBe(5);
    expect(st.metricas.importe_cobrado_mes.nota).toContain("10,00");
    // Modo prueba: las comisiones no son dinero real.
    expect(st.coste_variable).toMatchObject({ importe: 0, moneda: "EUR", origen: "api" });
    expect(st.metricas.comision_cheques_mes.valor).toBe(1.55);

    // GitHub: lo que factura de verdad (netAmount) es el coste variable.
    expect(g.coste_variable).toMatchObject({ importe: 1, moneda: "USD", origen: "api" });

    // Vapi: con la clave, el coste y las llamadas los da Vapi (POST /analytics del mes).
    const va = lectura(r.cuerpo, "vapi");
    expect(va.metricas.coste_llamadas_mes).toMatchObject({ valor: 1.25, unidad: "USD", nota: expect.stringContaining("Dato de Vapi") });
    expect(va.metricas.llamadas_mes.valor).toBe(4);
    expect(va.metricas.minutos_mes.valor).toBe(6.5);
    expect(va.coste_variable).toMatchObject({ importe: 1.25, origen: "api" });
    expect(va.detalles.secreto_opcional).toBeUndefined();
    const pv = llamadas.find((l) => l.url.host === "api.vapi.ai")!;
    expect(pv.metodo).toBe("POST");
    expect(pv.auth).toBe(`Bearer ${SECRETOS.VAPI_API_KEY}`);
    expect((pv.cuerpo as { queries: Array<{ timeRange: { start: string } }> }).queries[0].timeRange.start).toBe("2026-11-01T00:00:00.000Z");

    // Hostinger: suscripciones activas, dominios con su caducidad y coste al mes de lo que se renueva.
    const ho = lectura(r.cuerpo, "hostinger");
    expect(ho.error).toBeNull();
    expect(ho.metricas.suscripciones_activas.valor).toBe(2);
    expect(ho.metricas.dominios).toMatchObject({ valor: 2, nota: expect.stringContaining("restaurantecasatomascrevillente.es, el 15/01/2027") });
    expect(ho.detalles.plan_detectado).toBe("Premium Web Hosting, .es Domain");
    expect(ho.detalles.coste_mensual_detectado).toEqual({ importe: 8.99, moneda: "EUR" });
    expect((ho.detalles.dominios as unknown[]).length).toBe(2);
    expect(llamadas.find((l) => l.url.host === "developers.hostinger.com")?.auth).toBe(`Bearer ${SECRETOS.SERVICIOS_HOSTINGER_TOKEN}`);
  });

  it("un secreto que la API devuelve en su mensaje de error no llega al navegador", async () => {
    const eco = () => resp({ error: { message: `Invalid API Key provided: ${SECRETOS.STRIPE_SECRET_KEY}` } }, 401);
    const { h } = manejador({ env: SECRETOS, rutas: rutasCompletas({ "api.stripe.com/v1/balance": eco }) });
    const r = await llamar(h, "jwt-super");
    expect(r.texto).not.toContain(SECRETOS.STRIPE_SECRET_KEY);
    expect(lectura(r.cuerpo, "stripe")).toMatchObject({ error: "credencial_rechazada", detalles: { http: 401, modo: "prueba" } });
  });

  it("si una API falla, el resto sigue", async () => {
    const { h } = manejador({
      env: SECRETOS,
      rutas: rutasCompletas({
        "api.vercel.com/v6/deployments": () => resp({ error: { code: "forbidden" } }, 403),
        "api.github.com/users/restcasatomascrevillent/settings/billing/usage/summary": () => { throw new TypeError("network"); },
        "developers.hostinger.com/api/billing/v1/subscriptions": () => resp({ message: "Unauthenticated." }, 401),
      }),
    });
    const r = await llamar(h, "jwt-super");
    expect(r.status).toBe(200);
    expect(lectura(r.cuerpo, "vercel")).toMatchObject({ error: "credencial_rechazada", detalles: { http: 403 } });
    expect(lectura(r.cuerpo, "github").error).toBe("error_interno");
    expect(lectura(r.cuerpo, "stripe").error).toBeNull();
    expect(lectura(r.cuerpo, "supabase").error).toBeNull();
    expect(lectura(r.cuerpo, "hostinger")).toMatchObject({ error: "credencial_rechazada", detalles: { http: 401 } });
  });
});

describe("lectores", () => {
  const ctx = (env: Record<string, string>, rutas: Record<string, Ruta>) => ({
    env: (n: string) => ({ ...BASE_ENV, ...env })[n], fetch: fetchSimulado(rutas).fn, ahora: AHORA,
    admin: crearCliente("", "") as never, refProyecto: "sfonaclosuafvlhutkon",
  });

  it("Vercel: formato de uso desconocido → aviso con las claves vistas, sin inventar cifras", async () => {
    const r = await LECTORES.vercel(ctx(SECRETOS, rutasCompletas({ "api.vercel.com/v2/usage": () => resp({ data: [{ cosa_rara: 5 }] }) })));
    expect(r.error).toBeFalsy();
    expect(r.metricas.peticiones_cdn).toBeUndefined();
    expect(r.metricas.despliegues_24h.valor).toBe(12);
    expect(r.detalles?.claves_uso).toEqual(["cosa_rara"]);
    expect(String(r.detalles?.avisos)).toContain("formato");
  });

  it("Vercel: equipo configurable", async () => {
    const rutas = rutasCompletas();
    const f = fetchSimulado(rutas);
    await LECTORES.vercel({ ...ctx({ ...SECRETOS, SERVICIOS_VERCEL_TEAM_ID: "team_otro" }, rutas), fetch: f.fn });
    expect(f.llamadas.every((l) => l.url.searchParams.get("teamId") === "team_otro")).toBe(true);
  });

  it("GitHub: sin el resumen (404) usa el informe detallado; sin permiso → credencial_rechazada", async () => {
    const r = await LECTORES.github(ctx(SECRETOS, rutasCompletas({
      "api.github.com/users/restcasatomascrevillent/settings/billing/usage/summary": () => resp({ message: "Not Found" }, 404),
      "api.github.com/users/restcasatomascrevillent/settings/billing/usage": () => resp({ usageItems: [{ product: "actions", unitType: "Minutes", quantity: 50, pricePerUnit: 0.006 }] }),
    })));
    expect(r.metricas.actions_computo.valor).toBe(0.3);
    const sinPermiso = await LECTORES.github(ctx(SECRETOS, rutasCompletas({
      "api.github.com/users/restcasatomascrevillent/settings/billing/usage/summary": () => resp({ message: "Resource not accessible" }, 403),
    })));
    expect(sinPermiso).toMatchObject({ error: "credencial_rechazada", detalles: { permiso_necesario: "Plan (lectura)" } });
  });

  it("Resend: clave solo de envío (401 restricted_api_key) aprovecha las cabeceras de cuota", async () => {
    const r = await LECTORES.resend(ctx(SECRETOS, rutasCompletas({
      "api.resend.com/domains": () => resp({ name: "restricted_api_key", message: "This API key is restricted" }, 401, { "x-resend-monthly-quota": "40" }),
    })));
    expect(r.error).toBeFalsy();
    expect(r.metricas.correos_mes.valor).toBe(40);
    expect(r.metricas.correos_hoy).toBeUndefined(); // sin tope diario = plan de pago
    expect(String(r.detalles?.avisos)).toContain("solo permite enviar");
  });

  it("Resend: sin cabeceras de cuota → estimación con nuestras tablas", async () => {
    const r = await LECTORES.resend(ctx(SECRETOS, rutasCompletas({ "api.resend.com/domains": () => resp({ data: [] }) })));
    expect(r.metricas.correos_mes).toMatchObject({ valor: 10, nota: expect.stringContaining("Estimación") });
    expect(r.metricas.dominios.valor).toBe(0);
  });

  it("Resend: clave inválida → credencial_rechazada (con la estimación)", async () => {
    const r = await LECTORES.resend(ctx(SECRETOS, rutasCompletas({ "api.resend.com/domains": () => resp({ name: "validation_error" }, 401) })));
    expect(r.error).toBe("credencial_rechazada");
    expect(r.metricas.correos_mes.valor).toBe(10);
  });

  it("Supabase: token sin permiso → aviso, pero las métricas de la BD siguen", async () => {
    const r = await LECTORES.supabase(ctx(SECRETOS, rutasCompletas({
      "api.supabase.com/v1/projects/sfonaclosuafvlhutkon/analytics/endpoints/usage.api-counts": () => resp({ message: "Forbidden" }, 403),
      "api.supabase.com/v1/projects/sfonaclosuafvlhutkon/analytics/endpoints/logs": () => resp({ message: "Forbidden" }, 403),
    })));
    expect(r.error).toBeFalsy();
    expect(r.metricas.bd_tamano.valor).toBe(50_632_371);
    expect(r.detalles?.token_rechazado).toBe(true);
  });

  it("Supabase: sin la migración y sin token → error_api", async () => {
    estado.errorMetricas = true;
    const r = await LECTORES.supabase(ctx({}, {}));
    expect(r.error).toBe("error_api");
  });

  it("OpenAI: sin coste real reciente avisa; sin ningún real, todo es estimado; sin tablas → error_api", async () => {
    estado.metricasExtra = { openai_ultimo_dia_real: "2026-10-22" };
    const r = await LECTORES.openai(ctx({}, {}));
    expect(String(r.detalles?.avisos)).toContain("desde el 22/10/2026");
    estado.metricasExtra = { openai_usd_mes_real: null, openai_ultimo_dia_real: null, ia_usd_mes_estimado: 0.5 };
    const sinReal = await LECTORES.openai(ctx({}, {}));
    expect(sinReal.metricas.gasto_estimado_usd.valor).toBe(0.5);
    expect(sinReal.coste_variable).toMatchObject({ importe: 0.5, origen: "estimado" });
    expect(String(sinReal.detalles?.avisos)).toContain("ningún coste real");
    estado.metricasExtra = { openai_usd_mes_real: undefined, ia_usd_mes_estimado: undefined };
    expect((await LECTORES.openai(ctx({}, {}))).error).toBe("error_api");
  });

  it("Vapi: sin call_logs ni clave → falta_secreto; clave rechazada con call_logs → aviso y datos de la BD", async () => {
    estado.metricasExtra = { llamadas_mes: undefined };
    expect(await LECTORES.vapi(ctx({}, {}))).toMatchObject({ error: "falta_secreto", detalles: { secreto: "VAPI_API_KEY" } });
    estado.metricasExtra = {};
    const r = await LECTORES.vapi(ctx(SECRETOS, rutasCompletas({ "api.vapi.ai/analytics": () => resp({ message: "Unauthorized" }, 401) })));
    expect(r.error).toBeFalsy();
    expect(r.detalles?.token_rechazado).toBe(true);
    expect(r.coste_variable).toMatchObject({ importe: 0.75, origen: "bd" });
  });

  it("Hostinger: sin el portfolio de dominios sigue con las suscripciones", async () => {
    const r = await LECTORES.hostinger(ctx(SECRETOS, rutasCompletas({ "developers.hostinger.com/api/domains/v1/portfolio": () => resp({}, 500) })));
    expect(r.error).toBeFalsy();
    expect(r.metricas.suscripciones_activas.valor).toBe(2);
    expect(r.metricas.dominios).toBeUndefined();
    expect(String(r.detalles?.avisos)).toContain("500");
  });

  it("metricasBd: una sola llamada a la RPC por contexto", async () => {
    const c = ctx({}, {});
    await Promise.all([metricasBd(c), metricasBd(c), LECTORES.openai(c), LECTORES.vapi(c)]);
    expect(estado.rpcs.filter((f) => f === "servicios_metricas_supabase")).toHaveLength(1);
  });

  it("Stripe: más de 5 páginas → cifras parciales con aviso", async () => {
    let n = 0;
    const r = await LECTORES.stripe(ctx(SECRETOS, rutasCompletas({
      "api.stripe.com/v1/balance_transactions": () => resp({ data: [{ id: `txn_${++n}`, type: "charge", amount: 100, fee: 1, currency: "eur" }], has_more: true }),
    })));
    expect(r.metricas.cobros_mes.valor).toBe(5);
    expect(String(r.detalles?.avisos)).toContain("parciales");
  });
});

describe("manejo de la base de datos", () => {
  it("base sin 20261103160000 (sin coste_variable): se guarda la lectura sin esa columna", async () => {
    estado.errorInsertColumna = true;
    const r = await llamar(manejador().h, "jwt-super");
    expect(r.status).toBe(200);
    expect(lectura(r.cuerpo, "openai").guardada).toBe(true);
    expect(estado.insertadas.every((f) => !("coste_variable" in f))).toBe(true);
  });
  it("sin la migración → 503 sin_migracion", async () => {
    estado.errorServicios = { message: 'relation "public.servicios_contratados" does not exist', code: "42P01" };
    const r = await llamar(manejador().h, "jwt-super");
    expect(r).toMatchObject({ status: 503, cuerpo: { error: "sin_migracion" } });
  });
  it("si no se puede guardar la lectura, se devuelve igual (guardada: false)", async () => {
    estado.errorInsert = { message: "disk full" };
    const r = await llamar(manejador().h, "jwt-super");
    expect(r.status).toBe(200);
    expect(lectura(r.cuerpo, "supabase")).toMatchObject({ guardada: false, desde_cache: false });
  });
});

describe("utilidades", () => {
  it("resumirUsoVercel reconoce nombres alternativos", () => {
    expect(resumirUsoVercel([{ requests: 7, fast_data_transfer_bytes: 10, fast_origin_transfer_bytes: 3, invocations: 2, active_cpu_ms: 7_200_000 }]))
      .toMatchObject({ peticiones: 7, bytesServidos: 10, bytesOrigen: 3, invocaciones: 2, cpuHoras: 2 });
    expect(resumirUsoVercel({ data: { proyectos: [{ request_hit_count: 1 }, { request_hit_count: 2 }] } }).peticiones).toBe(3);
    expect(resumirUsoVercel(null).claves).toEqual([]);
  });
  it("resumirUsoGithub ignora lo que no es Actions (salvo en lo facturado)", () => {
    expect(resumirUsoGithub(GITHUB_RESUMEN)).toEqual({ computoUsd: 7, minutos: 1100, almacenamientoGbHoras: 3.6, netoUsd: 1 });
    expect(resumirUsoGithub({})).toEqual({ computoUsd: 0, minutos: 0, almacenamientoGbHoras: 0, netoUsd: null });
  });
  it("resumirAnaliticaVapi y resumirSuscripcionesHostinger", () => {
    expect(resumirAnaliticaVapi([{ name: "servicios_mes", result: [{ sumCost: 1, countId: 2 }, { sumCost: 0.5, countId: 1 }] }])).toEqual({ coste: 1.5, llamadas: 3 });
    expect(resumirAnaliticaVapi({ raro: true })).toEqual({ coste: null, llamadas: null });
    const [hosting] = resumirSuscripcionesHostinger(SUSCRIPCIONES_HOSTINGER);
    expect(hosting).toMatchObject({ nombre: "Premium Web Hosting", precio_renovacion: 95.88, moneda: "EUR", meses: 12, renovacion_automatica: true, caduca: "2026-11-20T10:00:00Z" });
    expect(resumirSuscripcionesHostinger({ data: [{ name: "X", billing_period: 30, billing_period_unit: "day", renewal_price: 300 }] })[0]).toMatchObject({ meses: 1, precio_renovacion: 3 });
  });
  it("aplicarLimites usa el límite y la unidad de servicios_contratados", () => {
    expect(aplicarLimites({ a: { etiqueta: "A", valor: 1, unidad: "bytes" }, b: { etiqueta: "B", valor: 2, unidad: "u" } }, { a: { limite: 5, unidad: "GB" }, b: { limite: null } }))
      .toEqual({ a: { etiqueta: "A", valor: 1, unidad: "bytes", limite: 5, unidad_limite: "GB" }, b: { etiqueta: "B", valor: 2, unidad: "u" } });
  });
  it("modoStripe por el prefijo", () => {
    expect(modoStripe("sk_live_x")).toBe("real");
    expect(modoStripe("rk_test_x")).toBe("prueba");
    expect(modoStripe("otra")).toBe("desconocido");
  });
  it("refDeUrl y ocultarSecretos", () => {
    expect(refDeUrl("https://sfonaclosuafvlhutkon.supabase.co")).toBe("sfonaclosuafvlhutkon");
    expect(refDeUrl("http://127.0.0.1:54321")).toBeNull();
    expect(ocultarSecretos({ a: [`x ${SECRETOS.RESEND_API_KEY} y`] }, (n) => (SECRETOS as Record<string, string>)[n])).toEqual({ a: ["x [oculto] y"] });
  });
});
