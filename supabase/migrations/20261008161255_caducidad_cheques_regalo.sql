-- Un plazo configurable para nuevas emisiones y una fecha fija por cheque.
-- El último día es inclusivo y siempre se interpreta en Europe/Madrid.
alter table public.plantilla_cheques_regalo
  add column caducidad_meses integer not null default 12
  check (caducidad_meses between 1 and 120);

alter table public.cheques_regalo
  add column emitido_en timestamptz,
  add column caduca_el date;

-- Los cheques anteriores reciben el plazo por defecto desde su compra.
-- Nunca se recalculan cuando cambia la configuración del panel.
update public.cheques_regalo
set emitido_en = created_at,
    caduca_el = ((created_at at time zone 'Europe/Madrid')::date + interval '1 year')::date
where nullif(trim(codigo), '') is not null;

create schema if not exists private;
create or replace function private.cheques_controlar_caducidad()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare meses integer;
begin
  if tg_op = 'UPDATE' and old.caduca_el is not null then
    -- Reintentos de Stripe, reenvíos, canjes y cambios de plantilla no prorrogan el regalo.
    new.emitido_en := old.emitido_en;
    new.caduca_el := old.caduca_el;
  elsif new.estado = 'pagado' and nullif(trim(new.codigo), '') is not null then
    select caducidad_meses into meses from public.plantilla_cheques_regalo where id;
    if meses is null then raise exception 'No se ha configurado la caducidad de los cheques'; end if;
    new.emitido_en := clock_timestamp();
    new.caduca_el := ((new.emitido_en at time zone 'Europe/Madrid')::date + make_interval(months => meses))::date;
  else
    new.emitido_en := null;
    new.caduca_el := null;
  end if;

  -- Protege también cualquier otro camino que intente marcar el cheque como usado.
  if coalesce(new.usado, false) and (tg_op = 'INSERT' or not coalesce(old.usado, false)) then
    if new.estado <> 'pagado' or new.caduca_el is null then
      raise exception 'El cheque no es válido para canjear';
    end if;
    if new.caduca_el < (clock_timestamp() at time zone 'Europe/Madrid')::date then
      raise exception 'El cheque está caducado y no puede canjearse';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.cheques_controlar_caducidad() from public, anon, authenticated;
create trigger cheques_controlar_caducidad before insert or update on public.cheques_regalo
for each row execute function private.cheques_controlar_caducidad();

create or replace function public.verificar_cheque_regalo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo; hoy date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para verificar cheques' using errcode = '42501';
  end if;
  select * into c from public.cheques_regalo where codigo = upper(trim(p_codigo));
  if not found then return jsonb_build_object('encontrado', false); end if;
  return jsonb_build_object('encontrado', true, 'codigo', c.codigo,
    'importe_eur', c.importe_eur, 'destinatario_nombre', c.destinatario_nombre,
    'estado', c.estado, 'usado', c.usado, 'canjeado_en', c.canjeado_en,
    'caduca_el', c.caduca_el, 'emitido_en', c.emitido_en,
    'caducado', coalesce(c.caduca_el < hoy, false),
    'dias_restantes', case when c.caduca_el is not null then greatest(c.caduca_el - hoy, 0) end,
    'valido', c.estado = 'pagado' and not coalesce(c.usado, false)
      and c.caduca_el is not null and c.caduca_el >= hoy);
end $$;

create or replace function public.canjear_cheque_regalo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'edit'), false) then
    raise exception 'No tienes permiso para canjear cheques' using errcode = '42501';
  end if;
  -- La validez se comprueba dentro del UPDATE: una verificación antigua no autoriza el canje.
  update public.cheques_regalo set usado = true, canjeado_en = clock_timestamp(), canjeado_por = auth.uid()
    where codigo = upper(trim(p_codigo)) and estado = 'pagado' and not coalesce(usado, false)
      and caduca_el >= (clock_timestamp() at time zone 'Europe/Madrid')::date
    returning * into c;
  if not found then
    if exists (select 1 from public.cheques_regalo where codigo = upper(trim(p_codigo))
      and caduca_el < (clock_timestamp() at time zone 'Europe/Madrid')::date) then
      raise exception 'El cheque está caducado y no puede canjearse';
    end if;
    raise exception 'El cheque no es válido o ya ha sido canjeado';
  end if;
  return public.verificar_cheque_regalo(c.codigo);
end $$;

create or replace function public.listar_cheques_regalo_v2(p_pagina integer default 0, p_busqueda text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare respuesta jsonb; termino text := lower(trim(coalesce(p_busqueda, '')));
  hoy date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para consultar los cheques' using errcode = '42501';
  end if;
  if p_pagina is null or p_pagina < 0 then raise exception 'Página inválida'; end if;
  with expedidos as (
    select c.* from public.cheques_regalo c
    where nullif(trim(c.codigo), '') is not null and c.estado in ('pagado','cancelado')
  ), filtrados as (
    select * from expedidos where termino = ''
      or position(termino in lower(codigo)) > 0
      or position(termino in lower(comprador_nombre)) > 0
      or position(termino in lower(coalesce(comprador_telefono,''))) > 0
      or position(termino in lower(comprador_email)) > 0
  )
  select jsonb_build_object(
    'total', (select count(*) from expedidos),
    'expedidos', (select count(*) from expedidos),
    'canjeados', (select count(*) from expedidos where coalesce(usado,false)),
    'caducados', (select count(*) from expedidos where estado = 'pagado' and not coalesce(usado,false) and caduca_el < hoy),
    'disponibles', (select count(*) from expedidos where estado = 'pagado' and not coalesce(usado,false) and caduca_el >= hoy),
    'coincidencias', (select count(*) from filtrados),
    'importe_pagado', (select coalesce(sum(importe_eur),0) from expedidos where estado = 'pagado' and pago_manual_metodo is distinct from 'cortesia'),
    'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id, coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at') as creado_en,
        codigo, importe_eur, comprador_nombre, comprador_telefono, destinatario_nombre, estado, usado, origen,
        emitido_en, caduca_el, coalesce(caduca_el < hoy,false) as caducado,
        case when caduca_el is not null then greatest(caduca_el - hoy,0) end as dias_restantes
      from filtrados c
      order by coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz desc nulls last, id desc
      limit 50 offset p_pagina::bigint * 50
    ) t), '[]'::jsonb)
  ) into respuesta;
  return respuesta;
end $$;

revoke all on function public.verificar_cheque_regalo(text), public.canjear_cheque_regalo(text),
  public.listar_cheques_regalo_v2(integer,text) from public, anon;
grant execute on function public.verificar_cheque_regalo(text), public.canjear_cheque_regalo(text),
  public.listar_cheques_regalo_v2(integer,text) to authenticated;
notify pgrst, 'reload schema';
