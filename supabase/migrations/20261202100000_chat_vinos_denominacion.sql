set client_encoding = 'UTF8';
-- 20261202100000_chat_vinos_denominacion (15/11/2026)
-- Problema (producción, 15/11/2026): «¿cuánto me he gastado en vinos de Rioja en septiembre?» → el chat
--   contestó «no hay compras registradas con "Rioja" en el nombre». Falso: Viña Arana Gran Reserva
--   (1.626 €) y Quiñón de Valmira (1.740 €), entre otros, son D.O.Ca. Rioja. Las líneas de factura casi
--   nunca dicen la D.O. y el bot buscaba «Rioja» en el texto.
-- Antes: productos_catalogo no sabía la D.O. de un vino; gasto_categorias_agente y
--   volumen_comprado_agente solo filtraban por categoría o por texto del nombre.
-- Ahora:
--   · productos_catalogo.denominacion_origen («D.O.Ca. Rioja», «D.O. Ribera del Duero», «AOC Champagne»),
--     region_vino (comunidad o región vitícola: «La Rioja», «Galicia», «Champagne», «Burdeos»), pais_vino
--     y denominacion_origen_origen ('carta' | 'ia' | 'manual').
--   · vino_denominacion_sincronizar(ids): copia D.O., región y país de la carta ("Vinos") a los productos
--     enlazados en vino_producto, sin pisar 'manual' (y la carta pisa 'ia'). Triggers en vino_producto y
--     en "Vinos" (cambio de D.O./región/país). Se rellena todo al aplicar.
--   · vino_terminos / vino_coincide: «Rioja», «Ribera» (= Ribera del Duero), «champán francés», «vinos
--     gallegos», «Priorato», «Rías Bajas»… sin mayúsculas ni tildes, contra D.O. + región + país.
--   · gasto_categorias_agente y volumen_comprado_agente: p_denominacion, p_region y p_pais (al final, con
--     DEFAULT NULL: el panel y el chat anterior siguen igual). Traen filtro_vino y vino_sin_denominacion
--     (líneas de vino del periodo cuyo producto no tiene D.O. conocida).
-- Parte de las definiciones vigentes en PRODUCCIÓN (pg_get_functiondef, 15/11/2026). Se borran las firmas
-- anteriores: dos sobrecargas con DEFAULT darían «no se puede elegir la función» en PostgREST.
-- Orden: esta migración → (opcional) denominaciones_vinos_produccion.sql (deducción 'ia') → Edge Function
-- chat-facturas. La chat-facturas anterior sigue funcionando con esta migración.
begin;
set local lock_timeout = '5s';

-- ─── Columnas ───
alter table public.productos_catalogo
  add column if not exists denominacion_origen text,
  add column if not exists region_vino text,
  add column if not exists pais_vino text,
  add column if not exists denominacion_origen_origen text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_catalogo_denominacion_origen_origen_check') then
    alter table public.productos_catalogo
      add constraint productos_catalogo_denominacion_origen_origen_check
      check (denominacion_origen_origen in ('carta', 'ia', 'manual'));
  end if;
end $$;

comment on column public.productos_catalogo.denominacion_origen is
  'D.O. del vino («D.O.Ca. Rioja», «D.O. Ribera del Duero», «AOC Champagne»). null = no se sabe.';
comment on column public.productos_catalogo.region_vino is
  'Región del vino: comunidad autónoma en España («La Rioja», «Galicia»), región vitícola fuera («Champagne», «Burdeos»).';
comment on column public.productos_catalogo.pais_vino is 'País del vino («España», «Francia»).';
comment on column public.productos_catalogo.denominacion_origen_origen is
  'De dónde salen denominacion_origen/region_vino/pais_vino: carta (vino_producto → "Vinos"), ia (deducido del nombre) o manual (no se pisa).';

-- ─── Ayudantes puros ───
-- Minúsculas, sin tildes, puntos/guiones/apóstrofos a espacios, espacios simples.
create or replace function public.vino_texto_normalizado(p text)
returns text
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select nullif(btrim(regexp_replace(
           translate(lower(coalesce(p, '')),
                     'áàâäãåéèêëíìîïóòôöõúùûüçñ''’`´.-,/()',
                     'aaaaaaeeeeiiiiooooouuuucn           '),
           '\s+', ' ', 'g')), '')
$$;

-- D.O. tal como se guarda: «D.O. Rioja» → «D.O.Ca. Rioja»; «Sin D.O.» → null.
create or replace function public.vino_denominacion_canonica(p text)
returns text
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select case
    when vino_texto_normalizado(p) is null then null
    when vino_texto_normalizado(p) in ('sin d o', 'sin do', 'sin denominacion') then null
    when vino_texto_normalizado(p) ~ '^d o (ca )?rioja$' then 'D.O.Ca. Rioja'
    when vino_texto_normalizado(p) ~ '^d o q priorat$' then 'D.O.Q. Priorat'
    else regexp_replace(btrim(p), 'Ribera Del Duero', 'Ribera del Duero')
  end
$$;

-- Región a partir de la D.O. y del texto de región de la carta.
create or replace function public.vino_region_de(p_do text, p_region text, p_pais text default null)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public'
as $$
declare
  x text := ' ' || coalesce(vino_texto_normalizado(p_do), '') || ' ' || coalesce(vino_texto_normalizado(p_region), '') || ' ';
