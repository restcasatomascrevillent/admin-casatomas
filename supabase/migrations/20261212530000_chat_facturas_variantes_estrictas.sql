set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212530000_chat_facturas_variantes_estrictas · Facturas (18/11/2026)
-- Revisión independiente de la release del chat (F2 y F7):
--  · F2 La regla «misma raíz» (20261212410000) sumaba productos distintos: manzana→manzanilla, salchicha→salchichón (y, por
--    el mismo mecanismo, pepino/pepinillo, papel/papelera, granada/granadilla, azúcar/azucarera, ensalada/ensaladera,
--    toalla/toallita, cuchara/cucharilla, batidor/batidora, pimiento/pimienta). Ahora una palabra solo cuenta como variante si:
--      1. es la misma en singular/plural (solo cambia -s / -es); o
--      2. es un derivado de CORTE de carne de una lista corta de raíces (chuletón/chuleta/chuletero, entrecot, solomillo,
--         costilla…) con -ón/-ones/-ero/-era; o
--      3. es un diminutivo de TAMAÑO (-ito/-ita: tomate→tomatito) Y la línea comparte familia de catálogo con lo que se pidió
--         (la familia de las líneas que SÍ existen con esa palabra en otros proveedores).
--    Lo demás NO suma: queda en posibles_coincidencias (como cualquier nombre parecido). variante_valida_agente(pedida, cabeza,
--    familia_de_la_línea, familias_de_lo_pedido).
--  · F7 volumen_comprado_agente: la «última compra» (ultima_compra, precio por litro/kilo) usa el importe neto
--    (coalesce(importe_neto, total)) si la columna existe y el impreso si no: vale antes y después de la release de los descuentos.
-- Parchea la definición VIVA con sustituciones de texto (aborta sin cambiar nada si no es la esperada). Requiere 20261212410000.
-- Sin begin/commit propios. Rollback: supabase/rollbacks/20261212530000_chat_facturas_variantes_estrictas_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

-- ─── F2. ¿Es esta palabra una variante del MISMO producto que la pedida? ────
create or replace function public.variante_valida_agente(p_pedida text, p_cabeza text, p_fam bigint default null, p_fams bigint[] default null)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  a  text := translate(lower(btrim(coalesce(p_pedida, ''))), 'áéíóúü', 'aeiouu');
  b  text := translate(lower(btrim(coalesce(p_cabeza, ''))), 'áéíóúü', 'aeiouu');
  ra text;
  rb text;
  sa text;
  sb text;
  v_flex  text[] := array['', 'a', 'o', 'e', 'as', 'os', 'es', 's'];
  v_dim   text[] := array['ito', 'ita', 'itos', 'itas'];
  v_corte text[] := array['', 'a', 'as', 'on', 'ones', 'ero', 'era', 'eros', 'eras'];
  -- Raíces de cortes de carne donde -ón / -ero / -era son el MISMO corte (chuletón = chuleta grande = chuletero).
  v_cortes text[] := array['chulet', 'entrecot', 'solomill', 'costill', 'secret', 'cochinill', 'lechon'];
  -- Raíces cuyo diminutivo NO es de tamaño sino otro producto.
  v_no_dim text[] := array['toall'];
begin
  if a = '' or b = '' then return false; end if;
  if a = b then return true; end if;
  ra := public.raiz_variante_agente(a);
  rb := public.raiz_variante_agente(b);
  if ra <> rb or length(ra) < 5 then return false; end if;
  sa := substr(a, length(ra) + 1);
  sb := substr(b, length(ra) + 1);
  -- 1. Solo singular / plural.
  if a = b || 's' or b = a || 's' or a = b || 'es' or b = a || 'es' then return true; end if;
  -- 2. Corte de carne: chuletón / chuleta / chuletero.
  if ra = any (v_cortes) and sa = any (v_corte) and sb = any (v_corte) then return true; end if;
  -- 3. Diminutivo de tamaño (-ito/-ita) de la misma familia de catálogo.
  if not (ra = any (v_no_dim))
     and ((sa = any (v_dim) and sb = any (v_flex)) or (sb = any (v_dim) and sa = any (v_flex))) then
    return p_fam is not null and p_fams is not null and p_fam = any (p_fams);
  end if;
  return false;
