set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- =============================================================================
-- NO APLICADA: la aplica el dueño a mano.
-- CIERRE DE RESERVAS DE TOUZA (fase de datos) · 03 · AVISOS DE TOUZA EN LA CAMPANA
-- =============================================================================
-- Marca como LEÍDOS (leida = true) los avisos SIN LEER de
-- public.notificaciones_dashboard que son de Touza. No borra nada ni cambia
-- ninguna función ni ningún cron.
--
-- PASOS, EN ORDEN (desde adminpanelct/, una orden por línea; ver
-- 20261002_touza_cierre_LEEME.md):
--   1. Antes: reservas-web desplegada, script 01 y, si el dueño lo decide, el 02.
--   2. ESTE script:
--        npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_03_avisos_campana.sql
--   3. Comprobar:
--        npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--
-- ESTADO COMPROBADO CON SELECT (02/10/2026, 16:30): la tabla tiene 12 avisos,
-- TODOS leídos, y NINGUNO es de Touza (10 email_fallido, de Casa Tomás o sin
-- negocio en el texto; 2 solicitud_pendiente de solicitudes de Casa Tomás; 0
-- reserva_sin_asignar). Hoy este script no cambiaría ninguna fila: queda
-- preparado por si aparecen avisos de Touza antes de aplicarlo (p. ej. si la
-- web de Touza sigue llamando a la reservas-web vieja hasta que se despliegue).
--
-- CÓMO SE RECONOCE UN AVISO DE TOUZA. notificaciones_dashboard no tiene marca;
-- la columna de lectura es `leida` (boolean NOT NULL DEFAULT false). Se marca
-- un aviso sin leer si cumple UNO de estos criterios, sin ambigüedad con Casa
-- Tomás:
--   a) referencia_tipo = 'reserva' y la reserva es de marca touza, o es una de
--      las 5 demo de Touza (por si el 02 ya las borró y el aviso quedó huérfano);
--   b) referencia_tipo = 'solicitud' y la solicitud es de marca touza;
--   c) tipo = 'reserva_sin_asignar' y el mensaje lleva « pers. (Touza): »: es el
--      texto exacto que pone fn_avisar_reservas_sin_asignar solo cuando la
--      reserva es de Touza (en Casa Tomás va « pers.: »);
--   d) tipo = 'email_fallido' y el título acaba en « (Touza)»: reservas-web pone
--      «Correo de … no enviado (<negocio>)» y el de Casa Tomás acaba en
--      «(Casa Tomás)».
-- En c) y d) se exige además que el aviso NO apunte a una reserva o solicitud de
-- Casa Tomás. Los avisos de solicitudes (fn_notificar_solicitud) no llevan el
-- negocio en el texto: solo los reconoce b).
--
-- POR QUÉ NO SE TOCA EL CRON (job reservas-aviso-sin-asignar, cada 15 min,
-- función fn_avisar_reservas_sin_asignar de 20260930120000, idéntica en
-- producción a la del repo):
--   · Solo avisa de reservas VIVAS sin mesas cuya hora cae entre ahora y ahora +
--     48 h (asignacion_ventana_horas = 48, aviso activo), y excluye las de prueba
--     ([DEMO-SEED] en notas o nombre, email @example.com). Las 5 reservas de
--     Touza son [DEMO-SEED]: nunca le contaron (su libro avisos_reserva_enviados
--     está vacío y no hay ningún aviso reserva_sin_asignar).
--   · Borradas las 5 (script 02), Touza no tiene ninguna reserva; si no se borran,
--     las 2 vivas (pendiente 26/09 y verificada 02/10) son demo y ya pasadas.
--   · Con las salas de Touza desactivadas (script 01), el trigger de aforo no
--     deja crear ninguna reserva viva de Touza (aforo 0), y reservas-web la
--     rechaza antes con el 409; el panel y los dos bots crean las reservas con
--     marca casa_tomas (explícita o por el DEFAULT de la columna).
--   · El propio cron marca como leídos, en cada pasada, sus avisos cuya reserva
--     ya no está pendiente de asignar o ya no existe.
--   Así que no volverá a avisar de Touza. Añadir «and r.marca = 'casa_tomas'» a
--   la función sería solo limpieza de código: queda para una migración aparte
--   (aquí no se puede probar DDL).
--
-- SIN FICHERO DE ROLLBACK, a propósito: marcar como leído no borra nada y el
-- aviso sigue en la campana. La salida de este script trae en la columna
-- `deshacer` la sentencia EXACTA que devuelve a «no leído» los avisos que ha
-- marcado (o «Nada que deshacer»); guardarla si se quiere poder volver atrás.
--
-- PRE-COMPROBACIÓN (aborta sin escribir): existen las columnas en las que se
-- basan los criterios. IDEMPOTENTE: solo toca avisos con leida = false; una
-- segunda pasada marca 0. VERIFICACIÓN dentro de la transacción: con los MISMOS
-- criterios (vista temporal _touza_03_criterio) no queda ningún aviso de Touza
-- sin leer, y no ha cambiado ningún otro aviso.
-- Lo temporal (vista y tablas _touza_03_*) vive solo en esta conexión.
-- lock_timeout de 5 s: un 55P03 significa que no ha escrito nada; reintentar.
-- SALIDA: una fila con cuántos avisos ha marcado, por qué criterio, sus ids y
-- la sentencia para deshacerlo.
-- =============================================================================

