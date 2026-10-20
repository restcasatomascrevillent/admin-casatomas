-- Solicitud de factura en compra manual: datos fiscales validados antes de expedir.
-- Se conservan código, datos y factura en todos los reintentos de una misma solicitud.
begin;
create or replace function public.crear_cheque_manual(p_solicitud_id uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo; importe numeric; metodo text; nombre text; email text; intento integer; solicita boolean; fiscales jsonb;
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
  solicita := coalesce((p_datos->>'solicita_factura')::boolean, false);
  if solicita then
    if metodo = 'cortesia' then raise exception 'Selecciona un método de cobro para solicitar factura'; end if;
    if jsonb_typeof(p_datos->'datos_factura') is distinct from 'object' then
      raise exception 'Completa los datos fiscales del comprador';
    end if;
    fiscales := jsonb_build_object('nombre', trim(coalesce(p_datos->'datos_factura'->>'nombre','')),
      'nif', trim(coalesce(p_datos->'datos_factura'->>'nif','')),
      'direccion', trim(coalesce(p_datos->'datos_factura'->>'direccion','')));
    if length(fiscales->>'nombre') not between 1 and 200
      or length(fiscales->>'nif') not between 1 and 30
      or length(fiscales->>'direccion') not between 1 and 300 then
      raise exception 'Completa nombre o razón social, NIF / CIF y dirección fiscal';
    end if;
    if not exists (select 1 from public.plantilla_factura_cheques where id
      and nullif(trim(emisor_nombre),'') is not null and nullif(trim(emisor_nif),'') is not null
      and nullif(trim(emisor_direccion),'') is not null) then
      raise exception 'Configura los datos fiscales del emisor en la plantilla de factura';
    end if;
  end if;
  for intento in 1..5 loop
    begin
      insert into public.cheques_regalo(importe_eur, comprador_nombre, comprador_email, comprador_telefono,
        destinatario_nombre, mensaje, fecha_entrega_deseada, estado, codigo, origen, pago_manual_metodo,
        ocultar_importe, creado_por, solicitud_manual_id, plantilla_cheque, solicita_factura, datos_factura)
      values (importe, nombre, email, nullif(trim(p_datos->>'comprador_telefono'),''),
        nullif(trim(p_datos->>'destinatario_nombre'),''), nullif(trim(p_datos->>'mensaje'),''),
        nullif(p_datos->>'fecha_entrega_deseada','')::date, 'pagado',
        'CT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)), 'manual', metodo,
        coalesce((p_datos->>'ocultar_importe')::boolean,false), auth.uid(), p_solicitud_id,
        (select to_jsonb(p) from public.plantilla_cheques_regalo p where id), solicita, fiscales)
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


create or replace function public.crear_cheque_manual_v2(p_solicitud_id uuid, p_datos jsonb)
returns jsonb language sql set search_path = public as $$
  select public.crear_cheque_manual(p_solicitud_id, p_datos);
$$;
revoke all on function public.crear_cheque_manual_v2(uuid,jsonb) from public, anon;
grant execute on function public.crear_cheque_manual_v2(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
