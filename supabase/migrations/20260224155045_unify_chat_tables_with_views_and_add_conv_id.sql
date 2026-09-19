-- Reconstruida desde supabase_migrations.schema_migrations (version 20260224155045).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- ================================================================
-- 1. Añadir conversacion_id a mensajes_chat
--    (FK a conversaciones para que el frontend pueda cargar mensajes por conversación)
-- ================================================================
ALTER TABLE mensajes_chat 
  ADD COLUMN IF NOT EXISTS conversacion_id UUID REFERENCES conversaciones(id) ON DELETE SET NULL;

-- Poblar conversacion_id usando session_id como nexo
UPDATE mensajes_chat mc
SET conversacion_id = c.id
FROM conversaciones c
WHERE mc.session_id = c.session_id
  AND mc.conversacion_id IS NULL;

-- Índice para la FK
CREATE INDEX IF NOT EXISTS idx_mensajes_chat_conversacion_id 
  ON mensajes_chat (conversacion_id);

-- ================================================================
-- 2. Eliminar las tablas vacías que creé antes (las vistas las reemplazan)
-- ================================================================
DROP TABLE IF EXISTS chat_facturas_mensajes CASCADE;
DROP TABLE IF EXISTS chat_facturas_conversaciones CASCADE;

-- ================================================================
-- 3. Crear vistas con los nombres que usa el frontend
--    (col aliases que el frontend espera: rol/contenido en lugar de role/content)
-- ================================================================
CREATE OR REPLACE VIEW chat_facturas_conversaciones AS
  SELECT id, session_id, titulo, created_at, updated_at
  FROM conversaciones;

CREATE OR REPLACE VIEW chat_facturas_mensajes AS
  SELECT 
    id,
    conversacion_id,
    session_id,
    role   AS rol,
    content AS contenido,
    created_at
  FROM mensajes_chat;

-- ================================================================
-- 4. Trigger para que cuando n8n inserta en mensajes_chat
--    con session_id, autorrellene conversacion_id
-- ================================================================
CREATE OR REPLACE FUNCTION set_mensajes_chat_conversacion_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.conversacion_id IS NULL AND NEW.session_id IS NOT NULL THEN
    SELECT id INTO NEW.conversacion_id
    FROM conversaciones
    WHERE session_id = NEW.session_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_conversacion_id ON mensajes_chat;
CREATE TRIGGER trg_set_conversacion_id
  BEFORE INSERT ON mensajes_chat
  FOR EACH ROW EXECUTE FUNCTION set_mensajes_chat_conversacion_id();
