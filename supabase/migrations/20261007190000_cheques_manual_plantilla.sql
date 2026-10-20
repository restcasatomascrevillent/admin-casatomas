-- Cheques expedidos, ficha privada del comprador y plantilla del regalo.
create table if not exists public.plantilla_cheques_regalo (
  id boolean primary key default true check (id),
  email_asunto text not null default 'Tu cheque regalo de Casa Tomás' check (length(email_asunto) between 1 and 200),
  email_mensaje text not null default E'Hola {comprador},\n\nGracias por regalar un momento en Casa Tomás. Tu cheque {codigo} ya está listo.\nAdjuntamos el PDF para imprimirlo o compartirlo.' check (length(email_mensaje) between 1 and 3000),
  pdf_titulo text not null default 'Cheque regalo' check (length(pdf_titulo) between 1 and 80),
  pdf_subtitulo text not null default 'Un momento para disfrutar de Casa Tomás' check (length(pdf_subtitulo) <= 160),
  pdf_instrucciones text not null default 'Presenta este cheque, impreso o en el móvil, al pagar en Casa Tomás. El código solo puede canjearse una vez.' check (length(pdf_instrucciones) <= 800),
  pdf_pie text not null default E'C/ Santa María de la Cabeza, 2 · Crevillent, Alicante\n966 10 78 87 · restaurantecasatomascrevillente.es' check (length(pdf_pie) <= 400),
  logo_data text not null default '' check (length(logo_data) <= 300000),
  color_acento text not null default '#795440' check (color_acento ~ '^#[0-9a-fA-F]{6}$'),
  color_fondo text not null default '#faf7f1' check (color_fondo ~ '^#[0-9a-fA-F]{6}$'),
  actualizado_en timestamptz not null default now()
);
insert into public.plantilla_cheques_regalo(id, logo_data)
select true, coalesce((select logo_data from public.plantilla_factura_cheques where id), '')
on conflict (id) do nothing;
alter table public.plantilla_cheques_regalo enable row level security;
revoke all on public.plantilla_cheques_regalo from public, anon, authenticated;
grant select, update on public.plantilla_cheques_regalo to authenticated;
grant all on public.plantilla_cheques_regalo to service_role;
create policy "Consultar plantilla regalo" on public.plantilla_cheques_regalo for select to authenticated
using (coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false));
create policy "Editar plantilla regalo" on public.plantilla_cheques_regalo for update to authenticated
using (coalesce(public.has_section_permission(auth.uid(), 'cheques', 'edit'), false))
with check (coalesce(public.has_section_permission(auth.uid(), 'cheques', 'edit'), false));

alter table public.cheques_regalo
  add column if not exists origen text not null default 'web' check (origen in ('web','manual')),
  add column if not exists pago_manual_metodo text check (pago_manual_metodo in ('efectivo','tarjeta','transferencia','cortesia')),
  add column if not exists ocultar_importe boolean not null default false,
  add column if not exists creado_por uuid references auth.users(id),
  add column if not exists solicitud_manual_id uuid unique,
  add column if not exists plantilla_cheque jsonb;

create or replace function public.listar_cheques_regalo_v2(p_pagina integer default 0, p_busqueda text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare respuesta jsonb; termino text := lower(trim(coalesce(p_busqueda, '')));
begin
  if not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
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
    'coincidencias', (select count(*) from filtrados),
    'importe_pagado', (select coalesce(sum(importe_eur),0) from expedidos where estado = 'pagado' and pago_manual_metodo is distinct from 'cortesia'),
    'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id, coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at') as creado_en,
        codigo, importe_eur, comprador_nombre, comprador_telefono, destinatario_nombre, estado, usado, origen
      from filtrados c
      order by coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at')::timestamptz desc nulls last, id desc
      limit 50 offset p_pagina::bigint * 50
    ) t), '[]'::jsonb)
  ) into respuesta;
  return respuesta;
end $$;

