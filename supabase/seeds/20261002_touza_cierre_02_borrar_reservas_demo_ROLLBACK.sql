set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- =============================================================================
-- NO APLICADA: la aplica el dueño a mano, y SOLO para deshacer
-- 20261002_touza_cierre_02_borrar_reservas_demo.sql.
-- ROLLBACK · 02 · RESTAURAR LAS 5 RESERVAS DEMO DE TOUZA Y SUS 2 SUGERENCIAS
-- =============================================================================
-- Vuelve a insertar, con los MISMOS ids y TODAS sus columnas tal cual estaban
-- el 02/10/2026 a las 16:30 (created_at y updated_at incluidos):
--   reservas: 9e98145c… (completada 13/09 22:00), 79fc0033… (no_show 23/09 15:00),
--             e25c16b8… (pendiente 26/09 22:00), 94693d95… (no_show 01/10 22:00),
--             8bea9054… (verificada 02/10 14:30); todas marca touza, El Reservado.
--   sugerencias_blacklist: d4738198… (de 79fc0033) y ab8a0353… (de 94693d95),
--             pendientes y sin revisar.
-- Los VALUES de abajo se generaron con SELECT sobre producción y se comprobó
-- que reproducen exactamente las filas (misma huella md5 de r::text en UTC:
-- reservas 73ae02a768c47fb149ec7d759815d9ec, sugerencias
-- 425dea01471d77425695834e2c6c629d). Son DATOS DE DEMOSTRACIÓN del generador
-- supabase/seeds/gen_seed.js (25/09): nombres inventados, teléfonos 600000NNN,
-- email @example.com o NULL, notas [DEMO-SEED]; no son personas reales.
--
-- REQUISITO: Touza tiene que tener aforo. Si el script 01 está aplicado (salas
-- de Touza desactivadas), el trigger de aforo rechazaría las 2 reservas vivas
-- (pendiente y verificada) con 23514 «Capacidad total: 0». La pre-comprobación
-- lo detecta y aborta con un mensaje claro. Orden para deshacerlo TODO:
--   1. npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_01_desactivar_salas_ROLLBACK.sql
--   2. npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_02_borrar_reservas_demo_ROLLBACK.sql
--   3. npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--
-- EFECTOS SECUNDARIOS DEL INSERT (triggers de reservas):
--   · trg_snapshot_solicitud_original (BEFORE INSERT): no cambia nada, porque
--     hora_solicitada y espacio_solicitado_id van informados.
--   · trg_validar_capacidad (BEFORE INSERT): solo mira las 2 vivas (2 pax cada
--     una, 26/09 cena y 02/10 comida, aforo de Touza 80 con las salas activas).
--   · trigger_actualizar_ocupacion (AFTER INSERT): recalcula ocupacion_diaria de
--     las 5 franjas; los contadores vuelven a ser los mismos, pero las filas de
--     13/09 22:00 y 23/09 15:00 se crean de nuevo (id y created_at nuevos). Es
--     lo único que no vuelve idéntico, y es un dato derivado.
--   · agregar_suscriptor_al_reservar_consentida (AFTER INSERT): NO se dispara
--     (consentimiento_newsletter = false en las 5).
--   · Ningún trigger manda correos. Los crons tampoco las tocarán: el de
--     ausencias solo mira confirmadas y el recordatorio T-2 confirmadas con email
--     (no hay ninguna confirmada), y el aviso de la campana excluye [DEMO-SEED].
--   · sugerencias_blacklist no tiene triggers; RLS no aplica (postgres, BYPASSRLS).
--
-- PRE-COMPROBACIONES (abortan sin escribir): estado intermedio (existen algunas
-- sí y otras no); filas existentes pero distintas de las del 02/10/2026; Touza
-- sin aforo para las 2 vivas.
-- IDEMPOTENTE: si las 5 y las 2 ya existen tal cual, avisa y no inserta nada.
-- VERIFICACIÓN dentro de la transacción: las dos huellas md5 coinciden con las
-- del 02/10/2026 y ocupacion_diaria tiene fila en las 5 franjas.
-- lock_timeout de 5 s: un 55P03 significa que no ha escrito nada; reintentar.
-- SALIDA: las 7 filas con existe_ahora (esperado: true en todas).
--
-- REGENERAR (si las reservas cambiaran antes de aplicar el 02 y su huella ya no
-- cuadrara): sustituir los dos bloques VALUES por la columna `valores` de estas
-- consultas (solo lectura, en UTC) y poner su `md5_filas` en las dos huellas de
-- este fichero y del 02:
--   select count(*), md5(string_agg(r::text, '|' order by r.id)) as md5_filas,
--          string_agg('(' || quote_literal(r.id::text) || '::uuid, ' || quote_literal(r.fecha::text) || '::date, '
--            || quote_literal(r.hora::text) || '::time, ' || r.numero_comensales::text || ', '
--            || quote_literal(r.estado::text) || '::varchar, ' || quote_nullable(r.notas_cliente) || '::text, '
--            || quote_nullable(r.created_at::text) || '::timestamptz, ' || quote_nullable(r.updated_at::text) || '::timestamptz, '
--            || quote_nullable(r.nombre::text) || '::varchar, ' || quote_nullable(r.telefono::text) || '::varchar, '
--            || quote_nullable(r.email::text) || '::varchar, ' || quote_nullable(r.en_blacklist::text) || '::boolean, '
--            || quote_literal(r.importante::text) || '::boolean, ' || quote_nullable(r.espacio_id::text) || '::uuid, '
--            || quote_nullable(r.canal) || '::text, ' || quote_nullable(r.hora_solicitada::text) || '::time, '
--            || quote_nullable(r.espacio_solicitado_id::text) || '::uuid, ' || quote_literal(r.marca) || '::text, '
--            || quote_nullable(r.llegada_at::text) || '::timestamptz, ' || quote_nullable(r.solicitud_id::text) || '::uuid, '
--            || quote_literal(r.consentimiento_newsletter::text) || '::boolean, ' || quote_nullable(r.salida_at::text) || '::timestamptz)',
--            ',' || chr(10) order by r.id) as valores
--     from public.reservas r where r.id in (<los 5 ids>);
--   y la equivalente sobre public.sugerencias_blacklist s (columnas id, reserva_id,
--   telefono, email, nombre_cliente, motivo, historial::jsonb, estado,
--   blacklist_id, creada_at, revisada_por, revisada_at, nota_revision) con
--   where s.id in (<los 2 ids>).
-- =============================================================================

