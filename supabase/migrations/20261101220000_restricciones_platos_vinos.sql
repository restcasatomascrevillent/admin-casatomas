-- ===========================================================================
-- Restricciones en la BD: Platos y Vinos (1/3)
-- ===========================================================================
--
-- QUÉ HACE
-- La API (PostgREST) aceptaba en "Platos" y "Vinos" datos imposibles que el
-- panel no deja meter pero que entran por cualquier otra vía: nombre vacío o
-- solo espacios, precio negativo, infinito o NaN, categoría vacía, alérgenos
-- con forma rara e imagen_url que no es https. Esta migración añade CHECK en
-- las dos tablas:
--
--   nombre               obligatorio, 1–150 caracteres sin contar espacios a los lados
--   categoria            obligatoria, no vale solo con espacios
--   descripcion          NULL o hasta 2.000 caracteres
--   precio_eur           NULL o entre 0 y 9.999,99 (la cota descarta también
--                        Infinity y NaN). NULL se permite A PROPÓSITO: en Platos
--                        la web muestra «consultar precio» (src/lib/precios.ts de
--                        web-casatomas). 0 € también pasa: lo frena el formulario.
--   alergenos_oficiales  NULL o array JSON de textos no vacíos (≤ 100 caracteres)
--   alergenos_inferidos  ídem
--   imagen_url           NULL o empieza por https://
--
-- Los máximos son los mismos que en el panel (src/lib/limites-carta.ts).
--
-- ORDEN: CHECK … NOT VALID → corregir filas → VALIDATE CONSTRAINT.
--   Con NOT VALID las filas nuevas y las que se editen ya se comprueban desde
--   el primer momento; VALIDATE revisa las viejas sin bloquear escrituras.
--
-- FILAS QUE INCUMPLÍAN (lectura del 01/11/2026, iguales en demo y producción)
--   * 188 vinos con alergenos_inferidos = el TEXTO JSON "[]" (un string) en vez
--     del array []. Se convierte a []; quien lo lee ya lo trataba como vacío
--     (parseAlergenos en el panel y en chat-web), así que nada cambia en pantalla.
--   * 1 vino («Terreus», 8ae1eafd-…) con imagen_url = '/images/terreus.jpeg',
--     ruta relativa que da 404 en la web: la foto ya no se veía. Se deja en NULL
--     (y expanded = false, como cualquier vino sin foto). Hay que volver a
--     subirle la foto desde el panel si se quiere.
--
-- Idempotente: se puede aplicar dos veces. Reversión:
-- supabase/rollbacks/20261101220000_restricciones_platos_vinos_ROLLBACK.sql
-- ===========================================================================

