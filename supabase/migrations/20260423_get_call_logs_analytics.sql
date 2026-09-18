-- RPC: get_call_logs_analytics
-- Devuelve todas las métricas del dashboard de monitorización telefónica
-- en un único jsonb para evitar N roundtrips desde el cliente.
--
-- Parámetros:
--   p_date_from  timestamptz  (inclusive)
--   p_date_to    timestamptz  (inclusive)
--   p_call_type  text         (opcional: 'bot' | 'human' | NULL para todos)

CREATE OR REPLACE FUNCTION public.get_call_logs_analytics(
  p_date_from timestamptz,
  p_date_to   timestamptz,
  p_call_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total            bigint;
  v_avg_duration     numeric;
  v_total_cost       numeric;
  v_success_rate     numeric;
  v_reservas_rate    numeric;
  v_transfer_rate    numeric;
  v_by_intent        jsonb;
  v_by_ended_reason  jsonb;
  v_by_sentiment     jsonb;
  v_by_motivo_fallo  jsonb;
  v_calls_per_day    jsonb;
BEGIN
  -- Métricas escalares en una pasada
  SELECT
    COUNT(*),
    COALESCE(AVG(duration_seconds), 0),
    COALESCE(SUM(cost_total_eur), 0),
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE success_evaluation = 'Pass')
      / NULLIF(COUNT(*), 0),
      1
    ),
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE structured_data->>'reserva_creada' IN ('true','TRUE','t','1'))
      / NULLIF(COUNT(*), 0),
      1
    ),
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE structured_data->>'transferido_a_humano' IN ('true','TRUE','t','1'))
      / NULLIF(COUNT(*), 0),
      1
    )
  INTO
    v_total, v_avg_duration, v_total_cost,
    v_success_rate, v_reservas_rate, v_transfer_rate
  FROM public.call_logs
  WHERE started_at BETWEEN p_date_from AND p_date_to
    AND (p_call_type IS NULL OR call_type = p_call_type);

  -- Agrupaciones
  SELECT COALESCE(jsonb_agg(jsonb_build_object('intent', intent, 'count', c) ORDER BY c DESC), '[]'::jsonb)
    INTO v_by_intent
  FROM (
    SELECT COALESCE(NULLIF(structured_data->>'intent', ''), 'desconocido') AS intent,
           COUNT(*)::bigint AS c
    FROM public.call_logs
    WHERE started_at BETWEEN p_date_from AND p_date_to
      AND (p_call_type IS NULL OR call_type = p_call_type)
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'count', c) ORDER BY c DESC), '[]'::jsonb)
    INTO v_by_ended_reason
  FROM (
    SELECT COALESCE(NULLIF(ended_reason, ''), 'desconocido') AS reason,
           COUNT(*)::bigint AS c
    FROM public.call_logs
    WHERE started_at BETWEEN p_date_from AND p_date_to
      AND (p_call_type IS NULL OR call_type = p_call_type)
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('sentiment', sentiment, 'count', c) ORDER BY c DESC), '[]'::jsonb)
    INTO v_by_sentiment
  FROM (
    SELECT COALESCE(NULLIF(structured_data->>'sentiment', ''), 'desconocido') AS sentiment,
           COUNT(*)::bigint AS c
    FROM public.call_logs
    WHERE started_at BETWEEN p_date_from AND p_date_to
      AND (p_call_type IS NULL OR call_type = p_call_type)
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('motivo', motivo, 'count', c) ORDER BY c DESC), '[]'::jsonb)
    INTO v_by_motivo_fallo
  FROM (
    SELECT NULLIF(structured_data->>'motivo_fallo', '') AS motivo,
           COUNT(*)::bigint AS c
    FROM public.call_logs
    WHERE started_at BETWEEN p_date_from AND p_date_to
      AND (p_call_type IS NULL OR call_type = p_call_type)
      AND structured_data ? 'motivo_fallo'
      AND NULLIF(structured_data->>'motivo_fallo', '') IS NOT NULL
    GROUP BY 1
  ) s;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(day, 'YYYY-MM-DD'),
        'count', c,
        'avgDuration', ROUND(avg_d, 1)
      ) ORDER BY day
    ),
    '[]'::jsonb
  )
    INTO v_calls_per_day
  FROM (
    SELECT date_trunc('day', started_at) AS day,
           COUNT(*)::bigint              AS c,
           COALESCE(AVG(duration_seconds), 0)::numeric AS avg_d
    FROM public.call_logs
    WHERE started_at BETWEEN p_date_from AND p_date_to
      AND (p_call_type IS NULL OR call_type = p_call_type)
    GROUP BY 1
  ) s;

  RETURN jsonb_build_object(
    'totalCalls',           COALESCE(v_total, 0),
    'avgDurationSec',       COALESCE(ROUND(v_avg_duration, 1), 0),
    'totalCostEur',         COALESCE(ROUND(v_total_cost, 4), 0),
    'successRate',          COALESCE(v_success_rate, 0),
    'reservasCreadasRate',  COALESCE(v_reservas_rate, 0),
    'transferredRate',      COALESCE(v_transfer_rate, 0),
    'byIntent',             v_by_intent,
    'byEndedReason',        v_by_ended_reason,
    'bySentiment',          v_by_sentiment,
    'byMotivoFallo',        v_by_motivo_fallo,
    'callsPerDay',          v_calls_per_day
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_call_logs_analytics(timestamptz, timestamptz, text)
  TO authenticated, service_role;
