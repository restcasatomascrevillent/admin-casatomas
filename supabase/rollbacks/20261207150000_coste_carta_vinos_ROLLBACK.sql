set client_encoding = 'UTF8';
-- ROLLBACK de 20261207150000_coste_carta_vinos
-- Devuelve margenes_carta_agente al cuerpo de 20261128150000_chatbot_ultima_factura (el de la demo
-- antes de aplicar, pg_get_functiondef del 16/11/2026) y borra las funciones nuevas. No toca datos:
-- los enlaces de vino_producto hechos desde la pantalla se quedan (los guarda margenes_guardar_vino).
set lock_timeout = '5s';

create or replace function public.margenes_carta_agente(p_texto text DEFAULT NULL::text, p_vista text DEFAULT NULL::text, p_solo_problemas boolean DEFAULT false, p_limite integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- 20261116100000_chatbot_margenes_alertas + 20261128150000_chatbot_ultima_factura: el coste es el de la
-- ÚLTIMA factura (margenes_carta, 20261128140000): cada fila trae ultima_factura (fecha, proveedor, número,
-- precio tal como se compró) y la mediana de 90 días aparte, como contexto.
declare
  m jsonb := public.margenes_carta();
  c public.margenes_carta_config%rowtype;
  v_min_peso numeric; v_min_vino numeric; v_max_pct numeric;
  v_txt text := nullif(public._norm_agente(btrim(p_texto)), '');
  v_lim int := least(greatest(coalesce(p_limite, 15), 1), 40);
  v_vista text := nullif(lower(btrim(coalesce(p_vista, ''))), '');
  v_solo boolean := coalesce(p_solo_problemas, false);
begin
  if v_vista is not null and v_vista not in ('peso', 'vinos', 'platos') then
    return jsonb_build_object('error', 'vista debe ser peso, vinos, platos o null');
  end if;
  select * into c from public.margenes_carta_config where id;
  v_min_peso := coalesce(c.multiplicador_min_peso, 2);
  v_min_vino := coalesce(c.multiplicador_min_vino, 2.5);
  v_max_pct  := coalesce(c.coste_max_plato_pct, 35);

  return jsonb_strip_nulls(jsonb_build_object(
    'umbrales', jsonb_build_object('multiplicador_min_peso', v_min_peso, 'multiplicador_min_vino', v_min_vino,
                                   'coste_max_plato_pct', v_max_pct, 'iva_pct', coalesce(c.iva_pct, 10)),
    'como_leer', 'El coste (compra_kg, coste_botella, coste) es el de la ULTIMA factura: da primero ultima_factura (fecha, proveedor, '
                 || 'numero: citalo para el enlace; precio por su unidad); *_mediana = mediana de 90 dias, solo despues y como contexto. '
                 || 'multiplicador = cuantas veces cobras lo que pagas (venta SIN IVA / compra SIN IVA; peso: euros/kg de carta frente a '
                 || 'euros/kg comprado; vino: botella frente a botella). pct_coste = % del precio de VENTA sin IVA que se va en coste '
                 || '(de cada 100 euros que cobras, X son coste); no es un % sobre el coste. Platos con revisado=false son ESTIMACIONES de '
                 || 'escandallo: dilo y no las des como dato firme; sin texto solo salen platos revisados (resumen.platos dice cuantos hay). '
                 || 'Pantalla: Facturas > Margenes.',
    'resumen', jsonb_build_object(
      'peso', (select jsonb_build_object('articulos', count(*),
                 'por_debajo', count(*) filter (where (e ->> 'multiplicador')::numeric < v_min_peso),
                 'sin_datos', count(*) filter (where e ->> 'multiplicador' is null),
                 'mediana', round((percentile_cont(0.5) within group (order by (e ->> 'multiplicador')::numeric))::numeric, 2))
               from jsonb_array_elements(m -> 'peso') e),
      'vinos', (select jsonb_build_object('vinos', count(*), 'con_coste', count(e ->> 'multiplicador'),
                 'por_debajo', count(*) filter (where (e ->> 'multiplicador')::numeric < v_min_vino),
                 'mediana', round((percentile_cont(0.5) within group (order by (e ->> 'multiplicador')::numeric))::numeric, 2))
               from jsonb_array_elements(m -> 'vinos') e),
      'platos', (select jsonb_build_object('platos', count(*), 'con_escandallo', count(e ->> 'coste'),
                 'revisados', count(*) filter (where (e ->> 'revisado')::boolean),
                 'por_encima_pct', count(*) filter (where (e ->> 'pct')::numeric > v_max_pct))
               from jsonb_array_elements(m -> 'platos') e)),
    'peso', case when v_vista is null or v_vista = 'peso' then (
      select coalesce(jsonb_agg(r.j order by r.mult nulls last), '[]'::jsonb) from (
        select (e ->> 'multiplicador')::numeric as mult,
               jsonb_build_object('nombre', e ->> 'nombre', 'precio_carta', e -> 'precio', 'unidad_carta', e ->> 'unidad',
                 'venta_kg_sin_iva', e -> 'venta_kg', 'producto_comprado', e ->> 'producto', 'compra_kg', e -> 'compra_kg',
                 'multiplicador', e -> 'multiplicador', 'por_debajo', (e ->> 'multiplicador')::numeric < v_min_peso,
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'compra_kg_mediana', e -> 'compra_kg_mediana', 'lineas', e -> 'lineas', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(m -> 'peso') e
         where (v_txt is null or public._norm_agente(e ->> 'nombre') like '%' || v_txt || '%'
                              or public._norm_agente(e ->> 'producto') like '%' || v_txt || '%')
           and (not v_solo or (e ->> 'multiplicador')::numeric < v_min_peso)
         order by (e ->> 'multiplicador')::numeric nulls last limit v_lim) r) end,
    'vinos', case when v_vista is null or v_vista = 'vinos' then (
      select coalesce(jsonb_agg(r.j order by r.mult nulls last), '[]'::jsonb) from (
        select (e ->> 'multiplicador')::numeric as mult,
               jsonb_build_object('nombre', e ->> 'nombre', 'categoria', e ->> 'categoria', 'precio_carta', e -> 'precio',
                 'precio_copa', e -> 'precio_copa', 'producto_comprado', e ->> 'producto', 'coste_botella', e -> 'coste',
                 'multiplicador', e -> 'multiplicador', 'por_debajo', (e ->> 'multiplicador')::numeric < v_min_vino,
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'coste_mediana', e -> 'coste_mediana', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(m -> 'vinos') e
         where (v_txt is null or public._norm_agente(e ->> 'nombre') like '%' || v_txt || '%'
                              or public._norm_agente(e ->> 'producto') like '%' || v_txt || '%')
           and (not v_solo or (e ->> 'multiplicador')::numeric < v_min_vino)
           and (v_txt is not null or e ->> 'multiplicador' is not null)
         order by (e ->> 'multiplicador')::numeric nulls last limit v_lim) r) end,
    'platos', case when v_vista is null or v_vista = 'platos' then (
      select coalesce(jsonb_agg(r.j order by r.pct desc nulls last), '[]'::jsonb) from (
        select (e ->> 'pct')::numeric as pct,
               jsonb_build_object('nombre', e ->> 'nombre', 'categoria', e ->> 'categoria', 'precio_carta', e -> 'precio',
                 'coste', e -> 'coste', 'pct_coste', e -> 'pct', 'margen', e -> 'margen',
                 'ingrediente_principal', e ->> 'principal', 'revisado', e -> 'revisado', 'origen', e ->> 'origen',
                 'variacion_coste_pct', e -> 'variacion_pct', 'ultima_factura', public._factura_agente(e -> 'factura'),
                 'coste_mediana', e -> 'coste_mediana', 'pct_mediana', e -> 'pct_mediana', 'sin_datos', e ->> 'motivo') as j
          from jsonb_array_elements(m -> 'platos') e
         where (v_txt is null or public._norm_agente(e ->> 'nombre') like '%' || v_txt || '%'
                              or public._norm_agente(e ->> 'principal') like '%' || v_txt || '%')
           and (not v_solo or (e ->> 'pct')::numeric > v_max_pct)
           -- Sin texto, solo escandallos revisados: los estimados (lata entera frente a la
           -- ración) salían como «los peores» sin serlo. Por nombre sí salen, marcados.
           and (v_txt is not null or (e ->> 'coste' is not null and (e ->> 'revisado')::boolean))
         order by (e ->> 'pct')::numeric desc nulls last limit v_lim) r) end));
end;
$function$;
revoke all on function public.margenes_carta_agente(text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.margenes_carta_agente(text, text, boolean, integer) to service_role;

drop function if exists public.vinos_coste_candidatos(text, integer);
drop function if exists public.vinos_coste_carta(date, integer);
drop function if exists public.vinos_coste_carta_datos(date, integer, jsonb);
drop function if exists public.vinos_coste_nombre_base(text);

select 'coste_carta_vinos: rollback aplicado' as resultado;