-- 1. Forma válida de una columna de alérgenos. IMMUTABLE para poder usarla en
--    un CHECK (un CHECK no admite subconsultas directamente).
CREATE OR REPLACE FUNCTION public.alergenos_bien_formados(valor jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT valor IS NULL
      OR (
        jsonb_typeof(valor) = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(valor) AS e(elemento)
          WHERE jsonb_typeof(e.elemento) <> 'string'
             OR btrim(e.elemento #>> '{}') = ''
             OR char_length(e.elemento #>> '{}') > 100
        )
      )
$fn$;

COMMENT ON FUNCTION public.alergenos_bien_formados(jsonb) IS
  'CHECK de Platos/Vinos: NULL o array JSON de textos no vacíos de hasta 100 caracteres.';

-- 2. CHECK … NOT VALID (las filas nuevas ya se comprueban).
DO $$
DECLARE
  tabla text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY['Platos', 'Vinos'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', tabla)::regclass AND conname = lower(tabla) || '_nombre_valido') THEN
      EXECUTE format($q$ALTER TABLE public.%I ADD CONSTRAINT %I
        CHECK (nombre IS NOT NULL AND char_length(btrim(nombre, E' \t\r\n')) BETWEEN 1 AND 150) NOT VALID$q$,
        tabla, lower(tabla) || '_nombre_valido');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', tabla)::regclass AND conname = lower(tabla) || '_categoria_valida') THEN
      EXECUTE format($q$ALTER TABLE public.%I ADD CONSTRAINT %I
        CHECK (categoria IS NOT NULL AND btrim(categoria, E' \t\r\n') <> '') NOT VALID$q$,
        tabla, lower(tabla) || '_categoria_valida');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', tabla)::regclass AND conname = lower(tabla) || '_descripcion_maximo') THEN
      EXECUTE format($q$ALTER TABLE public.%I ADD CONSTRAINT %I
        CHECK (descripcion IS NULL OR char_length(descripcion) <= 2000) NOT VALID$q$,
        tabla, lower(tabla) || '_descripcion_maximo');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', tabla)::regclass AND conname = lower(tabla) || '_precio_valido') THEN
      EXECUTE format($q$ALTER TABLE public.%I ADD CONSTRAINT %I
        CHECK (precio_eur IS NULL OR precio_eur BETWEEN 0 AND 9999.99) NOT VALID$q$,
        tabla, lower(tabla) || '_precio_valido');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', tabla)::regclass AND conname = lower(tabla) || '_alergenos_validos') THEN
      EXECUTE format($q$ALTER TABLE public.%I ADD CONSTRAINT %I
        CHECK (public.alergenos_bien_formados(alergenos_oficiales) AND public.alergenos_bien_formados(alergenos_inferidos)) NOT VALID$q$,
        tabla, lower(tabla) || '_alergenos_validos');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', tabla)::regclass AND conname = lower(tabla) || '_imagen_url_https') THEN
      EXECUTE format($q$ALTER TABLE public.%I ADD CONSTRAINT %I
        CHECK (imagen_url IS NULL OR imagen_url ~ '^https://') NOT VALID$q$,
        tabla, lower(tabla) || '_imagen_url_https');
    END IF;
  END LOOP;
END
$$;

-- 3. Corregir las filas que incumplían (ver cabecera). UN SOLO UPDATE por
--    tabla a propósito: con los CHECK ya puestos (aunque sean NOT VALID), cada
--    UPDATE comprueba la fila ENTERA, y «Terreus» incumple dos a la vez; si se
--    arreglara un campo cada vez, el primer UPDATE fallaría por el otro.
DO $$
DECLARE
  tabla text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY['Platos', 'Vinos'] LOOP
    EXECUTE format($q$
      UPDATE public.%I SET
        alergenos_inferidos = CASE WHEN alergenos_inferidos = '"[]"'::jsonb THEN '[]'::jsonb ELSE alergenos_inferidos END,
        alergenos_oficiales = CASE WHEN alergenos_oficiales = '"[]"'::jsonb THEN '[]'::jsonb ELSE alergenos_oficiales END,
        -- Rutas relativas o http:// (sin foto real en la web): se quitan.
        expanded   = CASE WHEN imagen_url !~ '^https://' THEN false ELSE expanded END,
        imagen_url = CASE WHEN imagen_url !~ '^https://' THEN NULL ELSE imagen_url END
      WHERE alergenos_inferidos = '"[]"'::jsonb
         OR alergenos_oficiales = '"[]"'::jsonb
         OR imagen_url !~ '^https://'
    $q$, tabla);
  END LOOP;
END
$$;

-- 4. VALIDATE. Si aquí falla, hay filas nuevas que incumplen: listarlas con la
--    consulta del final, corregirlas y volver a aplicar (es idempotente).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tabla, conname
    FROM pg_constraint
    WHERE conrelid IN ('public."Platos"'::regclass, 'public."Vinos"'::regclass)
      AND contype = 'c'
      AND NOT convalidated
      AND conname ~ '^(platos|vinos)_(nombre_valido|categoria_valida|descripcion_maximo|precio_valido|alergenos_validos|imagen_url_https)$'
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tabla, r.conname);
  END LOOP;
END
$$;

-- CONSULTA DE ENSAYO (solo lee): filas que incumplirían alguna restricción.
--
-- SELECT 'Platos' AS tabla, id, nombre FROM public."Platos"
--  WHERE NOT (nombre IS NOT NULL AND char_length(btrim(nombre, E' \t\r\n')) BETWEEN 1 AND 150)
--     OR NOT (categoria IS NOT NULL AND btrim(categoria, E' \t\r\n') <> '')
--     OR char_length(descripcion) > 2000
--     OR NOT (precio_eur IS NULL OR precio_eur BETWEEN 0 AND 9999.99)
--     OR NOT (public.alergenos_bien_formados(alergenos_oficiales) AND public.alergenos_bien_formados(alergenos_inferidos))
--     OR NOT (imagen_url IS NULL OR imagen_url ~ '^https://')
-- UNION ALL
-- SELECT 'Vinos', id, nombre FROM public."Vinos"
--  WHERE …mismas condiciones…;
