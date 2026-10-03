set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261003100000_salon_mesas_en_metros.sql
-- ===========================================================================
--
-- Este fichero NO es una migración y no debe copiarse a supabase/migrations/
-- (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261003100000_salon_mesas_en_metros_ROLLBACK.sql
--
-- Devuelve las mesas "9" y "11" del Salón (por id) a sus coordenadas previas,
-- copiadas de producción el 03/10/2026. OJO: ese estado es el ROTO (pos en px
-- que el editor lee como metros: las mesas salen a 239 m y 349 m, fuera del
-- plano de 19 x 13 m). Si el dueño las movió en el editor después de aplicar
-- la migración, esa colocación se pierde.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

update public.mesas m set pos_x = v.pos_x, pos_y = v.pos_y
from (values
    ('3a98ace3-3a8b-4c5a-a50e-f16fe5bc67e7'::uuid, 239.26, 100.17),  -- "9"
    ('08e9ae3d-f7ce-47d7-ba1d-a752ff568f77'::uuid, 349.07, 135.79)   -- "11"
) as v(id, pos_x, pos_y)
where m.id = v.id;

commit;
