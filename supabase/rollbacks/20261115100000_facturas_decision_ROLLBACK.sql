set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK de 20261115100000_facturas_decision
-- ----------------------------------------------------------------------------
-- Vuelve facturas_alertas_umbrales, facturas_generar_alertas y
-- facturas_alertas_activas a la versión de 20261107300000; borra las funciones
-- nuevas (facturas_decision, «Visto», «Es normal», precios pactados, compras,
-- candidatas extra, objeto), las dos tablas (SE PIERDEN los silencios y los
-- precios pactados) y los avisos de los tipos nuevos. Las alertas de subida
-- conservan datos.impacto_mes/campana (no molestan: la versión anterior no
-- los lee). Desplegar ANTES el panel anterior (llama a facturas_decision).
-- Idempotente; termina en «facturas_decision: deshecha».
-- ============================================================================
begin;
set local lock_timeout = '5s';

drop function if exists public.facturas_decision(date, date, text);
drop function if exists public.facturas_alerta_visto(uuid);
drop function if exists public.facturas_alerta_es_normal(uuid, int);
drop function if exists public.facturas_precio_pactado_marcar(bigint, text, numeric, text, text);
drop function if exists public.facturas_precio_pactado_quitar(bigint, text);

delete from public.notificaciones_dashboard
 where tipo in ('facturas_precio_baja', 'facturas_precio_proveedor', 'facturas_precio_pactado');

-- Versión de 20261107300000 (copia literal).
create or replace function public.facturas_alertas_umbrales()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- 20261107300000_facturas_alertas
  select jsonb_build_object(
           'subida_pct',               10,
           'subida_alta_pct',          25,
           'subida_ref_dias',          90,
           'subida_vigencia_dias',     45,
           'gasto_relevante_eur',      500,
           'otro_proveedor_pct',       15,
           'otro_proveedor_dias',      90,
           'otro_proveedor_compras',   2,
           'otro_proveedor_max_pct',   45,
           'ahorro_minimo_eur',        20,
           'ahorro_alto_eur',          150,
           'familia_pct',              25,
           'familia_meses',            6,
           'familia_media_min_eur',    150,
           'familia_extra_min_eur',    200,
           'familia_dia_minimo',       10,
           'albaran_dias',             35,
           'albaran_alto_eur',         1000,
           'proveedor_nuevo_dias',     45,
           'importe_inusual_factor',   3,
           'importe_inusual_min_eur',  300,
           'avisos_dias',              7)
         || coalesce((select c.alertas from configuracion_facturas c where c.id), '{}'::jsonb)
         || coalesce((select jsonb_build_object('subida_pct', c.umbral_subida_precio_pct)
                        from configuracion_facturas c where c.id), '{}'::jsonb)
$$;


