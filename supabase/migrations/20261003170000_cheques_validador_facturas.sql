-- Cheques vendidos por la web y gestionados desde el panel.
-- Compatible con la tabla ya utilizada por Stripe en producción.
create table if not exists public.cheques_regalo (
  id uuid primary key default gen_random_uuid(),
  creado_en timestamptz not null default now(),
  importe_eur numeric(10,2) not null check (importe_eur >= 10 and importe_eur <= 1000),
  comprador_nombre text not null,
  comprador_email text not null,
  comprador_telefono text,
  destinatario_nombre text,
  mensaje text,
  fecha_entrega_deseada date,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagado','cancelado')),
  codigo text unique,
  usado boolean not null default false,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  email_enviado_en timestamptz
);
alter table public.cheques_regalo
  add column if not exists solicita_factura boolean not null default false,
  add column if not exists datos_factura jsonb,
  add column if not exists canjeado_en timestamptz,
  add column if not exists canjeado_por uuid references auth.users(id);
alter table public.cheques_regalo enable row level security;
revoke all on public.cheques_regalo from public, anon, authenticated;
grant all on public.cheques_regalo to service_role;

create table public.plantilla_factura_cheques (
  id boolean primary key default true check (id),
  emisor_nombre text not null default '' check (length(emisor_nombre) <= 200),
  emisor_nif text not null default '' check (length(emisor_nif) <= 30),
  emisor_direccion text not null default '' check (length(emisor_direccion) <= 300),
  logo_data text not null default '' check (length(logo_data) <= 300000),
  iva_porcentaje numeric(5,2) not null default 0 check (iva_porcentaje between 0 and 100),
  pie text not null default 'Importe correspondiente al cheque regalo.' check (length(pie) <= 500),
  actualizado_en timestamptz not null default now()
);
insert into public.plantilla_factura_cheques(id) values (true);
alter table public.plantilla_factura_cheques enable row level security;
create policy "Lectura plantilla cheques" on public.plantilla_factura_cheques for select to authenticated
using (public.has_section_permission(auth.uid(), 'cheques', 'view'));
create policy "Edicion plantilla cheques" on public.plantilla_factura_cheques for update to authenticated
using (public.has_section_permission(auth.uid(), 'cheques', 'edit'))
with check (public.has_section_permission(auth.uid(), 'cheques', 'edit'));
grant select, update on public.plantilla_factura_cheques to authenticated;
revoke all on public.plantilla_factura_cheques from anon;

create sequence public.facturas_cheques_numero_seq;
create table public.facturas_cheques (
  id uuid primary key default gen_random_uuid(),
  cheque_id uuid not null unique references public.cheques_regalo(id),
  numero text not null unique default ('CT-' || lpad(nextval('public.facturas_cheques_numero_seq')::text, 8, '0')),
  emitida_en timestamptz not null default now(),
  emisor jsonb not null,
  cliente jsonb not null,
  importe_eur numeric(10,2) not null,
  iva_porcentaje numeric(5,2) not null,
  email_enviado_en timestamptz
);
alter table public.facturas_cheques enable row level security;
create policy "Lectura facturas cheques" on public.facturas_cheques for select to authenticated
using (public.has_section_permission(auth.uid(), 'cheques', 'view'));
grant select on public.facturas_cheques to authenticated;
revoke all on public.facturas_cheques from anon;

-- Acceso exclusivamente por RPC: no se concede acceso público a códigos,
-- emails ni datos personales. La comprobación es independiente del navegador.
create or replace function public.verificar_cheque_regalo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo;
begin
  if not public.has_section_permission(auth.uid(), 'cheques', 'view') then
    raise exception 'No tienes permiso para verificar cheques' using errcode = '42501';
  end if;
  select * into c from public.cheques_regalo where codigo = upper(trim(p_codigo));
  if not found then return jsonb_build_object('encontrado', false); end if;
  return jsonb_build_object('encontrado', true, 'codigo', c.codigo,
    'importe_eur', c.importe_eur, 'destinatario_nombre', c.destinatario_nombre,
    'estado', c.estado, 'usado', c.usado, 'canjeado_en', c.canjeado_en,
    'valido', c.estado = 'pagado' and not coalesce(c.usado, false));
end $$;
create or replace function public.canjear_cheque_regalo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo;
begin
  if not public.has_section_permission(auth.uid(), 'cheques', 'edit') then
    raise exception 'No tienes permiso para canjear cheques' using errcode = '42501';
  end if;
  update public.cheques_regalo set usado = true, canjeado_en = now(), canjeado_por = auth.uid()
    where codigo = upper(trim(p_codigo)) and estado = 'pagado' and not coalesce(usado, false)
    returning * into c;
  if not found then raise exception 'El cheque no es válido o ya ha sido canjeado'; end if;
  return public.verificar_cheque_regalo(c.codigo);
end $$;
revoke all on function public.verificar_cheque_regalo(text), public.canjear_cheque_regalo(text) from public, anon;
grant execute on function public.verificar_cheque_regalo(text), public.canjear_cheque_regalo(text) to authenticated;

-- Solo el webhook autenticado con service_role puede emitir una factura.
-- El bloqueo de la fila evita dos facturas en eventos simultáneos de Stripe.
create or replace function public.emitir_factura_cheque(p_cheque_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo; p public.plantilla_factura_cheques; f public.facturas_cheques;
begin
  select * into c from public.cheques_regalo where id = p_cheque_id for update;
  if not found or c.estado <> 'pagado' then raise exception 'Cheque no pagado'; end if;
  if not c.solicita_factura then return null; end if;
  select * into f from public.facturas_cheques where cheque_id = c.id;
  if found then return to_jsonb(f); end if;
  select * into p from public.plantilla_factura_cheques where id = true;
  if not found or p.emisor_nombre = '' or p.emisor_nif = '' or p.emisor_direccion = '' then
    raise exception 'Configura los datos fiscales del emisor en la plantilla de factura';
  end if;
  if c.datos_factura is null or coalesce(c.datos_factura->>'nombre','') = ''
    or coalesce(c.datos_factura->>'nif','') = '' or coalesce(c.datos_factura->>'direccion','') = '' then
    raise exception 'Faltan los datos fiscales del comprador';
  end if;
  insert into public.facturas_cheques(cheque_id, emisor, cliente, importe_eur, iva_porcentaje)
    values (c.id, to_jsonb(p), c.datos_factura || jsonb_build_object('email', c.comprador_email),
      c.importe_eur, p.iva_porcentaje) returning * into f;
  return to_jsonb(f);
end $$;
revoke all on function public.emitir_factura_cheque(uuid) from public, anon, authenticated;
grant execute on function public.emitir_factura_cheque(uuid) to service_role;
grant all on public.facturas_cheques, public.plantilla_factura_cheques to service_role;
grant usage, select on sequence public.facturas_cheques_numero_seq to service_role;

insert into public.admin_feature_toggles(section_key, label, enabled)
values ('cheques', 'Cheques regalo', true) on conflict (section_key) do nothing;

