-- Compara tablero_compras(todo el histórico) con SQL directo sobre las tablas.
with t as (select tablero_compras(null, null, null)::jsonb as j),
docs as (select f.* from facturas f where not (f.tipo = 'albaran' and f.facturado_en_id is not null)),
lin as (select pf.* from productos_factura pf join docs d on d.id = pf.factura_id),
directo as (
  select round(sum(coalesce(total, 0)), 2) as gasto, count(*) as documentos,
         count(*) filter (where tipo = 'albaran') as alb_n,
         round(coalesce(sum(coalesce(total,0)) filter (where tipo = 'albaran'), 0), 2) as alb_imp,
         round(coalesce(sum(total) filter (where total < 0), 0), 2) as abonos,
         (select round(coalesce(sum(importe_bruto - total), 0), 2) from lin where importe_bruto > total) as regalado,
         (select count(*) from lin where importe_bruto > total) as regalado_lineas,
         (select round(coalesce(sum(total), 0), 2) from lin) as lineas_importe,
         (select count(*) from lin where total is null) as lineas_sin_importe,
         (select min(fecha) from facturas) as primera_fecha
    from docs)
select jsonb_build_object(
  'gasto', jsonb_build_array((t.j->'indicadores'->>'gasto')::numeric, d.gasto),
  'documentos', jsonb_build_array((t.j->'indicadores'->>'documentos')::int, d.documentos),
  'albaranes_sin_factura', jsonb_build_array((t.j->'indicadores'->>'albaranes_sin_factura')::int, d.alb_n),
  'albaranes_sin_factura_importe', jsonb_build_array((t.j->'indicadores'->>'albaranes_sin_factura_importe')::numeric, d.alb_imp),
  'abonos', jsonb_build_array((t.j->'indicadores'->>'abonos')::numeric, d.abonos),
  'regalado', jsonb_build_array((t.j->'indicadores'->>'regalado')::numeric, d.regalado),
  'regalado_lineas', jsonb_build_array((t.j->'indicadores'->>'regalado_lineas')::int, d.regalado_lineas),
  'familias_importe_total_vs_lineas', jsonb_build_array((t.j->'familias'->>'importe_total')::numeric, d.lineas_importe),
  'familias_lineas_sin_importe', jsonb_build_array((t.j->'familias'->>'lineas_sin_importe')::int, d.lineas_sin_importe),
  'periodo_desde', jsonb_build_array(t.j->'periodo'->>'desde', d.primera_fecha),
  'suma_meses_vs_gasto', jsonb_build_array((select round(sum((m->>'total')::numeric), 2) from jsonb_array_elements(t.j->'meses') m), d.gasto)
) as cuadre from t, directo d;
