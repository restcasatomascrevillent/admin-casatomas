set client_encoding = 'UTF8';
-- Test de 20261107610000_chat_facturas_irpf. BEGIN … ROLLBACK: no deja nada escrito.
-- Acaba en «chat_facturas_irpf_test: OK».
--   supabase db query --linked -f supabase/tests/chat_facturas_irpf_test.sql
--
--   1. Marca 20261107610000, permisos (sin anon).
--   2. resumen_periodo_agente(2026): retencion_irpf = suma directa de
--      facturas.retencion_irpf (sin albaranes ya facturados) y nº de documentos;
--      en la demo, 5.920,09 € en 42 facturas. Sin retenciones: documentos 0.
--   3. consulta_flexible_agente: sum_retencion_irpf y count_con_retencion iguales,
--      también por proveedor; no se admiten con fuente lineas.
--   4. Lo de antes no cambia: gasto_total sigue igual a la suma directa.
begin;

do $$
declare
  v_ref_imp numeric;
  v_ref_n   int;
  v_r       jsonb;
  v_c       jsonb;
begin
  -- 1
  if position('20261107610000' in pg_get_functiondef('public.resumen_periodo_agente(date, date)'::regprocedure)) = 0
     or position('20261107610000' in pg_get_functiondef('public.consulta_flexible_agente(jsonb)'::regprocedure)) = 0 then
    raise exception 'FALLO 1: falta la marca 20261107610000';
  end if;
  if has_function_privilege('anon', 'public.resumen_periodo_agente(date, date)', 'execute')
     or has_function_privilege('anon', 'public.consulta_flexible_agente(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.consulta_flexible_agente(jsonb)', 'execute') then
    raise exception 'FALLO 1: permisos';
  end if;

  -- 2
  select round(coalesce(sum(retencion_irpf), 0), 2), count(*) into v_ref_imp, v_ref_n
    from facturas f
   where retencion_irpf is not null and fecha between '2026-01-01' and '2026-12-31'
     and not (tipo = 'albaran' and id in (select albaran_id from albaranes_facturados_agente()));
  v_r := resumen_periodo_agente('2026-01-01', '2026-12-31')::jsonb -> 'retencion_irpf';
  if (v_r ->> 'importe')::numeric <> v_ref_imp or (v_r ->> 'documentos')::int <> v_ref_n then
    raise exception 'FALLO 2: resumen % frente a % € en %', v_r, v_ref_imp, v_ref_n;
  end if;
  if v_ref_n > 0 and (jsonb_typeof(v_r -> 'por_proveedor') <> 'array' or v_r ->> 'nota' is null
                      or (select sum((x ->> 'importe')::numeric) from jsonb_array_elements(v_r -> 'por_proveedor') x) > v_ref_imp) then
    raise exception 'FALLO 2: por_proveedor/nota %', v_r;
  end if;
  v_r := resumen_periodo_agente('1990-01-01', '1990-01-31')::jsonb -> 'retencion_irpf';
  if (v_r ->> 'documentos')::int <> 0 or (v_r ->> 'importe')::numeric <> 0 or v_r ? 'por_proveedor' then
    raise exception 'FALLO 2: sin retenciones debe dar documentos 0: %', v_r;
  end if;

  -- 3
  v_c := consulta_flexible_agente('{"fuente":"documentos","metricas":["sum_retencion_irpf","count_con_retencion"],
                                    "filtros":{"desde":"2026-01-01","hasta":"2026-12-31"}}')::jsonb;
  if (v_c #>> '{filas,0,sum_retencion_irpf}')::numeric is distinct from nullif(v_ref_imp, 0)
     or (v_c #>> '{filas,0,count_con_retencion}')::int <> v_ref_n then
    raise exception 'FALLO 3: consulta_flexible %', v_c;
  end if;
  if v_c #>> '{filas,0}' like '%sin_total%' then
    raise exception 'FALLO 3: la retención no debe arrastrar los avisos de importe: %', v_c;
  end if;
  v_c := consulta_flexible_agente('{"fuente":"documentos","metricas":["sum_retencion_irpf"],"agrupar":["proveedor"],
                                    "filtros":{"desde":"2026-01-01","hasta":"2026-12-31"},"limite":50}')::jsonb;
  if (select coalesce(sum((x ->> 'sum_retencion_irpf')::numeric), 0) from jsonb_array_elements(v_c -> 'filas') x) <> v_ref_imp then
    raise exception 'FALLO 3: por proveedor no suma %', v_ref_imp;
  end if;
  v_c := consulta_flexible_agente('{"fuente":"lineas","metricas":["sum_retencion_irpf"]}')::jsonb;
  if v_c ->> 'error' is null then
    raise exception 'FALLO 3: con fuente lineas no debería admitirse: %', v_c;
  end if;

  -- 4
  if (resumen_periodo_agente('2026-01-01', '2026-12-31')::jsonb #>> '{gasto_total,importe}')::numeric <>
     (select round(coalesce(sum(total), 0)::numeric, 2) from facturas
       where fecha between '2026-01-01' and '2026-12-31'
         and not (tipo = 'albaran' and id in (select albaran_id from albaranes_facturados_agente()))) then
    raise exception 'FALLO 4: gasto_total ha cambiado';
  end if;

  raise notice 'chat_facturas_irpf_test: OK (% € en % documentos)', v_ref_imp, v_ref_n;
end;
$$;

rollback;
select 'chat_facturas_irpf_test: OK' as resultado;
