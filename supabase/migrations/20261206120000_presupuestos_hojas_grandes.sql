set client_encoding = 'UTF8';
-- ===========================================================================
-- chat-facturas · presupuestos grandes (tarifas Excel de miles de filas)
-- ---------------------------------------------------------------------------
-- La hoja se lee en la Edge Function sin LLM por fila y solo se guardan las
-- filas que se parecen a lo que se compra; del resto se guarda cuántas son
-- (chat_presupuestos.lineas_sin_compra). comparar_presupuesto_agente:
--   - acepta el proveedor (p_proveedor) cuando el fichero no lo dice y marca
--     las líneas cuyo último precio ya es de ese proveedor;
--   - ordena Interesa / No interesa / Revisar (y por ahorro) antes del tope de 40;
--   - suma lineas_sin_compra a no_los_compras y lineas_total;
--   - calcula las referencias una vez por (producto, unidad), no por línea;
--   - confianza «formato_distinto» (la IA vio otro envase o tamaño) = «Revisar»
--     con motivo formato_distinto y la nota; no se compara;
--   - más de un 60 % de diferencia = «Revisar» (diferencia_sospechosa: casi
--     siempre caja contra unidad).
-- La firma de 3 argumentos se mantiene (llama a la de 4).
--
-- Vuelta atrás: supabase/rollbacks/20261206120000_presupuestos_hojas_grandes_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

alter table public.chat_presupuestos add column if not exists lineas_sin_compra integer not null default 0;
comment on column public.chat_presupuestos.lineas_sin_compra is
  'Filas de la hoja que no se parecen a nada que se compre (no se guardan, solo se cuentan).';

-- Nombres de compra (uno por nombre de factura y producto del catálogo) para el
-- prefiltro en memoria de la Edge Function: UNA consulta, ~4.000 filas.
create or replace function public.nombres_compras_agente()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $f$
  select coalesce(jsonb_agg(jsonb_build_object('n', x.nombre, 'p', x.producto_id, 'c', c.nombre)), '[]'::jsonb)
    from (select distinct pf.nombre, pf.producto_id
            from productos_factura pf
           where pf.producto_id is not null and pf.nombre is not null) x
    join productos_catalogo c on c.id = x.producto_id
$f$;

