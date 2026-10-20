-- ===========================================================================
-- ##                                                                       ##
-- ##                            APLICADA                                   ##
-- ##                                                                       ##
-- ##   Corregido 2026-09-23: SI esta aplicado (supabase_migrations.         ##
-- ##   schema_migrations lo confirma; API de Supabase, solo lectura).       ##
-- ##   Se ha ensayado dentro de BEGIN/ROLLBACK contra los datos reales      ##
-- ##   (solo lectura persistida); ver el informe de la sesión para las      ##
-- ##   cifras exactas.                                                      ##
-- ##                                                                       ##
-- ===========================================================================
--
-- QUÉ ARREGLA Y POR QUÉ (decisión del dueño del restaurante)
-- "Vinos.alergenos_oficiales" está vacío en las 185 filas de la carta de
-- vinos (179 con el valor "[]" y 6 con NULL — ver nota de TIPO más abajo),
-- mientras que "alergenos_en" ya dice "sulphites" en 109 de ellas. El
-- etiquetado de alérgenos es obligatorio (Reglamento UE 1169/2011) y hoy la
-- carta de vinos no declara ninguno.
--
-- El dueño ha decidido declarar SULFITOS por defecto en todos los vinos:
-- prácticamente todo vino comercial supera el umbral (10 mg/l) que obliga a
-- declararlos, así que es la posición defendible por defecto.
--
-- CONDICIÓN 1 — tiene que poder quitarse fácilmente
-- Existen vinos "sin sulfitos añadidos" que se venden precisamente por eso;
-- declararles sulfitos sería tan incorrecto como no declararlos en el resto.
-- Para retirarlo de un vino concreto:
--
--   UPDATE public."Vinos"
--   SET alergenos_oficiales = alergenos_oficiales - 'sulfitos'
--   WHERE nombre = 'Nombre exacto del vino';
--
-- Ese único UPDATE basta. El trigger de este fichero (más abajo) se encarga
-- automáticamente de: (a) marcar la fila como excluida manualmente, (b)
-- vaciar alergenos_en/alergenos_fr si solo tenían el valor por defecto, y
-- (c) blindarla frente a que este mismo backfill se lo vuelva a poner.
--
-- AVISO IMPORTANTE: hoy el panel (VinoForm.tsx / EditarVinoModal.tsx) NO
-- tiene ninguna casilla para editar "alergenos_oficiales" en vinos — solo
-- expone "alergenos_notas" (texto libre). A diferencia de los platos
-- (PlatoForm.tsx, que sí usa ALERGENOS_OFICIALES/combinarAlergenos de
-- src/lib/alergenos.ts), el dueño no puede desmarcar sulfitos desde la
-- interfaz todavía; solo con SQL directo como el de arriba (p. ej. desde el
-- SQL editor de Supabase). Añadir esa casilla al formulario de vinos queda
-- fuera de esta migración (vive en src/**, zona de otros agentes en esta
-- sesión) pero es necesario para que la condición 1 sea utilizable desde el
-- panel. La parte de base de datos (este fichero) ya es correcta y segura
-- tanto si esa casilla llega mañana como si tarda meses.
--
-- CONDICIÓN 2 — una futura reejecución no debe deshacer una exclusión manual
-- Se añade la columna "sulfitos_excluido_manualmente" (boolean, false por
-- defecto) y un trigger que la mantiene SOLO:
--   * true  cuando "alergenos_oficiales" pasa de contener "sulfitos" a no
--     contenerlo (alguien lo ha quitado, por SQL o por un futuro botón).
--   * false cuando pasa de no contenerlo a contenerlo (alguien lo vuelve a
--     marcar).
-- El backfill de abajo solo toca filas con sulfitos_excluido_manualmente =
-- false, así que una reejecución de este fichero (o de este UPDATE suelto)
-- nunca vuelve a poner sulfitos en un vino de donde se haya quitado a mano.
-- Ensayado en la sesión: tras simular la retirada manual en un vino y volver
-- a correr el backfill, la fila afectada dio 0 cambios.
--
-- CONDICIÓN 3 (implícita) — coherencia en los tres idiomas
-- El mismo trigger que gestiona la exclusión también vacía/rellena
-- alergenos_en ("sulphites") y alergenos_fr ("sulfites") en el mismo
-- movimiento, pero SOLO si su valor actual es exactamente el que puso este
-- backfill por defecto — nunca pisa un texto distinto que alguien haya
-- escrito ahí a mano. Los 109 vinos que ya tienen alergenos_en="sulphites" /
-- alergenos_fr="sulfites" NO se tocan (ni se duplican, ni se reescriben): se
-- usan tal cual como referencia del formato ya vigente. Solo se rellenan los
-- que estaban NULL o "".
--
-- TIPO REAL DE LAS COLUMNAS (verificado con information_schema.columns antes
-- de escribir el UPDATE, y reafirmado con una aserción en tiempo de
-- ejecución más abajo — no es solo un comentario, la migración aborta si no
-- se cumple):
--   * alergenos_oficiales -> jsonb   (coincide con los types de adminpanelct;
--     el `text[]` que dice el database-schema-export.sql de casa-tomas-story
--     está desactualizado/es incorrecto para esta base de datos real).
--   * alergenos_en, alergenos_fr    -> text (NO son arrays; son un único
--     valor de texto. Hoy el único valor no vacío que existe en toda la
--     tabla es exactamente "sulphites"/"sulfites" — no hay listas ni otros
--     alérgenos mezclados ahí, así que rellenar solo cuando está vacío es
--     seguro).
--
-- DESCUBRIMIENTO NO OBVIO — doble codificación en alergenos_oficiales
-- El tipo de columna es jsonb, pero el VALOR guardado en las 179 filas no es
-- el array vacío `[]`: es el escalar de texto `"[]"` (un jsonb cuyo
-- jsonb_typeof() es 'string', con dos caracteres literales dentro: "[" y
-- "]"). Un UPDATE ingenuo con `alergenos_oficiales || '["sulfitos"]'::jsonb`
-- NO falla con este dato: jsonb `||` envuelve el escalar en un array de un
-- elemento y concatena, así que el resultado sería el array corrupto
-- `["[]", "sulfitos"]` (con el string "[]" colado como alérgeno). Por eso el
-- backfill de abajo distingue explícitamente NULL / string-"[]" / array real
-- y solo entonces añade "sulfitos", en vez de concatenar a ciegas. El mismo
-- problema afecta a Vinos.alergenos_inferidos (misma forma, no se toca aquí:
-- no es una columna oficial/legal y no la pide esta migración). Platos y
-- Cocteles NO tienen este problema (sus alergenos_oficiales ya son arrays
-- reales o NULL) — es específico de Vinos.
--
-- RELACIÓN CON supabase/migrations/20260921120000_normalizar_vocabulario_alergenos.sql
-- Esa migración (aplicada, de otra sesión — corregido 2026-09-23) limpia sinónimos sucios
-- (`sulfito`, `so2`, ...) dentro de arrays JA EXISTENTES; nunca añade
-- "sulfitos" a una fila que no lo tenga, y su guarda
-- `jsonb_typeof(columna) = 'array'` hace que, TAL COMO ESTÁ HOY, no toque
-- ninguna fila de Vinos.alergenos_oficiales/alergenos_inferidos (son
-- string/NULL, no array — ver el descubrimiento de arriba); sí actúa con
-- normalidad sobre Platos. Esta migración debe ir DESPUÉS de aquella (el
-- timestamp ya lo garantiza) para que, si el histórico llegase a tener
-- sinónimos sucios en un array real de Vinos, se normalicen antes de que
-- este UPDATE compruebe si "sulfitos" ya está presente (evita duplicados
-- tipo ["sulfito", "sulfitos"]). Ambas migraciones son compatibles y no se
-- duplican: una limpia vocabulario en lo que ya existe, esta declara el
-- alérgeno por defecto y deja el dato listo (array real) para que la otra,
-- si se revisa y aplica, tenga algo que normalizar.
--
-- FORMA CANÓNICA: "sulfitos" en minúsculas, sin mayúscula inicial — el mismo
-- id que usa src/lib/alergenos.ts (ALERGENOS_OFICIALES) y el mismo valor que
-- ya usa la migración de normalización. Es lo que se guarda en BD; el panel
-- ya capitaliza para mostrar "Sulfitos" y la web imprime el valor crudo.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Verificación de tipos reales. Aborta la migración (no corrompe nada) si
--    la base de datos real no coincide con lo comprobado en esta sesión.
-- ---------------------------------------------------------------------------
DO $verificacion$
DECLARE
  tipo_oficiales text;
  tipo_en        text;
  tipo_fr        text;
BEGIN
  SELECT c.data_type INTO tipo_oficiales FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'Vinos' AND c.column_name = 'alergenos_oficiales';
  SELECT c.data_type INTO tipo_en FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'Vinos' AND c.column_name = 'alergenos_en';
  SELECT c.data_type INTO tipo_fr FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'Vinos' AND c.column_name = 'alergenos_fr';

  IF tipo_oficiales IS NULL OR tipo_en IS NULL OR tipo_fr IS NULL THEN
    RAISE EXCEPTION 'Vinos no tiene alguna de las columnas esperadas (alergenos_oficiales/alergenos_en/alergenos_fr). Migración abortada.';
  END IF;

  IF tipo_oficiales IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'Vinos.alergenos_oficiales no es jsonb (es %). Migración abortada: revisa y adapta el UPDATE antes de reintentar.', tipo_oficiales;
  END IF;
  IF tipo_en IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Vinos.alergenos_en no es text (es %). Migración abortada.', tipo_en;
  END IF;
  IF tipo_fr IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Vinos.alergenos_fr no es text (es %). Migración abortada.', tipo_fr;
  END IF;
END;
$verificacion$;


-- ---------------------------------------------------------------------------
-- 1. Columna de exclusión manual. false = sigue el valor por defecto;
--    true = un humano ha decidido explícitamente que este vino no declara
--    sulfitos, y ni este backfill ni una futura reejecución deben tocarlo.
-- ---------------------------------------------------------------------------
ALTER TABLE public."Vinos"
  ADD COLUMN IF NOT EXISTS sulfitos_excluido_manualmente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."Vinos".sulfitos_excluido_manualmente IS
  'true = alguien ha retirado deliberadamente "sulfitos" de alergenos_oficiales para este vino (p.ej. "sin sulfitos añadidos"). Mantenido automáticamente por el trigger trg_vinos_exclusion_sulfitos. Mientras sea true, el backfill de 20260921180000_declarar_sulfitos_vinos.sql no vuelve a añadir sulfitos.';


-- ---------------------------------------------------------------------------
-- 2. Backfill español (oficial/legal). Normaliza NULL y el string
--    doblemente codificado "[]" a un array real, y añade "sulfitos" salvo en
--    las filas ya excluidas manualmente o que ya lo declaran.
-- ---------------------------------------------------------------------------
UPDATE public."Vinos"
SET alergenos_oficiales = CASE
      WHEN alergenos_oficiales IS NULL THEN '["sulfitos"]'::jsonb
      WHEN jsonb_typeof(alergenos_oficiales) = 'array' THEN alergenos_oficiales || '["sulfitos"]'::jsonb
      WHEN jsonb_typeof(alergenos_oficiales) = 'string' AND alergenos_oficiales = '"[]"'::jsonb THEN '["sulfitos"]'::jsonb
      ELSE alergenos_oficiales -- forma inesperada: no se toca, se deja para revisión manual
    END
WHERE sulfitos_excluido_manualmente = false
  AND (
        alergenos_oficiales IS NULL
     OR (jsonb_typeof(alergenos_oficiales) = 'array' AND NOT alergenos_oficiales @> '["sulfitos"]'::jsonb)
     OR (jsonb_typeof(alergenos_oficiales) = 'string' AND alergenos_oficiales = '"[]"'::jsonb)
      );


-- ---------------------------------------------------------------------------
-- 3. Coherencia en inglés y francés: solo rellena lo que está vacío/NULL,
--    usando exactamente el formato que ya usan las 109 filas existentes
--    (valor único, sin lista, sin acentos ni mayúsculas). Nunca pisa texto
--    ya presente.
-- ---------------------------------------------------------------------------
UPDATE public."Vinos"
SET alergenos_en = 'sulphites'
WHERE sulfitos_excluido_manualmente = false
  AND jsonb_typeof(alergenos_oficiales) = 'array'
  AND alergenos_oficiales @> '["sulfitos"]'::jsonb
  AND (alergenos_en IS NULL OR btrim(alergenos_en) = '');

UPDATE public."Vinos"
SET alergenos_fr = 'sulfites'
WHERE sulfitos_excluido_manualmente = false
  AND jsonb_typeof(alergenos_oficiales) = 'array'
  AND alergenos_oficiales @> '["sulfitos"]'::jsonb
  AND (alergenos_fr IS NULL OR btrim(alergenos_fr) = '');


-- ---------------------------------------------------------------------------
-- 4. Salvaguarda futura. Se instala DESPUÉS del backfill inicial a propósito
--    (para que el backfill de arriba tenga un rastro de UPDATEs explícito y
--    auditable, sin depender de que el trigger actúe durante su propia
--    ejecución). A partir de aquí, cualquier UPDATE futuro sobre
--    alergenos_oficiales —desde el panel cuando tenga la casilla, desde el
--    SQL editor, o desde donde sea— mantiene sola la columna de exclusión y
--    la coherencia en/fr, sin depender de que nadie recuerde tocar nada más.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vinos_actualizar_exclusion_sulfitos()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  tenia_antes boolean;
  tiene_ahora boolean;
BEGIN
  tenia_antes := jsonb_typeof(OLD.alergenos_oficiales) = 'array' AND OLD.alergenos_oficiales @> '["sulfitos"]'::jsonb;
  tiene_ahora := jsonb_typeof(NEW.alergenos_oficiales) = 'array' AND NEW.alergenos_oficiales @> '["sulfitos"]'::jsonb;

  IF tenia_antes AND NOT tiene_ahora THEN
    -- Alguien ha quitado "sulfitos" del oficial: exclusión deliberada.
    NEW.sulfitos_excluido_manualmente := true;
    -- Se retira también de en/fr, pero solo si aún tenían exactamente el
    -- valor por defecto (si alguien escribió otra cosa, se respeta).
    IF NEW.alergenos_en = 'sulphites' THEN
      NEW.alergenos_en := '';
    END IF;
    IF NEW.alergenos_fr = 'sulfites' THEN
      NEW.alergenos_fr := '';
    END IF;
  ELSIF (NOT tenia_antes) AND tiene_ahora THEN
    -- Alguien ha vuelto a marcar "sulfitos": ya no está excluido.
    NEW.sulfitos_excluido_manualmente := false;
    IF NEW.alergenos_en IS NULL OR btrim(NEW.alergenos_en) = '' THEN
      NEW.alergenos_en := 'sulphites';
    END IF;
    IF NEW.alergenos_fr IS NULL OR btrim(NEW.alergenos_fr) = '' THEN
      NEW.alergenos_fr := 'sulfites';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_vinos_exclusion_sulfitos ON public."Vinos";
CREATE TRIGGER trg_vinos_exclusion_sulfitos
  BEFORE UPDATE ON public."Vinos"
  FOR EACH ROW
  WHEN (OLD.alergenos_oficiales IS DISTINCT FROM NEW.alergenos_oficiales)
  EXECUTE FUNCTION public.vinos_actualizar_exclusion_sulfitos();


-- ===========================================================================
-- CONSULTA DE ENSAYO (opcional, solo lectura + rollback)
-- ---------------------------------------------------------------------------
-- Ejecuta esto en una transacción que revuelvas para ver el efecto exacto
-- antes de aplicar el fichero de verdad (así se ensayó en esta sesión):
--
--   BEGIN;
--   -- ... (secciones 0 a 4 de este fichero) ...
--   SELECT count(*) FILTER (WHERE jsonb_typeof(alergenos_oficiales) = 'array'
--                              AND alergenos_oficiales @> '["sulfitos"]'::jsonb) AS con_sulfitos_es,
--          count(*) FILTER (WHERE alergenos_en = 'sulphites') AS con_en,
--          count(*) FILTER (WHERE alergenos_fr = 'sulfites') AS con_fr,
--          count(*) FILTER (WHERE sulfitos_excluido_manualmente) AS excluidos
--   FROM public."Vinos";
--   ROLLBACK;
--
-- Para probar la salvaguarda con un vino concreto, dentro de la misma
-- transacción y antes del ROLLBACK:
--
--   UPDATE public."Vinos" SET alergenos_oficiales = alergenos_oficiales - 'sulfitos'
--   WHERE nombre = 'Nombre exacto del vino';
--   -- repetir la sección 2 de este fichero: esa fila debe dar 0 cambios.
-- ===========================================================================
