set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- =============================================================================
-- NO APLICADA: la aplica el dueño a mano.
-- OPCIONAL: REQUIERE DECISIÓN DEL DUEÑO (sigue abierta desde el 01/10/2026; se
-- le recomendó borrar). Si decide NO borrar, no hace falta nada más: son datos
-- de demostración, el panel ya no los enseña (commit «refactor(reservas): el
-- panel deja de gestionar reservas de Touza (solo Casa Tomas)») y el cron de la campana
-- nunca avisa de ellos (llevan [DEMO-SEED]).
-- CIERRE DE RESERVAS DE TOUZA (fase de datos) · 02 · BORRAR LAS 5 RESERVAS DEMO DE TOUZA
-- =============================================================================
-- Borra SOLO estas 5 reservas, por id, y sus 2 sugerencias de lista negra.
-- Se deshace con 20261002_touza_cierre_02_borrar_reservas_demo_ROLLBACK.sql,
-- que las devuelve EXACTAMENTE como estaban el 02/10/2026 (mismos ids, todas las
-- columnas, created_at/updated_at incluidos; comprobado con huella md5). Lo único
-- que no vuelve idéntico es ocupacion_diaria, dato derivado: el trigger la
-- recalcula con los mismos contadores, pero 2 filas renacen con id nuevo.
-- Ese ROLLBACK exige que Touza tenga aforo: si el 01 está aplicado, antes va el
-- ROLLBACK del 01.
--
-- PASOS, EN ORDEN (desde adminpanelct/, una orden por línea; ver
-- 20261002_touza_cierre_LEEME.md):
--   1. Haber desplegado reservas-web y aplicado el script 01 (no es técnicamente
--      obligatorio para este, pero es el orden previsto).
--   2. ESTE script:
--        npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_02_borrar_reservas_demo.sql
--   3. Comprobar:
--        npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--
-- QUÉ SE BORRA (hechos comprobados con SELECT el 02/10/2026 a las 16:30):
--   Las 5 son las ÚNICAS reservas de Touza; marca 'touza', todas en El Reservado
--   (1c976f78…), creadas en el lote demo del 25/09 (created_at
--   2026-09-25 13:41:38.955293+00 = 15:41 en Madrid; ese lote tiene 265 filas,
--   las otras 260 son de Casa Tomás y NO se tocan), con la nota empezando por
--   [DEMO-SEED], teléfono del generador (600000NNN) y email nulo o @example.com.
--     9e98145c-c431-4a00-bb84-917cd77366cd  completada  13/09 22:00  3 pax
--     79fc0033-8c3d-4b3e-bba3-44fc6ea89352  no_show     23/09 15:00  3 pax
--     e25c16b8-62c2-40c6-868e-10f07ab26853  pendiente   26/09 22:00  2 pax  (viva)
--     94693d95-bdbc-4ae0-aebd-44707d3e2787  no_show     01/10 22:00  6 pax  (era confirmada;
--                                           la pasó a no_show el cron de ausencias el 02/10 04:00 UTC)
--     8bea9054-9cb5-4a39-a597-bcb2b167cd7f  verificada  02/10 14:30  2 pax  (viva)
--   Hijas: 2 filas de sugerencias_blacklist que el cron de ausencias creó al
--   marcar los no_show (d4738198… de 79fc0033, 26/09; ab8a0353… de 94693d95,
--   02/10), pendientes, sin revisar y sin alta en blacklist. Hoy salen en la
--   pestaña Blacklist del panel como sugerencias con teléfono de demo: con
--   esto desaparecen. Se borran explícitamente (si no, se irían igual por la
--   FK ON DELETE CASCADE).
--   0 en todo lo demás: envios_email_reserva, asignaciones_mesa,
--   asignaciones_mesa_descartadas, avisos_reserva_enviados,
--   solicitudes_pendientes.reserva_id y notificaciones_dashboard.referencia_id;
--   reservas.solicitud_id es NULL en las 5.
--
-- EFECTOS SECUNDARIOS (triggers de reservas leídos con pg_get_triggerdef):
--   · Un DELETE solo dispara trigger_actualizar_ocupacion
--     (actualizar_ocupacion_diaria_espacios, AFTER INSERT OR UPDATE OR DELETE):
--     recalcula public.ocupacion_diaria (dato derivado, sin marca) para cada
--     fecha+hora. 13/09 22:00 y 23/09 15:00 se quedan sin reservas y su fila se
--     BORRA; 26/09 22:00, 01/10 22:00 y 02/10 14:30 se recalculan con una reserva
--     menos (las de Casa Tomás de esas franjas siguen contando). Aceptable.
--   · Ningún trigger de DELETE manda correos, llama por HTTP ni toca la
--     newsletter: el resto de triggers de reservas son de INSERT o de UPDATE.
--     No hay RULEs.
--   · Realtime: HOY (02/10/2026) la publicación supabase_realtime tiene 4 tablas
--     y ninguna de las de aquí. Deja de ser así en cuanto se aplique la migración
--     20261001200000 (publica reservas, solicitudes_pendientes,
--     notificaciones_dashboard y asignaciones_mesa, con REPLICA IDENTITY por
--     defecto): a partir de entonces el DELETE de este script emitirá 5 eventos
--     DELETE de reservas, solo con el `id`, que también ve cualquiera suscrito
--     con la clave pública anon (son reservas demo: inofensivo), y el UPDATE
--     del script 03 llegará en vivo a la campana del panel.
--   · FKs hacia reservas: sugerencias_blacklist, asignaciones_mesa,
--     envios_email_reserva y avisos_reserva_enviados ON DELETE CASCADE;
--     solicitudes_pendientes.reserva_id ON DELETE SET NULL (todas con 0 filas
--     salvo las 2 sugerencias, que se borran antes a mano).
--   · RLS no aplica: postgres es dueño de las tablas y tiene BYPASSRLS.
--   · Cron de la campana (fn_avisar_reservas_sin_asignar): estas 5 nunca le
--     contaron ([DEMO-SEED]); tras borrarlas Touza se queda con 0 reservas.
--   OJO: el viejo cleanup_demo_data.sql (LIKE '[DEMO-SEED]%') también borraría
--   estas 5, junto con el resto de reservas demo de Casa Tomás.
--
-- PRE-COMPROBACIONES (si alguna falla, RAISE y no se borra nada):
--   1) existen las 5; son marca touza, del lote (created_at exacto) y [DEMO-SEED];
--   2) su huella md5 (r::text, en UTC) es la del 02/10/2026: nadie las ha tocado
--      desde que se generó el ROLLBACK (si no, el ROLLBACK ya no sería fiel);
--   3) sus sugerencias son exactamente las 2 conocidas y siguen intactas;
--   4) no cuelga de ellas nada más (envíos, mesas, descartadas, avisos,
--      solicitudes, notificaciones).
-- Si la huella no cuadra: regenerar el ROLLBACK con las consultas de su cabecera
-- y actualizar las dos huellas de aquí y de allí, o no borrar.
-- IDEMPOTENTE: si ya no existe ninguna de las 5 ni sus sugerencias, avisa y no
-- borra nada. Un estado intermedio aborta.
-- VERIFICACIÓN dentro de la transacción: no queda ninguna de las 5 ni sus
-- sugerencias, no ha desaparecido ninguna OTRA reserva ni sugerencia
-- (comparando ids con la foto de antes) y ocupacion_diaria no se queda con
-- franjas vacías.
-- lock_timeout de 5 s: un 55P03 significa que no ha borrado nada; reintentar.
-- SALIDA: las 7 filas afectadas con existe_ahora (esperado: false en todas).
-- =============================================================================

