set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- Comprobaciones del CIERRE DE RESERVAS DE TOUZA (fase de datos)
-- supabase/seeds/20261002_touza_cierre_0{1,2,3}_*.sql
-- ---------------------------------------------------------------------------
-- SOLO LECTURA. No escribe nada: la parte con pre-condiciones va dentro de
-- BEGIN … SET TRANSACTION READ ONLY … ROLLBACK, y la tabla del final es un
-- SELECT. No lee ni depende de ningún SET hecho antes.
--
-- CUÁNDO: antes de empezar y después de CADA script (01, 02, 03) y de cada
-- ROLLBACK. Se puede repetir cuantas veces se quiera.
-- CÓMO (desde adminpanelct/):
--   npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--
-- QUÉ DEVUELVE: una fila por comprobación con el valor de AHORA, el esperado
-- ANTES y DESPUÉS de su script, y `ok` según la fase que detecta sola (01
-- aplicado ⇔ 0 salas de Touza activas; 02 aplicado ⇔ no queda ninguna de las
-- 5 reservas demo; 04 aplicado ⇔ no queda ninguna sala con marca touza). La fila 99 cuenta las `ok = false`: tiene que dar 0.
-- `ok` vacío = fila informativa. El 03 no deja huella, así que su fila (18,
-- avisos de Touza sin leer) es informativa: antes del 03 puede no ser 0 (justo
-- el caso para el que existe el 03) sin que nada vaya mal, y por eso no tiene
-- valor esperado «antes» ni cuenta en el RESUMEN; después de aplicar el 03
-- tiene que dar 0 (su propia verificación ya lo exige).
-- Si en vez de la tabla sale un ERROR «FALLO: …», hay un estado a medias
-- (p. ej. 1 o 2 salas de Touza activas, o 1-4 de las 5 reservas): parar y
-- revisar antes de seguir.
--
-- VALORES ESPERADOS (comprobados con SELECT el 02/10/2026 a las 16:30; los de
-- Casa Tomás suponen que nadie cambia sus salas entretanto):
--                                                     antes      tras su script
--   04  salas con marca touza (total)                   3          0  (las borra la migración
--                                                                    20261003120000; sin ella, 3)
--   01  salas de Touza activas                          3          0
--   01  aforo activo de Touza                          80          0
--   01  aforo activo total (los 2 bots de origin/main) 250       170
--   -   salas activas / aforo de Casa Tomás          4 / 170    4 / 170
--   -   reservas de Casa Tomás en salas de Touza        0          0
--   -   dependencias de las salas de Touza              0          0
--   02  reservas de Touza (todas)                       5          0
--   02  reservas del lote demo (5 ids)                  5          0
--   02  huella del lote = la del 02/10/2026            sí         n/a
--   02  reservas de Touza vivas                         2          0
--   -   reservas de Touza vivas que NO son demo         0          0
--   02  sugerencias de lista negra del lote             2          0
--   02  datos colgando del lote (envíos, mesas…)        0          0
--   02  filas de ocupacion_diaria en las 5 franjas      5          3  (ver comentario de la fila 16)
--   -   filas huérfanas de ocupacion_diaria             0          0
--   03  avisos de Touza sin leer                        -          0  (informativa: ok vacío)
-- La huella usa r::text: solo es comparable con TimeZone = UTC y DateStyle ISO
-- (los de serie de `db query`); si no, sale «no comprobable».
-- ===========================================================================

begin;
set transaction read only;

-- Pre-condiciones duras: estados a medias que ningún script deja.
do $precondiciones$
declare
  c_salas constant uuid[] := array[
    '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12', '1c976f78-0bd7-4d10-b7bf-5208c910d16d',
    '1d268991-ab58-49c6-b70e-10d9533595a7'
  ]::uuid[];
  c_lote constant uuid[] := array[
    '79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
    '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
    'e25c16b8-62c2-40c6-868e-10f07ab26853'
  ]::uuid[];
  v_salas   uuid[];
  v_activas integer;
  v_lote    integer;
  v_sug     integer;
