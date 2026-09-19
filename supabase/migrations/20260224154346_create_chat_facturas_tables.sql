-- Reconstruida desde supabase_migrations.schema_migrations (version 20260224154346).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- ============================================================
-- Tablas específicas para el chatbot de facturas
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_facturas_conversaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL UNIQUE,
  titulo      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_facturas_mensajes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id  UUID NOT NULL REFERENCES chat_facturas_conversaciones(id) ON DELETE CASCADE,
  rol              TEXT NOT NULL CHECK (rol IN ('user', 'assistant')),
  contenido        TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_chat_facturas_mensajes_conversacion 
  ON chat_facturas_mensajes (conversacion_id);
CREATE INDEX IF NOT EXISTS idx_chat_facturas_conv_updated 
  ON chat_facturas_conversaciones (updated_at DESC);

-- Trigger para actualizar updated_at de la conversación al insertar mensajes
CREATE OR REPLACE FUNCTION touch_conversacion_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE chat_facturas_conversaciones
  SET updated_at = now()
  WHERE id = NEW.conversacion_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_conversacion ON chat_facturas_mensajes;
CREATE TRIGGER trg_touch_conversacion
  AFTER INSERT ON chat_facturas_mensajes
  FOR EACH ROW EXECUTE FUNCTION touch_conversacion_updated_at();

-- RLS: solo service_role puede escribir, authenticated puede leer sus conversaciones
ALTER TABLE chat_facturas_conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_facturas_mensajes ENABLE ROW LEVEL SECURITY;

-- Service role puede todo (la edge function usa service_role implícitamente)
CREATE POLICY "Service role full access conversaciones"
  ON chat_facturas_conversaciones FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access mensajes"
  ON chat_facturas_mensajes FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Authenticated puede leer (el admin panel lee para mostrar el historial)
CREATE POLICY "Authenticated can read conversaciones"
  ON chat_facturas_conversaciones FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can read mensajes"
  ON chat_facturas_mensajes FOR SELECT
  TO authenticated USING (true);
