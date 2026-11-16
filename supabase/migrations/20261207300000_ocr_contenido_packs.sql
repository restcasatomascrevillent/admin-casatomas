set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261207300000_ocr_contenido_packs
-- ===========================================================================
-- Causa raíz de los «packs guardados como una unidad» (calidad del dato del
-- 16/11/2026: 1.068 líneas corregidas a mano en producción el 17/11).
--
-- Antes: extraer_contenido solo multiplicaba la forma «24x33cl». Una caja
--        «COCA COLA 237 CL. * 24» se guardaba con 2,37 l (237 cl leídos como
--        centilitros y sin el × 24), «LANJARON 0'50 L. * 20» con 50 l,
--        «SCHWEPPES 200ml*28» con 0,2 l, «C/6B LP LA CUVEE 0,75L» con 0,75 l,
--        «F/5G 2500 neto» con 5 g, y «HEINEKEN 1/3 LONG NET * 24» o «leche
--        1 L contiene 6 unidades» sin contenido. El €/l salía ×10 o ×24.
-- Ahora: el contenido de la línea sale de contenido_linea(nombre, unidad,
--        cantidad), que entiende:
--          · «NNN CL» con NNN ≥ 200 = mililitros; «0'50 L» = 0,5 l; «1/3 L»;
--          · «2500 neto» y «(total 800 g)» = el contenido ya hecho;
--          · «contiene N unidades» = N × envase (siempre: es el pack de Makro);
--          · «24x33cl», «24*275 ML», «6 ud. x 1 L» = N × envase (como siempre);
--            «200GX4» = N × envase si se factura por caja o pack;
--          · «33cl * 24», «1/3 * 24», «C6», «C12», «C/6B», «C.x06», «P6»,
--            «CAJA 04 BT», «bandeja 24», «(C/ 120 U)», «24 UNID» = N × envase
--            SOLO si la línea se factura por caja, pack, bandeja, bulto…;
--            facturada por botella o unidad queda con UN envase (Gambín «70CL
--            C6»: el precio es por botella);
--          · unidad «pack de 6» = 6 × envase.
--        Conservador: una caja con un envase de menos de 1 l o 1 kg (o un
--        pack de bebida de menos de 2 l) y SIN unidades escritas se queda sin
--        contenido (antes se guardaba el de una botella): no se inventa, y
--        procesar-factura deja el aviso «caja_sin_unidades». Tampoco se
--        rellena lo ambiguo: «380grsx9» facturado por «ud», «500g (C/ 15u)»
--        en caja, «12 unidades 1L» facturado por brik.
--        envase_texto (litros y kilos comprados) lee igual «237 CL», «0'50 L»,
--        «24*275 ML» y «C.x06».
--
-- NO vuelve a leer las líneas que ya existen (el trigger solo salta al
-- insertar o al cambiar nombre, unidad o contenido). El relleno de lo antiguo
-- va aparte y a mano: facturas-conocimiento/calidad-dato-2026-11-16/
-- relleno_contenido.sql.
--
-- Test: supabase/tests/ocr_contenido_packs_test.sql y
--       scripts/test-ocr-contenido-packs.mjs (PGlite).
-- Deshacer: supabase/rollbacks/20261207300000_ocr_contenido_packs_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.extraer_contenido(text)') is null
     or to_regprocedure('public.trg_productos_factura_rellenar_contenido()') is null
     or to_regprocedure('public.envase_texto(text)') is null
     or to_regprocedure('public.productos_envase_recalcular(bigint[])') is null then
    raise exception 'ocr_contenido_packs: faltan 20261010160000_ocr_calidad_extraccion o 20261106400000_facturas_volumenes. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Una cifra con su unidad → kg o l ────────────────────────────────────
create or replace function public.contenido_medida(p_num text, p_uni text)
 returns table(q numeric, k text)
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
-- 20261207300000_ocr_contenido_packs: «750» + «ml» → 0,75 l; «500» + «g» →
-- 0,5 kg. «237 CL», «300 CL», «1250 CL» (200 o más, sin decimales) son
-- MILILITROS mal rotulados: nadie vende 2,37 l en botellín (100 y 150 cl sí
-- existen: litro y mágnum). «1.000 g» es ambiguo (miles o decimales) → nada.
declare
  u text := lower(coalesce(p_uni, ''));
  n numeric;
