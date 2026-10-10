set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- 20261010110000_albaranes_factura_cotejo
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- POR QUÉ (petición del dueño, 10/10/2026): asociar los albaranes con su
-- factura (aunque sean muchos: Luga ML/101511 cita 7 albaranes en sus líneas)
-- y poder VERIFICAR lo que decía cada albarán mirando la factura, para llevar
-- mejor la revisión.
--
-- DEPENDE DE (aplicada): 20261008120000_chatbot_ronda8_cocinero
-- (facturas.facturado_en_id, numero_documento_normalizado, unidad_agente y
-- los triggers de vínculo automático).
--
-- QUÉ CAMBIA
--   · facturas.facturado_origen text check in ('auto','manual'):
--       'auto'   = lo puso el vínculo automático (número citado en albaran_ref);
--       'manual' = lo decidió una persona: vincular_albaran_factura (con
--                  factura) o desvincular_albaran (sin factura, aunque el
--                  número coincida). Los triggers NO pisan ni quitan un
--                  vínculo 'manual'.
--       null     = albarán sin vínculo automático (o factura).
--     Si se borra la factura de un vínculo 'manual', el FK deja
--     facturado_en_id a null y el albarán queda «sin factura (a mano)».
--   · vincular_albaranes_proveedor(bigint) (SECURITY DEFINER, sin EXECUTE
--     para nadie): igual que en la ronda 8 pero salta los 'manual' y pone
--     facturado_origen = 'auto' (o null si no encuentra factura). Antes de
--     reescribirla comprueba el md5 (sin CR) de la definición de producción.
--   · RPC nuevas (SECURITY INVOKER: la RLS de facturas manda; las de
--     escritura exigen además can_write_section('facturas')):
--       vincular_albaran_factura(p_albaran_id, p_factura_id, p_forzar=false)
--         albarán → factura; mismo proveedor_id salvo p_forzar.
--       desvincular_albaran(p_albaran_id)  → sin factura, 'manual'.
--       albaranes_candidatos(p_factura_id, p_texto=null)
--         sin texto: albaranes sin factura del mismo proveedor con fecha entre
--         60 días antes y 15 después de la factura (o citados en ella),
--         citados primero y luego por cercanía; con texto: albaranes sin
--         factura de cualquier proveedor cuyo número o proveedor lo contenga.
--       facturas_candidatas(p_albaran_id): facturas del mismo proveedor, la
--         que cita el albarán primero y luego por cercanía de fecha.
--       cotejo_factura_albaranes(p_factura_id, p_albaran_id=null) → jsonb:
--         albaranes vinculados {id, numero, fecha, total, base, lineas,
--         citado_en_factura, origen}; albaranes_no_subidos (citados en las
--         líneas y sin albarán en la base) y albaranes_sin_vincular (existen
--         pero no están vinculados a esta factura); resumen {suma_albaranes,
--         total_factura_base, diferencia, base_citada_sin_albaran,
--         diferencia_sin_explicar, …}; productos (producto_id o descripción
--         normalizada + unidad) con en_albaranes / en_factura {cantidad,
--         importe, precio}, diferencia_cantidad, diferencia_importe,
--         diferencia_precio_pct y estado ok | precio_distinto |
--         cantidad_distinta | solo_albaran | solo_factura (tolerancias:
--         precio ±1 %, cantidad ±0,5 %; un albarán sin precios solo coteja
--         cantidades). Las líneas de la factura que citan un albarán no
--         vinculado no entran en el cotejo por producto (van en base_citada_
--         sin_albaran). Con p_albaran_id: solo ese albarán, contra las líneas
--         de la factura que lo citan o, si no lo cita ninguna, contra los
--         mismos productos (modo 'por_producto').
--   Importes SIN IVA (base). Idempotente: se puede ejecutar dos veces.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261010110000_albaranes_factura_cotejo.sql
--      Tiene que imprimir «albaranes_factura_cotejo: aplicada | albaranes N |
--      vinculados auto N | manual 0 | Luga ML/101511 cita 7, no subidos 7».
--      Simulacro con ROLLBACK contra producción el 10/10/2026: migración (dos
--      veces) + 3 albaranes de Luga subidos a mano en la transacción + test +
--      rollback OK.
--   2. npx supabase db query --linked -f supabase/tests/albaranes_factura_cotejo_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «albaranes_factura_cotejo_test: OK».
--   Deshacer: supabase/rollbacks/20261010110000_albaranes_factura_cotejo_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobación previa ────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if to_regprocedure('public.numero_documento_normalizado(text)') is null
     or to_regprocedure('public.unidad_agente(text)') is null
     or to_regprocedure('public.normalizar_texto(text)') is null
     or to_regprocedure('public.can_write_section(text)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'facturas' and column_name = 'facturado_en_id') then
    raise exception 'albaranes_factura_cotejo: falta 20261008120000_chatbot_ronda8_cocinero. No se ha cambiado nada.';
  end if;
  v_def := replace(pg_get_functiondef(to_regprocedure('public.vincular_albaranes_proveedor(bigint)')), chr(13), '');
  if v_def is null then
    raise exception 'albaranes_factura_cotejo: no existe vincular_albaranes_proveedor(bigint). No se ha cambiado nada.';
  end if;
  if md5(v_def) <> 'e3f4e12948c27a9d96915c5b7442bccf'
     and position('20261010110000_albaranes_factura_cotejo' in v_def) = 0 then
    raise exception 'albaranes_factura_cotejo: vincular_albaranes_proveedor no es la esperada (md5 %). No se ha cambiado nada.', md5(v_def);
  end if;
end;
$$;

-- ─── 1. Columna facturado_origen ───────────────────────────────────────────
alter table public.facturas add column if not exists facturado_origen text;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.facturas'::regclass and conname = 'facturas_facturado_origen_check') then
    alter table public.facturas
      add constraint facturas_facturado_origen_check check (facturado_origen in ('auto', 'manual'));
  end if;
end;
$$;
comment on column public.facturas.facturado_origen is
  'Albarán: quién decidió facturado_en_id. auto = vínculo automático (albaran_ref de las líneas de la factura); '
  'manual = una persona (vincular_albaran_factura, o desvincular_albaran: sin factura aunque el número coincida). '
  'Los triggers de vínculo no tocan los manual (20261010110000).';

-- Los vínculos que ya hay los puso el automático.
update public.facturas set facturado_origen = 'auto'
 where tipo = 'albaran' and facturado_en_id is not null and facturado_origen is null;

-- ─── 2. Vínculo automático: respeta los manuales ───────────────────────────
CREATE OR REPLACE FUNCTION public.vincular_albaranes_proveedor(p_proveedor_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261010110000_albaranes_factura_cotejo (antes 20261008120000): rehace
-- facturado_en_id de los albaranes de UN proveedor canónico SIN tocar los
-- vinculados o desvinculados a mano (facturado_origen = 'manual'). Vínculo: el
-- número del albarán normalizado = un albaran_ref normalizado de una línea de
-- una factura del mismo proveedor_id (la más reciente si hay varias).
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
       and a.facturado_origen is distinct from 'manual'
  )
  update facturas a
     set facturado_en_id = v.fid,
         facturado_origen = case when v.fid is null then null else 'auto' end
    from v
   where a.id = v.id
     and (a.facturado_en_id is distinct from v.fid
          or a.facturado_origen is distinct from case when v.fid is null then null else 'auto' end);
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.vincular_albaranes_proveedor(bigint) from public, anon, authenticated;

-- ─── 3. Vincular / desvincular a mano ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vincular_albaran_factura(p_albaran_id bigint, p_factura_id bigint, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
-- 20261010110000_albaranes_factura_cotejo: el albarán queda recogido en esa
-- factura (facturado_origen = 'manual': los triggers ya no lo cambian).
declare
  a record;
  f record;
begin
  if not (can_write_section('facturas') or current_user in ('postgres', 'service_role')) then
    raise exception 'No tienes permiso para editar facturas.' using errcode = '42501';
  end if;
  select id, tipo, proveedor_id, facturado_en_id into a from facturas where id = p_albaran_id;
  if not found then
    raise exception 'No existe el albarán %.', p_albaran_id using errcode = 'P0002';
  end if;
  if a.tipo <> 'albaran' then
    raise exception 'El documento % no es un albarán.', p_albaran_id using errcode = '22023';
  end if;
  select id, tipo, proveedor_id into f from facturas where id = p_factura_id;
  if not found then
    raise exception 'No existe la factura %.', p_factura_id using errcode = 'P0002';
  end if;
  if f.tipo <> 'factura' then
    raise exception 'El documento % no es una factura.', p_factura_id using errcode = '22023';
  end if;
  if a.proveedor_id is distinct from f.proveedor_id and not coalesce(p_forzar, false) then
    raise exception 'El albarán y la factura son de proveedores distintos.'
      using errcode = '22023', hint = 'proveedor_distinto';
  end if;
  update facturas set facturado_en_id = f.id, facturado_origen = 'manual' where id = a.id;
  return jsonb_build_object('ok', true, 'albaran_id', a.id, 'factura_id', f.id, 'factura_anterior_id', a.facturado_en_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.desvincular_albaran(p_albaran_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
-- 20261010110000_albaranes_factura_cotejo: el albarán queda SIN factura y así
-- se queda (facturado_origen = 'manual') aunque una factura cite su número.
declare
  a record;
begin
  if not (can_write_section('facturas') or current_user in ('postgres', 'service_role')) then
    raise exception 'No tienes permiso para editar facturas.' using errcode = '42501';
  end if;
  select id, tipo, facturado_en_id into a from facturas where id = p_albaran_id;
  if not found then
    raise exception 'No existe el albarán %.', p_albaran_id using errcode = 'P0002';
  end if;
  if a.tipo <> 'albaran' then
    raise exception 'El documento % no es un albarán.', p_albaran_id using errcode = '22023';
  end if;
  update facturas set facturado_en_id = null, facturado_origen = 'manual' where id = a.id;
  return jsonb_build_object('ok', true, 'albaran_id', a.id, 'factura_anterior_id', a.facturado_en_id);
end;
$function$;

-- ─── 4. Candidatos ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.albaranes_candidatos(p_factura_id bigint, p_texto text DEFAULT NULL)
 RETURNS TABLE(id bigint, numero_documento text, fecha date, proveedor text, total numeric, base numeric,
               lineas integer, citado_en_factura boolean, mismo_proveedor boolean, dias integer)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  -- 20261010110000_albaranes_factura_cotejo: albaranes SIN factura que podría
  -- recoger esta factura. Sin texto: mismo proveedor y fecha de 60 días antes a
  -- 15 después (o citados en sus líneas). Con texto: cualquier proveedor.
  -- Orden: citados en la factura, mismo proveedor, cercanía de fecha.
  with f as (
    select x.id, x.fecha, x.proveedor_id from facturas x where x.id = p_factura_id and x.tipo = 'factura'
  ), refs as (
    select distinct numero_documento_normalizado(l.albaran_ref) as r
      from productos_factura l where l.factura_id = p_factura_id and l.albaran_ref is not null
  ), q as (
    select nullif(btrim(coalesce(p_texto, '')), '') as t
  )
  select a.id, a.numero_documento::text, a.fecha, a.proveedor::text, a.total,
         coalesce(a.subtotal, (select round(sum(coalesce(l.total, l.precio_unitario * l.cantidad)), 2)
                                 from productos_factura l where l.factura_id = a.id)) as base,
         (select count(*)::int from productos_factura l where l.factura_id = a.id) as lineas,
         numero_documento_normalizado(a.numero_documento) in (select r from refs where r is not null) as citado_en_factura,
         a.proveedor_id is not distinct from f.proveedor_id as mismo_proveedor,
         (a.fecha - f.fecha)::int as dias
    from facturas a, f, q
   where a.tipo = 'albaran'
     and a.facturado_en_id is null
     and case
           when q.t is null then
             a.proveedor_id = f.proveedor_id
             and (a.fecha between f.fecha - 60 and f.fecha + 15
                  or a.fecha is null or f.fecha is null
                  or numero_documento_normalizado(a.numero_documento) in (select r from refs where r is not null))
           else
             normalizar_texto(a.numero_documento) like '%' || normalizar_texto(q.t) || '%'
             or numero_documento_normalizado(a.numero_documento) like '%' || coalesce(numero_documento_normalizado(q.t), '') || '%'
                and numero_documento_normalizado(q.t) is not null
             or normalizar_texto(coalesce(a.proveedor, '')) like '%' || normalizar_texto(q.t) || '%'
         end
   order by citado_en_factura desc, mismo_proveedor desc, abs(coalesce(a.fecha - f.fecha, 9999)), a.id desc
   limit 50
$function$;

CREATE OR REPLACE FUNCTION public.facturas_candidatas(p_albaran_id bigint)
 RETURNS TABLE(id bigint, numero_documento text, fecha date, total numeric, base numeric,
               lineas integer, cita_albaran boolean, dias integer)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  -- 20261010110000_albaranes_factura_cotejo: facturas del mismo proveedor que
  -- podrían recoger este albarán; primero la que cita su número, luego las de
  -- fecha igual o posterior más cercana.
  with a as (
    select x.id, x.fecha, x.proveedor_id, numero_documento_normalizado(x.numero_documento) as num
      from facturas x where x.id = p_albaran_id and x.tipo = 'albaran'
  )
  select f.id, f.numero_documento::text, f.fecha, f.total,
         coalesce(f.subtotal, (select round(sum(coalesce(l.total, l.precio_unitario * l.cantidad)), 2)
                                 from productos_factura l where l.factura_id = f.id)) as base,
         (select count(*)::int from productos_factura l where l.factura_id = f.id) as lineas,
         exists (select 1 from productos_factura l
                  where l.factura_id = f.id and a.num is not null
                    and numero_documento_normalizado(l.albaran_ref) = a.num) as cita_albaran,
         (f.fecha - a.fecha)::int as dias
    from facturas f, a
   where f.tipo = 'factura' and f.proveedor_id = a.proveedor_id
   order by cita_albaran desc,
            (coalesce(f.fecha - a.fecha, 0) < 0),            -- las anteriores al albarán, al final
            abs(coalesce(f.fecha - a.fecha, 9999)), f.id desc
   limit 30
$function$;

-- ─── 5. Cotejo ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cotejo_factura_albaranes(p_factura_id bigint, p_albaran_id bigint DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
-- 20261010110000_albaranes_factura_cotejo: lo que dicen los albaranes
-- vinculados frente a lo que cobra la factura, por producto. Importes sin IVA.
-- Tolerancias: precio ±1 %, cantidad ±0,5 %.
declare
  f record;
  v_modo text := 'factura';
  v_num_alb text;
  v_res jsonb;
begin
  select x.id, x.tipo, x.numero_documento, x.fecha, x.subtotal, x.total, x.proveedor_id
    into f from facturas x where x.id = p_factura_id;
  if not found then
    return jsonb_build_object('error', 'No existe esa factura (o no tienes acceso).');
  end if;
  if f.tipo <> 'factura' then
    return jsonb_build_object('error', 'El documento no es una factura.');
  end if;
  if p_albaran_id is not null then
    select numero_documento_normalizado(a.numero_documento) into v_num_alb
      from facturas a where a.id = p_albaran_id and a.tipo = 'albaran' and a.facturado_en_id = p_factura_id;
    if not found then
      return jsonb_build_object('error', 'Ese albarán no está vinculado a esta factura.');
    end if;
    v_modo := case when v_num_alb is not null and exists (
                     select 1 from productos_factura l
                      where l.factura_id = p_factura_id and numero_documento_normalizado(l.albaran_ref) = v_num_alb)
                   then 'por_referencia' else 'por_producto' end;
  end if;

  with alb as (
    select a.id, a.numero_documento, a.fecha, a.total, a.subtotal, a.facturado_origen,
           numero_documento_normalizado(a.numero_documento) as num
      from facturas a
     where a.tipo = 'albaran' and a.facturado_en_id = f.id
       and (p_albaran_id is null or a.id = p_albaran_id)
  ),
  -- Todas las líneas de la factura con su referencia de albarán normalizada.
  lf_todas as (
    select l.*, numero_documento_normalizado(l.albaran_ref) as ref
      from productos_factura l where l.factura_id = f.id
  ),
  -- Referencias citadas que no son de un albarán vinculado.
  refs_fuera as (
    select lf.ref, min(lf.albaran_ref) as etiqueta, count(*)::int as lineas,
           round(sum(coalesce(lf.total, lf.precio_unitario * lf.cantidad)), 2) as importe
      from lf_todas lf
     where lf.ref is not null
       and lf.ref not in (select alb.num from alb where alb.num is not null)
     group by lf.ref
  ),
  lin as (
    -- lado a: líneas de los albaranes vinculados
    select 'a'::text as lado, l.producto_id, l.nombre, l.nombre_normalizado, l.unidad,
           coalesce(l.cantidad, 0) as cantidad,
           coalesce(l.total, l.precio_unitario * l.cantidad) as importe
      from productos_factura l join alb on alb.id = l.factura_id
    union all
    -- lado f: líneas de la factura que tocan
    select 'f', lf.producto_id, lf.nombre, lf.nombre_normalizado, lf.unidad,
           coalesce(lf.cantidad, 0), coalesce(lf.total, lf.precio_unitario * lf.cantidad)
      from lf_todas lf
     where case v_modo
             when 'factura' then lf.ref is null or lf.ref in (select alb.num from alb)
             when 'por_referencia' then lf.ref = v_num_alb
             else lf.ref is null or lf.ref = v_num_alb
           end
  ),
  lin_k as (
    select lin.*,
           coalesce('p' || lin.producto_id::text,
                    'n' || coalesce(nullif(lin.nombre_normalizado, ''), normalizar_texto(lin.nombre)))
             || '|' || coalesce(unidad_agente(lin.unidad), '') as k
      from lin
  ),
  prod as (
    select k.k,
           max(k.producto_id) as producto_id,
           min(k.nombre) as nombre_linea,
           max(unidad_agente(k.unidad)) as unidad,
           count(*) filter (where k.lado = 'a') as na,
           sum(k.cantidad) filter (where k.lado = 'a') as ca,
           sum(k.importe) filter (where k.lado = 'a') as ia,
           count(*) filter (where k.lado = 'f') as nf,
           sum(k.cantidad) filter (where k.lado = 'f') as cf,
           sum(k.importe) filter (where k.lado = 'f') as if_
      from lin_k k
     group by k.k
  ),
  prod2 as (
    select p.*,
           case when p.ca <> 0 and coalesce(p.ia, 0) <> 0 then p.ia / p.ca end as pa,
           case when p.cf <> 0 and coalesce(p.if_, 0) <> 0 then p.if_ / p.cf end as pf
      from prod p
     -- En modo por_producto solo cuentan los productos del albarán.
     where v_modo <> 'por_producto' or p.na > 0
  ),
  prod3 as (
    select p.*,
           case when p.pa is not null and p.pf is not null then round((p.pf - p.pa) / p.pa * 100, 2) end as dpp,
           case
             when p.na = 0 then 'solo_factura'
             when p.nf = 0 then 'solo_albaran'
             when abs(coalesce(p.cf, 0) - coalesce(p.ca, 0)) > greatest(abs(coalesce(p.ca, 0)), abs(coalesce(p.cf, 0))) * 0.005
               then 'cantidad_distinta'
             when p.pa is not null and p.pf is not null and abs(p.pf - p.pa) > abs(p.pa) * 0.01
               then 'precio_distinto'
             else 'ok'
           end as estado
      from prod2 p
  ),
  base_alb as (
    select coalesce(sum(coalesce(alb.subtotal, (select sum(coalesce(l.total, l.precio_unitario * l.cantidad))
                                                  from productos_factura l where l.factura_id = alb.id))), 0) as s
      from alb
  ),
  base_fac as (
    select case
             when v_modo = 'factura' then coalesce(f.subtotal, (select sum(coalesce(lf.total, lf.precio_unitario * lf.cantidad)) from lf_todas lf))
             else (select coalesce(sum(k.importe), 0) from lin_k k where k.lado = 'f'
                     and (v_modo = 'por_referencia' or k.k in (select p.k from prod2 p)))
           end as s
  ),
  sin_alb as (
    select coalesce(sum(r.importe), 0) as s from refs_fuera r where v_modo = 'factura'
  )
  select jsonb_build_object(
    'factura', jsonb_build_object('id', f.id, 'numero', f.numero_documento, 'fecha', f.fecha,
                                  'base', f.subtotal, 'total', f.total),
    'modo', v_modo,
    'albaranes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', alb.id, 'numero', alb.numero_documento, 'fecha', alb.fecha, 'total', alb.total,
               'base', coalesce(alb.subtotal, (select round(sum(coalesce(l.total, l.precio_unitario * l.cantidad)), 2)
                                                 from productos_factura l where l.factura_id = alb.id)),
               'lineas', (select count(*) from productos_factura l where l.factura_id = alb.id),
               'citado_en_factura', alb.num is not null and exists (select 1 from lf_todas lf where lf.ref = alb.num),
               'origen', alb.facturado_origen)
             order by alb.fecha nulls last, alb.id)
        from alb), '[]'::jsonb),
    'albaranes_no_subidos', case when v_modo = 'factura' then coalesce((
      select jsonb_agg(jsonb_build_object('numero', r.etiqueta, 'lineas', r.lineas, 'importe', r.importe) order by r.etiqueta)
        from refs_fuera r
       where not exists (select 1 from facturas a2
                          where a2.tipo = 'albaran' and a2.proveedor_id is not distinct from f.proveedor_id
                            and numero_documento_normalizado(a2.numero_documento) = r.ref)), '[]'::jsonb) else '[]'::jsonb end,
    'albaranes_sin_vincular', case when v_modo = 'factura' then coalesce((
      select jsonb_agg(jsonb_build_object('id', a2.id, 'numero', a2.numero_documento, 'fecha', a2.fecha,
                                          'factura_id', a2.facturado_en_id) order by a2.fecha, a2.id)
        from facturas a2 join refs_fuera r on r.ref = numero_documento_normalizado(a2.numero_documento)
       where a2.tipo = 'albaran' and a2.proveedor_id is not distinct from f.proveedor_id), '[]'::jsonb) else '[]'::jsonb end,
    'resumen', jsonb_build_object(
      'albaranes', (select count(*) from alb),
      'suma_albaranes', round((select s from base_alb), 2),
      'total_factura_base', round((select s from base_fac), 2),
      'diferencia', round((select s from base_fac) - (select s from base_alb), 2),
      'base_citada_sin_albaran', round((select s from sin_alb), 2),
      'diferencia_sin_explicar', round((select s from base_fac) - (select s from base_alb) - (select s from sin_alb), 2),
      'productos_ok', (select count(*) from prod3 where estado = 'ok' and exists (select 1 from alb)),
      'productos_con_diferencias', (select count(*) from prod3 where estado <> 'ok' and exists (select 1 from alb))),
    -- Sin albaranes vinculados no hay nada que cotejar.
    'productos', case when not exists (select 1 from alb) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'clave', p.k,
               'producto', coalesce((select c.nombre from productos_catalogo c where c.id = p.producto_id), p.nombre_linea),
               'producto_id', p.producto_id,
               'unidad', p.unidad,
               'en_albaranes', case when p.na > 0 then jsonb_build_object(
                  'cantidad', round(p.ca, 3), 'importe', round(p.ia, 2), 'precio', round(p.pa, 4), 'lineas', p.na) end,
               'en_factura', case when p.nf > 0 then jsonb_build_object(
                  'cantidad', round(p.cf, 3), 'importe', round(p.if_, 2), 'precio', round(p.pf, 4), 'lineas', p.nf) end,
               'diferencia_cantidad', round(coalesce(p.cf, 0) - coalesce(p.ca, 0), 3),
               'diferencia_importe', round(coalesce(p.if_, 0) - coalesce(p.ia, 0), 2),
               'diferencia_precio_pct', p.dpp,
               'estado', p.estado)
             order by case p.estado when 'cantidad_distinta' then 0 when 'precio_distinto' then 1
                                    when 'solo_albaran' then 2 when 'solo_factura' then 3 else 4 end,
                      abs(coalesce(p.if_, 0) - coalesce(p.ia, 0)) desc, p.k)
        from prod3 p), '[]'::jsonb) end
  ) into v_res;
  return v_res;