begin
  if btrim(x) = '' then return null; end if;
  if x ~ ' (alava|alavesa|pais vasco|txakoli|getariako|bizkaiko) ' then return 'País Vasco'; end if;
  if x ~ ' rioja ' then
    if x ~ ' navarra ' then return 'Navarra'; end if;
    return 'La Rioja';
  end if;
  if x ~ ' (galicia|rias baixas|ribeiro|ribeira sacra|valdeorras|monterrei|ourense|pontevedra|lugo|coruna) ' then return 'Galicia'; end if;
  if x ~ ' jumilla | yecla | bullas | murcia ' then return 'Región de Murcia'; end if;
  if x ~ ' (castilla la mancha|la mancha|almansa|valdepenas|manchuela|ucles|albacete|ciudad real|toledo|cuenca|guadalajara) ' or x ~ ' igp castilla  ' or btrim(x) ~ '^igp castilla$' then return 'Castilla-La Mancha'; end if;
  if x ~ ' (castilla y leon|ribera del duero|rueda|toro|bierzo|cigales|arlanza|abadia retuerta|valladolid|burgos|soria|leon|zamora|segovia|salamanca|avila) ' then return 'Castilla y León'; end if;
  if x ~ ' (priorat|penedes|montsant|alella|cataluna|catalunya|barcelona|tarragona|girona|lleida|emporda|costers del segre|conca de barbera|terra alta|cava) ' then return 'Cataluña'; end if;
  if x ~ ' (alicante|utiel requena|valencia|castellon|comunidad valenciana) ' then return 'Comunidad Valenciana'; end if;
  if x ~ ' madrid ' then return 'Comunidad de Madrid'; end if;
  if x ~ ' (navarra|otazu) ' then return 'Navarra'; end if;
  if x ~ ' (campo de borja|calatayud|carinena|somontano|aragon|zaragoza|huesca|teruel) ' then return 'Aragón'; end if;
  if x ~ ' (jerez|sherry|xeres|montilla|malaga|manzanilla|sanlucar|cadiz|cordoba|huelva|andalucia) ' then return 'Andalucía'; end if;
  if x ~ ' (lanzarote|tenerife|canarias|la palma|gran canaria|abona|tacoronte) ' then return 'Canarias'; end if;
  if x ~ ' (extremadura|ribera del guadiana) ' then return 'Extremadura'; end if;
  if x ~ ' (champagne|champenois|marne|reims|epernay) ' then return 'Champagne'; end if;
  if x ~ ' (chablis|bourgogne|borgona|yonne|cote d or|beaune|nuits) ' then return 'Borgoña'; end if;
  if x ~ ' (margaux|saint emilion|pauillac|pomerol|sauternes|barsac|pessac|medoc|gironde|bordeaux|burdeos|saint julien|saint estephe|graves) ' then return 'Burdeos'; end if;
  if x ~ ' (alsace|alsacia) ' then return 'Alsacia'; end if;
  if x ~ ' (loire|loira|pouilly|vouvray|sancerre|saumur|saumurois|nievre|muscadet) ' then return 'Loira'; end if;
  if x ~ ' (rhone|rodano|hermitage|chateauneuf|cote rotie|crozes) ' then return 'Ródano'; end if;
  if x ~ ' (provence|provenza) ' then return 'Provenza'; end if;
  if x ~ ' (prosecco|veneto|valpolicella|amarone) ' then return 'Véneto'; end if;
  if x ~ ' (asti|piamonte|piemonte|barolo|barbaresco) ' then return 'Piamonte'; end if;
  if x ~ ' (toscana|chianti|montalcino) ' then return 'Toscana'; end if;
  if x ~ ' (mosel|mosela) ' then return 'Mosela'; end if;
  if x ~ ' tokaj ' then return 'Tokaj'; end if;
  if x ~ ' stellenbosch ' then return 'Stellenbosch'; end if;
  if x ~ ' barossa ' then return 'Barossa Valley'; end if;
  return null;
end;
$$;

-- País: el de la carta o, si no viene, el que dice la D.O.
create or replace function public.vino_pais_de(p_do text, p_pais text)
returns text
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select coalesce(nullif(btrim(coalesce(p_pais, '')), ''),
                  case when vino_texto_normalizado(p_do) ~ '^(aoc|aop|ac) ' then 'Francia'
                       when vino_texto_normalizado(p_do) ~ '^(d o|igp|vt|vino de la tierra|vino de pago) ' then 'España'
                       when vino_texto_normalizado(p_do) ~ '^(doc|docg|igt) ' then 'Italia' end)
$$;

-- Palabras de un filtro de vino ya normalizadas y con alias. null = sin filtro.
--   «vinos de Rioja» → {rioja}; «Ribera» → {ribera,duero}; «champán francés» → {champagne,francia};
--   «vinos gallegos» → {galicia}; «D.O.Ca. Rioja» → {rioja}; «Rías Bajas» → {rias,baixas}.
create or replace function public.vino_terminos(p text)
returns text[]
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  with w as (
    select u.x, u.o
      from unnest(string_to_array(vino_texto_normalizado(p), ' ')) with ordinality as u(x, o)
  ),
  a as (
    select case
             when x in ('champan', 'champanes', 'champana', 'champanas', 'champagnes') then 'champagne'
             when x in ('cavas') then 'cava'
             when x in ('priorato') then 'priorat'
             when x in ('bajas') then 'baixas'
             when x in ('sherry', 'xeres') then 'jerez'
             when x in ('bordeaux', 'bordeos', 'bordeles', 'bordeleses') then 'burdeos'
             when x in ('bourgogne', 'borgonas', 'borgones', 'borgonon', 'borgonones') then 'borgona'
             when x in ('alsace', 'alsaciano', 'alsacianos') then 'alsacia'
             when x in ('loire') then 'loira'
             when x in ('rhone') then 'rodano'
             when x in ('gallego', 'gallegos', 'gallega', 'gallegas') then 'galicia'
             when x in ('riojano', 'riojanos', 'riojana', 'riojanas') then 'rioja'
             when x in ('catalan', 'catalanes', 'catalana', 'catalanas', 'catalunya') then 'cataluna'
             when x in ('vasco', 'vascos', 'vasca', 'vascas') then 'vasco'
             when x in ('navarro', 'navarros', 'navarra', 'navarras') then 'navarra'
             when x in ('castellano', 'castellanos', 'castellana', 'castellanas') then 'castilla'
             when x in ('manchego', 'manchegos', 'manchega', 'manchegas') then 'mancha'
             when x in ('andaluz', 'andaluces', 'andaluza', 'andaluzas') then 'andalucia'
             when x in ('canario', 'canarios', 'canaria', 'canarias') then 'canarias'
             when x in ('valenciano', 'valencianos', 'valenciana', 'valencianas') then 'valenciana'
             when x in ('alicantino', 'alicantinos', 'alicantina', 'alicantinas') then 'alicante'
             when x in ('madrileno', 'madrilenos', 'madrilena', 'madrilenas') then 'madrid'
             when x in ('murciano', 'murcianos', 'murciana', 'murcianas') then 'murcia'
             when x in ('aragones', 'aragoneses', 'aragonesa', 'aragonesas') then 'aragon'
             when x in ('frances', 'franceses', 'francesa', 'francesas') then 'francia'
             when x in ('espanol', 'espanoles', 'espanola', 'espanolas', 'nacional', 'nacionales') then 'espana'
             when x in ('italiano', 'italianos', 'italiana', 'italianas') then 'italia'
             when x in ('aleman', 'alemanes', 'alemana', 'alemanas') then 'alemania'
             when x in ('portugues', 'portugueses', 'portuguesa', 'portuguesas') then 'portugal'
             when x in ('australiano', 'australianos', 'australiana', 'australianas') then 'australia'
             when x in ('sudafricano', 'sudafricanos', 'sudafricana', 'sudafricanas') then 'sudafrica'
             when x in ('hungaro', 'hungaros', 'hungara', 'hungaras') then 'hungria'
             else x end as x, o
      from w
     where x not in ('d', 'o', 'ca', 'q', 'p', 'do', 'doca', 'doq', 'dop', 'doc', 'docg', 'aoc', 'aop', 'igp', 'vt',
                     'vino', 'vinos', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'tipo',
                     'denominacion', 'denominaciones', 'origen', 'region', 'zona', 'pais', 'procedencia',
                     'tinto', 'tintos', 'blanco', 'blancos', 'rosado', 'rosados', 'espumoso', 'espumosos',
                     'botella', 'botellas', 'comunidad', 'calificada')
  ),
  t as (select array_agg(distinct x) as xs from a)
  select case when t.xs = array['ribera'] then array['duero', 'ribera'] else t.xs end from t
