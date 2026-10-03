set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- NO APLICADA: la aplica el dueño a mano, y SOLO para deshacer
-- supabase/migrations/20261003120000_touza_retirar_espacios_reserva.sql.
-- ROLLBACK · VOLVER A CREAR LAS 3 SALAS DE TOUZA (DESACTIVADAS)
-- ===========================================================================
-- Re-inserta las 3 filas de public.espacios_reserva con los MISMOS ids y datos
-- que tenían el 03/10/2026 (comprobado con SELECT), incluidos created_at y
-- updated_at, y con activa = false (el estado en que las dejó el script 01 el
-- 02/10/2026 16:24 UTC). Las deja DESACTIVADAS a propósito: es el estado previo
-- a la migración. Para reactivarlas, además, ROLLBACK del 01.
--   1c976f78-0bd7-4d10-b7bf-5208c910d16d  El Reservado  20  {"marca": "touza", "privada": true}
--   1d268991-ab58-49c6-b70e-10d9533595a7  Interior      30  {"marca": "touza"}
--   0ca1e7aa-d1bc-4c70-994a-4932db7e5c12  Terraza       30  {"marca": "touza", "exterior": true}
--
-- ORDEN PARA DESHACER TODO EL CIERRE DE TOUZA (desde adminpanelct/, una orden
-- por línea):
--   1. ESTE:  npx supabase db query --linked -f supabase/rollbacks/20261003120000_touza_retirar_espacios_reserva_ROLLBACK.sql
--   2. 01:    npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_01_desactivar_salas_ROLLBACK.sql
--             (reactiva las salas; sin aforo en Touza el 02 no puede restaurar)
--   3. 02:    npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_02_borrar_reservas_demo_ROLLBACK.sql
--             (las reservas demo necesitan que la sala exista: FK espacio_id)
--   4. Test:  npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--
-- QUÉ NO VUELVE: nada más había en esas salas (0 mesas, planos, turnos,
-- asignaciones ni solicitudes: la migración lo exige antes de borrar). Las
-- reservas que apuntaban a ellas ya no existían (las borró el 02).
--
-- PRE-COMPROBACIONES (aborta sin escribir): la tabla tiene exactamente las 8
-- columnas esperadas (id, nombre, descripcion, capacidad_maxima, activa,
-- caracteristicas, created_at, updated_at; si hay una nueva, este INSERT
-- no la restauraría) y no hay otra sala con marca touza que no sea una de las 3.
-- IDEMPOTENTE: ON CONFLICT (id) DO NOTHING; si ya existen, no cambia nada.
-- VERIFICACIÓN dentro de la transacción: existen las 3, con marca touza y
-- activa = false, y Casa Tomás intacta.
-- lock_timeout de 5 s: un 55P03 significa que no se escribió nada; reintentar.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

create temp table _touza_04r_ct_antes on commit drop as
  select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at
    from public.espacios_reserva
   where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza';

do $pre$
declare
  c_salas constant uuid[] := array[
    '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',
    '1c976f78-0bd7-4d10-b7bf-5208c910d16d',
    '1d268991-ab58-49c6-b70e-10d9533595a7'
  ]::uuid[];
  v_cols  text;
  v_ajena integer;
begin
  select string_agg(column_name::text, ',' order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'espacios_reserva';
  if v_cols is distinct from 'activa,capacidad_maxima,caracteristicas,created_at,descripcion,id,nombre,updated_at' then
    raise exception 'La tabla espacios_reserva ya no tiene las 8 columnas esperadas (hay: %). No se ha tocado nada: este ROLLBACK habría que revisarlo.', v_cols;
  end if;

  select count(*) into v_ajena
    from public.espacios_reserva e
   where e.caracteristicas->>'marca' = 'touza' and not (e.id = any (c_salas));
  if v_ajena > 0 then
    raise exception 'Hay % salas con marca touza que no son las 3 esperadas. No se ha tocado nada: revisarlo antes.', v_ajena;
  end if;
end
$pre$;

insert into public.espacios_reserva
  (id, nombre, descripcion, capacidad_maxima, activa, caracteristicas, created_at, updated_at)
values
  ('1c976f78-0bd7-4d10-b7bf-5208c910d16d', 'El Reservado',
   'Espacio privado de Touza (Crevillente) para eventos: cumpleaños, cenas y reuniones. Hasta 20 personas.',
   20, false, '{"marca": "touza", "privada": true}'::jsonb,
   '2026-09-22 20:27:26.430275+00', '2026-10-02 16:24:09.027757+00'),
  ('1d268991-ab58-49c6-b70e-10d9533595a7', 'Interior',
   'Sala interior de Touza',
   30, false, '{"marca": "touza"}'::jsonb,
   '2026-09-26 06:32:28.120221+00', '2026-10-02 16:24:09.027757+00'),
  ('0ca1e7aa-d1bc-4c70-994a-4932db7e5c12', 'Terraza',
   'Terraza de Touza',
   30, false, '{"marca": "touza", "exterior": true}'::jsonb,
   '2026-09-26 06:32:28.120221+00', '2026-10-02 16:24:09.027757+00')
on conflict (id) do nothing;

do $post$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.espacios_reserva
   where id = any (array[
           '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',
           '1c976f78-0bd7-4d10-b7bf-5208c910d16d',
           '1d268991-ab58-49c6-b70e-10d9533595a7'
         ]::uuid[])
     and caracteristicas->>'marca' = 'touza';
  if v_n <> 3 then
    raise exception 'VERIFICACIÓN: hay % salas de Touza en vez de 3. Se deshace todo.', v_n;
  end if;

  select count(*) into v_n from (
    (select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from _touza_04r_ct_antes
     except
     select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza')
    union all
    (select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza'
     except
     select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from _touza_04r_ct_antes)
  ) d;
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: las salas de Casa Tomás han cambiado (% diferencias). Se deshace todo.', v_n;
  end if;
end
$post$;

commit;

-- Salida (solo lectura). Esperado: 3 salas de Touza (activa = false) y las 4 de
-- Casa Tomás; aforo_activo_total 170 (las de Touza siguen desactivadas).
select coalesce(e.caracteristicas->>'marca', 'casa_tomas') as negocio,
       e.nombre                                               as sala,
       e.id,
       e.activa,
       e.capacidad_maxima,
       coalesce(sum(e.capacidad_maxima) filter (where e.activa) over (), 0) as aforo_activo_total
  from public.espacios_reserva e
 order by 1, 2, 3;
