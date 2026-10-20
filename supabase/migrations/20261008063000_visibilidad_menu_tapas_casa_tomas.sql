-- Visibilidad independiente de las dos tarjetas de Casa Tomás.
-- Reutiliza configuracion_web, su identidad updated_by y su auditoría.
begin;

alter table public.configuracion_web
  add column if not exists mostrar_menu_dia_casa_tomas boolean not null default true,
  add column if not exists mostrar_tapas_casa_tomas boolean not null default true;

create or replace function public.configuracion_web_visibilidad_menu_tapas(p_seccion text, p_mostrar boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.can_write_section('gestion_web') is not true then
    raise exception 'No tienes permiso para gestionar el menú y las tapas de la web.' using errcode = '42501';
  end if;
  if p_mostrar is null then
    raise exception 'La visibilidad es obligatoria.' using errcode = '22004';
  end if;
  if p_seccion = 'menu' then
    update public.configuracion_web set mostrar_menu_dia_casa_tomas = p_mostrar where id = true;
  elsif p_seccion = 'tapas' then
    update public.configuracion_web set mostrar_tapas_casa_tomas = p_mostrar where id = true;
  else
    raise exception 'Sección no válida.' using errcode = '22023';
  end if;
  if not found then
    raise exception 'No existe la configuración de la web.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.configuracion_web_visibilidad_menu_tapas(text, boolean) from public, anon;
grant execute on function public.configuracion_web_visibilidad_menu_tapas(text, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
