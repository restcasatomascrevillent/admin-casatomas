-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221172120).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- ============================================================
-- buscar_facturas_agente — patrón DECLARE/INTO + vector(1536)
-- ============================================================
CREATE OR REPLACE FUNCTION buscar_facturas_agente(
  embedding_query vector(1536),
  limite          int   DEFAULT 8,
  umbral          float DEFAULT 0.25
)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  resultado json;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO resultado
  FROM (
    SELECT
      f.id,
      f.tipo,
      f.proveedor,
      f.proveedor_normalizado,
      f.cif,
      f.numero_documento,
      f.fecha,
      to_char(f.fecha, 'YYYY-MM')                                       AS mes,
      f.subtotal,
      f.iva,
      ROUND(f.total::numeric, 2)                                         AS total,
      f.observaciones,
      f.resumen,
      f.drive_url,
      ROUND(
        (1 - (COALESCE(f.embedding, f.embedding_observaciones) <=> embedding_query))::numeric,
        3
      )                                                                  AS similitud
    FROM facturas f
    WHERE COALESCE(f.embedding, f.embedding_observaciones) IS NOT NULL
      AND (1 - (COALESCE(f.embedding, f.embedding_observaciones) <=> embedding_query)) > umbral
    ORDER BY COALESCE(f.embedding, f.embedding_observaciones) <=> embedding_query
    LIMIT limite
  ) t;

  RETURN COALESCE(resultado, '[]'::json);
END;
$$;

-- ============================================================
-- buscar_productos_agente — patrón DECLARE/INTO + vector(1536)
-- ============================================================
CREATE OR REPLACE FUNCTION buscar_productos_agente(
  embedding_query vector(1536),
  limite          int   DEFAULT 12,
  umbral          float DEFAULT 0.25
)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  resultado json;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO resultado
  FROM (
    SELECT
      pf.id,
      pf.nombre,
      pf.nombre_normalizado,
      pf.cantidad,
      pf.unidad,
      ROUND(pf.precio_unitario::numeric, 4)                              AS precio_unitario,
      ROUND(pf.total::numeric, 2)                                        AS total,
      f.proveedor,
      f.proveedor_normalizado,
      f.numero_documento,
      f.fecha,
      to_char(f.fecha, 'YYYY-MM')                                        AS mes,
      f.tipo                                                             AS tipo_documento,
      f.resumen                                                          AS resumen_factura,
      ROUND(
        (1 - (pf.embedding <=> embedding_query))::numeric,
        3
      )                                                                  AS similitud
    FROM productos_factura pf
    JOIN facturas f ON f.id = pf.factura_id
    WHERE pf.embedding IS NOT NULL
      AND (1 - (pf.embedding <=> embedding_query)) > umbral
    ORDER BY pf.embedding <=> embedding_query
    LIMIT limite
  ) t;

  RETURN COALESCE(resultado, '[]'::json);
END;
$$;
