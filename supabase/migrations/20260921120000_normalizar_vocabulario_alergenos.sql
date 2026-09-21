-- ===========================================================================
-- ##                                                                       ##
-- ##                          NO APLICADA                                  ##
-- ##                                                                       ##
-- ##   Este fichero NO se ha ejecutado contra ninguna base de datos.        ##
-- ##   Queda preparado para que el dueño lo revise y decida.                ##
-- ##   Antes de aplicarlo: haz copia de seguridad y ejecuta primero la      ##
-- ##   CONSULTA DE ENSAYO del final (solo lee, no escribe).                 ##
-- ##                                                                       ##
-- ===========================================================================
--
-- QUÉ ARREGLA
-- El panel guardaba los alérgenos con IDs en snake_case sin acentos
-- (`crustaceos`, `frutos_cascara`, `huevo`, `sesamo`) mientras que en la base
-- de datos conviven esos valores con las etiquetas en español con acentos
-- (`crustáceos`, `frutos de cáscara`, `huevos`, `sésamo`). El mismo alérgeno
-- está escrito de varias formas, y en algunas filas las DOS a la vez
-- (duplicado), porque al editar un plato el panel no reconocía lo guardado y
-- añadía su propia versión.
--
-- El código del panel ya se ha corregido (`src/lib/alergenos.ts`): normaliza al
-- leer y al guardar, así que a partir de ahora no se generan más variantes y
-- las casillas se marcan bien aunque los datos viejos sigan sucios. Esta
-- migración es la limpieza del histórico; el panel funciona con o sin ella.
--
-- FORMA CANÓNICA ELEGIDA: la etiqueta en español, en minúsculas y con acentos
-- (`crustáceos`, `frutos de cáscara`, `huevos`, `sésamo`, `lácteos`...).
-- Motivo: las webs públicas imprimen el valor CRUDO de la columna; en
-- casa-tomas-story (`src/components/carta/ProductoCard.tsx`) solo se le aplica
-- un "capitalizar" que pone la primera letra en mayúscula. Con snake_case la
-- web mostraría literalmente "Frutos_cascara". Además la forma con acentos es
-- la que ya predomina en los datos, así que así se tocan menos filas.
--
-- QUÉ **NO** HACE (a propósito)
--   * No toca los valores que no reconoce. `alcohol` y `carne` no son alérgenos
--     de declaración obligatoria y se quedan como están.
--   * No toca `marisco`. En castellano cubre a la vez crustáceos y moluscos:
--     mapearlo a uno perdería información y a los dos se la inventaría. Es una
--     decisión del dueño de la carta, no del código.
--   * No borra filas ni vacía columnas. Si tras limpiar una fila se quedara sin
--     ningún alérgeno válido, se deja intacta para que se revise a mano.
--
-- TIPO DE COLUMNA
-- Las fuentes del repositorio se contradicen: los tipos generados del panel y
-- de touza dicen `jsonb`, y un export antiguo de casa-tomas-story dice
-- `text[]`. Como no se ha podido consultar la base de datos real, el bloque de
-- abajo MIRA el tipo en `information_schema` y aplica la variante que toque.
-- Funciona igual con `jsonb` que con `text[]`, y salta las tablas o columnas
-- que no existan.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Función auxiliar (temporal: se borra al final del fichero).
--    Réplica en SQL de `normalizarAlergeno` de src/lib/alergenos.ts.
--    Devuelve el valor canónico si reconoce el alérgeno; si no, el texto
--    original recortado; y NULL si la entrada estaba vacía.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalizar_alergeno_tmp(valor text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH limpia AS (
    -- Sin acentos, en minúsculas, guiones y guiones bajos como espacios,
    -- espacios colapsados. `frutos_Cáscara ` y `Frutos de cascara` acaban
    -- siendo comparables. Se usa translate() en vez de unaccent() para no
    -- depender de que la extensión esté instalada.
    SELECT btrim(
             regexp_replace(
               regexp_replace(
                 translate(
                   lower(coalesce(valor, '')),
                   'áàäâãéèëêíìïîóòöôõúùüûñç',
                   'aaaaaeeeeiiiiooooouuuunc'
                 ),
                 '[_-]+', ' ', 'g'
               ),
               '\s+', ' ', 'g'
             )
           ) AS clave
  ),
  mapa(sinonimo, canonico) AS (
    VALUES
      ('gluten',                        'gluten'),
      ('cereales con gluten',           'gluten'),
      ('cereales que contengan gluten', 'gluten'),
      ('crustaceos',                    'crustáceos'),
      ('crustaceo',                     'crustáceos'),
      ('huevos',                        'huevos'),
      ('huevo',                         'huevos'),
      ('pescado',                       'pescado'),
      ('pescados',                      'pescado'),
      ('cacahuetes',                    'cacahuetes'),
      ('cacahuete',                     'cacahuetes'),
      ('cacahuates',                    'cacahuetes'),
      ('cacahuate',                     'cacahuetes'),
      ('mani',                          'cacahuetes'),
      ('frutos de cascara',             'frutos de cáscara'),
      ('fruto de cascara',              'frutos de cáscara'),
      ('frutos cascara',                'frutos de cáscara'),
      ('fruto cascara',                 'frutos de cáscara'),
      ('frutos secos',                  'frutos de cáscara'),
      ('fruto seco',                    'frutos de cáscara'),
      ('nueces',                        'frutos de cáscara'),
      ('lacteos',                       'lácteos'),
      ('lacteo',                        'lácteos'),
      ('leche',                         'lácteos'),
      ('lactosa',                       'lácteos'),
      ('productos lacteos',             'lácteos'),
      ('apio',                          'apio'),
      ('mostaza',                       'mostaza'),
      ('sesamo',                        'sésamo'),
      ('sesamos',                       'sésamo'),
      ('granos de sesamo',              'sésamo'),
      ('semillas de sesamo',            'sésamo'),
      ('ajonjoli',                      'sésamo'),
      ('sulfitos',                      'sulfitos'),
      ('sulfito',                       'sulfitos'),
      ('dioxido de azufre',             'sulfitos'),
      ('dioxido de azufre y sulfitos',  'sulfitos'),
      ('so2',                           'sulfitos'),
      ('altramuces',                    'altramuces'),
      ('altramuz',                      'altramuces'),
      ('moluscos',                      'moluscos'),
      ('molusco',                       'moluscos'),
      ('soja',                          'soja'),
      ('sojas',                         'soja'),
      ('soya',                          'soja')
  )
  -- 1) el canónico si se reconoce el sinónimo
  -- 2) si no, el texto original recortado (alérgeno personalizado: se respeta)
  -- 3) NULL si venía vacío
  SELECT COALESCE(
    (SELECT m.canonico FROM mapa m, limpia l WHERE m.sinonimo = l.clave LIMIT 1),
    NULLIF(btrim(coalesce(valor, '')), '')
  );
