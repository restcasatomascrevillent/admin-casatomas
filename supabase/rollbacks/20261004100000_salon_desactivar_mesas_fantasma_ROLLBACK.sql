set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261004100000_salon_desactivar_mesas_fantasma.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261004100000_salon_desactivar_mesas_fantasma_ROLLBACK.sql
--
-- Devuelve el nombre «9 (revisar)» a la mesa pequeña y reactiva las mesas
-- fantasma «9» y «11» (siguen con pos_x/pos_y en píxeles: vuelven a no verse
-- en el editor y a sumar 12 plazas). Orden: primero el renombrado, para que el
-- número 9 esté libre al reactivar la «9» fantasma (índice único parcial).
-- Aborta si alguien ha creado otra mesa activa «9» u «11» en el Salón.
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
  update public.mesas set nombre = '9 (revisar)' where id = c_revisar and nombre = '9';

  select count(*) into n from public.mesas
   where espacio_id = c_salon and coalesce(activa, true) and not coalesce(is_merged, false)
     and lower(btrim(regexp_replace(nombre, '\s+', ' ', 'g'))) in ('9', '11');
  if n <> 0 then
    raise exception 'ROLLBACK ABORTADO: ya hay % mesa(s) activa(s) «9» u «11» en el Salón; reactivar las fantasmas chocaría. No se ha cambiado nada.', n;
  end if;

  update public.mesas set activa = true where id in (c_fantasma9, c_fantasma11);
end;
$$;

commit;

select 'salon_desactivar_mesas_fantasma: revertida' as resultado,
       count(*) as mesas_activas,
       sum(capacidad) as plazas
  from public.mesas
 where espacio_id = 'db8be4e2-2e67-4110-99b1-9e1d779514cc'
   and coalesce(activa, true) and not coalesce(is_merged, false);
