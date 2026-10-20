-- Reconstruida desde supabase_migrations.schema_migrations (version 20260216185350).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- ============================================
-- SISTEMA TELEFÓNICO VAPI - Schema
-- ============================================

-- 1. Configuración del sistema telefónico por restaurante
CREATE TABLE IF NOT EXISTS phone_system_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id TEXT UNIQUE NOT NULL,
  mode TEXT NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot', 'human')),
  restaurant_name TEXT NOT NULL DEFAULT 'Mi Restaurante',
  phone_number TEXT,
  forward_phone TEXT,
  vapi_phone_number_id TEXT,
  vapi_assistant_id TEXT,
  voice_id TEXT,
  opening_hours TEXT DEFAULT 'Lunes a domingo de 13:00 a 16:00 y de 20:00 a 23:30',
  address TEXT,
  bot_greeting TEXT DEFAULT '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?',
  max_party_size INT DEFAULT 12,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Historial de llamadas
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  vapi_call_id TEXT,
  caller_number TEXT,
  call_type TEXT CHECK (call_type IN ('bot', 'human', 'transferred')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'missed', 'failed')),
  duration_seconds INT,
  summary TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Reservas hechas por el bot
CREATE TABLE IF NOT EXISTS reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  call_id UUID REFERENCES call_logs(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  reservation_date TIMESTAMPTZ NOT NULL,
  reservation_time TEXT NOT NULL,
  party_size INT NOT NULL DEFAULT 2,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  notes TEXT,
  created_by TEXT DEFAULT 'bot' CHECK (created_by IN ('bot', 'human', 'web')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX idx_call_logs_restaurant ON call_logs(restaurant_id);
CREATE INDEX idx_call_logs_started_at ON call_logs(started_at);
CREATE INDEX idx_reservations_restaurant ON reservations(restaurant_id);
CREATE INDEX idx_reservations_date ON reservations(reservation_date);

-- Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE phone_system_config;
ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;

-- RLS (Row Level Security)
ALTER TABLE phone_system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Políticas RLS: permitir lectura pública (para la app) y escritura con service role (webhook)
CREATE POLICY "Allow public read" ON phone_system_config FOR SELECT USING (true);
CREATE POLICY "Allow public update" ON phone_system_config FOR UPDATE USING (true);

CREATE POLICY "Allow public read" ON call_logs FOR SELECT USING (true);
CREATE POLICY "Allow service insert" ON call_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service update" ON call_logs FOR UPDATE USING (true);

CREATE POLICY "Allow public read" ON reservations FOR SELECT USING (true);
CREATE POLICY "Allow service insert" ON reservations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON reservations FOR UPDATE USING (true);

-- Insertar configuración inicial
INSERT INTO phone_system_config (restaurant_id, restaurant_name, mode)
VALUES ('default', 'Mi Restaurante', 'bot')
ON CONFLICT (restaurant_id) DO NOTHING;
