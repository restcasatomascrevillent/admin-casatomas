set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK de 20261224100100_redes_aviso_revocar
-- ----------------------------------------------------------------------------
-- Quita el aviso inmediato a rrss. Al quitar «Redes», rrss sigue cortando el
-- acceso por caducidad (~20 minutos). No toca permisos ni usuarios. Idempotente.
-- Tiene que terminar en «redes_aviso_revocar ROLLBACK: aplicado».
-- ============================================================================
drop trigger if exists user_permissions_redes_revocar on public.user_permissions;
drop function if exists public.rrss_redes_avisar_revocacion();
do $$ begin raise notice 'redes_aviso_revocar ROLLBACK: aplicado'; end $$;
