// ============================================================================
// ANALIZAR-PETICION — Edge Function (Peticiones del panel → Tickets del Super Admin)
// ============================================================================
// La IA analiza una petición UNA vez y guarda en `peticiones.analisis`: qué
// quieren (resumen y tipo), la tarea propuesta y cómo la haría (pasos, módulos,
// repo, riesgo, si toca la base de datos, criterios de aceptación, preguntas) y
// un prompt listo para una IA de programación (con las reglas del repo).
//
//   POST { peticion_id: uuid, forzar?: boolean }
//     · Sin `forzar`: la llama el panel justo después de guardar (quien la
//       envió) o el Super Admin al abrir un ticket que se quedó sin analizar.
//       Solo analiza si está pendiente (o colgada > 3 min): nunca repite.
//     · Con `forzar` («Volver a analizar»): SOLO super admin. Máx. 10 intentos.
//   200 { ok: true, analisis_estado, analisis?, repetido? }
//   400 cuerpo no válido · 401 sin usuario · 403 sin permiso · 404 no existe
//   429 tope de análisis · 502 la IA falló (la petición queda con el motivo
//   en analisis_error y se puede reintentar) · 503 sin clave o sin BD
//
//   POST { accion: "enviar_linear", peticion_id } — «Enviar a Linear» (SOLO
//     super admin). Crea la incidencia en el equipo/proyecto de Logs ›
//     Configuración › Linear (o en el destino de pruebas si linear_modo es
//     «prueba»), sin duplicados aunque se repita, y guarda linear_id
//     (identificador, p. ej. CAS-12) y linear_url. Lógica en linear.ts.
//   200 { ok, destino: "real"|"prueba", identificador, url, repetido, aceptada }
//   403 no es super admin · 404 no existe · 409 desactivado, sin equipo,
//   analizando o descartada · 502 Linear falló (mensaje en español) ·
//   503 sin LINEAR_API_KEY, sin BD o sin configuración
//
// - Auth: verify_jwt (config.toml) + usuario real (_shared/autorizacion.ts).
//   La petición se lee con service role y se comprueba que es SUYA o que es
//   super admin (is_super_admin con el id ya verificado, nunca del body).
// - Clave: proceso «otros» → OPENAI_API_KEY (_shared/clave-openai.ts).
// - Modelo: ia_modelo_funcion (Super Admin › Servicios › Modelos) si tiene
//   fila; si no, secreto PETICIONES_IA_MODELO, por defecto gpt-4.1-mini; con
//   el modelo de respaldo si el elegido no existe.
// - Consumo: registrarUso (ia_uso), también si falla; disparador peticion:<id>.
// - A la IA solo va el texto de la petición y el módulo (prompt.ts).
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirUsuario } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import { configModeloFuncion, esErrorDeModelo, parametrosChat } from "../_shared/modelo-funcion.ts";
import { AcumuladorUso, registrarUso, type UsageBruto } from "../_shared/registrar-uso-ia.ts";
import { entornoDeSupabase } from "../_shared/logs-web/clasificacion.ts";
import { enviarPeticionALinear, type ConfigLinearPeticiones, type PeticionParaLinear } from "./linear.ts";
import { ESQUEMA_ANALISIS, FUNCION, interpretarRespuesta, MAX_TOKENS, mensajesAnalisis, MODELO_POR_DEFECTO, type PeticionParaIa } from "./prompt.ts";

const createClient = clienteConAuditoria(createClientBase, FUNCION);
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (n: string) => (Deno.env.get(n) ?? "").trim();

interface FilaPeticion extends PeticionParaIa {
  id: string;
  creado_por: string | null;
  analisis_estado: string;
  analisis: unknown;
  analisis_error: string | null;
  analisis_intentos: number;
}
const COLUMNAS = "id, creado_por, titulo, prioridad, modulo, descripcion, ruta, dispositivo, captura_path, analisis_estado, analisis, analisis_error, analisis_intentos";
const COLUMNAS_LINEAR = "id, titulo, prioridad, modulo, descripcion, ruta, dispositivo, captura_path, creado_por_nombre, created_at, estado, analisis, analisis_estado, linear_id, linear_url";

/** Panel del entorno (para el enlace de vuelta al ticket). */
function urlPanel(): string {
  return env("LOGS_WEB_URL_PANEL")
    || (entornoDeSupabase(env("SUPABASE_URL")) === "produccion" ? "https://admin-casatomas.vercel.app" : "https://admin-casatomas-git-staging-casa-tomas.vercel.app");
}

