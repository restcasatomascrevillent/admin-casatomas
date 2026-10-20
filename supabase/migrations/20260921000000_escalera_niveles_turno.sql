-- ============================================================
-- ESCALERA DE NIVELES DE TURNO  (configuracion_turnos)
-- ============================================================
-- APLICADA — verificado 2026-09-23 contra supabase_migrations.schema_migrations
-- (API de Supabase, solo lectura). La cabecera decía "NO APLICADA"; ya no es
-- cierto. SQL sin tocar.
--
-- QUÉ RESUELVE
-- ------------
-- Hoy la "escalera" de horas está cableada en dos columnas sueltas:
--   intervalo_base_minutos          (paso del segundo nivel)
--   umbral_apertura_secundario      (% para abrirlo)
--   ocultar_primario_si_secundario  (bool)
-- Eso solo da DOS niveles. Añadir un tercero (los cuartos, :15 y :45)
-- con más columnas sueltas —`umbral_apertura_terciario`, etc.— dejaría
-- el mismo problema para el cuarto nivel: cada escalón nuevo sería una
-- migración. Se modela como una LISTA ORDENADA de niveles en jsonb, así
-- que añadir o quitar un escalón es un UPDATE desde el panel.
--
-- FORMA DEL DATO (contrato cerrado para quien construya la pantalla)
-- -----------------------------------------------------------------
--   niveles_escalera = [
--     {"minutos": 60, "umbral": 0},    -- nivel 0: horas enteras
--     {"minutos": 30, "umbral": 70},   -- nivel 1: medias
--     {"minutos": 15, "umbral": 85}    -- nivel 2: cuartos
--   ]
--
--   * Array de 1 a 8 objetos. El ORDEN de guardado da igual: el motor
--     ordena de mayor a menor `minutos` (de grueso a fino).
--   * `minutos`: entero 1..1440. Es el PASO del nivel, anclado a
--     medianoche (60 -> 13:00, 14:00; 30 -> 13:30; 15 -> 13:15, 13:45).
--   * `umbral`: número 0..100. Porcentaje de ocupación del hueco ANTERIOR
--     a partir del cual se abre éste. El umbral del nivel más grueso se
--     ignora y se trata siempre como 0 (siempre abierto).
--   * Si la lista es NULL, el motor la deriva de las columnas antiguas:
--       [{"minutos":60,"umbral":0},
--        {"minutos":intervalo_base_minutos,"umbral":umbral_apertura_secundario}]
--     Por eso NADA se rompe si esta migración no llega a aplicarse.
--
--   ocultar_nivel_anterior: al abrirse un nivel, el anterior deja de
--   ofrecerse. Generaliza `ocultar_primario_si_secundario`, del que hereda
--   el valor si la columna nueva es NULL.
--
--   base_umbral: sobre QUÉ se mide ese porcentaje.
--     'aforo_total'        -> comensales de esa hora / aforo del restaurante.
--     'reparto_nivel_base' -> comensales de esa hora / (aforo repartido
--                             entre las horas del nivel más grueso).
--     Por defecto 'reparto_nivel_base' (decisión del dueño, SECCIÓN A.bis).
--
-- QUÉ RECHAZA EL MOTOR Y CÓMO SE COMPORTA (para la pantalla de config)
-- --------------------------------------------------------------------
--   * Lista NULL / vacía / no-array / JSON roto  -> deriva de las columnas
--     antiguas. Nunca falla.
--   * Nivel con `minutos` <= 0 o no entero       -> se descarta ese nivel.
--   * Niveles con el mismo `minutos`             -> se queda el primero.
--   * `umbral` fuera de 0..100                   -> se recorta a 0..100.
--   * Umbral de un nivel MENOR que el del anterior -> se sube al del
--     anterior (la escalera se fuerza monótona) y se avisa. Un escalón fino
--     nunca se abre antes que el grueso del que cuelga.
--   * `hora_fin` <= `hora_inicio`                -> se entiende que cruza
--     medianoche; si son IGUALES se descarta el periodo (longitud cero).
--   * Periodo sin ninguna hora en la rejilla del nivel más grueso (p. ej.
--     13:20-13:50 con nivel de 60 min) -> el primer hueco fino se PROMUEVE
--     a "siempre abierto" para no dejar el turno vacío.
--   Los avisos viajan en `meta.avisos` de la respuesta de /disponibilidad.
--
-- QUÉ PASA CON LAS COLUMNAS ANTIGUAS
-- ----------------------------------
-- NO se borran. `ConfiguracionTurnos.tsx` (la pantalla actual) las sigue
-- leyendo y escribiendo y sigue funcionando igual. Quedan como el modo
-- "simple" de dos niveles; la lista es el modo avanzado y tiene prioridad
-- cuando existe. Cuando la pantalla nueva esté hecha se pueden retirar en
-- otra migración.
-- ============================================================