create or replace function public.detalle_cheque_regalo(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo; f public.facturas_cheques;
begin
  if not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'view'), false) then
    raise exception 'No tienes permiso para consultar los cheques' using errcode = '42501';
  end if;
  select * into c from public.cheques_regalo where id = p_id and nullif(trim(codigo), '') is not null;
  if not found then raise exception 'Cheque no encontrado'; end if;
  select * into f from public.facturas_cheques where cheque_id = c.id;
  return (to_jsonb(c) - 'plantilla_cheque' - 'solicitud_manual_id') || jsonb_build_object(
    'creado_en', coalesce(to_jsonb(c)->>'creado_en', to_jsonb(c)->>'created_at'),
    'factura_numero', f.numero, 'factura_emitida_en', f.emitida_en);
end $$;

-- Transacción idempotente: reintentar una compra manual nunca genera otro código.
-- El navegador no puede establecer un código ni marcar compras web como pagadas.
create or replace function public.crear_cheque_manual(p_solicitud_id uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo; importe numeric; metodo text; nombre text; email text; intento integer;
begin
  if not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'edit'), false) then
    raise exception 'No tienes permiso para expedir cheques' using errcode = '42501';
  end if;
  if p_solicitud_id is null or jsonb_typeof(p_datos) is distinct from 'object' then raise exception 'Compra inválida'; end if;
  select * into c from public.cheques_regalo where solicitud_manual_id = p_solicitud_id;
  if found then
    if c.creado_por is distinct from auth.uid() then raise exception 'Solicitud no autorizada' using errcode = '42501'; end if;
    return to_jsonb(c);
  end if;
  importe := (p_datos->>'importe_eur')::numeric;
  nombre := trim(coalesce(p_datos->>'comprador_nombre',''));
  email := trim(coalesce(p_datos->>'comprador_email',''));
  metodo := p_datos->>'pago_manual_metodo';
  if importe is null or importe < 10 or importe > 1000 or importe <> round(importe, 2) then
    raise exception 'El importe debe estar entre 10 y 1000 euros, con un máximo de dos decimales';
  end if;
  if length(nombre) not between 1 and 200 or length(email) > 320 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Completa el nombre y un email válido del comprador';
  end if;
  if metodo is null or metodo not in ('efectivo','tarjeta','transferencia','cortesia') then raise exception 'Selecciona el método de pago'; end if;
  if coalesce(length(p_datos->>'comprador_telefono'),0) > 40
    or coalesce(length(p_datos->>'destinatario_nombre'),0) > 200
    or coalesce(length(p_datos->>'mensaje'),0) > 500 then raise exception 'Datos demasiado largos'; end if;
  for intento in 1..5 loop
    begin
      insert into public.cheques_regalo(importe_eur, comprador_nombre, comprador_email, comprador_telefono,
        destinatario_nombre, mensaje, fecha_entrega_deseada, estado, codigo, origen, pago_manual_metodo,
        ocultar_importe, creado_por, solicitud_manual_id, plantilla_cheque)
      values (importe, nombre, email, nullif(trim(p_datos->>'comprador_telefono'),''),
        nullif(trim(p_datos->>'destinatario_nombre'),''), nullif(trim(p_datos->>'mensaje'),''),
        nullif(p_datos->>'fecha_entrega_deseada','')::date, 'pagado',
        'CT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)), 'manual', metodo,
        coalesce((p_datos->>'ocultar_importe')::boolean,false), auth.uid(), p_solicitud_id,
        (select to_jsonb(p) from public.plantilla_cheques_regalo p where id))
      on conflict (solicitud_manual_id) do nothing returning * into c;
      if c.id is null then
        select * into c from public.cheques_regalo where solicitud_manual_id = p_solicitud_id;
        if c.creado_por is distinct from auth.uid() then raise exception 'Solicitud no autorizada' using errcode = '42501'; end if;
      end if;
      return to_jsonb(c);
    exception when unique_violation then
      if intento = 5 then raise exception 'No se pudo generar un código único'; end if;
    end;
  end loop;
end $$;

revoke all on function public.listar_cheques_regalo_v2(integer,text), public.detalle_cheque_regalo(uuid), public.crear_cheque_manual(uuid,jsonb) from public, anon;
grant execute on function public.listar_cheques_regalo_v2(integer,text), public.detalle_cheque_regalo(uuid), public.crear_cheque_manual(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
