-- Add bot_responses JSONB column to phone_system_config
-- This allows the restaurant to customize all bot response texts from the admin panel
-- without needing to redeploy code.
--
-- The webhook reads config.bot_responses[key] and falls back to hardcoded defaults
-- if a key is not set. Templates support {variable} placeholders.

ALTER TABLE public.phone_system_config
  ADD COLUMN IF NOT EXISTS bot_responses JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.phone_system_config.bot_responses IS
  'Customizable bot response templates. Keys map to specific situations. '
  'Supports {variable} placeholders. Falls back to hardcoded defaults if empty.';