begin;
set local lock_timeout = '5s';
-- La huella md5 usa r::text: fijar cómo se escriben fechas y horas.
set local timezone = 'UTC';
set local datestyle = 'ISO, MDY';

-- 0) Pre-comprobaciones.
do $pre$
declare
  c_ids constant uuid[] := array[
    '79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
    '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
    'e25c16b8-62c2-40c6-868e-10f07ab26853'
  ]::uuid[];
  c_sugerencias constant uuid[] := array[
    'ab8a0353-648c-4088-a123-30a42a8463b9', 'd4738198-b6cf-456c-b15a-f9241ccf3f3e'
  ]::uuid[];
  c_huella_reservas    constant text := '73ae02a768c47fb149ec7d759815d9ec';
  c_huella_sugerencias constant text := '425dea01471d77425695834e2c6c629d';
  v_n          integer;
  v_s          integer;
  v_huella     text;
  v_aforo      integer;
  v_conflictos text;
begin
  select count(*) into v_n from public.reservas where id = any (c_ids);
  select count(*) into v_s from public.sugerencias_blacklist
   where id = any (c_sugerencias) or reserva_id = any (c_ids);

  -- Idempotencia: ya restauradas (y tal cual).
  if v_n = 5 and v_s = 2 then
    select md5(string_agg(r::text, '|' order by r.id)) into v_huella
      from public.reservas r where r.id = any (c_ids);
    if v_huella is distinct from c_huella_reservas then
      raise exception 'Las 5 reservas ya existen pero no son las del 02/10/2026 (huella % en vez de %). No se toca nada.',
        v_huella, c_huella_reservas;
    end if;
    select md5(string_agg(s::text, '|' order by s.id)) into v_huella
      from public.sugerencias_blacklist s where s.id = any (c_sugerencias);
    if v_huella is distinct from c_huella_sugerencias then
      raise exception 'Las 2 sugerencias ya existen pero no son las del 02/10/2026 (huella % en vez de %). No se toca nada.',
        v_huella, c_huella_sugerencias;
    end if;
    raise notice 'Ya restauradas: las 5 reservas y las 2 sugerencias existen tal cual. No se inserta nada.';
    return;
  end if;
  if v_n <> 0 or v_s <> 0 then
    raise exception 'Estado intermedio: existen % de las 5 reservas y % sugerencias suyas. No se toca nada: revisarlo a mano.',
      v_n, v_s;
  end if;

  -- Aforo de Touza para las 2 vivas (mismo cálculo que validar_capacidad_reserva:
  -- salas activas de la marca; ocupación viva de la marca en la misma fecha y turno).
  select coalesce(sum(e.capacidad_maxima), 0) into v_aforo
    from public.espacios_reserva e
   where e.activa = true
     and coalesce(e.caracteristicas->>'marca', 'casa_tomas') = 'touza';
  select string_agg(v.fecha::text || ' ' || v.hora::text || ': ' || o.ocupados::text || ' + ' || v.pax::text
                    || ' > aforo ' || v_aforo::text, '; ')
    into v_conflictos
    from (values ('2026-09-26'::date, '22:00'::time, 2), ('2026-10-02'::date, '14:30'::time, 2)) as v (fecha, hora, pax)
    cross join lateral (
      select coalesce(sum(r.numero_comensales), 0) as ocupados
        from public.reservas r
       where r.fecha = v.fecha
         and r.marca = 'touza'
         and r.estado in ('pendiente', 'verificada', 'confirmada')
         and (r.hora < time '17:00') = (v.hora < time '17:00')
    ) as o
   where o.ocupados + v.pax > v_aforo;
  if v_conflictos is not null then
    raise exception 'Touza no tiene aforo para devolver las 2 reservas vivas (%). Si el script 01 está aplicado, ejecuta antes 20261002_touza_cierre_01_desactivar_salas_ROLLBACK.sql. No se toca nada.',
      v_conflictos;
  end if;