end;
$function$;

comment on function public.cotejo_factura_albaranes(bigint, bigint) is
  'Cotejo de una factura con sus albaranes vinculados (facturado_en_id), por producto (producto_id o descripción + unidad): '
  'estado ok | precio_distinto (±1 %) | cantidad_distinta (±0,5 %) | solo_albaran | solo_factura. Importes sin IVA. '
  'Con p_albaran_id, solo ese albarán. 20261010110000.';

revoke all on function public.vincular_albaran_factura(bigint, bigint, boolean) from public, anon;
revoke all on function public.desvincular_albaran(bigint) from public, anon;
revoke all on function public.albaranes_candidatos(bigint, text) from public, anon;
revoke all on function public.facturas_candidatas(bigint) from public, anon;
revoke all on function public.cotejo_factura_albaranes(bigint, bigint) from public, anon;
grant execute on function public.vincular_albaran_factura(bigint, bigint, boolean) to authenticated, service_role;
grant execute on function public.desvincular_albaran(bigint) to authenticated, service_role;
grant execute on function public.albaranes_candidatos(bigint, text) to authenticated, service_role;
grant execute on function public.facturas_candidatas(bigint) to authenticated, service_role;
grant execute on function public.cotejo_factura_albaranes(bigint, bigint) to authenticated, service_role;

commit;

select 'albaranes_factura_cotejo: aplicada'
       || ' | albaranes ' || (select count(*) from public.facturas where tipo = 'albaran')
       || ' | vinculados auto ' || (select count(*) from public.facturas where tipo = 'albaran' and facturado_origen = 'auto' and facturado_en_id is not null)
       || ' | manual ' || (select count(*) from public.facturas where tipo = 'albaran' and facturado_origen = 'manual')
       || ' | Luga ML/101511 cita ' || (select count(distinct public.numero_documento_normalizado(albaran_ref))
                                          from public.productos_factura where factura_id = 54 and albaran_ref is not null)
       || ', no subidos ' || coalesce(jsonb_array_length(public.cotejo_factura_albaranes(54) -> 'albaranes_no_subidos'), 0)
       as resultado;
