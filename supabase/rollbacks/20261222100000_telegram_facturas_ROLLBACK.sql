set client_encoding = 'UTF8';
-- ============================================================================
-- ROLLBACK de 20261222100000_telegram_facturas
-- ----------------------------------------------------------------------------
-- Quita el cierre del día (columnas, cron y envíos 'cierre'), deja avisos_telegram_hay_pendientes como en
-- 20261217100000 (las subidas que no suenan en la campana ya no cuentan) y avisos_telegram_disparar como en
-- 20261216100000, y quita Importes inusuales y Precio pactado roto de los tipos al momento.
-- La función avisos-telegram nueva sigue funcionando sin la migración (salvo «cierre»). Idempotente.
-- Tiene que terminar en «telegram_facturas ROLLBACK: aplicado».
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-cierre') then
      perform cron.unschedule('avisos-telegram-cierre');
    end if;
  end if;
end;
$$;

create or replace function public.avisos_telegram_hay_pendientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- Avisos del panel marcados «al momento» (Facturas y márgenes). Los de reservas ya no: van por avisos_telegram_reservas.
    select 1
      from public.notificaciones_dashboard n
      join public.avisos_telegram_config c on c.id
     where n.tipo = any(c.tipos_al_momento)
       and n.tipo not like 'reserva\_%'
       and (case public.avisos_telegram_canal(n.tipo)
              when 'reservas' then coalesce(c.chat_reservas, c.chat_id)
              else coalesce(c.chat_facturas, c.chat_id)
            end) is not null
       and n.created_at > greatest(now() - interval '24 hours', coalesce(c.activo_desde, now()))
       and (n.caduca_en is null or n.caduca_en > now())
       and n.tipo not like 'ia\_modelo%'
       and coalesce(n.datos ->> 'campana', 'true') <> 'false'
       and not exists (select 1 from public.avisos_telegram_envios e where e.aviso_id = n.id and e.ok)
       and (select count(*) from public.avisos_telegram_envios e where e.aviso_id = n.id and not e.ok) < 3
  ) or exists (
    -- Pasos de reserva por mandar (misma regla que avisos_telegram_reservas_reclamar).
    select 1
      from public.avisos_telegram_reservas x
      join public.avisos_telegram_config c on c.id
     where c.reservas_al_momento
       and coalesce(c.chat_reservas, c.chat_id) is not null
       and x.enviado_en is null and x.intentos < 3
       and x.created_at >= greatest(coalesce(c.activo_desde, now()), now() - interval '1 day')
       and (x.reclamado_en is null or x.reclamado_en < now() - interval '2 minutes')
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
  if not found or not c.activo then
    return 'inactivo';
  end if;
  -- 20261216100000: cada acción va al chat de su canal. Reservas y Facturas usan el general (chat_id) si no
  -- tienen el suyo; los fallos técnicos, solo chat_fallos.
  if (case p_accion
        when 'pendientes' then coalesce(c.chat_reservas, c.chat_facturas, c.chat_id)
        when 'fallos'     then c.chat_fallos
        else coalesce(c.chat_resumenes, c.chat_id)
      end) is null then
    return 'sin_chat';
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

delete from public.avisos_telegram_envios where tipo = 'cierre';
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo', 'semanal', 'reserva'));

alter table public.avisos_telegram_config alter column tipos_al_momento set default array['facturas_margen_bajo', 'facturas_precio_sube'];
update public.avisos_telegram_config
   set tipos_al_momento = array(select t from unnest(tipos_al_momento) t where t not in ('facturas_importe_inusual', 'facturas_precio_pactado'))
 where id and tipos_al_momento && array['facturas_importe_inusual', 'facturas_precio_pactado'];

alter table public.avisos_telegram_config
  drop column if exists cierre_activo,
  drop column if exists cierre_hora,
  drop column if exists cierre_ultimo_dia;

do $$ begin raise notice 'telegram_facturas ROLLBACK: aplicado'; end $$;

commit;