begin
  if p_num is null or p_num ~ '^\d+\.\d{3}$' or p_num !~ '^\d+(?:[.,]\d+)?$' then
    return;
  end if;
  n := replace(p_num, ',', '.')::numeric;
  if u ~ '^(kgs?|k|kilos?|kilogramos?)$' then
    q := n; k := 'kg';
  elsif u ~ '^(g|grs?|gramos?)$' then
    q := n * 0.001; k := 'kg';
  elsif u ~ '^(l|lts?|ltos?|ltrs?|lt|litros?)$' then
    q := n; k := 'l';
  elsif u = 'ml' then
    q := n * 0.001; k := 'l';
  elsif u = 'cl' then
    q := n * case when n >= 200 and p_num ~ '^\d+$' then 0.001 else 0.01 end; k := 'l';
  else
    return;
  end if;
  if q > 0 and q <= 1000 then
    q := round(q, 4);
    return next;
  end if;
  return;
end;
$function$;

-- ─── 2. Formato escrito en el texto de una línea ────────────────────────────
create or replace function public.leer_formato_linea(p_texto text)
 returns table(envase numeric, unidad text, unidades numeric, forma text)
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
-- 20261207300000_ocr_contenido_packs: qué dice el texto, SIN decidir todavía
-- si se multiplica (eso depende de la unidad facturada: contenido_linea).
--   forma 'total'    envase = contenido completo («2500 neto», «(total 800 g)»)
--         'contiene' «contiene N unidades»: N × envase, siempre
--         'nxm'      «24x33cl», «24*275 ML», «6 ud. x 1 L»
--         'mxn'      «200GX4», «380grsx9» (envase × unidades, pegado)
--         'estrella' «33cl * 24», «1/3 * 24» (reparto de bebidas)
--         'caja_n'   «C6», «C/6B», «C.x06», «P6», «CAJA 04 BT», «(C/ 120 U)»
--         'caja_n_debil' «24 UNID», «24U» sueltos junto a un envase de bebida
--         'marcador' «caja 10 kg», «C/2K», «bote 5 kg» (lo de siempre)
--         'suelta'   una única cifra con unidad («70 CL», «45U») (lo de siempre)
-- unidad: kg, l o ud. Sin fila = no hay contenido o es ambiguo.
declare
  c_num  constant text := '(\d{1,4}(?:[.,]\d{1,3})?)';
  c_uni  constant text := '(kilogramos?|kilos?|kgs?|gramos?|grs?|g|litros?|lts?|ltos?|lt|l|cl|ml|uds?|unidades?|unid|botellas?|latas?|botes?|tarros?|bolsas?|paquetes?|piezas?|pzas?|sobres?|u|k)';
  c_peso constant text := '(kilogramos?|kilos?|kgs?|gramos?|grs?|g|litros?|lts?|ltos?|lt|l|cl|ml|k)';
  c_cont constant text := '\mcontiene\s+(\d{1,3})\s*(?:unidades|unidad|unid|uds?|u|paquetes?|botellas?|latas?|bri[c]?ks?|bolsas?|sobres?|piezas?|tarrinas?|envases?|porciones|raciones)?\M';
  c_marc constant text := '(?:\m[cbt]\s*\.?\s*/\s*(?:c\s*)?|\m(?:caja|cubo|bote|tarro|saco|bolsa|lata|paquete|pack|pzas?|pieza|botella|malla|bandeja|barqueta|garrafa|bidon)\s*\.?\s*(?:/|de)?\s*)';
  t      text := lower(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  m      text[];
  r      record;
  v_part text[];
  v_txt  text;
  v_u    text;
  v_cnt  int;
  v_q    numeric;
  v_k    text;
  v_n    numeric;
  v_p    numeric;
  v_fuerte boolean := false;   -- las unidades vienen con «c/», «caja», «x6b»
begin
  if t = '' then
    return;
  end if;
  t := regexp_replace(t, '(\d)[''´`’](\d)', '\1,\2', 'g');             -- «0'50 L»
  t := regexp_replace(t, '\m1\s*/\s*2\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,5 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*3\s*(?=(l|lts?|litros?)\y)', '0,33 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*5\s*(?=(l|lts?|litros?)\y)', '0,2 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,25 ', 'g');
  t := regexp_replace(t, '\m3\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,75 ', 'g');
  t := regexp_replace(t, '[+]\s*\d{1,4}(?:[.,]\d{1,3})?\s*(?:grs?|gramos?|g|kgs?|k)\y', ' ', 'g');
  t := regexp_replace(t, '\mcal(?:ibre)?\.?\s*\d+(?:\s*/\s*\d+)?', ' ', 'g');

  -- a) Peso neto: «F/5G 2500 neto», «3000 neto», «neto 2,5 kg».
  m := regexp_match(t, '\m' || c_num || '\s*(kgs?|k|kilos?|grs?|gramos?|g)?\s*\.?\s*netos?\M');
  if m is not null then
    if m[2] is not null then
      select x.q, x.k into v_q, v_k from contenido_medida(m[1], m[2]) x;
    elsif m[1] ~ '^\d{2,4}$' and m[1]::numeric >= 50 then
      v_q := round(m[1]::numeric / 1000, 4); v_k := 'kg';          -- gramos
    end if;
  else
    m := regexp_match(t, '\mnetos?\s*:?\s*' || c_num || '\s*(kgs?|k|kilos?|grs?|gramos?|g)\y');
    if m is not null then
      select x.q, x.k into v_q, v_k from contenido_medida(m[1], m[2]) x;
    end if;
  end if;
  if v_q is not null then
    return query select v_q, v_k, null::numeric, 'total'::text;
    return;
  end if;

  -- b) «(total 800 g)», «(Total 1,2 kg)»: el resultado ya hecho.
  m := regexp_match(t, '\mtotal\s*:?\s*' || c_num || '\s*' || c_peso || '\y');
  if m is not null then
    select x.q, x.k into v_q, v_k from contenido_medida(m[1], m[2]) x;
    if v_q is not null then
      return query select v_q, v_k, null::numeric, 'total'::text;
      return;
    end if;
  end if;

  -- c) «contiene 24 unidades»: N × el envase que diga el resto del texto.
  m := regexp_match(t, c_cont);
  if m is not null and m[1]::numeric between 1 and 500 then
    v_n := m[1]::numeric;
    v_part := regexp_split_to_array(t, c_cont);
    -- La cifra escrita DESPUÉS («contiene 20 unidades (1260 g aprox)») es el total.
    select * into r from leer_formato_linea(v_part[2]);
    if r.unidad in ('l', 'kg') and r.forma = 'suelta' then
      return query select r.envase, r.unidad, null::numeric, 'total'::text;
      return;
    end if;
    select * into r from leer_formato_linea(v_part[1] || ' ' || coalesce(v_part[2], ''));
    if r.envase is null then
      return query select v_n, 'ud'::text, null::numeric, 'suelta'::text;
    elsif r.unidad = 'kg' and r.forma = 'suelta' and r.envase >= 0.5 then
      return;                                              -- «900g, contiene 24 unidades»: ¿peso de una o de todas?
    elsif r.unidad in ('l', 'kg') and r.forma in ('suelta', 'marcador') then
      return query select r.envase, r.unidad, v_n, 'contiene'::text;
    elsif r.unidad = 'ud' then
      return query select v_n, 'ud'::text, null::numeric, 'suelta'::text;
    end if;
    return;                                                -- ambiguo
  end if;

  -- d) «24x33cl», «24*275 ML».
  m := regexp_match(t, '\m(\d{1,3})\s*(?:uds?\.?|unidades)?\s*[x×*]\s*' || c_num || '\s*(cl|ml|lts?|litros?|l|grs?|gramos?|g|kgs?|kilos?)\y');
  if m is not null then
    select x.q, x.k into v_q, v_k from contenido_medida(m[2], m[3]) x;
    if v_q is null then
      return;                                              -- «6x1.000 g»: ambiguo
    end if;
    return query select v_q, v_k, m[1]::numeric, 'nxm'::text;
    return;
  end if;
  --    «200GX4», «10GX150»: envase × unidades, pegado.
  m := regexp_match(t, '\m' || c_num || '\s*(cl|ml|lts?|litros?|l|grs?|gramos?|g|kgs?|kilos?)\s*\.?\s*[x×]\s*(\d{1,3})\M(?!\s*[.,]?\d)(?!\s*(?:cl|ml|l|lts?|g|grs?|kgs?|k|cm|mm|m)\M)');
  if m is not null then
    select x.q, x.k into v_q, v_k from contenido_medida(m[1], m[2]) x;
    if v_q is not null then
      return query select v_q, v_k, m[3]::numeric, 'mxn'::text;
      return;
    end if;
  end if;

  -- Envase de UNA unidad, para e) y f): una sola cifra de peso o volumen.
  select count(distinct x.q::text || x.k), min(x.q), min(x.k)
    into v_cnt, v_q, v_k
    from regexp_matches(t, '\m' || c_num || '\s*' || c_peso || '\y', 'g') as g(g)
    cross join lateral contenido_medida(g.g[1], g.g[2]) x;
  if coalesce(v_cnt, 0) <> 1 then
    v_q := null; v_k := null;
    if coalesce(v_cnt, 0) = 0 and t ~ '\m(?:1\s*/\s*[2345]|3\s*/\s*4)(?!\s*[.,]?\d)' then
      -- «1/3 * 24», «3/4x6b»: tercio, quinto, medio, tres cuartos de litro.
      m := regexp_match(t, '\m([13])\s*/\s*([2345])(?!\s*[.,]?\d)');
      v_q := case m[1] || '/' || m[2] when '1/2' then 0.5 when '1/3' then 0.33 when '1/4' then 0.25
                                       when '1/5' then 0.2 when '3/4' then 0.75 end;
      v_k := case when v_q is not null then 'l' end;
    end if;
  end if;

  -- e) «* 24» al final del nombre (reparto de bebidas).
  m := regexp_match(t, '\*\s*(\d{1,3})\M(?!\s*[.,]\d)');
  if m is not null and m[1]::numeric between 2 and 500 and v_q is not null then
    return query select v_q, v_k, m[1]::numeric, 'estrella'::text;
    return;
  end if;

  -- f) Unidades por caja escritas aparte del envase.
  v_n := null;
  m := regexp_match(t, '\mc\s*[./]?\s*x\s*0*(\d{1,3})\M');                              -- «C.x06», «C X06»
  if m is not null then v_n := m[1]::numeric; v_fuerte := true; end if;
  if v_n is null then                                                                     -- «C/6», «C/6B», «c/10», «(C/ 120 U)»
    m := regexp_match(t, '\mc\s*/\s*(\d{1,3})\s*(?:bs|b|u|uds?|und|unid|bt|bot|botellas?|latas?)\M');
    if m is null then
      m := regexp_match(t, '\mc\s*/\s*(\d{1,3})\M(?!\s*[/.,]\s*\d)(?!\s*(?:k|kgs?|kilos?|l|lts?|g|grs?|cl|ml)\M)');
    end if;
    if m is not null then v_n := m[1]::numeric; v_fuerte := true; end if;
  end if;
  if v_n is null then                                                                     -- «CAJA 04 BT», «caja de 6 uds», «(pack 5)», «bandeja 24»
    m := regexp_match(t, '\m(?:cajas?|cj|bandeja|pack|estuche|fardo)\s*(?:de\s*)?0*(\d{1,3})\s*(?:bt|bot|botellas?|uds?|unidades|unid|u|latas?|bri[c]?ks?)?\M(?!\s*[/.,]\s*\d)(?!\s*' || c_peso || '\y)');
    if m is not null then v_n := m[1]::numeric; v_fuerte := true; end if;
  end if;
  if v_n is null then                                                                     -- «3/4x6b»
    m := regexp_match(t, 'x\s*(\d{1,2})\s*b\M');
    if m is not null then v_n := m[1]::numeric; v_fuerte := true; end if;
  end if;
  if v_n is null then                                                                     -- «C6», «C12», «C24» («C1» no dice nada; «C015» es un código)
    m := regexp_match(t, '\mc([1-9]\d?)\M(?!\s*[/.,]\s*\d)');
    if m is not null and m[1]::numeric >= 2 then v_n := m[1]::numeric; v_fuerte := true; end if;
  end if;
  if v_k is distinct from 'kg' then                                                       -- solo bebidas: «P6», «24 UNID», «24U»
    m := regexp_match(t, '\mp([2-9]|1\d|2[04])\M(?!\s*[/.,]\s*\d)');
    if m is not null then v_p := m[1]::numeric; v_fuerte := true; end if;
    if v_n is null and v_p is null then
      m := regexp_match(t, '\m(\d{1,3})\s*(?:unidades|unid|uds|ud|u|botellas|latas|bot|bt)\M');
      if m is not null then v_n := m[1]::numeric; end if;
    end if;
    if v_p is not null then
      v_n := coalesce(v_n, 1) * v_p;                                                      -- «P6 C4» = 24
    end if;
  end if;
  if v_n is not null and (v_n < 1 or v_n > 500) then
    v_n := null;
  end if;
  if v_n is not null and v_q is null and v_fuerte and coalesce(v_cnt, 0) = 0 then
    -- Caja de botellas sin unidad escrita: «C/6B LP ROSE 0,75», «C/3B MAGNUM».
    m := regexp_match(t, '\m(0[.,]375|0[.,]75|0[.,]70?|1[.,]5)\M(?!\s*[%º°])');
    if m is not null then
      v_q := replace(m[1], ',', '.')::numeric; v_k := 'l';
    elsif t ~ '\m(doble magnum|jeroboam)\M' then
      v_q := 3; v_k := 'l';
    elsif t ~ '\mmagnum\M' then
      v_q := 1.5; v_k := 'l';
    end if;
  end if;
  if v_n is not null and v_q is not null then
    return query select v_q, v_k, v_n, case when v_fuerte then 'caja_n' else 'caja_n_debil' end;
    return;
  end if;

  -- g) Lo de siempre (20261008140000 y 20261010160000), con las cifras ya
  --    corregidas: marcador de envase, rango, cifra única.
  v_txt := null; v_u := null;
  if t ~ '\mc\s*/\s*\d{1,3}\s*(?:u|uds?|unidades?|unid)\y' then
    -- «5L c/3u»: 3 piezas de 5 l → si hay UNA cifra de peso/volumen, manda.
    select count(distinct x.g[1] || x.g[2]), min(x.g[1]), min(x.g[2])
      into v_cnt, v_txt, v_u
      from regexp_matches(t, '\m' || c_num || '\s*' || c_peso || '\y', 'g') as x(g);
    if coalesce(v_cnt, 0) <> 1 then
      v_txt := null; v_u := null;
    end if;
  end if;
  if v_txt is not null then
    forma := 'suelta';
  else
    m := regexp_match(t, c_marc || c_num || '\s*' || c_uni || '\y');
    if m is not null then                                  -- con marcador de envase
      v_txt := m[1]; v_u := m[2]; forma := 'marcador';
    else
      if t ~ ('\d\s*(?:-|–|\ma\M)\s*' || c_num || '\s*' || c_uni || '\y') then
        return;                                            -- rango: ambiguo
      end if;
      select count(distinct x.q || x.k), min(x.txt), min(x.u)
        into v_cnt, v_txt, v_u
        from (
          select g[1] as txt, g[2] as u,
                 coalesce((select cm.q::text from contenido_medida(g[1], g[2]) cm), g[1]) as q,
                 case when g[2] ~ '^(kgs?|k|kilos?|kilogramos?|g|grs?|gramos?)$' then 'kg'
                      when g[2] ~ '^(l|lts?|ltos?|lt|litros?|cl|ml)$' then 'l'
                      else 'ud' end as k
            from regexp_matches(t, '\m' || c_num || '\s*' || c_uni || '\y', 'g') as rr(g)
        ) x;
      if coalesce(v_cnt, 0) <> 1 then
        return;
      end if;
      forma := 'suelta';
    end if;
  end if;

  if v_txt ~ '^\d+\.\d{3}$' then
    return;                                                -- «1.000 g»: ambiguo
  end if;
  if v_u ~ ('^' || c_peso || '$') then
    select x.q, x.k into envase, unidad from contenido_medida(v_txt, v_u) x;
  else
    envase := round(replace(v_txt, ',', '.')::numeric, 4); unidad := 'ud';
  end if;
  if envase is null or envase <= 0 or envase > 1000 then
    return;
  end if;
  unidades := null;
  return next;
  return;
