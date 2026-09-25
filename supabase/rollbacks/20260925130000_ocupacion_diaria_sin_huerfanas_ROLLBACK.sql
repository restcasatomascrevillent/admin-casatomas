-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260925130000_ocupacion_diaria_sin_huerfanas.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md sobre por que
-- viven aqui separados). Se ejecuta a mano (psql / SQL editor) y solo para
-- deshacer un despliegue que salio mal.
--
-- QUE REVIERTE Y QUE NO
--   SI revierte: el cuerpo de la funcion
--   `actualizar_ocupacion_diaria_espacios()`. Deja exactamente el cuerpo que
--   estaba vigente en produccion antes de la migracion (capturado en vivo
--   con pg_get_functiondef el 2026-09-25, mismo que dejo
--   20260216064149_2ffdf62a-d630-456a-8093-6ba747c257e1.sql) -- vuelve a
--   depender de GROUP BY para recalcular y por tanto reaparece el bug de
--   las filas huerfanas al borrar la ultima reserva de un fecha+hora.
--
--   NO revierte: el PASO 2 de la migracion (el DELETE de las 738 filas
--   huerfanas). Esas filas no se guardaron en ningun sitio antes de
--   borrarlas -- no hay snapshot que restaurar. Esto es intencionado, no un
--   descuido: cada una de esas filas describia reservas que ya no existen
--   en `reservas` (confirmado con NOT EXISTS antes de borrar; ver la
--   cabecera de la migracion), asi que no hay ningun dato valido que
--   reponer. "Revertir" su borrado significaria reinsertar cifras que no
--   corresponden a ninguna reserva real -- exactamente el problema que la
--   migracion corrige. Si tras aplicar la migracion aparece un motivo para
--   creer que alguna fila borrada SI hacia falta, la unica via honesta es
--   recalcularla desde `reservas` con
--   `select public.recalcular_ocupacion_historica(fecha_desde, fecha_hasta)`
--   (funcion ya existente, creada en 20260116172011), no fabricar un valor.
--
-- CUANDO USAR ESTO
--   Solo si el cuerpo nuevo de la funcion causa un error o un valor
--   incorrecto en produccion que no se puede resolver de otra forma. La
--   limpieza de huerfanas (PASO 2) no es reversible ni falta que le hace
--   serlo: no tiene efecto sobre ninguna reserva viva, solo sobre filas que
--   ya no representaban nada.
--
-- ---------------------------------------------------------------------------

begin;

CREATE OR REPLACE FUNCTION public.actualizar_ocupacion_diaria_espacios()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_fecha date; v_hora time;
BEGIN
  IF TG_OP = 'DELETE' THEN v_fecha := OLD.fecha; v_hora := OLD.hora;
  ELSE v_fecha := NEW.fecha; v_hora := NEW.hora; END IF;

  INSERT INTO public.ocupacion_diaria (fecha, hora, total_comensales, total_reservas,
    reservas_confirmadas, reservas_canceladas, reservas_no_show, comensales_confirmados, dia_semana, turno)
  SELECT r.fecha, r.hora, COALESCE(SUM(r.numero_comensales), 0), COUNT(*),
    COUNT(*) FILTER (WHERE r.estado = 'confirmada'), COUNT(*) FILTER (WHERE r.estado = 'cancelada'),
    COUNT(*) FILTER (WHERE r.estado = 'no_show'),
    COALESCE(SUM(r.numero_comensales) FILTER (WHERE r.estado = 'confirmada'), 0),
    EXTRACT(DOW FROM r.fecha)::integer, CASE WHEN r.hora < '16:00' THEN 'comida' ELSE 'cena' END
  FROM public.reservas r WHERE r.fecha = v_fecha AND r.hora = v_hora
  GROUP BY r.fecha, r.hora
  ON CONFLICT (fecha, hora) DO UPDATE SET
    total_comensales = EXCLUDED.total_comensales, total_reservas = EXCLUDED.total_reservas,
    reservas_confirmadas = EXCLUDED.reservas_confirmadas, reservas_canceladas = EXCLUDED.reservas_canceladas,
    reservas_no_show = EXCLUDED.reservas_no_show, comensales_confirmados = EXCLUDED.comensales_confirmados,
    dia_semana = EXCLUDED.dia_semana, turno = EXCLUDED.turno, updated_at = now();

  DELETE FROM public.ocupacion_diaria WHERE fecha = v_fecha AND hora = v_hora AND total_reservas = 0;
  RETURN COALESCE(NEW, OLD);
END; $function$;

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACION -- ejecutar despues de este rollback:
--
-- select pg_get_functiondef(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'actualizar_ocupacion_diaria_espacios';
--
-- Debe volver a mostrar "GROUP BY r.fecha, r.hora" y el DELETE final
-- "WHERE ... AND total_reservas = 0" -- el estado exacto de antes de
-- 20260925130000.
-- ---------------------------------------------------------------------------
