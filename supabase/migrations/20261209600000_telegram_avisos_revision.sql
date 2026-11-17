set client_encoding = 'UTF8';
set lock_timeout = '5s';

-- Revisión del PR #262 (18/11/2026): reservas de la revisión independiente.
--   1. Al activar Telegram se mandaba TODO el atraso de fallos_internos: ahora solo lo creado DESPUÉS de activar
--      (avisos_telegram_config.activo_desde) y nunca de hace más de 3 días.
--   3. Semanal: los albaranes del aviso son los de más de 35 días; el total de todos va aparte.
--   4. El throttle de albaran_aviso / chat_pulgar_abajo guarda los ids de los descartados (repetidos_ids) y
--      el aviso siguiente los trae en acumulados_ids.

do $$
begin
  if to_regprocedure('public.fallos_internos_agrupar()') is null or to_regprocedure('public.avisos_telegram_datos_semanal(date)') is null then
    raise exception 'telegram_avisos_revision: falta 20261209400000_telegram_avisos_utiles. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Solo lo posterior a la activación ───────────────────────────────────
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

create or replace function public.fallos_internos_reclamar(p_limite integer default 20)
returns setof public.fallos_internos
language sql
security definer
set search_path = ''
as $$
  update public.fallos_internos f
     set intentos = f.intentos + 1, reclamado_en = now()
   where f.id in (
     select id from public.fallos_internos
      where enviado_en is null and intentos < 3
        and created_at >= coalesce(public.fallos_internos_desde(), now())
        and (reclamado_en is null or reclamado_en < now() - interval '2 minutes')
      order by created_at
      limit greatest(1, least(p_limite, 50))
      for update skip locked)
  returning f.*;
$$;
revoke all on function public.fallos_internos_reclamar(integer) from public, anon, authenticated;
grant execute on function public.fallos_internos_reclamar(integer) to service_role;

-- El disparador de 'fallos' tampoco llama a la Edge Function por filas anteriores a la activación.
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

-- ─── 3. Total de albaranes sin factura (el aviso solo cuenta los de más de 35 días) ──
create or replace function public.avisos_telegram_albaranes_total()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'total_n', count(*),
           'total_proveedores', count(distinct coalesce(fa.proveedor_id::text, fa.proveedor::text)),
           'total_importe', round(coalesce(sum(fa.total), 0), 2))
    from public.facturas fa
   where fa.tipo = 'albaran' and fa.facturado_en_id is null;
$$;
revoke all on function public.avisos_telegram_albaranes_total() from public, anon, authenticated;
grant execute on function public.avisos_telegram_albaranes_total() to service_role;

-- ─── 4. Throttle: guarda los ids de los descartados ─────────────────────────
create or replace function public.fallos_internos_agrupar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ult record;
  v_rep int;
  v_ref jsonb;
  v_ids jsonb;
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
    -- Qué se descarta: el albarán (factura_id) o el feedback del chat (feedback_id); máx. 50 ids.
    v_ref := case new.tipo when 'albaran_aviso' then new.datos -> 'factura_id' else new.datos -> 'feedback_id' end;
    v_ids := coalesce(v_ult.datos -> 'repetidos_ids', '[]'::jsonb);
    if v_ref is not null and jsonb_typeof(v_ref) <> 'null' and jsonb_array_length(v_ids) < 50 and not v_ids @> jsonb_build_array(v_ref) then
      v_ids := v_ids || jsonb_build_array(v_ref);
    end if;
    update public.fallos_internos f
       set datos = f.datos || jsonb_build_object('repetidos', coalesce((f.datos ->> 'repetidos')::int, 0) + 1, 'repetidos_ids', v_ids)
     where f.id = v_ult.id;
    return null;
  end if;
  v_rep := coalesce((v_ult.datos ->> 'repetidos')::int, 0);
  if v_rep > 0 then
    new.datos := new.datos || jsonb_build_object('acumulados_antes', v_rep, 'acumulados_desde', v_ult.created_at,
                                                 'acumulados_ids', coalesce(v_ult.datos -> 'repetidos_ids', '[]'::jsonb));
  end if;
  return new;
end;
$$;
revoke all on function public.fallos_internos_agrupar() from public, anon, authenticated;