end
$pre$;

-- 1) Las 5 reservas, con todas sus columnas tal cual estaban.
insert into public.reservas
  (id, fecha, hora, numero_comensales, estado, notas_cliente, created_at, updated_at, nombre, telefono,
   email, en_blacklist, importante, espacio_id, canal, hora_solicitada, espacio_solicitado_id, marca,
   llegada_at, solicitud_id, consentimiento_newsletter, salida_at)
select v.*
  from (values
    ('79fc0033-8c3d-4b3e-bba3-44fc6ea89352'::uuid, '2026-09-23'::date, '15:00:00'::time, 3, 'no_show'::varchar, '[DEMO-SEED] Cena de despedida de soltera'::text, '2026-09-25 13:41:38.955293+00'::timestamptz, '2026-09-26 04:00:10.02787+00'::timestamptz, 'Teresa Serrano Ramos'::varchar, '600000897'::varchar, NULL::varchar, 'false'::boolean, 'false'::boolean, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'manual'::text, '15:00:00'::time, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'touza'::text, NULL::timestamptz, NULL::uuid, 'false'::boolean, NULL::timestamptz),
    ('8bea9054-9cb5-4a39-a597-bcb2b167cd7f'::uuid, '2026-10-02'::date, '14:30:00'::time, 2, 'verificada'::varchar, '[DEMO-SEED] Aniversario'::text, '2026-09-25 13:41:38.955293+00'::timestamptz, '2026-09-25 13:41:38.955293+00'::timestamptz, 'Celia Fernandez Gomez'::varchar, '600000293'::varchar, NULL::varchar, 'false'::boolean, 'false'::boolean, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'web'::text, '14:30:00'::time, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'touza'::text, NULL::timestamptz, NULL::uuid, 'false'::boolean, NULL::timestamptz),
    ('94693d95-bdbc-4ae0-aebd-44707d3e2787'::uuid, '2026-10-01'::date, '22:00:00'::time, 6, 'no_show'::varchar, '[DEMO-SEED]'::text, '2026-09-25 13:41:38.955293+00'::timestamptz, '2026-10-02 04:00:05.644825+00'::timestamptz, 'Felipe Castro Lopez'::varchar, '600000664'::varchar, NULL::varchar, 'false'::boolean, 'false'::boolean, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'web'::text, '22:00:00'::time, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'touza'::text, NULL::timestamptz, NULL::uuid, 'false'::boolean, NULL::timestamptz),
    ('9e98145c-c431-4a00-bb84-917cd77366cd'::uuid, '2026-09-13'::date, '22:00:00'::time, 3, 'completada'::varchar, '[DEMO-SEED] Mesa junto a la entrada'::text, '2026-09-25 13:41:38.955293+00'::timestamptz, '2026-09-25 13:41:38.955293+00'::timestamptz, 'Teresa Gomez Rubio'::varchar, '600000350'::varchar, 'teresa.gomez89@example.com'::varchar, 'false'::boolean, 'false'::boolean, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'telefono'::text, '22:00:00'::time, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'touza'::text, NULL::timestamptz, NULL::uuid, 'false'::boolean, NULL::timestamptz),
    ('e25c16b8-62c2-40c6-868e-10f07ab26853'::uuid, '2026-09-26'::date, '22:00:00'::time, 2, 'pendiente'::varchar, '[DEMO-SEED]'::text, '2026-09-25 13:41:38.955293+00'::timestamptz, '2026-09-25 13:41:38.955293+00'::timestamptz, 'Irene Diaz Alvarez'::varchar, '600000626'::varchar, NULL::varchar, 'false'::boolean, 'false'::boolean, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'web'::text, '22:00:00'::time, '1c976f78-0bd7-4d10-b7bf-5208c910d16d'::uuid, 'touza'::text, NULL::timestamptz, NULL::uuid, 'false'::boolean, NULL::timestamptz)
  ) as v (id, fecha, hora, numero_comensales, estado, notas_cliente, created_at, updated_at, nombre, telefono,
          email, en_blacklist, importante, espacio_id, canal, hora_solicitada, espacio_solicitado_id, marca,
          llegada_at, solicitud_id, consentimiento_newsletter, salida_at)
 where not exists (select 1 from public.reservas r where r.id = v.id);

