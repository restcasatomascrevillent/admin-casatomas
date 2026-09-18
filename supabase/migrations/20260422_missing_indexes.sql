-- Índices faltantes identificados por auditoría de schema 2026-04-22

-- Lookup de reservas por teléfono (usado en cada llamada por el bot)
CREATE INDEX IF NOT EXISTS idx_reservas_telefono
  ON reservas (telefono)
  WHERE estado IN ('pendiente', 'verificada', 'confirmada');

-- Consultas de disponibilidad y occupation
CREATE INDEX IF NOT EXISTS idx_reservas_fecha_estado
  ON reservas (fecha, estado);

-- Búsquedas en blacklist durante create_reservation
CREATE INDEX IF NOT EXISTS idx_blacklist_tipo_valor
  ON blacklist (tipo, valor);

-- Normalización para búsquedas ilike (sin perder performance)
CREATE INDEX IF NOT EXISTS idx_blacklist_valor_lower
  ON blacklist (lower(valor));