$$;

-- ¿Casa el vino (D.O., región, país) con todas las palabras del filtro?
create or replace function public.vino_coincide(p_terminos text[], p_do text, p_region text, p_pais text)
returns boolean
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select p_terminos is null or cardinality(p_terminos) = 0
      or p_terminos <@ string_to_array(concat_ws(' ', vino_texto_normalizado(p_do), vino_texto_normalizado(p_region),
                                                  vino_texto_normalizado(p_pais)), ' ')
$$;

revoke all on function public.vino_texto_normalizado(text) from public, anon;
revoke all on function public.vino_denominacion_canonica(text) from public, anon;
revoke all on function public.vino_region_de(text, text, text) from public, anon;
revoke all on function public.vino_pais_de(text, text) from public, anon;
revoke all on function public.vino_terminos(text) from public, anon;
revoke all on function public.vino_coincide(text[], text, text, text) from public, anon;
grant execute on function public.vino_texto_normalizado(text) to authenticated, service_role;
grant execute on function public.vino_denominacion_canonica(text) to authenticated, service_role;
grant execute on function public.vino_region_de(text, text, text) to authenticated, service_role;
grant execute on function public.vino_pais_de(text, text) to authenticated, service_role;
grant execute on function public.vino_terminos(text) to authenticated, service_role;
grant execute on function public.vino_coincide(text[], text, text, text) to authenticated, service_role;