begin;
set local lock_timeout = '5s';
-- La huella md5 usa r::text: fijar cómo se escriben fechas y horas.
set local timezone = 'UTC';
set local datestyle = 'ISO, MDY';

-- Foto de ANTES para la verificación final (se borra sola al COMMIT). Por ids,
-- no por totales: una reserva nueva que entre a la vez (web, bot, panel) no
-- debe hacer saltar la verificación.
create temp table _touza_02_reservas_antes on commit drop as
  select id from public.reservas;
create temp table _touza_02_sugerencias_antes on commit drop as
  select id from public.sugerencias_blacklist;

-- 0) Pre-comprobaciones.
do $pre$
declare
  c_ids constant uuid[] := array[
    '79fc0033-8c3d-4b3e-bba3-44fc6ea89352',  -- no_show     23/09 15:00
    '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',  -- verificada  02/10 14:30
    '94693d95-bdbc-4ae0-aebd-44707d3e2787',  -- no_show     01/10 22:00
    '9e98145c-c431-4a00-bb84-917cd77366cd',  -- completada  13/09 22:00
    'e25c16b8-62c2-40c6-868e-10f07ab26853'   -- pendiente   26/09 22:00
  ]::uuid[];
  c_sugerencias constant uuid[] := array[
    'ab8a0353-648c-4088-a123-30a42a8463b9',  -- no-show de 94693d95
    'd4738198-b6cf-456c-b15a-f9241ccf3f3e'   -- no-show de 79fc0033
  ]::uuid[];
  c_lote               constant timestamptz := '2026-09-25 13:41:38.955293+00';
  c_huella_reservas    constant text := '73ae02a768c47fb149ec7d759815d9ec';
  c_huella_sugerencias constant text := '425dea01471d77425695834e2c6c629d';
  v_n       integer;
  v_s       integer;
  v_huella  text;
  v_envios  integer;
  v_asig    integer;
  v_desc    integer;
  v_avisos  integer;
  v_solic   integer;
  v_notif   integer;
