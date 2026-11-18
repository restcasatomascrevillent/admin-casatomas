set client_encoding = 'UTF8';
-- Vuelve a la definición de emparejar_presupuesto_agente anterior a 20261212200000 (la de producción el 18/11/2026).
set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.emparejar_presupuesto_agente(p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;
