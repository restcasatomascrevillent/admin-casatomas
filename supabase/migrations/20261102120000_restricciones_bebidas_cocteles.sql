set client_encoding = 'UTF8';
-- ===========================================================================
-- RESTRICCIONES EN LA BD: BEBIDAS Y COCTELES (tarea 40b3221d, 2/3, 2026-11-01)
-- ===========================================================================
-- La API (PostgREST) aceptaba en "Bebidas" y "Cocteles" datos que el panel
-- nunca manda pero que cualquiera con permiso de escritura podía meter:
-- nombre vacío, precio negativo/infinito/NaN, categoría vacía, alérgenos que
-- no son una lista de textos e imagen_url que no es https. Esta migración lo
-- rechaza en la propia BD.
--
-- QUÉ AÑADE (solo CHECK; no cambia columnas, datos, RLS ni funciones salvo
-- la auxiliar de alérgenos)
--   "Bebidas" y "Cocteles":
--     *_nombre_valido     NOT NULL, con algún carácter que no sea espacio, ≤ 150
--     *_categoria_valida  NOT NULL, con algún carácter que no sea espacio, ≤ 100
--     *_precio_valido     NOT NULL, 0 ≤ precio ≤ 9999.99 (deja fuera NaN e
--                         ±Infinity: en Postgres NaN es mayor que cualquier
--                         número y no cumple «≤ 9999.99»)
--     *_imagen_url_https  NULL o 'https://…' sin espacios, ≤ 2048
--     *_textos_maximos    máximos del resto de textos (tabla de abajo)
--   Solo "Cocteles":
--     cocteles_alergenos_bien_formados  NULL o lista jsonb de 0–30 textos no
--                         vacíos, de ≤ 60 caracteres y sin repetir (sin
--                         distinguir mayúsculas).
--   "Bebidas" no tiene columna de alérgenos.
--
-- MÁXIMOS (los mismos que src/lib/limites-carta.ts; la prueba PGlite los
-- compara). Entre paréntesis, el más largo en la demo el 01/11/2026.
--   nombre, nombre_en, nombre_fr ................ 150  (45)
--   categoria, categoria_en, categoria_fr ........ 100  (17)
--   descripcion, descripcion_en, descripcion_fr .. 2000 (105)
--   tamano (Bebidas) .............................  30  (4)
--   tipo (Bebidas) ............................... 100  (22)
--   tag (Bebidas) ................................  50  (11)
--   base (Cocteles) .............................. 100  (11)
--   ingredientes, ingredientes_en/_fr (Cocteles) . 2000 (91)
--   preparacion (Cocteles) ....................... 2000 (vacío)
--   alergenos_notas (Cocteles) ...................  500 (vacío)
-- Suposiciones de la tarea: nombre 150, descripción 2.000, precio
-- 0–9.999,99. Pablo puede cambiarlas.
--
-- DECISIONES
--   · Precio 0 se admite en la BD. Que 0 € no sea un precio válido lo exige
--     el formulario (tarea «Exigir precio válido en vinos y bebidas»); en la
--     BD solo se rechaza lo imposible.
--   · Precio NULL se rechaza: el panel siempre lo manda y la web imprimiría
--     «null €». Hoy no hay ninguna fila sin precio (demo, 01/11/2026).
--   · «Solo espacios» con la clase [[:space:]] (espacio, tabulador, salto de
--     línea…), no con btrim(), que solo quita espacios.
--   · Los alérgenos se comprueban con una función IMMUTABLE porque un CHECK
--     no admite subconsultas. Se llama carta_alergenos_bien_formados y es
--     genérica a propósito: «Restricciones en Platos y Vinos (1/3)» puede
--     reutilizarla (ojo: en Vinos hay filas con la lista doblemente
--     codificada como texto JSON; esa tarea tiene que limpiarlas antes).
--   · NOT VALID → VALIDATE en el mismo fichero: el ADD CONSTRAINT es
--     instantáneo y el VALIDATE recorre la tabla con un candado que no
--     bloquea lecturas ni escrituras. Si alguna fila incumple, el VALIDATE
--     falla, la transacción entera se deshace y no queda nada a medias. Antes
--     de aplicar, ejecutar la CONSULTA DE ENSAYO del final y corregir lo que
--     salga (en producción, se le pasa la lista a Pablo antes de su «sí»).
--   · Idempotente: cada CHECK se borra antes de crearlo.
--
-- COMPATIBILIDAD
--   El panel de PROD guarda nombre y categoría sin recortar, pero el
--   formulario ya exige que no estén vacíos; con texto normal pasa los CHECK.
--   traducir-contenido solo escribe columnas *_en/*_fr (muy por debajo de los
--   máximos). rebuild-webs y chat-web solo leen.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.carta_alergenos_bien_formados(alergenos jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  -- CASE y no un AND suelto: Postgres no garantiza el orden de evaluación y
  -- jsonb_array_length() lanza error si no es un array (igual que en
  -- 20261028170000_novedades_botones_menu.sql).
  SELECT CASE
    WHEN alergenos IS NULL THEN true
    WHEN jsonb_typeof(alergenos) <> 'array' THEN false
    ELSE (
        jsonb_array_length(alergenos) <= 30
        AND NOT EXISTS (
          SELECT 1
            FROM jsonb_array_elements(alergenos) AS e(valor)
           WHERE jsonb_typeof(e.valor) <> 'string'
              OR (e.valor #>> '{}') !~ '[^[:space:]]'
              OR char_length(e.valor #>> '{}') > 60
        )
        AND (
          SELECT count(DISTINCT lower(btrim(e.valor #>> '{}')))
            FROM jsonb_array_elements(alergenos) AS e(valor)
        ) = jsonb_array_length(alergenos)
      )
  END;
$fn$;

COMMENT ON FUNCTION public.carta_alergenos_bien_formados(jsonb) IS
  'NULL o lista jsonb de 0-30 textos no vacíos, de 60 caracteres como máximo y sin repetir. La usan los CHECK de alérgenos de la carta.';

-- Sin REVOKE a propósito: Postgres comprueba EXECUTE con el usuario que
-- inserta o actualiza, así que quitárselo a authenticated haría fallar los
-- guardados del panel. La función es pura (no lee tablas): darla no expone nada.

-- ---------------------------------------------------------------------------
-- Bebidas
-- ---------------------------------------------------------------------------
ALTER TABLE public."Bebidas" DROP CONSTRAINT IF EXISTS bebidas_nombre_valido;
ALTER TABLE public."Bebidas" ADD CONSTRAINT bebidas_nombre_valido CHECK (
  nombre IS NOT NULL AND nombre ~ '[^[:space:]]' AND char_length(nombre) <= 150
) NOT VALID;

ALTER TABLE public."Bebidas" DROP CONSTRAINT IF EXISTS bebidas_categoria_valida;
ALTER TABLE public."Bebidas" ADD CONSTRAINT bebidas_categoria_valida CHECK (
  categoria IS NOT NULL AND categoria ~ '[^[:space:]]' AND char_length(categoria) <= 100
) NOT VALID;

ALTER TABLE public."Bebidas" DROP CONSTRAINT IF EXISTS bebidas_precio_valido;
ALTER TABLE public."Bebidas" ADD CONSTRAINT bebidas_precio_valido CHECK (
  precio_eur IS NOT NULL AND precio_eur >= 0 AND precio_eur <= 9999.99
) NOT VALID;

ALTER TABLE public."Bebidas" DROP CONSTRAINT IF EXISTS bebidas_imagen_url_https;
ALTER TABLE public."Bebidas" ADD CONSTRAINT bebidas_imagen_url_https CHECK (
  imagen_url IS NULL OR (imagen_url ~ '^https://[^[:space:]]+$' AND char_length(imagen_url) <= 2048)
) NOT VALID;

ALTER TABLE public."Bebidas" DROP CONSTRAINT IF EXISTS bebidas_textos_maximos;
ALTER TABLE public."Bebidas" ADD CONSTRAINT bebidas_textos_maximos CHECK (
      coalesce(char_length(descripcion), 0)    <= 2000
  AND coalesce(char_length(descripcion_en), 0) <= 2000
  AND coalesce(char_length(descripcion_fr), 0) <= 2000
  AND coalesce(char_length(nombre_en), 0)      <= 150
  AND coalesce(char_length(nombre_fr), 0)      <= 150
  AND coalesce(char_length(categoria_en), 0)   <= 100
  AND coalesce(char_length(categoria_fr), 0)   <= 100
  AND coalesce(char_length(tamano), 0)         <= 30
  AND coalesce(char_length(tipo), 0)           <= 100
  AND coalesce(char_length(tag), 0)            <= 50
) NOT VALID;

-- ---------------------------------------------------------------------------
-- Cocteles
-- ---------------------------------------------------------------------------
ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_nombre_valido;
ALTER TABLE public."Cocteles" ADD CONSTRAINT cocteles_nombre_valido CHECK (
  nombre IS NOT NULL AND nombre ~ '[^[:space:]]' AND char_length(nombre) <= 150
) NOT VALID;

ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_categoria_valida;
ALTER TABLE public."Cocteles" ADD CONSTRAINT cocteles_categoria_valida CHECK (
  categoria IS NOT NULL AND categoria ~ '[^[:space:]]' AND char_length(categoria) <= 100
) NOT VALID;

ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_precio_valido;
ALTER TABLE public."Cocteles" ADD CONSTRAINT cocteles_precio_valido CHECK (
  precio_eur IS NOT NULL AND precio_eur >= 0 AND precio_eur <= 9999.99
) NOT VALID;

ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_imagen_url_https;
ALTER TABLE public."Cocteles" ADD CONSTRAINT cocteles_imagen_url_https CHECK (
  imagen_url IS NULL OR (imagen_url ~ '^https://[^[:space:]]+$' AND char_length(imagen_url) <= 2048)
) NOT VALID;

ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_alergenos_bien_formados;
ALTER TABLE public."Cocteles" ADD CONSTRAINT cocteles_alergenos_bien_formados CHECK (
  public.carta_alergenos_bien_formados(alergenos_oficiales)
) NOT VALID;

ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_textos_maximos;
ALTER TABLE public."Cocteles" ADD CONSTRAINT cocteles_textos_maximos CHECK (
      coalesce(char_length(descripcion), 0)     <= 2000
  AND coalesce(char_length(descripcion_en), 0)  <= 2000
  AND coalesce(char_length(descripcion_fr), 0)  <= 2000
  AND coalesce(char_length(nombre_en), 0)       <= 150
  AND coalesce(char_length(nombre_fr), 0)       <= 150
  AND coalesce(char_length(categoria_en), 0)    <= 100
  AND coalesce(char_length(categoria_fr), 0)    <= 100
  AND coalesce(char_length(ingredientes), 0)    <= 2000
  AND coalesce(char_length(ingredientes_en), 0) <= 2000
  AND coalesce(char_length(ingredientes_fr), 0) <= 2000
  AND coalesce(char_length(preparacion), 0)     <= 2000
  AND coalesce(char_length(alergenos_notas), 0) <= 500
  AND coalesce(char_length(base), 0)            <= 100
) NOT VALID;

-- ---------------------------------------------------------------------------
-- VALIDATE: si alguna fila incumple, falla aquí y se deshace todo.
-- ---------------------------------------------------------------------------
ALTER TABLE public."Bebidas"  VALIDATE CONSTRAINT bebidas_nombre_valido;
ALTER TABLE public."Bebidas"  VALIDATE CONSTRAINT bebidas_categoria_valida;
ALTER TABLE public."Bebidas"  VALIDATE CONSTRAINT bebidas_precio_valido;
ALTER TABLE public."Bebidas"  VALIDATE CONSTRAINT bebidas_imagen_url_https;
ALTER TABLE public."Bebidas"  VALIDATE CONSTRAINT bebidas_textos_maximos;
ALTER TABLE public."Cocteles" VALIDATE CONSTRAINT cocteles_nombre_valido;
ALTER TABLE public."Cocteles" VALIDATE CONSTRAINT cocteles_categoria_valida;
ALTER TABLE public."Cocteles" VALIDATE CONSTRAINT cocteles_precio_valido;
ALTER TABLE public."Cocteles" VALIDATE CONSTRAINT cocteles_imagen_url_https;
ALTER TABLE public."Cocteles" VALIDATE CONSTRAINT cocteles_alergenos_bien_formados;
ALTER TABLE public."Cocteles" VALIDATE CONSTRAINT cocteles_textos_maximos;

-- ===========================================================================
-- CONSULTA DE ENSAYO (solo lee). Ejecutar ANTES de aplicar: lista las filas
-- que harían fallar el VALIDATE. Vacía = se puede aplicar.
-- ===========================================================================
-- SELECT 'Bebidas' AS tabla, id, nombre, categoria, precio_eur, imagen_url
--   FROM public."Bebidas"
--  WHERE NOT (nombre IS NOT NULL AND nombre ~ '[^[:space:]]' AND char_length(nombre) <= 150)
--     OR NOT (categoria IS NOT NULL AND categoria ~ '[^[:space:]]' AND char_length(categoria) <= 100)
--     OR NOT (precio_eur IS NOT NULL AND precio_eur >= 0 AND precio_eur <= 9999.99)
--     OR NOT (imagen_url IS NULL OR (imagen_url ~ '^https://[^[:space:]]+$' AND char_length(imagen_url) <= 2048))
--     OR greatest(char_length(descripcion), char_length(descripcion_en), char_length(descripcion_fr)) > 2000
--     OR greatest(char_length(nombre_en), char_length(nombre_fr)) > 150
--     OR greatest(char_length(categoria_en), char_length(categoria_fr), char_length(tipo)) > 100
--     OR char_length(tamano) > 30 OR char_length(tag) > 50
-- UNION ALL
-- SELECT 'Cocteles', id, nombre, categoria, precio_eur, imagen_url
--   FROM public."Cocteles"
--  WHERE NOT (nombre IS NOT NULL AND nombre ~ '[^[:space:]]' AND char_length(nombre) <= 150)
--     OR NOT (categoria IS NOT NULL AND categoria ~ '[^[:space:]]' AND char_length(categoria) <= 100)
--     OR NOT (precio_eur IS NOT NULL AND precio_eur >= 0 AND precio_eur <= 9999.99)
--     OR NOT (imagen_url IS NULL OR (imagen_url ~ '^https://[^[:space:]]+$' AND char_length(imagen_url) <= 2048))
--     OR NOT public.carta_alergenos_bien_formados(alergenos_oficiales)   -- tras crear la función
--     OR greatest(char_length(descripcion), char_length(descripcion_en), char_length(descripcion_fr),
--                 char_length(ingredientes), char_length(ingredientes_en), char_length(ingredientes_fr),
--                 char_length(preparacion)) > 2000
--     OR greatest(char_length(nombre_en), char_length(nombre_fr)) > 150
--     OR greatest(char_length(categoria_en), char_length(categoria_fr), char_length(base)) > 100
--     OR char_length(alergenos_notas) > 500;

-- ===========================================================================
-- REVERSIÓN (no se ejecuta; quitar el «-- » de cada línea para deshacer)
-- ===========================================================================
-- >>> REVERSIÓN
-- ALTER TABLE public."Bebidas"  DROP CONSTRAINT IF EXISTS bebidas_nombre_valido;
-- ALTER TABLE public."Bebidas"  DROP CONSTRAINT IF EXISTS bebidas_categoria_valida;
-- ALTER TABLE public."Bebidas"  DROP CONSTRAINT IF EXISTS bebidas_precio_valido;
-- ALTER TABLE public."Bebidas"  DROP CONSTRAINT IF EXISTS bebidas_imagen_url_https;
-- ALTER TABLE public."Bebidas"  DROP CONSTRAINT IF EXISTS bebidas_textos_maximos;
-- ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_nombre_valido;
-- ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_categoria_valida;
-- ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_precio_valido;
-- ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_imagen_url_https;
-- ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_alergenos_bien_formados;
-- ALTER TABLE public."Cocteles" DROP CONSTRAINT IF EXISTS cocteles_textos_maximos;
-- DROP FUNCTION IF EXISTS public.carta_alergenos_bien_formados(jsonb);
-- <<< FIN REVERSIÓN