/** «Enviar a Linear» (ya comprobado: super admin). Toda la lógica, en linear.ts. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enviarALinear(sb: any, id: string): Promise<Response> {
  const { data: fila, error: errLeer } = await sb.from("peticiones").select(COLUMNAS_LINEAR).eq("id", id).maybeSingle();
  if (errLeer) return json({ ok: false, error: "No se pudo leer la petición" }, 503);
  if (!fila) return json({ ok: false, error: "Esa petición no existe" }, 404);
  const r = await enviarPeticionALinear(fila as PeticionParaLinear, {
    async leerConfig() {
      const { data, error } = await sb.from("web_logs_config")
        .select("linear_modo, linear_equipo_id, linear_proyecto_id, linear_etiquetas").eq("id", true).maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as ConfigLinearPeticiones | null;
    },
    async guardarEnviado(v) {
      const { error } = await sb.from("peticiones").update(v).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async aceptar() {
      const { data, error } = await sb.from("peticiones").update({ estado: "aceptada" }).eq("id", id).in("estado", ["nueva", "en_analisis"]).select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    },
    prueba: {
      async buscarCreado(linearUuid) {
        const { data } = await sb.from("web_linear_prueba").select("id").eq("linear_uuid", linearUuid).eq("operacion", "crear").limit(1);
        return data?.[0] ?? null;
      },
      async insertar(v) {
        const { data, error } = await sb.from("web_linear_prueba").insert(v).select("id").single();
        if (error) throw new Error(error.message);
        return data;
      },
    },
    apiKey: env("LINEAR_API_KEY"),
    urlPanel: urlPanel(),
    log: (m) => console.error(`[${FUNCION}] enviar_linear ${id}: ${m}`),
  });
  if (!r.ok) return json({ ok: false, error: r.error }, r.status);
  return json(r);
}

/** Llama a OpenAI (modelo elegido y, si no existe, el de respaldo). Devuelve el texto o lanza un Error legible. */
async function llamarIa(clave: string, peticion: PeticionParaIa, cliente: ReturnType<typeof createClient>, disparador: string): Promise<{ texto: string; modelo: string }> {
  const elegido = await configModeloFuncion(FUNCION, env("PETICIONES_IA_MODELO") || MODELO_POR_DEFECTO, { cliente });
  const modelos = [elegido.modelo, ...(elegido.respaldo && elegido.respaldo !== elegido.modelo ? [elegido.respaldo] : [])];
  let ultimo: Error | null = null;
  for (const modelo of modelos) {
    const uso = new AcumuladorUso(FUNCION, modelo, "chat");
    const t0 = Date.now();
    const ctrl = new AbortController();
    const corte = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelo, messages: mensajesAnalisis(peticion), response_format: ESQUEMA_ANALISIS, ...parametrosChat(modelo, MAX_TOKENS, 0.2) }),
        signal: ctrl.signal,
      });
      const cuerpo = await res.text();
      let datos: { usage?: unknown; choices?: Array<{ message?: { content?: unknown } }> } | null = null;
      try {
        datos = JSON.parse(cuerpo);
      } catch {
        datos = null;
      }
      uso.sumar(datos?.usage as UsageBruto | undefined);
      if (!res.ok) {
        uso.marcarError();
        console.error(`[${FUNCION}] OpenAI ${res.status} con ${modelo}: ${cuerpo.slice(0, 300)}`);
        ultimo = new Error(motivoErrorOpenAI(res.status, cuerpo));
        if (esErrorDeModelo(res.status, cuerpo)) continue; // probar el respaldo
        throw ultimo;
      }
      const texto = datos?.choices?.[0]?.message?.content;
      if (typeof texto !== "string" || !texto.trim()) throw new Error("La IA devolvió una respuesta vacía");
      return { texto, modelo };
    } catch (e) {
      uso.marcarError();
      ultimo = (e as Error)?.name === "AbortError" ? new Error("La IA no respondió en 45 segundos") : e instanceof Error ? e : new Error(String(e));
      throw ultimo;
    } finally {
      clearTimeout(corte);
      await registrarUso(uso, { disparador, duracionMs: Date.now() - t0 });
    }
  }
  throw ultimo ?? new Error("No hay ningún modelo de IA disponible");
}

