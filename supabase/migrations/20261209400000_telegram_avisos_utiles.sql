set client_encoding = 'UTF8';
-- ============================================================================
-- 20261209400000_telegram_avisos_utiles — Avisos de Telegram más útiles y menos ruidosos (18/11/2026)
-- ----------------------------------------------------------------------------
-- Revisión de producción del 17/11: Telegram nunca ha enviado nada (sigue desactivado y sin chat_id; eso
-- NO se toca aquí), y lo que habría enviado tenía ruido, nombres de clientes y huecos. Esta migración
-- pone lo que hace falta en la base; la lógica de los textos está en supabase/functions/avisos-telegram.
--
-- 1. avisos_telegram_config: columnas nuevas (todas con valor por defecto, no cambia ninguna existente):
--      reservas_al_momento  reservas nuevas/canceladas para hoy y mañana, al momento (sí)
--      tope_hora, tope_dia  máximo de avisos «al momento» por hora (10) y por día (30)
--      semanal_*            resumen semanal del dueño: activo, día (1 = lunes … 7), hora (9), último día enviado
--      resumen_revision     «Por revisar» ya mandado en el resumen (para no repetirlo cada día)
-- 2. avisos_telegram_envios.tipo admite 'semanal'.
-- 3. avisos_telegram_hay_pendientes(): ahora también reservas de hoy/mañana (sin pendientes de verificar
--    ni canceladas por el restaurante), igual que la función de Telegram.
-- 4. avisos_telegram_disparar('semanal') y cron avisos-telegram-semanal (cada hora; manda 1 vez el día y hora
--    configurados).
-- 5. avisos_telegram_datos_semanal(): cifras del resumen semanal (solo service_role).
-- 6. Fallos graves que antes no avisaban:
--      vigilante_fallos_telegram() + cron avisos-telegram-vigilante (cada 15 min). NO hace nada si Telegram está
--      inactivo ni mira nada anterior a la activación. Registra en fallos_internos, agrupado y con tope:
--        openai_sin_creditos  lecturas de facturas (ocr_trabajos) fallidas por créditos/facturación de OpenAI
--                             (como mucho 1 cada 6 h)
--        ocr_fallido          el resto de lecturas fallidas (como mucho 1 cada hora)
--        cron_caido           tarea programada importante sin éxito más de X min (1 cada 6 h, máx. 4 al día)
-- 7. Throttle de chat_pulgar_abajo y albaran_aviso: trigger BEFORE INSERT en fallos_internos que los agrupa
--    (como mucho un aviso cada 15 min por tipo; el resto se cuenta en `repetidos` y sale en el siguiente).
--    No toca fallo_interno_registrar ni lo de chat_error (20261209200000).
--
-- Solo funciones, columnas con valor por defecto y crons: no cambia datos. NO activa Telegram.
-- Rollback: supabase/rollbacks/20261209400000_telegram_avisos_utiles_ROLLBACK.sql
-- Test:     supabase/tests/avisos_telegram_utiles_test.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regclass('public.avisos_telegram_config') is null or to_regclass('public.fallos_internos') is null
     or to_regprocedure('public.avisos_telegram_disparar(text)') is null then
    raise exception 'telegram_avisos_utiles: faltan 20261126001000 y 20261127100100. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reservas' and column_name = 'cancelada_por') then
    raise exception 'telegram_avisos_utiles: falta reservas.cancelada_por (20261205100200). No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.margenes_carta_datos(date)') is null or to_regprocedure('public.facturas_alertas_umbrales()') is null then
    raise exception 'telegram_avisos_utiles: faltan margenes_carta_datos / facturas_alertas_umbrales. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Configuración ───────────────────────────────────────────────────────
alter table public.avisos_telegram_config
  add column if not exists reservas_al_momento boolean  not null default true,
  add column if not exists tope_hora           smallint not null default 10 check (tope_hora between 1 and 100),
  add column if not exists tope_dia            smallint not null default 30 check (tope_dia between 1 and 500),
  add column if not exists semanal_activo      boolean  not null default true,
  add column if not exists semanal_dia         smallint not null default 1 check (semanal_dia between 1 and 7),
  add column if not exists semanal_hora        smallint not null default 9 check (semanal_hora between 0 and 23),
  add column if not exists semanal_ultimo_dia  date,
  add column if not exists resumen_revision    jsonb    not null default '{}'::jsonb;

