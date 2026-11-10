// interpretar-reserva-manuscrita
// ---------------------------------------------------------------------------
// «Escribir reserva» (libro de reservas del panel, 10/11/2026): recibe lo
// escrito a mano con el lápiz en la hoja del día (PNG, fondo blanco) y devuelve
// lo que pone, con visión: transcripción literal + nombre, teléfono, email,
// comensales, sala tal como está escrita, día/mes/año (año solo si se escribió),
// hora y notas.
//
// - Nunca escribe en la base de datos: el panel interpreta la lectura con
//   _shared/reserva-manuscrita.ts (salas reales, año, «2px», «noviempre»…),
//   enseña la vista previa editable y guarda con el alta manual de siempre
//   (FormularioReserva).
// - Auth: verify_jwt (config.toml) + usuario real que PUEDE DAR DE ALTA
//   reservas: rpc reservas_puede_crear() con el JWT del usuario (la misma
//   función que la RLS del INSERT en reservas, 20261122143500). Sin ese
//   permiso no se gasta IA.
// - Clave: proceso «otros» → OPENAI_API_KEY (_shared/clave-openai.ts).
// - Modelo: ia_modelo_funcion (Super Admin › Servicios › Modelos) si tiene
//   fila; si no, env RESERVA_MANUSCRITA_MODELO, por defecto gpt-4.1.
//
// Body: { imagen: "<data:image/png;base64,…>", espacios?: string[], fecha_pagina?: "YYYY-MM-DD" }
// Respuesta: { ok: true, lectura: LecturaModelo } | { ok: false, error }
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import { modeloDeFuncion, parametrosChat } from "../_shared/modelo-funcion.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { limpiarLecturaModelo } from "../_shared/reserva-manuscrita.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCION = "interpretar-reserva-manuscrita";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// Un lienzo de tablet en PNG ronda 50-400 KB en base64.
const MAX_BASE64 = 4_000_000;

function env(nombre: string): string {
  return (Deno.env.get(nombre) ?? "").trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const texto = { type: ["string", "null"] };
const entero = { type: ["integer", "null"] };
const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "reserva_manuscrita",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["texto", "nombre", "telefono", "email", "comensales", "espacio", "fecha", "dia", "mes", "anio", "hora", "notas"],
      properties: {
        texto,
        nombre: texto,
        telefono: texto,
        email: texto,
        comensales: entero,
        espacio: texto,
        fecha: texto,
        dia: entero,
        mes: entero,
        anio: entero,
        hora: texto,
        notas: texto,
      },
    },
  },
};

function prompt(espacios: string[], fechaPagina: string | null): string {
  return [
    "Eres el encargado de sala de un restaurante en España y lees el libro de reservas escrito a mano.",
    "La imagen es UNA reserva escrita a mano con un lápiz en una tablet, normalmente en una línea, p. ej. «Esther 2px salón 13 noviembre 14:15».",
    "Abreviaturas habituales: «px», «pax», «p», «pers» = personas (comensales); «h» = hora.",
    "",
    "CAMPOS:",
    "- texto: transcripción LITERAL de todo lo escrito, en una línea, tal cual (con sus faltas). null si no hay nada legible.",
    "- nombre: nombre (y apellidos si los hay) de quien reserva. null si no se lee.",
    "- telefono: teléfono si está escrito (solo dígitos y +). null si no.",
    "- email: email si está escrito. null si no.",
    "- comensales: número de personas (entero). null si no se lee.",
    "- espacio: la sala tal como está escrita (p. ej. «salón»). null si no se escribe ninguna sala.",
    ...(espacios.length ? [`  Salas del restaurante (para leer mejor la letra; escribe lo que pone): ${espacios.join(", ")}.`] : []),
    "- fecha: la fecha tal como está escrita («13 noviembre», «13/11», «mañana»). null si no se escribe fecha.",
    "- dia, mes: día y mes (números) de la fecha escrita, aunque el mes tenga faltas («noviempre» = 11). null si no hay fecha escrita. NUNCA los inventes.",
    "- anio: SOLO si el año está escrito; si no, null. Nunca lo deduzcas.",
    "- hora: hora en formato HH:MM de 24 h («2:15 tarde» → «14:15», «14h15» → «14:15»). null si no se escribe hora.",
    "- notas: cualquier otra indicación escrita (alergias, trona, celebración…). null si no hay.",
    ...(fechaPagina ? [`La hoja del libro es la del día ${fechaPagina}; si no se escribe fecha, deja fecha, dia y mes en null (el panel usa la de la hoja).`] : []),
    "No inventes nada: lo que no esté escrito, null. Responde solo con el JSON.",
  ].join("\n");
}

