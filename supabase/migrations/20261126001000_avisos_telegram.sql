set client_encoding = 'UTF8';
-- ============================================================================
-- 20261126001000_avisos_telegram — Avisos del panel por Telegram (11/11/2026)
-- ----------------------------------------------------------------------------
-- Los avisos de notificaciones_dashboard llegan a un chat de Telegram de dos formas:
--   · AL MOMENTO: los tipos marcados (por defecto margen bajo y subida de precio),
--     cada 5 minutos, con datos.texto_telegram (o un texto corto con el título).
--     De noche (silencio, por defecto 23:00–08:00 hora de Madrid) esperan a que
--     acabe el silencio.
--   · RESUMEN DIARIO: a la hora configurada (por defecto 09:00 de Madrid), los
--     avisos de las últimas 24 h agrupados por tipo.
--
-- 1. avisos_telegram_config (una fila, solo super admin): activo (false por
--    defecto), chat_id, hora del resumen, tipos al momento, silencio. Los umbrales
--    de margen siguen en margenes_carta_config: aquí no se duplican.
-- 2. avisos_telegram_envios: registro de cada envío (aviso, resumen o prueba),
--    a qué chat, cuándo y si falló con qué error. Un aviso con un envío correcto
--    no se vuelve a mandar; tras 3 fallos se deja (sale igual en el resumen).
-- 3. avisos_telegram_disparar(accion): la llaman los crons. NO llama a nada si
--    activo = false o no hay chat_id; «pendientes» solo llama si hay algo por
--    enviar y no es hora de silencio; «resumen» solo una vez al día, a partir de
--    la hora configurada.
-- 4. Crons: avisos-telegram-pendientes (cada 5 min) y avisos-telegram-resumen
--    (cada hora en punto). Llaman a la Edge Function avisos-telegram con
--    x-ocr-secret = Vault «ocr_trabajos_secret», como ia-modelos-openai.
--
-- El token del bot NO está aquí: es el secreto TELEGRAM_BOT_TOKEN de la función.
-- Rollback: supabase/rollbacks/20261126001000_avisos_telegram_ROLLBACK.sql
-- Test:     supabase/tests/avisos_telegram_test.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'avisos_telegram: falta public.is_super_admin(uuid). No se ha cambiado nada.';
  end if;
  if to_regclass('public.notificaciones_dashboard') is null then
    raise exception 'avisos_telegram: falta notificaciones_dashboard. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Configuración (una fila) ────────────────────────────────────────────
create table if not exists public.avisos_telegram_config (
  id                 boolean primary key default true check (id),
  activo             boolean not null default false,
  chat_id            text check (chat_id is null or chat_id ~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,32})$'),
  hora_resumen       smallint not null default 9 check (hora_resumen between 0 and 23),
  tipos_al_momento   text[] not null default array['facturas_margen_bajo', 'facturas_precio_sube'],
  silencio_activo    boolean not null default true,
  silencio_desde     smallint not null default 23 check (silencio_desde between 0 and 23),
  silencio_hasta     smallint not null default 8 check (silencio_hasta between 0 and 23),
  -- Desde cuándo está activo: lo anterior no se manda al momento (no inunda al activar).
  activo_desde       timestamptz,
  -- Día (Madrid) del último resumen enviado: uno al día.
  resumen_ultimo_dia date,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
comment on table public.avisos_telegram_config is
  'Avisos por Telegram (20261126001000): una fila. Solo super admin. El token es el secreto TELEGRAM_BOT_TOKEN de la función avisos-telegram.';

insert into public.avisos_telegram_config (id) values (true) on conflict (id) do nothing;

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

drop trigger if exists avisos_telegram_config_antes on public.avisos_telegram_config;
create trigger avisos_telegram_config_antes before insert or update on public.avisos_telegram_config
  for each row execute function public.avisos_telegram_config_antes();

-- ─── 2. Registro de envíos ──────────────────────────────────────────────────
create table if not exists public.avisos_telegram_envios (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes')),
  aviso_id    uuid references public.notificaciones_dashboard(id) on delete set null,
  chat_id     text,
  enviado_en  timestamptz not null default now(),
  ok          boolean not null,
  error       text,
  mensaje_id  bigint
);
comment on table public.avisos_telegram_envios is
  'Envíos a Telegram (20261126001000). tipo pendientes = intento sin aviso concreto (p. ej. «Telegram sin configurar»).';

create index if not exists avisos_telegram_envios_aviso_idx on public.avisos_telegram_envios (aviso_id) where aviso_id is not null;
create index if not exists avisos_telegram_envios_fecha_idx on public.avisos_telegram_envios (enviado_en desc);
-- Un aviso solo puede tener UN envío correcto.
create unique index if not exists avisos_telegram_envios_un_ok on public.avisos_telegram_envios (aviso_id) where ok and aviso_id is not null;