comment on column public.avisos_telegram_config.reservas_al_momento is
  'Reservas nuevas y canceladas para hoy y mañana, al momento y sin nombre del cliente (20261209400000). No avisa de las pendientes de verificar ni de las canceladas desde el panel.';
comment on column public.avisos_telegram_config.tope_hora is 'Máximo de avisos «al momento» por hora (20261209400000); el resto, «…y N más» en el panel.';
comment on column public.avisos_telegram_config.tope_dia is 'Máximo de avisos «al momento» por día (20261209400000).';
comment on column public.avisos_telegram_config.semanal_dia is 'Día del resumen semanal: 1 = lunes … 7 = domingo (hora de Madrid).';

-- Quien configura puede cambiar lo nuevo (no el estado interno: semanal_ultimo_dia ni resumen_revision).
grant update (reservas_al_momento, tope_hora, tope_dia, semanal_activo, semanal_dia, semanal_hora)
  on public.avisos_telegram_config to authenticated;

-- ─── 2. Registro de envíos: tipo 'semanal' ──────────────────────────────────
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo', 'semanal'));

-- ─── 3. ¿Hay algo por mandar al momento? (misma regla que logica.ts → evaluarPendientes) ───
create or replace function public.avisos_telegram_hay_pendientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.notificaciones_dashboard n
      join public.avisos_telegram_config c on c.id
      left join public.reservas r
        on r.id = n.referencia_id and n.referencia_tipo = 'reserva' and n.tipo in ('reserva_nueva', 'reserva_cancelada')
     where (
             n.tipo = any(c.tipos_al_momento)
             or (c.reservas_al_momento
                 and n.tipo in ('reserva_nueva', 'reserva_cancelada')
                 and r.fecha between (now() at time zone 'Europe/Madrid')::date and (now() at time zone 'Europe/Madrid')::date + 1)
           )
       and n.created_at > greatest(now() - interval '24 hours', coalesce(c.activo_desde, now()))
       and (n.caduca_en is null or n.caduca_en > now())
       and n.tipo <> 'reserva_sin_asignar'
       and n.tipo not like 'ia\_modelo%'
       and coalesce(n.datos ->> 'campana', 'true') <> 'false'
       -- Reservas: la nueva espera a que no esté pendiente de verificar (ni cancelada); la cancelada no vale si la hizo el restaurante.
       and (n.tipo not in ('reserva_nueva', 'reserva_cancelada')
            or (n.tipo = 'reserva_nueva' and r.id is not null and r.estado not in ('pendiente', 'cancelada', 'no_show'))
            or (n.tipo = 'reserva_cancelada' and coalesce(r.cancelada_por, '') <> 'restaurante'))
       and not exists (select 1 from public.avisos_telegram_envios e where e.aviso_id = n.id and e.ok)
       and (select count(*) from public.avisos_telegram_envios e where e.aviso_id = n.id and not e.ok) < 3
  );
$$;
revoke all on function public.avisos_telegram_hay_pendientes() from public, anon, authenticated;
grant execute on function public.avisos_telegram_hay_pendientes() to service_role;

