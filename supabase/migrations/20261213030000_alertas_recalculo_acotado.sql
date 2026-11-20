-- 20261213030000_alertas_recalculo_acotado
--
-- Problema (medición del 20/11/2026, guardado-facturas-medicion): el cron facturas-alertas-recalculo
-- (cada minuto) llama a facturas_alertas_recalcular_pendiente(), que con la cola llena ejecuta
-- facturas_generar_alertas(): recalcula las alertas de TODO el sistema (candidatas ≈ 0,8–2,8 s,
-- extra ≈ 0,3 s, avisos de margen ≈ 1 s en producción, y varias veces eso en frío o con la base
-- ocupada). Con cargas de OCR tardó 38, 56, 77 y 121 s (cortada por el tope de 120 s). Eso compite
-- por CPU y E/S con los guardados (INSERT de cabecera y líneas con media de 2 s y máximo de 8 s,
-- el tope del rol authenticator) y cada vuelta lanzaba otro recálculo completo en cuanto el
-- anterior acababa.
--
-- Mecanismo comprobado: el recálculo NO bloquea filas que un guardado necesite (candidatas es solo
-- lectura; escribe ~50 filas de notificaciones_dashboard, margenes_avisos_estado y silencios). El
-- único cruce es con facturas_alertas_tras_verificar (filas «campana» por clave), cuando un guardado
-- deja una factura verificada. Es saturación de una base pequeña (224 MB de shared_buffers, 2 MB de
-- work_mem, max_connections 60) más una transacción larga, no bloqueo de filas.
--
-- Qué cambia (el resultado de las alertas es EXACTAMENTE el mismo; nada de la lógica de
-- facturas_alertas_candidatas*, ni de los silencios, ni de los textos):
--   1. facturas_alertas_recalcular_pendiente():
--      · pausa mínima de 2 min desde el fin del último recálculo (antes: otro en cuanto acababa);
--      · cede el paso mientras haya un guardado de facturas/líneas en marcha (máx. 15 min);
--      · lock_timeout de 3 s: si choca con un guardado, deshace el intento (la cola se conserva)
--        y reintenta más tarde, con espera creciente (2, 4… 10 min) tras fallos seguidos;
--      · si el cron fija un statement_timeout corto (ver 3) y salta, hace lo mismo;
--      · deja su estado en facturas_alertas_recalculo_estado (último fin, duración, fallos).
--   2. facturas_generar_alertas(): bloquea por adelantado, en orden de clave, solo las filas de la
--      campana que va a cambiar o caducar (antes: en el orden en que las encontraba el UPDATE).
--   3. El cron facturas-alertas-recalculo pasa a «set local statement_timeout = '20s'» antes de la
--      llamada: un recálculo nunca retiene la base más de 20 s (antes 120 s). No toca su horario
--      (lo gestiona el PR de escalonado de crons); solo su comando.
-- El recálculo completo diario (cron facturas-alertas, 6:15) no cambia.
--
-- Reaplicable. Sin begin/commit.
-- Vuelta atrás: supabase/rollbacks/20261213030000_alertas_recalculo_acotado_ROLLBACK.sql

create table if not exists public.facturas_alertas_recalculo_estado (
  id                 int primary key default 1 check (id = 1),
  ultimo_intento     timestamptz,
  ultimo_fin         timestamptz,
  ultima_duracion_ms int,
  fallos_seguidos    int not null default 0,
  ultimo_error       text,
  ultimo_motivo      text
);
comment on table public.facturas_alertas_recalculo_estado is
  'Una sola fila: cómo fue el último recálculo de alertas lanzado por el cron (facturas_alertas_recalcular_pendiente).';
alter table public.facturas_alertas_recalculo_estado enable row level security;
revoke all on public.facturas_alertas_recalculo_estado from public, anon, authenticated;
grant all on public.facturas_alertas_recalculo_estado to service_role;

-- ¿Hay un guardado de facturas o líneas en marcha (más de 1 s)? Mira pg_stat_activity; si no hay
-- permiso para ver las consultas de otros, devuelve false (no cede, como antes).
create or replace function public.facturas_alertas_hay_guardado_en_curso()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
begin
  begin
    select count(*) into v_n
      from pg_stat_activity a
     where a.datname = current_database()
       and a.pid <> pg_backend_pid()
       and a.backend_type = 'client backend'
       and a.state = 'active'
       and a.xact_start < clock_timestamp() - interval '1 second'
       and a.query ~* '(insert\s+into|update|delete\s+from)\s+("?public"?\.)?"?(facturas|productos_factura)"?(\s|\()';
  exception when others then
    v_n := 0;
  end;
  return v_n > 0;
