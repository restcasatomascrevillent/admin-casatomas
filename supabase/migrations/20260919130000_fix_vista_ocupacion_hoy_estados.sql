-- =====================================================================
-- Corregir vista_ocupacion_hoy: dejar de contar reservas canceladas
-- Proyecto Supabase: jeamoczmbfsnwkfjxcyo
-- Generada: 2026-09-19T13:00:00
--
-- CONTEXTO
--   El repositorio contenia SIETE definiciones distintas de
--   `vista_ocupacion_hoy` en tres meses, y ninguna coincidia con la
--   vista realmente desplegada: alguien la edito a mano en produccion.
--   La version desplegada (verificada con pg_get_viewdef el 2026-09-19)
--   agregaba sobre TODAS las reservas del dia sin filtrar por estado:
--
--     SELECT count(*)                       AS total_reservas,
--            sum(numero_comensales)         AS total_comensales,
--            count(*) FILTER (confirmada)   AS reservas_confirmadas,
--            count(*) FILTER (pendiente)    AS reservas_pendientes,
--            count(*) FILTER (cancelada)    AS reservas_canceladas,
--            sum(...)  FILTER (confirmada)  AS comensales_confirmados
--       FROM reservas WHERE fecha = CURRENT_DATE;
--
--   Consecuencia: las tarjetas "Reservas Hoy", "Comensales Esperados" y
--   "Ocupacion" del panel sumaban tambien las reservas CANCELADAS, asi
--   que el restaurante veia mas gente de la que iba a venir.
--
-- QUE HACE ESTA MIGRACION
--   1. Versiona la vista (hasta hoy no estaba en ninguna migracion).
--   2. Anade columnas para el conjunto ACTIVO de reservas, usando el
--      mismo criterio que el trigger `trg_validar_capacidad`
--      (funcion `validar_capacidad_reserva`), que considera que ocupan
--      plaza los estados 'pendiente', 'verificada' y 'confirmada'.
--      Asi el panel y el aforo que valida la base de datos cuentan lo
--      mismo.
--   3. Anade los contadores que faltaban (verificada, no_show) para que
--      el panel pueda cuadrar sus cifras sin consultas extra.
--
-- COMPATIBILIDAD
--   Se usa CREATE OR REPLACE (sin DROP) y se conservan las seis columnas
--   existentes con el mismo nombre, tipo y orden; las nuevas se anaden al
--   final. `total_reservas` y `total_comensales` siguen significando
--   "todo lo del dia" — lo que cambia es que el panel pasa a leer las
--   columnas *_activ*.
--
--   Se declara explicitamente WITH (security_invoker = on) porque la vista
--   ya lo tenia (migracion 20260918084909_cerrar_fuga_rls_anonima.sql) y
--   CREATE OR REPLACE sin esa clausula lo perderia, reabriendo la fuga de
--   datos personales al rol anon. NO se tocan grants ni politicas RLS.
--
-- ESTADOS VALIDOS (CHECK reservas_estado_check, verificado en la BD):
--   pendiente | verificada | confirmada | cancelada | completada | no_show
-- =====================================================================

CREATE OR REPLACE VIEW public.vista_ocupacion_hoy
WITH (security_invoker = on)
AS
SELECT
  -- Columnas historicas (se mantienen nombre, tipo y orden)
  COALESCE(count(*), 0::bigint)::integer AS total_reservas,
  COALESCE(sum(numero_comensales), 0::bigint)::integer AS total_comensales,
  count(*) FILTER (WHERE estado::text = 'confirmada'::text)::integer AS reservas_confirmadas,
  count(*) FILTER (WHERE estado::text = 'pendiente'::text)::integer AS reservas_pendientes,
  count(*) FILTER (WHERE estado::text = 'cancelada'::text)::integer AS reservas_canceladas,
  COALESCE(sum(numero_comensales) FILTER (WHERE estado::text = 'confirmada'::text), 0::bigint)::integer AS comensales_confirmados,

  -- Columnas nuevas
  count(*) FILTER (WHERE estado::text = 'verificada'::text)::integer AS reservas_verificadas,
  count(*) FILTER (WHERE estado::text = 'completada'::text)::integer AS reservas_completadas,
  count(*) FILTER (WHERE estado::text = 'no_show'::text)::integer AS reservas_no_show,
  -- Conjunto que SI ocupa plaza (mismo criterio que trg_validar_capacidad)
  count(*) FILTER (
    WHERE estado::text = ANY (ARRAY['pendiente'::text, 'verificada'::text, 'confirmada'::text])
  )::integer AS reservas_activas,
  COALESCE(
    sum(numero_comensales) FILTER (
      WHERE estado::text = ANY (ARRAY['pendiente'::text, 'verificada'::text, 'confirmada'::text])
    ),
    0::bigint
  )::integer AS comensales_activos
FROM public.reservas
WHERE fecha = CURRENT_DATE;

COMMENT ON VIEW public.vista_ocupacion_hoy IS
  'Resumen agregado de las reservas de hoy (una sola fila). Las columnas *_activ* usan el mismo criterio de ocupacion que el trigger trg_validar_capacidad: estados pendiente, verificada y confirmada. total_reservas/total_comensales incluyen TODOS los estados, canceladas incluidas.';