-- 2) Sus 2 sugerencias de lista negra (después de las reservas, por la FK).
insert into public.sugerencias_blacklist
  (id, reserva_id, telefono, email, nombre_cliente, motivo, historial, estado, blacklist_id, creada_at,
   revisada_por, revisada_at, nota_revision)
select w.*
  from (values
    ('ab8a0353-648c-4088-a123-30a42a8463b9'::uuid, '94693d95-bdbc-4ae0-aebd-44707d3e2787'::uuid, '600000664'::text, NULL::text, 'Felipe Castro Lopez'::text, 'no_show'::text, '{"es_primera_falta": true, "no_shows_previos": 0, "canceladas_previas": 0, "completadas_previas": 0, "total_reservas_previas": 0}'::jsonb, 'pendiente'::text, NULL::uuid, '2026-10-02 04:00:05.726134+00'::timestamptz, NULL::uuid, NULL::timestamptz, NULL::text),
    ('d4738198-b6cf-456c-b15a-f9241ccf3f3e'::uuid, '79fc0033-8c3d-4b3e-bba3-44fc6ea89352'::uuid, '600000897'::text, NULL::text, 'Teresa Serrano Ramos'::text, 'no_show'::text, '{"es_primera_falta": true, "no_shows_previos": 0, "canceladas_previas": 0, "completadas_previas": 0, "total_reservas_previas": 0}'::jsonb, 'pendiente'::text, NULL::uuid, '2026-09-26 04:00:10.056702+00'::timestamptz, NULL::uuid, NULL::timestamptz, NULL::text)
  ) as w (id, reserva_id, telefono, email, nombre_cliente, motivo, historial, estado, blacklist_id, creada_at,
          revisada_por, revisada_at, nota_revision)
 where not exists (select 1 from public.sugerencias_blacklist s where s.id = w.id);

-- 3) Verificación (dentro de la transacción: si falla, no queda nada insertado).
do $post$
declare
  c_ids constant uuid[] := array[
    '79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
    '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
    'e25c16b8-62c2-40c6-868e-10f07ab26853'
  ]::uuid[];
  v_huella text;
  v_n      integer;
begin
  select md5(string_agg(r::text, '|' order by r.id)) into v_huella
    from public.reservas r where r.id = any (c_ids);
  if v_huella is distinct from '73ae02a768c47fb149ec7d759815d9ec' then
    raise exception 'VERIFICACIÓN: las 5 reservas no han quedado como el 02/10/2026 (huella %). Se deshace todo.', v_huella;
  end if;
  select md5(string_agg(s::text, '|' order by s.id)) into v_huella
    from public.sugerencias_blacklist s where s.reserva_id = any (c_ids);
  if v_huella is distinct from '425dea01471d77425695834e2c6c629d' then
    raise exception 'VERIFICACIÓN: las 2 sugerencias no han quedado como el 02/10/2026 (huella %). Se deshace todo.', v_huella;
  end if;
  select count(*) into v_n
    from public.ocupacion_diaria o
   where (o.fecha, o.hora) in (values ('2026-09-13'::date, '22:00'::time), ('2026-09-23'::date, '15:00'::time),
                                      ('2026-09-26'::date, '22:00'::time), ('2026-10-01'::date, '22:00'::time),
                                      ('2026-10-02'::date, '14:30'::time));
  if v_n <> 5 then
    raise exception 'VERIFICACIÓN: ocupacion_diaria tiene % de las 5 franjas (el trigger no ha recalculado). Se deshace todo.', v_n;
  end if;
end
$post$;

commit;

-- 4) Salida (solo lectura). Esperado: existe_ahora = true en las 7 filas y
--    reservas_touza_ahora = 5.
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