end;
$function$;

-- ─── 3. Contenido leído de un texto, sin saber cómo se factura ─────────────
CREATE OR REPLACE FUNCTION public.extraer_contenido(p_texto text)
 RETURNS TABLE(cantidad numeric, unidad text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- 20261008140000_productos_contenido_unidad: contenido de un envase leído del
-- texto de la línea, SIN IA (solo regex). Devuelve (cantidad, unidad) con
-- unidad kg, l o ud ya convertida, o nada si no hay o es ambiguo.
-- 20261010160000_ocr_calidad_extraccion: «1/2 KG», calibres, «5L c/3u».
-- 20261207300000_ocr_contenido_packs: la lectura vive en leer_formato_linea.
-- Aquí, sin unidad facturada: se multiplica lo que el texto da como total
-- («24x33cl», «33cl * 24», «contiene 24 unidades») y NO lo que solo dice cómo
-- viene la caja («70CL C6»). Las líneas de factura usan contenido_linea.
declare
  f record;
  v numeric;
begin
  select * into f from leer_formato_linea(p_texto);
  if f.envase is null then
    return;
  end if;
  v := f.envase * case when f.forma in ('contiene', 'nxm', 'estrella') then coalesce(f.unidades, 1) else 1 end;
  if v > 0 and v <= 1000 then
    cantidad := round(v, 4);
    unidad := f.unidad;
    return next;
  end if;
  return;
end;
$function$;

-- ─── 4. Contenido de la unidad FACTURADA de una línea ──────────────────────
create or replace function public.contenido_linea(p_nombre text, p_unidad text, p_cantidad numeric default null)
 returns table(cantidad numeric, unidad text)
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
-- 20261207300000_ocr_contenido_packs: lo que entra por cada unidad facturada.
-- El «× N» solo se aplica cuando el papel lo da como total («contiene N»,
-- «24x33cl») o cuando la línea se factura por caja/pack/bandeja/bulto. Una
-- caja con un envase pequeño y sin unidades escritas → nada (no se inventa).
declare
  u        text := lower(btrim(coalesce(p_unidad, '')));
  f        record;
  v_c      numeric;
  v_u      text;
  v_nu     numeric;
  v_bulto  boolean;
  v_envase boolean;
begin
  v_nu := (regexp_match(u, '^(?:packs?|cajas?|bandejas?|estuches?|lotes?)\s+(?:de\s+)?(\d{1,3})$'))[1]::numeric;
  v_bulto := v_nu is not null
             or u ~ '^(cajas?|cj|cja|packs?|fardo|estuche|bandeja|bulto|lote|display|retractilado)$';
  v_envase := u ~ '^(botellas?|bt|botellin|botellines|latas?|botes?|tarrinas?|bri[c]?ks?|tarros?|frascos?|sobres?|vasos?|copas?|barril|barriles|garrafas?|bid[oó]n|bidones)$';

  select * into f from leer_formato_linea(p_nombre);
  if f.envase is null then
    -- Sin nada en el nombre: la unidad escrita («caja 10 kg»), como siempre.
    select e.cantidad, e.unidad into v_c, v_u from extraer_contenido(p_unidad) e;
  elsif f.forma = 'total' then
    v_c := f.envase; v_u := f.unidad;
  elsif f.forma = 'contiene' then
    v_c := f.envase * f.unidades; v_u := f.unidad;
    if v_c > 25 then
      v_c := null; v_u := null;             -- «900g, contiene 24 unidades»: el peso era el total
    end if;
  elsif f.forma = 'nxm' then
    v_c := f.envase * f.unidades; v_u := f.unidad;            -- «24x33cl», como siempre
  elsif f.forma = 'mxn' then
    -- «200GX4», «380grsx9»: por caja, el total; por bote o lata, uno; por
    -- «ud» o bolsa no se sabe si el precio es del pack o de la pieza.
    if v_bulto then
      v_c := f.envase * f.unidades; v_u := f.unidad;
    elsif v_envase then
      v_c := f.envase; v_u := f.unidad;
    end if;
  elsif f.forma in ('estrella', 'caja_n', 'caja_n_debil') then
    if v_bulto then
      if f.unidad = 'kg' and f.forma <> 'estrella' and f.envase > 0.2 and f.unidades > 6 then
        v_c := null;                        -- «500g (C/ 15u)»: ¿15 piezas en 500 g o 15 de 500 g?
      else
        v_c := f.envase * f.unidades; v_u := f.unidad;
      end if;
    elsif f.forma <> 'caja_n_debil' then
      v_c := f.envase; v_u := f.unidad;                       -- por botella o unidad: un envase
    end if;
  elsif f.unidad in ('l', 'kg') and v_nu >= 2 then
    v_c := f.envase * v_nu; v_u := f.unidad;                  -- unidad «pack de 6»
  elsif f.forma = 'suelta'
        and ((f.unidad in ('l', 'kg') and f.envase < 1 and u ~ '^(cajas?|cj|cja|fardo)$')
             or (f.unidad = 'l' and f.envase < 2 and u ~ '^packs?$')) then
    v_c := null; v_u := null;                                 -- caja sin unidades: no se inventa
  else
    v_c := f.envase; v_u := f.unidad;
  end if;

  -- 20261010160000: «C/15UD» no es contenido si la línea ya cuenta unidades
  -- y la cantidad es múltiplo de él (el precio ya es por unidad).
  if v_u = 'ud' and v_c >= 1 and p_cantidad > 0
     and u ~ '^(|u|ud|uds|unidad|unidades|unid)$'
     and mod(p_cantidad, v_c) = 0 then
    v_c := null; v_u := null;
  end if;
  if v_c is null or v_c <= 0 or v_c > 1000 then
    return;
  end if;
  cantidad := round(v_c, 4);
  unidad := v_u;
  return next;
  return;
end;
$function$;

revoke all on function public.contenido_medida(text, text) from public, anon;
grant execute on function public.contenido_medida(text, text) to authenticated, service_role;
revoke all on function public.leer_formato_linea(text) from public, anon;
grant execute on function public.leer_formato_linea(text) to authenticated, service_role;
revoke all on function public.contenido_linea(text, text, numeric) from public, anon;
grant execute on function public.contenido_linea(text, text, numeric) to authenticated, service_role;

comment on function public.contenido_linea(text, text, numeric) is
  '20261207300000: contenido (kg, l, ud) de la unidad FACTURADA de una línea, leído del nombre y de la unidad. Multiplica las unidades por caja solo si el papel las da como total o la línea se factura por caja/pack/bandeja. Lo usa trg_productos_factura_rellenar_contenido.';
comment on function public.leer_formato_linea(text) is
  '20261207300000: formato escrito en un texto de línea: envase (kg, l, ud), unidades por caja y forma (total, contiene, nxm, mxn, estrella, caja_n, caja_n_debil, marcador, suelta).';

-- ─── 5. Trigger de las líneas ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_productos_factura_rellenar_contenido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- 20261008140000_productos_contenido_unidad: rellena contenido_* leyendo el
-- nombre (y, si no, la unidad) de la línea. Lo puesto a mano no se pisa; un
-- valor escrito a propósito (alta con contenido, o cambio de contenido sin
-- tocar el origen) pasa a ser 'manual'.
-- 20261010160000_ocr_calidad_extraccion: «C/15UD» con cantidad múltiplo.
-- 20261207300000_ocr_contenido_packs: la lectura es contenido_linea(nombre,
-- unidad, cantidad): packs («* 24», «C6», «contiene N», «pack de 6»).
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

  select e.cantidad, e.unidad into v_c, v_u
    from contenido_linea(new.nombre::text, new.unidad::text, new.cantidad) e;
  new.contenido_cantidad := v_c;
  new.contenido_unidad := v_u;
  new.contenido_origen := case when v_c is not null then 'texto' end;
  return new;
end;
$function$;

-- ─── 6. envase_texto (litros y kilos comprados): las mismas lecturas ───────
CREATE OR REPLACE FUNCTION public.envase_texto(p_texto text)
 RETURNS TABLE(volumen numeric, unidad text, unidades numeric)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- 20261106400000_facturas_volumenes; 20261123100000_envase_tercio_litro: 1/3 y 1/5 de litro.
-- 20261207300000_ocr_contenido_packs: «237 CL» = 237 ml (contenido_medida),
-- «0'50 L» = 0,5 l, «24*275 ML» = 24 de 275 ml, «C.x06» = caja de 6.
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
  t := regexp_replace(t, '(\d)[''´`’](\d)', '\1,\2', 'g');
  t := regexp_replace(t, '\m1\s*/\s*2\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,5 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*3\s*(?=(l|lts?|litros?)\y)', '0,33 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*5\s*(?=(l|lts?|litros?)\y)', '0,2 ', 'g');
  t := regexp_replace(t, '\m1\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,25 ', 'g');
  t := regexp_replace(t, '\m3\s*/\s*4\s*(?=(kgs?|k|kilos?|l|lts?|litros?)\y)', '0,75 ', 'g');
  t := regexp_replace(t, '[+]\s*\d{1,4}(?:[.,]\d{1,3})?\s*(?:grs?|gramos?|g|kgs?|k)\y', ' ', 'g');
  t := regexp_replace(t, '\mcal(?:ibre)?\.?\s*\d+(?:\s*/\s*\d+)?', ' ', 'g');

  -- Unidades por caja: «24x33cl», «24*275 ML», «C.x06», «c/6», «C24», «* 24», «12 unidades».
  m := regexp_match(t, '\m(\d{1,3})\s*[x×*]\s*' || c_num || '\s*' || c_uni || '\y');
  if m is not null then
    v_n := m[1]::numeric;
    t := regexp_replace(t, '\m\d{1,3}\s*[x×*]\s*(?=\d)', ' ', 'g');
  end if;
  if v_n is null then
    m := regexp_match(t, '\mc\s*[./]?\s*x\s*0*(\d{1,3})\M');
    v_n := m[1]::numeric;
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
  select count(distinct x.q::text || x.k), min(x.q), min(x.k)
    into v_cnt, v_q, v_u
    from regexp_matches(t, '\m' || c_num || '\s*' || c_uni || '\y', 'g') as r(g)
    cross join lateral contenido_medida(r.g[1], r.g[2]) x;
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

-- Envase de los productos del catálogo cuyo nombre (o el de sus líneas) trae
-- alguna de las lecturas que cambian. No pisa lo puesto a mano.
select public.productos_envase_recalcular(array_agg(distinct x.id))
  from (
    select pc.id from public.productos_catalogo pc
     where pc.nombre ~* '(\m[2-9]\d{2,3}\s*cl\M)|(\d[''´`’]\d)|(\d\s*\*\s*\d)|(\mc\s*[./]?\s*x\s*\d)'
    union
    select pf.producto_id from public.productos_factura pf
     where pf.producto_id is not null
       and pf.nombre ~* '(\m[2-9]\d{2,3}\s*cl\M)|(\d[''´`’]\d)|(\d\s*\*\s*\d)|(\mc\s*[./]?\s*x\s*\d)'
  ) x;

-- ─── Comprobaciones ─────────────────────────────────────────────────────────
do $$
declare
  v numeric;
begin
  select cantidad into v from public.contenido_linea('COCA COLA 237 CL. * 24', 'caja', 1);
  if v is distinct from 5.688 then raise exception 'ocr_contenido_packs: «237 CL. * 24» en caja da %, no 5,688', v; end if;
  select cantidad into v from public.contenido_linea('W.JOHNNIE WALKER E/N 70CL 40º C6', 'botella', 6);
  if v is distinct from 0.7 then raise exception 'ocr_contenido_packs: «70CL C6» por botella da %, no 0,7', v; end if;
  select cantidad into v from public.contenido_linea('aro leche entera 1 L contiene 6 unidades', 'brik', 2);
  if v is distinct from 6 then raise exception 'ocr_contenido_packs: «1 L contiene 6 unidades» da %, no 6', v; end if;
  select cantidad into v from public.contenido_linea('Juan Gil Etiqueta Plata 12 meses 75 cl', 'botella', 12);
  if v is distinct from 0.75 then raise exception 'ocr_contenido_packs: «12 meses 75 cl» da %, no 0,75', v; end if;
  select cantidad into v from public.extraer_contenido('LEJIA 5L c/3u');
  if v is distinct from 5 then raise exception 'ocr_contenido_packs: extraer_contenido(«5L c/3u») da %, no 5', v; end if;
  select volumen into v from public.envase_texto('COCA COLA 237 CL. * 24');
  if v is distinct from 0.237 then raise exception 'ocr_contenido_packs: envase_texto(«237 CL») da %, no 0,237', v; end if;
end;
$$;

commit;

select 'ocr_contenido_packs: aplicada' as resultado;
