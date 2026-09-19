
-- Table for chatbot configuration
CREATE TABLE public.chatbot_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave text NOT NULL UNIQUE,
  valor text NOT NULL DEFAULT '',
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chatbot_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view chatbot config"
ON public.chatbot_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage chatbot config"
ON public.chatbot_config FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER update_chatbot_config_updated_at
BEFORE UPDATE ON public.chatbot_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial config rows
INSERT INTO public.chatbot_config (clave, valor, descripcion) VALUES
('tono', 'cercano', 'Tono del chatbot: cercano, formal, divertido, exclusivo'),
('mensaje_bienvenida', '¡Hola! Soy el asistente virtual. ¿En qué puedo ayudarte?', 'Mensaje de bienvenida del chatbot'),
('platos_recomendados', '', 'IDs o nombres de platos a priorizar en recomendaciones (separados por coma)'),
('vinos_recomendados', '', 'IDs o nombres de vinos a priorizar en recomendaciones (separados por coma)'),
('instrucciones_extra', '', 'Instrucciones adicionales para el comportamiento del chatbot'),
('frases_personalizadas', '', 'Frases específicas que el chatbot debe decir (una por línea)');
