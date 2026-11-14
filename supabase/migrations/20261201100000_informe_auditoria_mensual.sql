set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261201100000_informe_auditoria_mensual — Informes › «Informe mensual de auditoría» (14/11/2026)
-- ===========================================================================
-- Resume el registro de auditoría de un mes (audit_log_visible, hora de Madrid)
-- para el informe del Super Admin: qué hace cada persona, cuándo se usa el
-- panel, las acciones delicadas (borrados, precios, permisos…) y, aparte, lo
-- que hace el sistema solo. Solo lectura. Solo super admin (como la pantalla
-- Auditoría). Vuelta atrás: supabase/rollbacks/20261201100000_informe_auditoria_mensual_ROLLBACK.sql.
begin;

create or replace function public.informe_auditoria_mensual(p_mes text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ini timestamptz;
  v_fin timestamptz;
  v_res jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.super_admins s where s.user_id = auth.uid()) then
    raise exception 'Solo el super admin puede generar el informe de auditoría' using errcode = '42501';
  end if;
  if p_mes is null or p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mes inválido (se espera AAAA-MM)' using errcode = '22023';
  end if;
  v_ini := (p_mes || '-01')::date::timestamp at time zone 'Europe/Madrid';
  v_fin := ((p_mes || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Madrid';

  with ev as materialized (
    select a.created_at, a.actor_user_id, a.actor_label, a.actor_origin, a.accion, a.tabla, a.tipo_evento, a.detalles,
           (a.created_at at time zone 'Europe/Madrid')::date as dia,
           extract(hour from a.created_at at time zone 'Europe/Madrid')::int as hora
    from public.audit_log_visible a
    where a.created_at >= v_ini and a.created_at < v_fin
  ),
  usr as (select * from ev where actor_origin = 'usuario'),
  trabajo as (select * from usr where accion in ('crear','actualizar','eliminar','ejecutar')),
  por_tabla as (
    select actor_label, tabla, count(*) n,
           row_number() over (partition by actor_label order by count(*) desc, tabla) rn
    from trabajo where tabla is not null and tabla not in ('accesos_panel') group by actor_label, tabla
  ),
  usuarios as (
    select u.actor_label as quien,
           count(*) filter (where u.accion in ('crear','actualizar','eliminar','ejecutar')) as acciones,
           count(distinct u.dia) as dias,
           max(u.created_at) as ultima,
           count(*) filter (where u.accion = 'eliminar') as borrados,
           count(*) filter (where u.tipo_evento = 'cambiar_precio') as precios,
           coalesce((select jsonb_agg(jsonb_build_object('tabla', t.tabla, 'n', t.n) order by t.n desc)
                     from por_tabla t where t.actor_label = u.actor_label and t.rn <= 3), '[]'::jsonb) as secciones
    from usr u where u.actor_label is not null group by u.actor_label
  ),
  delicadas as (
    select e.created_at, e.actor_label, e.actor_origin, e.accion, e.tabla, e.tipo_evento,
           jsonb_build_object('antes', jsonb_strip_nulls(jsonb_build_object(
               'nombre', e.detalles->'antes'->>'nombre', 'precio_eur', e.detalles->'antes'->>'precio_eur',
               'section_key', e.detalles->'antes'->>'section_key', 'can_view', e.detalles->'antes'->>'can_view',
               'can_edit', e.detalles->'antes'->>'can_edit', 'role', e.detalles->'antes'->>'role', 'email', e.detalles->'antes'->>'email')),
             'despues', jsonb_strip_nulls(jsonb_build_object(
               'nombre', e.detalles->'despues'->>'nombre', 'precio_eur', e.detalles->'despues'->>'precio_eur',
               'section_key', e.detalles->'despues'->>'section_key', 'can_view', e.detalles->'despues'->>'can_view',
               'can_edit', e.detalles->'despues'->>'can_edit', 'role', e.detalles->'despues'->>'role', 'email', e.detalles->'despues'->>'email'))) as det
    from ev e
    where e.actor_origin = 'usuario'
      and (e.accion = 'eliminar'
           or e.tipo_evento in ('cambiar_precio','cambiar_permisos','cambiar_roles','bloquear_acceso','desbloquear_acceso','cambiar_credenciales'))
  ),
  sistema as (
    select actor_label, tabla, accion, count(*) n from ev
    where actor_origin in ('servicio','base_de_datos') group by actor_label, tabla, accion
  )
  select jsonb_build_object(
    'usuarios', coalesce((select jsonb_agg(to_jsonb(u) order by u.acciones desc, u.quien) from usuarios u), '[]'::jsonb),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia)
                         from (select dia, count(*) n from trabajo group by dia) d), '[]'::jsonb),
    'por_hora', coalesce((select jsonb_agg(jsonb_build_object('hora', h.hora, 'n', h.n) order by h.hora)
                          from (select hora, count(*) n from trabajo group by hora) h), '[]'::jsonb),
    'delicadas_total', (select count(*) from delicadas),
    'delicadas', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
                           from (select * from delicadas order by created_at desc limit 300) x), '[]'::jsonb),
    'sistema', coalesce((select jsonb_agg(to_jsonb(s) order by s.n desc) from (select * from sistema order by n desc limit 40) s), '[]'::jsonb),
    'sistema_total', (select count(*) from ev where actor_origin in ('servicio','base_de_datos')),
    'accesos_fallidos', (select count(*) from ev where accion in ('login_fallido','acceso_denegado'))
  ) into v_res;
  return v_res;
end;
$$;

revoke all on function public.informe_auditoria_mensual(text) from public, anon;
grant execute on function public.informe_auditoria_mensual(text) to authenticated;

commit;