-- ─── 4. Disparador: acepta 'semanal' ────────────────────────────────────────
create or replace function public.avisos_telegram_disparar(p_accion text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         public.avisos_telegram_config%rowtype;
  v_ahora   timestamp := now() at time zone 'Europe/Madrid';
  v_url     text;
  v_secreto text;
begin
  if p_accion not in ('pendientes', 'resumen', 'fallos', 'semanal') then
    raise exception 'avisos_telegram_disparar: acción desconocida %', p_accion;
  end if;
  select * into c from public.avisos_telegram_config where id;
  if not found or not c.activo or coalesce(c.chat_id, '') = '' then
    return 'inactivo';
  end if;

  if p_accion = 'pendientes' then
    if c.silencio_activo and public.avisos_telegram_en_silencio(extract(hour from v_ahora)::int, c.silencio_desde, c.silencio_hasta) then
      return 'silencio';
    end if;
    if not public.avisos_telegram_hay_pendientes() then
      return 'nada';
    end if;
  elsif p_accion = 'fallos' then
    -- Fallos internos: sin silencio nocturno; solo si hay alguno por mandar.
    if not exists (
      select 1 from public.fallos_internos f
       where f.enviado_en is null and f.intentos < 3
         and (f.reclamado_en is null or f.reclamado_en < now() - interval '2 minutes')
    ) then
      return 'nada';
    end if;
  elsif p_accion = 'semanal' then
    -- Una vez a la semana: el día y la hora configurados (si esa hora falla, lo intenta la siguiente).
    if not c.semanal_activo
       or extract(isodow from v_ahora)::int <> c.semanal_dia
       or extract(hour from v_ahora)::int < c.semanal_hora
       or c.semanal_ultimo_dia >= v_ahora::date then
      return 'no_toca';
    end if;
  else
    -- Una vez al día, a partir de la hora configurada (si una hora falla, lo intenta la siguiente).
    if extract(hour from v_ahora)::int < c.hora_resumen or c.resumen_ultimo_dia >= v_ahora::date then
      return 'no_toca';
    end if;
    -- Limpieza: el registro guarda 90 días.
    delete from public.avisos_telegram_envios where enviado_en < now() - interval '90 days';
    delete from public.fallos_internos where created_at < now() - interval '90 days';
  end if;

  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return 'sin_vault';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ocr_trabajos_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return 'sin_vault';
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using rtrim(v_url, '/') || '/functions/v1/avisos-telegram',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          jsonb_build_object('accion', p_accion);
  return 'llamada';
end;
$$;
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;
grant execute on function public.avisos_telegram_disparar(text) to service_role;

-- ─── 5. Cifras del resumen semanal ──────────────────────────────────────────
-- Solo service_role (la llama la Edge Function). Usa margenes_carta_datos (service_role) para vinos y tienda,
-- los documentos con avisos de lectura sin verificar y los avisos vigentes de albaranes sin factura.
create or replace function public.avisos_telegram_datos_semanal(p_hoy date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy   date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  m       jsonb := public.margenes_carta_datos(coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date));
  cf      jsonb := m -> 'config';
  v_tienda boolean := coalesce((m -> 'tienda' ->> 'activa')::boolean, false);
  v_vinos jsonb;
  v_tien  jsonb;
  v_fact  jsonb;
  v_alb   jsonb;
begin
  select jsonb_build_object(
           'limite', (cf ->> 'multiplicador_min_vino')::numeric,
           'bajo',  count(*) filter (where e -> 'banderas' ? 'multiplicador_bajo'),
           'total', count(*),
           'peor',  coalesce((select jsonb_agg(jsonb_build_object('nombre', x.nombre, 'multiplicador', x.mult) order by x.mult)
                               from (select e2 ->> 'nombre' as nombre, (e2 ->> 'multiplicador')::numeric as mult
                                       from jsonb_array_elements(m -> 'vinos') e2
                                      where e2 ->> 'multiplicador' is not null and e2 -> 'banderas' ? 'multiplicador_bajo'
                                      order by (e2 ->> 'multiplicador')::numeric limit 5) x), '[]'::jsonb))
    into v_vinos
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador' is not null;

  select jsonb_build_object(
           'activa', v_tienda,
           'limite', (cf ->> 'multiplicador_min_tienda')::numeric,
           'bajo',  count(*) filter (where e -> 'banderas' ? 'tienda_bajo'),
           'total', count(*),
           'bajo_coste', count(*) filter (where (e ->> 'multiplicador_tienda')::numeric < 1),
           'peor',  coalesce((select jsonb_agg(jsonb_build_object('nombre', x.nombre, 'multiplicador', x.mult) order by x.mult)
                               from (select e2 ->> 'nombre' as nombre, (e2 ->> 'multiplicador_tienda')::numeric as mult
                                       from jsonb_array_elements(m -> 'vinos') e2
                                      where e2 ->> 'multiplicador_tienda' is not null and (e2 ->> 'en_tienda')::boolean
                                        and e2 -> 'banderas' ? 'tienda_bajo'
                                      order by (e2 ->> 'multiplicador_tienda')::numeric limit 5) x), '[]'::jsonb))
    into v_tien
    from jsonb_array_elements(m -> 'vinos') e
   where e ->> 'multiplicador_tienda' is not null and (e ->> 'en_tienda')::boolean;

  -- Documentos (no albaranes ya facturados) con avisos de lectura sin verificar: lo mismo que cuenta «Por revisar».
  with doc as (
    select fa.id, fa.fecha, coalesce(fa.total, 0) as total, coalesce(pr.nombre::text, fa.proveedor::text) as proveedor
      from public.facturas fa
      left join public.proveedores pr on pr.id = fa.proveedor_id
     where not coalesce(fa.verificada, false)
       and not (fa.tipo = 'albaran' and fa.facturado_en_id is not null)
       and jsonb_typeof(fa.alertas_validacion) = 'array'
       and exists (select 1 from jsonb_array_elements(fa.alertas_validacion) a where coalesce(a ->> 'codigo', '') <> 'extraccion_historica')
  )
  select jsonb_build_object(
           'documentos', (select count(*) from doc),
           'importe', (select round(coalesce(sum(total), 0), 2) from doc),
           'mayores', coalesce((select jsonb_agg(jsonb_build_object('proveedor', x.proveedor, 'total', x.total, 'fecha', x.fecha))
                                  from (select * from doc order by total desc limit 3) x), '[]'::jsonb))
    into v_fact;

  -- Albaranes sin factura: los avisos vigentes (uno por proveedor), como los ve el panel.
  with al as (
    select (n.datos ->> 'albaranes')::int as n, coalesce((n.datos ->> 'importe')::numeric, 0) as importe, n.datos ->> 'proveedor' as proveedor
      from public.notificaciones_dashboard n
     where n.tipo = 'facturas_albaran_sin_factura'
       and (n.caduca_en is null or n.caduca_en > now())
  )
  select jsonb_build_object(
           'n', coalesce(sum(n), 0),
           'proveedores', count(*),
           'importe', round(coalesce(sum(importe), 0), 2),
           'mayores', coalesce((select jsonb_agg(jsonb_build_object('proveedor', x.proveedor, 'importe', x.importe, 'n', x.n))
                                  from (select * from al order by importe desc limit 3) x), '[]'::jsonb))
    into v_alb
    from al;

  return jsonb_build_object('hoy', v_hoy, 'vinos', v_vinos, 'tienda', v_tien, 'facturas', v_fact, 'albaranes', v_alb);
end;
$$;
revoke all on function public.avisos_telegram_datos_semanal(date) from public, anon, authenticated;
grant execute on function public.avisos_telegram_datos_semanal(date) to service_role;

-- ─── 7. Throttle de chat_pulgar_abajo y albaran_aviso ───────────────────────
-- Como mucho una fila (y un Telegram) cada 15 min por tipo; las que llegan entre medias se cuentan en
-- `repetidos` de esa fila y el siguiente aviso dice cuántas se acumularon (acumulados_antes).
create or replace function public.fallos_internos_agrupar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ult record;
  v_rep int;
begin
  if new.tipo not in ('chat_pulgar_abajo', 'albaran_aviso') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('fallos_internos:' || new.tipo));
  select f.id, f.created_at, f.datos into v_ult
    from public.fallos_internos f
   where f.tipo = new.tipo
   order by f.created_at desc, f.id desc
   limit 1;
  if v_ult.id is not null and v_ult.created_at > now() - interval '15 minutes' then
    update public.fallos_internos f
       set datos = f.datos || jsonb_build_object('repetidos', coalesce((f.datos ->> 'repetidos')::int, 0) + 1)
     where f.id = v_ult.id;
    return null;
  end if;
  v_rep := coalesce((v_ult.datos ->> 'repetidos')::int, 0);
  if v_rep > 0 then
    new.datos := new.datos || jsonb_build_object('acumulados_antes', v_rep, 'acumulados_desde', v_ult.created_at);
  end if;
  return new;
