set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de 20261111000000_instagram_seguridad — vuelve a «Ver basta para
-- escribir» en Instagram (can_write_section), quita la sección del trabajador
-- de render (vuelve a necesitar Marketing), los límites de la agencia, el
-- cupo atómico de IA y la protección de piezas programadas o publicadas.
--
-- NO borra (no molestan y no hacen nada sin el resto):
--   · instagram_piezas.video_borrado_at e instagram_encargo_eventos.notificado_at;
--   · los permisos «instagram_render» de user_permissions;
--   · las funciones instagram_render_terminar / reclamar / progreso / soltar
--     de esta migración: siguen igual, pero su permiso vuelve a ser Marketing.
-- Las Edge Functions y /api/instagram-render de esta versión piden
-- can_edit_section: si se deshace esto, vuelve a desplegar las anteriores.
--
--   npx supabase db query --linked -f supabase/rollbacks/20261111000000_instagram_seguridad_ROLLBACK.sql
-- Idempotente. Tiene que terminar en «instagram_seguridad: deshecha».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop trigger if exists instagram_piezas_proteger_programada on public.instagram_piezas;
drop function if exists public.instagram_piezas_proteger_programada();

drop function if exists public.instagram_ia_reservar_cupo(integer, integer);
drop table if exists public.instagram_ia_cupo;

drop policy if exists ig_render_video_select on storage.objects;
drop policy if exists ig_render_video_insert on storage.objects;
drop policy if exists ig_render_video_update on storage.objects;
drop policy if exists ig_render_video_delete on storage.objects;
drop policy if exists instagram_trabajos_render_select_trabajador on public.instagram_trabajos_render;

-- Tablas: can_edit_section → can_write_section (lo que había).
do $$
declare
  r record;
  v_sql text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (tablename like 'instagram\_%' or tablename = 'marketing_fechas')
       and (coalesce(qual, '') like '%can_edit_section%' or coalesce(with_check, '') like '%can_edit_section%')
  loop
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      v_sql := v_sql || ' using (' || replace(r.qual, 'can_edit_section', 'can_write_section') || ')';
    end if;
    if r.with_check is not null then
      v_sql := v_sql || ' with check (' || replace(r.with_check, 'can_edit_section', 'can_write_section') || ')';
    end if;
    execute v_sql;
  end loop;
end;
$$;

-- Cubos: las políticas de 20261105090000, 20261109100000 y 20261110100000.
drop policy if exists instagram_objetos_insert_seccion on storage.objects;
create policy instagram_objetos_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) );
drop policy if exists instagram_objetos_update_seccion on storage.objects;
create policy instagram_objetos_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) )
  with check ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) );
drop policy if exists instagram_objetos_delete_seccion on storage.objects;
create policy instagram_objetos_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'instagram' and (select public.can_write_section('marketing')) );
drop policy if exists ig_video_objetos_insert_seccion on storage.objects;
create policy ig_video_objetos_insert_seccion on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) );
drop policy if exists ig_video_objetos_update_seccion on storage.objects;
create policy ig_video_objetos_update_seccion on storage.objects
  for update to authenticated
  using      ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) )
  with check ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) );
drop policy if exists ig_video_objetos_delete_seccion on storage.objects;
create policy ig_video_objetos_delete_seccion on storage.objects
  for delete to authenticated
  using ( bucket_id = 'instagram-video' and (select public.can_write_section('marketing')) );
drop policy if exists ig_encargos_jpeg_insert on storage.objects;
create policy ig_encargos_jpeg_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram' and name like 'encargos/%'
               and (select public.can_write_section('instagram_agencia')) );
drop policy if exists ig_encargos_jpeg_select on storage.objects;
create policy ig_encargos_jpeg_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram' and name like 'encargos/%'
          and (select public.can_read_section('instagram_agencia')) );
drop policy if exists ig_encargos_video_insert on storage.objects;
create policy ig_encargos_video_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram-video' and name like 'reels/%'
               and (select public.can_write_section('instagram_agencia')) );
drop policy if exists ig_encargos_video_select on storage.objects;
create policy ig_encargos_video_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram-video' and name like 'reels/%'
          and (select public.can_read_section('instagram_agencia')) );

-- Permisos de las RPC: otra vez can_write_section.
do $$
declare
  v_f text;
begin
  foreach v_f in array array['instagram_programacion_permiso', 'instagram_campanas_permiso', 'instagram_render_permiso'] loop
    execute format($f$
      create or replace function public.%I()
      returns void language plpgsql stable security definer set search_path = '' as $c$
      begin
        if auth.uid() is null or not coalesce(public.can_write_section('marketing'), false) then
          raise exception 'Sin permiso de Marketing' using errcode = '42501';
        end if;
        if to_regprocedure('private.sesion_panel_permitida()') is not null then
          if not coalesce((select private.sesion_panel_permitida()), false) then
            raise exception 'Sesión de panel no válida' using errcode = '42501';
          end if;
        end if;
      end;
      $c$ $f$, v_f);
  end loop;
end;
$$;

-- El trabajador vuelve a entrar con Marketing.
create or replace function public.instagram_render_permiso_trabajador()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.instagram_render_permiso();
end;
$$;

create or replace function public.instagram_encargo_lado(p_lado text, p_preferido text default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r boolean;
  v_a boolean;
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
  v_r := coalesce(public.can_write_section('marketing'), false);
  v_a := coalesce(public.can_write_section('instagram_agencia'), false);
  if p_lado = 'restaurante' then
    if not v_r then raise exception 'Solo el restaurante (permiso de Marketing) puede hacer esto' using errcode = '42501'; end if;
    return 'restaurante';
  elsif p_lado = 'agencia' then
    if not v_a then raise exception 'Solo la agencia (permiso Instagram · Agencia) puede hacer esto' using errcode = '42501'; end if;
    return 'agencia';
  end if;
  if v_r and v_a then
    return case when p_preferido = 'agencia' then 'agencia' else 'restaurante' end;
  elsif v_r then
    return 'restaurante';
  elsif v_a then
    return 'agencia';
  end if;
  raise exception 'Sin permiso para los encargos de Instagram' using errcode = '42501';
end;
$$;

revoke all on function public.instagram_programacion_permiso() from public;
revoke all on function public.instagram_campanas_permiso() from public;
revoke all on function public.instagram_render_permiso() from public;
revoke all on function public.instagram_render_permiso_trabajador() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_programacion_permiso() from anon, authenticated';
    execute 'revoke all on function public.instagram_campanas_permiso() from anon, authenticated';
    execute 'revoke all on function public.instagram_render_permiso() from anon, authenticated';
    execute 'revoke all on function public.instagram_render_permiso_trabajador() from anon, authenticated';
  end if;
end;
$$;

drop function if exists public.instagram_video_reclamar_caducados(integer, integer, integer);
drop function if exists public.instagram_agencia_puede_subir(text, text);
drop function if exists public.instagram_agencia_puede_leer(text, text);
drop function if exists public.instagram_encargo_limites_subida(text);
drop function if exists public.instagram_render_puede_borrar(text);
drop function if exists public.instagram_render_puede_leer(text);
drop function if exists public.instagram_render_puede_subir(text);
drop function if exists public.instagram_objeto_bloqueado(text, text);

do $$ begin raise notice 'instagram_seguridad: deshecha'; end $$;

commit;
