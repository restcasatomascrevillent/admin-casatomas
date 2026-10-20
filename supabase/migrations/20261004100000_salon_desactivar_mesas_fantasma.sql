set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios y nombres con tilde; psql en una
-- consola de Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Salón de Casa Tomás: desactiva las dos mesas «fantasma» «9» y «11»  ##
-- ##   y renombra «9 (revisar)» a «9». Sustituye a la migración            ##
-- ##   20261003100000_salon_mesas_en_metros (descartada, nunca aplicada).  ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (decisión del dueño, 04/10/2026)
--   El plano del Salón está montado en el editor con 13 mesas. En la tabla
--   había 15 activas: «9» y «11» (redondas de 6 plazas, 150 cm) tenían
--   pos_x/pos_y en PÍXELES (239.26, 100.17) y (349.07, 135.79); el editor las
--   lee en metros y las dibuja a cientos de metros, así que no se ven, pero
--   sumaban 12 plazas a las cuentas de mesas del Salón. Ninguna reserva las
--   usa (0 filas en asignaciones_mesa). El dueño confirma que la mesa pequeña
--   «9 (revisar)» es la 9 real.
--
-- QUÉ CAMBIA
--   · «9»  (3a98ace3-…) y «11» (08e9ae3d-…): activa = false. No se borran: el
--     rollback las devuelve. El índice único uq_mesas_espacio_nombre_real es
--     parcial sobre activa = true, así que el número 9 queda libre.
--   · «9 (revisar)» (2d66d706-…) pasa a llamarse «9».
--   · Nada más: ni posiciones, ni plazas, ni otras mesas, ni asignaciones.
--     «10» y «11+10», «12» y «13+12» se quedan como están (decisión del dueño).
--
-- PASOS (desde adminpanelct/, o pegándola en el SQL Editor de Supabase)
--   1. npx supabase db query --linked -f supabase/migrations/20261004100000_salon_desactivar_mesas_fantasma.sql
--      Tiene que imprimir «salon_desactivar_mesas_fantasma: aplicada | 13 | 52».
--   2. npx supabase db query --linked -f supabase/tests/salon_desactivar_mesas_fantasma_test.sql
--   Deshacer: supabase/rollbacks/20261004100000_salon_desactivar_mesas_fantasma_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  c_salon     constant uuid := 'db8be4e2-2e67-4110-99b1-9e1d779514cc';
  c_fantasma9  constant uuid := '3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7';
  c_fantasma11 constant uuid := '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77';
  c_revisar    constant uuid := '2d66d706-9426-4daf-b7ef-9af36e1a6eb5';
  n integer;
begin
  -- Ya aplicada: no hace nada.
  if not exists (select 1 from public.mesas where id in (c_fantasma9, c_fantasma11) and coalesce(activa, true))
     and exists (select 1 from public.mesas where id = c_revisar and nombre = '9') then
    raise notice 'Ya aplicada: no se cambia nada.';
    return;
  end if;

  -- Comprobaciones previas: el estado tiene que ser el verificado el 04/10/2026.
  select count(*) into n from public.mesas
   where id = c_fantasma9 and espacio_id = c_salon and nombre = '9'
     and coalesce(activa, true) and pos_x = 239.26 and pos_y = 100.17;
  if n <> 1 then raise exception 'MIGRACIÓN ABORTADA: la mesa «9» fantasma no está como se esperaba. No se ha cambiado nada.'; end if;

  select count(*) into n from public.mesas
   where id = c_fantasma11 and espacio_id = c_salon and nombre = '11'
     and coalesce(activa, true) and pos_x = 349.07 and pos_y = 135.79;
  if n <> 1 then raise exception 'MIGRACIÓN ABORTADA: la mesa «11» fantasma no está como se esperaba. No se ha cambiado nada.'; end if;

  select count(*) into n from public.mesas
   where id = c_revisar and espacio_id = c_salon and nombre = '9 (revisar)' and coalesce(activa, true);
  if n <> 1 then raise exception 'MIGRACIÓN ABORTADA: la mesa «9 (revisar)» no está como se esperaba. No se ha cambiado nada.'; end if;

  select count(*) into n from public.asignaciones_mesa where mesa_id in (c_fantasma9, c_fantasma11);
  if n <> 0 then raise exception 'MIGRACIÓN ABORTADA: hay % asignaciones de reservas en «9» u «11» fantasma. No se ha cambiado nada.', n; end if;

  -- 1. Desactivar las fantasmas (antes del renombrado: libera el número 9).
  update public.mesas set activa = false where id in (c_fantasma9, c_fantasma11);
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'MIGRACIÓN ABORTADA: se desactivaron % mesas (esperaba 2).', n; end if;

  -- 2. «9 (revisar)» -> «9».
  update public.mesas set nombre = '9' where id = c_revisar;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'MIGRACIÓN ABORTADA: se renombraron % mesas (esperaba 1).', n; end if;

  -- 3. Comprobación final: 13 mesas activas y no fusionadas, 52 plazas.
  select count(*) into n from public.mesas
   where espacio_id = c_salon and coalesce(activa, true) and not coalesce(is_merged, false);
  if n <> 13 then raise exception 'MIGRACIÓN ABORTADA: el Salón queda con % mesas activas (esperaba 13).', n; end if;
end;
$$;

commit;

-- Verificación (solo lectura): tiene que salir «aplicada | 13 | 52».
select 'salon_desactivar_mesas_fantasma: aplicada' as resultado,
       count(*) as mesas_activas,
       sum(capacidad) as plazas
  from public.mesas
 where espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'
   and coalesce(activa, true) and not coalesce(is_merged, false);