-- ─── Permisos ───────────────────────────────────────────────────────────────
alter table public.avisos_telegram_config enable row level security;
alter table public.avisos_telegram_envios enable row level security;

revoke all on public.avisos_telegram_config from public, anon, authenticated;
revoke all on public.avisos_telegram_envios from public, anon, authenticated;
grant select on public.avisos_telegram_config to authenticated;
grant update (activo, chat_id, hora_resumen, tipos_al_momento, silencio_activo, silencio_desde, silencio_hasta)
  on public.avisos_telegram_config to authenticated;
grant select on public.avisos_telegram_envios to authenticated;
grant all on public.avisos_telegram_config to service_role;
grant all on public.avisos_telegram_envios to service_role;

drop policy if exists avisos_telegram_config_select on public.avisos_telegram_config;
create policy avisos_telegram_config_select on public.avisos_telegram_config for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists avisos_telegram_config_update on public.avisos_telegram_config;
create policy avisos_telegram_config_update on public.avisos_telegram_config for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists avisos_telegram_config_service on public.avisos_telegram_config;
create policy avisos_telegram_config_service on public.avisos_telegram_config for all to service_role using (true) with check (true);

drop policy if exists avisos_telegram_envios_select on public.avisos_telegram_envios;
create policy avisos_telegram_envios_select on public.avisos_telegram_envios for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists avisos_telegram_envios_service on public.avisos_telegram_envios;
create policy avisos_telegram_envios_service on public.avisos_telegram_envios for all to service_role using (true) with check (true);

-- ─── 3. Lógica de los crons ─────────────────────────────────────────────────
-- ¿Es hora de silencio? (horas de Madrid; desde = hasta → sin silencio). La misma regla
-- que supabase/functions/avisos-telegram/logica.ts → enSilencio.
create or replace function public.avisos_telegram_en_silencio(p_hora integer, p_desde integer, p_hasta integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_desde = p_hasta then false
    when p_desde > p_hasta then p_hora >= p_desde or p_hora < p_hasta
    else p_hora >= p_desde and p_hora < p_hasta
  end;
$$;

-- ¿Hay algún aviso por mandar al momento? Misma regla que logica.ts → pendientesDeEnvio:
-- tipo marcado, de las últimas 24 h y posterior a la activación, sin caducar, no retirado,
-- con campana, sin envío correcto y con menos de 3 fallos.
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
     where n.tipo = any(c.tipos_al_momento)
       and n.created_at > greatest(now() - interval '24 hours', coalesce(c.activo_desde, now()))
       and (n.caduca_en is null or n.caduca_en > now())
       and n.tipo <> 'reserva_sin_asignar'
       and n.tipo not like 'ia\_modelo%'
       and coalesce(n.datos ->> 'campana', 'true') <> 'false'
       and not exists (select 1 from public.avisos_telegram_envios e where e.aviso_id = n.id and e.ok)
       and (select count(*) from public.avisos_telegram_envios e where e.aviso_id = n.id and not e.ok) < 3
  );
$$;

-- Lo llaman los crons. Devuelve qué ha hecho (para el test y para mirar a mano).
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
  if p_accion not in ('pendientes', 'resumen') then
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
  else
    -- Una vez al día, a partir de la hora configurada (si una hora falla, lo intenta la siguiente).
    if extract(hour from v_ahora)::int < c.hora_resumen or c.resumen_ultimo_dia >= v_ahora::date then
      return 'no_toca';
    end if;
    -- Limpieza: el registro guarda 90 días.
    delete from public.avisos_telegram_envios where enviado_en < now() - interval '90 days';
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

revoke all on function public.avisos_telegram_config_antes() from public, anon, authenticated;
revoke all on function public.avisos_telegram_hay_pendientes() from public, anon, authenticated;
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;
grant execute on function public.avisos_telegram_hay_pendientes() to service_role;
grant execute on function public.avisos_telegram_disparar(text) to service_role;

-- ─── 4. Crons ───────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-pendientes') then
      perform cron.unschedule('avisos-telegram-pendientes');
    end if;
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-resumen') then
      perform cron.unschedule('avisos-telegram-resumen');
    end if;
    perform cron.schedule('avisos-telegram-pendientes', '*/5 * * * *', $cron$ select public.avisos_telegram_disparar('pendientes'); $cron$);
    perform cron.schedule('avisos-telegram-resumen', '0 * * * *', $cron$ select public.avisos_telegram_disparar('resumen'); $cron$);
  else
    raise notice 'avisos_telegram: no hay pg_cron; los crons de Telegram NO se han instalado.';
  end if;
end;
$$;
