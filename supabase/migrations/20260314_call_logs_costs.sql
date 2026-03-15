-- Add cost tracking and call-end metadata columns to call_logs.
-- RGPD/LOPD compliance: we do NOT store recording URLs or full transcripts.
-- Only operational/financial data with no personal voice data is saved.
--
-- cost_total_usd / cost_total_eur: total call cost. EUR = USD * 0.92 (fixed rate).
-- cost_breakdown: JSONB with per-component costs from VAPI end-of-call-report.
--   Expected shape: { model, transcriber, voice, vapi, telephony }
--   Each key: { cost_usd, cost_eur, ...extra } (extra = tokens, minutes, characters)
-- ended_reason: why the call ended (from message.endedReason in VAPI webhook).
--   Possible values: "customer-ended-call", "assistant-ended-call",
--   "silence-timed-out", "max-duration-exceeded", "pipeline-error",
--   "assistant-error", "voicemail", "exceeded-max-duration", "error"

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS ended_reason      TEXT,
  ADD COLUMN IF NOT EXISTS cost_total_usd    NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS cost_total_eur    NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS cost_breakdown    JSONB;

COMMENT ON COLUMN public.call_logs.ended_reason    IS 'Reason the call ended, from VAPI end-of-call-report. E.g. customer-ended-call, silence-timed-out.';
COMMENT ON COLUMN public.call_logs.cost_total_usd  IS 'Total call cost in USD as reported by VAPI.';
COMMENT ON COLUMN public.call_logs.cost_total_eur  IS 'Total call cost in EUR (USD * 0.92 fixed rate).';
COMMENT ON COLUMN public.call_logs.cost_breakdown  IS 'Per-component cost breakdown from VAPI: {model, transcriber, voice, vapi, telephony}.';

-- Index for cost reporting queries (monthly totals)
CREATE INDEX IF NOT EXISTS idx_call_logs_started_at
  ON public.call_logs (started_at DESC);

-- Ensure RLS is enabled (it should already be, but be explicit)
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Policy: only authenticated users can read call logs (internal data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'call_logs' AND policyname = 'Authenticated can read call_logs'
  ) THEN
    CREATE POLICY "Authenticated can read call_logs"
      ON public.call_logs FOR SELECT
      USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