create or replace function public.facturas_generar_alertas(p_hoy date default current_date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- 20261107300000_facturas_alertas
declare
  v_tipos   text[] := array['facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                            'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                            'facturas_revision'];
  v_nuevas  int;
  v_act     int;
  v_cad     int;
  v_borr    int;
  v_total   int;
  v_por     jsonb;
begin
  create temp table if not exists _alertas_hoy (
    tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb
  ) on commit drop;
  truncate _alertas_hoy;
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas(p_hoy);
  -- Una clave, una fila (por si dos reglas dieran la misma).
  delete from _alertas_hoy a using _alertas_hoy b where a.clave = b.clave and a.ctid > b.ctid;

  -- Lo que sigue vigente: texto y cifras al día; «leída» no se toca.
  update notificaciones_dashboard n
     set titulo = a.titulo, mensaje = a.mensaje, prioridad = a.prioridad, datos = a.datos, caduca_en = a.caduca_en
    from _alertas_hoy a
   where n.clave = a.clave
     and (n.titulo, n.mensaje, n.prioridad, n.datos, n.caduca_en) is distinct from (a.titulo, a.mensaje, a.prioridad, a.datos, a.caduca_en);
  get diagnostics v_act = row_count;

  insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos)
  select a.tipo, a.titulo, a.mensaje, 'facturas_alerta', a.prioridad, a.clave, a.caduca_en, a.datos
    from _alertas_hoy a
   where not exists (select 1 from notificaciones_dashboard n where n.clave = a.clave)
  on conflict (clave) where clave is not null do nothing;
  get diagnostics v_nuevas = row_count;

  -- Lo que ya no se cumple (precio corregido, albarán facturado, duplicado borrado…) caduca ya.
  -- Caducada = también «leída»: el número rojo de «Avisos» (cuenta las no leídas) no la cuenta.
  update notificaciones_dashboard n
     set caduca_en = now(), leida = true
   where n.tipo = any(v_tipos) and n.clave is not null
     and (n.caduca_en is null or n.caduca_en > now())
     and not exists (select 1 from _alertas_hoy a where a.clave = n.clave);
  get diagnostics v_cad = row_count;
  update notificaciones_dashboard n
     set leida = true
   where n.tipo = any(v_tipos) and n.caduca_en <= now() and not n.leida;

  -- Limpieza: caducadas hace más de 90 días (su clave ya no puede volver: las reglas miran fechas recientes).
  delete from notificaciones_dashboard n
   where n.tipo = any(v_tipos) and n.caduca_en < now() - interval '90 days';
  get diagnostics v_borr = row_count;

  select count(*), coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb)
    into v_total, v_por
    from (select a.tipo, count(*) as n from _alertas_hoy a group by a.tipo) t;
  v_total := (select count(*) from _alertas_hoy);

  return jsonb_build_object('vigentes', v_total, 'nuevas', v_nuevas, 'actualizadas', v_act,
                            'caducadas', v_cad, 'borradas', v_borr, 'por_tipo', v_por);
end;
$$;

comment on function public.facturas_generar_alertas(date) is
  'Genera las alertas de Facturas en notificaciones_dashboard (sin duplicar por clave; caduca las que ya no se cumplen). SECURITY DEFINER, solo service_role (cron facturas-alertas). 20261107300000.';

-- ─── 5. Lectura para el panel ───────────────────────────────────────────────
create or replace function public.facturas_alertas_activas(
  p_desde date default null, p_hasta date default null, p_local text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- 20261107300000_facturas_alertas. Vigentes, de más a menos importante. Con
  -- periodo: las que tocan ese periodo (datos.desde … datos.hasta). Con local:
  -- las de ese local y las de los dos.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'tipo', n.tipo, 'prioridad', n.prioridad, 'titulo', n.titulo, 'mensaje', n.mensaje,
           'leida', n.leida, 'creada', n.created_at, 'caduca', n.caduca_en, 'datos', n.datos)
         order by (n.prioridad = 'alta') desc, n.leida, n.created_at desc, n.id), '[]'::jsonb)
    from notificaciones_dashboard n
   where (select can_read_section('facturas'))
     and n.tipo in ('facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                    'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                    'facturas_revision')
     and (n.caduca_en is null or n.caduca_en > now())
     and (p_desde is null or coalesce((n.datos ->> 'hasta')::date, p_desde) >= p_desde)
     and (p_hasta is null or coalesce((n.datos ->> 'desde')::date, p_hasta) <= p_hasta)
     and (nullif(p_local, '') is null or n.datos ->> 'local' is null or n.datos ->> 'local' = p_local)
$$;

comment on function public.facturas_alertas_activas(date, date, text) is
  'Facturas › Análisis: alertas vigentes (tarjeta «Requiere atención» y marcas en las gráficas). SECURITY INVOKER. 20261107300000.';


-- La generación de antes ya no llama a estas.
drop function if exists public.facturas_alertas_candidatas_extra(date);
drop function if exists public.facturas_alertas_compras(date, date);
drop function if exists public.facturas_alerta_objeto(text, jsonb);
drop table if exists public.facturas_alertas_silencios;
drop table if exists public.facturas_precios_pactados;

revoke all on function public.facturas_alertas_umbrales() from public, anon;
revoke all on function public.facturas_generar_alertas(date) from public, anon, authenticated;
revoke all on function public.facturas_alertas_activas(date, date, text) from public, anon;
grant execute on function public.facturas_alertas_umbrales() to authenticated, service_role;
grant execute on function public.facturas_generar_alertas(date) to service_role;
grant execute on function public.facturas_alertas_activas(date, date, text) to authenticated, service_role;

commit;

select 'facturas_decision: deshecha' as resultado;
