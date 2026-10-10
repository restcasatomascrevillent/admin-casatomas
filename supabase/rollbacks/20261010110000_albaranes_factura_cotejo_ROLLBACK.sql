set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de 20261010110000_albaranes_factura_cotejo
-- ===========================================================================
-- Devuelve vincular_albaranes_proveedor(bigint) a su definición EXACTA de
-- 20261008120000_chatbot_ronda8_cocinero (comprueba el md5 sin CR al final),
-- borra las 5 RPC nuevas y la columna facturas.facturado_origen.
-- OJO: los vínculos hechos a mano se quedan como están en facturado_en_id
-- (ya sin marca de «manual»): el siguiente cambio de un documento de ese
-- proveedor los recalcula con el vínculo automático y pueden desaparecer.
-- Los desvinculados a mano vuelven a vincularse en ese momento.
-- Se puede ejecutar dos veces.
--   npx supabase db query --linked -f supabase/rollbacks/20261010110000_albaranes_factura_cotejo_ROLLBACK.sql
-- Imprime «albaranes_factura_cotejo: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

drop function if exists public.cotejo_factura_albaranes(bigint, bigint);
drop function if exists public.albaranes_candidatos(bigint, text);
drop function if exists public.facturas_candidatas(bigint);
drop function if exists public.vincular_albaran_factura(bigint, bigint, boolean);
drop function if exists public.desvincular_albaran(bigint);

CREATE OR REPLACE FUNCTION public.vincular_albaranes_proveedor(p_proveedor_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261008120000_chatbot_ronda8_cocinero: rehace facturado_en_id de los
-- albaranes de UN proveedor canónico. Vínculo: el número del albarán
-- normalizado = un albaran_ref normalizado de una línea de una factura del
-- mismo proveedor_id (la más reciente si hay varias).
declare
  n int;
begin
  if p_proveedor_id is null then
    return 0;
  end if;
  with v as (
    select a.id,
           (select fx.id
              from productos_factura l
              join facturas fx on fx.id = l.factura_id
             where fx.tipo = 'factura'
               and fx.proveedor_id = a.proveedor_id
               and numero_documento_normalizado(l.albaran_ref) = numero_documento_normalizado(a.numero_documento)
             order by fx.fecha desc nulls last, fx.id desc
             limit 1) as fid
      from facturas a
     where a.tipo = 'albaran' and a.proveedor_id = p_proveedor_id
  )
  update facturas a set facturado_en_id = v.fid
    from v
   where a.id = v.id and a.facturado_en_id is distinct from v.fid;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.vincular_albaranes_proveedor(bigint) from public, anon, authenticated;

alter table public.facturas drop column if exists facturado_origen;

do $$
begin
  if md5(replace(pg_get_functiondef('public.vincular_albaranes_proveedor(bigint)'::regprocedure), chr(13), ''))
     <> 'e3f4e12948c27a9d96915c5b7442bccf' then
    raise exception 'albaranes_factura_cotejo ROLLBACK: vincular_albaranes_proveedor no ha quedado como en 20261008120000. No se ha cambiado nada.';
  end if;
end;
$$;

commit;

select 'albaranes_factura_cotejo: revertida | '
       || (select count(*) from pg_proc
            where pronamespace = 'public'::regnamespace and prokind = 'f'
              and position('20261010110000_albaranes_factura_cotejo' in pg_get_functiondef(oid)) > 0) as resultado;
