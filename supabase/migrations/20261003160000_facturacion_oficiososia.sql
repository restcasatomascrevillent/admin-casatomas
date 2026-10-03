-- Facturación comercial de OficiosOsIA. No modifica las facturas de proveedores.
-- Aplicar antes de usar el guardado del Gestor de Gasto.
begin;
create table public.oficiososia_facturacion_config (
  id boolean primary key default true check (id),
  documento jsonb not null check (jsonb_typeof(documento) = 'object'),
  actualizado_en timestamptz not null default clock_timestamp()
);
create table public.oficiososia_facturas (
  id uuid primary key,
  numero text not null unique check (length(btrim(numero)) between 1 and 60),
  documento jsonb not null check (jsonb_typeof(documento) = 'object'),
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp()
);
alter table public.oficiososia_facturacion_config enable row level security;
alter table public.oficiososia_facturas enable row level security;
create policy config_superadmin on public.oficiososia_facturacion_config for select to authenticated
  using ((select public.is_super_admin((select auth.uid()))));
create policy facturas_superadmin on public.oficiososia_facturas for select to authenticated
  using ((select public.is_super_admin((select auth.uid()))));
revoke all on public.oficiososia_facturacion_config, public.oficiososia_facturas from anon, authenticated;
grant select on public.oficiososia_facturacion_config, public.oficiososia_facturas to authenticated;

create function public.oficiososia_facturacion_leer()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.oficiososia_facturacion_config c where c.id),
    'facturas', coalesce((select jsonb_agg(to_jsonb(f) order by f.creado_en desc) from public.oficiososia_facturas f), '[]'::jsonb)
  );
end;
$$;
create function public.oficiososia_facturacion_guardar(
  p_documento jsonb, p_version_config timestamptz,
  p_id uuid default null, p_version_factura timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_config public.oficiososia_facturacion_config;
  v_factura public.oficiososia_facturas;
  v_numero text;
begin
  if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
  if jsonb_typeof(p_documento) is distinct from 'object'
    or jsonb_typeof(p_documento->'lineas') is distinct from 'array'
    or octet_length(p_documento::text) > 200000 then
    raise exception 'Documento inválido';
  end if;
  if jsonb_array_length(p_documento->'lineas') not between 1 and 100 then raise exception 'Revisa los conceptos'; end if;
  -- Serializa el primer guardado y verifica versiones: no pisa ediciones de otro superadmin.
  perform pg_catalog.pg_advisory_xact_lock(610031600);
  select * into v_config from public.oficiososia_facturacion_config where id for update;
  if v_config.actualizado_en is distinct from p_version_config then
    raise exception 'La configuración ha cambiado. Recarga y revisa antes de guardar.';
  end if;
  if p_id is not null then
    v_numero := btrim(p_documento->>'numero');
    if v_numero is null or length(v_numero) not between 1 and 60 then raise exception 'Indica el número de factura'; end if;
    select * into v_factura from public.oficiososia_facturas where id = p_id for update;
    if v_factura.actualizado_en is distinct from p_version_factura then
      raise exception 'La factura ha cambiado. Recarga y revisa antes de guardar.';
    end if;
    insert into public.oficiososia_facturas (id, numero, documento, creado_por)
      values (p_id, v_numero, jsonb_set(p_documento, '{numero}', to_jsonb(v_numero)), auth.uid())
    on conflict (id) do update set numero = excluded.numero, documento = excluded.documento, actualizado_en = clock_timestamp();
  end if;
  insert into public.oficiososia_facturacion_config (id, documento)
    values (true, p_documento)
  on conflict (id) do update set documento = excluded.documento, actualizado_en = clock_timestamp();
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.oficiososia_facturacion_config c where c.id),
    'factura', (select to_jsonb(f) from public.oficiososia_facturas f where f.id = p_id)
  );
end;
$$;
revoke all on function public.oficiososia_facturacion_leer() from public;
revoke all on function public.oficiososia_facturacion_guardar(jsonb,timestamptz,uuid,timestamptz) from public;
grant execute on function public.oficiososia_facturacion_leer() to authenticated;
grant execute on function public.oficiososia_facturacion_guardar(jsonb,timestamptz,uuid,timestamptz) to authenticated;
commit;