end;
$$;
revoke all on function public.fallos_internos_agrupar() from public, anon, authenticated;

drop trigger if exists fallos_internos_agrupar on public.fallos_internos;
create trigger fallos_internos_agrupar before insert on public.fallos_internos
  for each row execute function public.fallos_internos_agrupar();

create index if not exists fallos_internos_tipo_fecha_idx on public.fallos_internos (tipo, created_at desc);

-- ─── 6. Vigilante de fallos graves ──────────────────────────────────────────
-- Cada 15 min. Solo trabaja con Telegram activo y con chat_id, y solo mira lo posterior a la activación (así no
-- suelta de golpe fallos antiguos). Agrupa y pone tope: nunca más de un mensaje por clase y ventana.
create or replace function public.vigilante_fallos_telegram()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c         public.avisos_telegram_config%rowtype;
  v_base    timestamptz;
  v_ult     timestamptz;
  v_n       int;
  v_desde   timestamptz;
  v_ej      text;
  v_motivos jsonb;
  v_crons   jsonb := '[]'::jsonb;
  v_hechos  text[] := '{}';
  v_ok      timestamptz;
  v_run     timestamptz;
  v_err     text;
  r         record;
  -- Tareas que importan y cuántos minutos sin éxito se toleran (las que no existan en este entorno se ignoran).
  v_lista   jsonb := '[
    {"job":"reanudar-trabajos-ocr","min":30},
    {"job":"facturas-alertas-recalculo","min":30},
    {"job":"avisos-telegram-pendientes","min":30},
    {"job":"avisos-telegram-fallos","min":30},
    {"job":"avisos-telegram-resumen","min":180},
    {"job":"embeddings-nombres","min":60},
    {"job":"facturas-originales-drive","min":60},
    {"job":"procesar-logs-web","min":60},
    {"job":"levantar-mesas-fin-turno","min":60},
    {"job":"instagram-programador","min":60},
    {"job":"facturas-alertas","min":1560},
    {"job":"resenas-ciclo","min":840}
  ]'::jsonb;
