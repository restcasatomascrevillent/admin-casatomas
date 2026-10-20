begin;
create table public.oficiososia_borradores (
 id uuid primary key,
 numero text not null,
 documento jsonb not null check(jsonb_typeof(documento)='object'),
 factura_id uuid references public.oficiososia_facturas(id) on delete set null,
 creado_en timestamptz not null default clock_timestamp(),
 actualizado_en timestamptz not null default clock_timestamp()
);
alter table public.oficiososia_borradores enable row level security;
create policy borradores_superadmin on public.oficiososia_borradores for select to authenticated
 using ((select public.is_super_admin((select auth.uid()))));
revoke all on public.oficiososia_borradores from anon, authenticated;
grant select on public.oficiososia_borradores to authenticated;
create or replace function public.oficiososia_facturacion_leer()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
 return jsonb_build_object(
 'config',(select to_jsonb(c) from public.oficiososia_facturacion_config c where c.id),
 'facturas',coalesce((select jsonb_agg(to_jsonb(f) order by f.creado_en desc) from public.oficiososia_facturas f),'[]'::jsonb),
 'borradores',coalesce((select jsonb_agg(to_jsonb(b) order by b.actualizado_en desc) from public.oficiososia_borradores b),'[]'::jsonb));
end;
$$;
create function public.oficiososia_facturacion_guardar_v2(
 p_documento jsonb,p_version_config timestamptz,
 p_id uuid default null,p_version_factura timestamptz default null,
 p_borrador_id uuid default null,p_version_borrador timestamptz default null,
 p_emitir boolean default false,p_factura_origen uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_resultado jsonb; v_borrador public.oficiososia_borradores;
begin
 if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
 perform pg_catalog.pg_advisory_xact_lock(610031600);
 if p_borrador_id is not null then
  select * into v_borrador from public.oficiososia_borradores where id=p_borrador_id for update;
  if v_borrador.actualizado_en is distinct from p_version_borrador then raise exception 'El borrador ha cambiado. Recarga antes de guardar.'; end if;
 end if;
 if p_emitir and p_id is null then raise exception 'Indica la factura a emitir'; end if;
 v_resultado:=public.oficiososia_facturacion_guardar(p_documento,p_version_config,
  case when p_emitir then p_id else null end,case when p_emitir then p_version_factura else null end);
 if p_borrador_id is not null then
  if p_emitir then
   delete from public.oficiososia_borradores where id=p_borrador_id;
  else
   insert into public.oficiososia_borradores(id,numero,documento,factura_id)
    values(p_borrador_id,btrim(coalesce(p_documento->>'numero','')),p_documento,p_factura_origen)
   on conflict(id) do update set numero=excluded.numero,documento=excluded.documento,
    factura_id=excluded.factura_id,actualizado_en=clock_timestamp();
  end if;
 end if;
 return v_resultado || jsonb_build_object('borrador',(select to_jsonb(b) from public.oficiososia_borradores b where b.id=p_borrador_id),'borrador_eliminado',case when p_emitir then p_borrador_id else null end);
end;
$$;
revoke all on function public.oficiososia_facturacion_guardar_v2(jsonb,timestamptz,uuid,timestamptz,uuid,timestamptz,boolean,uuid) from public;
grant execute on function public.oficiososia_facturacion_guardar_v2(jsonb,timestamptz,uuid,timestamptz,uuid,timestamptz,boolean,uuid) to authenticated;
-- Recupera el borrador anterior sin duplicar una factura ya emitida idéntica.
insert into public.oficiososia_borradores(id,numero,documento,factura_id)
 select gen_random_uuid(),coalesce(c.documento->>'numero',''),c.documento,f.id
 from public.oficiososia_facturacion_config c left join public.oficiososia_facturas f on f.numero=btrim(c.documento->>'numero')
 where f.id is null or f.documento is distinct from c.documento;
commit;
