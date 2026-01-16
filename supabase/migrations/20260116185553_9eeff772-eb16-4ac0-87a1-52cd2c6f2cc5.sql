-- Tabla para almacenar eventos de email de Resend
CREATE TABLE public.email_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id TEXT NOT NULL,
  tipo_evento TEXT NOT NULL,
  email_destinatario TEXT,
  timestamp_evento TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para consultas rápidas
CREATE INDEX idx_email_eventos_tipo ON public.email_eventos(tipo_evento);
CREATE INDEX idx_email_eventos_email_id ON public.email_eventos(email_id);
CREATE INDEX idx_email_eventos_timestamp ON public.email_eventos(timestamp_evento DESC);
CREATE INDEX idx_email_eventos_created ON public.email_eventos(created_at DESC);

-- Habilitar RLS
ALTER TABLE public.email_eventos ENABLE ROW LEVEL SECURITY;

-- Políticas: usuarios autenticados pueden ver, solo sistema puede insertar
CREATE POLICY "Usuarios autenticados pueden ver eventos de email"
ON public.email_eventos
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Permitir inserciones desde service role (edge functions)
CREATE POLICY "Service role puede insertar eventos"
ON public.email_eventos
FOR INSERT
WITH CHECK (true);