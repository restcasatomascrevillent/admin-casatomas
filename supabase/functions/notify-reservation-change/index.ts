// notify-reservation-change
// ---------------------------------------------------------------------------
// Antes: proxy ciego al webhook de n8n
// https://n8npersonal.miguelbenito.space/webhook/79fc330e-... que reenviaba el
// payload TAL CUAL y siempre respondía {success:true}.
//
// Ahora: repuntado a la Edge Function `reservas-web`, acción POST
// /notificar-estado, que es su sustituto.
//
// CONTRATO DE `reservas-web` (verificado leyendo reservas-web/index.ts, no
// supuesto):
//   · Router (:1236-1243): la ruta sale del path, POST "notificar-estado".
//   · handleNotificarEstado (:1134): exige checkSharedSecret(req), que compara
//     la cabecera `x-webhook-secret` con RESERVAS_WEB_SHARED_SECRET.
//   · (:1141) `const reservaId = typeof body?.reserva_id === "string" ? ... : null;`
//     (:1142) `if (!reservaId) return json({ok:false, error:"reserva_id_requerido"}, 400);`
//     → el campo se llama **reserva_id** y tiene que ser **string**.
//   · `reservas-web` NO tiene entrada en config.toml, así que hereda
//     verify_jwt = true → hay que mandar un JWT en Authorization.
//
// BUG QUE ESTO ARREGLA
// --------------------
// Los dos llamadores (ModalVerificacionReserva.tsx, ListaReservasAvanzada.tsx)
// hacen `body: {...reserva}`, es decir mandan el campo **id** (que es el que
// usaba n8n). Reenviarlo tal cual a reservas-web daba 400 reserva_id_requerido
// en el 100% de los casos. Y como los dos llamadores son fire-and-forget
// (`.catch(console.error)`), ningún cliente habría recibido el enlace de
// confirmar/cancelar y nadie se habría enterado. Aquí se mapea id → reserva_id.
//
// Además, la versión anterior devolvía {success:true} aunque el webhook
// contestara 500: eso es la mitad del fallo silencioso. Ahora la respuesta
// refleja el resultado real (success:false + status) y se loguea. Se sigue sin
// lanzar nunca, porque los llamadores no esperan la respuesta.
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_SECRET = Deno.env.get("RESERVAS_WEB_SHARED_SECRET") ?? "";

const RESERVAS_WEB_URL = `${SUPABASE_URL}/functions/v1/reservas-web/notificar-estado`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Autenticación / autorización ────────────────────────────────────────────
// Mismo patrón que procesar-factura/index.ts:379-438.
//
// ⚠️ `verify_jwt = true` NO es autenticación en este proyecto: la anon key es
// un JWT válido y viaja en el bundle público del panel. Hay que comprobar que
// detrás del token hay un USUARIO real.
//
// Se exige aquí porque esta función pasó a tener la service role key para
// hablar con `reservas-web`: sin comprobación, cualquiera con la anon key
// podría disparar emails de confirmación contra reservas ajenas.
//
// Nivel 'view' (no 'edit') a propósito: es exactamente lo que el panel exige
// para entrar en /reservas (ProtectedRoute.tsx:63-64 comprueba can_view), y
// los dos llamadores viven ahí sin gating adicional por can_edit. Exigir
// 'edit' dejaría fuera a usuarios que hoy sí pueden cambiar el estado.
async function autenticar(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.error("[notify-reservation-change] Sin cabecera Authorization");
    return { ok: false, response: json({ success: false, error: "No autorizado" }, 401) };
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    // Aquí cae la anon key suelta: JWT válido pero sin usuario detrás.
    console.error("[notify-reservation-change] Token sin usuario:", userError?.message);
    return { ok: false, response: json({ success: false, error: "Usuario no autenticado" }, 401) };
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // has_section_permission ya devuelve true para administradores.
  const { data: permitido, error: permError } = await supabaseAdmin.rpc(
    "has_section_permission",
    { _user_id: user.id, _section: "reservas", _permission: "view" },
  );

  if (permError) {
    console.error("[notify-reservation-change] Error comprobando permisos:", permError.message);
    return { ok: false, response: json({ success: false, error: "Error verificando permisos" }, 500) };
  }

  if (!permitido) {
    console.error("[notify-reservation-change] Usuario sin acceso a reservas:", user.id);
    return {
      ok: false,
      response: json({ success: false, error: "Sin permisos sobre la sección de reservas" }, 403),
    };
  }

  return { ok: true, userId: user.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await autenticar(req);
  if (!auth.ok) return auth.response;

  try {
    const payload = await req.json().catch(() => ({} as Record<string, unknown>));

    // Los llamadores mandan la fila entera de `reservas`, donde el id va en
    // `id`. `reservas-web` exige `reserva_id` y exige que sea string.
    const rawId = (payload as Record<string, unknown>)?.reserva_id ??
      (payload as Record<string, unknown>)?.id;
    const reservaId = typeof rawId === "string" && rawId.trim() !== "" ? rawId : null;

    if (!reservaId) {
      console.error("[notify-reservation-change] Payload sin id de reserva usable:", rawId);
      return json({ success: false, error: "reserva_id_requerido" }, 400);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // reservas-web hereda verify_jwt = true (no está en config.toml).
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    };
    // checkSharedSecret falla abierto si la variable no está puesta en
    // reservas-web; se manda solo si aquí la tenemos configurada.
    if (SHARED_SECRET) headers["x-webhook-secret"] = SHARED_SECRET;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    let response: Response;
    try {
      response = await fetch(RESERVAS_WEB_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ reserva_id: reservaId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const texto = await response.text();

    if (!response.ok) {
      // Antes esto devolvía success:true igualmente. Se loguea y se informa.
      console.error(
        `[notify-reservation-change] reservas-web respondió ${response.status}: ${texto}`,
      );
      return json({ success: false, status: response.status, error: texto }, 200);
    }

    console.log(
      `[notify-reservation-change] reserva ${reservaId} notificada (${response.status}): ${texto}`,
    );
    return json({ success: true, status: response.status, resultado: texto });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? (error.name === "AbortError" ? "Timeout llamando a reservas-web" : error.message)
      : "Unknown error";
    console.error("[notify-reservation-change] Error:", errorMessage);
    return json({ success: false, error: errorMessage });
  }
});