-- ------------------------------------------------------------
-- SECCIÓN A — ESQUEMA
-- ------------------------------------------------------------

-- Validador de la lista. Tiene que ser una función porque un CHECK de
-- Postgres no admite subconsultas (y hay que recorrer el array).
CREATE OR REPLACE FUNCTION public.escalera_niveles_valida(p_niveles jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    p_niveles IS NULL
    OR (
      jsonb_typeof(p_niveles) = 'array'
      AND jsonb_array_length(p_niveles) BETWEEN 1 AND 8
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_niveles) AS nivel
        -- COALESCE porque `jsonb_typeof` de una clave que NO EXISTE devuelve
        -- NULL, y `NULL <> 'number'` es NULL: sin esto, un nivel al que le
        -- falte `umbral` colaría por el CHECK.
        WHERE COALESCE(jsonb_typeof(nivel), '') <> 'object'
           OR COALESCE(jsonb_typeof(nivel -> 'minutos'), '') <> 'number'
           OR (nivel ->> 'minutos')::numeric < 1
           OR (nivel ->> 'minutos')::numeric > 1440
           OR (nivel ->> 'minutos')::numeric <> floor((nivel ->> 'minutos')::numeric)
           OR COALESCE(jsonb_typeof(nivel -> 'umbral'), '') <> 'number'
           OR (nivel ->> 'umbral')::numeric < 0
           OR (nivel ->> 'umbral')::numeric > 100
      )
      -- Sin escalones repetidos: dos niveles con el mismo paso no
      -- significan nada (el motor los deduplicaría de todas formas).
      AND (
        SELECT count(DISTINCT (nivel ->> 'minutos'))
        FROM jsonb_array_elements(p_niveles) AS nivel
      ) = jsonb_array_length(p_niveles)
    );
$$;

COMMENT ON FUNCTION public.escalera_niveles_valida(jsonb) IS
  'Valida la forma de configuracion_turnos.niveles_escalera: array de 1..8 objetos {minutos:int 1..1440, umbral:number 0..100}, sin pasos repetidos.';

