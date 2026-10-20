-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221161434).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- Rediseño completo de normalizar_proveedor con lógica más segura:
-- 1. Primero eliminar apodo entre paréntesis
-- 2. Luego eliminar sufijos legales solo si van precedidos de separador (coma/espacio)
--    y son palabras completas (usando word boundary \m \M en Postgres)
CREATE OR REPLACE FUNCTION normalizar_proveedor(p_proveedor TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  v_texto TEXT;
BEGIN
  -- Normalizar: trim + lowercase + quitar acentos
  v_texto := trim(lower(unaccent(p_proveedor)));
  
  -- PASO 1: Eliminar alias/apodos entre paréntesis "(nombre comercial)"
  v_texto := regexp_replace(v_texto, '\s*\([^)]*\)', '', 'g');
  
  -- PASO 2: Eliminar sufijos legales al FINAL del string
  -- Ordenados de más largo a más corto para evitar match parcial
  -- Usamos $ para anclar al final, con posible puntuación antes
  v_texto := regexp_replace(v_texto,
    '[,\s]+(sociedad\s+limitada\s+unipersonal|sociedad\s+anonima\s+unipersonal|sociedad\s+cooperativa|sociedad\s+limitada|sociedad\s+anonima|s\.l\.u\.|s\.a\.u\.|s\.l\.|s\.a\.|s\.c\.p\.|s\.c\.l\.|s\.c\.|s\.coop\.?|slu|sau|sl|sa|cb|sc)\s*$',
    '', 'gi');
  
  -- PASO 3: Limpiar comas, puntos y espacios sobrantes al final
  v_texto := regexp_replace(v_texto, '[,.\s]+$', '');
  
  -- PASO 4: Colapsar espacios múltiples
  v_texto := regexp_replace(trim(v_texto), '\s+', ' ', 'g');
  
  RETURN v_texto;
END;
$$;

-- Verificar con casos de prueba
SELECT
  normalizar_proveedor('FRANCISCO JOSÉ SANTACRUZ GAMBÍN, S.L.U. (Paquito Martín)') AS r1,
  normalizar_proveedor('Empresa SL')                                                 AS r2,
  normalizar_proveedor('Empresa, S.L.U.')                                            AS r3,
  normalizar_proveedor('Distribuciones García, S.A.')                                AS r4,
  normalizar_proveedor('Makro Autoservicio Mayorista S.A.')                          AS r5,
  normalizar_proveedor('Frigoríficos del Norte S.L.')                                AS r6,
  normalizar_proveedor('Empresa y Empresa SL')                                       AS r7,
  normalizar_proveedor('PESCADOS GALICIA, S.L.U.')                                   AS r8;