begin
  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[]) into v_salas
    from public.espacios_reserva e
   where e.caracteristicas->>'marca' = 'touza';
  -- Las 3 esperadas, o ninguna (04 aplicado: migración 20261003120000 las borra).
  if v_salas <> '{}'::uuid[] and v_salas is distinct from c_salas then
    raise exception 'FALLO: las salas con marca touza no son las 3 esperadas ni ninguna (%).', v_salas;
  end if;

  select count(*) into v_activas
    from public.espacios_reserva
   where id = any (c_salas) and activa is true;
  if v_activas not in (0, 3) then
    raise exception 'FALLO: hay % de las 3 salas de Touza activas (3 antes del 01, 0 después).', v_activas;
  end if;

  select count(*) into v_lote from public.reservas where id = any (c_lote);
  if v_lote not in (0, 5) then
    raise exception 'FALLO: existen % de las 5 reservas demo de Touza (5 antes del 02, 0 después).', v_lote;
  end if;

  select count(*) into v_sug from public.sugerencias_blacklist where reserva_id = any (c_lote);
  if v_sug not in (0, 2) then
    raise exception 'FALLO: hay % sugerencias de lista negra del lote demo (2 antes del 02, 0 después).', v_sug;
  end if;
end
$precondiciones$;

rollback;

