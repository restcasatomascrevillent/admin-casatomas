-- ============================================================================
-- Ajustes de Instagram: «Estilo del feed» (12/11/2026)
-- ----------------------------------------------------------------------------
-- El feed real de @casatomascrevillent son solo fotos de platos, sin texto
-- encima; el texto va en el pie. «Montar con IA» monta por defecto los posts y
-- carruseles con «Solo foto» (ct-solo-foto / tz-solo-foto). Este ajuste deja
-- elegir en RRSS › Instagram › Ajustes:
--   estilo_feed = 'solo_foto' (por defecto) | 'rotulos' (plantillas con titular)
-- El panel lo lee y lo manda a instagram-ia (montar_pieza, campo «estilo»).
-- Si la tabla no existe o no se puede leer, el panel usa 'solo_foto'.
--
-- instagram_ajustes: UNA fila (id = true). Lectura con «Ver» en Marketing;
-- escritura solo por UPDATE de estilo_feed con «Editar» en Marketing.
-- Depende de: 20261001170000 (can_read_section / can_edit_section).
-- Idempotente. Vuelta atrás: supabase/rollbacks/20261127100000_instagram_ajustes_estilo_feed_ROLLBACK.sql
-- ============================================================================

do $$
begin
  if to_regprocedure('public.can_edit_section(text)') is null or to_regprocedure('public.can_read_section(text)') is null then
    raise exception 'instagram_ajustes: faltan public.can_read_section(text) / public.can_edit_section(text)';
  end if;
end $$;

create table if not exists public.instagram_ajustes (
  id boolean primary key default true check (id),
  estilo_feed text not null default 'solo_foto' check (estilo_feed in ('solo_foto', 'rotulos')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.instagram_ajustes (id) values (true) on conflict (id) do nothing;

create or replace function public.instagram_ajustes_tocar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists instagram_ajustes_tocar on public.instagram_ajustes;
create trigger instagram_ajustes_tocar before update on public.instagram_ajustes
  for each row execute function public.instagram_ajustes_tocar();

alter table public.instagram_ajustes enable row level security;
revoke all on public.instagram_ajustes from anon, authenticated;
grant select on public.instagram_ajustes to authenticated;
grant update (estilo_feed) on public.instagram_ajustes to authenticated;
grant all on public.instagram_ajustes to service_role;
drop policy if exists instagram_ajustes_leer on public.instagram_ajustes;
create policy instagram_ajustes_leer on public.instagram_ajustes
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_ajustes_editar on public.instagram_ajustes;
create policy instagram_ajustes_editar on public.instagram_ajustes
  for update to authenticated
  using ((select public.can_edit_section('marketing')))
  with check ((select public.can_edit_section('marketing')));

comment on table public.instagram_ajustes is 'Ajustes de Instagram (una fila). estilo_feed: solo_foto (por defecto) | rotulos. Ver docs/instagram-ia.md.';
