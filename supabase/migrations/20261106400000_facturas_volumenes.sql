set client_encoding = 'UTF8';
-- ============================================================================
-- 20261106400000_facturas_volumenes — Litros y kilos comprados (06/11/2026)
-- ----------------------------------------------------------------------------
-- «¿Cuántos litros de cerveza he comprado?» respondía «no hay datos»: la
-- cerveza se factura en cajas («HEINEKEN 1/3 LONG NET * 24») y barriles, el
-- contenido del catálogo estaba vacío y ninguna RPC sumaba volumen.
--
-- MODELO (reglas completas en docs/facturas/VOLUMENES.md):
--   · Catálogo: contenido de UN envase (botella, lata, barril, garrafa…) en
--     envase_cantidad + envase_unidad (l o kg) y unidades por caja/pack
--     habituales en envases_por_bulto. Se rellenan solos: el envase del nombre
--     canónico («Heineken 33 cl», «Cruzcampo barril 50 l», «… Magnum» = 1,5 l;
--     vino sin formato en el nombre = 0,75 l «por_defecto») y las unidades por
--     caja de lo que más se repite en los textos de sus líneas («* 24», «C/6»,
--     «C24», «12 unidades», «24x33cl»). envase_origen = nombre | lineas |
--     por_defecto | manual (manual no se pisa).
--     NO se tocan contenido_cantidad/contenido_unidad del catálogo: esos son el
--     contenido de la UNIDAD FACTURADA que usan las RPC de precios (€/kg, €/l);
--     poner ahí 0,33 l a una cerveza que se compra por cajas rompería el €/l.
--   · Línea: litros (o kilos) = cantidad × lo que lleva la unidad facturada:
--       unidad l o kg ............................ 1        (metodo unidad)
--       caja / pack / fardo / jaula / estuche .... envase × unidades por caja
--                                                  (del texto de la línea o, si
--                                                  no, del catálogo)   (caja)
--                                                  o el total escrito
--                                                  («caja 10 kg»)      (texto)
--       ud / botella / lata / barril / bote… ..... 1 envase           (envase)
--         salvo que el precio diga que es una caja: en Cervezas
--         (> 20 €/l) y Refrescos y aguas (> 15 €/l) una «ud» o «lata» a
--         17,59 € de 33 cl es una caja → envase × unidades       (precio)
--     Lo que no se puede deducir NO se convierte (metodo = motivo):
--     sin_contenido, sin_unidades_por_caja, precio_dudoso, unidad_no_convertible.
--   · Fuera de la cuenta: Servicios (envases retornables, alquileres),
--     Limpieza y Menaje (litros de detergente no son compras de bebida), y los
--     albaranes ya facturados (como en el resto del panel).
--
-- QUÉ CAMBIA
--   · productos_catalogo + envase_cantidad, envase_unidad, envases_por_bulto,
--     envase_origen (relleno aquí; triggers para lo nuevo).
--   · envase_texto(texto) → (volumen, unidad, unidades): lee un texto de línea.
--   · volumen_linea(…) → (medida, por_unidad, cantidad_base, envases, metodo).
--   · vista volumen_lineas (security_invoker: misma RLS que facturas).
--   · RPC volumen_comprado_agente(texto, categoria, desde, hasta, local, medida)
--     para el chatbot.
--   · explorar_compras / _hechos / _error / _por_lineas: medidas «litros» y
--     «kilos» (solo se AÑADE; las demás medidas dan lo mismo).
-- Test: supabase/tests/facturas_volumenes_test.sql
-- Deshacer: supabase/rollbacks/20261106400000_facturas_volumenes_ROLLBACK.sql
-- ============================================================================

begin;
set local lock_timeout = '5s';

-- ─── 1. Columnas del catálogo ───────────────────────────────────────────────
alter table public.productos_catalogo
  add column if not exists envase_cantidad numeric,
  add column if not exists envase_unidad text,
  add column if not exists envases_por_bulto numeric,
  add column if not exists envase_origen text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_catalogo_envase_chk') then
    alter table public.productos_catalogo add constraint productos_catalogo_envase_chk check (
      (envase_cantidad is null or (envase_cantidad > 0 and envase_cantidad <= 1000))
      and (envase_unidad is null or envase_unidad in ('l', 'kg'))
      and ((envase_cantidad is null) = (envase_unidad is null))
      and (envases_por_bulto is null or (envases_por_bulto >= 2 and envases_por_bulto <= 500))
      and (envase_origen is null or envase_origen in ('nombre', 'lineas', 'por_defecto', 'manual')));
  end if;
end $$;

comment on column public.productos_catalogo.envase_cantidad is
  '20261106400000: contenido de UN envase (botella, lata, barril…) en envase_unidad. Solo para litros/kilos comprados; los precios usan contenido_cantidad.';
comment on column public.productos_catalogo.envases_por_bulto is
  '20261106400000: envases por caja/pack habituales (lo más repetido en los textos de sus líneas).';

