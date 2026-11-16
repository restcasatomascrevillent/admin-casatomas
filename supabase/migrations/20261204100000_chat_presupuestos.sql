set client_encoding = 'UTF8';
-- ===========================================================================
-- chat-facturas · presupuestos de proveedor (16/11/2026)
-- ---------------------------------------------------------------------------
-- El copiloto de Facturas admite adjuntar un presupuesto (PDF, Excel, foto) y
-- dice qué productos interesan. El presupuesto NO es una factura: no toca
-- facturas ni productos_factura; solo vive en `chat_presupuestos` (lo que se
-- leyó + con qué producto del catálogo se casó cada línea) mientras dura la
-- conversación.
--
--   chat_presupuestos                tabla; RLS sin políticas (solo service_role,
--                                    que es lo que usa la Edge Function).
--   emparejar_presupuesto_agente     líneas leídas -> producto del catálogo
--                                    (texto y, si no, embedding de
--                                    productos_nombre_embedding).
--   referencias_precio_agente        las tres referencias de UN producto en la
--                                    unidad pedida: último precio, media de 12
--                                    meses y mejor precio actual entre proveedores.
--   comparar_presupuesto_agente      la herramienta del chat: aplica el descuento,
--                                    compara y devuelve veredicto y ahorro anual.
--
-- Vuelta atrás: supabase/rollbacks/20261204100000_chat_presupuestos_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

create table if not exists public.chat_presupuestos (
  id              uuid primary key default gen_random_uuid(),
  session_id      text not null,
  usuario_id      uuid,
  nombre_archivo  text,
  proveedor       text,
  fecha_documento date,
  lineas          jsonb not null,
  creado_en       timestamptz not null default now()
);
create index if not exists chat_presupuestos_session_idx on public.chat_presupuestos (session_id, creado_en desc);
alter table public.chat_presupuestos enable row level security;
revoke all on public.chat_presupuestos from public, anon, authenticated;
grant all on public.chat_presupuestos to service_role;
comment on table public.chat_presupuestos is
  'Presupuestos de proveedor adjuntados al chat de Facturas (no son facturas). Solo service_role.';

-- ─── 1. Emparejar líneas con el catálogo ────────────────────────────────────
-- Entrada: [{producto, embedding?}] (embedding como texto '[0.1,...]').
-- Salida:  [{i, producto_id, producto_catalogo, metodo, similitud, confianza}]
--   metodo    texto | semantica | null (sin coincidencia)
--   confianza alta | media (la media obliga a «Revisar»)
create or replace function public.emparejar_presupuesto_agente(p_lineas jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $f$
declare
  v_res    jsonb := '[]'::jsonb;
  l        jsonb;
  v_i      int := 0;
  v_nom    text;
  v_norm   text;
  v_ids    bigint[];
  v_pid    bigint;
  v_pnom   text;
  v_met    text;
  v_sim    numeric;
  v_conf   text;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_nom := nullif(btrim(l->>'producto'), '');
    v_pid := null; v_pnom := null; v_met := null; v_sim := null; v_conf := null; v_ids := null;

    if v_nom is not null then
      v_norm := coalesce(normalizar_nombre_producto(v_nom), lower(v_nom));

      -- 1. Texto: las mismas reglas que compras_producto (exacta, raíz, derivada, aproximada).
      select b.ids into v_ids from lineas_producto_base_agente(v_nom) b limit 1;
      if v_ids is not null then
        select c.id, c.nombre,
               extensions.similarity(v_norm, coalesce(c.nombre_normalizado, normalizar_nombre_producto(c.nombre), lower(c.nombre)))
          into v_pid, v_pnom, v_sim
          from (select pf.producto_id, count(*) as n
                  from productos_factura pf
                 where pf.id = any(v_ids) and pf.producto_id is not null
                 group by pf.producto_id) x
          join productos_catalogo c on c.id = x.producto_id
         order by 3 desc, x.n desc
         limit 1;
        if v_pid is not null then
          v_met := 'texto';
          v_conf := case when v_sim >= 0.5 then 'alta' else 'media' end;
        end if;
      end if;

      -- 2. Semántica: el nombre más cercano de productos_nombre_embedding.
      if (v_pid is null or v_sim < 0.35) and nullif(l->>'embedding', '') is not null then
        declare
          v_q halfvec(1536) := (l->>'embedding')::halfvec(1536);
          v_pid2 bigint; v_pnom2 text; v_sim2 numeric;
        begin
          select c.id, c.nombre, n.s
            into v_pid2, v_pnom2, v_sim2
            from (select e.nombre, round((1 - (e.embedding <=> v_q))::numeric, 3) as s
                    from productos_nombre_embedding e
                   where e.embedding is not null
                   order by e.embedding <=> v_q
                   limit 5) n
            join lateral (select pf.producto_id
                            from productos_factura pf
                           where pf.nombre = n.nombre and pf.producto_id is not null
                           group by pf.producto_id order by count(*) desc limit 1) x on true
            join productos_catalogo c on c.id = x.producto_id
           order by n.s desc
           limit 1;
          if v_pid2 is not null and v_sim2 >= 0.55 and (v_pid is null or v_sim2 > coalesce(v_sim, 0)) then
            v_pid := v_pid2; v_pnom := v_pnom2; v_sim := v_sim2; v_met := 'semantica';
            v_conf := case when v_sim2 >= 0.75 then 'alta' else 'media' end;
          end if;
        end;
      end if;
    end if;

    v_res := v_res || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'i', v_i, 'producto_id', v_pid, 'producto_catalogo', v_pnom,
      'metodo', v_met, 'similitud', round(v_sim, 3), 'confianza', v_conf)));
  end loop;
  return v_res;