begin
  select count(*) into v_n from public.reservas where id = any (c_ids);
  select count(*) into v_s from public.sugerencias_blacklist
   where id = any (c_sugerencias) or reserva_id = any (c_ids);

  -- Idempotencia.
  if v_n = 0 and v_s = 0 then
    raise notice 'Ya aplicado: no queda ninguna de las 5 reservas demo de Touza ni sus sugerencias. No se borra nada.';
    return;
  end if;
  if v_n <> 5 then
    raise exception 'Estado intermedio: existen % de las 5 reservas demo de Touza (y % sugerencias suyas). No se borra nada: revisarlo a mano.',
      v_n, v_s;
  end if;

  -- 1) Lote demo de Touza del 25/09.
  select count(*) into v_n
    from public.reservas
   where id = any (c_ids)
     and marca = 'touza'
     and created_at = c_lote
     and starts_with(coalesce(notas_cliente, ''), '[DEMO-SEED]');
  if v_n <> 5 then
    raise exception 'Solo % de las 5 reservas son marca touza, del lote del 25/09 (created_at %) y con nota [DEMO-SEED]. No se borra nada.',
      v_n, c_lote;
  end if;

  -- 2) Huella: siguen exactamente como el 02/10/2026 (lo que el ROLLBACK restaura).
  select md5(string_agg(r::text, '|' order by r.id)) into v_huella
    from public.reservas r
   where r.id = any (c_ids);
  if v_huella is distinct from c_huella_reservas then
    raise exception 'Las 5 reservas demo han cambiado desde el 02/10/2026 (huella % en vez de %): el ROLLBACK ya no las devolvería tal cual. Regenerarlo (ver su cabecera) o no borrar. No se borra nada.',
      v_huella, c_huella_reservas;
  end if;

  -- 3) Sus sugerencias de lista negra: las 2 conocidas, intactas.
  select count(*), md5(string_agg(s::text, '|' order by s.id))
    into v_s, v_huella
    from public.sugerencias_blacklist s
   where s.reserva_id = any (c_ids);
  if v_s <> 2 or v_huella is distinct from c_huella_sugerencias then
    raise exception 'Las sugerencias de lista negra de estas reservas no son las 2 del 02/10/2026 sin revisar (hay %, huella % en vez de %). Si alguien aprobó una, ya hay en blacklist un teléfono de demo: revisarlo antes. No se borra nada.',
      v_s, v_huella, c_huella_sugerencias;
  end if;

  -- 4) Nada más cuelga de ellas (el ROLLBACK no lo restauraría).
  select count(*) into v_envios from public.envios_email_reserva          where reserva_id = any (c_ids);
  select count(*) into v_asig   from public.asignaciones_mesa             where reserva_id = any (c_ids);
  select count(*) into v_desc   from public.asignaciones_mesa_descartadas where reserva_id = any (c_ids);
  select count(*) into v_avisos from public.avisos_reserva_enviados       where reserva_id = any (c_ids);
  select count(*) into v_solic  from public.solicitudes_pendientes        where reserva_id = any (c_ids);
  select count(*) into v_notif  from public.notificaciones_dashboard      where referencia_id = any (c_ids);
  if v_envios + v_asig + v_desc + v_avisos + v_solic + v_notif > 0 then
    raise exception 'Cuelgan datos de las reservas demo: envios_email_reserva %, asignaciones_mesa %, asignaciones_mesa_descartadas %, avisos_reserva_enviados %, solicitudes_pendientes %, notificaciones_dashboard %. El 02/10/2026 todo era 0 y el ROLLBACK no los devolvería. No se borra nada.',
      v_envios, v_asig, v_desc, v_avisos, v_solic, v_notif;
  end if;
end
$pre$;

-- 1) Hijas, de forma explícita y acotada a esos ids.
delete from public.sugerencias_blacklist
 where id = any (array['ab8a0353-648c-4088-a123-30a42a8463b9', 'd4738198-b6cf-456c-b15a-f9241ccf3f3e']::uuid[])
   and reserva_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                               '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                               'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]);

