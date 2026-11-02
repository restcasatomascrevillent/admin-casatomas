-- Reversión de 20261102120000_restricciones_bebidas_cocteles.sql
-- Quita los CHECK de "Bebidas" y "Cocteles". No toca datos (la migración no
-- cambió ninguna fila) ni la función public.alergenos_bien_formados, que es de
-- 20261101220000_restricciones_platos_vinos.sql. OJO: si se revierte también
-- la 1/3, esta va PRIMERO: su DROP FUNCTION falla mientras
-- cocteles_alergenos_validos dependa de la función.
ALTER TABLE public."Bebidas"
  DROP CONSTRAINT IF EXISTS bebidas_nombre_valido,
  DROP CONSTRAINT IF EXISTS bebidas_categoria_valida,
  DROP CONSTRAINT IF EXISTS bebidas_precio_valido,
  DROP CONSTRAINT IF EXISTS bebidas_imagen_url_https,
  DROP CONSTRAINT IF EXISTS bebidas_textos_maximos;
ALTER TABLE public."Cocteles"
  DROP CONSTRAINT IF EXISTS cocteles_nombre_valido,
  DROP CONSTRAINT IF EXISTS cocteles_categoria_valida,
  DROP CONSTRAINT IF EXISTS cocteles_precio_valido,
  DROP CONSTRAINT IF EXISTS cocteles_imagen_url_https,
  DROP CONSTRAINT IF EXISTS cocteles_alergenos_validos,
  DROP CONSTRAINT IF EXISTS cocteles_textos_maximos;
