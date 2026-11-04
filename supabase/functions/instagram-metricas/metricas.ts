/**
 * Edge Function instagram-metricas — pestaña «Métricas» de Instagram.
 *
 *   «leer» (GET, o POST {accion:"leer"}) — usuario con can_read_section('marketing'):
 *     200 { ok, igUserId, hoy, ultimoDia, resumen: { d7, d28 } | null, serie, publicaciones,
 *           ultimaCaptura, ultimaCorrecta }      (ver leer.ts y resumen.ts)
 *
 *   «capturar» (POST {accion:"capturar"}) — tres formas de llamarla:
 *     · pg_cron (tarea instagram-metricas-diarias) con la cabecera
 *       x-webhook-secret = INSTAGRAM_METRICAS_CRON_SECRET (comparada en
 *       tiempo constante; FALLA CERRADO si el secreto no está configurado);
 *     · `Authorization: Bearer <service_role>` (scripts);
 *     · el botón «Actualizar ahora» del panel: usuario con
 *       can_write_section('marketing'); como mucho una vez cada 5 minutos.
 *     200 { ok, fechaCaptura, dias, publicaciones, avisos }
 *     502 { ok:false, tipo:"permiso_insights", permiso:"instagram_manage_insights", error, comoArreglarlo }
 *     503 { ok:false, tipo:"configuracion", error, problemas, comoArreglarlo }   (faltan secretos de Meta)
 *     429 { ok:false, tipo:"demasiado_pronto", error, reintentarEn }
 *     otros errores de Meta: { ok:false, tipo, error, comoArreglarlo, codigo, … } con el estado de errores.ts
 *
 *   401 sin sesión / secreto incorrecto · 403 sin Marketing · 405 otro método.
 *
 * Las métricas se ESCRIBEN solo con la clave de servicio (las tablas no dejan
 * escribir a nadie más) y se LEEN como el usuario (RLS). El token de Meta, la
 * clave de servicio, el secreto del cron y el JWT nunca salen en respuestas
 * ni registros (todo pasa por _shared/instagram/secretos.ts).
 */
import { ClienteGraph } from "../_shared/instagram/cliente.ts";
import { entornoDeno, leerConfigMeta } from "../_shared/instagram/entorno.ts";
import { ErrorInstagram, errorInstagramAJson, estadoHttpDeError } from "../_shared/instagram/errores.ts";
import { json, jsonAuth, leerJson, opciones } from "../_shared/instagram/http.ts";
import { PERMISO_INSIGHTS } from "../_shared/instagram/insights.ts";
import { mensajeSaneado, registrarSecreto, registro, sanear } from "../_shared/instagram/secretos.ts";
import { entornoSupabase } from "../_shared/instagram/supabase.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { autorizarSeccion, restServicio, restUsuario, type Rest } from "./acceso.ts";
import { capturarMetricas } from "./capturar.ts";
import { leerMetricas } from "./leer.ts";

export const CABECERA_CRON = "x-webhook-secret";
export const MINUTOS_ENTRE_CAPTURAS_PANEL = 5;

/** Nombres extra que lee esta función (además de los de Meta y Supabase de entornoDeno). */
const NOMBRES_EXTRA = ["SUPABASE_SERVICE_ROLE_KEY", "INSTAGRAM_METRICAS_CRON_SECRET"] as const;

export function entornoMetricas(): Record<string, string | undefined> {
  const deno = (globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } }).Deno;
  const salida = entornoDeno();
  for (const n of NOMBRES_EXTRA) salida[n] = deno?.env.get(n);
  return salida;
}

