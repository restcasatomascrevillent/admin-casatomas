-- ROLLBACK de migrations/20261030153000_novedades_limpiar_foto_con_secreto.sql (CT-REM-FN-11).
-- A mano. NO restaura la versión de web-casatomas (apuntaba al proyecto viejo
-- y sin secreto): deja el trigger encolando rutas SIN avisar a la función.
-- Las fotos quedan en public.novedades_fotos_por_borrar hasta que se vuelva a
-- aplicar la migración (o se llame a la función a mano con el secreto).
begin;
create or replace function public.novedades_limpiar_foto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruta text;
begin
  if tg_op = 'UPDATE' and new.imagen_url is not distinct from old.imagen_url then
    return null;
  end if;
  v_ruta := substring(old.imagen_url from '/storage/v1/object/public/novedades/([^?#]+)');
  if v_ruta is null then
    return null;
  end if;
  insert into public.novedades_fotos_por_borrar (ruta) values (v_ruta)
  on conflict (ruta) do nothing;
  return null;
end;
$$;
revoke all on function public.novedades_limpiar_foto() from public, anon, authenticated;
commit;