end;
$f$;

-- ─── 2. Las tres referencias de un producto ─────────────────────────────────
-- Una sola fila. La unidad es la primera de (p_unidad1, p_unidad2) con
-- historial (lineas_precio_agente con p_base: kg/l/ud cuando todo el producto
-- se puede pasar a una base). Si ninguna coincide, `unidad` sale null y
-- `unidades_historial` dice en qué unidades se compra (no se compara).
create or replace function public.referencias_precio_agente(
  p_producto_id bigint, p_unidad1 text, p_unidad2 text, p_hoy date default null)
 returns table(
   unidad text, unidades_historial text[],
   ultimo_precio numeric, ultimo_fecha date, ultimo_proveedor text, ultimo_numero text,
   media_12m numeric, compras_12m integer, consumo_12m numeric,
   mejor_precio numeric, mejor_proveedor text, mejor_fecha date)
 language sql
 stable
 set search_path to 'public'
as $f$
  with hoy as (select coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date) as d),
  rl as (
    select r.*, unidad_agente(r.unidad) as u
      from lineas_precio_agente(p_producto_id, null, true) r
  ),
  u as (
    select x.u from (values (1, p_unidad1), (2, p_unidad2)) x(prio, u)
     where x.u is not null and exists (select 1 from rl where rl.u = x.u)
     order by x.prio limit 1
  ),
  l as (select rl.* from rl join u on u.u = rl.u),
  ult as (select * from l order by fecha desc, factura_id desc, id desc limit 1),
  d12 as (select l.* from l, hoy where l.fecha >= hoy.d - 365 and l.fecha <= hoy.d),
  prov as (select distinct on (prov_n) * from d12 order by prov_n, fecha desc, factura_id desc, id desc),
  mej as (select * from prov order by precio asc, fecha desc limit 1)
  select (select u from u),
         (select array_agg(distinct rl.u order by rl.u) from rl),
         (select precio from ult), (select fecha from ult), (select proveedor from ult), (select numero from ult),
         (select coalesce(sum(precio * cantidad) filter (where cantidad > 0)
                          / nullif(sum(cantidad) filter (where cantidad > 0), 0), avg(precio)) from d12),
         (select count(distinct factura_id)::integer from d12),
         (select sum(cantidad) filter (where cantidad > 0) from d12),
         (select precio from mej), (select proveedor from mej), (select fecha from mej)
$f$;

