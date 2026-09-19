-- Reconstruida desde supabase_migrations.schema_migrations (version 20260208163917).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- =====================================================
-- MEJORAS DE SEGURIDAD - Casa Tomás
-- =====================================================

-- 1. HABILITAR RLS EN TABLAS CRÍTICAS
ALTER TABLE public.security_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultas_chatbot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scope_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- 2. POLÍTICAS RLS PARA TABLAS DE SEGURIDAD
CREATE POLICY "Authenticated users can read security logs"
ON public.security_log
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role can insert security logs"
ON public.security_log
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can manage rate limits"
ON public.rate_limit_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3. POLÍTICAS RLS PARA DOCUMENTOS
CREATE POLICY "Authenticated users can read documentos"
ON public.documentos
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert documentos"
ON public.documentos
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update documentos"
ON public.documentos
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete documentos"
ON public.documentos
FOR DELETE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can read items_documento"
ON public.items_documento
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert items_documento"
ON public.items_documento
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update items_documento"
ON public.items_documento
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete items_documento"
ON public.items_documento
FOR DELETE
TO authenticated
USING (true);

-- 4. POLÍTICAS RLS PARA CONSULTAS CHATBOT
CREATE POLICY "Authenticated users can read consultas_chatbot"
ON public.consultas_chatbot
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert consultas_chatbot"
ON public.consultas_chatbot
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 5. POLÍTICAS RLS PARA SCOPE/USAGE
CREATE POLICY "Service role can manage scope_prices"
ON public.scope_prices
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage usage_events"
ON public.usage_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 6. ÍNDICES PARA SEGURIDAD Y RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_rate_limit_identifier 
ON public.rate_limit_log(identifier);

CREATE INDEX IF NOT EXISTS idx_rate_limit_created_at 
ON public.rate_limit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_log_type 
ON public.security_log(type);

CREATE INDEX IF NOT EXISTS idx_security_log_ip 
ON public.security_log(ip_address);

CREATE INDEX IF NOT EXISTS idx_security_log_created_at 
ON public.security_log(created_at DESC);

-- 7. FUNCIÓN DE LIMPIEZA AUTOMÁTICA
CREATE OR REPLACE FUNCTION cleanup_old_security_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.security_log
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  DELETE FROM public.rate_limit_log
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$;
