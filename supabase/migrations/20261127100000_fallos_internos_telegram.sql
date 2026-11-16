set client_encoding = 'UTF8';
-- ============================================================================
-- 20261127100000_fallos_internos_telegram — Fallos internos al Telegram de los
-- desarrolladores (12/11/2026)
-- ----------------------------------------------------------------------------
-- Un ÚNICO punto de envío con «tipo de aviso» para los fallos que sirven a quien
-- desarrolla (no a la dueña): por el mismo grupo y bot de avisos_telegram
-- (20261126001000), sin silencio nocturno.
--
--   fallos_internos            cola/registro: tipo, datos (jsonb), usuario, cuándo, envío.
--   fallo_interno_registrar()  PUNTO ÚNICO de alta (solo servidor: triggers y RPC).
--   registrar_fallo_interno()  RPC del panel (lista blanca de tipos, tope por usuario/hora).
--   Tipos hoy:  albaran_aviso      avisos al subir un albarán (lo llama el panel)
--               chat_pulgar_abajo  pulgar abajo en el copiloto de Facturas (trigger sobre chat_feedback)
--   Tipo nuevo: llamar a fallo_interno_registrar('<tipo>', datos) desde donde ocurra
--   (y, si es un RPC del panel, añadirlo a la lista blanca de registrar_fallo_interno);
--   el formato del mensaje se añade en supabase/functions/avisos-telegram/fallos.ts
--   (sin formato propio sale un mensaje genérico con los datos).
--
-- Envío: al insertar, el trigger llama a avisos_telegram_disparar('fallos') (pg_net,
-- tras el commit) y el cron avisos-telegram-fallos (cada 5 min) reintenta los
-- pendientes (máx. 3 intentos). La Edge Function avisos-telegram, acción «fallos»,
-- reclama las filas (fallos_internos_reclamar, sin duplicados) y manda un mensaje por
-- fallo; cada envío queda en avisos_telegram_envios (tipo 'fallo', fallo_id).
-- Respeta avisos_telegram_config (activo y chat_id).
--
-- Rollback: supabase/rollbacks/20261127100000_fallos_internos_telegram_ROLLBACK.sql
-- Test:     supabase/tests/fallos_internos_telegram_test.sql
-- ============================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regclass('public.avisos_telegram_envios') is null or to_regprocedure('public.avisos_telegram_disparar(text)') is null then
    raise exception 'fallos_internos_telegram: falta 20261126001000_avisos_telegram. No se ha cambiado nada.';
  end if;
  if to_regclass('public.chat_feedback') is null then
    raise exception 'fallos_internos_telegram: falta chat_feedback (20261123200000). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────
create table if not exists public.fallos_internos (
  id            bigint generated always as identity primary key,
  tipo          text not null check (tipo ~ '^[a-z][a-z0-9_]{1,59}$'),
  datos         jsonb not null default '{}'::jsonb check (jsonb_typeof(datos) = 'object'),
  usuario_id    uuid,
  usuario       text,
  -- Evita repetir el mismo fallo (p. ej. el mismo albarán con los mismos avisos).
  clave         text check (clave is null or char_length(clave) <= 200),
  created_at    timestamptz not null default now(),
  intentos      smallint not null default 0,
  reclamado_en  timestamptz,
  enviado_en    timestamptz,
  ultimo_error  text
);
comment on table public.fallos_internos is
  'Fallos internos para desarrolladores (20261127100000). Se envían al Telegram de avisos con la Edge Function avisos-telegram (acción fallos).';

create unique index if not exists fallos_internos_clave_uq on public.fallos_internos (tipo, clave) where clave is not null;
create index if not exists fallos_internos_pendientes_idx on public.fallos_internos (created_at) where enviado_en is null;
create index if not exists fallos_internos_usuario_idx on public.fallos_internos (usuario_id, created_at desc) where usuario_id is not null;

alter table public.fallos_internos enable row level security;
revoke all on public.fallos_internos from public, anon, authenticated;
grant select on public.fallos_internos to authenticated;
grant all on public.fallos_internos to service_role;

drop policy if exists fallos_internos_select on public.fallos_internos;
create policy fallos_internos_select on public.fallos_internos for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists fallos_internos_service on public.fallos_internos;
create policy fallos_internos_service on public.fallos_internos for all to service_role using (true) with check (true);

-- ─── 2. Registro de envíos: tipo 'fallo' ────────────────────────────────────
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo'));
alter table public.avisos_telegram_envios add column if not exists fallo_id bigint references public.fallos_internos(id) on delete set null;
create index if not exists avisos_telegram_envios_fallo_idx on public.avisos_telegram_envios (fallo_id) where fallo_id is not null;

