begin;
create function public.oficiososia_facturacion_eliminar(p_id uuid,p_estado text,p_version timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_version timestamptz;
begin
 if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
 if p_estado not in ('emitida','borrador') or p_estado is null then raise exception 'Estado inválido'; end if;
 perform pg_catalog.pg_advisory_xact_lock(610031600);
 if p_estado='emitida' then
  select actualizado_en into v_version from public.oficiososia_facturas where id=p_id for update;
 else
  select actualizado_en into v_version from public.oficiososia_borradores where id=p_id for update;
 end if;
 if v_version is null then raise exception 'La factura o el borrador ya no existe. Recarga la lista.'; end if;
 if v_version is distinct from p_version then raise exception 'El documento ha cambiado. Recarga antes de eliminar.'; end if;
 if p_estado='emitida' then
  update public.oficiososia_borradores set factura_id=null,actualizado_en=clock_timestamp() where factura_id=p_id;
  delete from public.oficiososia_facturas where id=p_id;
 else
  delete from public.oficiososia_borradores where id=p_id;
 end if;
 return public.oficiososia_facturacion_leer();
end;
$$;
revoke all on function public.oficiososia_facturacion_eliminar(uuid,text,timestamptz) from public;
grant execute on function public.oficiososia_facturacion_eliminar(uuid,text,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