$fn$;


-- ---------------------------------------------------------------------------
-- 2. Limpieza de cada columna de alérgenos.
--    Se detecta el tipo de la columna y se usa la variante correspondiente.
--    En ambos casos: normalizar -> quitar vacíos -> quitar duplicados
--    conservando el orden de primera aparición -> escribir solo si cambia.
-- ---------------------------------------------------------------------------
DO $migracion$
DECLARE
  objetivo    record;
  tipo_dato   text;
  sentencia   text;
  afectadas   bigint;
  total       bigint := 0;
BEGIN
  FOR objetivo IN
    SELECT *
    FROM (VALUES
      ('Platos',   'alergenos_oficiales'),
      ('Platos',   'alergenos_inferidos'),
      ('Vinos',    'alergenos_oficiales'),
      ('Vinos',    'alergenos_inferidos'),
      ('Cocteles', 'alergenos_oficiales')
    ) AS t(tabla, columna)
  LOOP
    SELECT c.data_type INTO tipo_dato
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name   = objetivo.tabla
      AND c.column_name  = objetivo.columna;

    IF tipo_dato IS NULL THEN
      RAISE NOTICE 'Se salta %.%: la columna no existe', objetivo.tabla, objetivo.columna;
      CONTINUE;
    END IF;

    IF tipo_dato = 'jsonb' THEN
      sentencia := format($sql$
        WITH desplegado AS (
          SELECT t.id,
                 public.normalizar_alergeno_tmp(e.valor) AS valor,
                 e.ord
          FROM public.%1$I t
          CROSS JOIN LATERAL jsonb_array_elements_text(t.%2$I)
            WITH ORDINALITY AS e(valor, ord)
          WHERE t.%2$I IS NOT NULL
            AND jsonb_typeof(t.%2$I) = 'array'
        ),
        sin_duplicados AS (
          SELECT id, valor, min(ord) AS ord
          FROM desplegado
          WHERE valor IS NOT NULL AND valor <> ''
          GROUP BY id, valor
        ),
        recompuesto AS (
          SELECT id, jsonb_agg(to_jsonb(valor) ORDER BY ord) AS nuevo
          FROM sin_duplicados
          GROUP BY id
        )
        UPDATE public.%1$I t
        SET %2$I = r.nuevo
        FROM recompuesto r
        WHERE t.id = r.id
          AND t.%2$I IS DISTINCT FROM r.nuevo
      $sql$, objetivo.tabla, objetivo.columna);

    ELSIF tipo_dato = 'ARRAY' THEN
      sentencia := format($sql$
        WITH desplegado AS (
          SELECT t.id,
                 public.normalizar_alergeno_tmp(e.valor) AS valor,
                 e.ord
          FROM public.%1$I t
          CROSS JOIN LATERAL unnest(t.%2$I) WITH ORDINALITY AS e(valor, ord)
          WHERE t.%2$I IS NOT NULL
        ),
        sin_duplicados AS (
          SELECT id, valor, min(ord) AS ord
          FROM desplegado
          WHERE valor IS NOT NULL AND valor <> ''
          GROUP BY id, valor
        ),
        recompuesto AS (
          SELECT id, array_agg(valor ORDER BY ord) AS nuevo
          FROM sin_duplicados
          GROUP BY id
        )
        UPDATE public.%1$I t
        SET %2$I = r.nuevo
        FROM recompuesto r
        WHERE t.id = r.id
          AND t.%2$I IS DISTINCT FROM r.nuevo
      $sql$, objetivo.tabla, objetivo.columna);

    ELSE
      RAISE NOTICE 'Se salta %.%: tipo inesperado (%). Revisa la columna a mano.',
        objetivo.tabla, objetivo.columna, tipo_dato;
      CONTINUE;
    END IF;

    EXECUTE sentencia;
    GET DIAGNOSTICS afectadas = ROW_COUNT;
    total := total + afectadas;
    RAISE NOTICE '%.% (%): % filas normalizadas', objetivo.tabla, objetivo.columna, tipo_dato, afectadas;
  END LOOP;

  RAISE NOTICE 'Total de filas normalizadas: %', total;