-- ─── 3. Comparar el presupuesto (la herramienta del chat) ───────────────────
-- p_descuento_pct o p_descuento_importe (uno solo; ninguno = sin descuento).
-- Un importe se reparte proporcionalmente sobre el total del presupuesto
-- (precio x cantidad; sin cantidad cuenta 1) y equivale a un % global.
create or replace function public.comparar_presupuesto_agente(
  p_presupuesto_id uuid, p_descuento_pct numeric default null, p_descuento_importe numeric default null)
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
begin
  select * into v_row from chat_presupuestos where id = p_presupuesto_id;
  if not found then
    return jsonb_build_object('error', 'No hay ningun presupuesto adjunto en esta conversacion: pide al usuario que lo adjunte.');
  end if;
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
  cmp as (
    select o.*, r.unidad as u_usada, r.unidades_historial, r.ultimo_precio, r.ultimo_fecha, r.ultimo_proveedor,
           r.ultimo_numero, r.media_12m, r.compras_12m, r.consumo_12m, r.mejor_precio, r.mejor_proveedor, r.mejor_fecha,
           case when r.unidad is not null and r.unidad = o.unidad_base and o.factor is not null
                then o.precio * (1 - v_pct / 100) / o.factor
                else o.precio * (1 - v_pct / 100) end as p_dto,
           case when r.unidad is not null and r.unidad = o.unidad_base and o.factor is not null
                then o.precio / o.factor else o.precio end as p_bruto
      from ofe o
      left join lateral referencias_precio_agente(o.pid, o.unidad_base, o.u_raw, v_hoy) r on o.pid is not null
  ),
  ver as (
    select c.*,
           (c.pid is not null and c.u_usada is not null and c.ultimo_precio > 0) as comparable,
           case when c.ultimo_precio > 0 then (c.p_dto - c.ultimo_precio) end as dif_eur,
           case when c.ultimo_precio > 0 then (c.p_dto - c.ultimo_precio) / c.ultimo_precio * 100 end as dif_pct
      from cmp c
  ),
  fin as (
    select v.*,
           case
             when not v.comparable then 'Revisar'
             when v.compras_12m = 0 then 'Revisar'
             when v.confianza is distinct from 'alta' then 'Revisar'
             when v.dif_pct <= -2 and (v.mejor_precio is null or v.p_dto <= v.mejor_precio + 0.00005) then 'Interesa'
             when v.dif_pct <= -2 then 'Revisar'
             when v.dif_pct >= 2 then 'No interesa'
             else 'Revisar' end as veredicto,
           case
             when not v.comparable and v.u_usada is null and v.unidades_historial is not null then 'unidades_distintas'
             when not v.comparable then 'sin_historial'
             when v.compras_12m = 0 then 'sin_compras_12m'
             when v.confianza is distinct from 'alta' then 'coincidencia_dudosa'
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
        'motivo', f.motivo
      )) order by f.ord), '[]'::jsonb) from (select * from fin order by ord limit 40) f),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'producto', s.producto,
        'unidad', s.u_raw,
        'precio_con_descuento', round(s.precio * (1 - v_pct / 100), case when abs(s.precio) < 1 then 4 else 2 end)
      ) order by s.ord), '[]'::jsonb) from (select * from ofe where pid is null order by ord limit 25) s),
    (select jsonb_build_object(
        'lineas_total', (select count(*) from src),
        'lineas_que_compras', (select count(*) from fin),
        'comparables', (select count(*) from fin where comparable),
        'interesa', (select count(*) from fin where veredicto = 'Interesa'),
        'no_interesa', (select count(*) from fin where veredicto = 'No interesa'),
        'revisar', (select count(*) from fin where veredicto = 'Revisar'),
        'no_los_compras', (select count(*) from src where pid is null),
        'ahorro_anual_interesa', (select coalesce(round(sum(ahorro), 2), 0) from fin where veredicto = 'Interesa'),
        'ahorro_anual_neto', (select coalesce(round(sum(ahorro), 2), 0) from fin where comparable),
        'truncado', (select count(*) from fin) > 40
      ))
   into v_lineas, v_no, v_res;

  return jsonb_strip_nulls(jsonb_build_object(
    'proveedor', v_row.proveedor,
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
      || 'Cierra con resumen.ahorro_anual_interesa (consumo de los ultimos 12 meses) y, aparte, los productos de no_los_compras.'
  ));
end;
$f$;

revoke all on function public.emparejar_presupuesto_agente(jsonb) from public, anon, authenticated;
revoke all on function public.referencias_precio_agente(bigint, text, text, date) from public, anon, authenticated;
revoke all on function public.comparar_presupuesto_agente(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.emparejar_presupuesto_agente(jsonb) to service_role;
grant execute on function public.referencias_precio_agente(bigint, text, text, date) to service_role;
grant execute on function public.comparar_presupuesto_agente(uuid, numeric, numeric) to service_role;

commit;
