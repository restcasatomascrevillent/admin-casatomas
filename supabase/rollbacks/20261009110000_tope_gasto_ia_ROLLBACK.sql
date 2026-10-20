set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261009110000_tope_gasto_ia.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261009110000_tope_gasto_ia_ROLLBACK.sql
--
-- Borra las RPC fijar_tope_ia_mes y openai_sincronizar_ahora y la columna
-- configuracion_facturas.tope_ia_mes_eur (SE PIERDE el tope fijado). La app
-- nueva sigue funcionando: usa 5 € si no puede leer el tope y el botón
-- «Sincronizar ahora» avisa de que no está disponible.
-- Imprime «tope_gasto_ia: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.fijar_tope_ia_mes(numeric);
drop function if exists public.openai_sincronizar_ahora();
alter table public.configuracion_facturas drop column if exists tope_ia_mes_eur;

commit;

select 'tope_gasto_ia: revertida' as resultado, 0 as restos;
