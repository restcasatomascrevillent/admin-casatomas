-- ============================================================
-- VAPI Structured Outputs → call_logs
-- ============================================================
-- Acción 1/3: extracción end-of-call fiable.
--
-- VAPI Structured Outputs (https://docs.vapi.ai/assistants/structured-outputs)
-- entrega los datos extraídos en `message.call.artifact.structuredOutputs`,
-- como un objeto indexado por UUID del structured output:
--   { "<uuid>": { "name": "...", "result": { ...campos del schema... } } }
--
-- Las columnas `structured_data` (jsonb) y `success_evaluation` (text) ya se
-- añadieron en adminpanelct/supabase/migrations/20260422_call_logs_analysis_fields.sql.
-- Esta migración añade columnas DEDICADAS para el resultado de Structured Outputs,
-- separándolo del antiguo analysisPlan.structuredDataPlan y exponiendo los campos
-- que más se consultan (sentiment, éxito de llamada) como columnas indexables.
--
-- IMPORTANTE: el proyecto Supabase es COMPARTIDO. Las migraciones reales viven en
-- `adminpanelct/supabase/migrations/`. Este archivo documenta y replica el cambio
-- para el repo del webhook; aplícalo una sola vez contra el proyecto compartido
-- (o cópialo a adminpanelct/supabase/migrations/ antes de `supabase db push`).
-- Es idempotente (IF NOT EXISTS), así que es seguro re-ejecutarlo.

ALTER TABLE public.call_logs
  -- JSON crudo y completo de message.call.artifact.structuredOutputs (todos los outputs).
  ADD COLUMN IF NOT EXISTS structured_outputs jsonb,
  -- Resultado "aplanado" del output principal de la reserva (el `.result` del schema).
  ADD COLUMN IF NOT EXISTS reservation_extraction jsonb,
  -- Sentiment del cliente extraído por el structured output ('positivo'|'neutral'|'negativo').
  ADD COLUMN IF NOT EXISTS sentiment text,
  -- Si la llamada cumplió su objetivo (reserva creada, info dada, etc.). Boolean indexable.
  ADD COLUMN IF NOT EXISTS call_success boolean;

-- Índice GIN para consultar dentro del JSON de la extracción de reserva
-- (p.ej. filtrar por motivo_solicitud_pendiente o intent).
CREATE INDEX IF NOT EXISTS idx_call_logs_reservation_extraction
  ON public.call_logs USING GIN (reservation_extraction);

-- Índices para KPIs del dashboard
CREATE INDEX IF NOT EXISTS idx_call_logs_sentiment
  ON public.call_logs (sentiment);
CREATE INDEX IF NOT EXISTS idx_call_logs_call_success
  ON public.call_logs (call_success);

COMMENT ON COLUMN public.call_logs.structured_outputs IS
  'JSON crudo de message.call.artifact.structuredOutputs (indexado por UUID del structured output de VAPI).';
COMMENT ON COLUMN public.call_logs.reservation_extraction IS
  'Resultado (.result) del structured output principal: nombre_cliente, fecha, hora, numero_comensales, espacio, intent, reserva_creada, motivo_solicitud_pendiente.';
COMMENT ON COLUMN public.call_logs.sentiment IS
  'Sentiment del cliente: positivo | neutral | negativo.';
COMMENT ON COLUMN public.call_logs.call_success IS
  'Si la llamada cumplió su objetivo (de successEvaluation o del campo llamada_exitosa del structured output).';