ALTER TABLE public.configuracion_turnos
  ADD COLUMN IF NOT EXISTS niveles_escalera jsonb,
  ADD COLUMN IF NOT EXISTS ocultar_nivel_anterior boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_umbral text NOT NULL DEFAULT 'reparto_nivel_base';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.configuracion_turnos'::regclass
      AND conname = 'configuracion_turnos_base_umbral_valida'
  ) THEN
    ALTER TABLE public.configuracion_turnos
      ADD CONSTRAINT configuracion_turnos_base_umbral_valida
      CHECK (base_umbral IN ('aforo_total', 'reparto_nivel_base'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.configuracion_turnos'::regclass
      AND conname = 'configuracion_turnos_niveles_escalera_valida'
  ) THEN
    ALTER TABLE public.configuracion_turnos
      ADD CONSTRAINT configuracion_turnos_niveles_escalera_valida
      CHECK (public.escalera_niveles_valida(niveles_escalera));
  END IF;
END $$;

COMMENT ON COLUMN public.configuracion_turnos.niveles_escalera IS
  'Escalera de horas ofrecidas, de grueso a fino: [{"minutos":60,"umbral":0},{"minutos":30,"umbral":70},{"minutos":15,"umbral":85}]. minutos = paso anclado a medianoche; umbral = % de ocupacion del hueco anterior para abrir este nivel. NULL = derivar de intervalo_base_minutos/umbral_apertura_secundario.';

COMMENT ON COLUMN public.configuracion_turnos.ocultar_nivel_anterior IS
  'Si al abrirse un nivel el anterior deja de ofrecerse. Generaliza ocultar_primario_si_secundario.';

COMMENT ON COLUMN public.configuracion_turnos.base_umbral IS
  'Sobre que se mide el % que abre un escalon. aforo_total = comensales de esa hora / aforo del restaurante (comportamiento historico). reparto_nivel_base = comensales de esa hora / (aforo repartido entre las horas del nivel mas grueso del periodo).';


-- ------------------------------------------------------------
-- SECCIÓN A.bis — *** CAMBIO DE DATOS EN PRODUCCIÓN *** REVISAR
-- ------------------------------------------------------------
-- DECISIÓN TOMADA POR EL DUEÑO: los umbrales se miden en modo
-- `reparto_nivel_base`, no contra el aforo entero.
--
-- El porqué, con sus propios datos: el día más lleno que existe
-- (16/02/2026, 50 reservas y 200 comensales) tuvo el turno de comida al
-- 66%, pero su hora punta fueron 17 comensales — un 11% de las 150
-- plazas. Midiendo contra el aforo entero harían falta 105 personas a la
-- misma hora para abrir la media, así que la escalera no se movía nunca.
--
-- Con el reparto, la comida (13:00-16:00 = tres horas en punto) reparte
-- 150 / 3 = 50 plazas por hora. Esos mismos 17 comensales pasan a ser el
-- 34%, la media se abre con 35 personas a la misma hora y los cuartos con
-- 43. Son cifras que de verdad ocurren en su restaurante.
--
-- `aforo_total` SIGUE SIENDO ELEGIBLE desde la configuración (lo permite
-- el CHECK de arriba) por si algún día cambia la distribución de sala;
-- simplemente hay que pedirlo a propósito.

UPDATE public.configuracion_turnos
   SET base_umbral = 'reparto_nivel_base'
 WHERE base_umbral IS DISTINCT FROM 'reparto_nivel_base';


-- SECCIÓN B — *** CAMBIO DE DATOS EN PRODUCCIÓN *** REVISAR
-- ------------------------------------------------------------
-- Esto NO es un cambio de esquema: toca las dos filas reales (Comida y
-- Cena) y cambia lo que ven los clientes en la web. Va aparte a propósito.
--
-- B.1 — El umbral del segundo nivel pasa de 40% a 70%.
--       Producción tiene 40 en los dos turnos; el formulario del panel
--       propone 70 por defecto. Se unifica en 70, que es el valor que
--       manda el dueño. Efecto: las medias (13:30, 14:30…) se abren más
--       tarde que hoy, cuando la hora entera va por el 70% en vez del 40%.
--
-- B.2 — El default de la columna también pasa a 70, para que un turno
--       nuevo creado desde la pantalla vieja nazca coherente.
--
-- B.3 — Se activa el TERCER nivel (los cuartos: 13:15, 13:45…) al 85%.
--       Por qué 85: tiene que ser más alto que el del segundo (se abre
--       después) y 85 es el punto medio entre el 70 del segundo y el 100
--       del aforo lleno; es el último tramo, cuando repartir de cuarto en
--       cuarto es la única forma de seguir entrando gente.
--       Si el dueño prefiere quedarse en dos niveles, basta con borrar el
--       tercer elemento del array de abajo. No hay que tocar nada más.

ALTER TABLE public.configuracion_turnos
  ALTER COLUMN umbral_apertura_secundario SET DEFAULT 70;   -- B.2

UPDATE public.configuracion_turnos
   SET umbral_apertura_secundario = 70                       -- B.1
 WHERE umbral_apertura_secundario = 40;


-- ------------------------------------------------------------
-- SECCIÓN C — BACKFILL DE LA LISTA
-- ------------------------------------------------------------
-- Traduce lo que ya había (ya con el 70 de la sección B) a la forma nueva,
-- y añade el tercer escalón. Solo toca filas donde la lista aún es NULL,
-- así que es idempotente y no pisa nada configurado a mano.

UPDATE public.configuracion_turnos
   SET niveles_escalera = (
         SELECT jsonb_agg(nivel ORDER BY (nivel ->> 'minutos')::int DESC)
         FROM (
           SELECT jsonb_build_object('minutos', 60, 'umbral', 0) AS nivel
           UNION ALL
           SELECT jsonb_build_object(
                    'minutos', LEAST(GREATEST(intervalo_base_minutos, 1), 59),
                    'umbral',  LEAST(GREATEST(umbral_apertura_secundario, 0), 100)
                  )
           WHERE intervalo_base_minutos BETWEEN 1 AND 59
           UNION ALL
           -- B.3: tercer nivel. Quitar este bloque para quedarse en dos.
           SELECT jsonb_build_object('minutos', 15, 'umbral', 85)
           WHERE intervalo_base_minutos <> 15
         ) AS niveles
       ),
       ocultar_nivel_anterior = COALESCE(ocultar_primario_si_secundario, false)
 WHERE niveles_escalera IS NULL;


-- ------------------------------------------------------------
-- COMPROBACIÓN (solo lectura — ejecutar a mano tras aplicar)
-- ------------------------------------------------------------
-- SELECT nombre_periodo, hora_inicio, hora_fin,
--        intervalo_base_minutos, umbral_apertura_secundario,
--        niveles_escalera, ocultar_nivel_anterior
--   FROM public.configuracion_turnos
--  ORDER BY hora_inicio;
--
-- Esperado para Comida y Cena:
--   umbral_apertura_secundario = 70
--   niveles_escalera = [{"minutos":60,"umbral":0},
--                       {"minutos":30,"umbral":70},
--                       {"minutos":15,"umbral":85}]
--   ocultar_nivel_anterior = false
--   base_umbral = 'reparto_nivel_base'
--
-- Y lo que verá el cliente en la web con esa configuración (150 plazas,
-- tres horas en punto por turno -> 50 plazas por hora):
--   * de 0 a 34 personas a una misma hora -> solo horas en punto
--   * a partir de 35 a esa hora           -> aparece su media (13:30)
--   * a partir de 43 a esa hora           -> aparece su cuarto (13:15)
