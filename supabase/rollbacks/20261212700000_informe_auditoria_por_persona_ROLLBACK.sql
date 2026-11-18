-- Vuelta atrás de 20261212700000_informe_auditoria_por_persona: deja la función como en
-- 20261205100100_informe_auditoria_rapido (sin el detalle por persona). Solo lectura: no hay datos que deshacer.
-- El panel de antes no lee los campos nuevos; el de después, sin ellos, pinta las fichas por persona vacías.
set lock_timeout = '5s';
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

  -- Leer audit_log es caro (cada página cuesta), así que:
  --  · «crudo» sale solo del índice idx_audit_log_informe_mensual, sin abrir la tabla;
  --  · qué tablas se ven se calcula una vez por tabla, no por fila (misma regla
  --    que la vista audit_log_visible: si cambia allí, cámbiala aquí);
  --  · el detalle (jsonb) solo se abre en las filas que pueden ser delicadas.
  with crudo as materialized (
    select a.id, a.created_at, a.actor_label, a.actor_origin, a.accion, a.tabla
    from public.audit_log a
    where a.created_at >= v_ini and a.created_at < v_fin
  ),
  tablas as materialized (
    select d.tabla, public.audit_tabla_util(d.tabla) as util from (select distinct tabla from crudo) d
  ),
  ev as materialized (
    select c.id, c.created_at, c.actor_label, c.actor_origin, c.accion, c.tabla,
           (c.created_at at time zone 'Europe/Madrid')::date as dia,
           extract(hour from c.created_at at time zone 'Europe/Madrid')::int as hora
    from crudo c join tablas t on t.tabla is not distinct from c.tabla
    where t.util or (c.tabla = 'conversaciones' and c.accion in ('crear','eliminar'))
  ),
  usr as (select * from ev where actor_origin = 'usuario'),
  trabajo as (select * from usr where accion in ('crear','actualizar','eliminar','ejecutar')),
  por_tabla as (
    select actor_label, tabla, count(*) n,
           row_number() over (partition by actor_label order by count(*) desc, tabla) rn
    from trabajo where tabla is not null and tabla not in ('accesos_panel') group by actor_label, tabla
  ),
  -- Tablas que tienen precio: solo en ellas puede haber un «cambiar_precio».
  con_precio as materialized (
    select c.relname::text as tabla
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attname = 'precio_eur' and not a.attisdropped
  ),
  -- Candidatas a delicada. Los tipos delicados los decide la vista a partir de
  -- la tabla y del detalle: permisos y roles (por tabla), bloqueos y
  -- credenciales (auth.users) y precios (tablas con precio_eur). Las acciones
  -- del servidor («ejecutar») no producen ninguno de esos tipos.
  candidatas as (
    select u.id from usr u
    where u.accion = 'eliminar'
       or u.tabla in ('user_permissions','user_roles','super_admins','auth.users')
       or (u.accion = 'actualizar' and u.tabla in (select p.tabla from con_precio p))
  ),
  delicadas as materialized (
    select e.created_at, e.actor_label, e.actor_origin, e.accion, e.tabla, e.tipo_evento,
           jsonb_build_object('antes', jsonb_strip_nulls(jsonb_build_object(
               'nombre', e.detalles->'antes'->>'nombre', 'precio_eur', e.detalles->'antes'->>'precio_eur',
               'section_key', e.detalles->'antes'->>'section_key', 'can_view', e.detalles->'antes'->>'can_view',
               'can_edit', e.detalles->'antes'->>'can_edit', 'role', e.detalles->'antes'->>'role', 'email', e.detalles->'antes'->>'email')),
             'despues', jsonb_strip_nulls(jsonb_build_object(
               'nombre', e.detalles->'despues'->>'nombre', 'precio_eur', e.detalles->'despues'->>'precio_eur',
               'section_key', e.detalles->'despues'->>'section_key', 'can_view', e.detalles->'despues'->>'can_view',
               'can_edit', e.detalles->'despues'->>'can_edit', 'role', e.detalles->'despues'->>'role', 'email', e.detalles->'despues'->>'email'))) as det
    from public.audit_log_visible e
    where e.id = any(array(select k.id from candidatas k))
      and (e.accion = 'eliminar'
           or e.tipo_evento in ('cambiar_precio','cambiar_permisos','cambiar_roles','bloquear_acceso','desbloquear_acceso','cambiar_credenciales'))
  ),
  precios as (select actor_label, count(*) n from delicadas where tipo_evento = 'cambiar_precio' group by actor_label),
  usuarios as (
    select u.actor_label as quien,
           count(*) filter (where u.accion in ('crear','actualizar','eliminar','ejecutar')) as acciones,
           count(distinct u.dia) as dias,
           max(u.created_at) as ultima,
           count(*) filter (where u.accion = 'eliminar') as borrados,
           coalesce((select p.n from precios p where p.actor_label = u.actor_label), 0) as precios,
           coalesce((select jsonb_agg(jsonb_build_object('tabla', t.tabla, 'n', t.n) order by t.n desc)
                     from por_tabla t where t.actor_label = u.actor_label and t.rn <= 3), '[]'::jsonb) as secciones
    from usr u where u.actor_label is not null group by u.actor_label
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
