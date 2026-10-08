import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "vapi-analytics");

/**
 * vapi-analytics
 * ----------------------------------------------------------------------------
 * Secure proxy to the VAPI `/analytics` endpoint.
 *
 * Why: calling VAPI directly from the browser would leak the API key. This
 * Edge Function keeps the key server-side and only lets authenticated admins
 * trigger queries.
 *
 * Input (POST JSON) — one of the two forms:
 *   A) Raw passthrough (full control):
 *      { "queries": [ { "table": "call", "groupBy": [...], "metrics": [...] } ] }
 *   B) Preset form (convenience):
 *      {
 *        "presetName": "calls_by_ended_reason" | "calls_by_assistant"
 *                    | "calls_over_time" | "cost_over_time",
 *        "dateFrom":   "YYYY-MM-DD" | ISO,
 *        "dateTo":     "YYYY-MM-DD" | ISO,
 *        "assistantId": "<optional uuid>"
 *      }
 *
 * Output: JSON from VAPI passed through verbatim.
 * ----------------------------------------------------------------------------
 */

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Preset translation ────────────────────────────────────────────────────────
type PresetName =
  | "calls_by_ended_reason"
  | "calls_by_assistant"
  | "calls_over_time"
  | "cost_over_time";

interface PresetBody {
  presetName: PresetName;
  dateFrom?: string;
  dateTo?: string;
  assistantId?: string;
}

interface VapiQuery {
  table: string;
  name?: string;
  timeRange?: { start?: string; end?: string; step?: string; timezone?: string };
  groupBy?: string[];
  operations?: Array<{ operation: string; column: string }>;
  filters?: Record<string, unknown>;
}

function buildPresetQueries(body: PresetBody): VapiQuery[] {
  const { presetName, dateFrom, dateTo, assistantId } = body;

  // VAPI expects ISO timestamps; normalise plain YYYY-MM-DD
  const toIso = (d?: string) => {
    if (!d) return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : d;
  };

  const timeRange = {
    start: toIso(dateFrom),
    end: toIso(dateTo),
    timezone: "Europe/Madrid",
  };

  const filters: Record<string, unknown> = {};
  if (assistantId) filters.assistantId = assistantId;

  switch (presetName) {
    case "calls_by_ended_reason":
      return [
        {
          table: "call",
          name: "calls_by_ended_reason",
          timeRange,
          groupBy: ["endedReason"],
          operations: [{ operation: "count", column: "id" }],
          filters: Object.keys(filters).length ? filters : undefined,
        },
      ];
    case "calls_by_assistant":
      return [
        {
          table: "call",
          name: "calls_by_assistant",
          timeRange,
          groupBy: ["assistantId"],
          operations: [
            { operation: "count", column: "id" },
            { operation: "avg", column: "duration" },
          ],
          filters: Object.keys(filters).length ? filters : undefined,
        },
      ];
    case "calls_over_time":
      return [
        {
          table: "call",
          name: "calls_over_time",
          timeRange: { ...timeRange, step: "day" },
          groupBy: ["day"],
          operations: [{ operation: "count", column: "id" }],
          filters: Object.keys(filters).length ? filters : undefined,
        },
      ];
    case "cost_over_time":
      return [
        {
          table: "call",
          name: "cost_over_time",
          timeRange: { ...timeRange, step: "day" },
          groupBy: ["day"],
          operations: [{ operation: "sum", column: "cost" }],
          filters: Object.keys(filters).length ? filters : undefined,
        },
      ];
    default:
      throw new Error(`Unknown presetName: ${presetName}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(conAuditoriaDePeticion("vapi-analytics", createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // 1. Auth — require a valid Supabase JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized: missing Authorization header" }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  // 2. VAPI key
  const vapiKey = Deno.env.get("VAPI_API_KEY");
  if (!vapiKey) {
    return json(
      {
        error:
          "VAPI_API_KEY not configured. Run: supabase secrets set VAPI_API_KEY=<key>",
      },
      500,
    );
  }

  // 3. Build VAPI payload
  let vapiBody: { queries: VapiQuery[] };
  try {
    const incoming = await req.json().catch(() => ({}));

    if (Array.isArray(incoming?.queries) && incoming.queries.length > 0) {
      vapiBody = { queries: incoming.queries };
    } else if (incoming?.presetName) {
      vapiBody = { queries: buildPresetQueries(incoming as PresetBody) };
    } else {
      return json(
        {
          error:
            "Invalid body. Expected { queries: [...] } or { presetName, dateFrom, dateTo, assistantId? }",
        },
        400,
      );
    }
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Invalid JSON body" },
      400,
    );
  }

  // 4. Proxy to VAPI with 10s timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const vapiRes = await fetch("https://api.vapi.ai/analytics", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vapiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vapiBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await vapiRes.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (!vapiRes.ok) {
      console.error("VAPI analytics error", vapiRes.status, text);
      return json(
        {
          error: `VAPI responded with ${vapiRes.status}`,
          detail: parsed,
        },
        502,
      );
    }

    return json(parsed);
  } catch (err: unknown) {
    clearTimeout(timeout);
    const isAbort = (err as { name?: string })?.name === "AbortError";
    console.error("vapi-analytics fetch failed:", err);
    return json(
      {
        error: isAbort
          ? "Timeout contacting VAPI (>10s)"
          : err instanceof Error
          ? err.message
          : "Unknown error",
      },
      isAbort ? 504 : 500,
    );
  }
}));

/* ────────────────────────────────────────────────────────────────────────────
 * Deploy from CLI:
 *   supabase functions deploy vapi-analytics --project-ref jeamoczmbfsnwkfjxcyo
 *
 * Configure secret (one-time):
 *   supabase secrets set VAPI_API_KEY=<your_key> --project-ref jeamoczmbfsnwkfjxcyo
 *
 * Optional: restrict CORS origin:
 *   supabase secrets set ALLOWED_ORIGIN=https://adminpanel.casatomas.es --project-ref jeamoczmbfsnwkfjxcyo
 * ──────────────────────────────────────────────────────────────────────────── */
