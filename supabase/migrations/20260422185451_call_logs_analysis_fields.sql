-- Añade campos para guardar el análisis IA de las llamadas (VAPI analysisPlan)
-- - structured_data: JSON con intent, reserva_creada, motivo_fallo, sentiment, etc.
-- - success_evaluation: resultado del successEvaluationPlan (PassFail)

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS structured_data jsonb,
  ADD COLUMN IF NOT EXISTS success_evaluation text;

-- Índice GIN para filtrar por intent dentro del JSON
CREATE INDEX IF NOT EXISTS idx_call_logs_structured_data_intent
  ON call_logs USING GIN ((structured_data -> 'intent'));

-- Índice para filtrar por success_evaluation (para KPI dashboard)
CREATE INDEX IF NOT EXISTS idx_call_logs_success_evaluation
  ON call_logs (success_evaluation);

COMMENT ON COLUMN call_logs.structured_data IS
  'JSON estructurado del analysisPlan.structuredDataPlan de VAPI: intent, reserva_creada, motivo_fallo, sentiment, numero_comensales, fecha_solicitada, nombre_cliente, transferido_a_humano';
COMMENT ON COLUMN call_logs.success_evaluation IS
  'Resultado del successEvaluationPlan: PassFail u otra rúbrica';