end;
$$;
revoke all on function public.variante_valida_agente(text, text, bigint, bigint[]) from public, anon;
grant execute on function public.variante_valida_agente(text, text, bigint, bigint[]) to authenticated, service_role;

do $mig$
declare
  v_def text;
begin
  if to_regprocedure('public.raiz_variante_agente(text)') is null then
    raise exception '20261212530000: falta 20261212410000 (raiz_variante_agente). No se ha cambiado nada.';
  end if;

  -- ─── compras_producto_agente: la cabeza cuenta como variante solo si variante_valida_agente ───
  v_def := pg_get_functiondef('public.compras_producto_agente'::regproc);
  if position('variante_valida_agente' in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, $a0$  v_elab  jsonb;$a0$, ''))) <> length($a0$  v_elab  jsonb;$a0$)
       or (length(v_def) - length(replace(v_def, $a1$      select array_agg(q.id order by q.id) filter (where q.cabeza),$a1$, ''))) <> length($a1$      select array_agg(q.id order by q.id) filter (where q.cabeza),$a1$)
       or (length(v_def) - length(replace(v_def, $a2$raiz_variante_agente(cabeza_nombre_agente(pf.nombre::text)) = v_stem as cabeza,$a2$, ''))) <> length($a2$raiz_variante_agente(cabeza_nombre_agente(pf.nombre::text)) = v_stem as cabeza,$a2$) then
      raise exception '20261212530000: compras_producto_agente: el texto a cambiar no aparece exactamente una vez (¿falta 20261212410000?). No se ha cambiado nada.';
    end if;
    v_def := replace(v_def, $a0$  v_elab  jsonb;$a0$, $b0$  v_elab  jsonb;
  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido$b0$);
    v_def := replace(v_def, $a1$      select array_agg(q.id order by q.id) filter (where q.cabeza),$a1$, $b1$      select array_agg(distinct coalesce(c.padre_id, c.id)) into v_fams
        from productos_factura x
        join productos_catalogo pc on pc.id = x.producto_id
        join categorias_producto c on c.id = pc.categoria_id
       where x.id = any(coalesce(v_ids, '{}'::bigint[]));
      select array_agg(q.id order by q.id) filter (where q.cabeza),$b1$);
    v_def := replace(v_def, $a2$raiz_variante_agente(cabeza_nombre_agente(pf.nombre::text)) = v_stem as cabeza,$a2$,
      $b2$variante_valida_agente(v_pal[1], cabeza_nombre_agente(pf.nombre::text),
                                (select coalesce(c.padre_id, c.id) from productos_catalogo pc join categorias_producto c on c.id = pc.categoria_id where pc.id = pf.producto_id),
                                v_fams) as cabeza,$b2$);
    execute v_def;
  end if;

  -- ─── volumen_comprado_agente: ultima_compra con el importe neto si existe ───
  v_def := pg_get_functiondef('public.volumen_comprado_agente'::regproc);
  if position('pfn' in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, $c0$    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea, o.pl, o.linea_id
      from ok o where o.proveedor_id is not null and o.pl is not null$c0$, ''))) <> length($c0$    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea, o.pl, o.linea_id
      from ok o where o.proveedor_id is not null and o.pl is not null$c0$) then
      raise exception '20261212530000: volumen_comprado_agente: el texto a cambiar no aparece exactamente una vez (¿falta 20261212410000?). No se ha cambiado nada.';
    end if;
    v_def := replace(v_def, $c0$    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea, o.pl, o.linea_id
      from ok o where o.proveedor_id is not null and o.pl is not null$c0$, $d0$    -- 20261212530000: precio neto (importe_neto) si la columna existe y la linea lo tiene; si no, el impreso. to_jsonb no falla sin la columna.
    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea,
           coalesce(case when o.cantidad_base > 0 and (to_jsonb(pfn) ->> 'importe_neto')::numeric > 0
                         then (to_jsonb(pfn) ->> 'importe_neto')::numeric / o.cantidad_base end, o.pl) as pl,
           o.linea_id
      from ok o left join productos_factura pfn on pfn.id = o.linea_id
     where o.proveedor_id is not null and o.pl is not null$d0$);
    execute v_def;
  end if;
end
$mig$;

do $$ begin raise notice 'chat_facturas_variantes_estrictas: aplicada'; end $$;