-- 2) Las 5 reservas (triple cerrojo: id, marca y created_at del lote).
delete from public.reservas
 where id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                       '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                       'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[])
   and marca = 'touza'
   and created_at = '2026-09-25 13:41:38.955293+00';

-- 3) Verificación (dentro de la transacción: si falla, no queda nada borrado).
do $post$
declare
  c_ids constant uuid[] := array[
    '79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
    '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
    'e25c16b8-62c2-40c6-868e-10f07ab26853'
  ]::uuid[];
  c_sugerencias constant uuid[] := array[
    'ab8a0353-648c-4088-a123-30a42a8463b9', 'd4738198-b6cf-456c-b15a-f9241ccf3f3e'
  ]::uuid[];
  v_n integer;
begin
  if exists (select 1 from public.reservas where id = any (c_ids)) then
    raise exception 'VERIFICACIÓN: queda alguna de las 5 reservas demo. Se deshace todo.';
  end if;
  if exists (select 1 from public.sugerencias_blacklist
              where reserva_id = any (c_ids) or id = any (c_sugerencias)) then
    raise exception 'VERIFICACIÓN: queda alguna de sus sugerencias de lista negra. Se deshace todo.';
  end if;

  -- No ha desaparecido ninguna otra reserva ni ninguna otra sugerencia.
  select count(*) into v_n
    from _touza_02_reservas_antes a
   where a.id <> all (c_ids)
     and not exists (select 1 from public.reservas r where r.id = a.id);
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: han desaparecido % reservas que no son las 5 demo. Se deshace todo.', v_n;
  end if;
  select count(*) into v_n
    from _touza_02_sugerencias_antes a
   where a.id <> all (c_sugerencias)
     and not exists (select 1 from public.sugerencias_blacklist s where s.id = a.id);
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: han desaparecido % sugerencias de lista negra que no son las 2 del lote. Se deshace todo.', v_n;
  end if;

  -- Efecto del trigger de ocupación: ninguna de las 5 franjas se queda con una fila sin reservas.
  if exists (select 1
               from public.ocupacion_diaria o
              where (o.fecha, o.hora) in (values ('2026-09-13'::date, '22:00'::time), ('2026-09-23'::date, '15:00'::time),
                                                 ('2026-09-26'::date, '22:00'::time), ('2026-10-01'::date, '22:00'::time),
                                                 ('2026-10-02'::date, '14:30'::time))
                and not exists (select 1 from public.reservas r where r.fecha = o.fecha and r.hora = o.hora)) then
    raise exception 'VERIFICACIÓN: ocupacion_diaria se ha quedado con franjas sin reservas (el trigger no ha recalculado). Se deshace todo.';
  end if;
end
$post$;

commit;

-- 4) Salida (solo lectura). Esperado: existe_ahora = false en las 7 filas y
--    reservas_touza_ahora = 0.
select v.tipo,
       v.id,
       v.descripcion,
       case v.tipo
         when 'reserva' then exists (select 1 from public.reservas r where r.id = v.id)
         else exists (select 1 from public.sugerencias_blacklist s where s.id = v.id)
       end                                                            as existe_ahora,
       (select count(*) from public.reservas where marca = 'touza')   as reservas_touza_ahora
  from (values
    ('reserva',    '9e98145c-c431-4a00-bb84-917cd77366cd'::uuid, 'completada 13/09 22:00, 3 pax'),
    ('reserva',    '79fc0033-8c3d-4b3e-bba3-44fc6ea89352'::uuid, 'no_show 23/09 15:00, 3 pax'),
    ('reserva',    'e25c16b8-62c2-40c6-868e-10f07ab26853'::uuid, 'pendiente 26/09 22:00, 2 pax'),
    ('reserva',    '94693d95-bdbc-4ae0-aebd-44707d3e2787'::uuid, 'no_show 01/10 22:00, 6 pax'),
    ('reserva',    '8bea9054-9cb5-4a39-a597-bcb2b167cd7f'::uuid, 'verificada 02/10 14:30, 2 pax'),
    ('sugerencia', 'd4738198-b6cf-456c-b15a-f9241ccf3f3e'::uuid, 'lista negra: no-show de 79fc0033 (26/09)'),
    ('sugerencia', 'ab8a0353-648c-4088-a123-30a42a8463b9'::uuid, 'lista negra: no-show de 94693d95 (02/10)')
  ) as v (tipo, id, descripcion)
 order by v.tipo, v.descripcion;