begin
  select * into c from public.avisos_telegram_config where id;
  if not found or not c.activo or coalesce(c.chat_id, '') = '' then
    return 'inactivo';
  end if;
  perform pg_advisory_xact_lock(hashtext('vigilante_fallos_telegram'));
  v_base := greatest(coalesce(c.activo_desde, now()), now() - interval '1 day');

  -- A. OpenAI sin créditos o con error de facturación (lecturas de facturas fallidas por eso).
  select max(f.created_at) into v_ult from public.fallos_internos f where f.tipo = 'openai_sin_creditos';
  select count(*), min(coalesce(t.terminado_at, t.updated_at)), max(left(t.error, 200))
    into v_n, v_desde, v_ej
    from public.ocr_trabajos t
   where t.estado = 'fallido'
     and coalesce(t.terminado_at, t.updated_at) > greatest(coalesce(v_ult, '-infinity'::timestamptz), v_base)
     and t.error ~* '(no credits|insufficient[_ ]quota|exceeded your current quota|billing|\mcredit)';
  if v_n > 0 and (v_ult is null or v_ult < now() - interval '6 hours') then
    perform public.fallo_interno_registrar('openai_sin_creditos',
      jsonb_build_object('trabajos', v_n, 'desde', v_desde, 'ejemplo', v_ej));
    v_hechos := array_append(v_hechos, 'openai');
  end if;

  -- B. El resto de lecturas fallidas, agrupadas (como mucho una vez por hora).
  select max(f.created_at) into v_ult from public.fallos_internos f where f.tipo = 'ocr_fallido';
  if v_ult is null or v_ult < now() - interval '1 hour' then
    select count(*), min(coalesce(t.terminado_at, t.updated_at)) into v_n, v_desde
      from public.ocr_trabajos t
     where t.estado = 'fallido'
       and coalesce(t.terminado_at, t.updated_at) > greatest(coalesce(v_ult, '-infinity'::timestamptz), v_base)
       and coalesce(t.error, '') !~* '(no credits|insufficient[_ ]quota|exceeded your current quota|billing|\mcredit)';
    if v_n > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('error', x.e, 'n', x.n) order by x.n desc), '[]'::jsonb) into v_motivos
        from (select left(coalesce(t.error, '(sin texto)'), 160) as e, count(*) as n
                from public.ocr_trabajos t
               where t.estado = 'fallido'
                 and coalesce(t.terminado_at, t.updated_at) > greatest(coalesce(v_ult, '-infinity'::timestamptz), v_base)
                 and coalesce(t.error, '') !~* '(no credits|insufficient[_ ]quota|exceeded your current quota|billing|\mcredit)'
               group by 1 order by 2 desc limit 3) x;
      perform public.fallo_interno_registrar('ocr_fallido', jsonb_build_object('trabajos', v_n, 'desde', v_desde, 'motivos', v_motivos));
      v_hechos := array_append(v_hechos, 'ocr');
    end if;
  end if;

  -- C. Tareas programadas importantes sin éxito más de X minutos (una vez cada 6 h, máx. 4 al día).
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    select max(f.created_at) into v_ult from public.fallos_internos f where f.tipo = 'cron_caido';
    if (v_ult is null or v_ult < now() - interval '6 hours')
       and (select count(*) from public.fallos_internos f where f.tipo = 'cron_caido' and f.created_at > now() - interval '24 hours') < 4 then
      for r in
        execute 'select j.jobid, j.jobname, x.min from cron.job j join jsonb_to_recordset($1) as x(job text, min int) on x.job = j.jobname where j.active'
        using v_lista
      loop
        execute 'select max(d.end_time) filter (where d.status = ''succeeded''), max(d.start_time) from cron.job_run_details d where d.jobid = $1 and d.start_time > now() - interval ''3 days'''
          into v_ok, v_run using r.jobid;
        -- Sin ninguna ejecución en 3 días no hay datos para juzgar (tarea recién creada): se ignora.
        if v_run is not null and (v_ok is null or v_ok < now() - make_interval(mins => r.min)) then
          execute 'select left(d.return_message, 100) from cron.job_run_details d where d.jobid = $1 and d.status = ''failed'' order by d.start_time desc limit 1'
            into v_err using r.jobid;
          v_crons := v_crons || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'job', r.jobname, 'maximo', r.min, 'ultimo_exito', v_ok,
            'minutos', case when v_ok is null then null else round(extract(epoch from (now() - v_ok)) / 60) end,
            'error', v_err)));
        end if;
      end loop;
      if jsonb_array_length(v_crons) > 0 then
        perform public.fallo_interno_registrar('cron_caido', jsonb_build_object('crons', v_crons));
        v_hechos := array_append(v_hechos, 'cron');
      end if;
    end if;
  end if;

  return case when array_length(v_hechos, 1) is null then 'nada' else array_to_string(v_hechos, ',') end;
end;
$$;
revoke all on function public.vigilante_fallos_telegram() from public, anon, authenticated;
grant execute on function public.vigilante_fallos_telegram() to service_role;

-- ─── Crons: semanal (cada hora, manda una vez) y vigilante (cada 15 min) ────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-semanal') then
      perform cron.unschedule('avisos-telegram-semanal');
    end if;
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-vigilante') then
      perform cron.unschedule('avisos-telegram-vigilante');
    end if;
    perform cron.schedule('avisos-telegram-semanal', '5 * * * *', $cron$ select public.avisos_telegram_disparar('semanal'); $cron$);
    perform cron.schedule('avisos-telegram-vigilante', '*/15 * * * *', $cron$ select public.vigilante_fallos_telegram(); $cron$);
  else
    raise notice 'telegram_avisos_utiles: no hay pg_cron; los crons semanal y vigilante NO se han instalado.';
  end if;
end;
$$;