-- ─── Relleno desde la carta ───
-- Para cada producto: el vino enlazado con D.O. (si hay varios, el activo y más reciente). Nunca pisa
-- 'manual'; la carta pisa 'ia' solo si trae algo; si el producto ya no está enlazado y venía de la carta,
-- se vacía. Devuelve las filas cambiadas.
create or replace function public.vino_denominacion_sincronizar(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  with ids as (select distinct x as id from unnest(p_ids) x where x is not null),
  s as (
    select i.id, c.do_, c.reg, c.pais, coalesce(c.hay, false) as hay
      from ids i
      left join lateral (
        select vino_denominacion_canonica(v.denominacion_origen) as do_,
               vino_region_de(v.denominacion_origen, v.ubicacion_region, v.ubicacion_pais) as reg,
               vino_pais_de(v.denominacion_origen, v.ubicacion_pais) as pais,
               true as hay
          from vino_producto vp
          join "Vinos" v on v.id = vp.vino_id
         where vp.producto_id = i.id
         order by (vino_denominacion_canonica(v.denominacion_origen) is null), coalesce(v.activado, false) desc,
                  v.updated_at desc nulls last, v.id
         limit 1) c on true
  ),
  nuevo as (
    select s.id,
           case when s.hay and (s.do_ is not null or s.reg is not null or s.pais is not null) then s.do_ end as do_,
           case when s.hay and (s.do_ is not null or s.reg is not null or s.pais is not null) then s.reg end as reg,
           case when s.hay and (s.do_ is not null or s.reg is not null or s.pais is not null) then s.pais end as pais,
           case when s.hay and (s.do_ is not null or s.reg is not null or s.pais is not null) then 'carta' end as origen
      from s
  )
  update productos_catalogo p
     set denominacion_origen = nv.do_, region_vino = nv.reg, pais_vino = nv.pais,
         denominacion_origen_origen = nv.origen
    from nuevo nv
   where p.id = nv.id
     and p.denominacion_origen_origen is distinct from 'manual'
     and (nv.origen = 'carta' or p.denominacion_origen_origen = 'carta')
     and (p.denominacion_origen, p.region_vino, p.pais_vino, p.denominacion_origen_origen)
         is distinct from (nv.do_, nv.reg, nv.pais, nv.origen);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.vino_denominacion_sincronizar(bigint[]) from public, anon, authenticated;
grant execute on function public.vino_denominacion_sincronizar(bigint[]) to service_role;

create or replace function public.trg_vino_producto_denominacion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    perform vino_denominacion_sincronizar(array[old.producto_id]);
  elsif tg_op = 'UPDATE' then
    perform vino_denominacion_sincronizar(array[old.producto_id, new.producto_id]);
  else
    perform vino_denominacion_sincronizar(array[new.producto_id]);
  end if;
  return null;
end;
$$;
revoke all on function public.trg_vino_producto_denominacion() from public, anon, authenticated;

create or replace function public.trg_vinos_denominacion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform vino_denominacion_sincronizar(array(select vp.producto_id from vino_producto vp where vp.vino_id = new.id));
  return null;
end;
$$;
revoke all on function public.trg_vinos_denominacion() from public, anon, authenticated;

drop trigger if exists trg_vino_producto_denominacion on public.vino_producto;
create trigger trg_vino_producto_denominacion
  after insert or update of producto_id, vino_id or delete on public.vino_producto
  for each row execute function public.trg_vino_producto_denominacion();

drop trigger if exists trg_vinos_denominacion on public."Vinos";
create trigger trg_vinos_denominacion
  after update of denominacion_origen, ubicacion_region, ubicacion_pais on public."Vinos"
  for each row execute function public.trg_vinos_denominacion();

select public.vino_denominacion_sincronizar(array(select distinct producto_id from public.vino_producto));

-- ─── volumen_comprado_agente ───
drop function if exists public.volumen_comprado_agente(text, text, date, date, text, text, integer, text);
CREATE OR REPLACE FUNCTION public.volumen_comprado_agente(p_texto text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_local text DEFAULT NULL::text, p_medida text DEFAULT NULL::text, p_limite integer DEFAULT NULL::integer, p_orden text DEFAULT NULL::text, p_denominacion text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_pais text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106400000_facturas_volumenes: «¿cuántos litros de cerveza?», «¿cuántos
-- barriles?», «kilos de gamba». Cuenta facturas + albaranes sin factura.
-- 20261113100000_chat_facturas_bebidas: formato con nombre, botellas y cajas por
-- producto, proveedor principal, p_limite (1-40) y p_orden ('envases' | litros).
-- 20261107100000_chat_facturas_asociacion: el texto se asocia (familia, producto,
-- formato pedido) y hay precio por litro/kilo (importe base ÷ litros de las
-- líneas convertidas) con mínimo y máximo por compra, por proveedor, producto,
-- formato, mes, proveedor×formato y productos de 2+ proveedores.
-- 20261124120000_chatbot_precio_unidad_compra: precio tal como se compra: precio_envase (€ por botella, tercio,
-- barril, paquete) y, en compra, el precio de cada formato facturado («380 caja de 24 a 41.85 €»).
-- 20261202100000_chat_vinos_denominacion: p_denominacion / p_region / p_pais filtran por la D.O., región y
-- país del producto del catálogo («vinos de Rioja», «Ribera», «champán francés», «vinos gallegos»), sin
-- mayúsculas ni tildes y con alias (vino_terminos). Sin categoría ni producto, la categoría es vino.
-- vino_sin_denominacion = líneas de vino del periodo cuyo producto no tiene D.O. conocida (no suman).
declare
  v_txt    text := nullif(btrim(coalesce(p_texto, '')), '');
  v_cattxt text := nullif(btrim(coalesce(p_categoria, '')), '');
  v_cat    bigint;
  v_catnom text;
  v_ids    bigint[];
  v_met    text;
  v_subs   text[];
  v_fmt    text;
  a        json;
  v_med    text := case lower(btrim(coalesce(p_medida, '')))
                     when 'l' then 'l' when 'litros' then 'l' when 'kg' then 'kg' when 'kilos' then 'kg' end;
  v_loc    text := case when p_local in ('casa_tomas', 'touza') then p_local end;
  v_lim    integer := least(greatest(coalesce(p_limite, 12), 1), 40);
  v_ord    text := case when lower(btrim(coalesce(p_orden, ''))) in ('envases', 'botellas', 'unidades') then 'envases' else 'total' end;
  r        json;
  v_terms  text[] := vino_terminos(concat_ws(' ', p_denominacion, p_region, p_pais));
  v_vinos  bigint;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango inválido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  -- Asociación: «cerveza» escrita como producto es la familia; «cerveza de
  -- barril» / «cruzcampo barril» llevan formato (se filtra por tipo de envase).
  if v_cattxt is not null then
    a := asociar_termino_agente(v_cattxt);
    v_fmt := a->>'formato';
  end if;
  if v_txt is not null then
    a := asociar_termino_agente(v_txt);
    v_fmt := coalesce(v_fmt, a->>'formato');
    if v_cattxt is null and a->>'tipo' = 'familia' then
      v_cattxt := a->>'categoria';
      v_txt := null;
    elsif a->>'tipo' = 'formato' then
      v_txt := null;
    elsif a->>'formato' is not null then
      v_txt := coalesce(a->>'texto', v_txt);
    end if;
  end if;
  -- Filtro de denominación sin categoría ni producto: los vinos.
  if v_terms is not null then
    v_vinos := categoria_agente('vino');
    if v_cattxt is null and v_txt is null then v_cattxt := 'vino'; end if;
  end if;
  -- Barril, tercio, lata, magnum… son envases de bebida: litros.
  if v_fmt is not null then v_med := coalesce(v_med, 'l'); end if;
  if v_cattxt is not null then
    v_cat := categoria_agente(v_cattxt);
    if v_cat is null then
      return json_build_object('error', format('No conozco la categoría «%s».', left(v_cattxt, 60)));
    end if;
    select nombre into v_catnom from categorias_producto where id = v_cat;
  end if;
  if v_txt is not null then
    select l.ids, l.metodo, l.subproductos into v_ids, v_met, v_subs from lineas_producto_agente(v_txt, null) l;
    if v_ids is null then
      return json_build_object('sin_datos', true, 'producto', v_txt, 'categoria', v_catnom,
                               'nota', 'Ninguna línea de compra coincide con ese producto.');
    end if;
  end if;
  if v_cat is null and v_ids is null then
    return json_build_object('error', 'Falta producto o categoria (cerveza, vino, agua, aceite, gamba…).');
  end if;

  with
  base_todo as materialized (
    select v.*, pc.envase_origen,
           (v_terms is null or vino_coincide(v_terms, pc.denominacion_origen, pc.region_vino, pc.pais_vino)) as vino_ok,
           (v_vinos is not null and pc.denominacion_origen is null
            and exists (select 1 from categorias_producto c where c.id = pc.categoria_id and (c.id = v_vinos or c.padre_id = v_vinos))) as vino_sin_do
      from volumen_lineas v
      left join productos_catalogo pc on pc.id = v.producto_id
     where (p_desde is null or v.fecha >= p_desde)
       and (p_hasta is null or v.fecha <= p_hasta)
       and (v_loc is null or v.loc = v_loc)
       and (v_cat is null or v.categoria_id = v_cat
            or exists (select 1 from categorias_producto c where c.id = v.categoria_id and c.padre_id = v_cat))
  ),
  base as materialized (select * from base_todo b where b.vino_ok),
  -- Vino del periodo sin D.O. conocida: no entra en el filtro; se avisa.
  sin_do as (
    select b.* from base_todo b
     where v_terms is not null and b.vino_sin_do and (v_ids is null or b.linea_id = any(v_ids))
  ),
  sel as materialized (
    select * from base b where v_ids is null or b.linea_id = any(v_ids)
  ),
  med as (
    select coalesce(v_med,
                    (select s.medida from sel s where s.medida is not null
                      group by s.medida order by count(*) desc, s.medida limit 1), 'l') as m
  ),
  -- Líneas convertidas con su envase: el del catálogo o, si no lo tiene, el que
  -- sale de la propia línea (litros / envases). pl = precio por litro/kilo de la línea.
  ok0 as materialized (
    select s.*, e.env_n, e.env_c, e.env_u,
           volumen_tipo_envase(e.env_c, e.env_u, s.categoria,
                               coalesce(s.producto, '') || ' ' || coalesce(s.nombre_linea, '') || ' ' || coalesce(s.unidad, '')) as tipo,
           case when s.cantidad <> 0 and e.env_n is not null and s.metodo in ('caja', 'precio')
                then round(e.env_n / s.cantidad) end as n_por,
           case when s.cantidad_base > 0 and s.importe > 0 then s.importe / s.cantidad_base end as pl,
           case when s.importe is not null then s.cantidad_base end as base_con_importe,
           case when s.importe > 0 and e.env_n > 0 then s.importe end as imp_env,
           case when s.importe > 0 and e.env_n > 0 then e.env_n end as env_con_importe
      from sel s
      cross join med
      cross join lateral (
        select coalesce(s.envases, case when s.metodo = 'envase' then s.cantidad end) as env_n,
               coalesce(s.envase_cantidad,
                        case when coalesce(s.envases, 0) > 0 then round(s.cantidad_base / s.envases, 3) end) as env_c,
               case when s.envase_cantidad is not null then s.envase_unidad
                    when coalesce(s.envases, 0) > 0 then s.medida end as env_u
      ) e
     where s.medida = med.m
  ),
  ok as materialized (
    select * from ok0 o
     where v_fmt is null
        or (v_fmt = 'botellin' and o.tipo ~ '^(tercio|quinto|botellín)')
        or (v_fmt <> 'botellin' and o.tipo like v_fmt || ' %')
  ),
  no as (select s.* from sel s where s.medida is null),
  pu as (
    select coalesce(o.producto, o.nombre_linea) as producto, coalesce(nullif(lower(o.unidad), ''), 'ud') as uni, o.n_por,
           sum(o.cantidad) as cant, sum(o.cantidad_base) as total, sum(o.env_n) as envases,
           max(o.env_c) as env_c, max(o.env_u) as env_u,
           sum(o.importe) filter (where o.importe > 0 and o.cantidad > 0) as imp,
           sum(o.cantidad) filter (where o.importe > 0 and o.cantidad > 0) as cant_imp
      from ok o group by 1, 2, 3
  ),
  por_prod as (
    select p.producto, round(sum(p.total), 2) as total, round(sum(p.envases)) as envases,
           volumen_formato(max(p.env_c), max(p.env_u)) as envase,
           string_agg(trim_scale(p.cant)::text || ' ' || p.uni
                      || case when p.n_por > 1 then ' de ' || trim_scale(p.n_por)::text else '' end
                      || coalesce(' a ' || trim_scale(round(p.imp / nullif(p.cant_imp, 0), 2))::text || ' €', ''),
                      ', ' order by p.total desc) filter (where p.cant <> 0) as compra
      from pu p group by 1
  ),
  pprecio as (
    select coalesce(o.producto, o.nombre_linea) as producto,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax,
           round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv
      from ok o group by 1
  ),
  ptipo as (
    select coalesce(o.producto, o.nombre_linea) as producto, string_agg(distinct o.tipo, ', ') as formato
      from ok o group by 1
  ),
  pprov as (
    select z.producto, z.proveedor, z.n
      from (select coalesce(o.producto, o.nombre_linea) as producto, max(o.proveedor_txt) as proveedor,
                   row_number() over (partition by coalesce(o.producto, o.nombre_linea)
                                      order by sum(o.cantidad_base) desc, max(o.proveedor_txt)) as rn,
                   count(*) over (partition by coalesce(o.producto, o.nombre_linea)) as n
              from ok o group by 1, o.prov_k) z
     where z.rn = 1
  ),
  prod_rk as (
    select pp.*, t.formato, pr.precio, pr.pmin, pr.pmax, pr.penv,
           pv.proveedor || case when pv.n > 1 then format(' (+%s)', pv.n - 1) else '' end as proveedor,
           row_number() over (order by case when v_ord = 'envases' then pp.envases else pp.total end desc nulls last,
                                       pp.total desc, pp.producto) as rk
      from por_prod pp
      left join ptipo t on t.producto = pp.producto
      left join pprov pv on pv.producto = pp.producto
      left join pprecio pr on pr.producto = pp.producto
  ),
  por_fmt as (
    select max(volumen_formato(o.env_c, o.env_u)) as envase, o.tipo as formato,
           round(sum(o.env_n)) as envases, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax,
           round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv
      from ok o where o.tipo is not null group by o.tipo
  ),
  por_prov as (
    select max(o.proveedor_txt) as proveedor, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.env_n)) as envases, count(distinct coalesce(o.producto, o.nombre_linea)) as productos,
           round(sum(o.importe), 2) as importe,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax
      from ok o group by o.prov_k
  ),
  prov_fmt as (
    select max(o.proveedor_txt) as proveedor, o.tipo as formato, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
           round(min(o.pl), 2) as pmin, round(max(o.pl), 2) as pmax,
           round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv
      from ok o where o.tipo is not null group by o.prov_k, o.tipo
  ),
  comp as (
    -- Productos comprados a 2+ proveedores: el precio de cada uno.
    -- Como mucho los 6 proveedores con más volumen de cada producto (n = todos).
    select x.producto, sum(x.total) as total, max(x.n) as n,
           json_agg(json_strip_nulls(json_build_object('proveedor', x.proveedor, 'precio', x.precio,
                                                      'precio_envase', x.penv, 'total', x.total))
                    order by x.precio nulls last) filter (where x.rv <= 6) as proveedores
      from (select coalesce(o.producto, o.nombre_linea) as producto, max(o.proveedor_txt) as proveedor,
                   round(sum(o.cantidad_base), 2) as total,
                   round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio,
                   round(sum(o.imp_env) / nullif(sum(o.env_con_importe), 0), 2) as penv,
                   count(*) over (partition by coalesce(o.producto, o.nombre_linea)) as n,
                   row_number() over (partition by coalesce(o.producto, o.nombre_linea)
                                      order by sum(o.cantidad_base) desc, max(o.proveedor_txt)) as rv
              from ok o group by 1, o.prov_k) x
     where x.n > 1
     group by x.producto
  ),
  incomp as (
    select to_char(i.mes, 'YYYY-MM') as mes from meses_compras_incompletos(v_loc) i
  ),
  por_mes as (
    select to_char(o.fecha, 'YYYY-MM') as mes, round(sum(o.cantidad_base), 2) as total,
           round(sum(o.importe), 2) as importe,
           round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) as precio
      from ok o group by 1
  ),
  otra as (
    select s.medida, round(sum(s.cantidad_base), 2) as total, count(*) as lineas
      from sel s, med where s.medida is not null and s.medida <> med.m group by s.medida
  )
  select json_build_object(
    'periodo', json_build_object('desde', coalesce(p_desde, (select min(fecha) from sel)), 'hasta', coalesce(p_hasta, (select max(fecha) from sel))),
    'categoria', v_catnom, 'producto', v_txt,
    'filtro_vino', case when v_terms is not null then json_build_object(
        'denominacion', p_denominacion, 'region', p_region, 'pais', p_pais, 'terminos', to_json(v_terms)) end,
    'vino_sin_denominacion', case when exists (select 1 from sin_do) then json_build_object(
        'lineas', (select count(*) from sin_do),
        'importe_base', (select round(sum(s.importe), 2) from sin_do s),
        'ejemplos', (select json_agg(z.p) from (select coalesce(s.producto, s.nombre_linea) as p from sin_do s
                       group by 1 order by sum(s.importe) desc nulls last, 1 limit 6) z),
        'nota', 'Lineas de vino del periodo cuyo producto no tiene denominacion conocida: no entran en el filtro.') end, 'coincidencia', v_met, 'formato_pedido', v_fmt, 'local', v_loc,
    'derivados_excluidos', to_jsonb(v_subs),
    'unidad', (select m from med),
    'total', (select round(coalesce(sum(o.cantidad_base), 0), 2) from ok o),
    'envases', (select round(sum(o.env_n)) from ok o),
    'cajas', (select round(sum(o.cantidad)) from ok o where o.n_por > 1),
    'importe_base', (select round(sum(o.importe), 2) from ok o),
    'precio', (select round(sum(o.importe) / nullif(sum(o.base_con_importe), 0), 2) from ok o),
    'precio_min', (select round(min(o.pl), 2) from ok o),
    'precio_max', (select round(max(o.pl), 2) from ok o),
    'proveedores', (select count(*) from por_prov),
    'lineas_convertidas', (select count(*) from ok),
    'lineas_sin_convertir', (select count(*) from no),
    'sin_datos', not exists (select 1 from sel),
    'envase_supuesto_lineas', (select nullif(count(*), 0) from ok o where o.envase_origen = 'por_defecto'),
    'orden', case v_ord when 'envases' then 'envases' else 'total' end,
    'por_producto', (select json_agg(json_strip_nulls(json_build_object(
                                       'producto', x.producto, 'total', x.total, 'envases', x.envases,
                                       'envase', x.envase, 'formato', x.formato, 'compra', x.compra,
                                       'proveedor', x.proveedor, 'precio', x.precio, 'precio_envase', x.penv,
                                       'precio_min', case when x.pmin <> x.pmax then x.pmin end,
                                       'precio_max', case when x.pmin <> x.pmax then x.pmax end))
                                      order by x.rk)
                       from prod_rk x where x.rk <= v_lim),
    'productos', (select count(*) from por_prod),
    'productos_truncado', (select count(*) > v_lim from por_prod),
    'por_envase', (select json_agg(json_build_object('formato', f.formato, 'envase', f.envase, 'envases', f.envases, 'total', f.total,
                                                     'precio', f.precio, 'precio_envase', f.penv, 'precio_min', f.pmin, 'precio_max', f.pmax)
                                   order by f.total desc)
                     from (select * from por_fmt order by total desc limit 10) f),
    'por_proveedor', (select json_agg(json_build_object('proveedor', p.proveedor, 'total', p.total, 'envases', p.envases,
                                                         'productos', p.productos, 'importe', p.importe, 'precio', p.precio,
                                                         'precio_min', p.pmin, 'precio_max', p.pmax) order by p.total desc)
                        from (select * from por_prov order by total desc limit 8) p),
    'por_proveedor_formato', (select json_agg(json_build_object('proveedor', q.proveedor, 'formato', q.formato, 'total', q.total,
                                                                 'precio', q.precio, 'precio_envase', q.penv, 'precio_min', q.pmin, 'precio_max', q.pmax)
                                              order by q.formato, q.precio)
                                from (select * from prov_fmt order by total desc limit 14) q
                               where (select count(*) from por_prov) > 1),
    'comparables', (select json_agg(json_build_object('producto', c.producto, 'n_proveedores', c.n, 'proveedores', c.proveedores) order by c.total desc)
                      from (select * from comp order by total desc limit 6) c),
    'por_mes', (select json_agg(json_strip_nulls(json_build_object(
                                  'mes', m.mes, 'total', m.total, 'importe', m.importe, 'precio', m.precio,
                                  'incompleto', case when exists (select 1 from incomp i where i.mes = m.mes) then true end))
                                order by m.mes) from por_mes m),
    'otra_unidad', (select json_agg(json_build_object('unidad', o.medida, 'total', o.total, 'lineas', o.lineas)) from otra o),
    'sin_convertir', case when exists (select 1 from no) then json_build_object(
        'importe_base', (select round(sum(n.importe), 2) from no n),
        'motivos', (select json_object_agg(z.metodo, z.n) from (select n.metodo, count(*) as n from no n group by 1) z),
        'ejemplos', (select json_agg(json_build_object('linea', z.nombre_linea, 'unidad', z.unidad, 'cantidad', z.cant,
                                                        'lineas', z.n, 'motivo', z.metodo))
                       from (select n.nombre_linea, n.unidad, n.metodo, trim_scale(sum(n.cantidad)) as cant, count(*) as n
                               from no n group by 1, 2, 3 order by count(*) desc, 1 limit 5) z)) end,
    'resto_categoria', case when v_cat is not null and v_ids is not null then
        (select json_build_object('total', round(sum(b.cantidad_base), 2), 'lineas', count(*))
           from base b, med where b.medida = med.m and not (b.linea_id = any(v_ids))) end,
    'nota', 'total = cantidad x lo que lleva cada unidad facturada (caja 24 x 33 cl = 7,92 l; barril 50 l). '
            || 'envases = botellas, latas o barriles con las cajas ya abiertas (caja de 6 = 6). '
            || 'compra = como se facturo («99 caja de 6» = 99 cajas de 6 botellas). formato = tipo de envase. '
            || 'precio = € por litro/kilo SIN IVA (importe base / litros de las lineas convertidas); precio_min/max = la compra mas barata/cara. '
            || 'precio_envase = € por envase (botella, tercio, barril, paquete) SIN IVA y compra = precio de cada formato facturado, '
            || 'ambos de las lineas con importe (lo regalado no baja el precio). '
            || 'Sin convertir = no se sabe cuanto lleva: no suma. Sin Servicios (envases retornables).'
  ) into r;
  return r;