END;
$migracion$;


-- ---------------------------------------------------------------------------
-- 3. Se retira la función auxiliar: era solo para esta limpieza.
--    La lógica viva está en el panel (src/lib/alergenos.ts).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.normalizar_alergeno_tmp(text);


-- ===========================================================================
-- CONSULTA DE ENSAYO (opcional, solo lectura)
-- ---------------------------------------------------------------------------
-- Ejecuta los pasos 1 y 2 sustituyendo el UPDATE por este SELECT para ver
-- exactamente qué cambiaría antes de aplicar nada. Ajusta el tipo de columna
-- (jsonb_array_elements_text / unnest) según lo que tenga tu base de datos.
--
--   SELECT p.id,
--          p.nombre,
--          p.alergenos_oficiales AS antes,
--          (
--            SELECT jsonb_agg(DISTINCT public.normalizar_alergeno_tmp(v))
--            FROM jsonb_array_elements_text(p.alergenos_oficiales::jsonb) AS v
--          ) AS despues
--   FROM public."Platos" p
--   WHERE p.alergenos_oficiales IS NOT NULL
--   ORDER BY p.nombre;
--
-- Y para ver el vocabulario que hay hoy y decidir sobre los valores sueltos
-- (`alcohol`, `carne`, `marisco`...):
--
--   SELECT v AS valor, count(*) AS filas
--   FROM public."Platos" p,
--        LATERAL jsonb_array_elements_text(p.alergenos_oficiales::jsonb) AS v
--   GROUP BY v
--   ORDER BY filas DESC, valor;
-- ===========================================================================
