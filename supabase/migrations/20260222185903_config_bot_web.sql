-- Table for web chatbot configuration (single-row design)
CREATE TABLE public."configBotWeb" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tono text NOT NULL DEFAULT 'cercano',
  mensaje_bienvenida text NOT NULL DEFAULT '¡Hola! Soy el asistente virtual. ¿En qué puedo ayudarte?',
  platos_recomendados text NOT NULL DEFAULT '',
  vinos_recomendados text NOT NULL DEFAULT '',
  instrucciones_extra text NOT NULL DEFAULT '',
  frases_personalizadas text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."configBotWeb" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view configBotWeb"
ON public."configBotWeb" FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage configBotWeb"
ON public."configBotWeb" FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER update_config_bot_web_updated_at
BEFORE UPDATE ON public."configBotWeb"
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed a single default row
INSERT INTO public."configBotWeb" (
  tono,
  mensaje_bienvenida,
  platos_recomendados,
  vinos_recomendados,
  instrucciones_extra,
  frases_personalizadas
) VALUES (
  'cercano',
  '¡Hola! Soy el asistente virtual. ¿En qué puedo ayudarte?',
  '',
  '',
  '',
  ''
);