create or replace function public.comparar_presupuesto_agente(
  p_presupuesto_id uuid, p_descuento_pct numeric, p_descuento_importe numeric, p_proveedor text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $f$
declare
  v_row      chat_presupuestos%rowtype;
  v_hoy      date := (now() at time zone 'Europe/Madrid')::date;
  v_total    numeric;
  v_pct      numeric := 0;
  v_desc     jsonb;
  v_sin_cant boolean;
  v_lineas   jsonb;
  v_no       jsonb;
  v_res      jsonb;
  v_prov     text;
  v_prov_n   text;
begin
  select * into v_row from chat_presupuestos where id = p_presupuesto_id;
  if not found then
    return jsonb_build_object('error', 'No hay ningun presupuesto adjunto en esta conversacion: pide al usuario que lo adjunte.');
  end if;
  -- Proveedor: el del fichero o, si no lo decía, el que contesta el usuario.
  v_prov := coalesce(nullif(btrim(p_proveedor), ''), v_row.proveedor);
  v_prov_n := nullif(lower(btrim(coalesce(normalizar_nombre_producto(v_prov), v_prov))), '');
  if p_descuento_pct is not null and p_descuento_importe is not null then
    return jsonb_build_object('error', 'Parametro descuento: manda un porcentaje O un importe, no los dos.');
  end if;

  select sum((o.l->>'precio')::numeric * coalesce(nullif(o.l->>'cantidad', '')::numeric, 1)),
         bool_or(nullif(o.l->>'cantidad', '') is null)
    into v_total, v_sin_cant
    from jsonb_array_elements(v_row.lineas) o(l);

  if p_descuento_pct is not null then
    if p_descuento_pct < 0 or p_descuento_pct >= 100 then
      return jsonb_build_object('error', 'Parametro descuento: el porcentaje debe estar entre 0 y 100.');
    end if;
    v_pct := p_descuento_pct;
    v_desc := jsonb_build_object('tipo', 'porcentaje', 'pct', v_pct);
  elsif p_descuento_importe is not null then
    if p_descuento_importe < 0 or v_total is null or v_total <= 0 or p_descuento_importe >= v_total then
      return jsonb_build_object('error', 'Parametro descuento: el importe debe ser positivo y menor que el total del presupuesto ('
        || coalesce(round(v_total, 2)::text, '?') || ' EUR sin IVA).');
    end if;
    v_pct := round(p_descuento_importe / v_total * 100, 4);
    v_desc := jsonb_strip_nulls(jsonb_build_object(
      'tipo', 'importe', 'importe', p_descuento_importe, 'total_presupuesto', round(v_total, 2), 'pct_equivalente', round(v_pct, 2),
      'aviso', case when v_sin_cant then 'El presupuesto no trae todas las cantidades: el total cuenta 1 unidad en esas lineas' end));
  else
    v_desc := jsonb_build_object('tipo', 'ninguno', 'pct', 0);
  end if;

  with src as (
    select o.ord::int as ord,
           o.l->>'producto' as producto,
           o.l->>'producto_catalogo' as catalogo,
           nullif(o.l->>'producto_id', '')::bigint as pid,
           o.l->>'confianza' as confianza,
           o.l->>'nota' as nota,
           o.l->>'metodo' as metodo,
           (o.l->>'precio')::numeric as precio,
           o.l->>'unidad' as unidad,
           nullif(o.l->>'contenido_cantidad', '')::numeric as cc,
           nullif(o.l->>'contenido_unidad', '') as cu
      from jsonb_array_elements(v_row.lineas) with ordinality o(l, ord)
  ),
  ofe as (
    select s.*, bl.unidad_base, bl.factor,
           unidad_agente(coalesce(nullif(btrim(s.unidad), ''), 'ud')) as u_raw
      from src s
     cross join lateral base_linea_agente(s.unidad, s.cc, s.cu) bl
  ),
  -- Las referencias, UNA vez por (producto, unidad): una tarifa grande trae
  -- varios formatos del mismo producto.
  claves as (select distinct pid, unidad_base, u_raw from ofe where pid is not null),
  refs as (
    select k.pid as k_pid, k.unidad_base as k_ub, k.u_raw as k_ur, r.*
      from claves k
     cross join lateral referencias_precio_agente(k.pid, k.unidad_base, k.u_raw, v_hoy) r
  ),
  cmp as (
    select o.*, r.unidad as u_usada, r.unidades_historial, r.ultimo_precio, r.ultimo_fecha, r.ultimo_proveedor,
           r.ultimo_numero, r.media_12m, r.compras_12m, r.consumo_12m, r.mejor_precio, r.mejor_proveedor, r.mejor_fecha,
           case when r.unidad is not null and r.unidad = o.unidad_base and o.factor is not null
                then o.precio * (1 - v_pct / 100) / o.factor
                else o.precio * (1 - v_pct / 100) end as p_dto,
           case when r.unidad is not null and r.unidad = o.unidad_base and o.factor is not null
                then o.precio / o.factor else o.precio end as p_bruto
      from ofe o
      left join refs r on o.pid is not null and r.k_pid = o.pid
                      and r.k_ub is not distinct from o.unidad_base and r.k_ur is not distinct from o.u_raw
  ),
  ver as (
    select c.*,
           (c.pid is not null and c.u_usada is not null and c.ultimo_precio > 0
            and c.confianza is distinct from 'formato_distinto') as comparable,
           case when c.ultimo_precio > 0 then (c.p_dto - c.ultimo_precio) end as dif_eur,
           case when c.ultimo_precio > 0 then (c.p_dto - c.ultimo_precio) / c.ultimo_precio * 100 end as dif_pct,
           (v_prov_n is not null and c.ultimo_proveedor is not null
             and (lower(c.ultimo_proveedor) like '%' || v_prov_n || '%' or v_prov_n like '%' || lower(c.ultimo_proveedor) || '%')) as mismo_prov
      from cmp c
  ),
  fin as (
    select v.*,
           case
             when not v.comparable then 'Revisar'
             when v.compras_12m = 0 then 'Revisar'
             when v.confianza is distinct from 'alta' then 'Revisar'
             when abs(v.dif_pct) > 60 then 'Revisar'
             when v.mismo_prov and v.dif_pct <= -2 then 'Interesa'
             when v.dif_pct <= -2 and (v.mejor_precio is null or v.p_dto <= v.mejor_precio + 0.00005) then 'Interesa'
             when v.dif_pct <= -2 then 'Revisar'
             when v.dif_pct >= 2 then 'No interesa'
             else 'Revisar' end as veredicto,
           case
             when v.confianza = 'formato_distinto' then 'formato_distinto'
             when not v.comparable and v.u_usada is null and v.unidades_historial is not null then 'unidades_distintas'
             when not v.comparable then 'sin_historial'
             when v.compras_12m = 0 then 'sin_compras_12m'
             when v.confianza is distinct from 'alta' then 'coincidencia_dudosa'
             when abs(v.dif_pct) > 60 then 'diferencia_sospechosa'
             when v.dif_pct <= -2 and not (v.mejor_precio is null or v.p_dto <= v.mejor_precio + 0.00005) then 'hay_mejor_proveedor'
             when v.dif_pct > -2 and v.dif_pct < 2 then 'precio_similar'
           end as motivo,
           case when v.comparable and v.consumo_12m > 0 then round((v.ultimo_precio - v.p_dto) * v.consumo_12m, 2) end as ahorro
      from ver v
     where v.pid is not null
  )
  select
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'producto', f.producto,
        'coincide_con', f.catalogo,
        'coincidencia', f.metodo,
        'confianza', f.confianza,
        'unidad', f.u_usada,
        'unidades_en_historial', case when not f.comparable then to_jsonb(f.unidades_historial) end,
        'oferta_sin_descuento', case when f.comparable then round(f.p_bruto, case when abs(f.p_bruto) < 1 then 4 else 2 end) end,
        'oferta', case when f.comparable then round(f.p_dto, case when abs(f.p_dto) < 1 then 4 else 2 end) end,
        'ultimo', case when f.ultimo_precio is not null and f.comparable then jsonb_strip_nulls(jsonb_build_object(
            'precio', round(f.ultimo_precio, case when abs(f.ultimo_precio) < 1 then 4 else 2 end),
            'fecha', f.ultimo_fecha, 'proveedor', f.ultimo_proveedor, 'numero', f.ultimo_numero)) end,
        'media_12m', case when f.comparable and f.media_12m is not null then jsonb_build_object(
            'precio', round(f.media_12m, case when abs(f.media_12m) < 1 then 4 else 2 end), 'compras', f.compras_12m) end,
        'mejor_actual', case when f.comparable and f.mejor_precio is not null then jsonb_build_object(
            'precio', round(f.mejor_precio, case when abs(f.mejor_precio) < 1 then 4 else 2 end),
            'proveedor', f.mejor_proveedor, 'fecha', f.mejor_fecha) end,
        'dif_eur', case when f.comparable then round(f.dif_eur, 4) end,
        'dif_pct', case when f.comparable then round(f.dif_pct, 1) end,
        'dif_media_pct', case when f.comparable and f.media_12m > 0 then round((f.p_dto - f.media_12m) / f.media_12m * 100, 1) end,
        'dif_mejor_pct', case when f.comparable and f.mejor_precio > 0 then round((f.p_dto - f.mejor_precio) / f.mejor_precio * 100, 1) end,
        'consumo_12m', case when f.comparable then round(f.consumo_12m, 2) end,
        'ahorro_anual', f.ahorro,
        'veredicto', f.veredicto,
        'motivo', f.motivo,
        'nota', f.nota,
        'ya_se_lo_compras', case when f.mismo_prov then true end
      )) order by f.prio, f.ahorro desc nulls last, f.ord), '[]'::jsonb)
       from (select fin.*, case fin.veredicto when 'Interesa' then 1 when 'No interesa' then 2 else 3 end as prio
               from fin order by prio, ahorro desc nulls last, ord limit 40) f),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'producto', s.producto,
        'unidad', s.u_raw,
        'precio_con_descuento', round(s.precio * (1 - v_pct / 100), case when abs(s.precio) < 1 then 4 else 2 end)
      ) order by s.ord), '[]'::jsonb) from (select * from ofe where pid is null order by ord limit 25) s),
    (select jsonb_build_object(
        'lineas_total', (select count(*) from src) + coalesce(v_row.lineas_sin_compra, 0),
        'lineas_que_compras', (select count(*) from fin),
        'comparables', (select count(*) from fin where comparable),
        'interesa', (select count(*) from fin where veredicto = 'Interesa'),
        'no_interesa', (select count(*) from fin where veredicto = 'No interesa'),
        'revisar', (select count(*) from fin where veredicto = 'Revisar'),
        'no_los_compras', (select count(*) from src where pid is null) + coalesce(v_row.lineas_sin_compra, 0),
        'ahorro_anual_interesa', (select coalesce(round(sum(ahorro), 2), 0) from fin where veredicto = 'Interesa'),
        'ahorro_anual_neto', (select coalesce(round(sum(ahorro), 2), 0) from fin where comparable),
        'truncado', (select count(*) from fin) > 40
      ))
   into v_lineas, v_no, v_res;

  return jsonb_strip_nulls(jsonb_build_object(
    'proveedor', v_prov,
    'archivo', v_row.nombre_archivo,
    'fecha_presupuesto', v_row.fecha_documento,
    'hoy', v_hoy,
    'descuento', v_desc,
    'precios', 'sin IVA, en la unidad indicada en cada linea',
    'lineas', v_lineas,
    'no_los_compras', v_no,
    'resumen', v_res,
    'como_leer', 'Una tabla: producto | oferta con descuento | ultimo precio pagado | media 12 meses | mejor precio actual (proveedor) | diferencia vs ultimo en EUR y % | veredicto. '
      || 'Las cifras (dif_*, ahorro_anual, resumen) ya vienen calculadas: no calcules nada. Las lineas con motivo unidades_distintas o sin_historial NO se comparan: avisalo y da las unidades_en_historial. '
      || 'Las lineas vienen ordenadas: Interesa, No interesa y Revisar. ya_se_lo_compras = el ultimo precio ya es de este proveedor. '
      || 'motivo formato_distinto = mismo producto en otro envase o tamano (nota dice cual): NO se compara. '
      || 'motivo diferencia_sospechosa = mas de un 60 % de diferencia: seguramente otro formato (caja vs unidad); dilo asi. '
      || 'Cierra con resumen.ahorro_anual_interesa (consumo de los ultimos 12 meses) y cuantos articulos no compras (resumen.no_los_compras); lista no_los_compras solo si son pocos.'
  ));
end;
$f$;


create or replace function public.comparar_presupuesto_agente(
  p_presupuesto_id uuid, p_descuento_pct numeric default null, p_descuento_importe numeric default null)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $f$
  select public.comparar_presupuesto_agente(p_presupuesto_id, p_descuento_pct, p_descuento_importe, null::text)
$f$;

revoke all on function public.nombres_compras_agente() from public, anon, authenticated;
grant execute on function public.nombres_compras_agente() to service_role;
revoke all on function public.comparar_presupuesto_agente(uuid, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.comparar_presupuesto_agente(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.comparar_presupuesto_agente(uuid, numeric, numeric, text) to service_role;
grant execute on function public.comparar_presupuesto_agente(uuid, numeric, numeric) to service_role;

commit;