end;
$function$
;

revoke all on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text, text, text, text) from public, anon;
grant execute on function public.volumen_comprado_agente(text, text, date, date, text, text, integer, text, text, text, text) to authenticated, service_role;

-- ─── gasto_categorias_agente ───
drop function if exists public.gasto_categorias_agente(text, date, date, text, text);
CREATE OR REPLACE FUNCTION public.gasto_categorias_agente(p_categoria text DEFAULT NULL::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_agrupar text DEFAULT NULL::text, p_denominacion text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_pais text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
-- 20261106140000_chatbot_gasto_como_el_panel: importe de línea = solo pf.total (cuadra con Productos y Análisis).
-- 20261202100000_chat_vinos_denominacion: p_denominacion / p_region / p_pais filtran por la D.O., región y
-- país del producto («vinos de Rioja» ya no busca «Rioja» en el nombre). Sin categoría = vinos.
-- vino_sin_denominacion: líneas de vino del periodo sin D.O. conocida (no entran en la cifra).
declare
  c_top        constant int := 8;
  c_max_cruce  constant int := 60;
  v_tipo   text;
  v_agr    text;
  v_cat    categorias_producto%rowtype;
  v_madre  text;
  resultado jsonb;
  v_terms  text[] := vino_terminos(concat_ws(' ', p_denominacion, p_region, p_pais));
  v_vinos  bigint;
  v_cattxt text := nullif(trim(coalesce(p_categoria, '')), '');
begin
  if v_terms is not null then
    v_vinos := categoria_agente('vino');
    v_cattxt := coalesce(v_cattxt, 'vino');
  end if;
  -- ── Argumentos ──
  v_tipo := case
    when nullif(trim(coalesce(p_tipo, '')), '') is null or lower(trim(p_tipo)) in ('ambos', 'todos', 'todo') then null
    when lower(trim(p_tipo)) like 'factura%' then 'factura'
    when lower(trim(p_tipo)) like 'albar%' then 'albaran'
    else '?' end;
  if v_tipo = '?' then
    return json_build_object('error', 'tipo debe ser factura, albaran o null (ambos).');
  end if;
  v_agr := case
    when nullif(trim(coalesce(p_agrupar, '')), '') is null then null
    when lower(trim(p_agrupar)) like 'mes%' then 'mes'
    when lower(trim(p_agrupar)) like 'proveedor%' then 'proveedor'
    else '?' end;
  if v_agr = '?' then
    return json_build_object('error', 'agrupar debe ser mes, proveedor o null.');
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('error', format('Rango invalido: desde (%s) es posterior a hasta (%s).', p_desde, p_hasta));
  end if;
  if v_cattxt is not null then
    select * into v_cat from categorias_producto where id = categoria_agente(v_cattxt);
    if v_cat.id is null then
      return json_build_object(
        'error', format('No hay ninguna categoria "%s".', v_cattxt),
        'categorias', (select json_agg(c.nombre || coalesce(' (' || (
                          select string_agg(s.nombre, ', ' order by s.orden, s.nombre)
                            from categorias_producto s where s.padre_id = c.id and s.activa) || ')', '')
                          order by c.orden, c.nombre)
                         from categorias_producto c where c.padre_id is null and c.activa));
    end if;
    select nombre into v_madre from categorias_producto where id = v_cat.padre_id;
  end if;

  with base as (
    select pf.id, pf.producto_id,
           coalesce(pf.nombre_normalizado::text, lower(pf.nombre)) as nom_n,
           pf.cantidad::numeric as cant,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.total::numeric as imp,   -- solo el importe leído (como Productos y el tablero)
           f.id as doc, f.tipo::text as tipo, f.fecha, coalesce(pv.nombre, f.proveedor)::text as proveedor,
           coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(normalizar_proveedor(f.proveedor), ''), '?') as prov_n,
           p.nombre as producto,
           c.id as cat_id,
           coalesce(m.id, c.id) as madre_id,
           coalesce(m.nombre, c.nombre) as madre,
           c.nombre as cat,
           coalesce(m.orden, c.orden) as orden,
           (f.tipo = 'albaran' and f.id in (select albaran_id from albaranes_facturados_agente())) as fact,
           (v_terms is null or vino_coincide(v_terms, p.denominacion_origen, p.region_vino, p.pais_vino)) as vino_ok,
           (v_vinos is not null and p.id is not null and p.denominacion_origen is null
            and (c.id = v_vinos or c.padre_id = v_vinos)) as vino_sin_do
      from productos_factura pf
      join facturas f on f.id = pf.factura_id
      left join proveedores pv         on pv.id = f.proveedor_id
      left join productos_catalogo p   on p.id = pf.producto_id
      left join categorias_producto c  on c.id = p.categoria_id
      left join categorias_producto m  on m.id = c.padre_id
     where (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
       and (v_tipo is null or f.tipo = v_tipo)
  ),
  -- Albarán ya facturado (vínculo o factura que cita su número): fuera, salvo que se pidan solo albaranes.
  ya_facturados as (select id from base where fact and v_tipo is null),
  todo as (select * from base where not fact or v_tipo = 'albaran'),
  -- Lo que se pregunta: la categoría (con sus subcategorías) o todo.
  l as (
    select * from todo
     where (v_cat.id is null or cat_id = v_cat.id or madre_id = v_cat.id) and vino_ok
  ),
  -- Vino del periodo sin D.O. conocida: no entra en la cifra filtrada; se avisa.
  sin_do as (
    select * from todo
     where v_terms is not null and vino_sin_do and (v_cat.id is null or cat_id = v_cat.id or madre_id = v_cat.id)
  ),
  -- Fila de reparto: categoría madre y subcategoría (o sin clasificar / sin categoría).
  g as (
    select case when producto_id is null then 'Sin clasificar'
                when cat_id is null then 'Sin categoria'
                else madre end as grupo,
           case when cat_id is not null and cat_id <> madre_id then cat end as sub,
           orden, imp, id, doc,
           -- Clave del cruce y su etiqueta (el proveedor, agrupado por su nombre normalizado).
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else prov_n end as k,
           case when v_agr = 'mes' then to_char(fecha, 'YYYY-MM') else proveedor end as etq
      from l
  ),
  marco as (
    select count(*) as lineas, count(distinct doc) as docs, count(distinct producto_id) as productos,
           sum(imp) as imp,
           sum(imp) filter (where tipo = 'factura') as imp_fac,
           sum(imp) filter (where tipo = 'albaran') as imp_alb,
           count(*) filter (where imp is null) as sin_importe,
           count(*) filter (where tipo = 'albaran') as lin_alb
      from l
  ),
  total_periodo as (select sum(imp) as imp from todo),
  sin_clas as (
    select count(*) as lineas, sum(imp) as imp from todo where producto_id is null
  ),
  reparto as (
    select grupo, min(orden) as orden, sum(imp) as imp, count(*) as lineas,
           (select jsonb_agg(jsonb_build_object('categoria', s.sub, 'importe', trim_scale(round(s.imp, 2)), 'lineas', s.lineas)
                             order by s.imp desc nulls last, s.sub)
              from (select g2.sub, sum(g2.imp) as imp, count(*) as lineas
                      from g g2 where g2.grupo = g.grupo and g2.sub is not null group by g2.sub) s) as subs
      from g group by grupo
  ),
  top as (
    select producto, sum(imp) as imp,
           (select jsonb_object_agg(u.unidad, trim_scale(round(u.cant, 3)))
              from (select l2.unidad, sum(l2.cant) as cant from l l2 where l2.producto = l.producto group by l2.unidad) u) as cant,
           count(*) over () as n
      from l where producto is not null
     group by producto
  ),
  cruce as (
    select case when v_cat.id is null then grupo end as grupo,
           (array_agg(etq order by etq))[1] as clave,
           sum(imp) as imp, count(*) as lineas
      from g
     where v_agr is not null
     group by 1, k
  ),
  cruce_n as (
    select c.*, row_number() over (
             order by case when v_agr = 'mes' then c.clave end,
                      c.imp desc nulls last, c.grupo, c.clave) as rn,
           count(*) over () as n
      from cruce c
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'categoria', case when v_cat.id is not null then v_cat.nombre end,
    'madre',     v_madre,
    'filtro_vino', case when v_terms is not null then jsonb_build_object(
        'denominacion', p_denominacion, 'region', p_region, 'pais', p_pais, 'terminos', to_jsonb(v_terms)) end,
    'vino_sin_denominacion', (select case when count(*) > 0 then jsonb_build_object(
        'lineas', count(*), 'importe', trim_scale(round(sum(s.imp), 2)),
        'ejemplos', (select jsonb_agg(z.producto) from (select s2.producto from sin_do s2 group by 1
                       order by sum(s2.imp) desc nulls last, 1 limit 6) z),
        'nota', 'Lineas de vino del periodo cuyo producto no tiene denominacion conocida: no entran en la cifra.') end
        from sin_do s),
    'periodo',   case when p_desde is not null or p_hasta is not null
                      then jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
                      else to_jsonb('todo el historico'::text) end,
    'tipo',      v_tipo,
    'total', (select case when m.lineas > 0 then jsonb_strip_nulls(jsonb_build_object(
                'importe',      trim_scale(round(m.imp, 2)),
                'en_facturas',  case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_fac, 0), 2)) end,
                'en_albaranes_sin_factura', case when m.lin_alb > 0 then trim_scale(round(coalesce(m.imp_alb, 0), 2)) end,
                'lineas',       m.lineas,
                'documentos',   m.docs,
                'productos',    case when v_cat.id is not null then m.productos end,
                'pct_del_gasto', case when v_cat.id is not null and tp.imp > 0 then round(100 * m.imp / tp.imp, 1) end)) end
                from marco m cross join total_periodo tp),
    -- Sin categoría: madres con sus subcategorías. Con una madre: sus subcategorías.
    'categorias', case when v_cat.id is null then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', r.grupo,
                 'importe',   trim_scale(round(r.imp, 2)),
                 'pct',       case when tp.imp > 0 then round(100 * r.imp / tp.imp, 1) end,
                 'lineas',    r.lineas,
                 'sub',       r.subs))
               order by r.imp desc nulls last, r.orden, r.grupo)
          from reparto r cross join total_periodo tp
         where r.grupo not in ('Sin clasificar', 'Sin categoria')) end,
    'subcategorias', case when v_cat.id is not null and v_cat.padre_id is null then (
        select r.subs from reparto r limit 1) end,
    'sin_categoria', case when v_cat.id is null then (
        select jsonb_build_object('importe', trim_scale(round(r.imp, 2)), 'lineas', r.lineas)
          from reparto r where r.grupo = 'Sin categoria') end,
    'top_productos', case when v_cat.id is not null then (
        select jsonb_agg(jsonb_build_object('producto', t.producto, 'importe', trim_scale(round(t.imp, 2)), 'cantidad', t.cant)
                         order by t.imp desc nulls last, t.producto)
          from (select * from top order by imp desc nulls last, producto limit c_top) t) end,
    'productos_total', case when v_cat.id is not null then (select case when max(n) > c_top then max(n) end from top) end,
    'cruce', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'categoria', c.grupo,
                 v_agr,        c.clave,
                 'importe',   trim_scale(round(c.imp, 2)),
                 'lineas',    c.lineas))
               order by c.rn)
          from cruce_n c where c.rn <= c_max_cruce),
    'cruce_truncado', (select case when max(n) > c_max_cruce then true end from cruce_n),
    'sin_clasificar', (select case when s.lineas > 0 then jsonb_build_object(
                         'lineas', s.lineas, 'importe', trim_scale(round(s.imp, 2))) end from sin_clas s),
    'criterio', (select case when m.lin_alb > 0 or exists (select 1 from ya_facturados) then
        'Facturas + albaranes sin factura (lo recibido); el albaran ya facturado no cuenta.' end
        from marco m),
    'avisos', (select nullif(jsonb_strip_nulls(jsonb_build_object(
                 'sin_importe',             nullif(m.sin_importe, 0),
                 'albaranes_ya_facturados', nullif((select count(*) from ya_facturados), 0))), '{}'::jsonb)
                 from marco m),
    'nota', 'Importes de linea: base SIN IVA.',
    'sin_datos', (select case when m.lineas = 0 then true end from marco m),
    'ultima_compra', case when v_cat.id is not null and (select lineas from marco) = 0 then (
        select max(f.fecha)
          from productos_factura pf
          join facturas f on f.id = pf.factura_id
          join productos_catalogo p on p.id = pf.producto_id
          join categorias_producto c on c.id = p.categoria_id
         where (c.id = v_cat.id or c.padre_id = v_cat.id)
           and (v_terms is null or vino_coincide(v_terms, p.denominacion_origen, p.region_vino, p.pais_vino))) end
  )) into resultado;

  return resultado::json;
end;
$function$
;

revoke all on function public.gasto_categorias_agente(text, date, date, text, text, text, text, text) from public, anon;
grant execute on function public.gasto_categorias_agente(text, date, date, text, text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
