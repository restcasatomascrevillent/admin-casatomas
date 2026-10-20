-- El panel ahora pagina Expedición de tickets de 7 en 7 (ya no hay selector 5/10/20);
-- la función rechazaba p_tamano=7 con "Paginación inválida".
create or replace function public.listar_cheques_regalo_v3(
  p_pagina integer default 0, p_busqueda text default '', p_tamano integer default 7,
  p_orden text default 'fecha_desc', p_estado text default 'todos',
  p_desde date default null, p_hasta date default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  respuesta jsonb;
  termino text := lower(trim(coalesce(p_busqueda, '')));
  hoy date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
begin
  -- Mismo control de acceso que el listado v2: solo usuarios con permiso Cheques.
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para consultar los cheques' using errcode = '42501';
  end if;
  if p_pagina is null or p_pagina < 0 or p_tamano is null or p_tamano not in (5,7,10,20) then
    raise exception 'Paginación inválida' using errcode = '22023';
  end if;
  if p_orden is null or p_orden not in ('fecha_desc','fecha_asc','importe_asc','importe_desc','comprador_asc','comprador_desc','caducidad_asc','caducidad_desc')
    or p_estado is null or p_estado not in ('todos','disponible','canjeado','caducado','cancelado') then
    raise exception 'Filtro u orden inválido' using errcode = '22023';
  end if;
  if p_desde > p_hasta then raise exception 'Rango de fechas inválido' using errcode = '22023'; end if;
  with expedidos as materialized (
    select c.*, coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz as fecha_listado,
      case when c.estado = 'cancelado' then 'cancelado'
        when coalesce(c.usado,false) then 'canjeado'
        when c.caduca_el < hoy then 'caducado' else 'disponible' end as estado_listado
    from public.cheques_regalo c
    where nullif(trim(c.codigo), '') is not null and c.estado in ('pagado','cancelado')
  ), filtrados as materialized (
    select * from expedidos
    where (termino = '' or position(termino in lower(codigo)) > 0
      or position(termino in lower(comprador_nombre)) > 0
      or position(termino in lower(coalesce(comprador_telefono,''))) > 0
      or position(termino in lower(comprador_email)) > 0)
      and (p_estado = 'todos' or estado_listado = p_estado)
      and (p_desde is null or fecha_listado >= (p_desde::timestamp at time zone 'Europe/Madrid'))
      and (p_hasta is null or fecha_listado < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid'))
  ), ordenados as (
    select c.*, row_number() over (order by
      case when p_orden = 'fecha_desc' then fecha_listado end desc nulls last,
      case when p_orden = 'fecha_asc' then fecha_listado end asc nulls last,
      case when p_orden = 'importe_desc' then importe_eur end desc nulls last,
      case when p_orden = 'importe_asc' then importe_eur end asc nulls last,
      case when p_orden = 'comprador_desc' then lower(comprador_nombre) end desc nulls last,
      case when p_orden = 'comprador_asc' then lower(comprador_nombre) end asc nulls last,
      case when p_orden = 'caducidad_desc' then caduca_el end desc nulls last,
      case when p_orden = 'caducidad_asc' then caduca_el end asc nulls last,
      id desc
    ) as posicion from filtrados c
  ), pagina as (
    select id, fecha_listado as creado_en, codigo, importe_eur, comprador_nombre, comprador_telefono,
      destinatario_nombre, estado, usado, origen, emitido_en, caduca_el, posicion
    from ordenados order by posicion limit p_tamano offset p_pagina::bigint * p_tamano
  )
  select jsonb_build_object(
    'total', (select count(*) from expedidos),
    'expedidos', (select count(*) from expedidos),
    'canjeados', (select count(*) from expedidos where coalesce(usado,false)),
    'caducados', (select count(*) from expedidos where estado_listado = 'caducado'),
    'disponibles', (select count(*) from expedidos where estado_listado = 'disponible'),
    'coincidencias', (select count(*) from filtrados),
    'importe_pagado', (select coalesce(sum(importe_eur),0) from expedidos where estado = 'pagado' and pago_manual_metodo is distinct from 'cortesia'),
    'tickets', coalesce((select jsonb_agg(to_jsonb(t) - 'posicion' order by posicion) from pagina t), '[]'::jsonb)
  ) into respuesta;
  return respuesta;
end;
$$;
revoke all on function public.listar_cheques_regalo_v3(integer,text,integer,text,text,date,date) from public, anon;
grant execute on function public.listar_cheques_regalo_v3(integer,text,integer,text,text,date,date) to authenticated;
notify pgrst, 'reload schema';
