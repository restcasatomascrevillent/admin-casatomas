-- Rollback de 20260919120000_rebuild_webs_state.sql
-- NO APLICAR salvo para deshacer esa migracion si ya se aplico.
begin;

drop policy if exists "web_rebuild_state_service_role" on public.web_rebuild_state;
drop table if exists public.web_rebuild_state;

commit;
