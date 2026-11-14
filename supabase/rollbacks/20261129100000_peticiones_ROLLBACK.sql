set client_encoding = 'UTF8';
-- Vuelta atrás de 20261129100000_peticiones.sql.
-- OJO: BORRA las peticiones guardadas (con su análisis) y sus avisos en la
-- campana. Las capturas del cubo «peticiones» NO se borran: vacíalo antes
-- desde Storage si se quiere liberar espacio (el cubo se borra solo si está
-- vacío). Deja `seccion_aviso` como en 20261124100000. Idempotente.
begin;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists peticiones_capturas_insert on storage.objects';
    execute 'drop policy if exists peticiones_capturas_select on storage.objects';
    if to_regclass('storage.buckets') is not null and not exists (select 1 from storage.objects where bucket_id = 'peticiones') then
      delete from storage.buckets where id = 'peticiones';
    end if;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.notificaciones_dashboard') is not null then
    delete from public.notificaciones_dashboard where tipo like 'peticion\_%';
    drop policy if exists notificaciones_peticiones_solo_super_admin on public.notificaciones_dashboard;
  end if;
end;
$$;

-- seccion_aviso tal cual la dejó 20261124100000_avisos_revisado_por_seccion.sql.
create or replace function public.seccion_aviso(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo in ('reserva_nueva', 'reserva_cancelada', 'reserva_sin_asignar', 'solicitud_pendiente') then 'reservas'
    when p_tipo like 'facturas\_%' or p_tipo in ('subida_precio', 'original_sin_drive') then 'facturas'
    else 'dashboard'
  end
$$;
revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- Primero la función: devuelve filas de la tabla (depende de su tipo).
drop function if exists public.peticion_reservar_analisis(uuid, boolean);
drop table if exists public.peticiones;
drop function if exists public.peticiones_avisar_urgente();
drop function if exists public.peticiones_al_cambiar();
drop function if exists public.peticiones_al_crear();
drop function if exists public.peticiones_ruta_captura_valida(text);

do $$
begin
  if to_regclass('public.ia_modelo_funcion') is not null then
    delete from public.ia_modelo_funcion where funcion = 'analizar-peticion';
  end if;
  if to_regclass('public.ia_funciones') is not null then
    delete from public.ia_funciones where funcion = 'analizar-peticion';
  end if;
end;
$$;

do $$ begin raise notice 'peticiones: revertida'; end $$;

commit;
