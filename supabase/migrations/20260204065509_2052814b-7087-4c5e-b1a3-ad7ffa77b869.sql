-- Añadir campos para ventas presenciales (TPV) a pedidos_ecommerce
ALTER TABLE pedidos_ecommerce
ADD COLUMN IF NOT EXISTS tipo_venta TEXT DEFAULT 'online',
ADD COLUMN IF NOT EXISTS vendedor_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS caja TEXT,
ADD COLUMN IF NOT EXISTS numero_ticket TEXT;

-- Añadir constraint para tipo_venta (usando trigger en lugar de CHECK para compatibilidad)
CREATE OR REPLACE FUNCTION validate_tipo_venta()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tipo_venta NOT IN ('online', 'presencial') THEN
    RAISE EXCEPTION 'tipo_venta debe ser "online" o "presencial"';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_tipo_venta ON pedidos_ecommerce;
CREATE TRIGGER check_tipo_venta
BEFORE INSERT OR UPDATE ON pedidos_ecommerce
FOR EACH ROW
EXECUTE FUNCTION validate_tipo_venta();

-- Crear índice para búsquedas por tipo de venta
CREATE INDEX IF NOT EXISTS idx_pedidos_tipo_venta ON pedidos_ecommerce(tipo_venta);

-- Crear índice para búsquedas por vendedor
CREATE INDEX IF NOT EXISTS idx_pedidos_vendedor ON pedidos_ecommerce(vendedor_id);

-- Comentarios para documentación
COMMENT ON COLUMN pedidos_ecommerce.tipo_venta IS 'Tipo de venta: online o presencial (TPV)';
COMMENT ON COLUMN pedidos_ecommerce.vendedor_id IS 'ID del usuario que realizó la venta presencial';
COMMENT ON COLUMN pedidos_ecommerce.caja IS 'Identificador de la caja/terminal TPV';
COMMENT ON COLUMN pedidos_ecommerce.numero_ticket IS 'Número de ticket para ventas presenciales (formato: TPV-YYYYMMDD-XXX)';