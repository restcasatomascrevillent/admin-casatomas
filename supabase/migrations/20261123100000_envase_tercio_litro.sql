-- 20261123100000_envase_tercio_litro
-- Antes: envase_texto('Heineken 1/3 L caja 24') leía «3 l» (el 3 del tercio con
--        la L detrás), así que cada botellín contaba como 3 litros y el chatbot
--        multiplicaba por 9 los litros de cerveza (79.459 l en vez de ~20.500). Salió al renombrar
--        el catálogo en la unificación del 09/11 («Heineken 1/3 L caja 24»).
-- Ahora: «1/3 L» = 0,33 l y «1/5 L» = 0,2 l, igual que ya pasaba con 1/2, 1/4 y
--        3/4. Se recalcula el envase de los productos con esos textos en el nombre.
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
$function$

;

select public.productos_envase_recalcular(array_agg(id))
  from public.productos_catalogo
 where nombre ~* '\m1\s*/\s*[35]\s*(l|lts?|litros?)\y';