Deno.serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const usuario = await exigirUsuario(req, { crearCliente: createClient, corsHeaders: cors });
  if (!usuario.ok) return usuario.response;

  const cuerpo = await req.json().catch(() => null) as { peticion_id?: unknown; forzar?: unknown; accion?: unknown } | null;
  const id = typeof cuerpo?.peticion_id === "string" ? cuerpo.peticion_id.trim() : "";
  const forzar = cuerpo?.forzar === true;
  const accion = cuerpo?.accion ?? null;
  if (accion !== null && accion !== "enviar_linear") return json({ ok: false, error: "Acción no válida" }, 400);
  if (!UUID.test(id)) return json({ ok: false, error: accion ? "Falta el ticket que hay que enviar" : "Falta la petición que hay que analizar" }, 400);

  const url = env("SUPABASE_URL");
  const servicio = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !servicio) return json({ ok: false, error: "No se pudo conectar con la base de datos" }, 503);
  const sb = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });

  let esSuper = false;
  try {
    const { data, error } = await sb.rpc("is_super_admin", { _user_id: usuario.userId });
    if (error) throw new Error(error.message);
    esSuper = data === true;
  } catch (e) {
    console.error(`[${FUNCION}] no se pudo comprobar super admin:`, (e as Error)?.message ?? e);
    return json({ ok: false, error: "No se pudo comprobar tu permiso. No se ha analizado nada." }, 503);
  }
  if (accion === "enviar_linear") {
    if (!esSuper) return json({ ok: false, error: "Solo el super admin puede enviar tickets a Linear" }, 403);
    return enviarALinear(sb, id);
  }
  if (forzar && !esSuper) return json({ ok: false, error: "Solo el super admin puede volver a analizar una petición" }, 403);

  const { data: fila, error: errLeer } = await sb.from("peticiones").select(COLUMNAS).eq("id", id).maybeSingle();
  if (errLeer) return json({ ok: false, error: "No se pudo leer la petición" }, 503);
  const peticion = fila as FilaPeticion | null;
  // A quien no es el autor ni super admin no se le dice si existe.
  if (!peticion || (!esSuper && peticion.creado_por !== usuario.userId)) return json({ ok: false, error: "Esa petición no existe" }, 404);

  // Reserva atómica: sin forzar, solo si está pendiente (cada petición se analiza una vez).
  const { data: reservadas, error: errReservar } = await sb.rpc("peticion_reservar_analisis", { p_id: id, p_forzar: forzar });
  if (errReservar) {
    console.error(`[${FUNCION}] peticion_reservar_analisis:`, errReservar.message);
    return json({ ok: false, error: "No se pudo preparar el análisis" }, 503);
  }
  if (!Array.isArray(reservadas) || reservadas.length === 0) {
    if (forzar) return json({ ok: false, error: "Esta petición ya se ha analizado 10 veces: no se puede repetir más" }, 429);
    return json({ ok: true, repetido: true, analisis_estado: peticion.analisis_estado, analisis: peticion.analisis ?? null });
  }

  const guardarError = async (motivo: string) => {
    await sb.from("peticiones").update({ analisis_estado: "error", analisis_error: motivo.slice(0, 500) }).eq("id", id);
  };

  const clave = claveOpenAI("otros");
  if (!clave) {
    await guardarError("Falta la clave de OpenAI (OPENAI_API_KEY) en Supabase");
    return json({ ok: false, error: "Falta la clave de OpenAI: no se puede analizar" }, 503);
  }

  try {
    const { texto, modelo } = await llamarIa(clave, peticion, sb, `peticion:${id}`);
    const analisis = interpretarRespuesta(texto);
    const { error: errGuardar } = await sb.from("peticiones").update({
      analisis,
      analisis_estado: "hecho",
      analisis_error: null,
      analisis_modelo: modelo,
      analizado_en: new Date().toISOString(),
    }).eq("id", id);
    if (errGuardar) throw new Error("No se pudo guardar el análisis");
    return json({ ok: true, analisis_estado: "hecho", analisis });
  } catch (e) {
    const motivo = ((e as Error)?.message ?? "Error desconocido").replace(/\s+/g, " ").trim().slice(0, 300) || "Error desconocido";
    console.error(`[${FUNCION}] ${id}:`, motivo);
    await guardarError(motivo);
    return json({ ok: false, error: `No se pudo analizar: ${motivo}` }, 502);
  }
}));
