-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221161322).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- DROP previo de las vistas existentes (las recreamos en orden)
DROP VIEW IF EXISTS vista_proveedores_resumen CASCADE;
DROP VIEW IF EXISTS vista_gastos_mensuales CASCADE;
DROP VIEW IF EXISTS vista_productos_top CASCADE;
DROP VIEW IF EXISTS vista_ultimos_documentos CASCADE;
DROP VIEW IF EXISTS vista_gastos_proveedor_mes CASCADE;

-- ============================================================
-- 1. vista_proveedores_resumen — MEJORADA
-- ============================================================
CREATE VIEW vista_proveedores_resumen AS
SELECT
  proveedor_normalizado,
  (
    SELECT f2.proveedor
    FROM facturas f2
    WHERE f2.proveedor_normalizado = f.proveedor_normalizado
      AND f2.proveedor IS NOT NULL
    ORDER BY length(f2.proveedor) DESC
    LIMIT 1
  )                                                             AS proveedor_nombre_completo,
  MAX(cif)                                                      AS cif,
  COUNT(*)                                                      AS num_documentos,
  COUNT(*) FILTER (WHERE tipo = 'factura')                      AS num_facturas,
  COUNT(*) FILTER (WHERE tipo = 'albaran')                      AS num_albaranes,
  ROUND(SUM(total)::numeric, 2)                                 AS total_gastado,
  ROUND(AVG(total)::numeric, 2)                                 AS ticket_promedio,
  MAX(fecha)                                                    AS ultima_compra,
  MIN(fecha)                                                    AS primera_compra
FROM facturas f
WHERE proveedor_normalizado IS NOT NULL
GROUP BY proveedor_normalizado
ORDER BY SUM(total) DESC NULLS LAST;

-- ============================================================
-- 2. vista_gastos_mensuales — MEJORADA
-- ============================================================
CREATE VIEW vista_gastos_mensuales AS
SELECT
  to_char(date_trunc('month', fecha::timestamptz), 'YYYY-MM')   AS mes,
  COUNT(*) FILTER (WHERE tipo = 'factura')                       AS num_facturas,
  COUNT(*) FILTER (WHERE tipo = 'albaran')                       AS num_albaranes,
  ROUND(SUM(total) FILTER (WHERE tipo = 'factura')::numeric, 2)  AS total_facturas,
  ROUND(AVG(total) FILTER (WHERE tipo = 'factura')::numeric, 2)  AS promedio_factura,
  COUNT(DISTINCT proveedor_normalizado)
    FILTER (WHERE tipo = 'factura')                              AS num_proveedores
FROM facturas
WHERE total IS NOT NULL
GROUP BY date_trunc('month', fecha::timestamptz)
ORDER BY date_trunc('month', fecha::timestamptz) DESC;

-- ============================================================
-- 3. vista_productos_top — MEJORADA
-- ============================================================
CREATE VIEW vista_productos_top AS
SELECT
  p.nombre_normalizado,
  (
    SELECT p2.nombre
    FROM productos_factura p2
    WHERE p2.nombre_normalizado = p.nombre_normalizado
      AND p2.nombre IS NOT NULL
    ORDER BY length(p2.nombre) DESC
    LIMIT 1
  )                                                             AS nombre_completo,
  COUNT(*)                                                      AS veces_comprado,
  COUNT(*) FILTER (WHERE p.precio_unitario IS NOT NULL)         AS veces_con_precio,
  ROUND(SUM(p.cantidad)::numeric, 3)                            AS cantidad_total,
  (
    SELECT p3.unidad
    FROM productos_factura p3
    WHERE p3.nombre_normalizado = p.nombre_normalizado
      AND p3.unidad IS NOT NULL
    GROUP BY p3.unidad
    ORDER BY COUNT(*) DESC
    LIMIT 1
  )                                                             AS unidad,
  ROUND(AVG(p.precio_unitario)::numeric, 4)                     AS precio_promedio,
  ROUND(MIN(p.precio_unitario)::numeric, 4)                     AS precio_minimo,
  ROUND(MAX(p.precio_unitario)::numeric, 4)                     AS precio_maximo,
  COUNT(DISTINCT f.proveedor_normalizado)                       AS num_proveedores
FROM productos_factura p
JOIN facturas f ON p.factura_id = f.id
WHERE f.tipo = 'factura'
GROUP BY p.nombre_normalizado
ORDER BY COUNT(*) DESC;

-- ============================================================
-- 4. vista_ultimos_documentos — MEJORADA
-- ============================================================
CREATE VIEW vista_ultimos_documentos AS
SELECT
  f.id,
  f.tipo,
  f.numero_documento,
  f.proveedor,
  f.proveedor_normalizado,
  f.fecha,
  ROUND(f.total::numeric, 2)                                    AS total,
  COALESCE(f.procesado_en, f.created_at)                        AS fecha_procesado,
  f.drive_url,
  COUNT(p.id)                                                   AS num_productos
FROM facturas f
LEFT JOIN productos_factura p ON f.id = p.factura_id
GROUP BY f.id
ORDER BY COALESCE(f.procesado_en, f.created_at) DESC
LIMIT 50;

-- ============================================================
-- 5. vista_gastos_proveedor_mes — NUEVA
-- ============================================================
CREATE VIEW vista_gastos_proveedor_mes AS
SELECT
  to_char(date_trunc('month', fecha::timestamptz), 'YYYY-MM')   AS mes,
  proveedor_normalizado,
  (
    SELECT f2.proveedor
    FROM facturas f2
    WHERE f2.proveedor_normalizado = f.proveedor_normalizado
      AND f2.proveedor IS NOT NULL
    ORDER BY length(f2.proveedor) DESC
    LIMIT 1
  )                                                             AS proveedor_nombre,
  COUNT(*)                                                      AS num_facturas,
  ROUND(SUM(total)::numeric, 2)                                 AS total_mes,
  ROUND(AVG(total)::numeric, 2)                                 AS promedio_factura
FROM facturas f
WHERE tipo = 'factura'
  AND total IS NOT NULL
  AND proveedor_normalizado IS NOT NULL
GROUP BY date_trunc('month', fecha::timestamptz), proveedor_normalizado
ORDER BY date_trunc('month', fecha::timestamptz) DESC, SUM(total) DESC;
