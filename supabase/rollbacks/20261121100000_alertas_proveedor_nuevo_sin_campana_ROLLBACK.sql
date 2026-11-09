set client_encoding = 'UTF8';
-- Vuelta atrás de 20261121100000_alertas_proveedor_nuevo_sin_campana: la función
-- vuelve a la versión de 20261115100000 (proveedor nuevo suena en la campana).
-- No desmarca como leídas las que ya se marcaron.
create or replace function public.facturas_generar_alertas(p_hoy date default current_date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261107300000_facturas_alertas · 20261115100000_facturas_decision (impacto, campana,
-- proveedor, bajadas, pactados, silencios)
declare
  u         jsonb := public.facturas_alertas_umbrales();
  v_hoy     date := coalesce(p_hoy, current_date);
  v_min     numeric := (u ->> 'campana_impacto_min_eur')::numeric;
  v_prov_n  int := (u ->> 'proveedor_subidas_min')::int;
  v_prov_d  int := (u ->> 'proveedor_dias')::int;
  v_tipos   text[] := array['facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                            'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                            'facturas_revision', 'facturas_precio_baja', 'facturas_precio_proveedor',
                            'facturas_precio_pactado'];
  v_nuevas  int;
  v_act     int;
  v_cad     int;
  v_borr    int;
  v_sil     int;
  v_total   int;
  v_por     jsonb;
begin
  create temp table if not exists _alertas_hoy (
    tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb
  ) on commit drop;
  truncate _alertas_hoy;
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas(v_hoy);
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas_extra(v_hoy);
  -- Una clave, una fila (por si dos reglas dieran la misma).
  delete from _alertas_hoy a using _alertas_hoy b where a.clave = b.clave and a.ctid > b.ctid;

  -- € al mes que cuesta la subida: (precio − ref) / precio × lo comprado en 90 días / 3.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('impacto_mes',
           round(((a.datos ->> 'precio')::numeric - (a.datos ->> 'precio_ref')::numeric)
                 / nullif((a.datos ->> 'precio')::numeric, 0)
                 * coalesce((a.datos ->> 'importe_90')::numeric, 0) / 3, 2))
   where a.tipo = 'facturas_precio_sube';

  -- Silencios: «Visto» (esa clave) y «Es normal» (ese tipo y objeto hasta su fecha).
  delete from _alertas_hoy a
   where exists (select 1 from facturas_alertas_silencios s
                  where (s.clave is not null and s.clave = a.clave)
                     or (s.objeto is not null and s.tipo = a.tipo
                         and s.objeto = public.facturas_alerta_objeto(a.tipo, a.datos)
                         and (s.hasta is null or s.hasta >= v_hoy)));
  get diagnostics v_sil = row_count;

  -- Un proveedor que sube varias cosas a la vez: un solo aviso.
  insert into _alertas_hoy
  select 'facturas_precio_proveedor',
         case when g.impacto >= v_min * 3 then 'alta' else 'normal' end,
         left(format('%s ha subido %s %s esta semana (+%s %% de media)', g.proveedor, g.n,
                     case when g.n_fam = 1 and g.familia is not null then lower(g.familia) else 'productos' end,
                     facturas_alertas_num(g.media, 0)), 120),
         format('%s: %s. Te cuestan unos %s € más al mes con lo que compras. Precios sin IVA.',
                g.proveedor, g.lista, facturas_alertas_num(g.impacto, 0)),
         format('precio_proveedor:%s:%s', g.proveedor_id, g.semana),
         (v_hoy + 30)::timestamptz,
         jsonb_build_object(
           'enlace', '?tab=compras&modo=proveedores&prov=' || g.proveedor_id,
           'proveedor_id', g.proveedor_id, 'proveedor', g.proveedor, 'local', g.loc,
           'desde', g.desde, 'hasta', g.hasta, 'mes', to_char(g.hasta, 'YYYY-MM'),
           'familia_id', case when g.n_fam = 1 then g.fam end, 'familia', case when g.n_fam = 1 then g.familia end,
           'productos', g.n, 'variacion_pct', round(g.media, 1), 'impacto_mes', round(g.impacto, 2),
           'claves', g.claves, 'factura_id', g.factura_id)
    from (
      select (a.datos ->> 'proveedor_id')::bigint as proveedor_id,
             max(a.datos ->> 'proveedor') as proveedor,
             case when count(distinct a.datos ->> 'local') = 1 then max(a.datos ->> 'local') end as loc,
             count(*) as n,
             count(distinct a.datos ->> 'familia_id') as n_fam,
             max((a.datos ->> 'familia_id')::bigint) as fam,
             max(cp.nombre::text) as familia,
             avg((a.datos ->> 'variacion_pct')::numeric) as media,
             sum(greatest(coalesce((a.datos ->> 'impacto_mes')::numeric, 0), 0)) as impacto,
             min((a.datos ->> 'fecha')::date) as desde, max((a.datos ->> 'fecha')::date) as hasta,
             to_char(max((a.datos ->> 'fecha')::date), 'IYYY-IW') as semana,
             max((a.datos ->> 'factura_id')::bigint) as factura_id,
             string_agg(format('%s +%s %%', a.datos ->> 'producto', facturas_alertas_num((a.datos ->> 'variacion_pct')::numeric, 0)),
                        ', ' order by (a.datos ->> 'variacion_pct')::numeric desc) as lista,
             jsonb_agg(a.clave) as claves
        from _alertas_hoy a
        left join categorias_producto cp on cp.id = (a.datos ->> 'familia_id')::bigint
       where a.tipo = 'facturas_precio_sube'
         and (a.datos ->> 'fecha')::date > v_hoy - v_prov_d
         and a.datos ->> 'proveedor_id' is not null
       group by 1
      having count(*) >= v_prov_n) g
   where not exists (select 1 from facturas_alertas_silencios s
                      where s.tipo = 'facturas_precio_proveedor' and s.objeto = 'prov:' || g.proveedor_id
                        and (s.hasta is null or s.hasta >= v_hoy))
     and not exists (select 1 from facturas_alertas_silencios s
                      where s.clave = format('precio_proveedor:%s:%s', g.proveedor_id, g.semana));

  -- A la campana, solo lo que pesa: las subidas agrupadas por proveedor van en su aviso,
  -- y las subidas o bajadas de menos de campana_impacto_min_eur al mes se quedan en Análisis.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false, 'agrupada', true)
   where a.tipo = 'facturas_precio_sube'
     and exists (select 1 from _alertas_hoy g where g.tipo = 'facturas_precio_proveedor' and g.datos -> 'claves' ? a.clave);
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false)
   where a.tipo in ('facturas_precio_sube', 'facturas_precio_baja')
     and coalesce((a.datos ->> 'impacto_mes')::numeric, 0) < v_min
     and not (a.datos ? 'campana');
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', true)
   where not (a.datos ? 'campana');

  -- Lo que sigue vigente: texto y cifras al día; «leída» no se toca (salvo que deje de ir
  -- a la campana: entonces queda leída, para que no cuente en el número rojo).
  update notificaciones_dashboard n
     set titulo = a.titulo, mensaje = a.mensaje, prioridad = a.prioridad, datos = a.datos, caduca_en = a.caduca_en,
         leida = n.leida or (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where n.clave = a.clave
     and (n.titulo, n.mensaje, n.prioridad, n.datos, n.caduca_en, n.leida or (a.datos ->> 'campana') = 'false')
         is distinct from (a.titulo, a.mensaje, a.prioridad, a.datos, a.caduca_en, n.leida);
  get diagnostics v_act = row_count;

  -- Las que no van a la campana entran ya leídas (no suman en el número rojo).
  insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos, leida)
  select a.tipo, a.titulo, a.mensaje, 'facturas_alerta', a.prioridad, a.clave, a.caduca_en, a.datos,
         (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where not exists (select 1 from notificaciones_dashboard n where n.clave = a.clave)
  on conflict (clave) where clave is not null do nothing;
  get diagnostics v_nuevas = row_count;

  -- Lo que ya no se cumple (o se ha silenciado) caduca ya, y queda leído.
  update notificaciones_dashboard n
     set caduca_en = now(), leida = true
   where n.tipo = any(v_tipos) and n.clave is not null
     and (n.caduca_en is null or n.caduca_en > now())
     and not exists (select 1 from _alertas_hoy a where a.clave = n.clave);
  get diagnostics v_cad = row_count;
  update notificaciones_dashboard n
     set leida = true
   where n.tipo = any(v_tipos) and n.caduca_en <= now() and not n.leida;

  delete from notificaciones_dashboard n
   where n.tipo = any(v_tipos) and n.caduca_en < now() - interval '90 days';
  get diagnostics v_borr = row_count;
  -- Los «Es normal» vencidos ya no sirven.
  delete from facturas_alertas_silencios s where s.hasta is not null and s.hasta < v_hoy - 30;

  select coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb)
    into v_por
    from (select a.tipo, count(*) as n from _alertas_hoy a group by a.tipo) t;
  v_total := (select count(*) from _alertas_hoy);

  return jsonb_build_object('vigentes', v_total, 'nuevas', v_nuevas, 'actualizadas', v_act,
                            'caducadas', v_cad, 'borradas', v_borr, 'silenciadas', v_sil,
                            'campana', (select count(*) from _alertas_hoy a where a.datos ->> 'campana' = 'true'),
                            'por_tipo', v_por);
end;
$$;

revoke all on function public.facturas_generar_alertas(date) from public, anon, authenticated;
grant execute on function public.facturas_generar_alertas(date) to service_role;