end;
$$;
revoke all on function public.facturas_alertas_hay_guardado_en_curso() from public, anon, authenticated;

create or replace function public.facturas_alertas_recalcular_pendiente(p_espera interval default interval '1 minute')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 20261130200000_decidir_hoy_recalculo · 20261213030000_alertas_recalculo_acotado: lo llama el cron cada minuto.
declare
  c_pausa constant interval := interval '2 minutes';    -- entre el fin de un recálculo y el siguiente
  c_tope  constant interval := interval '10 minutes';   -- cuánto se espera a que acaben de cargar
  c_cede  constant interval := interval '15 minutes';   -- hasta cuándo se cede el paso a los guardados
  v_ultimo  timestamptz;
  v_primero timestamptz;
  v_res     jsonb;
  v_est     public.facturas_alertas_recalculo_estado%rowtype;
  v_t0      timestamptz;
  v_lock    text;
begin
  if not pg_try_advisory_xact_lock(hashtext('facturas_alertas_recalculo')) then
    return jsonb_build_object('hecho', false, 'motivo', 'en_curso');
  end if;
  select max(creado), min(creado) into v_ultimo, v_primero from facturas_alertas_recalculo_cola;
  if v_ultimo is null then
    return jsonb_build_object('hecho', false, 'motivo', 'nada');
  end if;
  -- Se espera a que acaben de cargar (el OCR mete las líneas poco a poco), pero no más de 10 min.
  if v_ultimo > now() - p_espera and v_primero > now() - c_tope then
    return jsonb_build_object('hecho', false, 'motivo', 'esperando');
  end if;

  insert into facturas_alertas_recalculo_estado (id) values (1) on conflict (id) do nothing;
  select * into v_est from facturas_alertas_recalculo_estado where id = 1;
  -- Pausa tras el último recálculo bueno, y espera creciente tras fallos seguidos.
  if v_est.ultimo_fin is not null and v_est.ultimo_fin > clock_timestamp() - c_pausa then
    return jsonb_build_object('hecho', false, 'motivo', 'pausa');
  end if;
  if v_est.fallos_seguidos > 0 and v_est.ultimo_intento is not null
     and v_est.ultimo_intento > clock_timestamp() - least(v_est.fallos_seguidos * interval '2 minutes', interval '10 minutes') then
    return jsonb_build_object('hecho', false, 'motivo', 'reintento_mas_tarde', 'fallos', v_est.fallos_seguidos);
  end if;
  -- Un guardado en marcha pasa primero (pero la cola no se queda más de 15 min sin atender).
  if v_primero > now() - c_cede and public.facturas_alertas_hay_guardado_en_curso() then
    return jsonb_build_object('hecho', false, 'motivo', 'cede_a_guardado');
  end if;

  v_t0 := clock_timestamp();
  v_lock := current_setting('lock_timeout', true);
  begin
    perform set_config('lock_timeout', '3s', true);
    delete from facturas_alertas_recalculo_cola where creado <= v_ultimo;
    v_res := public.facturas_generar_alertas();
    perform set_config('lock_timeout', coalesce(v_lock, '0'), true);
    update facturas_alertas_recalculo_estado
       set ultimo_intento = v_t0, ultimo_fin = clock_timestamp(),
           ultima_duracion_ms = round(extract(epoch from clock_timestamp() - v_t0) * 1000)::int,
           fallos_seguidos = 0, ultimo_error = null, ultimo_motivo = 'hecho'
     where id = 1;
    return jsonb_build_object('hecho', true, 'resultado', v_res);
  exception when lock_not_available or query_canceled or deadlock_detected then
    -- Se deshace el intento entero (la cola se conserva) y se deja para una vuelta posterior.
    update facturas_alertas_recalculo_estado
       set ultimo_intento = v_t0, fallos_seguidos = fallos_seguidos + 1,
           ultima_duracion_ms = round(extract(epoch from clock_timestamp() - v_t0) * 1000)::int,
           ultimo_error = left(sqlerrm, 300), ultimo_motivo = 'cedido'
     where id = 1;
    return jsonb_build_object('hecho', false, 'motivo', 'cedido', 'error', left(sqlerrm, 300));
  end;
