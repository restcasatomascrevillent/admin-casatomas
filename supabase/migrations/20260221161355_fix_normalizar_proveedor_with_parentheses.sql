-- Reconstruida desde supabase_migrations.schema_migrations (version 20260221161355).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- Mejorar normalizar_proveedor para manejar:
-- "EMPRESA S.L.U. (Nombre Comercial)" → "empresa (nombre comercial)"
-- o eliminar el apodo entre paréntesis también si es deseable
CREATE OR REPLACE FUNCTION normalizar_proveedor(p_proveedor TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          normalizar_texto(p_proveedor),
          -- PASO 1: eliminar sufijos legales donde van ANTES de paréntesis o al final
          -- Cubre: "empresa, S.L.U. (apodo)" → "empresa (apodo)"
          -- y "empresa S.L.U." → "empresa"
          '[,\s]*(s\.l\.u\.|s\.a\.u\.|s\.coop\.?|s\.l\.|s\.a\.|slu|s\.l|s\.a|sl|sa|cb|sc|s\.c\.|s\.c\.p\.?)\s*',
          ' ',
          'gi'
        ),
        -- PASO 2: eliminar texto entre paréntesis (alias/apodos comerciales)
        -- Esto permite que "Empresa (Paquito)" y "Empresa" sean el mismo proveedor
        '\s*\([^)]*\)\s*',
        ' ',
        'g'
      ),
      -- PASO 3: limpiar signos de puntuación y espacios sobrantes al final/inicio
      '(^[\s,./]+|[\s,./]+$)',
      '',
      'g'
    )
  );
$$;

-- Verificar
SELECT
  normalizar_proveedor('FRANCISCO JOSÉ SANTACRUZ GAMBÍN, S.L.U. (Paquito Martín)') AS r1,
  normalizar_proveedor('Empresa SL')                                                AS r2,
  normalizar_proveedor('Empresa, S.L.U.')                                           AS r3,
  normalizar_proveedor('Distribuciones García, S.A.')                               AS r4,
  normalizar_proveedor('Makro Autoservicio Mayorista S.A.')                         AS r5;
