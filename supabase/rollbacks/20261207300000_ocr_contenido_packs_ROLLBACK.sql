set client_encoding = 'UTF8';
-- Vuelta atrás de 20261207300000_ocr_contenido_packs: repone extraer_contenido y
-- trg_productos_factura_rellenar_contenido de 20261010160000 y envase_texto de
-- 20261123100000, y quita contenido_linea, leer_formato_linea y contenido_medida.
-- No toca el contenido ya guardado en las líneas (lo leído con la versión nueva
-- se queda hasta que la línea se vuelva a editar).
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.extraer_contenido(p_texto text)
 RETURNS TABLE(cantidad numeric, unidad text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- 20261008140000_productos_contenido_unidad: contenido de un envase leído del
-- texto de la línea, SIN IA (solo regex). Devuelve (cantidad, unidad) con
-- unidad kg, l o ud ya convertida (750 ml → 0,75 l; 500 g → 0,5 kg), o nada si
-- no hay o es ambiguo (rangos «5-6 kg», varias cifras distintas, «1.000 g»).
-- Orden: 1) multiplicado «24x33cl»; 2) con marcador de envase «caja 10 kg»,
-- «C/2K», «B/5 K», «cubo 5 L», «Tarro/400g», «Pzas. 3 K»; 3) rango → nada;
-- 4) una única cifra con unidad suelta («5KG», «2 L», «70 CL.», «45U»).
-- 20261010160000_ocr_calidad_extraccion: «1/2 KG» = 0,5 kg; «+15 GRS» y
-- «calibre 20» son calibres, no contenido; «5L c/3u» = 5 l (las 3 u son las
-- piezas de la caja, no el contenido de cada una).
declare
  c_num  constant text := '(\d{1,4}(?:[.,]\d{1,3})?)';
  c_uni  constant text := '(kilogramos?|kilos?|kgs?|gramos?|grs?|g|litros?|lts?|ltos?|lt|l|cl|ml|uds?|unidades?|unid|botellas?|latas?|botes?|tarros?|bolsas?|paquetes?|piezas?|pzas?|sobres?|u|k)';
  c_peso constant text := '(kilogramos?|kilos?|kgs?|gramos?|grs?|g|litros?|lts?|ltos?|lt|l|cl|ml|k)';
  c_marc constant text := '(?:\m[cbt]\s*\.?\s*/\s*(?:c\s*)?|\m(?:caja|cubo|bote|tarro|saco|bolsa|lata|paquete|pack|pzas?|pieza|botella|malla|bandeja|barqueta|garrafa|bidon)\s*\.?\s*(?:/|de)?\s*)';
  t      text := lower(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  m      text[];
  v_txt  text;
  v_u    text;
  v_mult numeric := 1;
  v_cnt  int;
  v_qty  numeric;
begin
  if t = '' then
    return;
  end if;
  t := regexp_replace(t, '\m1\s*/\s*2\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,5 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,25 ', 'g');
  t := regexp_replace(t, '\m3\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,75 ', 'g');
  t := regexp_replace(t, '[+]\s*\d{1,4}(?:[.,]\d{1,3})?\s*(?:grs?|gramos?|g|kgs?|k)\y', ' ', 'g');
  t := regexp_replace(t, '\mcal(?:ibre)?\.?\s*\d+(?:\s*/\s*\d+)?', ' ', 'g');

  m := regexp_match(t, '\m(\d{1,3})\s*[x×]\s*' || c_num || '\s*(cl|ml|lts?|litros?|l|grs?|gramos?|g|kgs?|kilos?)\y');
  if m is not null then                                  -- 1) «24x33cl»
    v_mult := m[1]::numeric; v_txt := m[2]; v_u := m[3];
  else
    if t ~ '\mc\s*/\s*\d{1,3}\s*(?:u|uds?|unidades?|unid)\y' then
      -- «5L c/3u»: 3 piezas de 5 l → si hay UNA cifra de peso/volumen, manda.
      select count(distinct x.g[1] || x.g[2]), min(x.g[1]), min(x.g[2])
        into v_cnt, v_txt, v_u
        from regexp_matches(t, '\m' || c_num || '\s*' || c_peso || '\y', 'g') as x(g);
      if coalesce(v_cnt, 0) <> 1 then
        v_txt := null;
        v_u := null;
      end if;
    end if;
    m := case when v_txt is null then regexp_match(t, c_marc || c_num || '\s*' || c_uni || '\y') end;
    if v_txt is not null then
      null;                                              -- ya resuelto («5L c/3u»)
    elsif m is not null then                             -- 2) con marcador de envase
      v_txt := m[1]; v_u := m[2];
    else
      if t ~ ('\d\s*(?:-|–|\ma\M)\s*' || c_num || '\s*' || c_uni || '\y') then
        return;                                          -- 3) rango: ambiguo
      end if;
      select count(distinct x.q || x.k), min(x.txt), min(x.u)   -- 4) cifra única con unidad
        into v_cnt, v_txt, v_u
        from (
          select g[1] as txt, g[2] as u,
                 replace(g[1], ',', '.')::numeric
                   * case when g[2] = 'ml' then 0.001 when g[2] = 'cl' then 0.01
                          when g[2] ~ '^(g|grs?|gramos?)$' then 0.001 else 1 end as q,
                 case when g[2] ~ '^(kgs?|k|kilos?|kilogramos?|g|grs?|gramos?)$' then 'kg'
                      when g[2] ~ '^(l|lts?|ltos?|lt|litros?|cl|ml)$' then 'l'
                      else 'ud' end as k
            from regexp_matches(t, '\m' || c_num || '\s*' || c_uni || '\y', 'g') as r(g)
        ) x;
      if coalesce(v_cnt, 0) <> 1 then
        return;
      end if;
    end if;
  end if;

  if v_txt ~ '^\d+\.\d{3}$' then
    return;                                              -- «1.000 g»: miles o decimales, ambiguo
  end if;
  v_qty := replace(v_txt, ',', '.')::numeric * v_mult
           * case when v_u = 'ml' then 0.001 when v_u = 'cl' then 0.01
                  when v_u ~ '^(g|grs?|gramos?)$' then 0.001 else 1 end;
  if v_qty > 0 and v_qty <= 1000 then
    cantidad := round(v_qty, 4);
    unidad := case when v_u ~ '^(kgs?|k|kilos?|kilogramos?|g|grs?|gramos?)$' then 'kg'
                   when v_u ~ '^(l|lts?|ltos?|lt|litros?|cl|ml)$' then 'l'
                   else 'ud' end;
    return next;
  end if;
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_productos_factura_rellenar_contenido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- 20261008140000_productos_contenido_unidad: rellena contenido_* leyendo el
-- nombre (y, si no, la unidad) de la línea. Lo puesto a mano no se pisa; un
-- valor escrito a propósito (alta con contenido, o cambio de contenido sin
-- tocar el origen) pasa a ser 'manual'.
-- 20261010160000_ocr_calidad_extraccion: un contenido en UNIDADES («C/15UD»,
-- «C/12U») no es contenido si la línea ya cuenta unidades y la cantidad es
-- múltiplo de él (15, 30…): el precio ya es por unidad.
declare
  v_c numeric;
  v_u text;
