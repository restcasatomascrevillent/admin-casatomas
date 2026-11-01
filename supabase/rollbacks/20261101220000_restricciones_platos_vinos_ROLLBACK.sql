-- Reversión de 20261101220000_restricciones_platos_vinos.sql
-- Quita los CHECK y la función. NO deshace la limpieza de datos (los "[]"
-- convertidos a [] y la imagen_url relativa de «Terreus» puesta a NULL): esos
-- valores ya eran inservibles.
ALTER TABLE public."Platos"
  DROP CONSTRAINT IF EXISTS platos_nombre_valido,
  DROP CONSTRAINT IF EXISTS platos_categoria_valida,
  DROP CONSTRAINT IF EXISTS platos_descripcion_maximo,
  DROP CONSTRAINT IF EXISTS platos_precio_valido,
  DROP CONSTRAINT IF EXISTS platos_alergenos_validos,
  DROP CONSTRAINT IF EXISTS platos_imagen_url_https;
ALTER TABLE public."Vinos"
  DROP CONSTRAINT IF EXISTS vinos_nombre_valido,
  DROP CONSTRAINT IF EXISTS vinos_categoria_valida,
  DROP CONSTRAINT IF EXISTS vinos_descripcion_maximo,
  DROP CONSTRAINT IF EXISTS vinos_precio_valido,
  DROP CONSTRAINT IF EXISTS vinos_alergenos_validos,
  DROP CONSTRAINT IF EXISTS vinos_imagen_url_https;
DROP FUNCTION IF EXISTS public.alergenos_bien_formados(jsonb);
