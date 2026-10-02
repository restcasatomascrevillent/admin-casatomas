set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- =============================================================================
-- NO APLICADA: la aplica el dueño a mano, y SOLO para deshacer
-- 20261002_touza_cierre_01_desactivar_salas.sql.
-- ROLLBACK · 01 · VOLVER A ACTIVAR LAS 3 SALAS DE TOUZA
-- =============================================================================
-- Pone `activa = true` en las 3 salas de Touza (el valor que tenían el
-- 02/10/2026, comprobado con SELECT), identificadas por
-- caracteristicas->>'marca' = 'touza' Y por id (nunca por nombre):
--   1c976f78-0bd7-4d10-b7bf-5208c910d16d  El Reservado  20
--   1d268991-ab58-49c6-b70e-10d9533595a7  Interior      30
--   0ca1e7aa-d1bc-4c70-994a-4932db7e5c12  Terraza       30
--
-- CUÁNDO: si el dueño se echa atrás, o ANTES de
-- 20261002_touza_cierre_02_borrar_reservas_demo_ROLLBACK.sql (restaurar las
-- reservas demo exige que Touza tenga aforo: con las salas desactivadas el
-- trigger de aforo rechaza las 2 que están vivas).
--
-- PASOS (desde adminpanelct/, una orden por línea):
--   1. npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_01_desactivar_salas_ROLLBACK.sql
--   2. npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--
-- QUÉ VUELVE: aforo activo de Touza 0 -> 80; los dos bots de origin/main
-- (restaurante-phone/api/vapi-webhook.js y api/el-webhook.js) vuelven a
-- sumar 250 plazas para Casa Tomás (el defecto que cerraba el script 01); la
-- BD vuelve a admitir reservas vivas de Touza hasta 80 por turno (la única
-- barrera que queda es el 409 de reservas-web, si está desplegado).
-- QUÉ NO VUELVE: updated_at de las 3 salas (el trigger
-- update_espacios_reserva_updated_at lo pone a la hora de este ROLLBACK).
-- No toca reservas, mesas, planos, turnos ni asignaciones.
--
-- PRE-COMPROBACIÓN (aborta sin escribir): las salas con marca touza son
-- exactamente esas 3. IDEMPOTENTE: si ya están activas, no cambia nada.
-- VERIFICACIÓN dentro de la transacción: las 3 activas y Casa Tomás intacta.
-- lock_timeout de 5 s: un 55P03 significa que no ha escrito nada; reintentar.
-- =============================================================================

begin;
set local lock_timeout = '5s';

create temp table _touza_01r_ct_antes on commit drop as
  select id, activa, capacidad_maxima, caracteristicas
    from public.espacios_reserva
   where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza';

do $pre$
declare
  c_salas constant uuid[] := array[
    '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',  -- Terraza (Touza)
    '1c976f78-0bd7-4d10-b7bf-5208c910d16d',  -- El Reservado
    '1d268991-ab58-49c6-b70e-10d9533595a7'   -- Interior
  ]::uuid[];
  v_touza uuid[];
begin
  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[]) into v_touza
    from public.espacios_reserva e
   where e.caracteristicas->>'marca' = 'touza';
  if v_touza is distinct from c_salas then
    raise exception 'Las salas con marca touza no son las 3 esperadas (hay %: %). No se ha tocado nada: revisarlo antes.',
      cardinality(v_touza), v_touza;
  end if;
end
$pre$;

update public.espacios_reserva
   set activa = true
 where caracteristicas->>'marca' = 'touza'
   and id = any (array[
         '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',
         '1c976f78-0bd7-4d10-b7bf-5208c910d16d',
         '1d268991-ab58-49c6-b70e-10d9533595a7'
       ]::uuid[])
   and activa is distinct from true;

do $post$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.espacios_reserva
   where caracteristicas->>'marca' = 'touza'
     and activa is true;
  if v_n <> 3 then
    raise exception 'VERIFICACIÓN: hay % salas de Touza activas en vez de 3. Se deshace todo.', v_n;
  end if;

  select count(*) into v_n from (
    (select id, activa, capacidad_maxima, caracteristicas from _touza_01r_ct_antes
     except
     select id, activa, capacidad_maxima, caracteristicas from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza')
    union all
    (select id, activa, capacidad_maxima, caracteristicas from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza'
     except
     select id, activa, capacidad_maxima, caracteristicas from _touza_01r_ct_antes)
  ) d;
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: las salas de Casa Tomás han cambiado (% diferencias). Se deshace todo.', v_n;
  end if;
end
$post$;

commit;

-- Salida (solo lectura). Esperado: Touza 3 salas activas, aforo 80; Casa Tomás
-- 4 activas, 170; aforo_activo_total 250.
select coalesce(e.caracteristicas->>'marca', 'casa_tomas') as negocio,
       e.nombre                                               as sala,
       e.id,
       e.activa,
       e.capacidad_maxima,
       coalesce(sum(e.capacidad_maxima) filter (where e.activa)
                  over (partition by coalesce(e.caracteristicas->>'marca', 'casa_tomas')), 0) as aforo_activo_negocio,
       coalesce(sum(e.capacidad_maxima) filter (where e.activa) over (), 0)                   as aforo_activo_total
  from public.espacios_reserva e
 order by 1, 2, 3;
