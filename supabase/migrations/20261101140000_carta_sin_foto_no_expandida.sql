set client_encoding = 'UTF8';
-- ===========================================================================
-- Sin foto no hay «foto expandida» (Platos y Vinos) · 2026-11-01
-- ===========================================================================
--
-- PROBLEMA: en la web, p. ej. «Tataki de chuleta de vaca, pimiento
-- caramelizado y salsa de sésamo» salía desplegada con un hueco vacío porque
-- tenía `expanded = true` y ninguna foto. Pasaba al quitar la foto desde la
-- ficha de edición: se ponía `imagen_url` a NULL pero `expanded` seguía en
-- true. El 01-11-2026 había 8 platos así en producción (4 visibles).
--
-- DECISIÓN:
--   1. Arreglar los que ya están así.
--   2. Un trigger BEFORE INSERT/UPDATE que, si la fila se queda sin foto
--      (NULL o texto vacío), pone `expanded = false`. Así da igual desde dónde
--      se quite la foto (panel, ficha, importación, SQL a mano).
-- El panel y la web también lo respetan por su cuenta (no dependen de esto).
--
-- Idempotente. Rollback:
--   supabase/rollbacks/20261101140000_carta_sin_foto_no_expandida_ROLLBACK.sql
-- ===========================================================================

begin;

create or replace function public.carta_sin_foto_no_expandida()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(btrim(new.imagen_url), '') = '' and new.expanded is true then
    new.expanded := false;
  end if;
  return new;
end;
$$;

comment on function public.carta_sin_foto_no_expandida() is
  'Platos/Vinos: una fila sin imagen_url no puede tener expanded = true (no hay foto que expandir en la web).';

drop trigger if exists trg_platos_sin_foto_no_expandida on public."Platos";
create trigger trg_platos_sin_foto_no_expandida
  before insert or update of imagen_url, expanded on public."Platos"
  for each row execute function public.carta_sin_foto_no_expandida();

drop trigger if exists trg_vinos_sin_foto_no_expandida on public."Vinos";
create trigger trg_vinos_sin_foto_no_expandida
  before insert or update of imagen_url, expanded on public."Vinos"
  for each row execute function public.carta_sin_foto_no_expandida();

update public."Platos" set expanded = false
 where expanded is true and coalesce(btrim(imagen_url), '') = '';
update public."Vinos" set expanded = false
 where expanded is true and coalesce(btrim(imagen_url), '') = '';

commit;
