// ============================================================================
// RESUMEN-LOGS-WEB — Edge Function (Super Admin › Logs › Estadísticas y Tráfico web)
// ============================================================================
// Resumen del periodo con IA a partir de estadísticas AGREGADAS (nunca visitas
// sueltas). Solo super admin. Caché de 6 h por (entorno, desde, hasta) en
// web_resumenes_ia; `forzar: true` genera uno nuevo.
//
//   POST { desde: "YYYY-MM-DD", hasta: "YYYY-MM-DD", entorno?: "produccion"|"demo"|"local", forzar?: boolean }
//   200 { id, creado_en, resumen, cifras, modelo, cache }
//   400 periodo no válido · 401/403 sin super admin · 409 sin datos · 502 la IA falló (queda registrado) · 503 sin clave de IA
// Lógica y barandillas en resumen.ts.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { crearLlamadaIa } from "../_shared/logs-web/openai.ts";
import { cifrasParaIa, interpretarResumen, mensajesResumen, type Comportamiento } from "./resumen.ts";

const createClient = clienteConAuditoria(createClientBase, "resumen-logs-web");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const restarDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

Deno.serve(conAuditoriaDePeticion("resumen-logs-web", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "metodo_no_permitido" }, 405);
  const sa = await exigirSuperAdmin(req, { crearCliente: createClient, corsHeaders: cors });
  if (!sa.ok) return sa.response;

  const cuerpo = await req.json().catch(() => ({}));
  const desde = String(cuerpo?.desde ?? "");
  const hasta = String(cuerpo?.hasta ?? "");
  const entorno = ["produccion", "demo", "local"].includes(cuerpo?.entorno) ? cuerpo.entorno : "produccion";
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) return json({ ok: false, error: "periodo_no_valido" }, 400);
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;
  if (dias > 400) return json({ ok: false, error: "periodo_no_valido" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  if (!cuerpo?.forzar) {
    const { data: previo } = await sb.from("web_resumenes_ia").select("*")
      .eq("entorno", entorno).eq("desde", desde).eq("hasta", hasta).eq("estado", "ok")
      .gte("creado_en", new Date(Date.now() - 6 * 3_600_000).toISOString())
      .order("creado_en", { ascending: false }).limit(1);
    if (previo?.[0]) return json({ ...previo[0], cache: true });
  }

  const llamar = crearLlamadaIa("resumen-logs-web", sb, 1500);
  if (!llamar) return json({ ok: false, error: "sin_clave_ia" }, 503);

  const { data: comp, error: errComp } = await sb.rpc("web_comportamiento", { p_desde: desde, p_hasta: hasta, p_entorno: entorno, p_incluir_internos: false });
  if (errComp) return json({ ok: false, error: "estadisticas_no_disponibles" }, 503);
  const comportamiento = (comp ?? {}) as Comportamiento;
  if (!Number(comportamiento.resumen?.sesiones ?? 0) && !Number((comportamiento.anterior ?? {}).sesiones ?? 0)) {
    return json({ ok: false, error: "sin_datos", mensaje: "No hay sesiones registradas en este periodo ni en el anterior." }, 409);
  }

  const sumaVercel = async (d: string, h: string) => {
    const { data } = await sb.from("trafico_web_diario").select("visitas").eq("proyecto", "casa-tomas-story").eq("ruta", "*").gte("fecha", d).lte("fecha", h);
    return data?.length ? data.reduce((s: number, f: { visitas: number }) => s + (f.visitas ?? 0), 0) : null;
  };
  const [visitasVercel, visitasVercelAnterior, incid] = await Promise.all([
    sumaVercel(desde, hasta),
    sumaVercel(restarDias(desde, dias), restarDias(desde, 1)),
    sb.from("web_incidencias").select("titulo, ocurrencias, sesiones_afectadas, gravedad, estado")
      .eq("entorno", entorno).in("estado", ["nueva", "abierta", "reabierta"]).order("ocurrencias", { ascending: false }).limit(6),
  ]);
  const cifras = cifrasParaIa({ comportamiento, visitasVercel, visitasVercelAnterior, incidencias: incid.data ?? [] });

  try {
    const r = await llamar(mensajesResumen(cifras), `resumen:${entorno}:${desde}:${hasta}`);
    const resumen = interpretarResumen(r.texto, cifras);
    const { data: fila, error } = await sb.from("web_resumenes_ia").insert({
      creado_por: sa.userId, desde, hasta, entorno, cifras, resumen, modelo: r.modelo, estado: "ok",
    }).select("*").single();
    if (error) throw new Error(error.message);
    return json({ ...fila, cache: false });
  } catch (e) {
    const mensaje = ((e as Error)?.message ?? "error").slice(0, 300);
    await sb.from("web_resumenes_ia").insert({ creado_por: sa.userId, desde, hasta, entorno, cifras, estado: "error", error: mensaje });
    return json({ ok: false, error: "ia_fallo", mensaje }, 502);
  }
}));
