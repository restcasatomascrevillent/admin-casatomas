import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarMetricas } from "./metricas.ts";

// Marketing › Instagram › Métricas. Toda la lógica (y su explicación) está en
// metricas.ts; aquí solo se engancha al envoltorio de auditoría, como el resto.
// Está en ADMITE_INTEGRACION porque la llama pg_cron sin usuario: se defiende
// sola con x-webhook-secret (INSTAGRAM_METRICAS_CRON_SECRET, tiempo constante,
// falla cerrado) o con el usuario y can_read_section / can_edit_section.
// Secretos: los de Meta (IG_ACCESS_TOKEN, IG_USER_ID, META_APP_ID…) y
// INSTAGRAM_METRICAS_CRON_SECRET en Supabase → Edge Functions → Secrets.
Deno.serve(conAuditoriaDePeticion("instagram-metricas", createClientBase, (req) => manejarMetricas(req)));