-- Tabla de comprobaciones (solo lectura).
with m as (
  select
    (select count(*) from public.espacios_reserva
      where caracteristicas->>'marca' = 'touza')                                          as salas_touza,
    (select count(*) from public.espacios_reserva
      where caracteristicas->>'marca' = 'touza' and activa is true)                       as salas_touza_activas,
    (select coalesce(sum(capacidad_maxima), 0) from public.espacios_reserva
      where caracteristicas->>'marca' = 'touza' and activa is true)                       as aforo_touza,
    (select coalesce(sum(capacidad_maxima), 0) from public.espacios_reserva
      where activa is true)                                                               as aforo_total,
    (select count(*) from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas' and activa is true) as salas_ct_activas,
    (select coalesce(sum(capacidad_maxima), 0) from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas' and activa is true) as aforo_ct,
    (select count(*) from public.reservas r
       join public.espacios_reserva e on e.id = r.espacio_id
      where e.caracteristicas->>'marca' = 'touza' and r.marca <> 'touza')                 as ct_en_salas_touza,
    (select count(*) from public.mesas x join public.espacios_reserva e on e.id = x.espacio_id
      where e.caracteristicas->>'marca' = 'touza')
    + (select count(*) from public.planos_espacio x join public.espacios_reserva e on e.id = x.espacio_id
      where e.caracteristicas->>'marca' = 'touza')
    + (select count(*) from public.configuracion_turnos x join public.espacios_reserva e on e.id = x.espacio_id
      where e.caracteristicas->>'marca' = 'touza')
    + (select count(*) from public.asignaciones_mesa x join public.espacios_reserva e on e.id = x.espacio_id
      where e.caracteristicas->>'marca' = 'touza')
    + (select count(*) from public.asignaciones_mesa_descartadas x join public.espacios_reserva e on e.id = x.espacio_id
      where e.caracteristicas->>'marca' = 'touza')
    + (select count(*) from public.solicitudes_pendientes x join public.espacios_reserva e on e.id = x.espacio_propuesto_id
      where e.caracteristicas->>'marca' = 'touza')                                        as dependencias_salas_touza,
    (select count(*) from public.reservas where marca = 'touza')                         as reservas_touza,
    (select count(*) from public.reservas
      where id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                            '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                            'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))           as lote,
    (select md5(string_agg(r::text, '|' order by r.id)) from public.reservas r
      where r.id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                              '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                              'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))         as huella_lote,
    (current_setting('TimeZone') = 'UTC' and starts_with(current_setting('DateStyle'), 'ISO')) as huella_comprobable,
    (select count(*) from public.reservas
      where marca = 'touza' and estado in ('pendiente', 'verificada', 'confirmada'))      as touza_vivas,
    (select count(*) from public.reservas
      where marca = 'touza' and estado in ('pendiente', 'verificada', 'confirmada')
        and not starts_with(coalesce(notas_cliente, ''), '[DEMO-SEED]'))                 as touza_vivas_no_demo,
    (select count(*) from public.sugerencias_blacklist
      where reserva_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                    '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                    'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[])
         or id = any (array['ab8a0353-648c-4088-a123-30a42a8463b9', 'd4738198-b6cf-456c-b15a-f9241ccf3f3e']::uuid[])) as sugerencias_lote,
    (select count(*) from public.envios_email_reserva x
      where x.reserva_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                      '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                      'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))
    + (select count(*) from public.asignaciones_mesa x
      where x.reserva_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                      '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                      'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))
    + (select count(*) from public.asignaciones_mesa_descartadas x
      where x.reserva_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                      '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                      'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))
    + (select count(*) from public.avisos_reserva_enviados x
      where x.reserva_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                      '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                      'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))
    + (select count(*) from public.solicitudes_pendientes x
      where x.reserva_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                      '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                      'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))
    + (select count(*) from public.notificaciones_dashboard x
      where x.referencia_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                         '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                         'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[]))  as colgando_del_lote,
    (select count(*) from public.ocupacion_diaria o
      where (o.fecha, o.hora) in (values ('2026-09-13'::date, '22:00'::time), ('2026-09-23'::date, '15:00'::time),
                                         ('2026-09-26'::date, '22:00'::time), ('2026-10-01'::date, '22:00'::time),
                                         ('2026-10-02'::date, '14:30'::time)))                as ocupacion_franjas,
    (select count(*) from public.ocupacion_diaria o
      where not exists (select 1 from public.reservas r where r.fecha = o.fecha and r.hora = o.hora)) as ocupacion_huerfana,
    -- Mismos criterios que el script 03.
    (select count(*) from public.notificaciones_dashboard n
      where n.leida = false
        and (   (n.referencia_tipo = 'reserva'
                 and (n.referencia_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                                   '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                                   'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[])
                      or exists (select 1 from public.reservas r where r.id = n.referencia_id and r.marca = 'touza')))
             or (n.referencia_tipo = 'solicitud'
                 and exists (select 1 from public.solicitudes_pendientes s where s.id = n.referencia_id and s.marca = 'touza'))
             or (    (   (n.tipo = 'reserva_sin_asignar' and strpos(coalesce(n.mensaje, ''), ' pers. (Touza): ') > 0)
                      or (n.tipo = 'email_fallido' and right(coalesce(n.titulo, ''), 8) = ' (Touza)'))
                 and not exists (select 1 from public.reservas r
                                  where n.referencia_tipo = 'reserva' and r.id = n.referencia_id and r.marca <> 'touza')
                 and not exists (select 1 from public.solicitudes_pendientes s
                                  where n.referencia_tipo = 'solicitud' and s.id = n.referencia_id and s.marca <> 'touza')))) as avisos_touza_sin_leer,
    (select count(*) from public.notificaciones_dashboard where leida = false)            as avisos_sin_leer,
    (select count(*) from public.notificaciones_dashboard where tipo = 'reserva_sin_asignar') as avisos_sin_asignar,
    (select coalesce(bool_or(active), false) from cron.job
      where jobname = 'reservas-aviso-sin-asignar')                                      as cron_aviso_activo
),
f as (
  select m.*, (m.salas_touza_activas = 0) as s01, (m.lote = 0) as s02, (m.salas_touza = 0) as s04 from m
),
t (n, script, comprobacion, ahora, esperado_antes, esperado_despues) as (
  select 0, '-', 'Fase detectada',
         case when s01 then '01 aplicado' else '01 sin aplicar' end || ' / '
           || case when s02 then '02 aplicado' else '02 sin aplicar' end || ' / '
           || case when s04 then '04 aplicado (salas borradas)' else '04 sin aplicar' end, '-', '-' from f
  union all select 1,  '04', 'Salas con marca touza (total; las borra la migración 20261003120000)', salas_touza::text, '3', '0' from f
  union all select 2,  '01', 'Salas de Touza activas',                           salas_touza_activas::text,  '3',   '0'   from f
  union all select 3,  '01', 'Aforo activo de Touza',                            aforo_touza::text,          '80',  '0'   from f
  union all select 4,  '01', 'Aforo activo total (lo que suma el bot de origin/main)', aforo_total::text,    '250', '170' from f
  union all select 5,  '-',  'Salas activas de Casa Tomás',                      salas_ct_activas::text,     '4',   '4'   from f
  union all select 6,  '-',  'Aforo activo de Casa Tomás',                       aforo_ct::text,             '170', '170' from f
  union all select 7,  '-',  'Reservas de Casa Tomás en salas de Touza (cualquier estado)', ct_en_salas_touza::text, '0', '0' from f
  union all select 8,  '-',  'Mesas, planos, turnos, asignaciones, descartadas y solicitudes en salas de Touza',
                                                                                 dependencias_salas_touza::text, '0', '0' from f
  union all select 9,  '02', 'Reservas de Touza (todas)',                        reservas_touza::text,       '5',   '0'   from f
  union all select 10, '02', 'Reservas del lote demo (5 ids)',                   lote::text,                 '5',   '0'   from f
  union all select 11, '02', 'Huella del lote = la del 02/10/2026 (la exige el 02)',
         case when lote = 0 then 'n/a'
              when not huella_comprobable then 'no comprobable'
              when huella_lote = '73ae02a768c47fb149ec7d759815d9ec' then 'sí'
              else 'no' end,                                                                                     'sí',  'n/a' from f
  union all select 12, '02', 'Reservas de Touza vivas (pendiente/verificada/confirmada)', touza_vivas::text, '2',  '0'   from f
  union all select 13, '-',  'Reservas de Touza vivas que NO son demo',          touza_vivas_no_demo::text,  '0',   '0'   from f
  union all select 14, '02', 'Sugerencias de lista negra del lote',              sugerencias_lote::text,     '2',   '0'   from f
  union all select 15, '02', 'Datos colgando del lote (envíos, mesas, descartadas, avisos, solicitudes, notificaciones)',
                                                                                 colgando_del_lote::text,    '0',   '0'   from f
  -- Fila 16: el 3 de «después» son las franjas 26/09 22:00, 01/10 22:00 y
  -- 02/10 14:30, que conservan reservas de Casa Tomás. Esas 7 reservas (1 + 1 +
  -- 5) son TODAS demo [DEMO-SEED] (lote del 25/09 y demo de octubre): si alguien
  -- lanza el viejo cleanup_demo_data.sql (LIKE '[DEMO-SEED]%'), las franjas se
  -- quedan vacías y esta fila dará un falso ok = false (esperaría 3 y saldrá 0).
  -- La LIMPIEZA de octubre sola no la cambia (deja 1 reserva en 02/10 14:30).
  union all select 16, '02', 'Filas de ocupacion_diaria en las 5 franjas del lote', ocupacion_franjas::text, '5',   '3'   from f
  union all select 17, '-',  'Filas de ocupacion_diaria sin ninguna reserva (huérfanas)', ocupacion_huerfana::text, '0', '0' from f
  -- Fila 18: sin valor esperado «antes» ('-'), así que es informativa (ok vacío)
  -- y no cuenta en el RESUMEN; tras el 03 tiene que dar 0.
  union all select 18, '03', 'Avisos de Touza sin leer (criterios del 03)',      avisos_touza_sin_leer::text, '-',  '0'   from f
  union all select 19, '-',  'Avisos sin leer en total (informativo)',           avisos_sin_leer::text,      '-',   '-'   from f
  union all select 20, '-',  'Avisos reserva_sin_asignar en total (informativo)', avisos_sin_asignar::text,  '-',   '-'   from f
  union all select 21, '-',  'Job reservas-aviso-sin-asignar activo (informativo)',
         case when cron_aviso_activo then 'sí' else 'no' end,                                                    '-',   '-'   from f
),
r as (
  select t.n, t.script, t.comprobacion, t.ahora, t.esperado_antes, t.esperado_despues,
         case
           when t.esperado_antes = '-' then null
           else t.ahora = case t.script
                            when '01' then case when f.s01 then t.esperado_despues else t.esperado_antes end
                            when '02' then case when f.s02 then t.esperado_despues else t.esperado_antes end
                            when '04' then case when f.s04 then t.esperado_despues else t.esperado_antes end
                            else t.esperado_antes
                          end
         end as ok
    from t cross join f
)
select n, script, comprobacion, ahora, esperado_antes, esperado_despues, ok from r
union all
select 99, '-', 'RESUMEN: comprobaciones con ok = false (tiene que ser 0)',
       (count(*) filter (where ok is false))::text, '0', '0', count(*) filter (where ok is false) = 0
  from r
 order by 1;
