set client_encoding = 'UTF8';
-- 20261212530000_chat_facturas_variantes_estrictas · ROLLBACK: vuelve a la regla de la misma raíz y al precio impreso en ultima_compra.
set lock_timeout = '5s';

do $mig$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.compras_producto_agente'::regproc);
  v_def := replace(v_def, $b$  v_fams  bigint[];   -- 20261212530000: familias de catalogo de lo pedido$b$, '');
  v_def := replace(v_def, $b$      select array_agg(distinct coalesce(c.padre_id, c.id)) into v_fams
        from productos_factura x
        join productos_catalogo pc on pc.id = x.producto_id
        join categorias_producto c on c.id = pc.categoria_id
       where x.id = any(coalesce(v_ids, '{}'::bigint[]));
$b$, '');
  v_def := replace(v_def, $b$variante_valida_agente(v_pal[1], cabeza_nombre_agente(pf.nombre::text),
                                (select coalesce(c.padre_id, c.id) from productos_catalogo pc join categorias_producto c on c.id = pc.categoria_id where pc.id = pf.producto_id),
                                v_fams) as cabeza,$b$, $a$raiz_variante_agente(cabeza_nombre_agente(pf.nombre::text)) = v_stem as cabeza,$a$);
  execute v_def;

  v_def := pg_get_functiondef('public.volumen_comprado_agente'::regproc);
  v_def := replace(v_def, $b$    -- 20261212530000: precio neto (importe_neto) si la columna existe y la linea lo tiene; si no, el impreso. to_jsonb no falla sin la columna.
    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea,
           coalesce(case when o.cantidad_base > 0 and (to_jsonb(pfn) ->> 'importe_neto')::numeric > 0
                         then (to_jsonb(pfn) ->> 'importe_neto')::numeric / o.cantidad_base end, o.pl) as pl,
           o.linea_id
      from ok o left join productos_factura pfn on pfn.id = o.linea_id
     where o.proveedor_id is not null and o.pl is not null$b$, $a$    select o.fecha, o.doc_id, o.proveedor_txt, o.producto, o.nombre_linea, o.pl, o.linea_id
      from ok o where o.proveedor_id is not null and o.pl is not null$a$);
  execute v_def;
end
$mig$;

drop function if exists public.variante_valida_agente(text, text, bigint, bigint[]);