-- ─── 3. Punto único de alta (solo servidor) ─────────────────────────────────
-- Devuelve el id, o null si ya existía (misma clave) o los datos son demasiado grandes.
create or replace function public.fallo_interno_registrar(
  p_tipo text, p_datos jsonb default '{}'::jsonb, p_usuario_id uuid default null, p_clave text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    bigint;
  v_email text;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or pg_column_size(p_datos) > 60000 then
    return null;
  end if;
  if p_usuario_id is not null then
    select u.email into v_email from auth.users u where u.id = p_usuario_id;
  end if;
  insert into public.fallos_internos (tipo, datos, usuario_id, usuario, clave)
  values (p_tipo, p_datos, p_usuario_id, v_email, p_clave)
  on conflict (tipo, clave) where clave is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Tras insertar: avisa a la función de Telegram (nunca rompe la operación que originó el fallo).
create or replace function public.fallos_internos_despues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.avisos_telegram_disparar('fallos');
  exception when others then
    raise warning 'fallos_internos: no se pudo avisar a Telegram: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists fallos_internos_despues on public.fallos_internos;
create trigger fallos_internos_despues after insert on public.fallos_internos
  for each row execute function public.fallos_internos_despues();

-- RPC del panel: solo tipos de la lista blanca y un máximo de 30 por usuario y hora.
create or replace function public.registrar_fallo_interno(p_tipo text, p_datos jsonb default '{}'::jsonb, p_clave text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'registrar_fallo_interno: hace falta iniciar sesión' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('albaran_aviso') then
    raise exception 'registrar_fallo_interno: tipo no permitido %', p_tipo using errcode = '22023';
  end if;
  if (select count(*) from public.fallos_internos f where f.usuario_id = v_uid and f.created_at > now() - interval '1 hour') >= 30 then
    return null;
  end if;
  return public.fallo_interno_registrar(p_tipo, p_datos, v_uid, left(p_clave, 200));
end;
$$;

-- El pulgar abajo del copiloto de Facturas ya se guarda en chat_feedback: aquí se avisa.
create or replace function public.chat_feedback_fallo_telegram()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fallo_interno_registrar(
    'chat_pulgar_abajo',
    jsonb_build_object(
      'feedback_id', new.id,
      'pregunta', left(new.pregunta, 2000),
      'respuesta', left(new.respuesta, 4000),
      'comentario', new.comentario,
      'modelo', new.modelo,
      'conversacion_id', new.conversacion_id,
      'hora', new.created_at
    ),
    new.usuario_id,
    'feedback:' || new.id
  );
  return null;
exception when others then
  raise warning 'chat_feedback_fallo_telegram: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists chat_feedback_fallo_telegram on public.chat_feedback;
create trigger chat_feedback_fallo_telegram after insert on public.chat_feedback
  for each row when (new.valoracion = -1) execute function public.chat_feedback_fallo_telegram();

-- La función de Telegram reclama los pendientes por lote (sin duplicados si dos
-- llamadas coinciden): 3 intentos como máximo, y un reclamo caduca a los 2 minutos.
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
        and (reclamado_en is null or reclamado_en < now() - interval '2 minutes')
      order by created_at
      limit greatest(1, least(p_limite, 50))
      for update skip locked)
  returning f.*;
$$;

-- ─── 4. Disparador: acepta 'fallos' ─────────────────────────────────────────
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
  if p_accion not in ('pendientes', 'resumen', 'fallos') then
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

-- ─── Permisos ───────────────────────────────────────────────────────────────
revoke all on function public.fallo_interno_registrar(text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.fallos_internos_despues() from public, anon, authenticated;
revoke all on function public.chat_feedback_fallo_telegram() from public, anon, authenticated;
revoke all on function public.fallos_internos_reclamar(integer) from public, anon, authenticated;
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;
revoke all on function public.registrar_fallo_interno(text, jsonb, text) from public, anon;
grant execute on function public.fallo_interno_registrar(text, jsonb, uuid, text) to service_role;
grant execute on function public.fallos_internos_reclamar(integer) to service_role;
grant execute on function public.avisos_telegram_disparar(text) to service_role;
grant execute on function public.registrar_fallo_interno(text, jsonb, text) to authenticated, service_role;

-- ─── 5. Cron de reintento ───────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-telegram-fallos') then
      perform cron.unschedule('avisos-telegram-fallos');
    end if;
    perform cron.schedule('avisos-telegram-fallos', '*/5 * * * *', $cron$ select public.avisos_telegram_disparar('fallos'); $cron$);
  else
    raise notice 'fallos_internos_telegram: no hay pg_cron; el reintento de fallos NO se ha instalado.';
  end if;
end;
$$;
