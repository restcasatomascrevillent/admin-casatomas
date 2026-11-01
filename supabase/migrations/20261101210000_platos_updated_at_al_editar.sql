set client_encoding = 'UTF8';
-- ===========================================================================
-- Platos.updated_at cambia al editar · 2026-11-01 (QA F-45)
-- ===========================================================================
--
-- PROBLEMA: en la demo (50d84eb) `Platos.updated_at` no cambiaba al editar un
-- plato. El panel solo lo rellena al crear (usePlatos.ts) y la tabla no tenía
-- trigger, así que cualquier UPDATE (ficha, activar, foto expandida, orden,
-- SQL a mano) lo dejaba con la fecha de alta.
--
-- DECISIÓN: un trigger BEFORE UPDATE que pone `updated_at = now()` en cada
-- edición, venga de donde venga. Función propia (SECURITY INVOKER,
-- search_path vacío): no reutiliza public.update_updated_at_column, que es
-- SECURITY DEFINER.
--
-- RIESGO REVISADO: ni el panel ni rebuild-webs usan updated_at como versión de
-- caché (las fotos llevan `?t=Date.now()` y rebuild-webs lo dispara el panel
-- al guardar), así que esto no provoca despliegues ni invalidaciones extra.
--
-- Idempotente. Rollback:
--   supabase/rollbacks/20261101210000_platos_updated_at_al_editar_ROLLBACK.sql
-- ===========================================================================

begin;

create or replace function public.carta_tocar_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.carta_tocar_updated_at() from public, anon, authenticated;

drop trigger if exists trg_platos_updated_at on public."Platos";
create trigger trg_platos_updated_at
  before update on public."Platos"
  for each row execute function public.carta_tocar_updated_at();

commit;