interface ClienteAuth {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

/** Usuario real del panel que puede dar de alta reservas (reservas_puede_crear, la de la RLS). */
export async function comprobarPuedeCrearReservas(
  cliente: ClienteAuth,
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403 | 500; error: string }> {
  const { data, error } = await cliente.auth.getUser();
  const user = data?.user ?? null;
  if (error || !user) return { ok: false, status: 401, error: "No autorizado" };
  const { data: puede, error: errorRpc } = await cliente.rpc("reservas_puede_crear", {});
  if (errorRpc) return { ok: false, status: 500, error: "No se pudo comprobar el permiso" };
  if (puede !== true) return { ok: false, status: 403, error: "No tienes permiso para crear reservas" };
  return { ok: true, userId: user.id };
}

serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autorizado" }, 401);
  const supabaseUser = createClientBase(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const permiso = await comprobarPuedeCrearReservas(supabaseUser as unknown as ClienteAuth);
  if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  let imagen = typeof payload.imagen === "string" ? payload.imagen.trim() : "";
  if (!imagen) return json({ ok: false, error: "Falta la imagen" }, 400);
  if (imagen.length > MAX_BASE64) return json({ ok: false, error: "La imagen es demasiado grande" }, 413);
  if (!imagen.startsWith("data:")) imagen = `data:image/png;base64,${imagen}`;
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(imagen)) {
    return json({ ok: false, error: "Formato de imagen no soportado" }, 400);
  }
  const espacios = Array.isArray(payload.espacios)
    ? (payload.espacios as unknown[])
        .filter((e): e is string => typeof e === "string" && e.trim() !== "")
        .map((e) => e.trim().slice(0, 60))
        .slice(0, 40)
    : [];
  const fechaPagina = typeof payload.fecha_pagina === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.fecha_pagina)
    ? payload.fecha_pagina
    : null;

  const clave = claveOpenAI("otros");
  if (!clave) return json({ ok: false, error: "OPENAI_API_KEY no configurada" }, 500);

  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const clienteModelo = serviceKey
    ? createClientBase(env("SUPABASE_URL"), serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
  const modelo = await modeloDeFuncion(FUNCION, env("RESERVA_MANUSCRITA_MODELO") || "gpt-4.1", { cliente: clienteModelo });

  const uso = new AcumuladorUso(FUNCION, modelo, "vision");
  const inicioMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        ...parametrosChat(modelo, 600, 0),
        response_format: SCHEMA,
        messages: [
          { role: "system", content: prompt(espacios, fechaPagina) },
          {
            role: "user",
            content: [
              { type: "text", text: "Lee esta reserva escrita a mano y devuelve el JSON." },
              { type: "image_url", image_url: { url: imagen, detail: "high" } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      uso.sumar(null);
      uso.marcarError();
      const cuerpo = await res.text();
      console.error(`[${FUNCION}] OpenAI ${res.status}: ${cuerpo.slice(0, 300)}`);
      return json({ ok: false, error: motivoErrorOpenAI(res.status, cuerpo) }, 502);
    }
    const data = await res.json();
    uso.sumar(data?.usage);
    const contenido = String(data?.choices?.[0]?.message?.content ?? "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    let raw: unknown;
    try {
      raw = JSON.parse(contenido);
    } catch {
      uso.marcarError();
      return json({ ok: false, error: "La IA no devolvió datos legibles; prueba otra vez" }, 502);
    }
    return json({ ok: true, lectura: limpiarLecturaModelo(raw) });
  } catch (error) {
    uso.marcarError();
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error(`[${FUNCION}]`, message);
    const motivo = error instanceof Error && error.name === "AbortError"
      ? "La IA ha tardado demasiado en responder; prueba otra vez"
      : `No se pudo interpretar lo escrito: ${message.slice(0, 160)}`;
    return json({ ok: false, error: motivo }, 500);
  } finally {
    clearTimeout(timeout);
    await registrarUso([uso], { disparador: `usuario:${permiso.userId}`, duracionMs: Date.now() - inicioMs });
  }
}));
