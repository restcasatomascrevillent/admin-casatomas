set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK de 20261216100000_telegram_canales
-- ----------------------------------------------------------------------------
-- Vuelve a un único chat (chat_id) para todo: avisos, resúmenes y fallos técnicos. Deja las funciones como
-- estaban (20261126001000, 20261209400000 y 20261209600000) y borra las columnas nuevas: los chats por canal
-- que se hubieran puesto se pierden (apúntalos antes si hay que volver a ponerlos).
-- Antes de aplicarlo, vuelve a desplegar la función avisos-telegram anterior (la nueva necesita las columnas).
-- Idempotente. Tiene que terminar en «telegram_canales ROLLBACK: aplicado».
-- ============================================================================
begin;
set local lock_timeout = '5s';

create or replace function public.avisos_telegram_config_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := true;
  new.chat_id := nullif(btrim(new.chat_id), '');
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if new.activo and (tg_op = 'INSERT' or not old.activo) then
    new.activo_desde := now();
  end if;
  return new;
end;
$$;
revoke all on function public.avisos_telegram_config_antes() from public, anon, authenticated;

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
         and f.created_at >= public.fallos_internos_desde()
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

create or replace function public.fallos_internos_desde()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(c.activo_desde, now()), now() - interval '3 days')
    from public.avisos_telegram_config c where c.id;
$$;
revoke all on function public.fallos_internos_desde() from public, anon, authenticated;
grant execute on function public.fallos_internos_desde() to service_role;

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

drop function if exists public.avisos_telegram_canal(text);

alter table public.avisos_telegram_config
  drop constraint if exists avisos_telegram_config_chat_reservas_check,
  drop constraint if exists avisos_telegram_config_chat_facturas_check,
  drop constraint if exists avisos_telegram_config_chat_resumenes_check,
  drop constraint if exists avisos_telegram_config_chat_fallos_check;
alter table public.avisos_telegram_config
  drop column if exists chat_reservas,
  drop column if exists chat_facturas,
  drop column if exists chat_resumenes,
  drop column if exists chat_fallos,
  drop column if exists fallos_desde;

do $$ begin raise notice 'telegram_canales ROLLBACK: aplicado'; end $$;

commit;
