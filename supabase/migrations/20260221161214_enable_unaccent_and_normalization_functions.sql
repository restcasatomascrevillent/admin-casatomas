-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221161214).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- ============================================================
-- 1. Activar extensión unaccent para eliminar acentos
-- ============================================================
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================
-- 2. Función base: normalizar texto genérico
--    - trim, lowercase, unaccent, colapsa espacios múltiples
-- ============================================================
CREATE OR REPLACE FUNCTION normalizar_texto(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT regexp_replace(
    trim(lower(unaccent(p_texto))),
    '\s+', ' ', 'g'
  );
$$;

-- ============================================================
-- 3. Función: normalizar nombre de proveedor
--    Elimina sufijos legales comunes al final del nombre:
--    S.L., S.A., S.L.U., SL, SA, SLU, S.A.U., S.Coop, etc.
--    También elimina comas y puntos sobrantes.
-- ============================================================
CREATE OR REPLACE FUNCTION normalizar_proveedor(p_proveedor TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        normalizar_texto(p_proveedor),
        -- Sufijos legales al final (con o sin puntos, precedidos de coma/espacio)
        '[,\s]*(s\.l\.u\.|s\.a\.u\.|s\.coop\.?|s\.l\.|s\.a\.|slu|s\.l|s\.a|sl|sa|cb|sc|s\.c\.|s\.c\.p\.?)\s*$',
        '',
        'i'
      ),
      -- Limpiar comas/puntos sobrantes al final
      '[,.\s]+$',
      ''
    )
  );
$$;

-- ============================================================
-- 4. Función: normalizar nombre de producto
--    Elimina artículos geográficos y preposiciones descriptivas
--    que el OCR puede incluir o no dependiendo de la factura:
--    "merluza del cantábrico" → "merluza"
--    "aceite de oliva virgen extra" → se mantiene (es descriptivo del tipo)
--    Solo elimina sufijos que indiquen origen geográfico.
-- ============================================================
CREATE OR REPLACE FUNCTION normalizar_nombre_producto(p_nombre TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT trim(
    regexp_replace(
      normalizar_texto(p_nombre),
      -- Orígenes geográficos y descriptores de procedencia al final
      '\s+(del?\s+(cantabrico|norte|sur|este|oeste|mar|rio|galicia|asturias|euskadi|navarra|aragon|castilla|andalucia|murcia|cataluna|valencia|extremadura|baleares|canarias)|de\s+la\s+(huerta|tierra|costa|marina|sierra)|ecologico|bio|extra|premium|selecto|seleccion|artesano|artesanal|casero|casera|especial|superior|primera|segunda|calidad)\s*$',
      '',
      'i'
    )
  );
$$;

-- ============================================================
-- 5. Tests rápidos de validación (se ejecutan pero no persisten)
-- ============================================================
DO $$
DECLARE
  v_ok BOOLEAN := TRUE;
BEGIN
  -- Test normalizar_proveedor
  IF normalizar_proveedor('EMPRESA SL') != 'empresa' THEN v_ok := FALSE; RAISE NOTICE 'FAIL: EMPRESA SL'; END IF;
  IF normalizar_proveedor('Empresa, S.L.U.') != 'empresa' THEN v_ok := FALSE; RAISE NOTICE 'FAIL: Empresa, S.L.U.'; END IF;
  IF normalizar_proveedor('Distribuciones García, S.A.') != 'distribuciones garcia' THEN v_ok := FALSE; RAISE NOTICE 'FAIL: Distribuciones García, S.A.'; END IF;

  -- Test normalizar_nombre_producto
  IF normalizar_nombre_producto('Merluza del Cantábrico') != 'merluza' THEN v_ok := FALSE; RAISE NOTICE 'FAIL: Merluza del Cantabrico'; END IF;
  IF normalizar_nombre_producto('merluza') != 'merluza' THEN v_ok := FALSE; RAISE NOTICE 'FAIL: merluza'; END IF;

  IF v_ok THEN RAISE NOTICE 'OK: Todas las funciones de normalización pasaron los tests'; END IF;
END $$;