end;
$$;

-- facturas_generar_alertas: cuerpo de PRODUCCIÓN (pg_get_functiondef, 20/11/2026), igual al de
-- 20261125110000_avisos_margen_bajo, más el bloqueo ordenado de la campana (ver arriba).
CREATE OR REPLACE FUNCTION public.facturas_generar_alertas(p_hoy date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 20261107300000_facturas_alertas · 20261115100000_facturas_decision (impacto, campana,
-- proveedor, bajadas, pactados, silencios) · 20261125110000_avisos_margen_bajo (texto de
-- las subidas y aviso de margen bajo) · 20261213030000_alertas_recalculo_acotado (bloqueo ordenado)
declare
  u         jsonb := public.facturas_alertas_umbrales();
  v_hoy     date := coalesce(p_hoy, current_date);
  v_min     numeric := (u ->> 'campana_impacto_min_eur')::numeric;
  v_prov_n  int := (u ->> 'proveedor_subidas_min')::int;
  v_prov_d  int := (u ->> 'proveedor_dias')::int;
  v_tipos   text[] := array['facturas_precio_sube', 'facturas_precio_mejor', 'facturas_familia_gasto',
                            'facturas_albaran_sin_factura', 'facturas_proveedor_nuevo', 'facturas_importe_inusual',
                            'facturas_revision', 'facturas_precio_baja', 'facturas_precio_proveedor',
                            'facturas_precio_pactado'];
  v_nuevas  int;
  v_act     int;
  v_cad     int;
  v_borr    int;
  v_sil     int;
  v_total   int;
  v_por     jsonb;
  v_margen  jsonb;
begin
  create temp table if not exists _alertas_hoy (
    tipo text, prioridad text, titulo text, mensaje text, clave text, caduca_en timestamptz, datos jsonb
  ) on commit drop;
  truncate _alertas_hoy;
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas(v_hoy);
  insert into _alertas_hoy select * from public.facturas_alertas_candidatas_extra(v_hoy);
  -- Una clave, una fila (por si dos reglas dieran la misma).
  delete from _alertas_hoy a using _alertas_hoy b where a.clave = b.clave and a.ctid > b.ctid;

  -- € al mes que cuesta la subida: (precio − ref) / precio × lo comprado en 90 días / 3.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('impacto_mes',
           round(((a.datos ->> 'precio')::numeric - (a.datos ->> 'precio_ref')::numeric)
                 / nullif((a.datos ->> 'precio')::numeric, 0)
                 * coalesce((a.datos ->> 'importe_90')::numeric, 0) / 3, 2))
   where a.tipo = 'facturas_precio_sube';

  -- 20261125110000: texto sencillo de las subidas (cuánto, en qué factura, frente a qué
  -- compras y qué platos o vinos lo usan) + datos.texto_telegram. No cambia cuándo saltan.
  update _alertas_hoy a
     set titulo = s.t ->> 'titulo', mensaje = s.t ->> 'mensaje', datos = a.datos || (s.t -> 'datos')
    from (select x.clave, public.facturas_alerta_subida_texto(x.datos) as t
            from _alertas_hoy x where x.tipo = 'facturas_precio_sube') s
   where a.clave = s.clave and s.t is not null;

  -- Silencios: «Visto» (esa clave) y «Es normal» (ese tipo y objeto hasta su fecha).
  delete from _alertas_hoy a
   where exists (select 1 from facturas_alertas_silencios s
                  where (s.clave is not null and s.clave = a.clave)
                     or (s.objeto is not null and s.tipo = a.tipo
                         and s.objeto = public.facturas_alerta_objeto(a.tipo, a.datos)
                         and (s.hasta is null or s.hasta >= v_hoy)));
  get diagnostics v_sil = row_count;

  -- Un proveedor que sube varias cosas a la vez: un solo aviso.
  insert into _alertas_hoy
  select 'facturas_precio_proveedor',
         case when g.impacto >= v_min * 3 then 'alta' else 'normal' end,
         left(format('%s ha subido %s %s esta semana (+%s %% de media)', g.proveedor, g.n,
                     case when g.n_fam = 1 and g.familia is not null then lower(g.familia) else 'productos' end,
                     facturas_alertas_num(g.media, 0)), 120),
         format('%s: %s. Te cuestan unos %s € más al mes con lo que compras. Precios sin IVA.',
                g.proveedor, g.lista, facturas_alertas_num(g.impacto, 0)),
         format('precio_proveedor:%s:%s', g.proveedor_id, g.semana),
         (v_hoy + 30)::timestamptz,
         jsonb_build_object(
           'enlace', '?tab=compras&modo=proveedores&prov=' || g.proveedor_id,
           'proveedor_id', g.proveedor_id, 'proveedor', g.proveedor, 'local', g.loc,
           'desde', g.desde, 'hasta', g.hasta, 'mes', to_char(g.hasta, 'YYYY-MM'),
           'familia_id', case when g.n_fam = 1 then g.fam end, 'familia', case when g.n_fam = 1 then g.familia end,
           'productos', g.n, 'variacion_pct', round(g.media, 1), 'impacto_mes', round(g.impacto, 2),
           'claves', g.claves, 'factura_id', g.factura_id)
    from (
      select (a.datos ->> 'proveedor_id')::bigint as proveedor_id,
             max(a.datos ->> 'proveedor') as proveedor,
             case when count(distinct a.datos ->> 'local') = 1 then max(a.datos ->> 'local') end as loc,
             count(*) as n,
             count(distinct a.datos ->> 'familia_id') as n_fam,
             max((a.datos ->> 'familia_id')::bigint) as fam,
             max(cp.nombre::text) as familia,
             avg((a.datos ->> 'variacion_pct')::numeric) as media,
             sum(greatest(coalesce((a.datos ->> 'impacto_mes')::numeric, 0), 0)) as impacto,
             min((a.datos ->> 'fecha')::date) as desde, max((a.datos ->> 'fecha')::date) as hasta,
             to_char(max((a.datos ->> 'fecha')::date), 'IYYY-IW') as semana,
             max((a.datos ->> 'factura_id')::bigint) as factura_id,
             string_agg(format('%s +%s %%', a.datos ->> 'producto', facturas_alertas_num((a.datos ->> 'variacion_pct')::numeric, 0)),
                        ', ' order by (a.datos ->> 'variacion_pct')::numeric desc) as lista,
             jsonb_agg(a.clave) as claves
        from _alertas_hoy a
        left join categorias_producto cp on cp.id = (a.datos ->> 'familia_id')::bigint
       where a.tipo = 'facturas_precio_sube'
         and (a.datos ->> 'fecha')::date > v_hoy - v_prov_d
         and a.datos ->> 'proveedor_id' is not null
       group by 1
      having count(*) >= v_prov_n) g
   where not exists (select 1 from facturas_alertas_silencios s
                      where s.tipo = 'facturas_precio_proveedor' and s.objeto = 'prov:' || g.proveedor_id
                        and (s.hasta is null or s.hasta >= v_hoy))
     and not exists (select 1 from facturas_alertas_silencios s
                      where s.clave = format('precio_proveedor:%s:%s', g.proveedor_id, g.semana));

  -- A la campana, solo lo que pesa: las subidas agrupadas por proveedor van en su aviso,
  -- y las subidas o bajadas de menos de campana_impacto_min_eur al mes se quedan en Análisis.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false, 'agrupada', true)
   where a.tipo = 'facturas_precio_sube'
     and exists (select 1 from _alertas_hoy g where g.tipo = 'facturas_precio_proveedor' and g.datos -> 'claves' ? a.clave);
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false)
   where a.tipo in ('facturas_precio_sube', 'facturas_precio_baja')
     and coalesce((a.datos ->> 'impacto_mes')::numeric, 0) < v_min
     and not (a.datos ? 'campana');
  -- 20261121100000: «proveedor nuevo» no suena en la campana (petición del dueño, 09/11/2026);
  -- sigue en Análisis › Por revisar.
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', false)
   where a.tipo = 'facturas_proveedor_nuevo'
     and not (a.datos ? 'campana');
  update _alertas_hoy a
     set datos = a.datos || jsonb_build_object('campana', true)
   where not (a.datos ? 'campana');

  -- 20261213030000: las filas de la campana que se van a cambiar o a caducar se bloquean por
  -- adelantado, en orden de clave, y ya con todo calculado (lo pesado está arriba, sin bloqueos).
  -- Así dos escritores no se cruzan (interbloqueo) y, si choca con un guardado que verifica una
  -- factura, el lock_timeout de facturas_alertas_recalcular_pendiente lo deja para la vuelta
  -- siguiente en vez de esperar. No cambia qué se escribe.
  perform 1
    from notificaciones_dashboard n
   where n.clave is not null
     and (exists (select 1 from _alertas_hoy a
                   where a.clave = n.clave
                     and (n.titulo, n.mensaje, n.prioridad, n.datos, n.caduca_en, n.leida or (a.datos ->> 'campana') = 'false')
                         is distinct from (a.titulo, a.mensaje, a.prioridad, a.datos, a.caduca_en, n.leida))
          or (n.tipo = any(v_tipos) and (n.caduca_en is null or n.caduca_en > now())
              and not exists (select 1 from _alertas_hoy a where a.clave = n.clave)))
   order by n.clave
     for update of n;

  -- Lo que sigue vigente: texto y cifras al día; «leída» no se toca (salvo que deje de ir
  -- a la campana: entonces queda leída, para que no cuente en el número rojo).
  update notificaciones_dashboard n
     set titulo = a.titulo, mensaje = a.mensaje, prioridad = a.prioridad, datos = a.datos, caduca_en = a.caduca_en,
         leida = n.leida or (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where n.clave = a.clave
     and (n.titulo, n.mensaje, n.prioridad, n.datos, n.caduca_en, n.leida or (a.datos ->> 'campana') = 'false')
         is distinct from (a.titulo, a.mensaje, a.prioridad, a.datos, a.caduca_en, n.leida);
  get diagnostics v_act = row_count;

  -- Las que no van a la campana entran ya leídas (no suman en el número rojo).
  insert into notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, clave, caduca_en, datos, leida)
  select a.tipo, a.titulo, a.mensaje, 'facturas_alerta', a.prioridad, a.clave, a.caduca_en, a.datos,
         (a.datos ->> 'campana') = 'false'
    from _alertas_hoy a
   where not exists (select 1 from notificaciones_dashboard n where n.clave = a.clave)
  on conflict (clave) where clave is not null do nothing;
  get diagnostics v_nuevas = row_count;

  -- Lo que ya no se cumple (o se ha silenciado) caduca ya, y queda leído.
  update notificaciones_dashboard n
     set caduca_en = now(), leida = true
   where n.tipo = any(v_tipos) and n.clave is not null
     and (n.caduca_en is null or n.caduca_en > now())
     and not exists (select 1 from _alertas_hoy a where a.clave = n.clave);
  get diagnostics v_cad = row_count;
  update notificaciones_dashboard n
     set leida = true
   where n.tipo = any(v_tipos) and n.caduca_en <= now() and not n.leida;

  delete from notificaciones_dashboard n
   where n.tipo = any(v_tipos) and n.caduca_en < now() - interval '90 days';
  get diagnostics v_borr = row_count;
  -- Los «Es normal» vencidos ya no sirven.
  delete from facturas_alertas_silencios s where s.hasta is not null and s.hasta < v_hoy - 30;

  select coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb)
    into v_por
    from (select a.tipo, count(*) as n from _alertas_hoy a group by a.tipo) t;
  v_total := (select count(*) from _alertas_hoy);

  -- 20261125110000: aviso de margen bajo (solo al cruzar el límite). Un fallo aquí no
  -- deshace las alertas de Facturas.
  begin
    v_margen := public.margenes_generar_avisos(v_hoy);
  exception when others then
    v_margen := jsonb_build_object('error', sqlerrm);
    raise warning 'facturas_generar_alertas: margenes_generar_avisos falló: %', sqlerrm;
  end;

  return jsonb_build_object('vigentes', v_total, 'nuevas', v_nuevas, 'actualizadas', v_act,
                            'caducadas', v_cad, 'borradas', v_borr, 'silenciadas', v_sil,
                            'campana', (select count(*) from _alertas_hoy a where a.datos ->> 'campana' = 'true'),
                            'por_tipo', v_por, 'margenes', v_margen);
end;
$function$;

revoke all on function public.facturas_generar_alertas(date) from public, anon, authenticated;

-- Cron: tope de 20 s para el recálculo del minuto (antes heredaba los 120 s del rol postgres).
do $cron$
begin
  if to_regclass('cron.job') is not null then
    perform cron.alter_job(j.jobid, command := $c$set local statement_timeout = '20s'; select public.facturas_alertas_recalcular_pendiente();$c$)
       from cron.job j
      where j.jobname = 'facturas-alertas-recalculo';
  end if;
end
$cron$;
