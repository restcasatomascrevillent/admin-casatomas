-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221161225).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- ============================================================
-- 1. Columna normalizada en facturas
-- ============================================================
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS proveedor_normalizado VARCHAR
    GENERATED ALWAYS AS (normalizar_proveedor(proveedor)) STORED;

-- ============================================================
-- 2. Columna normalizada en productos_factura
-- ============================================================
ALTER TABLE productos_factura
  ADD COLUMN IF NOT EXISTS nombre_normalizado VARCHAR
    GENERATED ALWAYS AS (normalizar_nombre_producto(nombre)) STORED;

-- ============================================================
-- 3. Índices para búsqueda eficiente por nombre normalizado
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor_normalizado
  ON facturas (proveedor_normalizado);

CREATE INDEX IF NOT EXISTS idx_productos_proveedor_normalizado
  ON productos_factura (nombre_normalizado);

-- ============================================================
-- 4. Verificar que las columnas se generaron bien
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Columnas generadas creadas correctamente. Verificado.';
END $$;