export interface DependenciasMetricas {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

type Accion = "leer" | "capturar";
type Origen = "cron" | "panel" | "servicio";

async function leerAccion(request: Request): Promise<{ ok: true; accion: Accion } | { ok: false; respuesta: Response }> {
  let accion: unknown = "leer";
  if (request.method === "GET") {
    accion = new URL(request.url).searchParams.get("accion") ?? "leer";
  } else {
    const cuerpo = await leerJson(request, 4096);
    if (!cuerpo.ok) {
      // Cuerpo vacío = «leer».
      if (cuerpo.estado === 413) return { ok: false, respuesta: json(413, { ok: false, error: cuerpo.error }) };
    } else if (cuerpo.valor && typeof cuerpo.valor === "object") {
      accion = (cuerpo.valor as { accion?: unknown }).accion ?? "leer";
    }
  }
  if (accion !== "leer" && accion !== "capturar") {
    return { ok: false, respuesta: json(400, { ok: false, error: "Acción no válida: usa «leer» o «capturar»" }) };
  }
  return { ok: true, accion };
}

async function anotarCaptura(db: Rest, fila: Record<string, unknown>): Promise<void> {
  try {
    await db.guardar("instagram_metricas_capturas", [fila]);
  } catch (e) {
    registro("error", "instagram-metricas", "no se pudo anotar la captura", e);
  }
}

export async function manejarMetricas(request: Request, deps: DependenciasMetricas = {}): Promise<Response> {
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "GET" && request.method !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  const env = deps.env ?? entornoMetricas();
  const f = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const claveServicio = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const secretoCron = env.INSTAGRAM_METRICAS_CRON_SECRET?.trim() || "";
  registrarSecreto(claveServicio);
  registrarSecreto(secretoCron);

  const a = await leerAccion(request);
  if (!a.ok) return a.respuesta;
  const sb = entornoSupabase(env);
  if (!sb) return json(500, { ok: false, error: "Falta la configuración de Supabase" });

  // ── Quién llama ──
  let origen: Origen;
  const cabeceraCron = request.headers.get(CABECERA_CRON);
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (cabeceraCron !== null) {
    // FALLA CERRADO: sin secreto configurado no se acepta ninguna llamada de cron.
    if (!secretoCron) {
      registro("error", "instagram-metricas", "INSTAGRAM_METRICAS_CRON_SECRET no configurado: se rechaza la llamada del cron");
      return json(500, { ok: false, error: "Falta configurar el secreto del cron (INSTAGRAM_METRICAS_CRON_SECRET)" });
    }
    if (!compararTiempoConstante(cabeceraCron, secretoCron)) return jsonAuth(401, "Secreto del cron incorrecto");
    if (a.accion !== "capturar") return json(400, { ok: false, error: "El cron solo puede capturar" });
    origen = "cron";
  } else if (claveServicio && bearer && compararTiempoConstante(bearer, claveServicio)) {
    if (a.accion !== "capturar") return json(400, { ok: false, error: "Con la clave de servicio solo se puede capturar" });
    origen = "servicio";
  } else {
    const auth = await autorizarSeccion(request.headers.get("authorization"), a.accion === "leer" ? "leer" : "escribir", env, f);
    if (!auth.ok) return jsonAuth(auth.estado, auth.motivo);
    if (a.accion === "leer") {
      try {
        const igUserId = env.IG_USER_ID?.trim() || null;
        return json(200, await leerMetricas(restUsuario(auth.sesion), { igUserId, ahora: ahora() }));
      } catch (e) {
        registro("error", "instagram-metricas", "fallo al leer", e);
        return json(500, { ok: false, error: `No se pudieron leer las métricas: ${mensajeSaneado(e)}` });
      }
    }
    origen = "panel";
  }

  // ── Capturar ──
  if (!claveServicio) return json(500, { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY en la función" });
  const servicio = restServicio(sb, claveServicio, f);

  const config = leerConfigMeta(env);
  if (!config.ok) {
    const nombres = config.problemas.map((p) => p.variable);
    await anotarCaptura(servicio, {
      origen,
      fin: new Date(ahora()).toISOString(),
      ok: false,
      error_tipo: "configuracion",
      error: `Faltan o están mal: ${nombres.join(", ")}`,
    });
    return json(503, {
      ok: false,
      tipo: "configuracion",
      error: `Falta configurar Instagram en los secretos de Supabase: ${nombres.join(", ")}`,
      problemas: config.problemas.map((p) => `${p.variable}: ${p.problema}`),
      comoArreglarlo: config.problemas.map((p) => p.comoArreglarlo),
    });
  }

  if (origen === "panel") {
    try {
      const ultimas = await servicio.leer<{ inicio: string }>(
        "instagram_metricas_capturas?select=inicio&origen=eq.panel&order=inicio.desc&limit=1",
        "las capturas",
      );
      const ms = ultimas[0] ? Date.parse(ultimas[0].inicio) : NaN;
      const espera = MINUTOS_ENTRE_CAPTURAS_PANEL * 60_000 - (ahora() - ms);
      if (Number.isFinite(espera) && espera > 0) {
        const segundos = Math.ceil(espera / 1000);
        return json(429, {
          ok: false,
          tipo: "demasiado_pronto",
          error: `Las métricas se actualizaron hace menos de ${MINUTOS_ENTRE_CAPTURAS_PANEL} minutos. Vuelve a intentarlo en ${Math.ceil(segundos / 60)} min.`,
          reintentarEn: segundos,
        }, { "Retry-After": String(segundos) });
      }
    } catch (e) {
      registro("warn", "instagram-metricas", "no se pudo comprobar la última captura", e);
    }
  }

  const inicio = new Date(ahora()).toISOString();
  const cliente = new ClienteGraph({
    token: config.config.token,
    versionApi: config.config.versionApi,
    igUserId: config.config.igUserId,
    fetch: (u, i) => f(u, i),
    dormir: deps.dormir,
    registro: (l) => registro("info", "instagram-metricas", l),
  });
  try {
    const r = await capturarMetricas({ cliente, igUserId: config.config.igUserId, servicio, ahora });
    await anotarCaptura(servicio, {
      origen,
      inicio,
      fin: new Date(ahora()).toISOString(),
      ok: true,
      ig_user_id: config.config.igUserId,
      dias: r.dias.length,
      publicaciones: r.publicaciones,
      avisos: r.avisos.map((x) => sanear(x).slice(0, 500)).slice(0, 20),
    });
    return json(200, { ok: true, ...r });
  } catch (e) {
    const fallo = (tipo: string, mensaje: string) =>
      anotarCaptura(servicio, {
        origen,
        inicio,
        fin: new Date(ahora()).toISOString(),
        ok: false,
        ig_user_id: config.config.igUserId,
        error_tipo: tipo,
        error: sanear(mensaje).slice(0, 2000),
      });
    if (e instanceof ErrorInstagram) {
      const cuerpo = errorInstagramAJson(e);
      const permiso = e.tipo === "permisos" && e.comoArreglarlo.includes(PERMISO_INSIGHTS);
      await fallo(permiso ? "permiso_insights" : e.tipo, e.message);
      if (permiso) return json(502, { ok: false, ...cuerpo, tipo: "permiso_insights", permiso: PERMISO_INSIGHTS });
      return json(estadoHttpDeError(e), { ok: false, ...cuerpo });
    }
    registro("error", "instagram-metricas", "fallo al capturar", e);
    await fallo("interno", mensajeSaneado(e));
    return json(500, { ok: false, tipo: "interno", error: `No se pudieron capturar las métricas: ${mensajeSaneado(e)}` });
  }
}