-- ─── 2. Lectura de un texto: volumen de un envase y unidades por caja ──────
create or replace function public.envase_texto(p_texto text)
returns table (volumen numeric, unidad text, unidades numeric)
language plpgsql
immutable
set search_path = public
as $$
-- 20261106400000_facturas_volumenes
declare
  c_num  constant text := '(\d{1,4}(?:[.,]\d{1,3})?)';
  c_uni  constant text := '(cl|ml|ltrs?|lts?|lt|litros?|l|kgs?|kilos?|k|grs?|gramos?|g)';
  t      text := lower(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  m      text[];
  v_cnt  int;
  v_q    numeric;
  v_u    text;
  v_n    numeric;
begin
  if t = '' then
    return;
  end if;
  t := regexp_replace(t, '\m1\s*/\s*2\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,5 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,25 ', 'g');
  t := regexp_replace(t, '\m3\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,75 ', 'g');
  t := regexp_replace(t, '[+]\s*\d{1,4}(?:[.,]\d{1,3})?\s*(?:grs?|gramos?|g|kgs?|k)\y', ' ', 'g');
  t := regexp_replace(t, '\mcal(?:ibre)?\.?\s*\d+(?:\s*/\s*\d+)?', ' ', 'g');

  -- Unidades por caja: «24x33cl», «c/6», «C24», «* 24», «12 unidades».
  m := regexp_match(t, '\m(\d{1,3})\s*[x×]\s*' || c_num || '\s*' || c_uni || '\y');
  if m is not null then
    v_n := m[1]::numeric;
    t := regexp_replace(t, '\m\d{1,3}\s*[x×]\s*(?=\d)', ' ', 'g');
  end if;
  if v_n is null then
    m := regexp_match(t, '\mc\s*/?\s*(\d{1,3})\s*(?:b|u|uds?|und|unid|bt|bot)?\M(?!\s*[/.,]\s*\d)(?!\s*(?:k|kgs?|l|lts?|g|grs?|cl|ml)\M)');
    v_n := m[1]::numeric;
  end if;
  if v_n is null then
    m := regexp_match(t, '\*\s*(\d{1,3})\M');
    v_n := m[1]::numeric;
  end if;
  if v_n is null then
    m := regexp_match(t, '\m(\d{1,3})\s*(?:unidades|unidad|uds|ud|unds|und|unid|u)\M');
    v_n := m[1]::numeric;
  end if;
  if v_n is not null and (v_n < 1 or v_n > 500) then  -- «C/1B»: caja de 1 botella
    v_n := null;
  end if;

  -- Volumen o peso de UN envase: una sola cifra con unidad (si hay varias
  -- distintas, ambiguo); si no, «1/3» (tercio), «litro», «magnum».
  select count(distinct x.q || x.k), min(x.q), min(x.k)
    into v_cnt, v_q, v_u
    from (
      select replace(g[1], ',', '.')::numeric
               * case when g[2] = 'ml' then 0.001 when g[2] = 'cl' then 0.01
                      when g[2] ~ '^(g|grs?|gramos?)$' then 0.001 else 1 end as q,
             case when g[2] ~ '^(kgs?|k|kilos?|g|grs?|gramos?)$' then 'kg' else 'l' end as k
        from regexp_matches(t, '\m' || c_num || '\s*' || c_uni || '\y', 'g') as r(g)
       where g[1] !~ '^\d+\.\d{3}$'
    ) x;
  if coalesce(v_cnt, 0) <> 1 then
    v_q := null; v_u := null;
    if t ~ '\m1\s*/\s*[2345](?!\s*[.,]?\d)' then
      m := regexp_match(t, '\m1\s*/\s*([2345])');
      v_q := case m[1] when '2' then 0.5 when '3' then 0.33 when '4' then 0.25 else 0.2 end;
      v_u := 'l';
    elsif t ~ '\m(doble magnum|jeroboam)\M' then
      v_q := 3; v_u := 'l';
    elsif t ~ '\mmagnum\M' then
      v_q := 1.5; v_u := 'l';
    elsif t ~ '\mlitro\M' then
      v_q := 1; v_u := 'l';
    end if;
  end if;
  if v_q is not null and (v_q <= 0 or v_q > 1000) then
    v_q := null; v_u := null;
  end if;
  if v_q is null and v_n is null then
    return;
  end if;
  volumen := round(v_q, 4);
  unidad := v_u;
  unidades := v_n;
  return next;
end;
$$;

-- ─── 3. Conversión de una línea ─────────────────────────────────────────────
create or replace function public.volumen_linea(
  p_nombre text, p_unidad text, p_cantidad numeric, p_precio numeric,
  p_cont_c numeric, p_cont_u text,
  p_env_c numeric, p_env_u text, p_bulto numeric, p_max_eur numeric)
returns table (medida text, por_unidad numeric, cantidad_base numeric, envases numeric, metodo text)
language plpgsql
immutable
set search_path = public
as $$
-- 20261106400000_facturas_volumenes. Ver docs/facturas/VOLUMENES.md.
declare
  u     text := coalesce(unidad_agente(p_unidad), 'ud');
  e     record;
  v_v   numeric;
  v_vu  text;
  v_n   numeric;
  v_pu  numeric;
begin
  if p_cantidad is null or p_cantidad = 0 then
    return;
  end if;
  if u in ('l', 'kg') then
    return query select u, 1::numeric, p_cantidad, null::numeric, 'unidad'::text;
    return;
  end if;

  select x.volumen, x.unidad, x.unidades into e from envase_texto(p_nombre) x;
  -- Envase: el del catálogo (nombre canónico) manda; si no, el texto de la línea.
  if p_env_c is not null then
    v_v := p_env_c; v_vu := p_env_u;
  elsif e.volumen is not null then
    v_v := e.volumen; v_vu := e.unidad;
  end if;
  v_n := coalesce(e.unidades, p_bulto);

  if u in ('caja', 'pack', 'fardo', 'jaula', 'estuche', 'cj', 'cja', 'bulto', 'lote', 'display', 'retractilado') then
    if v_n is null and p_cont_u = 'ud' and p_cont_c >= 2 then
      v_n := p_cont_c;
    end if;
    if v_v is not null and v_n is not null then
      return query select v_vu, v_v * v_n, p_cantidad * v_v * v_n, p_cantidad * v_n, 'caja'::text;
    elsif p_cont_u in ('l', 'kg') and p_cont_c >= 1 and (p_env_c is null or p_cont_c >= 2 * p_env_c) then
      -- «caja 10 kg», «CJ 5 K»: el total escrito (si el catálogo dice que el
      -- envase es más pequeño, el texto es el de la botella y no vale).
      return query select p_cont_u, p_cont_c, p_cantidad * p_cont_c, null::numeric, 'texto'::text;
    else
      return query select null::text, null::numeric, null::numeric, null::numeric,
                          case when v_v is null then 'sin_contenido' else 'sin_unidades_por_caja' end;
    end if;
    return;
  end if;

  if u in ('ud', 'botella', 'botellin', 'botellín', 'lata', 'bote', 'brik', 'barril', 'bidon', 'bidón', 'garrafa',
           'cubo', 'bolsa', 'tarro', 'frasco', 'tarrina', 'paquete', 'bandeja', 'saco', 'malla', 'tubo', 'sobre',
           'pieza', 'manojo', 'bt', 'cubeta', 'envase', 'tetrabrik', 'petaca', 'benjamin', 'barqueta', 'cubeto') then
    if v_v is null and p_cont_u in ('l', 'kg') then
      v_v := p_cont_c; v_vu := p_cont_u;
    end if;
    if v_v is null then
      return query select null::text, null::numeric, null::numeric, null::numeric, 'sin_contenido'::text;
      return;
    end if;
    v_pu := abs(coalesce(p_precio, 0));
    if p_max_eur is not null and v_vu = 'l' and v_pu / v_v > p_max_eur then
      -- A ese precio no es una botella/lata suelta: es una caja.
      if v_n is not null and v_pu / (v_v * v_n) <= p_max_eur then
        return query select v_vu, v_v * v_n, p_cantidad * v_v * v_n, p_cantidad * v_n, 'precio'::text;
      else
        return query select null::text, null::numeric, null::numeric, null::numeric, 'precio_dudoso'::text;
      end if;
      return;
    end if;
    return query select v_vu, v_v, p_cantidad * v_v, p_cantidad, 'envase'::text;
    return;
  end if;

  return query select null::text, null::numeric, null::numeric, null::numeric, 'unidad_no_convertible'::text;
end;
$$;

-- Precio máximo por litro de un envase suelto (por encima, la «ud» es una caja).
create or replace function public.volumen_max_eur_litro(p_categoria text)
returns numeric
language sql
immutable
set search_path = public
as $$
  -- 20261106400000_facturas_volumenes
  select case p_categoria when 'Cervezas' then 20::numeric when 'Refrescos y aguas' then 15::numeric end
$$;

-- «33 cl», «50 l», «1,5 l», «500 g», «5 kg».
create or replace function public.volumen_formato(p_c numeric, p_u text)
returns text
language sql
immutable
set search_path = public
as $$
  -- 20261106400000_facturas_volumenes
  select case when p_c is null then null
              when p_u = 'l' and p_c < 1 then replace(trim_scale(round(p_c * 100, 1))::text, '.', ',') || ' cl'
              when p_u = 'kg' and p_c < 1 then trim_scale(round(p_c * 1000))::text || ' g'
              else replace(trim_scale(round(p_c, 3))::text, '.', ',') || ' ' || p_u end
$$;

-- ─── 4. Relleno del catálogo ────────────────────────────────────────────────
create or replace function public.productos_envase_recalcular(p_ids bigint[] default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
-- 20261106400000_facturas_volumenes: envase del nombre (o 0,75 l en vinos sin
-- formato) y unidades por caja de los textos de sus líneas. No pisa 'manual'.
declare
  v_n integer;
begin
  with base as (
    select pc.id,
           e.volumen, e.unidad,
           (select cp.nombre from categorias_producto cp where cp.id = pc.categoria_id) as cat
      from productos_catalogo pc
      left join lateral envase_texto(pc.nombre) e on true
     where (p_ids is null or pc.id = any(p_ids))
       and pc.envase_origen is distinct from 'manual'
  ),
  bul as (
    select x.producto_id, x.n
      from (
        select pf.producto_id, e.unidades as n,
               row_number() over (partition by pf.producto_id order by count(*) desc, e.unidades desc) as rn
          from productos_factura pf
          cross join lateral envase_texto(pf.nombre) e
         where pf.producto_id is not null and e.unidades >= 2
           and (p_ids is null or pf.producto_id = any(p_ids))
         group by pf.producto_id, e.unidades
      ) x
     where x.rn = 1
  ),
  nuevo as (
    select b.id,
           coalesce(b.volumen, case when b.cat = 'Vinos' then 0.75 end) as c,
           coalesce(b.unidad, case when b.cat = 'Vinos' then 'l' end) as u,
           bul.n,
           case when b.volumen is not null then 'nombre'
                when b.cat = 'Vinos' then 'por_defecto'
                when bul.n is not null then 'lineas' end as o
      from base b left join bul on bul.producto_id = b.id
  )
  update productos_catalogo pc
     set envase_cantidad = n.c, envase_unidad = n.u, envases_por_bulto = n.n, envase_origen = n.o
    from nuevo n
   where pc.id = n.id
     and (pc.envase_cantidad, pc.envase_unidad, pc.envases_por_bulto, pc.envase_origen)
         is distinct from (n.c, n.u, n.n, n.o);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.productos_envase_recalcular(bigint[]) from public, anon;
grant execute on function public.productos_envase_recalcular(bigint[]) to authenticated, service_role;

select public.productos_envase_recalcular(null);

-- Producto nuevo o renombrado: su envase.
create or replace function public.trg_productos_catalogo_envase()
returns trigger
language plpgsql
security definer   -- solo recalcula columnas derivadas del catálogo; quien sube líneas no necesita editar el catálogo
set search_path = public
as $$
-- 20261106400000_facturas_volumenes
begin
  perform public.productos_envase_recalcular(array[new.id]);
  return null;
end;
$$;

drop trigger if exists trg_productos_catalogo_envase on public.productos_catalogo;
create trigger trg_productos_catalogo_envase
  after insert or update of nombre, categoria_id on public.productos_catalogo
  for each row execute function public.trg_productos_catalogo_envase();

-- Líneas nuevas o reasignadas: unidades por caja de su producto.
create or replace function public.trg_productos_factura_envase()
returns trigger
language plpgsql
security definer   -- solo recalcula columnas derivadas del catálogo; quien sube líneas no necesita editar el catálogo
set search_path = public
as $$
-- 20261106400000_facturas_volumenes
declare
  v_ids bigint[];
begin
  select array_agg(distinct n.producto_id) into v_ids from nuevas n where n.producto_id is not null;
  if v_ids is not null then
    perform public.productos_envase_recalcular(v_ids);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_productos_factura_envase_ins on public.productos_factura;
create trigger trg_productos_factura_envase_ins
  after insert on public.productos_factura
  referencing new table as nuevas
  for each statement execute function public.trg_productos_factura_envase();
drop trigger if exists trg_productos_factura_envase_upd on public.productos_factura;
create trigger trg_productos_factura_envase_upd
  after update on public.productos_factura
  referencing new table as nuevas
  for each statement execute function public.trg_productos_factura_envase();

-- ─── 5. Vista: cada línea con sus litros/kilos ──────────────────────────────
create or replace view public.volumen_lineas
with (security_invoker = true)
as
select pf.id as linea_id, fa.id as doc_id, fa.fecha,
       case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
       fa.proveedor_id, fa.proveedor::text as proveedor_txt,
       coalesce(fa.proveedor_id::text,
                'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as prov_k,
       case when fa.total < 0 then 'abono' else fa.tipo::text end as tipo_k,
       pf.producto_id, pc.nombre as producto, pc.categoria_id, c.nombre as categoria,
       coalesce(c.padre_id, c.id) as fam,
       pf.nombre::text as nombre_linea,
       coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as nom_n,
       pf.cantidad, pf.unidad::text as unidad, pf.precio_unitario, pf.total as importe,
       pc.envase_cantidad, pc.envase_unidad,
       v.medida, v.por_unidad, v.cantidad_base, v.envases, v.metodo
  from facturas fa
  join productos_factura pf on pf.factura_id = fa.id
  left join productos_catalogo pc on pc.id = pf.producto_id
  left join categorias_producto c on c.id = pc.categoria_id
  left join lateral public.volumen_linea(
         pf.nombre::text, pf.unidad::text, pf.cantidad,
         coalesce(pf.precio_unitario, case when pf.cantidad <> 0 then pf.total / pf.cantidad end),
         pf.contenido_cantidad, pf.contenido_unidad,
         pc.envase_cantidad, pc.envase_unidad, pc.envases_por_bulto,
         public.volumen_max_eur_litro(c.nombre)) v on true
 where not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
   and coalesce(c.padre_id, c.id, 0) not in (
         select x.id from categorias_producto x where x.padre_id is null and x.nombre in ('Servicios', 'Limpieza y desechables', 'Menaje y equipamiento'));

comment on view public.volumen_lineas is
  '20261106400000_facturas_volumenes: líneas de compra con litros/kilos (medida, cantidad_base, envases, metodo). Sin Servicios, Limpieza ni Menaje.';
revoke all on public.volumen_lineas from public, anon;
grant select on public.volumen_lineas to authenticated, service_role;


-- ─── 6. RPC del chatbot: litros/kilos comprados ─────────────────────────────
create or replace function public.volumen_comprado_agente(
  p_texto text default null, p_categoria text default null,
  p_desde date default null, p_hasta date default null,
  p_local text default null, p_medida text default null)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 20261106400000_facturas_volumenes: «¿cuántos litros de cerveza?», «¿cuántos
-- barriles?», «kilos de gamba». Cuenta facturas + albaranes sin factura.
declare
  v_txt    text := nullif(btrim(coalesce(p_texto, '')), '');
  v_cattxt text := nullif(btrim(coalesce(p_categoria, '')), '');
  v_cat    bigint;
  v_catnom text;
  v_ids    bigint[];
  v_met    text;
  v_med    text := case lower(btrim(coalesce(p_medida, '')))
                     when 'l' then 'l' when 'litros' then 'l' when 'kg' then 'kg' when 'kilos' then 'kg' end;
  v_loc    text := case when p_local in ('casa_tomas', 'touza') then p_local end;
  r        json;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  -- «cerveza», «vinos», «licores»… escritos como producto son una familia.
  if v_cattxt is null and v_txt is not null
     and normalizar_texto(v_txt) ~ '^((las|los|el|la) )?(cervezas?|vinos?|licor(es)?|destilados?|refrescos?|bebidas?|cafes?|infusion(es)?|pescados?|mariscos?|carnes?)$' then
    v_cattxt := v_txt;
    v_txt := null;
  end if;
  if v_cattxt is not null then
    v_cat := categoria_agente(v_cattxt);
    if v_cat is null then
      return json_build_object('error', format('No conozco la categoría «%s».', left(v_cattxt, 60)));
    end if;
    select nombre into v_catnom from categorias_producto where id = v_cat;
  end if;
  if v_txt is not null then
    select l.ids, l.metodo into v_ids, v_met from lineas_producto_agente(v_txt, null) l;
    if v_ids is null then
      return json_build_object('sin_datos', true, 'producto', v_txt, 'categoria', v_catnom,
                               'nota', 'Ninguna línea de compra coincide con ese producto.');
    end if;
  end if;
  if v_cat is null and v_ids is null then
    return json_build_object('error', 'Falta producto o categoria (cerveza, vino, agua, aceite, gamba…).');
  end if;

  with
  base as materialized (
    select v.*, pc.envase_origen
      from volumen_lineas v
      left join productos_catalogo pc on pc.id = v.producto_id
     where (p_desde is null or v.fecha >= p_desde)
       and (p_hasta is null or v.fecha <= p_hasta)
       and (v_loc is null or v.loc = v_loc)
       and (v_cat is null or v.categoria_id = v_cat
            or exists (select 1 from categorias_producto c where c.id = v.categoria_id and c.padre_id = v_cat))
  ),
  sel as materialized (
    select * from base b where v_ids is null or b.linea_id = any(v_ids)
  ),
  med as (
    select coalesce(v_med,
                    (select s.medida from sel s where s.medida is not null
                      group by s.medida order by count(*) desc, s.medida limit 1), 'l') as m
  ),
  ok as (select s.* from sel s, med where s.medida = med.m),
  no as (select s.* from sel s where s.medida is null),
  pu as (
    select coalesce(o.producto, o.nombre_linea) as producto, coalesce(nullif(lower(o.unidad), ''), 'ud') as uni,
           sum(o.cantidad) as cant, sum(o.cantidad_base) as total, sum(o.envases) as envases,
           max(o.envase_cantidad) as env_c, max(o.envase_unidad) as env_u,
           string_agg(distinct trim_scale(round(o.por_unidad, 3))::text, '/') as por_u
      from ok o group by 1, 2
  ),
  por_prod as (
    select p.producto, round(sum(p.total), 2) as total, round(sum(p.envases)) as envases,
           volumen_formato(max(p.env_c), max(p.env_u)) as envase,
           string_agg(trim_scale(p.cant)::text || ' ' || p.uni || ' de ' || p.por_u || ' ' || (select m from med), ', '
                      order by p.total desc) filter (where p.cant <> 0) as compra
      from pu p group by 1
  ),
  por_fmt as (
    select volumen_formato(o.envase_cantidad, o.envase_unidad) as envase,
           round(sum(coalesce(o.envases, case when o.metodo = 'envase' then o.cantidad end))) as envases,
           round(sum(o.cantidad_base), 2) as total
      from ok o where o.envase_cantidad is not null group by 1
  ),
  por_prov as (
    select max(o.proveedor_txt) as proveedor, round(sum(o.cantidad_base), 2) as total
      from ok o group by o.prov_k
  ),
  por_mes as (
    select to_char(o.fecha, 'YYYY-MM') as mes, round(sum(o.cantidad_base), 2) as total
      from ok o group by 1
  ),
  otra as (
    select s.medida, round(sum(s.cantidad_base), 2) as total, count(*) as lineas
      from sel s, med where s.medida is not null and s.medida <> med.m group by s.medida
  )
  select json_build_object(
    'periodo', json_build_object('desde', coalesce(p_desde, (select min(fecha) from sel)), 'hasta', coalesce(p_hasta, (select max(fecha) from sel))),
    'categoria', v_catnom, 'producto', v_txt, 'coincidencia', v_met, 'local', v_loc,
    'unidad', (select m from med),
    'total', (select round(coalesce(sum(o.cantidad_base), 0), 2) from ok o),
    'envases', (select round(sum(coalesce(o.envases, case when o.metodo = 'envase' then o.cantidad end))) from ok o),
    'importe_base', (select round(sum(o.importe), 2) from ok o),
    'lineas_convertidas', (select count(*) from ok),
    'lineas_sin_convertir', (select count(*) from no),
    'sin_datos', not exists (select 1 from sel),
    'envase_supuesto_lineas', (select nullif(count(*), 0) from ok o where o.envase_origen = 'por_defecto'),
    'por_producto', (select json_agg(json_build_object('producto', x.producto, 'total', x.total, 'envases', x.envases,
                                                        'envase', x.envase, 'compra', x.compra)
                                      order by x.total desc)
                       from (select * from por_prod order by total desc limit 12) x),
    'productos', (select count(*) from por_prod),
    'por_envase', (select json_agg(json_build_object('envase', f.envase, 'envases', f.envases, 'total', f.total) order by f.total desc)
                     from (select * from por_fmt order by total desc limit 8) f),
    'por_proveedor', (select json_agg(json_build_object('proveedor', p.proveedor, 'total', p.total) order by p.total desc)
                        from (select * from por_prov order by total desc limit 6) p),
    'por_mes', (select json_agg(json_build_object('mes', m.mes, 'total', m.total) order by m.mes) from por_mes m),
    'otra_unidad', (select json_agg(json_build_object('unidad', o.medida, 'total', o.total, 'lineas', o.lineas)) from otra o),
    'sin_convertir', case when exists (select 1 from no) then json_build_object(
        'importe_base', (select round(sum(n.importe), 2) from no n),
        'motivos', (select json_object_agg(z.metodo, z.n) from (select n.metodo, count(*) as n from no n group by 1) z),
        'ejemplos', (select json_agg(json_build_object('linea', z.nombre_linea, 'unidad', z.unidad, 'lineas', z.n, 'motivo', z.metodo))
                       from (select n.nombre_linea, n.unidad, n.metodo, count(*) as n from no n
                              group by 1, 2, 3 order by count(*) desc, 1 limit 5) z)) end,
    'resto_categoria', case when v_cat is not null and v_ids is not null then
        (select json_build_object('total', round(sum(b.cantidad_base), 2), 'lineas', count(*))
           from base b, med where b.medida = med.m and not (b.linea_id = any(v_ids))) end,
    'nota', 'total = cantidad x lo que lleva cada unidad facturada (caja 24 x 33 cl = 7,92 l; barril 50 l). '
            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables).'
  ) into r;
  return r;
end;
$$;

revoke all on function public.volumen_comprado_agente(text, text, date, date, text, text) from public, anon;
grant execute on function public.volumen_comprado_agente(text, text, date, date, text, text) to authenticated, service_role;
revoke all on function public.envase_texto(text) from public, anon;
grant execute on function public.envase_texto(text) to authenticated, service_role;
revoke all on function public.volumen_linea(text, text, numeric, numeric, numeric, text, numeric, text, numeric, numeric) from public, anon;
grant execute on function public.volumen_linea(text, text, numeric, numeric, numeric, text, numeric, text, numeric, numeric) to authenticated, service_role;
revoke all on function public.volumen_max_eur_litro(text) from public, anon;
grant execute on function public.volumen_max_eur_litro(text) to authenticated, service_role;
revoke all on function public.volumen_formato(numeric, text) from public, anon;
grant execute on function public.volumen_formato(numeric, text) to authenticated, service_role;
revoke all on function public.trg_productos_catalogo_envase() from public, anon, authenticated;
revoke all on function public.trg_productos_factura_envase() from public, anon, authenticated;

-- ─── 7. Explorador de Análisis: medidas «litros» y «kilos» ─────────────────
CREATE OR REPLACE FUNCTION public.explorar_compras_error(p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb, p_top integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- 20261106310000_compras_meses_incompletos: medida retencion_irpf (por documento).
-- 20261106400000_facturas_volumenes: medidas litros y kilos (por líneas, sin filtro de unidad).
declare
  k text;
  v jsonb;
  e jsonb;
begin
  if p_medida is null or p_medida not in ('gasto', 'base', 'documentos', 'abonos', 'regalado', 'cantidad', 'precio', 'retencion_irpf', 'litros', 'kilos') then
    return 'medida debe ser gasto, base, documentos, abonos, regalado, cantidad, precio, retencion_irpf, litros o kilos.';
  end if;
  if p_agrupar is not null
     and p_agrupar not in ('dia', 'semana', 'mes', 'trimestre', 'proveedor', 'familia', 'producto', 'local', 'tipo') then
    return 'agrupar debe ser dia, semana, mes, trimestre, proveedor, familia, producto, local o tipo.';
  end if;
  if p_desglose is not null then
    if p_desglose not in ('local', 'proveedor', 'familia', 'tipo') then
      return 'desglose debe ser local, proveedor, familia, tipo o null.';
    end if;
    if p_agrupar is null then
      return 'desglose necesita agrupar.';
    end if;
    if p_desglose = p_agrupar then
      return 'desglose no puede ser lo mismo que agrupar.';
    end if;
  end if;
  if p_top is null or p_top < 1 or p_top > 50 then
    return 'top debe estar entre 1 y 50.';
  end if;
  if p_filtros is null or jsonb_typeof(p_filtros) <> 'object' then
    return 'filtros debe ser un objeto JSON.';
  end if;
  for k, v in select x.key, x.value from jsonb_each(p_filtros) x loop
    if k not in ('proveedores', 'familias', 'productos', 'tipos', 'local', 'unidad') then
      return format('filtro desconocido: %s.', left(k, 40));
    end if;
    if k in ('proveedores', 'familias', 'productos', 'tipos') then
      if jsonb_typeof(v) <> 'array' then
        return format('%s debe ser una lista.', k);
      end if;
      if jsonb_array_length(v) > 50 then
        return format('%s: como mucho 50.', k);
      end if;
      for e in select y.value from jsonb_array_elements(v) y loop
        if k = 'proveedores' and not (jsonb_typeof(e) = 'number' and (e #>> '{}') ~ '^[1-9][0-9]{0,17}$') then
          return 'proveedores: ids enteros positivos.';
        elsif k = 'familias' and not (jsonb_typeof(e) = 'number' and (e #>> '{}') ~ '^[0-9]{1,18}$') then
          return 'familias: ids enteros (0 = sin clasificar).';
        elsif k = 'productos' and not (jsonb_typeof(e) = 'string' and length(btrim(e #>> '{}')) between 1 and 160) then
          return 'productos: textos de 1 a 160 letras.';
        elsif k = 'tipos' and not (jsonb_typeof(e) = 'string' and (e #>> '{}') in ('factura', 'albaran', 'abono')) then
          return 'tipos: factura, albaran o abono.';
        end if;
      end loop;
    elsif k = 'local' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('casa_tomas', 'touza') then
        return 'local debe ser casa_tomas o touza.';
      end if;
    elsif k = 'unidad' then
      if jsonb_typeof(v) <> 'string' or length(btrim(v #>> '{}')) not between 1 and 20 then
        return 'unidad: texto de 1 a 20 letras.';
      end if;
    end if;
  end loop;
  if p_medida in ('gasto', 'abonos', 'retencion_irpf') and public.explorar_compras_por_lineas(p_medida, p_agrupar, p_desglose, p_filtros) then
    return 'gasto, abonos y retención IRPF se miden por documento; con familias, productos o unidad usa la medida base (sin IVA).';
  end if;
  if p_medida in ('litros', 'kilos') and p_filtros ? 'unidad' then
    return 'litros y kilos ya convierten cajas, botellas y barriles: quita el filtro de unidad.';
  end if;
  if p_medida in ('cantidad', 'precio') and jsonb_array_length(coalesce(p_filtros -> 'productos', '[]'::jsonb)) = 0 then
    return 'cantidad y precio necesitan filtrar uno o más productos.';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.explorar_compras_por_lineas(p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- 20261106400000_facturas_volumenes: + litros y kilos.
  select p_medida in ('base', 'regalado', 'cantidad', 'precio', 'litros', 'kilos')
      or coalesce(p_agrupar, '') in ('familia', 'producto')
      or coalesce(p_desglose, '') in ('familia', 'producto')
      or coalesce(p_filtros, '{}'::jsonb) ?| array['familias', 'productos', 'unidad']
$function$;

CREATE OR REPLACE FUNCTION public.explorar_compras_hechos(p_desde date, p_hasta date, p_medida text, p_agrupar text, p_desglose text, p_filtros jsonb)
 RETURNS TABLE(doc_id bigint, fecha date, prov_k text, proveedor_id bigint, proveedor_txt text, loc text, tipo_k text, fam_id bigint, prod_k text, prod_nombre text, unidad text, num numeric, den numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- 20261106120000_facturas_cifras_coherentes: importe de línea = solo pf.total; medida precio sin atípicos.
-- 20261106310000_compras_meses_incompletos: medida retencion_irpf (documentos con retención).
-- 20261106400000_facturas_volumenes: medidas litros y kilos (volumen_linea, sin Servicios/Limpieza/Menaje).
declare
  f       jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_err   text;
  v_prov  bigint[];
  v_fam   bigint[];
  v_prod  text[];
  v_tipos text[];
  v_local text;
  v_solo  boolean;
begin
  v_err := public.explorar_compras_error(p_medida, p_agrupar, p_desglose, f, 10);
  if v_err is not null then
    raise exception using errcode = '22023', message = v_err;
  end if;
  v_prov  := nullif(array(select x::bigint from jsonb_array_elements_text(coalesce(f -> 'proveedores', '[]')) x), '{}');
  v_fam   := nullif(array(select x::bigint from jsonb_array_elements_text(coalesce(f -> 'familias', '[]')) x), '{}');
  v_prod  := nullif(array(select distinct coalesce(nullif(public.normalizar_nombre_producto(btrim(x)), ''), lower(btrim(x)))
                            from jsonb_array_elements_text(coalesce(f -> 'productos', '[]')) x), '{}');
  v_tipos := nullif(array(select x from jsonb_array_elements_text(coalesce(f -> 'tipos', '[]')) x), '{}');
  v_local := f ->> 'local';
  v_solo  := p_medida in ('cantidad', 'precio') or coalesce(p_agrupar, '') = 'producto';

  if not public.explorar_compras_por_lineas(p_medida, p_agrupar, p_desglose, f) then
    return query
      select d.id, d.fecha, d.prov_k, d.proveedor_id, d.proveedor_txt, d.loc, d.tipo_k,
             null::bigint, null::text, null::text, null::text,
             (case when p_medida = 'abonos' then -d.total when p_medida = 'retencion_irpf' then d.retencion_irpf
                   else coalesce(d.total, 0) end)::numeric,
             0::numeric
        from (select fa.id, fa.fecha, fa.total, fa.retencion_irpf, fa.proveedor_id, fa.proveedor::text as proveedor_txt,
                     coalesce(fa.proveedor_id::text,
                              'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as prov_k,
                     case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
                     case when fa.total < 0 then 'abono' else fa.tipo::text end as tipo_k
                from facturas fa
               where fa.fecha between p_desde and p_hasta
                 and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)) d
       where (p_medida <> 'abonos' or d.total < 0)
         and (p_medida <> 'retencion_irpf' or d.retencion_irpf is not null)
         and (v_local is null or d.loc = v_local)
         and (v_prov is null or d.proveedor_id = any(v_prov))
         and (v_tipos is null or d.tipo_k = any(v_tipos));
  else
    -- «¿Es producto?» sale de la caché nombres_linea_no_producto
    -- (20261105191000); solo lo que falte se calcula al vuelo.
    return query
      with l as materialized (
       select x.* from (
        select fa.id, fa.fecha, fa.proveedor_id, fa.proveedor::text as proveedor_txt,
               coalesce(fa.proveedor_id::text,
                        'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as prov_k,
               case when fa.local = 'touza' then 'touza' else 'casa_tomas' end as loc,
               case when fa.total < 0 then 'abono' else fa.tipo::text end as tipo_k,
               coalesce(c.padre_id, c.id) as fam,
               coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as nom_n,
               pf.nombre::text as nombre,
               lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as uni,
               np.no_producto as no_prod,
               pf.cantidad, pf.precio_unitario, pf.importe_bruto, pf.total as total_linea,
               pf.total::numeric as importe,  -- sin importe leído no suma (20261106120000)
               cr.nombre as raiz_nombre, vl.medida as v_med, vl.cantidad_base as v_base
          from facturas fa
          join productos_factura pf on pf.factura_id = fa.id
          left join productos_catalogo pc on pc.id = pf.producto_id
          left join categorias_producto c on c.id = pc.categoria_id
          left join categorias_producto cr on cr.id = coalesce(c.padre_id, c.id)
          left join lateral (
                 select x.medida, x.cantidad_base
                   from public.volumen_linea(
                          pf.nombre::text, pf.unidad::text, pf.cantidad,
                          coalesce(pf.precio_unitario, case when pf.cantidad <> 0 then pf.total / pf.cantidad end),
                          pf.contenido_cantidad, pf.contenido_unidad,
                          pc.envase_cantidad, pc.envase_unidad, pc.envases_por_bulto,
                          public.volumen_max_eur_litro(c.nombre)) x
                  where p_medida in ('litros', 'kilos')) vl on true
          left join public.nombres_linea_no_producto np
                 on np.nombre_n = coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) and np.unidad_k = lower(btrim(coalesce(pf.unidad::text, '')))
         where fa.fecha between p_desde and p_hasta
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       ) x
       where (v_local is null or x.loc = v_local)
         and (v_prov is null or x.proveedor_id = any(v_prov))
         and (v_tipos is null or x.tipo_k = any(v_tipos))
         and (v_fam is null or coalesce(x.fam, 0) = any(v_fam))
         and (v_prod is null or x.nom_n = any(v_prod))
         and (p_medida <> 'regalado' or x.importe_bruto > x.total_linea)
         and (p_medida not in ('cantidad', 'precio') or (x.cantidad > 0 and x.precio_unitario > 0))
         -- Litros/kilos: las líneas convertidas y, sin convertir (cuentan en
         -- lineas_sin_convertir), las de Bebidas (litros) o pescado/carne (kilos).
         and (p_medida not in ('litros', 'kilos')
              or (coalesce(x.raiz_nombre, '') not in ('Servicios', 'Limpieza y desechables', 'Menaje y equipamiento')
                  and (x.v_med = case p_medida when 'litros' then 'l' else 'kg' end
                       or (x.v_med is null
                           and x.raiz_nombre = any(case p_medida when 'litros' then array['Bebidas']
                                                   else array['Pescado y marisco', 'Carnes y embutidos'] end)))))
      ),
      -- Precio: con 3 compras o más del mismo proveedor, producto y unidad (en todo
      -- el histórico, para que el explorador y documentos_de_cifra den lo mismo con
      -- cualquier rango), la que está a más de 3× (o a menos de 1/3) de la mediana no
      -- cuenta: suele ser una caja leída como unidad.
      med as (
        select coalesce(fa.proveedor_id::text,
                        'n:' || coalesce(nullif(fa.proveedor_normalizado::text, ''), lower(fa.proveedor::text), '?')) as m_prov,
               coalesce(nullif(pf.nombre_normalizado::text, ''), lower(pf.nombre::text)) as m_nom,
               lower(coalesce(nullif(btrim(pf.unidad::text), ''), 'ud')) as m_uni,
               percentile_cont(0.5) within group (order by pf.precio_unitario) as mediana, count(*) as m_n
          from facturas fa
          join productos_factura pf on pf.factura_id = fa.id
         where p_medida = 'precio'
           and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
           and pf.cantidad > 0 and pf.precio_unitario > 0
         group by 1, 2, 3
      )
      select l.id, l.fecha, l.prov_k, l.proveedor_id, l.proveedor_txt, l.loc, l.tipo_k,
             l.fam, l.nom_n, l.nombre,
             case p_medida when 'litros' then 'l' when 'kilos' then 'kg' else l.uni end,
             (case p_medida
                when 'regalado' then l.importe_bruto - l.total_linea
                when 'cantidad' then l.precio_unitario * l.cantidad
                when 'precio'   then l.precio_unitario * l.cantidad
                when 'litros'   then case when l.v_med = 'l' then l.v_base end
                when 'kilos'    then case when l.v_med = 'kg' then l.v_base end
                else l.importe end)::numeric,
             (case when p_medida in ('cantidad', 'precio') then l.cantidad else 0 end)::numeric
        from l
        left join med on med.m_prov = l.prov_k and med.m_nom = l.nom_n and med.m_uni = l.uni
       where (not v_solo or not coalesce(l.no_prod, public.es_linea_no_producto_tablero(l.nom_n, l.uni)))
         and (p_medida <> 'precio' or med.m_n is null or med.m_n < 3
              or l.precio_unitario between med.mediana / 3 and med.mediana * 3);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.explorar_compras(p_desde date, p_hasta date, p_medida text, p_agrupar text, p_desglose text DEFAULT NULL::text, p_filtros jsonb DEFAULT '{}'::jsonb, p_top integer DEFAULT 10)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261105170000_explorar_compras
-- 20261106120000_facturas_cifras_coherentes: sin «−100 %» con el periodo vacío; lineas_sin_importe; precio sin atípicos.
-- 20261106310000_compras_meses_incompletos: medida retencion_irpf; puntos[i].incompleto (mes/trimestre),
--   meses_incompletos y total.variacion_aviso.
-- 20261106400000_facturas_volumenes: medidas litros y kilos (volumen_linea); total.lineas_sin_convertir.
declare
  v_medida    text := lower(btrim(coalesce(p_medida, '')));
  v_agrupar   text := nullif(lower(btrim(coalesce(p_agrupar, ''))), '');
  v_desglose  text := nullif(lower(btrim(coalesce(p_desglose, ''))), '');
  v_filtros   jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_top       int := coalesce(p_top, 10);
  v_err       text;
  v_desde     date;
  v_hasta     date;
  v_hasta_ef  date;
  v_meses     int;
  v_ant_desde date;
  v_ant_hasta date;
  v_tiempo    boolean;
  v_unidad_t  text;
  v_paso      interval;
  v_buckets   int;
  resultado   jsonb;
begin
  if v_agrupar is null then
    return json_build_object('error', 'agrupar es obligatorio.');
  end if;
  v_err := public.explorar_compras_error(v_medida, v_agrupar, v_desglose, v_filtros, v_top);
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;

  v_desde := coalesce(p_desde, (select min(fa.fecha) from facturas fa));
  v_hasta := coalesce(p_hasta, (select max(fa.fecha) from facturas fa));
  if v_desde is null or v_hasta is null or v_desde > v_hasta then
    return json_build_object('sin_datos', true, 'puntos', '[]'::json, 'series', '[]'::json,
                             'parametros', json_build_object('desde', p_desde, 'hasta', p_hasta, 'medida', v_medida,
                                                             'agrupar', v_agrupar, 'desglose', v_desglose));
  end if;
  v_hasta_ef := case when v_desde <= current_date and v_hasta > current_date then current_date else v_hasta end;

  -- Periodo anterior equivalente (misma regla que tablero_compras).
  if p_desde is not null and p_hasta is not null then
    if extract(day from p_desde) = 1
       and p_hasta = (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date then
      v_meses := (extract(year from p_hasta)::int * 12 + extract(month from p_hasta)::int)
               - (extract(year from p_desde)::int * 12 + extract(month from p_desde)::int) + 1;
      v_ant_desde := (p_desde - make_interval(months => v_meses))::date;
      v_ant_hasta := case when v_hasta_ef = p_hasta then p_desde - 1
                          else (v_hasta_ef - make_interval(months => v_meses))::date end;
    else
      v_ant_hasta := p_desde - 1;
      v_ant_desde := v_ant_hasta - (v_hasta_ef - p_desde);
    end if;
  end if;

  -- Eje de tiempo: todos los tramos del periodo (con 0 donde no hay nada).
  v_tiempo := v_agrupar in ('dia', 'semana', 'mes', 'trimestre');
  if v_tiempo then
    v_unidad_t := case v_agrupar when 'dia' then 'day' when 'semana' then 'week' when 'mes' then 'month' else 'quarter' end;
    v_paso := case v_agrupar when 'dia' then interval '1 day' when 'semana' then interval '1 week'
                             when 'mes' then interval '1 month' else interval '3 months' end;
    select count(*) into v_buckets
      from generate_series(date_trunc(v_unidad_t, v_desde::timestamp), date_trunc(v_unidad_t, v_hasta_ef::timestamp), v_paso);
    if v_agrupar = 'dia' and v_buckets > 400 then
      return json_build_object('error', format('Demasiados días (%s): agrupa por semana o por mes.', v_buckets));
    end if;
    if v_agrupar = 'semana' and v_buckets > 270 then
      return json_build_object('error', format('Demasiadas semanas (%s): agrupa por mes.', v_buckets));
    end if;
  end if;

  with
  inc as (
    select i.mes from public.meses_compras_incompletos(nullif(v_filtros ->> 'local', '')) i
  ),
  inc_act as (select inc.mes from inc where inc.mes between date_trunc('month', v_desde)::date and v_hasta),
  inc_ant as (
    select inc.mes from inc
     where v_ant_desde is not null and inc.mes between date_trunc('month', v_ant_desde)::date and v_ant_hasta
  ),
  h0 as materialized (
    select * from public.explorar_compras_hechos(least(v_desde, v_ant_desde), v_hasta, v_medida, v_agrupar, v_desglose, v_filtros)
  ),
  uds as (
    select x.unidad, count(*) as lineas from h0 x
     where x.unidad is not null and x.fecha between v_desde and v_hasta
     group by x.unidad
  ),
  u as (
    select coalesce(nullif(lower(btrim(v_filtros ->> 'unidad')), ''),
                    case when v_medida in ('cantidad', 'precio')
                         then (select uds.unidad from uds order by uds.lineas desc, uds.unidad limit 1)
                         when v_medida = 'litros' then 'l' when v_medida = 'kilos' then 'kg' end) as unidad
  ),
  h as materialized (
    select x.*,
           public.explorar_compras_clave(v_agrupar, x.fecha, x.prov_k, x.loc, x.tipo_k, x.fam_id, x.prod_k) as k1,
           public.explorar_compras_clave(v_desglose, x.fecha, x.prov_k, x.loc, x.tipo_k, x.fam_id, x.prod_k) as k2
      from h0 x cross join u
     where u.unidad is null or x.unidad = u.unidad
  ),
  act as (select * from h where h.fecha between v_desde and v_hasta),
  ant as (select * from h where v_ant_desde is not null and h.fecha between v_ant_desde and v_ant_hasta),
  -- Valor de un grupo: la misma cuenta en todas partes.
  g1 as (
    select a.k1,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           count(distinct a.doc_id) as docs,
           max(a.proveedor_id) as pid, max(a.proveedor_txt) as ptxt, max(a.prod_nombre) as pnom
      from act a group by a.k1
  ),
  rk as (
    select g1.*, row_number() over (order by g1.valor desc nulls last, g1.k1) as rn from g1
  ),
  top1 as (
    select rk.* from rk where v_tiempo or v_agrupar in ('familia', 'local', 'tipo') or rk.rn <= v_top
  ),
  -- Series del desglose (proveedor: top N + «Otros»).
  gs as (
    select a.k2,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           max(a.proveedor_id) as pid, max(a.proveedor_txt) as ptxt
      from act a where v_desglose is not null group by a.k2
  ),
  sk as (
    select gs.*, case when v_desglose = 'proveedor'
                           and row_number() over (order by gs.valor desc nulls last, gs.k2) > v_top
                      then '__otros__' else gs.k2 end as ks
      from gs
  ),
  series as (
    select sk.ks,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           max(sk.pid) as pid, max(sk.ptxt) as ptxt
      from act a join sk on sk.k2 = a.k2
     group by sk.ks
  ),
  g12 as (
    select a.k1, sk.ks,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor
      from act a join sk on sk.k2 = a.k2
     group by a.k1, sk.ks
  ),
  tramos as (
    select public.explorar_compras_clave(v_agrupar, g::date, null, null, null, null, null) as k1
      from generate_series(date_trunc(coalesce(v_unidad_t, 'day'), v_desde::timestamp),
                           date_trunc(coalesce(v_unidad_t, 'day'), v_hasta_ef::timestamp),
                           coalesce(v_paso, interval '1 day')) g
     where v_tiempo
    union
    select g1.k1 from g1 where v_tiempo
  ),
  puntos as (
    select t.k1, x.valor, x.docs, x.pid, x.ptxt, x.pnom, coalesce(x.rn, 0) as rn
      from tramos t left join rk x on x.k1 = t.k1
     where v_tiempo
    union all
    select x.k1, x.valor, x.docs, x.pid, x.ptxt, x.pnom, x.rn from top1 x where not v_tiempo
  ),
  resto as (
    select count(distinct a.k1) as entidades, count(distinct a.doc_id) as docs,
           case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor
      from act a
     where not v_tiempo and not exists (select 1 from top1 t where t.k1 is not distinct from a.k1)
  ),
  tot as (
    select case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           count(distinct a.doc_id) as docs, count(*) as filas,
           count(*) filter (where a.num is null) as sin_importe
      from act a
  ),
  tant as (
    select case v_medida when 'precio' then round(sum(a.num) / nullif(sum(a.den), 0), 4)
                         when 'cantidad' then round(sum(a.den), 3)
                         when 'documentos' then count(distinct a.doc_id)::numeric
                         else round(coalesce(sum(a.num), 0), 2) end as valor,
           count(distinct a.doc_id) as docs
      from ant a
  )
  select jsonb_build_object(
    'parametros', jsonb_build_object(
        'desde', v_desde, 'hasta', v_hasta, 'hasta_efectivo', v_hasta_ef,
        'medida', v_medida, 'agrupar', v_agrupar, 'desglose', v_desglose, 'filtros', v_filtros, 'top', v_top,
        'por_lineas', public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros),
        'solo_productos', v_medida in ('cantidad', 'precio') or v_agrupar = 'producto',
        'unidad', (select u.unidad from u),
        'precio_sin_atipicos', v_medida = 'precio'),
    'sin_datos', (select t.docs = 0 from tot t),
    'total', (select jsonb_build_object('valor', t.valor, 'documentos', t.docs,
                                        'lineas', case when public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros)
                                                       then t.filas end,
                                        'lineas_sin_importe', case when public.explorar_compras_por_lineas(v_medida, v_agrupar, v_desglose, v_filtros)
                                                                   then t.sin_importe end,
                                        'lineas_sin_convertir', case when v_medida in ('litros', 'kilos') then t.sin_importe end,
                                        'variacion_pct', case when v_ant_desde is not null and t.docs > 0 and ta.valor > 0 and t.valor is not null
                                                                   and ta.docs >= 0.5 * t.docs
                                                              then round((t.valor / ta.valor - 1) * 100, 1) end,
                                        'variacion_aviso', case when v_ant_desde is not null and t.docs > 0 and ta.valor > 0 and t.valor is not null
                                                                     and ta.docs >= 0.5 * t.docs and v_medida <> 'precio'
                                                                     and (exists (select 1 from inc_act) or exists (select 1 from inc_ant))
                                                                then 'La comparación incluye meses incompletos ('
                                                                     || (select string_agg(to_char(x.mes, 'MM/YYYY'), ', ' order by x.mes)
                                                                           from (select mes from inc_act union select mes from inc_ant) x)
                                                                     || '): faltan facturas por subir y la variación no es fiable.' end)
                from tot t cross join tant ta),
    'anterior', case when v_ant_desde is not null then
                  (select jsonb_build_object('desde', v_ant_desde, 'hasta', v_ant_hasta, 'valor', ta.valor, 'documentos', ta.docs)
                     from tant ta) end,
    'unidades', case when v_medida in ('cantidad', 'precio') or v_filtros ? 'unidad' then
                  coalesce((select jsonb_agg(jsonb_build_object('unidad', uds.unidad, 'lineas', uds.lineas)
                                             order by uds.lineas desc, uds.unidad) from uds), '[]'::jsonb) end,
    'meses_incompletos', coalesce((select jsonb_agg(to_char(i.mes, 'YYYY-MM') order by i.mes) from inc_act i), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clave', s.ks,
               'etiqueta', public.explorar_compras_etiqueta(v_desglose, s.ks, s.pid, s.ptxt, null),
               'id', case when s.ks <> '__otros__' and v_desglose = 'proveedor' then s.pid
                          when s.ks <> '__otros__' and v_desglose = 'familia' and s.ks <> '0' then s.ks::bigint end,
               'valor', s.valor)
             order by (s.ks = '__otros__'), s.valor desc nulls last, s.ks)
        from series s), '[]'::jsonb),
    'puntos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clave', p.k1,
               'etiqueta', public.explorar_compras_etiqueta(v_agrupar, p.k1, p.pid, p.ptxt, p.pnom),
               'id', case when v_agrupar = 'proveedor' and p.k1 not like 'n:%' then p.pid
                          when v_agrupar = 'familia' and p.k1 <> '0' then p.k1::bigint end,
               'valor', case when p.valor is null and v_medida not in ('precio') then 0 else p.valor end,
               'documentos', coalesce(p.docs, 0),
               'incompleto', case when v_agrupar = 'mes'
                                    then exists (select 1 from inc_act i where to_char(i.mes, 'YYYY-MM') = p.k1)
                                  when v_agrupar = 'trimestre'
                                    then exists (select 1 from inc_act i where to_char(i.mes, 'YYYY') || '-T' || to_char(i.mes, 'Q') = p.k1) end,
               'desglose', case when v_desglose is not null then
                             coalesce((select jsonb_object_agg(g.ks, g.valor) from g12 g where g.k1 = p.k1), '{}'::jsonb) end)
             order by case when v_tiempo then 0 else p.rn end, p.k1)
        from puntos p), '[]'::jsonb),
    'resto', case when not v_tiempo then
               (select case when r.entidades > 0 then jsonb_build_object('entidades', r.entidades, 'valor', r.valor,
                                                                         'documentos', r.docs) end
                  from resto r) end
  ) into resultado;

  return resultado::json;
end;
$function$;

select 'facturas_volumenes: aplicada' as resultado;

commit;