begin;
set local lock_timeout = '5s';

-- 0) Pre-comprobación: las columnas de los criterios existen.
do $pre$
declare
  v_n integer;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and (   (table_name = 'notificaciones_dashboard'
              and column_name in ('id', 'tipo', 'titulo', 'mensaje', 'referencia_id', 'referencia_tipo', 'leida', 'created_at'))
          or (table_name = 'reservas' and column_name = 'marca')
          or (table_name = 'solicitudes_pendientes' and column_name = 'marca'));
  if v_n <> 10 then
    raise exception 'El esquema no es el esperado (% de 10 columnas: notificaciones_dashboard, reservas.marca, solicitudes_pendientes.marca). No se toca nada.', v_n;
  end if;
end
$pre$;

-- 1) Criterios, definidos UNA vez: avisos sin leer que son de Touza.
drop view if exists pg_temp._touza_03_criterio;
create temp view _touza_03_criterio as
select c.id, c.tipo, c.created_at, c.criterio
  from (
    select n.id, n.tipo, n.created_at, n.referencia_tipo, n.referencia_id,
           case
             when n.referencia_tipo = 'reserva'
                  and (n.referencia_id = any (array['79fc0033-8c3d-4b3e-bba3-44fc6ea89352', '8bea9054-9cb5-4a39-a597-bcb2b167cd7f',
                                                    '94693d95-bdbc-4ae0-aebd-44707d3e2787', '9e98145c-c431-4a00-bb84-917cd77366cd',
                                                    'e25c16b8-62c2-40c6-868e-10f07ab26853']::uuid[])
                       or exists (select 1 from public.reservas r where r.id = n.referencia_id and r.marca = 'touza'))
               then 'a) reserva de Touza'
             when n.referencia_tipo = 'solicitud'
                  and exists (select 1 from public.solicitudes_pendientes s where s.id = n.referencia_id and s.marca = 'touza')
               then 'b) solicitud de Touza'
             when n.tipo = 'reserva_sin_asignar' and strpos(coalesce(n.mensaje, ''), ' pers. (Touza): ') > 0
               then 'c) aviso del cron con (Touza)'
             when n.tipo = 'email_fallido' and right(coalesce(n.titulo, ''), 8) = ' (Touza)'
               then 'd) correo fallido de la web de Touza'
           end as criterio
      from public.notificaciones_dashboard n
     where n.leida = false
  ) c
 where c.criterio is not null
   -- c) y d) van por texto: nunca si el aviso apunta a algo de Casa Tomás.
   and not (    c.criterio in ('c) aviso del cron con (Touza)', 'd) correo fallido de la web de Touza')
            and (   (c.referencia_tipo = 'reserva'
                     and exists (select 1 from public.reservas r where r.id = c.referencia_id and r.marca <> 'touza'))
                 or (c.referencia_tipo = 'solicitud'
                     and exists (select 1 from public.solicitudes_pendientes s where s.id = c.referencia_id and s.marca <> 'touza'))));

-- Lo que se va a marcar. SIN «on commit drop»: la salida del final, ya fuera
-- de la transacción, la necesita.
drop table if exists pg_temp._touza_03_avisos;
create temp table _touza_03_avisos as
  select id, tipo, created_at, criterio from _touza_03_criterio;

-- Foto de los avisos sin leer ANTES (para comprobar que no cambia ningún otro).
create temp table _touza_03_sin_leer_antes on commit drop as
  select id from public.notificaciones_dashboard where leida = false;

-- 2) Marcarlos como leídos.
update public.notificaciones_dashboard n
   set leida = true
  from _touza_03_avisos t
 where n.id = t.id
   and n.leida = false;

-- 3) Verificación (dentro de la transacción).
do $post$
declare
  v_n integer;
begin
  select count(*) into v_n from _touza_03_criterio;
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: quedan % avisos de Touza sin leer. Se deshace todo.', v_n;
  end if;

  select count(*) into v_n
    from _touza_03_sin_leer_antes a
    join public.notificaciones_dashboard n on n.id = a.id
   where n.leida = true
     and not exists (select 1 from _touza_03_avisos t where t.id = a.id);
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: han pasado a leídos % avisos que no son de Touza. Se deshace todo.', v_n;
  end if;
end
$post$;

commit;

-- 4) Salida (solo lectura). El 02/10/2026 sería: 0 marcados, «Nada que deshacer».
select count(*)                                                          as avisos_marcados_leidos,
       coalesce(string_agg(distinct t.criterio, '; '), '-')              as criterios,
       coalesce(string_agg(t.id::text, ', ' order by t.created_at), '-') as ids,
       case when count(*) = 0 then 'Nada que deshacer'
            else 'update public.notificaciones_dashboard set leida = false where id in ('
                 || string_agg(quote_literal(t.id::text), ', ' order by t.created_at) || ');'
       end                                                               as deshacer,
       (select count(*) from public.notificaciones_dashboard where leida = false) as sin_leer_total_ahora
  from _touza_03_avisos t;
