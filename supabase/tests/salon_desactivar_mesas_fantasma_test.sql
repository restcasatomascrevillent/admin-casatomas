set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261004100000_salon_desactivar_mesas_fantasma.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK (solo lee). DESPUÉS de
-- aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/salon_desactivar_mesas_fantasma_test.sql
-- Si termina sin ERROR, todo ha pasado. NO en el SQL Editor.
-- ===========================================================================

begin;

do $$
declare
  c_salon constant uuid := 'db8be4e2-2e67-4110-99b1-9e1d779514cc';
  r record;
  n integer;
begin
  -- A1. Las fantasmas están inactivas.
  select count(*) into n from public.mesas
   where id in ('3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7', '08e9ae3d-f7ce-47d7-ba1d-a752ff568f77')
     and activa = false;
  assert n = 2, format('A1: %s de 2 mesas fantasma inactivas', n);

  -- A2. La 9 real se llama «9».
  select count(*) into n from public.mesas
   where id = '2d66d706-9426-4daf-b7ef-9af36e1a6eb5' and nombre = '9' and coalesce(activa, true);
  assert n = 1, 'A2: «9 (revisar)» no se ha renombrado a «9»';

  -- A3. 13 mesas activas, 52 plazas, ninguna fuera del plano.
  select count(*), sum(capacidad) into r from public.mesas
   where espacio_id = c_salon and coalesce(activa, true) and not coalesce(is_merged, false);
  assert r.count = 13 and r.sum = 52, format('A3: %s mesas / %s plazas', r.count, r.sum);

  select count(*) into n from public.mesas m join public.planos_espacio p on p.espacio_id = m.espacio_id
   where m.espacio_id = c_salon and coalesce(m.activa, true)
     and (m.pos_x + m.ancho / 100 > p.ancho_metros or m.pos_y + m.alto / 100 > p.alto_metros);
  assert n = 0, format('A3: %s mesas activas fuera del plano', n);

  -- A4. Ningún número de mesa activo repetido en el Salón.
  select count(*) into n from (
    select lower(btrim(regexp_replace(nombre, '\s+', ' ', 'g'))) k from public.mesas
     where espacio_id = c_salon and coalesce(activa, true) and not coalesce(is_merged, false)
     group by 1 having count(*) > 1) d;
  assert n = 0, format('A4: %s números repetidos', n);
end;
$$;

select 'salon_desactivar_mesas_fantasma: todas las comprobaciones han pasado' as resultado;

rollback;
