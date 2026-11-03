-- ROLLBACK de 20261103160000_servicios_planes_costes.sql (Super Admin › Servicios:
-- planes, coste y uso de todos los servicios).
-- Aplicar a mano SOLO si hay que deshacerlo, y ANTES del rollback de
-- 20261103120000 si se quieren deshacer los dos. Borra:
--   · los 8 proveedores que sembró (y sus lecturas), con lo que el dueño
--     hubiera editado en ellos;
--   · las columnas categoria, orden, activo, por_confirmar, precio_anual y
--     fuente_precio de servicios_contratados y coste_variable de servicios_uso;
--   · servicios_config (el tipo de cambio guardado).
-- Deja servicios_metricas_supabase() como en 20261103120000. No toca ningún
-- secreto ni ninguna otra tabla. La función servicios-uso nueva sigue
-- respondiendo con la base vieja (lee «*» y guarda sin coste_variable).
begin;
set local lock_timeout = '5s';

delete from public.servicios_uso
 where proveedor in ('openai', 'vapi', 'google', 'google_drive', 'mapbox', 'perplexity', 'hostinger', 'loading');
delete from public.servicios_contratados
 where proveedor in ('openai', 'vapi', 'google', 'google_drive', 'mapbox', 'perplexity', 'hostinger', 'loading');

alter table public.servicios_uso drop constraint if exists servicios_uso_coste_chk;
alter table public.servicios_uso drop column if exists coste_variable;

alter table public.servicios_contratados drop constraint if exists servicios_contratados_categoria_chk;
alter table public.servicios_contratados drop constraint if exists servicios_contratados_orden_chk;
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_anual_chk;
alter table public.servicios_contratados drop constraint if exists servicios_contratados_fuente_precio_chk;
alter table public.servicios_contratados
  drop column if exists categoria,
  drop column if exists orden,
  drop column if exists activo,
  drop column if exists por_confirmar,
  drop column if exists precio_anual,
  drop column if exists fuente_precio;

drop table if exists public.servicios_config;
drop function if exists public.servicios_config_al_editar();

create or replace function public.servicios_uso_ultimas()
returns setof public.servicios_uso
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (u.proveedor) u.*
    from public.servicios_uso u
   order by u.proveedor, u.tomado_en desc;
$$;
revoke all on function public.servicios_uso_ultimas() from public, anon;
grant execute on function public.servicios_uso_ultimas() to authenticated, service_role;

-- servicios_metricas_supabase() tal y como la dejó 20261103120000.
create or replace function public.servicios_metricas_supabase()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mes timestamptz := date_trunc('month', now(), 'UTC');
  v_dia timestamptz := date_trunc('day', now(), 'UTC');
  v jsonb := jsonb_build_object(
    'bd_bytes', pg_database_size(current_database()),
    'mes_desde', v_mes,
    'dia_desde', v_dia
  );
  v_a bigint;
  v_b bigint;
begin
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum(case when (metadata ->> 'size') ~ '^[0-9]+$' then (metadata ->> 'size')::bigint else 0 end), 0)::bigint,
                      count(*)::bigint
                 from storage.objects$q$ into v_a, v_b;
    v := v || jsonb_build_object('storage_bytes', v_a, 'storage_objetos', v_b);
  end if;

  if to_regclass('auth.users') is not null then
    if to_regclass('auth.sessions') is not null then
      execute $q$select count(*)::bigint from auth.users u
                  where u.last_sign_in_at >= $1
                     or exists (select 1 from auth.sessions s where s.user_id = u.id and s.updated_at >= $1)$q$
        into v_a using v_mes;
    else
      execute $q$select count(*)::bigint from auth.users u where u.last_sign_in_at >= $1$q$ into v_a using v_mes;
    end if;
    execute $q$select count(*)::bigint from auth.users$q$ into v_b;
    v := v || jsonb_build_object('usuarios_activos_mes', v_a, 'usuarios_total', v_b);
  end if;

  if to_regclass('public.envios_email_reserva') is not null then
    execute $q$select count(*) filter (where coalesce(enviado_at, creado_at) >= $1)::bigint,
                      count(*) filter (where coalesce(enviado_at, creado_at) >= $2)::bigint
                 from public.envios_email_reserva
                where resultado = 'enviado'$q$
      into v_a, v_b using v_mes, v_dia;
    v := v || jsonb_build_object('correos_reservas_mes', v_a, 'correos_reservas_hoy', v_b);
  end if;

  if to_regclass('public.newsletter_envios') is not null then
    execute $q$select coalesce(sum(total_destinatarios) filter (where created_at >= $1), 0)::bigint,
                      coalesce(sum(total_destinatarios) filter (where created_at >= $2), 0)::bigint
                 from public.newsletter_envios
                where canal = 'transaccional' and estado in ('completado', 'parcial')$q$
      into v_a, v_b using v_mes, v_dia;
    v := v || jsonb_build_object('correos_newsletter_mes', v_a, 'correos_newsletter_hoy', v_b);
  end if;

  if to_regclass('public.newsletter_suscriptores') is not null then
    execute $q$select count(*)::bigint from public.newsletter_suscriptores where activo$q$ into v_a;
    v := v || jsonb_build_object('contactos_newsletter', v_a);
  end if;

  return v;
end;
$$;
revoke all on function public.servicios_metricas_supabase() from public, anon, authenticated;
grant execute on function public.servicios_metricas_supabase() to service_role;

commit;
