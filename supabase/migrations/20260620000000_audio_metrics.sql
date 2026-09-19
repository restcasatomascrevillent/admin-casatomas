-- ============================================================
-- Bucle de calidad auditiva — audio_metrics + vista_calidad_audio
-- ============================================================
-- Change: bucle-calidad-auditiva · Repo: restaurante-phone
--
-- Opción A (preferida): columna `audio_metrics jsonb` en call_logs +
-- vista `vista_calidad_audio` que aplana las métricas para el dashboard.
--
-- El webhook calcula las métricas en handleEndOfCall desde
-- `message.call.artifact.messages[]` (timestamps turno a turno).
-- NO usa cost_breakdown, que solo trae coste/tokens/duración.
--
-- Esquema de audio_metrics jsonb:
--   {
--     "latency_first_ms":    number | null,   -- ms primer par user→bot
--     "latency_avg_ms":      number | null,   -- media de todos los pares
--     "latency_p50_ms":      number | null,   -- mediana
--     "latency_p95_ms":      number | null,   -- percentil 95
--     "latency_max_ms":      number | null,   -- máximo
--     "interruption_count":  number,          -- nº turnos bot que pisan turno user
--     "interruption_rate":   number | null,   -- fracción sobre turnos bot (0–1)
--     "number_cutoffs":      number,          -- turnos user con dígitos truncados por barge-in
--     "long_silences":       number,          -- gaps > 2500 ms sin habla
--     "turn_count":          number,          -- nº de pares user→bot
--     "early_hangup":        boolean,         -- endedReason indica cuelgue temprano
--     "audio_score":         number | null    -- 0–100 combinado (null si datos insuficientes)
--   }
--
-- IMPORTANTE: el proyecto Supabase es COMPARTIDO entre restaurante-phone y
-- adminpanelct. La migración real debe aplicarse una sola vez contra el
-- proyecto compartido. Replicar también en adminpanelct/supabase/migrations/.
-- Es idempotente (IF NOT EXISTS / CREATE OR REPLACE): seguro re-ejecutarla.

-- ── 1. Columna ───────────────────────────────────────────────
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS audio_metrics jsonb;

COMMENT ON COLUMN public.call_logs.audio_metrics IS
  'Métricas de calidad auditiva derivadas de los timestamps de messages[]: '
  'latencias (ms) por par user→bot, interrupciones (barge-in del bot), '
  'cortes durante dictado de números, silencios largos, score auditivo 0–100. '
  'Calculado por el webhook desde message.call.artifact.messages[]. '
  'Campos: latency_first_ms, latency_avg_ms, latency_p50_ms, latency_p95_ms, '
  'latency_max_ms, interruption_count, interruption_rate, number_cutoffs, '
  'long_silences, turn_count, early_hangup, audio_score.';

-- ── 2. Índice GIN para queries JSONB ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_call_logs_audio_metrics
  ON public.call_logs USING GIN (audio_metrics);

-- Índices escalares para KPIs y filtros de dashboard
-- (extraídos como expresiones — requieren PostgreSQL 12+, disponible en Supabase)
CREATE INDEX IF NOT EXISTS idx_call_logs_audio_latency_p95
  ON public.call_logs ((audio_metrics->>'latency_p95_ms'))
  WHERE audio_metrics IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_audio_score
  ON public.call_logs ((audio_metrics->>'audio_score'))
  WHERE audio_metrics IS NOT NULL;

-- ── 3. Vista para el dashboard ────────────────────────────────
-- Aplana audio_metrics + une con sentiment/ended_reason/call_success.
-- Solo incluye filas donde audio_metrics no es NULL.
CREATE OR REPLACE VIEW public.vista_calidad_audio AS
SELECT
  cl.vapi_call_id,
  cl.created_at,
  cl.duration_seconds,
  cl.ended_reason,
  cl.sentiment,
  cl.call_success,
  -- Latencias
  (cl.audio_metrics->>'latency_first_ms')::numeric  AS latency_first_ms,
  (cl.audio_metrics->>'latency_avg_ms')::numeric    AS latency_avg_ms,
  (cl.audio_metrics->>'latency_p50_ms')::numeric    AS latency_p50_ms,
  (cl.audio_metrics->>'latency_p95_ms')::numeric    AS latency_p95_ms,
  (cl.audio_metrics->>'latency_max_ms')::numeric    AS latency_max_ms,
  -- Interrupciones y cortes
  (cl.audio_metrics->>'interruption_count')::int    AS interruption_count,
  (cl.audio_metrics->>'interruption_rate')::numeric AS interruption_rate,
  (cl.audio_metrics->>'number_cutoffs')::int        AS number_cutoffs,
  -- Silencios y turnos
  (cl.audio_metrics->>'long_silences')::int         AS long_silences,
  (cl.audio_metrics->>'turn_count')::int            AS turn_count,
  -- Cuelgue temprano
  (cl.audio_metrics->>'early_hangup')::boolean      AS early_hangup,
  -- Score combinado
  (cl.audio_metrics->>'audio_score')::numeric       AS audio_score,
  -- JSON crudo completo (para exploración / rúbrica humana)
  cl.audio_metrics
FROM public.call_logs cl
WHERE cl.audio_metrics IS NOT NULL;

COMMENT ON VIEW public.vista_calidad_audio IS
  'Vista del dashboard de calidad auditiva. '
  'Aplana audio_metrics jsonb y une con sentiment/ended_reason/call_success. '
  'Solo incluye llamadas donde el webhook capturó métricas de audio. '
  'Umbrales objetivo: latency_p50_ms < 1000, latency_p95_ms < 1500, '
  'interruption_rate < 0.05, number_cutoffs = 0 (bloqueante), audio_score >= 70.';
