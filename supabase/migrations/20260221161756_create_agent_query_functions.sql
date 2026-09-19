-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221161756).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- ============================================================
-- FUNCIÓN 1 — buscar_facturas_agente
-- Mejoras sobre el original:
--   + Incluye proveedor_normalizado para que el agente pueda agrupar
--   + Usa embedding_observaciones como fallback si embedding es NULL
--   + Umbral configurable (por defecto 0.25)
--   + Devuelve también el año/mes como campos para facilitar filtros
-- ============================================================
CREATE OR REPLACE FUNCTION buscar_facturas_agente(
  embedding_query vector,
  limite        int     DEFAULT 8,
  umbral        float   DEFAULT 0.25
)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        f.id,
        f.tipo,
        f.proveedor,
        f.proveedor_normalizado,
        f.cif,
        f.numero_documento,
        f.fecha,
        to_char(f.fecha, 'YYYY-MM')                                     AS mes,
        f.subtotal,
        f.iva,
        ROUND(f.total::numeric, 2)                                       AS total,
        f.observaciones,
        f.resumen,
        f.drive_url,
        -- Similitud: usa embedding principal; si no existe usa embedding_observaciones
        ROUND(
          (1 - (
            COALESCE(f.embedding, f.embedding_observaciones) <=> embedding_query
          ))::numeric,
          3
        )                                                                AS similitud
      FROM facturas f
      WHERE COALESCE(f.embedding, f.embedding_observaciones) IS NOT NULL
        AND (1 - (COALESCE(f.embedding, f.embedding_observaciones) <=> embedding_query)) > umbral
      ORDER BY COALESCE(f.embedding, f.embedding_observaciones) <=> embedding_query
      LIMIT limite
    ) t
  );
END;
$$;

-- ============================================================
-- FUNCIÓN 2 — buscar_productos_agente
-- Mejoras sobre el original:
--   + Incluye nombre_normalizado para agrupar variantes del mismo producto
--   + Umbral configurable
--   + Añade proveedor_normalizado de la factura padre
--   + Añade num_documento por claridad
-- ============================================================
CREATE OR REPLACE FUNCTION buscar_productos_agente(
  embedding_query vector,
  limite        int   DEFAULT 12,
  umbral        float DEFAULT 0.25
)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        pf.id,
        pf.nombre,
        pf.nombre_normalizado,
        pf.cantidad,
        pf.unidad,
        ROUND(pf.precio_unitario::numeric, 4)                            AS precio_unitario,
        ROUND(pf.total::numeric, 2)                                      AS total,
        f.proveedor,
        f.proveedor_normalizado,
        f.numero_documento,
        f.fecha,
        to_char(f.fecha, 'YYYY-MM')                                      AS mes,
        f.tipo                                                           AS tipo_documento,
        f.resumen                                                        AS resumen_factura,
        ROUND(
          (1 - (pf.embedding <=> embedding_query))::numeric,
          3
        )                                                                AS similitud
      FROM productos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE pf.embedding IS NOT NULL
        AND (1 - (pf.embedding <=> embedding_query)) > umbral
      ORDER BY pf.embedding <=> embedding_query
      LIMIT limite
    ) t
  );
END;
$$;

-- ============================================================
-- FUNCIÓN 3 — estadisticas_globales_agente
-- Mejoras sobre el original:
--   + Añade gasto_total con ROUND para presentación limpia
--   + Incluye nueva vista_gastos_proveedor_mes (top 3 proveedor-mes)
--   + Últimos documentos recientes (vista_ultimos_documentos)
--   + Añade total_con_embedding para saber cuántos ya tienen vectores
-- ============================================================
CREATE OR REPLACE FUNCTION estadisticas_globales_agente()
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN json_build_object(

    'resumen_general', json_build_object(
      'total_facturas',         (SELECT COUNT(*) FROM facturas WHERE tipo = 'factura'),
      'total_albaranes',        (SELECT COUNT(*) FROM facturas WHERE tipo = 'albaran'),
      'total_productos',        (SELECT COUNT(*) FROM productos_factura),
      'gasto_total',            (SELECT ROUND(COALESCE(SUM(total), 0)::numeric, 2) FROM facturas WHERE tipo = 'factura'),
      'fecha_primera_factura',  (SELECT MIN(fecha) FROM facturas),
      'fecha_ultima_factura',   (SELECT MAX(fecha) FROM facturas),
      'facturas_con_embedding', (SELECT COUNT(*) FROM facturas WHERE embedding IS NOT NULL OR embedding_observaciones IS NOT NULL),
      'productos_con_embedding',(SELECT COUNT(*) FROM productos_factura WHERE embedding IS NOT NULL)
    ),

    'gastos_mensuales', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (SELECT * FROM vista_gastos_mensuales LIMIT 6) t
    ),

    'top_proveedores', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (SELECT * FROM vista_proveedores_resumen LIMIT 5) t
    ),

    'productos_mas_comprados', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (SELECT * FROM vista_productos_top LIMIT 10) t
    ),

    'ultimos_documentos', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (SELECT * FROM vista_ultimos_documentos LIMIT 5) t
    )

  );
END;
$$;