begin
  if tg_op = 'INSERT' then
    if new.contenido_cantidad is not null and new.contenido_origen is null then
      new.contenido_origen := 'manual';
    end if;
  elsif new.contenido_cantidad is not null
        and (new.contenido_cantidad, new.contenido_unidad) is distinct from (old.contenido_cantidad, old.contenido_unidad)
        and new.contenido_origen is not distinct from old.contenido_origen then
    new.contenido_origen := 'manual';
  end if;
  if new.contenido_origen = 'manual' and new.contenido_cantidad is not null then
    return new;
  end if;

  select e.cantidad, e.unidad into v_c, v_u from extraer_contenido(new.nombre::text) e;
  if v_c is null then
    select e.cantidad, e.unidad into v_c, v_u from extraer_contenido(new.unidad::text) e;
  end if;
  if v_u = 'ud' and v_c >= 1 and new.cantidad > 0
     and coalesce(lower(btrim(new.unidad::text)), '') ~ '^(|u|ud|uds|unidad|unidades|unid)$'
     and mod(new.cantidad, v_c) = 0 then
    v_c := null;
    v_u := null;
  end if;
  new.contenido_cantidad := v_c;
  new.contenido_unidad := v_u;
  new.contenido_origen := case when v_c is not null then 'texto' end;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.envase_texto(p_texto text)
 RETURNS TABLE(volumen numeric, unidad text, unidades numeric)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- 20261106400000_facturas_volumenes; 20261123100000_envase_tercio_litro: 1/3 y 1/5 de litro.
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
  t := regexp_replace(t, '\m1\s*/\s*3\s*(?=(l|lts?|litros?)\y)', '0,33 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*5\s*(?=(l|lts?|litros?)\y)', '0,2 ', 'g');
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
$function$;

drop function if exists public.contenido_linea(text, text, numeric);
drop function if exists public.leer_formato_linea(text);
drop function if exists public.contenido_medida(text, text);

select public.productos_envase_recalcular(array_agg(distinct x.id))
  from (
    select pc.id from public.productos_catalogo pc
     where pc.nombre ~* '(\m[2-9]\d{2,3}\s*cl\M)|(\d[''´`’]\d)|(\d\s*\*\s*\d)|(\mc\s*[./]?\s*x\s*\d)'
    union
    select pf.producto_id from public.productos_factura pf
     where pf.producto_id is not null
       and pf.nombre ~* '(\m[2-9]\d{2,3}\s*cl\M)|(\d[''´`’]\d)|(\d\s*\*\s*\d)|(\mc\s*[./]?\s*x\s*\d)'
  ) x;

commit;

select 'ocr_contenido_packs: deshecha' as resultado;
